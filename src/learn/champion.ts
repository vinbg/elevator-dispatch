/* The artefact training produces and the app loads. Shared contract between
   src/learn (writes), src/eval (scores), src/worker and src/ui (load / hot-swap). */
import type { RegimeParams } from '../policies/eta.ts';
import type { Regime } from '../sim/types.ts';

export interface NnWeights {
  layers: number[];      // e.g. [16, 32, 16, 1]
  weights: number[];     // flat, layer by layer: W (out×in, row-major) then b
  margin: number;        // reassignment hysteresis in score units
  scale?: number;        // seconds per unit of NN output (default NN_SCALE in policies/nn.ts)
}

export interface Champion {
  version: 1;
  kind: 'heuristic' | 'nn';
  heuristic: RegimeParams;  // always present; the NN (if any) is a residual on top of it
  nn: NnWeights | null;
  trainedOn: string;        // e.g. "suite:train domain-randomised" or "own building"
  createdAt: string;        // ISO date
  validation?: { score: number; baseline: number; gainPct: number };
  /** per-regime validation numbers (optional detail) */
  perRegime?: Partial<Record<Regime, { score: number; baseline: number; gainPct: number }>>;
}

export const CHAMPION_KEY = 'elevChampion';
