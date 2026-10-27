/* Headless, deterministic elevator group simulation.
   The car controller (LOOK target selection, arrival/boarding, door timing) is a port of
   legacy/v0.html — decideNext / arrive / stepCar / chooseTarget. Dispatch decisions are
   delegated to a Policy; arrivals come from a TrafficSource. No DOM, no Math.random. */
import { Rng } from './rng.ts';
import { Metrics } from './metrics.ts';
import { committedStops } from './eta.ts';
import type { BuildingConfig, Car, Dir, HallCall, Regime, SimEvent } from './types.ts';

export interface Policy {
  readonly name: string;
  /** pick the car for a hall call; `cost` is reported in the log (≈ seconds) */
  assign(sim: Sim, call: HallCall): { car: number; cost: number };
  /** periodic pass; call sim.moveCall() for any call that should change car */
  reassign?(sim: Sim): void;
  /** seconds between reassign passes (default 0.8) */
  reassignInterval?(sim: Sim): number;
  /** where an idle car should park; null = stay put. Defaults to the configured home. */
  parkTarget?(sim: Sim, car: Car): number | null;
}

export interface TrafficSource {
  /** passengers per minute at sim time t */
  rate(t: number): number;
  /** create one arrival (a person or a group) via sim.addPassenger */
  spawn(sim: Sim): void;
  regime(t: number): Regime;
}

export interface SimOptions {
  policy: Policy;
  seed?: number;
  parking?: boolean;
  traffic?: TrafficSource | null;
  metricsWindow?: number;
  /** sim-clock time the run starts at (seconds since midnight for day traffic) */
  startT?: number;
  /** reproduce legacy/v0.html's door-reopen freeze (only for the exact-parity test) */
  legacyDoorFreeze?: boolean;
}

export const DT = 0.1;
const MAX_CAP = 30;

export const homeIndex = (fn: number, lobby: number, levels: number) =>
  Math.max(0, Math.min(levels - 1, fn < 0 ? lobby + fn : lobby + fn - 1));

export class Sim {
  readonly levels: number;
  readonly lobby: number;
  readonly secPerFloor: number;
  readonly dwell: number;
  readonly boardTime: number;
  readonly cfg: BuildingConfig;
  cars: Car[];
  hallCalls: HallCall[] = [];
  t: number;
  parking: boolean;
  policy: Policy;
  traffic: TrafficSource | null;
  rng: Rng;
  metrics: Metrics;
  /** bumps whenever hall calls or their assignments change (UI redraw hint) */
  callsVersion = 0;
  private legacyDoorFreeze: boolean;
  private lastReassign: number;
  private acc = 0;
  private listeners: ((e: SimEvent) => void)[] = [];

  constructor(cfg: BuildingConfig, o: SimOptions) {
    this.cfg = cfg;
    this.levels = cfg.parking + cfg.floorsAbove;
    this.lobby = cfg.parking;
    this.secPerFloor = cfg.secPerFloor;
    this.dwell = cfg.doorTime + cfg.hold;
    this.boardTime = cfg.boardTime ?? 0;
    this.policy = o.policy;
    this.parking = o.parking ?? true;
    this.traffic = o.traffic ?? null;
    this.legacyDoorFreeze = o.legacyDoorFreeze ?? false;
    this.rng = new Rng(o.seed ?? 1);
    this.metrics = new Metrics(o.metricsWindow);
    this.t = o.startT ?? 0;
    this.metrics.t0 = this.t;
    this.lastReassign = this.t;
    this.cars = cfg.elevators.map((e, i) => {
      const home = homeIndex(e.home, this.lobby, this.levels);
      return {
        id: i, name: String.fromCharCode(65 + i), cap: Math.max(2, Math.min(MAX_CAP, e.cap)), home,
        pos: home, dir: 0, phase: 'idle', target: null, doorLeft: 0, parkTrip: false, noService: false,
        dirty: false, carCalls: new Set<number>(), pax: [], travelled: 0, stops: 0,
      };
    });
  }

  on(fn: (e: SimEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; }
  private emit(e: SimEvent) { for (const f of this.listeners) f(e); }

  regime(): Regime { return this.traffic ? this.traffic.regime(this.t) : 'offpeak'; }

  /** advance the clock by `seconds` in fixed DT steps (leftover time carries over) */
  advance(seconds: number) {
    this.acc += seconds;
    while (this.acc >= DT - 1e-9) { this.acc -= DT; this.tick(DT); }
  }

  /** run until sim time `until` */
  runUntil(until: number) { while (this.t < until - 1e-9) this.tick(DT); }

  tick(dt: number) {
    this.t += dt;
    if (this.traffic) {
      const n = this.rng.poisson(this.traffic.rate(this.t) / 60 * dt);
      for (let k = 0; k < n; k++) this.traffic.spawn(this);
    }
    for (const c of this.cars) this.stepCar(c, dt);
    if (this.t - this.lastReassign > (this.policy.reassignInterval?.(this) ?? 0.8)) {
      this.lastReassign = this.t;
      this.policy.reassign?.(this);
    }
  }

  setPolicy(p: Policy) {
    this.policy = p;
    for (const c of this.hallCalls) this.assignCall(c);
    for (const c of this.cars) c.dirty = true;
    this.emit({ type: 'policy', t: this.t, name: p.name });
  }

  /** a person (or a group of `n`) at level o wants level d */
  addPassenger(o: number, d: number, n = 1) {
    const dir = Math.sign(d - o) as Dir | 0; if (!dir) return;
    this.metrics.onSpawn(n);
    let call = this.hallCalls.find(h => h.level === o && h.dir === dir);
    const fresh = !call;
    if (!call) { call = { level: o, dir, t0: this.t, assigned: -1, pax: [] }; this.hallCalls.push(call); }
    for (let k = 0; k < n; k++) call.pax.push({ dest: d, t0: this.t });
    if (fresh) this.assignCall(call);
    this.callsVersion++;
  }

  assignCall(call: HallCall) {
    const { car, cost } = this.policy.assign(this, call);
    if (call.assigned !== car) {
      if (call.assigned >= 0) this.cars[call.assigned].dirty = true;
      call.assigned = car; this.cars[car].dirty = true;
      this.emit({ type: 'assign', t: this.t, call, car, cost });
    }
    this.callsVersion++;
  }

  moveCall(call: HallCall, to: number, gain: number) {
    const from = call.assigned;
    if (from === to) return;
    call.assigned = to;
    this.cars[from].dirty = true; this.cars[to].dirty = true;
    this.callsVersion++;
    this.emit({ type: 'reassign', t: this.t, call, from, to, gain });
  }

  parkLevel(car: Car): number | null {
    if (!this.parking) return null;
    return this.policy.parkTarget ? this.policy.parkTarget(this, car) : car.home;
  }

  resetMetrics() { this.metrics.reset(this.t); }

  /* ───────────── car controller (LOOK) ───────────── */

  chooseTarget(car: Car): { level: number } | null {
    const stops = committedStops(this, car);
    if (!stops.length) return null;
    const pos = car.pos;
    // A hall call here is not served now if it points the other way while riders are heading on, or if
    // the car is full — the legacy page re-opened the doors for it forever in both cases (a permanent freeze).
    const aheadInDir = car.dir !== 0 && stops.some(s => car.dir > 0 ? s.level > pos + 1e-6 : s.level < pos - 1e-6);
    const full = car.pax.length >= car.cap;
    const at = stops.find(s => Math.abs(s.level - pos) < 1e-6 &&
      (this.legacyDoorFreeze || s.dir === 0 || (!full && (s.dir === car.dir || !aheadInDir))));
    if (at && car.phase !== 'move') return { level: at.level };
    const pick = (dir: number) => {
      const ahead = stops.filter(s => dir > 0 ? s.level > pos + 1e-6 : s.level < pos - 1e-6);
      if (!ahead.length) return null;
      const inline = ahead.filter(s => s.dir === 0 || s.dir === dir);
      if (inline.length)
        return { level: dir > 0 ? Math.min(...inline.map(s => s.level)) : Math.max(...inline.map(s => s.level)) };
      return { level: dir > 0 ? Math.max(...ahead.map(s => s.level)) : Math.min(...ahead.map(s => s.level)) };
    };
    const d0 = car.dir !== 0 ? car.dir : Math.sign(
      stops.reduce((b, s) => Math.abs(s.level - pos) < Math.abs(b - pos) ? s.level : b, stops[0].level) - pos) || 1;
    return pick(d0) || pick(-d0);
  }

  private decideNext(car: Car) {
    car.noService = false; car.parkTrip = false;
    const tgt = this.chooseTarget(car);
    if (tgt) {
      if (Math.abs(tgt.level - car.pos) < 1e-6) { this.arrive(car, tgt.level); return; }
      car.target = tgt.level; car.dir = Math.sign(tgt.level - car.pos) as -1 | 1; car.phase = 'move'; return;
    }
    const park = this.parkLevel(car);
    if (park !== null && Math.abs(car.pos - park) > 1e-6) {
      car.target = park; car.dir = Math.sign(park - car.pos) as -1 | 1; car.phase = 'move'; car.parkTrip = true; return;
    }
    car.phase = 'idle'; car.dir = 0; car.target = null;
  }

  private arrive(car: Car, level: number) {
    car.pos = level; car.target = null;
    if (car.parkTrip || car.noService) { car.phase = 'idle'; car.dir = 0; car.parkTrip = false; car.noService = false; return; }
    const rest = committedStops(this, car).filter(s => Math.abs(s.level - level) > 1e-6);
    const above = rest.some(s => s.level > level), below = rest.some(s => s.level < level);
    let dep: -1 | 0 | 1 = 0;
    if (car.dir > 0 && above) dep = 1;
    else if (car.dir < 0 && below) dep = -1;
    else if (above) dep = 1;
    else if (below) dep = -1;
    else { const here = this.hallCalls.find(h => h.level === level && h.assigned === car.id); dep = here ? here.dir : 0; }
    let out = 0, tripSum = 0;
    car.pax = car.pax.filter(p => {
      if (p.dest === level) { const tr = this.t - p.tBoard; this.metrics.onAlight(tr); tripSum += tr; out++; return false; }
      return true;
    });
    car.carCalls.delete(level);
    let inn = 0, waitSum = 0;
    for (const h of this.hallCalls) {
      if (h.level !== level) continue;
      if (dep !== 0 && h.dir !== dep) continue;
      if (dep === 0) dep = h.dir;
      while (h.pax.length && car.pax.length < car.cap) {
        const p = h.pax.shift()!;
        const w = this.t - p.t0; this.metrics.onBoard(w); waitSum += w;
        car.pax.push({ dest: p.dest, tBoard: this.t }); car.carCalls.add(p.dest); inn++;
      }
      if (h.pax.length && car.pax.length >= car.cap)
        this.emit({ type: 'full', t: this.t, car: car.id, level, remaining: h.pax.length });
    }
    this.hallCalls = this.hallCalls.filter(h => h.pax.length > 0);
    if (out) this.emit({ type: 'dropoff', t: this.t, car: car.id, level, n: out, avgTrip: tripSum / out });
    if (inn) this.emit({ type: 'pickup', t: this.t, car: car.id, level, n: inn, dir: dep, avgWait: waitSum / inn });
    car.dir = dep; car.phase = 'doors'; car.doorLeft = this.dwell + this.boardTime * (inn + out); car.stops++;
    this.callsVersion++;
  }

  private stepCar(car: Car, dt: number) {
    if (car.phase === 'doors') {
      car.doorLeft -= dt;
      if (car.doorLeft <= 0) { car.phase = 'idle'; this.decideNext(car); }
      return;
    }
    if (car.phase === 'move') {
      if (car.dirty) {
        car.dirty = false;
        const tgt = this.chooseTarget(car);
        if (!tgt) {
          car.noService = true;
          car.target = Math.max(0, Math.min(this.levels - 1, car.dir > 0 ? Math.ceil(car.pos + 0.35) : Math.floor(car.pos - 0.35)));
        } else if (tgt.level !== car.target) {
          const same = Math.sign(tgt.level - car.pos) === car.dir;
          const far = Math.abs(tgt.level - car.pos) >= 0.35;
          if (same && far) { car.target = tgt.level; car.noService = false; car.parkTrip = false; }
          else if (!same && car.parkTrip) { car.target = tgt.level; car.dir = Math.sign(tgt.level - car.pos) as -1 | 1; car.parkTrip = false; }
        }
      }
      const step = dt / this.secPerFloor;
      const tgt = car.target!;
      if (Math.abs(tgt - car.pos) <= step) { car.travelled += Math.abs(tgt - car.pos); this.arrive(car, tgt); }
      else { car.pos += car.dir * step; car.travelled += step; }
      return;
    }
    if (car.dirty || committedStops(this, car).length) { car.dirty = false; this.decideNext(car); return; }
    const park = this.parkLevel(car);
    if (park !== null && Math.abs(car.pos - park) > 1e-6) this.decideNext(car);
  }
}

export type { BuildingConfig, Car, HallCall, Regime, SimEvent } from './types.ts';
