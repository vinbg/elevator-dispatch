/* Eval harness: runs are reproducible, the baselines order as expected, and the paired bootstrap behaves. */
import { describe, expect, it } from 'vitest';
import { suiteScenarios } from '../src/traffic/scenario.ts';
import { runScenario } from '../src/eval/run.ts';
import { beats, pairedBootstrap } from '../src/eval/stats.ts';
import { naiveSpec, runAll, v0Spec, comparisons } from '../src/eval/suite.ts';
import { leaderboard, renderMarkdown } from '../src/eval/report.ts';
import { mean } from '../src/sim/metrics.ts';

describe('eval harness', () => {
  it('is deterministic: same scenario + fresh policy → identical metrics', () => {
    for (const sc of suiteScenarios('test', { seeds: 1, buildings: ['default-block', 'tower-40'] }).slice(0, 4))
      expect(runScenario(sc, v0Spec.make())).toEqual(runScenario(sc, v0Spec.make()));
  });

  it('v0 has a lower mean score than naive on a 2-seed slice, significantly', () => {
    const scs = suiteScenarios('test', { seeds: 2 });
    const res = runAll(scs, [naiveSpec, v0Spec]);
    const [nv, v0] = res.map(r => mean(r.runs.map(m => m.score)));
    expect(v0).toBeLessThan(nv);
    const c = comparisons(res).find(x => x.policy === 'v0' && x.baseline === 'naive')!;
    expect(c.hi).toBeLessThan(0);
    const lb = leaderboard(scs, res, 'test', [1000, 1020]);
    expect(lb.policies.map(p => p.id)).toEqual(['v0', 'naive']);
    expect(lb.meta.scenarios).toBe(scs.length);
    expect(renderMarkdown(lb)).toContain('| 1 | `v0` |');
  });

  it('pairedBootstrap: identical arrays → CI contains 0', () => {
    const a = Array.from({ length: 50 }, (_, i) => 10 + Math.sin(i) * 3);
    const r = pairedBootstrap(a, a);
    expect(r.lo).toBeLessThanOrEqual(0);
    expect(r.hi).toBeGreaterThanOrEqual(0);
    expect(r.n).toBe(50);
    expect(beats(a, a, a, a)).toBe(false);
  });

  it('pairedBootstrap: clearly lower candidate → hi < 0', () => {
    const base = Array.from({ length: 50 }, (_, i) => 20 + Math.cos(i) * 4);
    const cand = base.map((b, i) => b - 2 + Math.sin(i * 1.7) * 0.5);
    const r = pairedBootstrap(cand, base);
    expect(r.meanDiff).toBeLessThan(0);
    expect(r.hi).toBeLessThan(0);
    expect(beats(cand, base, cand, base)).toBe(true);
  });
});
