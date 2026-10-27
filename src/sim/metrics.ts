/* Per-run measurements. `window` bounds memory for the long-running UI;
   evaluations keep everything (window = Infinity). */
export class Metrics {
  waits: number[] = [];
  trips: number[] = [];
  served = 0;
  boarded = 0;
  spawned = 0;
  t0 = 0;
  constructor(private window = Infinity) {}
  onSpawn(n: number) { this.spawned += n; }
  onBoard(wait: number) { this.boarded++; this.push(this.waits, wait); }
  onAlight(trip: number) { this.served++; this.push(this.trips, trip); }
  reset(t: number) { this.waits.length = 0; this.trips.length = 0; this.served = 0; this.boarded = 0; this.spawned = 0; this.t0 = t; }
  private push(a: number[], v: number) {
    a.push(v);
    if (a.length > this.window) a.splice(0, Math.floor(this.window / 2));
  }
}

export const mean = (a: readonly number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
export function quantile(a: readonly number[], q: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
