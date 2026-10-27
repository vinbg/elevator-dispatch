/* In-browser learning: CMA-ES on the user's own building for the current regime.
   Short batches (8 × 20-min windows) keep a generation well under a second; after every generation
   the incumbent is scored on a fixed validation set (24 fixed seeds, own building, 30-min windows)
   and, when it passes beats() against the current champion, a new Champion is posted
   (only that regime's params replaced, nn kept). Yields between generations so control
   messages get through. No DOM APIs. */
import type { FromWorker, ToWorker } from './protocol.ts';
import type { BuildingConfig, Regime } from '../sim/types.ts';
import { REGIMES } from '../sim/types.ts';
import { Rng } from '../sim/rng.ts';
import type { Champion } from '../learn/champion.ts';
import { RegimeTrainer, passes } from '../learn/trainer.ts';
import { V0_SPEC, evalSpec, evalSpecs, gainPct, localEvaluator as ev, type Spec, type SpecEval } from '../learn/evaluate.ts';
import { trainingScenario, type Scenario } from '../traffic/scenario.ts';

const BATCH = 8, POP = 10, TRAIN_SEC = 1200, VAL_N = 24, VAL_SEC = 1800, CHECK_EVERY = 3;

interface RegimeState { tr: RegimeTrainer; val: Scenario[]; v0: SpecEval; champ: SpecEval; best: number; curve: number[]; cands: number[]; champs: number[]; promoted: number[] }

const ctx = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const post = (m: FromWorker) => ctx.postMessage(m);

let building: BuildingConfig | null = null;
let champion: Champion | null = null;
let regime: Regime = 'offpeak';
let paused = false;
let epoch = 0;            // bumps on start/reset so in-flight generations from old state are dropped
let loop = 0;
let simSec = 0;           // simulated traffic seconds, for the "hours practised" counter
const states = new Map<Regime, RegimeState>();

const specOf = (c: Champion): Spec => ({ heuristic: c.heuristic, nn: c.nn });

async function stateFor(r: Regime): Promise<RegimeState> {
  let s = states.get(r);
  if (s) return s;
  const tr = new RegimeTrainer({
    regime: r, base: specOf(champion!), building: building!, batch: BATCH, popSize: POP, sigma0: 0.12,
    durationSec: TRAIN_SEC, seed: 1 + REGIMES.indexOf(r),
  });
  const vr = new Rng(0xC0FFEE + REGIMES.indexOf(r));
  const val = Array.from({ length: VAL_N }, () => trainingScenario(vr, r, building!)).map(sc => ({ ...sc, duration: Math.min(sc.duration, VAL_SEC) }));
  const [v0, champ] = await evalSpecs(ev, [V0_SPEC, specOf(champion!)], val);
  simSec += 2 * VAL_N * VAL_SEC;
  s = { tr, val, v0, champ, best: champ.mean, curve: [], cands: [], champs: [], promoted: [] };
  states.set(r, s);
  return s;
}

async function generation(ep: number) {
  const r = regime, s = await stateFor(r);
  if (ep !== epoch) return;
  await s.tr.step(ev);
  const inc = s.tr.incumbent(), cand = await evalSpec(ev, s.tr.specFor(inc), s.val);
  if (ep !== epoch) return;
  simSec += (POP + 2) * BATCH * TRAIN_SEC + VAL_N * VAL_SEC;   // candidates + incumbent + v0 on the batch, then validation
  if (cand.mean < s.best) s.best = cand.mean;
  s.curve.push(s.best); s.cands.push(cand.mean);
  if (s.tr.gen % CHECK_EVERY === 0 && cand.mean < s.champ.mean && passes(cand, s.champ)) {
    const g = gainPct(cand.mean, s.v0.mean);
    champion = {
      ...champion!, heuristic: { ...champion!.heuristic, [r]: inc },
      trainedOn: 'own building · in-browser CMA-ES', createdAt: new Date().toISOString().slice(0, 10),
      validation: { score: cand.mean, baseline: s.v0.mean, gainPct: g },
      perRegime: { ...champion!.perRegime, [r]: { score: cand.mean, baseline: s.v0.mean, gainPct: g } },
    };
    s.champ = cand; s.promoted.push(s.tr.gen);
    for (const o of states.values()) o.tr.base = specOf(champion);
    post({ type: 'champion', champion, regime: r, gainPct: g });
  }
  s.champs.push(s.champ.mean);
  post({ type: 'progress', regime: r, gen: s.tr.gen, best: s.best, champion: s.champ.mean, v0: s.v0.mean, gainPct: gainPct(s.best, s.v0.mean),
    curve: [...s.curve], cands: [...s.cands], champs: [...s.champs], promoted: [...s.promoted], params: inc, simHours: simSec / 3600 });
}

function kick() {
  const id = ++loop;
  const tick = async () => {
    if (id !== loop || paused || !building || !champion) return;
    try { await generation(epoch); }
    catch (e) { post({ type: 'error', message: e instanceof Error ? e.message : String(e) }); paused = true; return; }
    if (id === loop) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
}

function restart(c: Champion) { champion = c; states.clear(); epoch++; }

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'start': building = m.building; regime = m.regime; paused = false; restart(m.champion); kick(); break;
    case 'regime': regime = m.regime; break;
    case 'pause': paused = true; loop++; break;
    case 'resume': if (paused) { paused = false; kick(); } break;
    case 'reset': restart(m.champion); if (!paused) kick(); break;
  }
};
