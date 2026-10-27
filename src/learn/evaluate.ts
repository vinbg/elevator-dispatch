/* Serialisable policy specs + a pluggable batch evaluator, so the same trainer runs
   in-thread (browser worker, tests) or on a Node worker_threads pool (CLI). */
import type { Policy } from '../sim/sim.ts';
import { EtaPolicy, V0, allRegimes, type RegimeParams } from '../policies/eta.ts';
import { NnPolicy } from '../policies/nn.ts';
import { runScenario } from '../eval/run.ts';
import type { Scenario } from '../traffic/scenario.ts';
import type { NnWeights } from './champion.ts';

export interface Spec { heuristic: RegimeParams; nn: NnWeights | null }
export interface Job { spec: Spec; sc: Scenario }
export interface Res { score: number; p95: number }
export type Evaluator = (jobs: Job[]) => Promise<Res[]>;

export const V0_SPEC: Spec = { heuristic: allRegimes(V0), nn: null };

export const policyOf = (s: Spec): Policy => s.nn ? new NnPolicy(s.heuristic, s.nn, 'cand') : new EtaPolicy(s.heuristic, 'cand');

export function runJob(j: Job): Res {
  const m = runScenario(j.sc, policyOf(j.spec));
  return { score: m.score, p95: m.p95Wait };
}

export const localEvaluator: Evaluator = async jobs => jobs.map(runJob);

export interface SpecEval { scores: number[]; p95: number[]; mean: number }

/** several specs × the same scenarios (common random numbers) in one evaluator call */
export async function evalSpecs(ev: Evaluator, specs: readonly Spec[], scs: readonly Scenario[]): Promise<SpecEval[]> {
  const jobs: Job[] = [];
  for (const spec of specs) for (const sc of scs) jobs.push({ spec, sc });
  const r = await ev(jobs);
  return specs.map((_, k) => {
    const part = r.slice(k * scs.length, (k + 1) * scs.length);
    const scores = part.map(x => x.score);
    return { scores, p95: part.map(x => x.p95), mean: scores.reduce((a, b) => a + b, 0) / scores.length };
  });
}

export const evalSpec = async (ev: Evaluator, spec: Spec, scs: readonly Scenario[]) => (await evalSpecs(ev, [spec], scs))[0];

export const gainPct = (score: number, base: number) => base ? 100 * (base - score) / base : 0;
