/* Neural residual on top of the tuned ETA heuristic.
   car cost = EtaPolicy cost (same formula, same params) + scale · MLP(features(car, call)).
   The last layer is zero-initialised, so an untrained net makes exactly the heuristic's decisions.
   Reassignment uses the heuristic's skip rule with hysteresis reassignGain + margin;
   parking and the reassign interval are delegated to the heuristic. Any number of cars / floors. */
import type { Policy, Sim } from '../sim/sim.ts';
import type { Car, HallCall, Regime } from '../sim/types.ts';
import { etaOf, stopsBefore } from '../sim/eta.ts';
import { Rng } from '../sim/rng.ts';
import type { NnWeights } from '../learn/champion.ts';
import { EtaPolicy, type EtaParams, type RegimeParams } from './eta.ts';

export const NN_FEATURES = 18;
export const NN_LAYERS: readonly number[] = [NN_FEATURES, 32, 16, 1];
export const NN_SCALE = 5;

export const nnParamCount = (layers: readonly number[]) =>
  layers.slice(1).reduce((s, out, i) => s + out * layers[i] + out, 0);

/** hidden layers ~ N(0, 1/fan-in), output layer zero ⇒ r ≡ 0 */
export function initNn(seed = 1, layers: readonly number[] = NN_LAYERS, margin = 0): NnWeights {
  const rng = new Rng(seed), w: number[] = [];
  for (let l = 1; l < layers.length; l++) {
    const fin = layers[l - 1], fout = layers[l], last = l === layers.length - 1;
    for (let k = 0; k < fout * fin; k++) w.push(last ? 0 : rng.normal() / Math.sqrt(fin));
    for (let k = 0; k < fout; k++) w.push(0);
  }
  return { layers: [...layers], weights: w, margin, scale: NN_SCALE };
}

/** tanh MLP with a linear scalar output */
export class Mlp {
  private bufs: Float64Array[];
  constructor(readonly layers: readonly number[], readonly w: readonly number[]) {
    if (w.length !== nnParamCount(layers)) throw new Error(`NN expects ${nnParamCount(layers)} weights, got ${w.length}`);
    this.bufs = layers.map(n => new Float64Array(n));
  }
  get input() { return this.bufs[0]; }
  forward(): number {
    const L = this.layers, w = this.w;
    let o = 0;
    for (let l = 1; l < L.length; l++) {
      const x = this.bufs[l - 1], y = this.bufs[l], fin = L[l - 1], fout = L[l], last = l === L.length - 1;
      const bo = o + fout * fin;
      for (let j = 0; j < fout; j++) {
        let s = w[bo + j]; const r = o + j * fin;
        for (let i = 0; i < fin; i++) s += w[r + i] * x[i];
        y[j] = last ? s : Math.tanh(s);
      }
      o = bo + fout;
    }
    return this.bufs[L.length - 1][0];
  }
}

export class NnPolicy implements Policy {
  readonly name: string;
  readonly heuristic: EtaPolicy;
  private mlp: Mlp;
  private scale: number;
  private regime: Regime = 'offpeak';
  constructor(params: RegimeParams, readonly nn: NnWeights, name = 'nn') {
    this.name = name;
    this.heuristic = new EtaPolicy(params, name);
    this.mlp = new Mlp(nn.layers, nn.weights);
    this.scale = nn.scale ?? NN_SCALE;
    if (nn.layers[0] !== NN_FEATURES) throw new Error(`NN input must be ${NN_FEATURES} features`);
  }

  reassignInterval(sim: Sim) { return this.heuristic.reassignInterval(sim); }
  parkTarget(sim: Sim, car: Car) { return this.heuristic.parkTarget(sim, car); }

  /** heuristic cost + scale·residual; identical arithmetic to EtaPolicy.cost for the base part */
  cost(sim: Sim, car: Car, call: HallCall, p: EtaParams): number {
    const L = call.level, d = call.dir;
    let pending = 0, waiting = 0;
    for (const h of sim.hallCalls) if (h.assigned === car.id) { pending++; if (h.level !== L || h.dir !== d) waiting += h.pax.length; }
    const fill = car.pax.length / car.cap;
    const eta = etaOf(sim, car, L, d, sim.dwell * p.stopCost);
    const base = eta + p.wPending * pending + p.wPax * car.pax.length + p.wFill * fill * fill + p.wWaiting * waiting / car.cap;
    const x = this.mlp.input, span = Math.max(1, sim.levels - 1), own = call.assigned === car.id ? 1 : 0;
    const other = pending - own;
    x[0] = eta / (sim.levels * sim.secPerFloor);
    x[1] = Math.abs(car.pos - L) / span;
    x[2] = car.dir === 0 ? 0 : car.dir === d && (d > 0 ? L >= car.pos - 1e-6 : L <= car.pos + 1e-6) ? 1 : -1;
    x[3] = car.phase === 'idle' && car.carCalls.size === 0 && other === 0 ? 1 : 0;
    x[4] = stopsBefore(sim, car, L) / 5;
    x[5] = fill;
    x[6] = other / 5;
    x[7] = waiting / car.cap;
    x[8] = call.pax.length / car.cap;
    x[9] = Math.min(3, (sim.t - call.t0) / 60);
    x[10] = (car.carCalls.size + pending) / 8;
    x[11] = this.regime === 'morning' ? 1 : 0;
    x[12] = this.regime === 'evening' ? 1 : 0;
    x[13] = L / span;
    x[14] = d;
    x[15] = 1 / sim.cars.length;
    x[16] = own;
    x[17] = car.phase === 'doors' ? 1 : 0;
    return base + this.scale * this.mlp.forward();
  }

  assign(sim: Sim, call: HallCall) {
    const p = this.heuristic.p(sim); this.regime = sim.regime();
    let best = -1, bc = Infinity;
    for (const c of sim.cars) { const v = this.cost(sim, c, call, p); if (v < bc) { bc = v; best = c.id; } }
    return { car: best, cost: bc };
  }

  reassign(sim: Sim) {
    const p = this.heuristic.p(sim), gain = p.reassignGain + this.nn.margin; this.regime = sim.regime();
    for (const call of sim.hallCalls) {
      const cur = sim.cars[call.assigned];
      if (Math.abs(cur.pos - call.level) < 0.7 && (cur.dir === call.dir || cur.dir === 0 || cur.phase === 'doors')) continue;
      let best = call.assigned, bc = this.cost(sim, cur, call, p);
      for (const c of sim.cars) {
        if (c.id === call.assigned) continue;
        const v = this.cost(sim, c, call, p);
        if (v + gain < bc) { bc = v; best = c.id; }
      }
      if (best !== call.assigned) sim.moveCall(call, best, gain);
    }
  }
}
