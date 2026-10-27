/* Always the nearest car, ignoring direction, stops and load; never reassigns. */
import type { Policy, Sim } from '../sim/sim.ts';
import type { HallCall } from '../sim/types.ts';

export const naive: Policy = {
  name: 'naive',
  assign(sim: Sim, call: HallCall) {
    let best = -1, bc = Infinity;
    for (const c of sim.cars) { const v = Math.abs(c.pos - call.level) * sim.secPerFloor; if (v < bc) { bc = v; best = c.id; } }
    return { car: best, cost: bc };
  },
};
