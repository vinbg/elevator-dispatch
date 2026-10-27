/* Run scenarios and turn a finished sim into the metrics + single score the evals compare. */
import type { Policy, Sim } from '../sim/sim.ts';
import { mean, quantile } from '../sim/metrics.ts';
import { simFor, type Scenario } from '../traffic/scenario.ts';

export interface RunMetrics {
  avgWait: number;      // s, includes people still waiting at the end (censored)
  p95Wait: number;
  maxWait: number;
  longWaitPct: number;  // % of waits over 60 s
  avgTrip: number;      // s in the car
  avgJourney: number;   // wait + trip
  throughput: number;   // served per minute
  energy: number;       // (floors travelled + 2 × stops) per served passenger
  served: number;
  unserved: number;     // still waiting when the window closed
  score: number;        // lower is better — see SCORE below
}

/** The one number training optimises and the leaderboard ranks by (lower is better). */
export const SCORE = {
  doc: 'avgWait + 0.25·p95Wait + 0.15·avgTrip + 20·(share of waits > 60 s) + 0.05·energy',
  of: (m: Omit<RunMetrics, 'score'>) => m.avgWait + 0.25 * m.p95Wait + 0.15 * m.avgTrip + 0.2 * m.longWaitPct + 0.05 * m.energy,
};

export function summarize(sim: Sim, durationSec: number): RunMetrics {
  const waits = [...sim.metrics.waits];
  let unserved = 0;
  for (const h of sim.hallCalls) for (const p of h.pax) { waits.push(sim.t - p.t0); unserved++; }
  const served = sim.metrics.served;
  const travel = sim.cars.reduce((s, c) => s + c.travelled + 2 * c.stops, 0);
  const avgWait = mean(waits), avgTrip = mean(sim.metrics.trips);
  const m = {
    avgWait, p95Wait: quantile(waits, 0.95), maxWait: waits.length ? Math.max(...waits) : 0,
    longWaitPct: waits.length ? 100 * waits.filter(w => w > 60).length / waits.length : 0,
    avgTrip, avgJourney: avgWait + avgTrip, throughput: served / (durationSec / 60),
    energy: travel / Math.max(1, served), served, unserved,
  };
  return { ...m, score: SCORE.of(m) };
}

export function runScenario(sc: Scenario, policy: Policy): RunMetrics {
  const sim = simFor(sc, policy);
  sim.runUntil(sc.start + sc.duration);
  return summarize(sim, sc.duration);
}

/** mean score over scenarios — the training objective */
export function meanScore(scs: readonly Scenario[], make: () => Policy): number {
  let s = 0; for (const sc of scs) s += runScenario(sc, make()).score;
  return s / scs.length;
}
