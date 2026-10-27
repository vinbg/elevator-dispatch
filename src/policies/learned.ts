/* Builds the dispatch policy for a trained champion (tuned heuristic, plus NN residual if present). */
import type { Policy } from '../sim/sim.ts';
import type { Champion } from '../learn/champion.ts';
import { EtaPolicy } from './eta.ts';
import { NnPolicy } from './nn.ts';

export function learnedPolicy(ch: Champion): Policy {
  return ch.nn ? new NnPolicy(ch.heuristic, ch.nn, 'learned') : new EtaPolicy(ch.heuristic, 'learned');
}
