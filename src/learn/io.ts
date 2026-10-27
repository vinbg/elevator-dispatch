/* Node-only helpers shared by the training CLIs. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Champion } from './champion.ts';
import { V0, allRegimes } from '../policies/eta.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RESULTS = resolve(ROOT, 'results');
export const CHAMPION_FILE = resolve(RESULTS, 'champion.json');
export const NN_CHAMPION_FILE = resolve(RESULTS, 'nn-champion.json');
export const LOG_FILE = resolve(RESULTS, 'training-log.json');

/** --key value / --flag → { key: value | 'true' } */
export function args(argv = process.argv.slice(2)): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = 'true'; else { o[k] = v; i++; }
  }
  return o;
}
export const num = (a: Record<string, string>, k: string, d: number) => a[k] !== undefined ? Number(a[k]) : d;

export const readJson = <T>(f: string, d: T): T => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as T : d;
export function writeJson(f: string, v: unknown) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); }

export const v0Champion = (): Champion => ({
  version: 1, kind: 'heuristic', heuristic: allRegimes(V0), nn: null, trainedOn: 'untrained (v0 constants)', createdAt: today(),
});
export const loadChampion = (f = CHAMPION_FILE) => readJson<Champion>(f, v0Champion());
export const today = () => new Date().toISOString().slice(0, 10);

export function appendLog(entry: unknown) {
  const log = readJson<unknown[]>(LOG_FILE, []);
  log.push(entry);
  writeJson(LOG_FILE, log);
}

export const fmt = (x: number, d = 2) => x.toFixed(d);
export const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
