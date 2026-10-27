/* Shared engine types. Levels are 0-based indices from the lowest parking level;
   `lobby` is the index of floor 1. Signed floor numbers (…, -1, 1, 2, …) only appear
   in configs and labels. */

export interface ElevatorSpec { cap: number; home: number }   // home = signed floor number

export interface BuildingConfig {
  floorsAbove: number;
  parking: number;
  apartments: number;
  residents: number;
  secPerFloor: number;
  doorTime: number;      // open + close, seconds
  hold: number;          // doors fully open, seconds
  boardTime?: number;    // extra dwell per passenger boarding/alighting (0 = legacy timing)
  elevators: ElevatorSpec[];
}

export type Dir = 1 | -1;
export type Regime = 'morning' | 'evening' | 'offpeak';
export const REGIMES: readonly Regime[] = ['morning', 'evening', 'offpeak'];

export interface Passenger { dest: number; t0: number }
export interface HallCall { level: number; dir: Dir; t0: number; assigned: number; pax: Passenger[] }
export interface Rider { dest: number; tBoard: number }

export interface Car {
  id: number;
  name: string;
  cap: number;
  home: number;          // level index from the config
  pos: number;
  dir: -1 | 0 | 1;
  phase: 'idle' | 'move' | 'doors';
  target: number | null;
  doorLeft: number;
  parkTrip: boolean;
  noService: boolean;
  dirty: boolean;
  carCalls: Set<number>;
  pax: Rider[];
  travelled: number;     // floors moved (energy proxy)
  stops: number;         // door cycles (energy proxy)
}

export interface Stop { level: number; dir: -1 | 0 | 1 }

export type SimEvent =
  | { type: 'assign'; t: number; call: HallCall; car: number; cost: number }
  | { type: 'reassign'; t: number; call: HallCall; from: number; to: number; gain: number }
  | { type: 'full'; t: number; car: number; level: number; remaining: number }
  | { type: 'dropoff'; t: number; car: number; level: number; n: number; avgTrip: number }
  | { type: 'pickup'; t: number; car: number; level: number; n: number; dir: -1 | 0 | 1; avgWait: number }
  | { type: 'policy'; t: number; name: string };
