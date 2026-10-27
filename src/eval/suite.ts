/* The benchmark: which policies exist, running them on identical scenarios, and aggregating the results. */
import { existsSync, readFileSync } from 'node:fs';
import type { Policy } from '../sim/sim.ts';
import { mean } from '../sim/metrics.ts';
import { REGIMES, type Regime } from '../sim/types.ts';
import { naive } from '../policies/naive.ts';
import { EtaPolicy, V0, allRegimes } from '../policies/eta.ts';
import { learnedPolicy } from '../policies/learned.ts';
import type { Champion } from '../learn/champion.ts';
import type { Scenario } from '../traffic/scenario.ts';
import { runScenario, type RunMetrics } from './run.ts';
import { beats, pairedBootstrap } from './stats.ts';

export const POLICY_IDS = ['naive', 'v0', 'champion', 'nn'] as const;
export type PolicyId = typeof POLICY_IDS[number];
export const BASELINES = ['v0', 'naive'] as const satisfies readonly PolicyId[];

export const GATE_DOC = 'promote only if the paired 95% bootstrap CI of mean(score − baseline score) lies entirely below 0 and mean p95Wait is not worse';

export interface PolicySpec {
  id: PolicyId;
  label: string;
  make: () => Policy;        // fresh instance per scenario run (EtaPolicy caches zoning homes)
  info?: { source: string; kind: Champion['kind']; trainedOn: string; createdAt: string; sameAsV0: boolean; validation?: Champion['validation'] };
}

export const METRIC_KEYS = ['score', 'avgWait', 'p95Wait', 'maxWait', 'longWaitPct', 'avgTrip', 'avgJourney', 'throughput', 'energy', 'served', 'unserved'] as const satisfies readonly (keyof RunMetrics)[];
export type Agg = { n: number } & Record<keyof RunMetrics, number>;

export interface PolicyResult { spec: PolicySpec; runs: RunMetrics[] }   // runs[i] ↔ scenarios[i]

export interface Comparison {
  policy: PolicyId; baseline: PolicyId; n: number;
  candScore: number; baseScore: number;
  meanDiff: number; lo: number; hi: number; pct: number;   // pct = 100·meanDiff / baseScore
  p95Diff: number; beats: boolean;
}

/** read a champion file; null (with a reason) if missing or unreadable — training may be rewriting it */
export function loadChampion(path: string): { ch: Champion | null; why?: string } {
  if (!existsSync(path)) return { ch: null, why: `${path} not found` };
  try {
    const ch = JSON.parse(readFileSync(path, 'utf8')) as Champion;
    if (ch.version !== 1 || !ch.heuristic) return { ch: null, why: `${path}: not a v1 champion` };
    return { ch };
  } catch (e) { return { ch: null, why: `${path}: ${(e as Error).message}` }; }
}

const sameParams = (ch: Champion) => JSON.stringify(ch.heuristic) === JSON.stringify(allRegimes(V0)) && !ch.nn;

export function championSpec(id: 'champion' | 'nn', path: string): { spec: PolicySpec | null; why?: string } {
  const { ch, why } = loadChampion(path);
  if (!ch) return { spec: null, why };
  return {
    spec: {
      id, label: id === 'nn' ? 'NN champion' : 'champion', make: () => learnedPolicy(ch),
      info: { source: path, kind: ch.kind, trainedOn: ch.trainedOn, createdAt: ch.createdAt, sameAsV0: sameParams(ch), validation: ch.validation },
    },
  };
}

export const naiveSpec: PolicySpec = { id: 'naive', label: 'naive (nearest car)', make: () => naive };
export const v0Spec: PolicySpec = { id: 'v0', label: 'ETA v0', make: () => new EtaPolicy(allRegimes(V0), 'v0') };

export function runAll(scs: readonly Scenario[], specs: readonly PolicySpec[], onProgress?: (id: PolicyId, ms: number) => void): PolicyResult[] {
  return specs.map(spec => {
    const t0 = performance.now();
    const runs = scs.map(sc => runScenario(sc, spec.make()));
    onProgress?.(spec.id, performance.now() - t0);
    return { spec, runs };
  });
}

export const buildingOf = (sc: Scenario) => sc.id.slice(0, sc.id.indexOf('/'));

export function aggregate(runs: readonly RunMetrics[]): Agg {
  const a = { n: runs.length } as Agg;
  for (const k of METRIC_KEYS) a[k] = mean(runs.map(r => r[k]));
  return a;
}

export function breakdown(scs: readonly Scenario[], runs: readonly RunMetrics[]) {
  const pick = (f: (sc: Scenario) => boolean) => aggregate(runs.filter((_, i) => f(scs[i])));
  const byRegime = {} as Record<Regime, Agg>, byBuilding: Record<string, Agg> = {};
  for (const r of REGIMES) if (scs.some(s => s.regime === r)) byRegime[r] = pick(s => s.regime === r);
  for (const b of new Set(scs.map(buildingOf))) byBuilding[b] = pick(s => buildingOf(s) === b);
  return { overall: aggregate(runs), byRegime, byBuilding };
}

export function compare(cand: PolicyResult, base: PolicyResult): Comparison {
  const cs = cand.runs.map(r => r.score), bs = base.runs.map(r => r.score);
  const cp = cand.runs.map(r => r.p95Wait), bp = base.runs.map(r => r.p95Wait);
  const { meanDiff, lo, hi, n } = pairedBootstrap(cs, bs);
  const baseScore = mean(bs);
  return {
    policy: cand.spec.id, baseline: base.spec.id, n, candScore: mean(cs), baseScore,
    meanDiff, lo, hi, pct: baseScore ? 100 * meanDiff / baseScore : 0, p95Diff: mean(cp) - mean(bp), beats: beats(cs, bs, cp, bp),
  };
}

/** every policy vs each baseline that ran (never vs itself) */
export function comparisons(results: readonly PolicyResult[]): Comparison[] {
  const out: Comparison[] = [];
  for (const b of BASELINES) {
    const base = results.find(r => r.spec.id === b);
    if (base) for (const r of results) if (r !== base) out.push(compare(r, base));
  }
  return out;
}
