/* ETA maths shared by the heuristic and neural policies.
   Ported from the original single-file prototype (legacy/v0.html: committedStops, etaOf). */
import type { Car, Stop } from './types.ts';
import type { Sim } from './sim.ts';

export function committedStops(sim: Sim, car: Car): Stop[] {
  const out: Stop[] = [];
  for (const f of car.carCalls) out.push({ level: f, dir: 0 });
  for (const h of sim.hallCalls) if (h.assigned === car.id) out.push({ level: h.level, dir: h.dir });
  return out;
}

/** Seconds until `car` can serve level L travelling in direction d.
    `stopCost` is the time charged per intermediate stop (defaults to the real dwell). */
export function etaOf(sim: Sim, car: Car, L: number, d: number, stopCost = sim.dwell): number {
  const spf = sim.secPerFloor;
  let pos = car.pos, dir: number = car.dir;
  let tt = car.phase === 'doors' ? car.doorLeft : 0;
  const stops = committedStops(sim, car);
  if (!stops.length) return tt + Math.abs(pos - L) * spf;
  if (dir === 0) dir = Math.sign(L - pos) || 1;
  for (let g = 0; g < 8; g++) {
    const reachable = dir > 0 ? L >= pos - 1e-6 : L <= pos + 1e-6;
    if (d === dir && reachable) {
      let n = 0;
      for (const s of stops)
        if ((s.dir === 0 || s.dir === dir) &&
            (dir > 0 ? s.level > pos + 1e-6 && s.level < L - 1e-6 : s.level < pos - 1e-6 && s.level > L + 1e-6)) n++;
      return tt + Math.abs(L - pos) * spf + n * stopCost;
    }
    let ext = pos, n = 0;
    for (const s of stops) {
      const ahead = dir > 0 ? s.level > pos + 1e-6 : s.level < pos - 1e-6;
      if (!ahead) continue;
      ext = dir > 0 ? Math.max(ext, s.level) : Math.min(ext, s.level);
    }
    if ((dir > 0 && L > ext) || (dir < 0 && L < ext)) ext = L;
    for (const s of stops)
      if ((s.dir === 0 || s.dir === dir) &&
          (dir > 0 ? s.level > pos + 1e-6 && s.level <= ext + 1e-6 : s.level < pos - 1e-6 && s.level >= ext - 1e-6)) n++;
    tt += Math.abs(ext - pos) * spf + n * stopCost;
    pos = ext; dir = -dir;
  }
  return tt + 999;
}

/** Number of committed stops the car will make before reaching L in direction d (feature for the NN). */
export function stopsBefore(sim: Sim, car: Car, L: number): number {
  let n = 0;
  for (const s of committedStops(sim, car)) {
    if (car.dir > 0 && s.level > car.pos && s.level < L) n++;
    else if (car.dir < 0 && s.level < car.pos && s.level > L) n++;
  }
  return n;
}
