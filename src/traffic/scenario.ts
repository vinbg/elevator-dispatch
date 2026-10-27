/* A scenario = building + traffic window + seed. Everything needed to replay a run exactly. */
import suiteJson from '../../scenarios/suite.json';
import { Rng } from '../sim/rng.ts';
import { Sim, type Policy } from '../sim/sim.ts';
import type { BuildingConfig, Regime } from '../sim/types.ts';
import { DayTraffic, type DayKind, type DaySpec } from './traffic.ts';

export interface Scenario {
  id: string;            // building/window#seed
  building: BuildingConfig;
  traffic: DaySpec;
  start: number;         // seconds since midnight
  duration: number;      // seconds
  seed: number;
  regime: Regime;
}

interface WindowDef { day: DayKind; start: string; minutes: number; regime: Regime; rateScale?: number }
export interface SuiteDef {
  buildings: Record<string, BuildingConfig & { note?: string }>;
  windows: Record<string, WindowDef>;
  traffic: { groups: boolean; surgesPerHour: number; floorJitter: number };
  seeds: { test: [number, number]; validation: [number, number] };
}
export const SUITE = suiteJson as unknown as SuiteDef;

const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };
const seedRange = ([a, b]: [number, number]) => Array.from({ length: b - a }, (_, i) => a + i);

/** residential-floor population jitter, fixed per (building, seed) */
export function floorWeights(b: BuildingConfig, seed: number, jitter: number): number[] {
  const rng = new Rng(seed * 104729 + 7);
  return Array.from({ length: Math.max(0, b.floorsAbove - 1) }, () => Math.exp(jitter * rng.normal()));
}

export function makeScenario(buildingId: string, b: BuildingConfig, windowId: string, w: WindowDef, seed: number, suite = SUITE): Scenario {
  return {
    id: `${buildingId}/${windowId}#${seed}`, building: b, seed, regime: w.regime,
    start: hhmm(w.start), duration: w.minutes * 60,
    traffic: {
      day: w.day, rateScale: w.rateScale ?? 1, groups: suite.traffic.groups, surgesPerHour: suite.traffic.surgesPerHour,
      floorWeights: floorWeights(b, seed, suite.traffic.floorJitter),
    },
  };
}

export type SplitName = 'test' | 'validation';

/** the fixed benchmark grid: every building × window × seed of a split */
export function suiteScenarios(split: SplitName, opts: { seeds?: number; regime?: Regime; buildings?: string[] } = {}, suite = SUITE): Scenario[] {
  const seeds = seedRange(suite.seeds[split]).slice(0, opts.seeds ?? Infinity);
  const out: Scenario[] = [];
  for (const [bid, b] of Object.entries(suite.buildings)) {
    if (opts.buildings && !opts.buildings.includes(bid)) continue;
    for (const [wid, w] of Object.entries(suite.windows)) {
      if (opts.regime && w.regime !== opts.regime) continue;
      for (const s of seeds) out.push(makeScenario(bid, b, wid, w, s, suite));
    }
  }
  return out;
}

/* ───── domain randomisation for training ───── */

export function randomBuilding(rng: Rng): BuildingConfig {
  const floorsAbove = rng.int(5, 44), parking = rng.int(0, 3);
  const apartments = Math.round(floorsAbove * rng.range(5, 18));
  const residents = Math.round(apartments * rng.range(1.7, 2.6));
  const n = Math.max(1, Math.min(10, Math.round(residents / rng.range(140, 260))));
  const caps = [6, 8, 10, 12, 13, 16, 21];
  const elevators = Array.from({ length: n }, (_, i) => ({
    cap: caps[rng.int(0, caps.length - 1)],
    home: i < Math.ceil(n / 2) ? 1 : 1 + Math.round((floorsAbove - 1) * (i - Math.ceil(n / 2) + 1) / (n - Math.ceil(n / 2) + 1)),
  }));
  return {
    floorsAbove, parking, apartments, residents, elevators,
    secPerFloor: +rng.range(0.9, 2.2).toFixed(2), doorTime: +rng.range(1.5, 4).toFixed(1),
    hold: +rng.range(1.5, 3).toFixed(1), boardTime: +rng.range(0.3, 0.9).toFixed(2),
  };
}

/** a training scenario for one regime: a random building (or a fixed one) and a random seed */
export function trainingScenario(rng: Rng, regime: Regime, building?: BuildingConfig, suite = SUITE): Scenario {
  const wins = Object.entries(suite.windows).filter(([, w]) => w.regime === regime);
  const [wid, w] = wins[rng.int(0, wins.length - 1)];
  const seed = rng.int(10_000, 2_000_000_000);
  const b = building ?? randomBuilding(rng);
  return makeScenario(building ? 'own' : 'random', b, wid, w, seed, suite);
}

export function simFor(sc: Scenario, policy: Policy): Sim {
  const traffic = new DayTraffic(sc.traffic, sc.building, new Rng(sc.seed * 7919 + 13), sc.start, sc.duration);
  return new Sim(sc.building, { policy, seed: sc.seed, traffic, startT: sc.start });
}
