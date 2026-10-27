/* Messages between the UI thread and the learning Web Worker (src/worker/learn.worker.ts). */
import type { BuildingConfig, Regime } from '../sim/types.ts';
import type { Champion } from '../learn/champion.ts';

export type ToWorker =
  | { type: 'start'; building: BuildingConfig; regime: Regime; champion: Champion }
  | { type: 'regime'; regime: Regime }          // the UI's "time of day" changed
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset'; champion: Champion };      // forget learning, start from this champion

export type FromWorker =
  | { type: 'progress'; regime: Regime; gen: number; best: number; champion: number; v0: number; gainPct: number; curve: number[] }
  | { type: 'champion'; champion: Champion; regime: Regime; gainPct: number }   // promoted — UI hot-swaps
  | { type: 'error'; message: string };
