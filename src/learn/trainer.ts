/* Heuristic training for one regime: CMA-ES over the 9 unit-cube dims of EtaParams.
   Every generation evaluates all candidates — plus the distribution mean (the incumbent)
   and V0 as references — on the same batch of fresh training scenarios (common random numbers).
   Fitness = mean log(score / V0 score) per scenario, so saturated random buildings (scores in the
   hundreds) don't drown out ordinary ones.
   Promotion is decided elsewhere with beats() on held-out validation scenarios. */
import { Rng } from '../sim/rng.ts';
import type { BuildingConfig, Regime } from '../sim/types.ts';
import { fromUnit, toUnit, DIMS, type EtaParams } from '../policies/eta.ts';
import { trainingScenario, type Scenario } from '../traffic/scenario.ts';
import { beats, pairedBootstrap } from '../eval/stats.ts';
import { mean } from '../sim/metrics.ts';
import { CMAES } from './cmaes.ts';
import { V0_SPEC, evalSpecs, type Evaluator, type Spec, type SpecEval } from './evaluate.ts';

export interface GenLog {
  gen: number;
  best: number;      // best candidate's fitness on this batch (mean log-ratio vs V0; < 0 = better)
  mean: number;      // incumbent (distribution mean) fitness on this batch
  v0: number;        // V0 mean score on this batch (absolute)
  gainPct: number;   // incumbent vs V0 on this batch, % (geometric mean)
  sigma: number;
}

export interface TrainerOpts {
  regime: Regime;
  base: Spec;                 // champion the candidates slot into (other regimes / nn kept)
  start?: EtaParams;          // default: base.heuristic[regime]
  seed?: number;
  popSize?: number;
  batch?: number;
  sigma0?: number;
  building?: BuildingConfig;  // fixed building = "own building" fine-tuning
  durationSec?: number;       // shorten training windows (e.g. 1200 for the browser)
}

export class RegimeTrainer {
  readonly regime: Regime;
  readonly cma: CMAES;
  readonly log: GenLog[] = [];
  base: Spec;
  private rng: Rng;
  private start: EtaParams;
  private batch: number;

  constructor(private o: TrainerOpts) {
    this.regime = o.regime;
    this.base = o.base;
    this.start = o.start ?? o.base.heuristic[o.regime];
    this.rng = new Rng((o.seed ?? 1) * 2654435761 + 97);
    this.batch = o.batch ?? 24;
    this.cma = new CMAES({ x0: toUnit(this.start, DIMS.length), sigma0: o.sigma0 ?? 0.15, seed: o.seed ?? 1, popSize: o.popSize ?? 12, bounds: [0, 1], boundPenalty: 1 });
  }

  get gen() { return this.cma.gen; }
  /** the noise-robust incumbent: the CMA distribution mean (exact start params before the first update) */
  incumbent(): EtaParams { return this.cma.gen === 0 ? this.start : fromUnit(this.cma.feasible(this.cma.mean)); }
  specFor(p: EtaParams): Spec { return { heuristic: { ...this.base.heuristic, [this.regime]: p }, nn: this.base.nn }; }

  scenarios(n: number, rng = this.rng): Scenario[] {
    return Array.from({ length: n }, () => {
      const sc = trainingScenario(rng, this.regime, this.o.building);
      return this.o.durationSec ? { ...sc, duration: Math.min(sc.duration, this.o.durationSec) } : sc;
    });
  }

  async step(ev: Evaluator): Promise<GenLog> {
    const scs = this.scenarios(this.batch);
    const xs = this.cma.ask();
    const params = xs.map(x => fromUnit(this.cma.feasible(x)));
    if (this.cma.gen === 0) { xs[0] = toUnit(this.start, DIMS.length); params[0] = this.start; }   // exact start (e.g. V0, zoning null)
    const r = await evalSpecs(ev, [...params.map(p => this.specFor(p)), this.specFor(this.incumbent()), V0_SPEC], scs);
    const v0 = r[xs.length + 1], fit = r.map(e => logRatio(e, v0)), inc = fit[xs.length];
    this.cma.tell(xs, fit.slice(0, xs.length));
    const g: GenLog = { gen: this.cma.gen, best: Math.min(...fit.slice(0, xs.length)), mean: inc, v0: v0.mean, gainPct: 100 * (1 - Math.exp(inc)), sigma: this.cma.sigma };
    this.log.push(g);
    return g;
  }
}

/** mean per-scenario log(score / reference score) — scale-free fitness under common random numbers */
export function logRatio(e: SpecEval, ref: SpecEval): number {
  let s = 0; for (let i = 0; i < e.scores.length; i++) s += Math.log(Math.max(1e-6, e.scores[i]) / Math.max(1e-6, ref.scores[i]));
  return s / e.scores.length;
}

export const passes = (cand: SpecEval, ref: SpecEval) => beats(cand.scores, ref.scores, cand.p95, ref.p95);

/** one-line gate diagnostics: paired 95% CI of the score difference and mean p95 waits */
export function gateInfo(cand: SpecEval, ref: SpecEval): string {
  const b = pairedBootstrap(cand.scores, ref.scores);
  return `Δ ${b.meanDiff.toFixed(2)} [${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}] p95 ${mean(cand.p95).toFixed(1)}/${mean(ref.p95).toFixed(1)}`;
}
