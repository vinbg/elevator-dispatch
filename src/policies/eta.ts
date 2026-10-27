/* Cost-function (ETA) dispatch with every constant exposed as a parameter.
   With V0 params it is exactly the original prototype's "Optimal (ETA)" mode:
   cost = eta + 0.7·pending + 0.3·pax + 8·fill², reassign if ≥2 s faster, every 0.8 s,
   idle cars park at their configured home floors. */
import type { Policy, Sim } from '../sim/sim.ts';
import type { Car, HallCall, Regime } from '../sim/types.ts';
import { etaOf } from '../sim/eta.ts';

export interface Zoning {
  lobbyShare: number;   // fraction of cars whose home is the lobby
  spread: number;       // [0,1) phase of the remaining homes across the upper floors
}

export interface EtaParams {
  wPending: number;     // per hall call already assigned to the car
  wPax: number;         // per rider on board
  wFill: number;        // × fill² (capacity pressure)
  stopCost: number;     // × dwell charged per intermediate stop in the ETA
  wWaiting: number;     // per person waiting at the car's other assigned calls, ÷ capacity
  reassignGain: number; // hysteresis, seconds
  reassignEvery: number;
  zoning: Zoning | null; // null = configured home floors
}

export const V0: EtaParams = {
  wPending: 0.7, wPax: 0.3, wFill: 8, stopCost: 1, wWaiting: 0,
  reassignGain: 2, reassignEvery: 0.8, zoning: null,
};

export type RegimeParams = Record<Regime, EtaParams>;
export const allRegimes = (p: EtaParams): RegimeParams => ({ morning: p, evening: p, offpeak: p });

/** Home levels for `n` cars under a learned zoning (lowest car ids get the lobby). */
export function zoneHomes(z: Zoning, n: number, lobby: number, levels: number): number[] {
  const k = Math.min(n, Math.round(z.lobbyShare * n));
  const out: number[] = Array(k).fill(lobby);
  const m = n - k, lo = Math.min(lobby + 1, levels - 1), span = levels - 1 - lo;
  for (let j = 0; j < m; j++) out.push(lo + Math.round(span * ((j + z.spread) / m)));
  return out;
}

export class EtaPolicy implements Policy {
  readonly name: string;
  private homes = new Map<Regime, number[]>();
  constructor(private params: RegimeParams, name = 'eta') { this.name = name; }

  reassignInterval(sim: Sim) { return this.p(sim).reassignEvery; }
  p(sim: Sim): EtaParams { return this.params[sim.regime()]; }

  cost(sim: Sim, car: Car, L: number, d: number, p = this.p(sim)): number {
    let pending = 0, waiting = 0;
    for (const h of sim.hallCalls) if (h.assigned === car.id) { pending++; if (h.level !== L || h.dir !== d) waiting += h.pax.length; }
    const fill = car.pax.length / car.cap;
    return etaOf(sim, car, L, d, sim.dwell * p.stopCost)
      + p.wPending * pending + p.wPax * car.pax.length + p.wFill * fill * fill + p.wWaiting * waiting / car.cap;
  }

  assign(sim: Sim, call: HallCall) {
    const p = this.p(sim);
    let best = -1, bc = Infinity;
    for (const c of sim.cars) { const v = this.cost(sim, c, call.level, call.dir, p); if (v < bc) { bc = v; best = c.id; } }
    return { car: best, cost: bc };
  }

  reassign(sim: Sim) {
    const p = this.p(sim);
    for (const call of sim.hallCalls) {
      const cur = sim.cars[call.assigned];
      if (Math.abs(cur.pos - call.level) < 0.7 && (cur.dir === call.dir || cur.dir === 0 || cur.phase === 'doors')) continue;
      let best = call.assigned, bc = this.cost(sim, cur, call.level, call.dir, p);
      for (const c of sim.cars) {
        if (c.id === call.assigned) continue;
        const v = this.cost(sim, c, call.level, call.dir, p);
        if (v + p.reassignGain < bc) { bc = v; best = c.id; }
      }
      if (best !== call.assigned) sim.moveCall(call, best, p.reassignGain);
    }
  }

  parkTarget(sim: Sim, car: Car): number | null {
    const r = sim.regime(), z = this.params[r].zoning;
    if (!z) return car.home;
    let h = this.homes.get(r);
    if (!h || h.length !== sim.cars.length) { h = zoneHomes(z, sim.cars.length, sim.lobby, sim.levels); this.homes.set(r, h); }
    return h[car.id];
  }
}

/* ───── flat vectors for black-box optimisers ───── */

interface Dim { key: string; lo: number; hi: number }
export const DIMS: readonly Dim[] = [
  { key: 'wPending', lo: 0, hi: 6 },
  { key: 'wPax', lo: 0, hi: 3 },
  { key: 'wFill', lo: 0, hi: 40 },
  { key: 'stopCost', lo: 0.3, hi: 2 },
  { key: 'wWaiting', lo: 0, hi: 20 },
  { key: 'reassignGain', lo: 0, hi: 10 },
  { key: 'reassignEvery', lo: 0.3, hi: 4 },
  { key: 'lobbyShare', lo: 0, hi: 1 },
  { key: 'spread', lo: 0, hi: 0.999 },
];

/** unit-cube vector → params (optimisers work in [0,1]^n) */
export function fromUnit(u: readonly number[]): EtaParams {
  const v = DIMS.map((d, i) => d.lo + Math.max(0, Math.min(1, u[i])) * (d.hi - d.lo));
  return {
    wPending: v[0], wPax: v[1], wFill: v[2], stopCost: v[3], wWaiting: v[4],
    reassignGain: v[5], reassignEvery: v[6], zoning: { lobbyShare: v[7], spread: v[8] },
  };
}

export function toUnit(p: EtaParams, n: number): number[] {
  const z = p.zoning ?? { lobbyShare: 0.5, spread: 0.5 };
  const raw = [p.wPending, p.wPax, p.wFill, p.stopCost, p.wWaiting, p.reassignGain, p.reassignEvery, z.lobbyShare, z.spread];
  return raw.slice(0, n).map((x, i) => (x - DIMS[i].lo) / (DIMS[i].hi - DIMS[i].lo));
}
