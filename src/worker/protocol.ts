/* Messages between the UI thread and the learning Web Worker (src/worker/learn.worker.ts). */
import type { BuildingConfig, Regime } from '../sim/types.ts';
import type { Champion } from '../learn/champion.ts';
import type { EtaParams } from '../policies/eta.ts';

export type ToWorker =
  | { type: 'start'; building: BuildingConfig; regime: Regime; champion: Champion }
  | { type: 'regime'; regime: Regime }          // the UI's "time of day" changed
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset'; champion: Champion };      // forget learning, start from this champion

export type FromWorker =
  | { type: 'progress'; regime: Regime; gen: number; best: number; champion: number; v0: number; gainPct: number; curve: number[];
      cands: number[];       // incumbent's validation score per generation (noisy, shown as dots)
      champs: number[];      // score of the champion in effect, per generation
      promoted: number[];    // generations at which a new champion was promoted
      params: EtaParams;     // the incumbent's parameters right now — "what it has learned so far"
      simHours: number }     // simulated traffic so far, all regimes
  | { type: 'champion'; champion: Champion; regime: Regime; gainPct: number }   // promoted — UI hot-swaps
  | { type: 'error'; message: string };
