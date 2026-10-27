/* npm run train -- --regime morning|evening|offpeak|all --gens N --batch M --seed S
     [--pop P] [--check K] [--minutes T (per regime)] [--threads N]
   Per regime: CMA-ES on domain-randomised training scenarios; every K gens (and at the end) the
   incumbent is gated on that regime's validation split against both V0 and the current champion.
   results/champion.json is rewritten only if at least one regime passed; the curve is appended
   to results/training-log.json either way. */
import { REGIMES, type Regime } from '../sim/types.ts';
import { suiteScenarios } from '../traffic/scenario.ts';
import type { EtaParams, RegimeParams } from '../policies/eta.ts';
import type { Champion } from './champion.ts';
import { RegimeTrainer, gateInfo, passes } from './trainer.ts';
import { V0_SPEC, evalSpec, evalSpecs, gainPct, type Spec, type SpecEval } from './evaluate.ts';
import { EvalPool } from './pool.ts';
import { CHAMPION_FILE, appendLog, args, fmt, loadChampion, num, round, today, writeJson } from './io.ts';

const a = args();
const regimes: readonly Regime[] = !a.regime || a.regime === 'all' ? REGIMES : [a.regime as Regime];
if (regimes.some(r => !REGIMES.includes(r))) throw new Error(`--regime must be one of ${REGIMES.join('|')}|all`);
const gens = num(a, 'gens', 200), batch = num(a, 'batch', 48), seed = num(a, 'seed', 1);
const pop = num(a, 'pop', 14), every = num(a, 'check', 25), minutes = num(a, 'minutes', Infinity);
const printEvery = Math.max(1, Math.round(gens / 25));

const pool = new EvalPool(a.threads ? Number(a.threads) : undefined);
const ev = pool.run;
const existing = loadChampion();
const base: Spec = { heuristic: existing.heuristic, nn: null };
const heur: RegimeParams = { ...existing.heuristic };
const t0 = Date.now();
console.log(`train · regimes ${regimes.join(',')} · ${gens} gens × pop ${pop} × batch ${batch} · seed ${seed} · ${pool.size} threads · champion "${existing.trainedOn}"`);

const perRegime: NonNullable<Champion['perRegime']> = { ...existing.perRegime };
const runLog: Record<string, unknown> = {};
let anyPromoted = false;

for (const regime of regimes) {
  const val = suiteScenarios('validation', { regime });
  const [v0Val, exVal] = await evalSpecs(ev, [V0_SPEC, base], val);
  console.log(`\n[${regime}] validation ${val.length} scenarios · v0 ${fmt(v0Val.mean)} · champion ${fmt(exVal.mean)} (${fmt(gainPct(exVal.mean, v0Val.mean), 1)}%)`);
  const tr = new RegimeTrainer({ regime, base, seed: seed + REGIMES.indexOf(regime) * 1000, popSize: pop, batch });
  let ref: SpecEval = exVal, promoted: { params: EtaParams; val: SpecEval; gen: number } | null = null;
  const checks: { gen: number; score: number; gainPct: number; pass: boolean }[] = [];
  const tr0 = Date.now();
  for (let g = 1; g <= gens; g++) {
    const t = Date.now(), l = await tr.step(ev);
    if (g % printEvery === 0 || g === 1)
      console.log(`  g${String(g).padStart(4)} σ${fmt(l.sigma, 3)} best ${fmt(l.best, 3)} inc ${fmt(l.mean, 3)} (${l.gainPct >= 0 ? '+' : ''}${fmt(l.gainPct, 1)}% vs v0 ${fmt(l.v0, 1)}) ${fmt((Date.now() - t) / 1000)}s/gen`);
    const timeUp = (Date.now() - tr0) / 60000 > minutes;
    if (g % every === 0 || g === gens || timeUp) {
      const inc = tr.incumbent(), cand = await evalSpec(ev, tr.specFor(inc), val);
      const pass = passes(cand, ref) && passes(cand, v0Val);
      checks.push({ gen: g, score: round(cand.mean), gainPct: round(gainPct(cand.mean, v0Val.mean), 2), pass });
      console.log(`  ✓ check g${g}: incumbent ${fmt(cand.mean)} vs ref ${fmt(ref.mean)} / v0 ${fmt(v0Val.mean)} · ${gateInfo(cand, ref)} → ${pass ? 'PROMOTE' : 'keep'}`);
      if (pass) { promoted = { params: inc, val: cand, gen: g }; ref = cand; }
    }
    if (timeUp) { console.log(`  time budget reached at g${g}`); break; }
  }
  if (promoted) { heur[regime] = promoted.params; anyPromoted = true; }
  const fin = promoted?.val ?? exVal;
  perRegime[regime] = { score: round(fin.mean), baseline: round(v0Val.mean), gainPct: round(gainPct(fin.mean, v0Val.mean), 2) };
  console.log(`[${regime}] ${promoted ? `promoted (g${promoted.gen})` : 'no promotion'} · ${fmt(fin.mean)} vs v0 ${fmt(v0Val.mean)} (${fmt(gainPct(fin.mean, v0Val.mean), 1)}%)`);
  runLog[regime] = {
    curve: tr.log.map(l => ({ gen: l.gen, best: round(l.best, 3), mean: round(l.mean, 3), v0: round(l.v0, 3), gainPct: round(l.gainPct, 2), sigma: round(l.sigma, 4) })),
    checks, promoted: promoted ? { gen: promoted.gen, params: promoted.params } : null, validation: perRegime[regime],
  };
}

let written = false;
if (anyPromoted) {
  const all = suiteScenarios('validation');
  const [c, b] = await evalSpecs(ev, [{ heuristic: heur, nn: null }, V0_SPEC], all);
  const ch: Champion = {
    version: 1, kind: 'heuristic', heuristic: heur, nn: null,
    trainedOn: 'domain-randomised training scenarios · CMA-ES per regime', createdAt: today(),
    validation: { score: round(c.mean), baseline: round(b.mean), gainPct: round(gainPct(c.mean, b.mean), 2) }, perRegime,
  };
  writeJson(CHAMPION_FILE, ch); written = true;
  console.log(`\nwrote results/champion.json · full validation ${fmt(c.mean)} vs v0 ${fmt(b.mean)} (${fmt(ch.validation!.gainPct, 1)}%)`);
} else console.log('\nno regime beat the gate — results/champion.json unchanged');

appendLog({ kind: 'heuristic', createdAt: new Date().toISOString(), args: { regimes, gens, batch, pop, seed, every }, minutes: round((Date.now() - t0) / 60000, 2), written, regimes: runLog });
console.log(`done in ${fmt((Date.now() - t0) / 60000, 1)} min`);
await pool.close();
