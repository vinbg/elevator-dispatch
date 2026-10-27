/* Paired comparisons on identical (scenario, seed) runs. */
import { Rng } from '../sim/rng.ts';
import { mean } from '../sim/metrics.ts';

export interface PairedResult { meanDiff: number; lo: number; hi: number; n: number }

/** bootstrap 95% CI of mean(candidate − baseline); negative = candidate scores lower (better) */
export function pairedBootstrap(cand: readonly number[], base: readonly number[], iters = 2000, seed = 42): PairedResult {
  const d = cand.map((c, i) => c - base[i]);
  const rng = new Rng(seed), n = d.length, means: number[] = [];
  for (let k = 0; k < iters; k++) { let s = 0; for (let i = 0; i < n; i++) s += d[rng.int(0, n - 1)]; means.push(s / n); }
  means.sort((a, b) => a - b);
  return { meanDiff: mean(d), lo: means[Math.floor(iters * 0.025)], hi: means[Math.floor(iters * 0.975)], n };
}

/** promotion gate: score better with 95% confidence and mean p95 wait not worse */
export function beats(candScore: number[], baseScore: number[], candP95: number[], baseP95: number[]): boolean {
  const s = pairedBootstrap(candScore, baseScore);
  return s.hi < 0 && mean(candP95) <= mean(baseP95) + 1e-9;
}
