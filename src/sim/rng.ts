/* Seeded PRNG (sfc32) — every random draw in the engine goes through one of these,
   so a (scenario, seed) pair always replays exactly. */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number) {
    // splitmix32 expands a single integer seed into the 128-bit sfc32 state
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next(); this.b = next(); this.c = next(); this.d = next();
    for (let i = 0; i < 12; i++) this.next();
  }
  /** uniform [0, 1) */
  next(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t / 4294967296;
  }
  /** integer in [a, b] inclusive */
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
  chance(p: number): boolean { return this.next() < p; }
  /** standard normal (Box–Muller) */
  normal(): number {
    let u = 0; while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Poisson count; Knuth for small means, normal approximation for large ones */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const L = Math.exp(-mean); let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > L);
    return k - 1;
  }
  /** index drawn proportionally to non-negative weights */
  weighted(w: readonly number[]): number {
    let tot = 0; for (const x of w) tot += x;
    let r = this.next() * tot;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; }
    return w.length - 1;
  }
  /** a fresh independent stream derived from this one */
  fork(): Rng { return new Rng(Math.floor(this.next() * 4294967296)); }
}
