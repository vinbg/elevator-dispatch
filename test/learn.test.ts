import { describe, expect, it } from 'vitest';
import { CMAES, jacobiEigen } from '../src/learn/cmaes.ts';
import { ES } from '../src/learn/es.ts';
import { RegimeTrainer } from '../src/learn/trainer.ts';
import { localEvaluator } from '../src/learn/evaluate.ts';
import { EtaPolicy, V0, allRegimes, fromUnit, type RegimeParams } from '../src/policies/eta.ts';
import { NnPolicy, initNn, nnParamCount, NN_LAYERS } from '../src/policies/nn.ts';
import { learnedPolicy } from '../src/policies/learned.ts';
import { runScenario } from '../src/eval/run.ts';
import { SUITE, simFor, suiteScenarios } from '../src/traffic/scenario.ts';
import type { FromWorker, ToWorker } from '../src/worker/protocol.ts';
import type { Policy } from '../src/sim/sim.ts';
import type { Champion } from '../src/learn/champion.ts';

function minimise(f: (x: number[]) => number, cma: CMAES, gens: number, target: number) {
  let best = Infinity;
  for (let g = 0; g < gens && best > target; g++) {
    const xs = cma.ask(), fx = xs.map(x => f(cma.feasible(x)));
    cma.tell(xs, fx); best = Math.min(best, ...fx);
  }
  return best;
}

describe('CMA-ES', () => {
  it('jacobi eigendecomposition reconstructs a symmetric matrix', () => {
    const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]], { d, V } = jacobiEigen(A);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0; for (let k = 0; k < 3; k++) s += V[i][k] * d[k] * V[j][k];
      expect(s).toBeCloseTo(A[i][j], 10);
    }
  });
  it('minimises a shifted sphere in 5D', () => {
    const c = [1, -2, 0.5, 3, -1], f = (x: number[]) => x.reduce((s, v, i) => s + (v - c[i]) ** 2, 0);
    expect(minimise(f, new CMAES({ x0: [0, 0, 0, 0, 0], sigma0: 1, seed: 3 }), 400, 1e-10)).toBeLessThan(1e-10);
  });
  it('minimises Rosenbrock in 5D', () => {
    const f = (x: number[]) => { let s = 0; for (let i = 0; i < x.length - 1; i++) s += 100 * (x[i + 1] - x[i] ** 2) ** 2 + (1 - x[i]) ** 2; return s; };
    const cma = new CMAES({ x0: [0, 0, 0, 0, 0], sigma0: 0.5, seed: 5 });
    expect(minimise(f, cma, 3000, 1e-8)).toBeLessThan(1e-8);
    for (const v of cma.best.x) expect(v).toBeCloseTo(1, 3);
  });
  it('respects the [0,1] box (optimum outside → converges onto the bound)', () => {
    const f = (x: number[]) => (x[0] - 1.5) ** 2 + (x[1] - 0.3) ** 2;
    const cma = new CMAES({ x0: [0.5, 0.5], sigma0: 0.2, seed: 1, bounds: [0, 1] });
    minimise(f, cma, 200, -1);
    expect(cma.best.x[0]).toBeCloseTo(1, 4);
    expect(cma.best.x[1]).toBeCloseTo(0.3, 3);
  });
});

describe('ES', () => {
  it('reduces a 50-D quadratic', () => {
    const c = Array.from({ length: 50 }, (_, i) => Math.sin(i)), f = (x: number[]) => x.reduce((s, v, i) => s + (v - c[i]) ** 2, 0);
    const es = new ES({ theta0: Array(50).fill(0), sigma: 0.1, pairs: 20, lr: 0.05, seed: 2 });
    const f0 = f(es.theta);
    for (let g = 0; g < 300; g++) es.tell(es.ask().map(f));
    expect(f(es.theta)).toBeLessThan(0.05 * f0);
  });
});

function trace(p: Policy, sc = suiteScenarios('validation', { regime: 'morning', buildings: ['default-block'], seeds: 1 })[0]) {
  const sim = simFor(sc, p), ev: string[] = [];
  sim.on(e => { if (e.type === 'assign') ev.push(`a${e.t.toFixed(1)}:${e.car}`); if (e.type === 'reassign') ev.push(`r${e.t.toFixed(1)}:${e.from}>${e.to}`); });
  sim.runUntil(sc.start + sc.duration);
  return { ev, served: sim.metrics.served, waits: sim.metrics.waits };
}

describe('NN residual policy', () => {
  const tuned: RegimeParams = { morning: fromUnit([0.3, 0.2, 0.4, 0.6, 0.3, 0.1, 0.2, 0.5, 0.25]), evening: V0, offpeak: V0 };
  it('zero-initialised output layer ⇒ exactly the heuristic (V0 and tuned params)', () => {
    for (const h of [allRegimes(V0), tuned]) {
      const a = trace(new EtaPolicy(h)), b = trace(new NnPolicy(h, initNn(7)));
      expect(b.ev).toEqual(a.ev);
      expect(b.waits).toEqual(a.waits);
      expect(b.served).toBe(a.served);
    }
    const sc = suiteScenarios('validation', { regime: 'evening', buildings: ['slim-12'], seeds: 1 })[0];
    expect(runScenario(sc, new NnPolicy(tuned, initNn(1)))).toEqual(runScenario(sc, new EtaPolicy(tuned)));
  });
  it('a non-zero residual changes decisions', () => {
    const nn = initNn(7), n = nnParamCount(NN_LAYERS);
    for (let i = n - 17; i < n; i++) nn.weights[i] = 3 * Math.sin(i);
    expect(trace(new NnPolicy(allRegimes(V0), nn)).ev).not.toEqual(trace(new EtaPolicy(allRegimes(V0))).ev);
  });
  it('learnedPolicy picks NN vs heuristic', () => {
    const ch: Champion = { version: 1, kind: 'heuristic', heuristic: tuned, nn: null, trainedOn: 't', createdAt: '2026-01-01' };
    expect(learnedPolicy(ch)).toBeInstanceOf(EtaPolicy);
    const nnCh: Champion = { ...ch, kind: 'nn', nn: initNn(2) };
    const p = learnedPolicy(nnCh);
    expect(p).toBeInstanceOf(NnPolicy);
    expect(trace(p).ev).toEqual(trace(learnedPolicy(ch)).ev);
  });
});

describe('trainer', () => {
  it('runs generations with common random numbers and seeds the exact start point', async () => {
    const tr = new RegimeTrainer({ regime: 'offpeak', base: { heuristic: allRegimes(V0), nn: null }, batch: 2, popSize: 6, durationSec: 300, seed: 4 });
    const g1 = await tr.step(localEvaluator);
    expect(g1.mean).toBe(0);                       // incumbent = exact V0 before the first update
    expect(g1.best).toBeLessThanOrEqual(0);        // candidate 0 is exact V0 too
    await tr.step(localEvaluator);
    expect(tr.log.length).toBe(2);
    expect(tr.incumbent().zoning).not.toBeNull();
  });
});

describe('learn.worker protocol', () => {
  it('posts progress per generation and honours pause / regime', async () => {
    const msgs: FromWorker[] = [];
    const fake: { postMessage(m: FromWorker): void; onmessage: ((e: { data: ToWorker }) => void) | null } = { postMessage: m => msgs.push(m), onmessage: null };
    const g = globalThis as unknown as { self: unknown }, prev = g.self;
    g.self = fake;
    try {
      await import('../src/worker/learn.worker.ts');
      const champion: Champion = { version: 1, kind: 'heuristic', heuristic: allRegimes(V0), nn: null, trainedOn: 't', createdAt: '2026-01-01' };
      const building = SUITE.buildings['walkup-6'];
      const send = (data: ToWorker) => fake.onmessage!({ data });
      const waitFor = async (pred: () => boolean) => { for (let i = 0; i < 400 && !pred(); i++) await new Promise(r => setTimeout(r, 25)); };
      send({ type: 'start', building, regime: 'evening', champion });
      await waitFor(() => msgs.filter(m => m.type === 'progress').length >= 2);
      send({ type: 'regime', regime: 'offpeak' });
      await waitFor(() => msgs.some(m => m.type === 'progress' && m.regime === 'offpeak'));
      send({ type: 'pause' });
      await new Promise(r => setTimeout(r, 300));
      const n = msgs.length;
      await new Promise(r => setTimeout(r, 300));
      expect(msgs.length).toBe(n);
      const p = msgs.filter(m => m.type === 'progress');
      expect(msgs.some(m => m.type === 'error')).toBe(false);
      const first = p[0] as Extract<FromWorker, { type: 'progress' }>;
      expect(first.regime).toBe('evening');
      expect(first.gen).toBe(1);
      expect(first.curve.length).toBe(1);
      expect(first.gainPct).toBeCloseTo(100 * (first.v0 - first.best) / first.v0, 6);
      expect(p.some(m => m.regime === 'offpeak')).toBe(true);
    } finally { g.self = prev; }
  });
});
