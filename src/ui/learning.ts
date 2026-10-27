/* Learning card: drives the background learning worker, keeps the champion (localStorage),
   draws the learning curve. Opt-in; any worker failure stays in the status line. */
import bundledJson from '../../results/champion.json';
import { CHAMPION_KEY, type Champion } from '../learn/champion.ts';
import type { FromWorker, ToWorker } from '../worker/protocol.ts';
import type { BuildingConfig, Regime } from '../sim/types.ts';
import { t } from './i18n.ts';
import { $ } from './util.ts';

export interface LearnHooks {
  building(): BuildingConfig;
  regime(): Regime;
  /** a new champion is in effect; `gainPct` is set when the worker promoted it */
  swap(ch: Champion, gainPct: number | null): void;
}

type State = 'idle' | 'running' | 'paused' | 'error';
type Note = 'learn_st_imported' | 'learn_st_bad' | 'learn_st_reset';

const BUNDLED = bundledJson as Champion;
let hooks: LearnHooks;
let worker: Worker | null = null, state: State = 'idle', errMsg = '', note: Note | null = null;
let champ: Champion = BUNDLED, src: 'bundled' | 'saved' = 'bundled';
let curve: number[] = [], v0Score = NaN, last: { gen: number; pct: number } | null = null;

export const champion = () => champ;
/** signed % change of the score vs v0 (negative = better) */
export const fmtPct = (x: number) => (x < 0 ? '−' : x > 0 ? '+' : '±') + Math.abs(x).toFixed(1) + '%';

/* ───── champion validation / storage ───── */
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const PKEYS = ['wPending', 'wPax', 'wFill', 'stopCost', 'wWaiting', 'reassignGain', 'reassignEvery'];
function validParams(x: unknown) {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (!PKEYS.every(k => isNum(p[k]))) return false;
  const z = p.zoning as Record<string, unknown> | null | undefined;
  return z == null || (typeof z === 'object' && isNum(z.lobbyShare) && isNum(z.spread));
}
export function isChampion(x: unknown): x is Champion {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>, h = c.heuristic as Record<string, unknown> | undefined;
  return c.version === 1 && (c.kind === 'heuristic' || c.kind === 'nn') && !!h
    && validParams(h.morning) && validParams(h.evening) && validParams(h.offpeak)
    && (c.nn === null || c.nn === undefined || typeof c.nn === 'object');
}
function loadChampion() {
  try {
    const s = localStorage.getItem(CHAMPION_KEY);
    if (s) { const c: unknown = JSON.parse(s); if (isChampion(c)) { champ = c; src = 'saved'; return; } }
  } catch { /* fall back to bundled */ }
  champ = BUNDLED; src = 'bundled';
}
function saveChampion(c: Champion) { try { localStorage.setItem(CHAMPION_KEY, JSON.stringify(c)); } catch { /* ignore */ } }
function clearChampion() { try { localStorage.removeItem(CHAMPION_KEY); } catch { /* ignore */ } }

/* ───── worker ───── */
const msgOf = (e: unknown) => e instanceof Error ? e.message : String(e);
function kill() { if (worker) { try { worker.terminate(); } catch { /* ignore */ } } worker = null; }
function fail(m: string) { kill(); state = 'error'; errMsg = m || 'unknown'; render(); }
function post(m: ToWorker) { if (!worker) return; try { worker.postMessage(m); } catch (e) { fail(msgOf(e)); } }
function spawn(): boolean {
  kill();
  try { worker = new Worker(new URL('../worker/learn.worker.ts', import.meta.url), { type: 'module' }); }
  catch (e) { fail(msgOf(e)); return false; }
  worker.onmessage = (e: MessageEvent<FromWorker>) => { try { onMsg(e.data); } catch (err) { fail(msgOf(err)); } };
  worker.onerror = e => { e.preventDefault(); fail(e.message || 'worker failed to load'); };
  worker.onmessageerror = () => fail('unreadable message');
  return true;
}
function start() {
  curve = []; last = null; note = null;
  if (!spawn()) return;
  state = 'running';
  post({ type: 'start', building: hooks.building(), regime: hooks.regime(), champion: champ });
  render();
}
function onMsg(m: FromWorker) {
  if (m.type === 'progress') {
    curve = m.curve.slice(); v0Score = m.v0;
    last = { gen: m.gen, pct: m.v0 > 0 ? (m.champion - m.v0) / m.v0 * 100 : -m.gainPct };
    note = null; render();
  } else if (m.type === 'champion') {
    if (!isChampion(m.champion)) return;
    champ = m.champion; src = 'saved'; saveChampion(champ);
    hooks.swap(champ, m.gainPct); render();
  } else if (m.type === 'error') fail(m.message);
}

/* ───── public: called by main ───── */
export function regime(r: Regime) {
  if (!worker) return;
  curve = []; last = null;
  post({ type: 'regime', regime: r });
  render();
}
/** the building was regenerated: restart learning on it if it was running */
export function rebuild() {
  if (!worker) return;
  if (state === 'running') start();
  else { kill(); state = 'idle'; curve = []; last = null; render(); }
}

export function initLearning(h: LearnHooks) {
  hooks = h;
  loadChampion();
  $('learnBtn').onclick = () => {
    if (state === 'running') { post({ type: 'pause' }); state = 'paused'; }
    else if (state === 'paused') { post({ type: 'resume' }); state = 'running'; }
    else { start(); return; }
    render();
  };
  $('learnResetBtn').onclick = () => {
    clearChampion(); champ = BUNDLED; src = 'bundled';
    curve = []; last = null; note = 'learn_st_reset';
    post({ type: 'reset', champion: champ });
    hooks.swap(champ, null); render();
  };
  $('learnExportBtn').onclick = () => {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(champ, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'champion.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { errMsg = msgOf(e); }
  };
  const file = $<HTMLInputElement>('learnFile');
  $('learnImportBtn').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0]; file.value = '';
    if (!f) return;
    let c: unknown = null;
    try { c = JSON.parse(await f.text()); } catch { /* invalid JSON */ }
    if (!isChampion(c)) { note = 'learn_st_bad'; render(); return; }
    champ = c; src = 'saved'; saveChampion(c);
    curve = []; last = null; note = 'learn_st_imported';
    post({ type: 'reset', champion: c });
    hooks.swap(c, null); render();
  };
  addEventListener('resize', draw);
  render();
}

/* ───── rendering ───── */
const regName = (r: Regime) => t(r === 'morning' ? 'reg_morning' : r === 'evening' ? 'reg_evening' : 'reg_offpeak');
export function render() {
  $('learnState').textContent = t(state === 'running' ? 'learn_running' : state === 'paused' ? 'learn_paused' : state === 'error' ? 'learn_error' : 'learn_idle');
  const st = $('learnStatus');
  if (note) st.innerHTML = t(note);
  else if (state === 'running') st.innerHTML = t('learn_st_running')(regName(hooks.regime()));
  else if (state === 'paused') st.innerHTML = t('learn_st_paused');
  else if (state === 'error') st.textContent = t('learn_st_error')(errMsg);
  else st.innerHTML = t('learn_st_idle');
  const v = champ.validation;
  $('learnGen').textContent = last ? t('learn_gen')(last.gen, fmtPct(last.pct))
    : t('learn_champ')(t(src === 'saved' ? 'learn_src_saved' : 'learn_src_bundled'), v && isNum(v.gainPct) ? fmtPct(-v.gainPct) : null);
  $('learnBtn').textContent = t(state === 'running' ? 'learn_pause' : state === 'paused' ? 'learn_resume' : 'learn_start');
  draw();
}

export function draw() {
  const cv = $<HTMLCanvasElement>('learnCurve');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const cv_ = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
  const cLine = cv_('--lantern', '#FFB454'), cDim = cv_('--dim', '#8794A6'), cGood = cv_('--good', '#7ED491');
  const pts = curve.filter(Number.isFinite);
  if (pts.length < 2) {
    g.fillStyle = cDim; g.font = `600 10px ${cv_('--mono', 'monospace')}`; g.textBaseline = 'middle';
    g.fillText('—', 10, h / 2); return;
  }
  let lo = Math.min(...pts), hi = Math.max(...pts);
  const ref = Number.isFinite(v0Score) && v0Score >= lo * 0.5 && v0Score <= hi * 2 ? v0Score : NaN;
  if (Number.isFinite(ref)) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = 6, X = (i: number) => pad + (w - 2 * pad) * i / (pts.length - 1), Y = (v: number) => pad + (h - 2 * pad) * (1 - (v - lo) / (hi - lo));
  if (Number.isFinite(ref)) {
    g.strokeStyle = cDim; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(pad, Y(ref)); g.lineTo(w - pad, Y(ref)); g.stroke(); g.setLineDash([]);
  }
  g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.strokeStyle = cLine; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
  g.lineTo(X(pts.length - 1), h - pad); g.lineTo(X(0), h - pad); g.closePath();
  g.globalAlpha = 0.12; g.fillStyle = cLine; g.fill(); g.globalAlpha = 1;
  const lv = pts[pts.length - 1];
  g.fillStyle = Number.isFinite(ref) && lv < ref ? cGood : cLine;
  g.beginPath(); g.arc(X(pts.length - 1), Y(lv), 2.5, 0, Math.PI * 2); g.fill();
}
