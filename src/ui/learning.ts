/* Learning card: drives the background learning worker, keeps the champion (localStorage),
   draws the learning curve. Opt-in; any worker failure stays in the status line. */
import bundledJson from '../../results/champion.json';
import { CHAMPION_KEY, type Champion } from '../learn/champion.ts';
import type { FromWorker, ToWorker } from '../worker/protocol.ts';
import type { BuildingConfig, Regime } from '../sim/types.ts';
import { DIMS, V0, type EtaParams } from '../policies/eta.ts';
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
// live series from the worker (current regime only)
let cands: number[] = [], champs: number[] = [], promoted: number[] = [], live: EtaParams | null = null, simHours = 0;
const clearSeries = () => { curve = []; cands = []; champs = []; promoted = []; live = null; last = null; };

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
  clearSeries(); note = null;
  if (!spawn()) return;
  state = 'running';
  post({ type: 'start', building: hooks.building(), regime: hooks.regime(), champion: champ });
  render();
}
function onMsg(m: FromWorker) {
  if (m.type === 'progress') {
    curve = m.curve.slice(); v0Score = m.v0;
    cands = m.cands.slice(); champs = m.champs.slice(); promoted = m.promoted.slice(); live = m.params; simHours = m.simHours;
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
  clearSeries();
  post({ type: 'regime', regime: r });
  render();
}
/** the building was regenerated: restart learning on it if it was running */
export function rebuild() {
  if (!worker) return;
  if (state === 'running') start();
  else { kill(); state = 'idle'; clearSeries(); render(); }
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
    clearSeries(); note = 'learn_st_reset';
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
    clearSeries(); note = 'learn_st_imported';
    post({ type: 'reset', champion: c });
    hooks.swap(c, null); render();
  };
  addEventListener('resize', draw);
  render();
}

/* ───── rendering ───── */
const regName = (r: Regime) => t(r === 'morning' ? 'reg_morning' : r === 'evening' ? 'reg_evening' : 'reg_offpeak');
/** "2.5% better" / "1.0% worse" from a signed score change vs v0 (negative = better) */
function betterHtml(pct: number) {
  const good = pct <= 0;
  return { cls: Math.abs(pct) < 0.05 ? '' : good ? 'good' : 'bad', html: `${Math.abs(pct).toFixed(1)}%<small>${t(good ? 'learn_better' : 'learn_worse')}</small>` };
}
/** champion's change vs v0 (negative = better): live from the worker, else the champion's recorded validation */
function champPct(): number | null {
  if (last) return last.pct;
  const pr = champ.perRegime?.[hooks.regime()], v = pr ?? champ.validation;
  return v && isNum(v.gainPct) ? -v.gainPct : null;
}
export function render() {
  const ls = $('learnState');
  ls.textContent = t(state === 'running' ? 'learn_running' : state === 'paused' ? 'learn_paused' : state === 'error' ? 'learn_error' : 'learn_idle');
  ls.className = 'status ' + state;
  const st = $('learnStatus');
  if (note) st.innerHTML = t(note);
  else if (state === 'running') st.innerHTML = t('learn_st_running')(regName(hooks.regime()));
  else if (state === 'paused') st.innerHTML = t('learn_st_paused');
  else if (state === 'error') st.textContent = t('learn_st_error')(errMsg);
  else st.innerHTML = t('learn_st_idle') + ' ' + t('learn_champ')(t(src === 'saved' ? 'learn_src_saved' : 'learn_src_bundled'), null);
  $('learnBtn').textContent = t(state === 'running' ? 'learn_pause' : state === 'paused' ? 'learn_resume' : 'learn_start');

  const cp = champPct(), lc = $('lChamp');
  if (cp === null) { lc.textContent = '—'; lc.className = 'v'; }
  else { const b = betterHtml(cp); lc.innerHTML = b.html; lc.className = 'v ' + b.cls; }
  $('lGen').textContent = String(last ? last.gen : 0);
  $('lHours').textContent = simHours ? t('learn_hours')(simHours < 10 ? simHours.toFixed(1) : Math.round(simHours).toLocaleString()) : '—';

  const pill = $('learnPill');
  pill.hidden = state !== 'running' && state !== 'paused';
  pill.classList.toggle('paused', state === 'paused');
  if (!pill.hidden) pill.textContent = t('learn_pill')(last ? last.gen : 0, cp === null ? '…' : `${cp <= 0 ? '−' : '+'}${Math.abs(cp).toFixed(1)}%`);

  renderLearned(); renderMilestones(); draw();
}

/* what it learned: v0 vs the learned settings for the current regime, in plain language */
function renderLearned() {
  const r = hooks.regime(), b = hooks.building();
  const p = live ?? champ.heuristic[r];
  $('lWhatSrc').textContent = live && last ? t('learn_src_live')(regName(r), last.gen) : t('learn_src_champ')(regName(r));
  const dwell = b.doorTime + b.hold, n = b.elevators.length;
  const cfgLobby = n ? b.elevators.filter(e => e.home === 1).length / n : 0;
  const dim = (k: string) => DIMS.find(d => d.key === k)!;
  const s1 = (x: number) => x.toFixed(1), pctS = (x: number) => Math.round(x * 100) + '%';
  type Row = { k: Parameters<typeof t>[0]; d: string; v0: number; now: number; fmt: (x: number) => string; v0Label?: string };
  const rows: Row[] = [
    { k: 'lp_wPending', d: 'wPending', v0: V0.wPending, now: p.wPending, fmt: s1 },
    { k: 'lp_wWaiting', d: 'wWaiting', v0: V0.wWaiting, now: p.wWaiting, fmt: s1 },
    { k: 'lp_wFill', d: 'wFill', v0: V0.wFill, now: p.wFill, fmt: s1 },
    { k: 'lp_stopCost', d: 'stopCost', v0: V0.stopCost, now: p.stopCost, fmt: x => s1(x * dwell) + ' s' },
    { k: 'lp_reassignGain', d: 'reassignGain', v0: V0.reassignGain, now: p.reassignGain, fmt: x => s1(x) + ' s' },
    { k: 'lp_reassignEvery', d: 'reassignEvery', v0: V0.reassignEvery, now: p.reassignEvery, fmt: x => s1(x) + ' s' },
    { k: 'lp_lobbyShare', d: 'lobbyShare', v0: cfgLobby, now: p.zoning ? p.zoning.lobbyShare : cfgLobby, fmt: pctS, v0Label: t('learn_cfg') },
  ];
  $('lParams').innerHTML = rows.map(row => {
    const dm = dim(row.d), at = (x: number) => Math.max(0, Math.min(100, (x - dm.lo) / (dm.hi - dm.lo) * 100));
    const a = at(row.v0), z = at(row.now), lo = Math.min(a, z), w = Math.abs(z - a);
    const v0s = row.v0Label ? `${row.fmt(row.v0)} ${row.v0Label}` : row.fmt(row.v0);
    return `<div class="prow"><span class="pn">${t(row.k)}</span>`
      + `<span class="pv">${t('learn_col_v0')} ${v0s} → <b>${row.fmt(row.now)}</b></span>`
      + `<div class="track"><div class="bar" style="left:${lo}%;width:${w}%"></div>`
      + `<span class="mk v0" style="left:${a}%"></span><span class="mk now" style="left:${z}%"></span></div></div>`;
  }).join('');
  const ins: Parameters<typeof t>[0][] = [];
  if (p.zoning && p.zoning.lobbyShare < 0.3) ins.push('ins_lobby_low');
  if (p.zoning && p.zoning.lobbyShare > 0.6) ins.push('ins_lobby_high');
  if (p.wPending > 2 * V0.wPending || p.wWaiting > 3) ins.push('ins_spread');
  if (p.reassignGain > 3.5) ins.push('ins_stable'); else if (p.reassignGain < 1) ins.push('ins_eager');
  if (p.stopCost < 0.6) ins.push('ins_stops');
  if (!ins.length) ins.push('ins_same');
  $('lInsights').innerHTML = ins.map(k => `<li>${t(k)}</li>`).join('');
}

function renderMilestones() {
  const el = $('lMilestones');
  if (!(v0Score > 0) || !champs.length) { el.innerHTML = `<li class="none">${t('learn_ms_none')}</li>`; return; }
  const sp = (sc: number) => { const pct = (sc - v0Score) / v0Score * 100; return `${pct <= 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`; };
  // the champion in effect before generation 1 is the starting point
  const start = promoted.includes(1) ? NaN : champs[0];
  el.innerHTML = promoted.slice(-5).reverse().map(g => `<li>${t('learn_ms')(g, sp(champs[g - 1] ?? champs[champs.length - 1]))}</li>`).join('')
    + (promoted.length ? '' : `<li class="none">${t('learn_ms_none')}</li>`)
    + (Number.isFinite(start) ? `<li class="start">${t('learn_ms_start')(sp(start))}</li>` : '');
}

/* chart: candidates (dots), best so far, champion in use (step), ETA v0 (dashed) */
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
  const cAcc = cv_('--accent', '#4f46e5'), cDim = cv_('--muted', '#667085'), cGood = cv_('--good', '#067647'), cGrid = cv_('--border', '#e4e7ec');
  const font = `500 10.5px ${cv_('--font', 'sans-serif')}`;
  const n = Math.max(curve.length, cands.length);
  if (n < 2) {
    g.fillStyle = cDim; g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(state === 'running' ? '…' : '—', w / 2, h / 2); return;
  }
  const all = [...curve, ...cands, ...champs].filter(Number.isFinite);
  if (v0Score > 0) all.push(v0Score);
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, hi * 0.04); lo -= span * 0.08; hi = lo + span * 1.16;
  const L = 34, R = 10, T = 10, B = 20;
  const X = (i: number) => L + (w - L - R) * i / (n - 1), Y = (v: number) => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'right';
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3, y = Y(v);
    g.strokeStyle = cGrid; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillStyle = cDim; g.fillText(v.toFixed(1), L - 6, y);
  }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('1', L, h - 6); g.textAlign = 'right'; g.fillText(String(n), w - R, h - 6);
  if (v0Score > 0) {
    g.strokeStyle = cDim; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(L, Y(v0Score)); g.lineTo(w - R, Y(v0Score)); g.stroke(); g.setLineDash([]);
    g.fillStyle = cDim; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('ETA v0', w - R, Y(v0Score) - 2);
  }
  g.fillStyle = cDim; g.globalAlpha = 0.35;
  cands.forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(v), 1.8, 0, Math.PI * 2); g.fill(); });
  g.globalAlpha = 1;
  if (champs.length > 1) {
    g.strokeStyle = cGood; g.lineWidth = 2; g.beginPath();
    champs.forEach((v, i) => { if (!i) g.moveTo(X(i), Y(v)); else { g.lineTo(X(i), Y(champs[i - 1])); g.lineTo(X(i), Y(v)); } });
    g.stroke();
    g.fillStyle = cGood;
    for (const pg of promoted) { const i = pg - 1; if (champs[i] !== undefined) { g.beginPath(); g.arc(X(i), Y(champs[i]), 3.5, 0, Math.PI * 2); g.fill(); } }
  }
  g.strokeStyle = cAcc; g.lineWidth = 1.75; g.lineJoin = 'round'; g.beginPath();
  curve.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.stroke();
}
