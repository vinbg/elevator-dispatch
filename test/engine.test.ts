import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng.ts';
import { Sim } from '../src/sim/sim.ts';
import { DayTraffic, designPeak } from '../src/traffic/traffic.ts';
import { SUITE, suiteScenarios, randomBuilding, simFor } from '../src/traffic/scenario.ts';
import { EtaPolicy, V0, allRegimes, zoneHomes, fromUnit, toUnit, DIMS } from '../src/policies/eta.ts';
import { runScenario } from '../src/eval/run.ts';

const v0 = () => new EtaPolicy(allRegimes(V0), 'v0');

describe('rng', () => {
  it('replays a seed exactly and differs across seeds', () => {
    const a = new Rng(7), b = new Rng(7), c = new Rng(8);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(c.next()).not.toBe(xs[0]);
  });
  it('poisson has the right mean', () => {
    const r = new Rng(1); let s = 0; const N = 20000;
    for (let i = 0; i < N; i++) s += r.poisson(0.3);
    expect(s / N).toBeCloseTo(0.3, 1);
  });
});

describe('engine', () => {
  const sc = suiteScenarios('test', { seeds: 1, buildings: ['default-block'] })[0];
  it('same scenario + seed → identical run', () => {
    expect(runScenario(sc, v0())).toEqual(runScenario(sc, v0()));
  });
  it('different seed → different run', () => {
    expect(runScenario({ ...sc, seed: sc.seed + 1 }, v0()).served).not.toBe(runScenario(sc, v0()).served);
  });
  it('conserves passengers: spawned = served + riding + waiting', () => {
    const sim = simFor(sc, v0()); sim.runUntil(sc.start + sc.duration);
    const riding = sim.cars.reduce((s, c) => s + c.pax.length, 0);
    const waiting = sim.hallCalls.reduce((s, h) => s + h.pax.length, 0);
    expect(sim.metrics.spawned).toBe(sim.metrics.served + riding + waiting);
  });
  it('cars stay inside the shaft and never exceed capacity', () => {
    const b = SUITE.buildings['tower-40'];
    const sim = simFor({ ...sc, building: b }, v0());
    for (let t = 0; t < 3000; t++) {
      sim.tick(0.1);
      for (const c of sim.cars) {
        expect(c.pos).toBeGreaterThanOrEqual(-1e-9); expect(c.pos).toBeLessThanOrEqual(sim.levels - 1 + 1e-9);
        expect(c.pax.length).toBeLessThanOrEqual(c.cap);
      }
    }
  });
  it('advance() accumulates partial steps', () => {
    const sim = new Sim(SUITE.buildings['walkup-6'], { policy: v0() });
    for (let i = 0; i < 25; i++) sim.advance(0.04);
    expect(sim.t).toBeCloseTo(1.0, 6);
  });
});

describe('traffic', () => {
  const b = SUITE.buildings['default-block'];
  it('generated people per minute follows the day curve', () => {
    const spec = { day: 'weekday' as const, groups: true };
    const start = 8 * 3600, dur = 3600;
    const tr = new DayTraffic(spec, b, new Rng(3), start, dur);
    const sim = new Sim(b, { policy: v0(), traffic: tr, startT: start, seed: 3 });
    sim.runUntil(start + dur);
    let expected = 0; for (let t = start; t < start + dur; t += 1) expected += tr.baseRate(t) / 60;
    expect(sim.metrics.spawned / expected).toBeGreaterThan(0.85);
    expect(sim.metrics.spawned / expected).toBeLessThan(1.15);
  });
  it('design peak ≈ 1.2% of residents per minute', () => { expect(designPeak(460)).toBe(6); });
  it('regimes follow the time of day', () => {
    const tr = new DayTraffic({ day: 'weekday' }, b, new Rng(1), 0, 86400);
    expect(tr.regime(8 * 3600)).toBe('morning');
    expect(tr.regime(18.5 * 3600)).toBe('evening');
    expect(tr.regime(14 * 3600)).toBe('offpeak');
  });
  it('random buildings are valid', () => {
    const r = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const rb = randomBuilding(r);
      expect(rb.elevators.length).toBeGreaterThan(0);
      for (const e of rb.elevators) expect(e.home).toBeLessThanOrEqual(rb.floorsAbove);
    }
  });
});

describe('eta params', () => {
  it('unit-vector round trip', () => {
    const p = fromUnit(DIMS.map(() => 0.37));
    const back = fromUnit(toUnit(p, DIMS.length));
    expect(back.wFill).toBeCloseTo(p.wFill, 9);
    expect(back.zoning!.spread).toBeCloseTo(p.zoning!.spread, 9);
  });
  it('zoning spreads homes over the building', () => {
    const h = zoneHomes({ lobbyShare: 0.5, spread: 0.5 }, 4, 1, 18);
    expect(h.slice(0, 2)).toEqual([1, 1]);
    expect(h[2]).toBeGreaterThan(1); expect(h[3]).toBeGreaterThan(h[2]); expect(h[3]).toBeLessThanOrEqual(17);
  });
});

describe('liveness (regression: legacy door-reopen freeze)', () => {
  it('no car is stuck with doors open and no idle car sits on an assigned call', () => {
    for (const sc of suiteScenarios('validation', { regime: 'morning' })) {
      const sim = simFor(sc, v0());
      const doors = new Map<number, number>(), idle = new Map<number, number>();
      let worstDoors = 0, worstIdle = 0;
      while (sim.t < sc.start + sc.duration) {
        sim.tick(0.1);
        for (const c of sim.cars) {
          if (c.phase === 'doors') { if (!doors.has(c.id)) doors.set(c.id, sim.t); worstDoors = Math.max(worstDoors, sim.t - doors.get(c.id)!); } else doors.delete(c.id);
          const owed = c.phase === 'idle' && (c.carCalls.size > 0 || sim.hallCalls.some(h => h.assigned === c.id));
          if (owed) { if (!idle.has(c.id)) idle.set(c.id, sim.t); worstIdle = Math.max(worstIdle, sim.t - idle.get(c.id)!); } else idle.delete(c.id);
        }
      }
      expect(worstDoors, sc.id).toBeLessThan(60);
      expect(worstIdle, sc.id).toBeLessThan(5);
    }
  });
});
