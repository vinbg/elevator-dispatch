/* npm run train:nn -- --gens N --pop P --batch M --seed S
     [--sigma 0.03] [--lr 0.01] [--wd 0] [--check K] [--minutes T] [--threads N]
   OpenAI-ES on the NN residual weights over domain-randomised scenarios from all regimes,
   on top of the heuristic in results/champion.json. Fitness = mean log(score / heuristic score)
   on a shared batch (common random numbers). Every K gens and at the end θ is gated on the full
   validation split against that heuristic champion; results/nn-champion.json is written only if it passes. */
import { REGIMES } from '../sim/types.ts';
import { Rng } from '../sim/rng.ts';
import { suiteScenarios, trainingScenario } from '../traffic/scenario.ts';
import type { Champion, NnWeights } from './champion.ts';
import { ES } from './es.ts';
import { NN_LAYERS, NN_SCALE, initNn } from '../policies/nn.ts';
import { gateInfo, logRatio, passes } from './trainer.ts';
import { V0_SPEC, evalSpec, evalSpecs, gainPct, type Spec, type SpecEval } from './evaluate.ts';
import { EvalPool } from './pool.ts';
import { NN_CHAMPION_FILE, appendLog, args, fmt, loadChampion, num, round, today, writeJson } from './io.ts';

const a = args();
const gens = num(a, 'gens', 400), pop = num(a, 'pop', 24), batch = num(a, 'batch', 24), seed = num(a, 'seed', 1);
const every = num(a, 'check', 50), minutes = num(a, 'minutes', Infinity);
const printEvery = Math.max(1, Math.round(gens / 40));

const pool = new EvalPool(a.threads ? Number(a.threads) : undefined), ev = pool.run;
const heur = loadChampion();
const base: Spec = { heuristic: heur.heuristic, nn: null };
const init = initNn(seed);
const es = new ES({ theta0: init.weights, sigma: num(a, 'sigma', 0.03), pairs: Math.max(1, Math.floor(pop / 2)), lr: num(a, 'lr', 0.01), weightDecay: num(a, 'wd', 0), seed });
const nnOf = (w: number[]): NnWeights => ({ layers: [...NN_LAYERS], weights: w, margin: 0, scale: NN_SCALE });
const specOf = (w: number[]): Spec => ({ heuristic: heur.heuristic, nn: nnOf(w) });
const rng = new Rng(seed * 7477 + 3);
const t0 = Date.now();

const val = suiteScenarios('validation');
const [v0Val, hVal] = await evalSpecs(ev, [V0_SPEC, base], val);
console.log(`train:nn · ${gens} gens × pop ${es.pairs * 2} × batch ${batch} · ${init.weights.length} weights · ${pool.size} threads`);
console.log(`base heuristic "${heur.trainedOn}" · validation ${val.length} · v0 ${fmt(v0Val.mean)} · heuristic ${fmt(hVal.mean)} (${fmt(gainPct(hVal.mean, v0Val.mean), 1)}%)`);

const curve: { gen: number; best: number; theta: number; gainPct: number }[] = [];
const checks: { gen: number; score: number; vsHeuristicPct: number; pass: boolean }[] = [];
let ref: SpecEval = hVal, promoted: { w: number[]; val: SpecEval; gen: number } | null = null;

for (let g = 1; g <= gens; g++) {
  const t = Date.now();
  const scs = Array.from({ length: batch }, () => trainingScenario(rng, REGIMES[rng.int(0, REGIMES.length - 1)]));
  const cands = es.ask();
  const r = await evalSpecs(ev, [...cands.map(specOf), specOf(es.theta), base], scs);
  const h = r[r.length - 1], fit = r.map(e => logRatio(e, h));
  const th = fit[cands.length];
  es.tell(fit.slice(0, cands.length));
  curve.push({ gen: g, best: round(Math.min(...fit.slice(0, cands.length)), 4), theta: round(th, 4), gainPct: round(100 * (1 - Math.exp(th)), 2) });
  if (g % printEvery === 0 || g === 1)
    console.log(`  g${String(g).padStart(4)} best ${fmt(Math.min(...fit.slice(0, cands.length)), 3)} θ ${fmt(th, 3)} (${fmt(100 * (1 - Math.exp(th)), 1)}% vs heuristic) ${fmt((Date.now() - t) / 1000)}s/gen`);
  const timeUp = (Date.now() - t0) / 60000 > minutes;
  if (g % every === 0 || g === gens || timeUp) {
    const w = [...es.theta], cand = await evalSpec(ev, specOf(w), val);
    const pass = passes(cand, hVal) && passes(cand, ref);
    checks.push({ gen: g, score: round(cand.mean), vsHeuristicPct: round(gainPct(cand.mean, hVal.mean), 2), pass });
    console.log(`  ✓ check g${g}: nn ${fmt(cand.mean)} vs heuristic ${fmt(hVal.mean)} · ${gateInfo(cand, hVal)} → ${pass ? 'PROMOTE' : 'keep'}`);
    if (pass) { promoted = { w, val: cand, gen: g }; ref = cand; }
  }
  if (timeUp) { console.log(`  time budget reached at g${g}`); break; }
}

let written = false;
if (promoted) {
  const c = promoted.val;
  const ch: Champion = {
    version: 1, kind: 'nn', heuristic: heur.heuristic, nn: nnOf(promoted.w),
    trainedOn: 'domain-randomised training scenarios, all regimes · OpenAI-ES residual on the tuned heuristic', createdAt: today(),
    validation: { score: round(c.mean), baseline: round(v0Val.mean), gainPct: round(gainPct(c.mean, v0Val.mean), 2) },
  };
  writeJson(NN_CHAMPION_FILE, ch); written = true;
  console.log(`\nwrote results/nn-champion.json · ${fmt(c.mean)} vs heuristic ${fmt(hVal.mean)} (${fmt(gainPct(c.mean, hVal.mean), 1)}%) · vs v0 ${fmt(v0Val.mean)} (${fmt(ch.validation!.gainPct, 1)}%)`);
} else console.log(`\nNN did not beat the tuned heuristic under the gate — results/nn-champion.json not written`);

appendLog({
  kind: 'nn', createdAt: new Date().toISOString(), args: { gens, pop: es.pairs * 2, batch, seed, sigma: es.sigma, lr: es.lr, every },
  minutes: round((Date.now() - t0) / 60000, 2), written, heuristic: round(hVal.mean), v0: round(v0Val.mean), curve, checks,
  promoted: promoted ? { gen: promoted.gen, score: round(promoted.val.mean) } : null,
});
console.log(`done in ${fmt((Date.now() - t0) / 60000, 1)} min`);
await pool.close();
