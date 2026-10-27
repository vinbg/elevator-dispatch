/* OpenAI-style evolution strategy (Salimans et al. 2017) for high-dimensional vectors:
   antithetic Gaussian perturbations θ ± σε, centred-rank fitness shaping, Adam on the
   gradient estimate, optional L2 weight decay. Minimises. Seeded Rng throughout. */
import { Rng } from '../sim/rng.ts';

export interface EsOptions {
  theta0: readonly number[];
  sigma?: number;        // perturbation std (default 0.05)
  pairs?: number;        // antithetic pairs per generation (population = 2·pairs)
  lr?: number;           // Adam step size (default 0.01)
  weightDecay?: number;  // L2 coefficient added to the gradient (default 0)
  seed?: number;
  beta1?: number; beta2?: number;
}

/** ranks mapped to [-0.5, 0.5]; highest value → +0.5 */
export function centredRanks(x: readonly number[]): number[] {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]), r = Array(x.length).fill(0);
  idx.forEach((k, i) => { r[k] = x.length > 1 ? i / (x.length - 1) - 0.5 : 0; });
  return r;
}

export class ES {
  theta: number[];
  sigma: number;
  readonly pairs: number;
  lr: number;
  readonly weightDecay: number;
  gen = 0;
  private m: number[]; private v: number[];
  private eps: number[][] = [];
  private rng: Rng;
  private b1: number; private b2: number;

  constructor(o: EsOptions) {
    this.theta = [...o.theta0];
    this.sigma = o.sigma ?? 0.05;
    this.pairs = o.pairs ?? 16;
    this.lr = o.lr ?? 0.01;
    this.weightDecay = o.weightDecay ?? 0;
    this.rng = new Rng(o.seed ?? 1);
    this.b1 = o.beta1 ?? 0.9; this.b2 = o.beta2 ?? 0.999;
    this.m = Array(this.theta.length).fill(0); this.v = Array(this.theta.length).fill(0);
  }

  /** 2·pairs candidates, ordered [θ+σε₀, θ−σε₀, θ+σε₁, …] */
  ask(): number[][] {
    const n = this.theta.length, out: number[][] = [];
    this.eps = Array.from({ length: this.pairs }, () => Array.from({ length: n }, () => this.rng.normal()));
    for (const e of this.eps) {
      out.push(this.theta.map((t, i) => t + this.sigma * e[i]));
      out.push(this.theta.map((t, i) => t - this.sigma * e[i]));
    }
    return out;
  }

  /** fitness for the candidates of the last ask(), same order (lower is better) */
  tell(fitness: readonly number[]) {
    const n = this.theta.length, u = centredRanks(fitness), g = Array(n).fill(0);
    for (let k = 0; k < this.pairs; k++) {
      const d = u[2 * k] - u[2 * k + 1], e = this.eps[k];
      for (let i = 0; i < n; i++) g[i] += d * e[i];
    }
    this.gen++;
    const t = this.gen, { b1, b2 } = this, c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
    for (let i = 0; i < n; i++) {
      const gi = g[i] / (2 * this.pairs * this.sigma) + this.weightDecay * this.theta[i];
      this.m[i] = b1 * this.m[i] + (1 - b1) * gi;
      this.v[i] = b2 * this.v[i] + (1 - b2) * gi * gi;
      this.theta[i] -= this.lr * (this.m[i] / c1) / (Math.sqrt(this.v[i] / c2) + 1e-8);
    }
  }
}
