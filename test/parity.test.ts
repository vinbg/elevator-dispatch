/* Phase-1 gate: the extracted engine + eta-v0 / naive policies behave exactly like the original page.
   1. Exact replay — the same arrival trace into legacy/v0.html (jsdom) and into the engine must
      produce the same per-passenger waits and trips. No randomness is left on either side.
      The engine runs with legacyDoorFreeze so it reproduces the legacy freeze bug too; the fix
      (default) is covered by the liveness test in engine.test.ts.
   2. Statistical (slow, PARITY=1) — each side with its own random traffic, compared over seeds. */
import { describe, expect, it } from 'vitest';
import { replayLegacy, runLegacy, type Arrival } from './legacy-harness.ts';
import { Sim } from '../src/sim/sim.ts';
import { Rng } from '../src/sim/rng.ts';
import { mean } from '../src/sim/metrics.ts';
import { ConstantTraffic, drawOD, floorPicker, type Pattern } from '../src/traffic/traffic.ts';
import { EtaPolicy, V0, allRegimes } from '../src/policies/eta.ts';
import { naive } from '../src/policies/naive.ts';
import type { BuildingConfig } from '../src/sim/types.ts';

const LEGACY_DEFAULT: BuildingConfig = {
  floorsAbove: 17, parking: 1, apartments: 230, residents: 460, secPerFloor: 1.5, doorTime: 2, hold: 2,
  elevators: [{ cap: 8, home: 1 }, { cap: 12, home: 1 }, { cap: 12, home: 9 }, { cap: 8, home: 14 }],
};
const LEVELS = LEGACY_DEFAULT.parking + LEGACY_DEFAULT.floorsAbove, LOBBY = LEGACY_DEFAULT.parking;
const policyFor = (algo: 'smart' | 'naive') => algo === 'smart' ? new EtaPolicy(allRegimes(V0), 'v0') : naive;

function trace(seed: number, pattern: Pattern, ratePerMin: number, frames: number): Arrival[] {
  const rng = new Rng(seed), f = floorPicker(LOBBY, LEVELS), out: Arrival[] = [];
  for (let k = 1; k <= frames; k++)
    for (let n = rng.poisson(ratePerMin / 60 * 0.1); n > 0; n--) {
      const [o, d] = drawOD(rng, pattern, f);
      if (o !== d) out.push({ frame: k, o, d });
    }
  return out;
}

function replayEngine(algo: 'smart' | 'naive', tr: Arrival[], frames: number) {
  const sim = new Sim(LEGACY_DEFAULT, { policy: policyFor(algo), legacyDoorFreeze: true });
  let i = 0;
  for (let k = 1; k <= frames; k++) {
    while (i < tr.length && tr[i].frame === k) { sim.addPassenger(tr[i].o, tr[i].d); i++; }
    sim.tick(0.1);
  }
  return { waits: sim.metrics.waits, trips: sim.metrics.trips };
}

describe('exact replay vs legacy/v0.html', () => {
  const FRAMES = 6000; // 10 simulated minutes
  for (const algo of ['smart', 'naive'] as const)
    for (const [pattern, rate] of [['mixed', 8], ['morning', 12], ['evening', 12]] as const)
      it(`${algo} / ${pattern} @ ${rate} p/min`, () => {
        const tr = trace(77, pattern, rate, FRAMES);
        const old = replayLegacy(algo, tr, FRAMES), neu = replayEngine(algo, tr, FRAMES);
        expect(old.waits.length).toBeGreaterThan(30);
        expect(neu.waits.length).toBe(old.waits.length);
        neu.waits.forEach((w, j) => expect(w).toBeCloseTo(old.waits[j], 6));
        neu.trips.forEach((t, j) => expect(t).toBeCloseTo(old.trips[j], 6));
      });
});

/* ───── statistical check with independent random traffic (slow) ───── */

const SEEDS = 12, SECONDS = 1200, RATE = 10;

function runEngine(seed: number, algo: 'smart' | 'naive', pattern: Pattern) {
  const traffic = new ConstantTraffic(RATE, pattern, LOBBY, LEVELS);
  const sim = new Sim(LEGACY_DEFAULT, { policy: policyFor(algo), seed, traffic, legacyDoorFreeze: true });
  for (let k = 0; k < 5; k++) traffic.spawn(sim);    // legacy generate() seeds 5 passengers for 4 cars
  sim.runUntil(SECONDS);
  return { waits: sim.metrics.waits, served: sim.metrics.served };
}

const se = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1) / a.length);

// slow (~3 min of jsdom) — run with `npm run test:parity`
describe.skipIf(!process.env.PARITY)('statistical parity with legacy/v0.html', () => {
  for (const algo of ['smart', 'naive'] as const)
    for (const pattern of ['mixed', 'morning', 'evening'] as const)
      it(`${algo} / ${pattern}`, () => {
        const old = Array.from({ length: SEEDS }, (_, i) => runLegacy({ seed: 500 + i, algo, pattern, rate: RATE, seconds: SECONDS }));
        const neu = Array.from({ length: SEEDS }, (_, i) => runEngine(900 + i, algo, pattern));
        const wOld = old.map(r => mean(r.waits)), wNew = neu.map(r => mean(r.waits));
        const sOld = old.map(r => r.served), sNew = neu.map(r => r.served);
        const tolW = 3 * Math.hypot(se(wOld), se(wNew)) + 0.3;
        const tolS = 3 * Math.hypot(se(sOld), se(sNew)) + 2;
        console.log(`${algo}/${pattern}: wait legacy ${mean(wOld).toFixed(2)} vs engine ${mean(wNew).toFixed(2)} (±${tolW.toFixed(2)}) · served ${mean(sOld).toFixed(0)} vs ${mean(sNew).toFixed(0)}`);
        expect(Math.abs(mean(wOld) - mean(wNew))).toBeLessThan(tolW);
        expect(Math.abs(mean(sOld) - mean(sNew))).toBeLessThan(tolS);
      });
});
