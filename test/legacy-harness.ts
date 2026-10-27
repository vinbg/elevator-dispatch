/* Runs the untouched original prototype (legacy/v0.html) headlessly in jsdom so the new
   engine can be checked against it. Math.random is seeded; frames are driven manually
   with a fixed 0.1 s step (speed 1×), matching the engine's DT. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { Rng } from '../src/sim/rng.ts';

const HTML = readFileSync(fileURLToPath(new URL('../legacy/v0.html', import.meta.url)), 'utf8');

export interface LegacyRun { waits: number[]; trips: number[]; served: number }

export interface Arrival { frame: number; o: number; d: number }

function boot(seed: number) {
  const rng = new Rng(seed);
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(w) {
      (w as any).requestAnimationFrame = () => 0;
      (w as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      w.Math.random = () => rng.next();
    },
  });
  return dom;
}

/** Replay a fixed arrival trace with random spawning off: arrival k is added just before frame k. */
export function replayLegacy(algo: 'smart' | 'naive', trace: Arrival[], frames: number): { waits: number[]; trips: number[] } {
  const dom = boot(1), w = dom.window as any;
  w.eval(`cfg = clone(DEFAULT_CFG); generate(); enterApp();
          hallCalls = []; cars.forEach(c => c.dirty = false); stats = { waits:[], trips:[], served:0, t0:0 };
          algo = ${JSON.stringify(algo)}; rate = 0; speed = 1; lastT = 0;
          __w = []; __t = []; const _a = arrive; arrive = function(car, level){ const nw = stats.waits.length, nt = stats.trips.length; _a(car, level);
            __w.push(...stats.waits.slice(nw)); __t.push(...stats.trips.slice(nt)); };`);
  let i = 0;
  for (let k = 1; k <= frames; k++) {
    while (i < trace.length && trace[i].frame === k) { w.addPassenger(trace[i].o, trace[i].d); i++; }
    w.frame(k * 100);
  }
  const out = JSON.parse(w.eval('JSON.stringify({ waits: __w, trips: __t })'));
  dom.window.close();
  return out;
}

export function runLegacy(o: { seed: number; algo: 'smart' | 'naive'; pattern: string; rate: number; seconds: number }): LegacyRun {
  const rng = new Rng(o.seed);
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(w) {
      (w as any).requestAnimationFrame = () => 0;
      (w as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      w.Math.random = () => rng.next();
    },
  });
  const w = dom.window as any;
  w.eval(`cfg = clone(DEFAULT_CFG); generate(); enterApp();
          algo = ${JSON.stringify(o.algo)}; pattern = ${JSON.stringify(o.pattern)}; rate = ${o.rate}; speed = 1; lastT = 0;`);
  const frames = Math.round(o.seconds / 0.1);
  for (let k = 1; k <= frames; k++) w.frame(k * 100);
  const out = JSON.parse(w.eval('JSON.stringify({ waits: stats.waits, trips: stats.trips, served: stats.served })'));
  dom.window.close();
  return out;
}
