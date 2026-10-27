/* Passenger demand.
   - ConstantTraffic: the original prototype's model (fixed rate + one of three OD mixes),
     still driven by the live UI's slider and "time of day" toggle.
   - DayTraffic: a 24-hour non-homogeneous Poisson model — demand curve scaled by residents,
     OD mix shifting through the day, per-floor populations, groups, random surges. */
import type { Rng } from '../sim/rng.ts';
import type { Sim, TrafficSource } from '../sim/sim.ts';
import type { BuildingConfig, Regime } from '../sim/types.ts';

export type Pattern = 'mixed' | 'morning' | 'evening';
export const patternRegime = (p: Pattern): Regime => p === 'mixed' ? 'offpeak' : p;

/** ≈1.2% of residents per minute — the residential design peak */
export const designPeak = (residents: number) => Math.max(1, Math.round(residents * 0.012));

/* ───── origin/destination draws (legacy spawnPattern, generalised to floor weights) ───── */

export interface FloorPicker { upper(rng: Rng): number; parking(rng: Rng): number; lobby: number; hasPark: boolean }

export function floorPicker(lobby: number, levels: number, weights?: readonly number[]): FloorPicker {
  const lo = lobby + 1, hi = levels - 1;
  return {
    lobby, hasPark: lobby > 0,
    upper: rng => lo > hi ? lobby : weights && weights.length === hi - lo + 1 ? lo + rng.weighted(weights) : rng.int(lo, hi),
    parking: rng => lobby > 0 ? rng.int(0, lobby - 1) : lobby,
  };
}

export function drawOD(rng: Rng, pattern: Pattern, f: FloorPicker, parkShare = 1): [number, number] {
  let o: number, d: number; const r = rng.next(); const L = f.lobby;
  if (pattern === 'morning') {
    if (r < 0.72) { o = f.upper(rng); d = (f.hasPark && rng.chance(0.22 * parkShare)) ? f.parking(rng) : L; }
    else if (r < 0.84) { o = L; d = f.upper(rng); }
    else { o = f.upper(rng); d = f.upper(rng); }
  } else if (pattern === 'evening') {
    if (r < 0.60) { o = L; d = f.upper(rng); }
    else if (r < 0.76) { o = f.hasPark ? f.parking(rng) : L; d = f.upper(rng); }
    else { o = f.upper(rng); d = rng.chance(0.7) ? L : f.upper(rng); }
  } else {
    if (r < 0.28) { o = L; d = f.upper(rng); }
    else if (r < 0.36) { o = f.hasPark ? f.parking(rng) : L; d = f.upper(rng); }
    else { o = f.upper(rng); d = rng.chance(0.55) ? L : (f.hasPark && rng.chance(0.12) ? f.parking(rng) : f.upper(rng)); }
  }
  return [o, d];
}

export class ConstantTraffic implements TrafficSource {
  private f: FloorPicker;
  constructor(public ratePerMin: number, public pattern: Pattern, lobby: number, levels: number) {
    this.f = floorPicker(lobby, levels);
  }
  rate() { return this.ratePerMin; }
  regime() { return patternRegime(this.pattern); }
  spawn(sim: Sim) {
    const [o, d] = drawOD(sim.rng, this.pattern, this.f);
    if (o !== d) sim.addPassenger(o, d);
  }
}

/* ───── 24-hour model ───── */

export type DayKind = 'weekday' | 'weekend';

/* demand as a multiple of the design peak, one value per hour (linearly interpolated) */
const PROFILE: Record<DayKind, number[]> = {
  //         0     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16    17    18    19    20    21    22    23
  weekday: [0.04, 0.02, 0.01, 0.01, 0.02, 0.08, 0.35, 0.90, 1.00, 0.55, 0.30, 0.28, 0.38, 0.35, 0.28, 0.30, 0.42, 0.70, 0.95, 1.00, 0.65, 0.42, 0.22, 0.09],
  weekend: [0.08, 0.04, 0.02, 0.01, 0.01, 0.03, 0.08, 0.18, 0.32, 0.45, 0.55, 0.60, 0.58, 0.55, 0.52, 0.55, 0.60, 0.65, 0.68, 0.62, 0.50, 0.38, 0.25, 0.14],
};
/* OD-mix weights [morning-like, evening-like, mixed] per hour */
function mixAt(day: DayKind, h: number): [number, number, number] {
  if (day === 'weekend') return h >= 9 && h < 13 ? [0.35, 0.15, 0.5] : h >= 17 && h < 21 ? [0.1, 0.45, 0.45] : [0.15, 0.2, 0.65];
  if (h >= 6 && h < 9.5) return [0.8, 0.05, 0.15];
  if (h >= 16.5 && h < 20.5) return [0.05, 0.8, 0.15];
  if (h >= 11.5 && h < 14) return [0.25, 0.25, 0.5];
  return [0.15, 0.15, 0.7];
}
const PATTERNS: readonly Pattern[] = ['morning', 'evening', 'mixed'];
const GROUP_SIZES = [0.62, 0.25, 0.09, 0.04];   // P(size = 1..4)
const MEAN_GROUP = GROUP_SIZES.reduce((s, p, i) => s + p * (i + 1), 0);

export type SurgeKind = 'guests' | 'leaving' | 'delivery';
export interface Surge { t0: number; t1: number; extra: number; kind: SurgeKind; floor: number }

export interface DaySpec {
  day: DayKind;
  rateScale?: number;       // multiplies the whole curve (1 = calibrated)
  groups?: boolean;         // families / friends travelling together
  surgesPerHour?: number;   // random events (guests arriving, a party leaving, deliveries)
  parkShare?: number;       // scales trips to/from parking
  floorWeights?: number[];  // relative population of each residential floor (2 … top)
}

export class DayTraffic implements TrafficSource {
  readonly peak: number;
  readonly surges: Surge[] = [];
  private f: FloorPicker;
  constructor(readonly spec: DaySpec, b: BuildingConfig, rng: Rng, start: number, duration: number) {
    const levels = b.parking + b.floorsAbove, lobby = b.parking;
    this.peak = designPeak(b.residents) * (spec.rateScale ?? 1);
    this.f = floorPicker(lobby, levels, spec.floorWeights);
    const n = rng.poisson((spec.surgesPerHour ?? 0) * duration / 3600);
    for (let i = 0; i < n; i++) {
      const t0 = start + rng.range(0, duration), len = rng.range(180, 600);
      const kinds: SurgeKind[] = ['guests', 'leaving', 'delivery'];
      this.surges.push({ t0, t1: t0 + len, extra: this.peak * rng.range(0.4, 1.2), kind: kinds[rng.int(0, 2)], floor: this.f.upper(rng) });
    }
  }
  static hourOf(t: number) { return ((t / 3600) % 24 + 24) % 24; }
  baseRate(t: number) {
    const h = DayTraffic.hourOf(t), p = PROFILE[this.spec.day], i = Math.floor(h), fr = h - i;
    return this.peak * (p[i] * (1 - fr) + p[(i + 1) % 24] * fr);
  }
  private surgeRate(s: Surge, t: number) { return t >= s.t0 && t < s.t1 ? s.extra : 0; }
  /** arrivals per minute; with groups on, people per minute stays calibrated to the curve */
  rate(t: number) {
    let r = this.baseRate(t); for (const s of this.surges) r += this.surgeRate(s, t);
    return this.spec.groups ? r / MEAN_GROUP : r;
  }
  regime(t: number): Regime {
    const m = mixAt(this.spec.day, DayTraffic.hourOf(t));
    return m[0] >= 0.5 ? 'morning' : m[1] >= 0.5 ? 'evening' : 'offpeak';
  }
  spawn(sim: Sim) {
    const rng = sim.rng, t = sim.t, f = this.f;
    const rates = [this.baseRate(t), ...this.surges.map(s => this.surgeRate(s, t))];
    const src = rng.weighted(rates);
    const n = this.spec.groups ? 1 + rng.weighted(GROUP_SIZES) : 1;
    let o: number, d: number;
    if (src === 0) [o, d] = drawOD(rng, PATTERNS[rng.weighted(mixAt(this.spec.day, DayTraffic.hourOf(t)))], f, this.spec.parkShare ?? 1);
    else {
      const s = this.surges[src - 1];
      if (s.kind === 'guests') { o = f.lobby; d = s.floor; }
      else if (s.kind === 'leaving') { o = s.floor; d = f.lobby; }
      else if (rng.chance(0.5)) { o = f.lobby; d = f.upper(rng); }
      else { o = f.upper(rng); d = f.lobby; }
    }
    if (o !== d) sim.addPassenger(o, d, n);
  }
}
