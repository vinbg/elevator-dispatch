/* (mu/mu_w, lambda)-CMA-ES — Hansen, "The CMA Evolution Strategy: A Tutorial" (2016), default settings.
   Minimises. Optional box [lo, hi]: callers evaluate `feasible(x)` (clamped) while tell() keeps the
   unclamped sample for the update and adds `boundPenalty`·‖x − clamp(x)‖² to its fitness.
   All randomness comes from a seeded Rng. */
import { Rng } from '../sim/rng.ts';

export interface CmaOptions {
  x0: readonly number[];
  sigma0: number;
  seed?: number;
  popSize?: number;
  bounds?: [number, number];
  boundPenalty?: number;
}

/** symmetric eigendecomposition by cyclic Jacobi rotations: A = V·diag(d)·Vᵀ (columns of V) */
export function jacobiEigen(A: readonly number[][]): { d: number[]; V: number[][] } {
  const n = A.length, a = A.map(r => [...r]);
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { d: a.map((r, i) => r[i]), V };
}

export class CMAES {
  readonly n: number;
  readonly lambda: number;
  readonly mu: number;
  readonly weights: number[];
  readonly mueff: number;
  readonly cc: number; readonly cs: number; readonly c1: number; readonly cmu: number; readonly damps: number;
  readonly chiN: number;
  mean: number[];
  sigma: number;
  gen = 0;
  evals = 0;
  best: { x: number[]; f: number } = { x: [], f: Infinity };
  private C: number[][];
  private B: number[][];
  private D: number[];
  private pc: number[];
  private ps: number[];
  private rng: Rng;
  private eigenGen = 0;
  private bounds?: [number, number];
  private boundPenalty: number;

  constructor(o: CmaOptions) {
    const n = this.n = o.x0.length;
    this.lambda = o.popSize ?? 4 + Math.floor(3 * Math.log(n));
    this.mu = Math.floor(this.lambda / 2);
    const w = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
    const sw = w.reduce((s, x) => s + x, 0);
    this.weights = w.map(x => x / sw);
    this.mueff = 1 / this.weights.reduce((s, x) => s + x * x, 0);
    const me = this.mueff;
    this.cc = (4 + me / n) / (n + 4 + 2 * me / n);
    this.cs = (me + 2) / (n + me + 5);
    this.c1 = 2 / ((n + 1.3) ** 2 + me);
    this.cmu = Math.min(1 - this.c1, 2 * (me - 2 + 1 / me) / ((n + 2) ** 2 + me));
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((me - 1) / (n + 1)) - 1) + this.cs;
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
    this.mean = [...o.x0];
    this.sigma = o.sigma0;
    this.C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
    this.B = this.C.map(r => [...r]);
    this.D = Array(n).fill(1);
    this.pc = Array(n).fill(0);
    this.ps = Array(n).fill(0);
    this.rng = new Rng(o.seed ?? 1);
    this.bounds = o.bounds;
    this.boundPenalty = o.boundPenalty ?? 1;
  }

  /** the point actually evaluated for sample x (clamped into the box, if any) */
  feasible(x: readonly number[]): number[] {
    if (!this.bounds) return [...x];
    const [lo, hi] = this.bounds;
    return x.map(v => Math.max(lo, Math.min(hi, v)));
  }

  ask(): number[][] {
    const { n, B, D } = this;
    return Array.from({ length: this.lambda }, () => {
      const z = Array.from({ length: n }, () => this.rng.normal());
      const x = [...this.mean];
      for (let i = 0; i < n; i++) {
        let y = 0; for (let j = 0; j < n; j++) y += B[i][j] * D[j] * z[j];
        x[i] += this.sigma * y;
      }
      return x;
    });
  }

  /** xs = the unclamped samples from ask(), fitness = f(feasible(x)) (lower is better) */
  tell(xs: readonly (readonly number[])[], fitness: readonly number[]) {
    const { n, mu, weights: w } = this;
    const f = xs.map((x, k) => {
      const fx = this.feasible(x);
      let pen = 0; for (let i = 0; i < n; i++) pen += (x[i] - fx[i]) ** 2;
      return fitness[k] + this.boundPenalty * pen;
    });
    this.evals += xs.length;
    const idx = f.map((_, i) => i).sort((a, b) => f[a] - f[b]);
    if (f[idx[0]] < this.best.f) this.best = { x: this.feasible(xs[idx[0]]), f: f[idx[0]] };
    const old = this.mean;
    this.mean = Array.from({ length: n }, (_, i) => { let s = 0; for (let k = 0; k < mu; k++) s += w[k] * xs[idx[k]][i]; return s; });
    const yw = this.mean.map((m, i) => (m - old[i]) / this.sigma);
    // C^{-1/2}·yw = B·D^{-1}·Bᵀ·yw
    const { B, D } = this;
    const bty = Array.from({ length: n }, (_, j) => { let s = 0; for (let i = 0; i < n; i++) s += B[i][j] * yw[i]; return s / D[j]; });
    const cs = this.cs, kps = Math.sqrt(cs * (2 - cs) * this.mueff);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * bty[j]; this.ps[i] = (1 - cs) * this.ps[i] + kps * s; }
    const psn = Math.hypot(...this.ps);
    this.gen++;
    const hsig = psn / Math.sqrt(1 - (1 - cs) ** (2 * this.gen)) / this.chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    const cc = this.cc, kpc = hsig * Math.sqrt(cc * (2 - cc) * this.mueff);
    for (let i = 0; i < n; i++) this.pc[i] = (1 - cc) * this.pc[i] + kpc * yw[i];
    const ys = idx.slice(0, mu).map(k => xs[k].map((x, i) => (x - old[i]) / this.sigma));
    const { c1, cmu } = this, dh = (1 - hsig) * cc * (2 - cc);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let rmu = 0; for (let k = 0; k < mu; k++) rmu += w[k] * ys[k][i] * ys[k][j];
      const v = (1 - c1 - cmu) * this.C[i][j] + c1 * (this.pc[i] * this.pc[j] + dh * this.C[i][j]) + cmu * rmu;
      this.C[i][j] = this.C[j][i] = v;
    }
    this.sigma *= Math.exp((cs / this.damps) * (psn / this.chiN - 1));
    if (this.gen - this.eigenGen >= Math.max(1, Math.floor(1 / ((c1 + cmu) * n * 10)))) this.decompose();
  }

  private decompose() {
    this.eigenGen = this.gen;
    const { d, V } = jacobiEigen(this.C);
    this.B = V;
    this.D = d.map(x => Math.sqrt(Math.max(x, 1e-20)));
  }
}
