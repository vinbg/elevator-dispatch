/* UI entry: wires the legacy interface (scene, panels, controls, log, stats, setup, i18n, tooltips)
   onto the headless engine. All simulation state lives in `sim`; this file only renders and forwards input. */
import { Sim, DT, type Policy } from '../sim/sim.ts';
import type { HallCall, SimEvent } from '../sim/types.ts';
import { mean, quantile } from '../sim/metrics.ts';
import { Rng } from '../sim/rng.ts';
import { EtaPolicy, V0, allRegimes } from '../policies/eta.ts';
import { naive } from '../policies/naive.ts';
import { learnedPolicy } from '../policies/learned.ts';
import { ConstantTraffic, patternRegime, type Pattern } from '../traffic/traffic.ts';
import { t, ts, lang, setLang } from './i18n.ts';
import { $, arrow, carColor, fmtT, lblFor, segWire, setSeg } from './util.ts';
import { buildSpec, buildingOf, cfg, designPeak, initSetup, renderSetup, updateElevSummary } from './setup.ts';
import * as scene from './scene.ts';
import * as learn from './learning.ts';

type Mode = 'naive' | 'v0' | 'learned';

/* ═══════════════════════ STATE ═══════════════════════ */
let sim: Sim | null = null, traffic: ConstantTraffic | null = null, unsub: (() => void) | null = null;
// ETA v0 replaying exactly the same passengers (same seed, mirrored inputs) — the live baseline for the KPI deltas
let shadow: Sim | null = null, shadowTraffic: ConstantTraffic | null = null;
let speed = 2, paused = false, running = false, mode: Mode = 'v0', acc = 0;
const uiRng = new Rng((Math.random() * 4294967296) >>> 0);   // manual-call destinations, kept off the sims' streams

const lbl = (i: number) => lblFor(i, sim ? sim.lobby : cfg.parking);
const policyFor = (m: Mode): Policy =>
  m === 'naive' ? naive : m === 'learned' ? learnedPolicy(learn.champion()) : new EtaPolicy(allRegimes(V0), 'v0');

/* ═══════════════════════ PANELS ═══════════════════════ */
const chipsHost = $('carChips');
const floorPanel = $('floorPanel');
let chips: { nm: HTMLElement; fl: HTMLElement; st: HTMLElement }[] = [];
let frows: { up: HTMLButtonElement; dn: HTMLButtonElement; who: HTMLElement }[] = [];

function buildChips(s: Sim) {
  chipsHost.innerHTML = ''; chips = [];
  for (const car of s.cars) {
    const col = carColor(car.id);
    const d = document.createElement('div'); d.className = 'carChip'; d.style.setProperty('--car', col);
    d.innerHTML = `<div class="nm"></div>
      <div class="fl">${lbl(car.home)}</div>
      <div class="st">• 0/${car.cap}</div>`;
    chipsHost.appendChild(d);
    chips.push({ nm: d.querySelector('.nm')!, fl: d.querySelector('.fl')!, st: d.querySelector('.st')! });
  }
}
function buildFloors(s: Sim) {
  floorPanel.innerHTML = ''; frows = [];
  const LEVELS = s.levels, LOBBY = s.lobby;
  for (let L = LEVELS - 1; L >= 0; L--) {
    const r = document.createElement('div');
    r.className = 'frow' + (L === LOBBY ? ' lobby' : '');
    const canUp = L < LEVELS - 1, canDn = L > 0;
    r.innerHTML = `<span class="fl">${lbl(L)}</span>
      <button class="cbtn up" ${canUp ? '' : 'disabled style="visibility:hidden"'}>▲</button>
      <button class="cbtn dn" ${canDn ? '' : 'disabled style="visibility:hidden"'}>▼</button>
      <span class="who"></span>`;
    floorPanel.appendChild(r);
    const up = r.querySelector<HTMLButtonElement>('.up')!, dn = r.querySelector<HTMLButtonElement>('.dn')!, who = r.querySelector<HTMLElement>('.who')!;
    if (canUp) up.onclick = () => { call(L, uiRng.int(L + 1, LEVELS - 1)); };
    if (canDn) dn.onclick = () => {
      let dest: number; const rr = uiRng.next();
      if (L > LOBBY) dest = rr < 0.7 ? LOBBY : (LOBBY > 0 && rr < 0.88 ? uiRng.int(0, LOBBY - 1) : uiRng.int(LOBBY, L - 1));
      else dest = L - 1;
      if (dest >= L) dest = L - 1;
      call(L, dest);
    };
    frows[L] = { up, dn, who };
  }
}
function call(o: number, d: number) { sim?.addPassenger(o, d); shadow?.addPassenger(o, d); }
function setBtn(btn: HTMLButtonElement, call: HallCall | undefined) {
  if (btn.disabled) return;
  if (call && call.assigned >= 0) { btn.classList.add('active'); btn.style.background = carColor(call.assigned); }
  else { btn.classList.remove('active'); btn.style.background = ''; }
}
function setLant(span: HTMLElement, call: HallCall | undefined) {
  if (call && call.assigned >= 0) { span.classList.add('on'); span.style.color = carColor(call.assigned); }
  else { span.classList.remove('on'); span.style.color = 'transparent'; }
}
function refreshFloors() {
  if (!sim) return;
  for (let L = 0; L < sim.levels; L++) {
    const f = frows[L]; if (!f) continue;
    const cu = sim.hallCalls.find(h => h.level === L && h.dir > 0);
    const cd = sim.hallCalls.find(h => h.level === L && h.dir < 0);
    setBtn(f.up, cu); setBtn(f.dn, cd);
    let html = '';
    for (const c of [cu, cd]) if (c && c.assigned >= 0)
      html += `<span class="dot" style="color:${carColor(c.assigned)}"></span><span class="n">${c.pax.length}</span>`;
    f.who.innerHTML = html;
    const ln = scene.lanterns[L]; if (ln) { setLant(ln.up, cu); setLant(ln.dn, cd); }
  }
}

/* ═══════════════════════ LIVE CONTROLS ═══════════════════════ */
segWire('algSeg', v => {
  mode = v === 'naive' || v === 'learned' ? v : 'v0';
  if (!sim || !traffic) return;
  // restart both runs from an empty building so the KPI deltas compare like with like
  startRun(traffic.ratePerMin, traffic.pattern, sim.parking);
  applyLang(lang); refreshStats(); refreshFloors();
  logEv(t(mode === 'naive' ? 'ev_alg_naive' : mode === 'learned' ? 'ev_alg_learned' : 'ev_alg_smart'));
});
segWire('patSeg', v => {
  const p = v as Pattern;
  if (traffic) traffic.pattern = p;
  if (shadowTraffic) shadowTraffic.pattern = p;
  learn.regime(patternRegime(p));
});
segWire('spdSeg', v => { speed = +v; });
segWire('langSeg', v => applyLang(v));
const PANES: Record<string, string> = { live: 'paneLive', learn: 'learnCard', log: 'paneLog' };
segWire('tabSeg', v => {
  for (const [k, id] of Object.entries(PANES)) $(id).hidden = k !== v;
  if (v === 'learn') learn.draw();
});
const rateSl = $<HTMLInputElement>('rateSl'), rateV = $('rateV');
const rate = () => traffic ? traffic.ratePerMin : 0;
function rateZone() {
  const p = designPeak(), r = rate();
  if (r === 0) return t('rate_stop');
  if (r <= Math.max(1, p * 0.4)) return t('rate_night');
  if (r <= p * 1.05) return t('rate_normal');
  if (r <= p * 1.8) return t('rate_peak');
  return t('rate_stress');
}
function syncRate() {
  rateV.textContent = rate() + ' ' + t('unit_pm');
  $('rateHint').innerHTML = t('rate_hint')(rateZone());
}
rateSl.oninput = () => {
  if (traffic) traffic.ratePerMin = +rateSl.value;
  if (shadowTraffic) shadowTraffic.ratePerMin = +rateSl.value;
  syncRate();
};
const parkChk = $<HTMLInputElement>('parkChk');
parkChk.onchange = () => {
  for (const s of [sim, shadow]) if (s) { s.parking = parkChk.checked; s.cars.forEach(c => c.dirty = true); }
};
function resetMetrics() { sim?.resetMetrics(); shadow?.resetMetrics(); }
$('resetBtn').onclick = () => { if (!sim) return; resetMetrics(); logEv(t('ev_reset')); };
const pauseBtn = $('pauseBtn');
pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? t('btn_play') : t('btn_pause'); pauseBtn.classList.toggle('on', paused); };
$('cfgBtn').onclick = () => reconfigure();

/* ticker + log */
const tickerEl = $('ticker');
const logHost = $('log');
const carTag = (id: number) => `<b class="cn" style="background:${carColor(id)}">${sim ? sim.cars[id].name : ''}</b>`;
function logEv(html: string, at = sim ? sim.t : 0) {
  const e = document.createElement('div'); e.className = 'e';
  e.innerHTML = `<span class="t">${fmtT(at)}</span><span>${html}</span>`;
  logHost.prepend(e);
  while (logHost.children.length > 80) logHost.removeChild(logHost.lastChild!);
  tickerEl.textContent = `${fmtT(at)} · ${e.children[1].textContent}`;
}
function onEvent(ev: SimEvent) {
  const s = sim!;
  switch (ev.type) {
    case 'assign':
      logEv(t('ev_call')(lbl(ev.call.level), arrow(ev.call.dir), carTag(ev.car), Math.max(1, ev.cost).toFixed(0)), ev.t); break;
    case 'reassign':
      logEv(t('ev_reassign')(lbl(ev.call.level), arrow(ev.call.dir), carTag(ev.from), carTag(ev.to), ev.gain.toFixed(0)), ev.t); break;
    case 'full':
      logEv(t('ev_full')(carTag(ev.car), s.cars[ev.car].cap, ev.remaining, lbl(ev.level)), ev.t); break;
    case 'dropoff':
      logEv(t('ev_drop')(carTag(ev.car), ev.n, lbl(ev.level), ev.avgTrip.toFixed(1)), ev.t); break;
    case 'pickup':
      logEv(t('ev_pick')(carTag(ev.car), ev.n, lbl(ev.level), arrow(ev.dir), ev.avgWait.toFixed(1)), ev.t); break;
    case 'policy': break;   // mode lines are logged by the toggle / learning hot-swap
  }
}

/* stats */
const secs = (v: number) => v.toFixed(1) + '<span class="u">s</span>';
/** live delta vs the shadow ETA v0 run; lower is better for every KPI that has one.
    Hidden until both runs have `min` samples — single live runs are noisy, tails especially. */
function delta(cur: number, base: number, n: number, nb: number, min = 100) {
  if (mode === 'v0') return `<span class="delta flat">${t('kpi_baseline')}</span>`;
  if (n < min || nb < min || !(base > 0)) return t('kpi_measuring');
  const pct = (cur - base) / base * 100;
  const cls = Math.abs(pct) < 1 ? 'flat' : pct < 0 ? 'good' : 'bad';
  return `<span class="delta ${cls}">${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(0)}%</span> ${t('kpi_vs')}`;
}
function refreshStats() {
  if (!sim) return;
  const m = sim.metrics, now = sim.t, b = shadow?.metrics;
  const nw = m.waits.length, nbw = b ? b.waits.length : 0;
  $('sWait').innerHTML = nw ? secs(mean(m.waits)) : '—';
  $('sP95').innerHTML = nw ? secs(quantile(m.waits, 0.95)) : '—';
  $('sTrip').innerHTML = m.trips.length ? secs(mean(m.trips)) : '—';
  $('dWait').innerHTML = b ? delta(mean(m.waits), mean(b.waits), nw, nbw) : '';
  $('dP95').innerHTML = b ? delta(quantile(m.waits, 0.95), quantile(b.waits, 0.95), nw, nbw, 200) : '';
  $('dTrip').innerHTML = b ? delta(mean(m.trips), mean(b.trips), m.trips.length, b.trips.length) : '';
  let mx = 0;
  for (const h of sim.hallCalls) for (const p of h.pax) mx = Math.max(mx, now - p.t0);
  $('sMax').innerHTML = sim.hallCalls.length ? secs(mx) : '—';
  const dur = now - m.t0;
  if (dur > 10 && m.served > 0) {
    const pm = m.served / dur * 60;
    $('sRate').innerHTML = pm.toFixed(1) + `<span class="u">${t('unit_pm')}</span>`;
    $('sRateL').textContent = t('kpi_rate_sub')(Math.round(pm * 60), fmtT(dur));
  } else { $('sRate').innerHTML = '—'; $('sRateL').textContent = t('kpi_measuring'); }
  $('kpiNote').innerHTML = mode === 'v0' ? t('kpi_note_v0')
    : t('kpi_note_cmp')(t(mode === 'naive' ? 'alg_naive' : 'alg_learned'), m.served);
}

/* ═══════════════════════ LANG ═══════════════════════ */
function applyLang(l: string) {
  setLang(l === 'bg' ? 'bg' : 'en');
  try { localStorage.setItem('elevLang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  document.title = t('title');
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(e => { e.textContent = ts(e.dataset.t); });
  document.querySelectorAll<HTMLElement>('[data-th]').forEach(e => { e.innerHTML = ts(e.dataset.th); });
  setSeg('langSeg', lang);
  $('spec').innerHTML = buildSpec();
  $('rateAutoLbl').textContent = t('rate_auto')(designPeak());
  updateElevSummary();
  pauseBtn.textContent = paused ? t('btn_play') : t('btn_pause');
  if (sim) {
    sim.cars.forEach((car, i) => { if (chips[i]) chips[i].nm.textContent = `${car.name} · ${car.cap} ${t('ppl')}`; });
    for (const f of frows) if (f) { f.up.title = t('call_up_title'); f.dn.title = t('call_dn_title'); }
    syncRate(); refreshStats();
  }
  learn.render();
  if (!running) tickerEl.textContent = t('ticker_init');
}

/* ═══════════════════════ GENERATE / VIEWS ═══════════════════════ */
/** start a fresh run of the selected dispatcher next to its ETA v0 shadow, both from the same seed and empty building */
function startRun(rate: number, pattern: Pattern, parking: boolean) {
  const b = buildingOf(cfg), levels = b.parking + b.floorsAbove;
  acc = 0;
  traffic = new ConstantTraffic(rate, pattern, b.parking, levels);
  shadowTraffic = new ConstantTraffic(rate, pattern, b.parking, levels);
  unsub?.();
  const seed = (Math.random() * 4294967296) >>> 0;
  sim = new Sim(b, { policy: policyFor(mode), seed, traffic, metricsWindow: 400, parking });
  shadow = new Sim(b, { policy: policyFor('v0'), seed, traffic: shadowTraffic, metricsWindow: 400, parking });
  unsub = sim.on(onEvent);
  scene.buildScene(sim); buildChips(sim); buildFloors(sim);
  for (let k = 0; k < Math.min(6, Math.max(3, Math.round(sim.cars.length * 1.2))); k++) { traffic.spawn(sim); shadowTraffic.spawn(shadow); }
  lastVer = -1;
}
function generate() {
  mode = 'v0'; speed = 2; paused = false; scene.resetZoom();
  startRun(cfg.rateAuto ? designPeak() : cfg.rate, cfg.pattern, cfg.parkingEnabled);
  logHost.innerHTML = `<div class="e"><span class="t">0:00</span><span>${t('log_init')}</span></div>`;
  // live controls reflect config
  setSeg('algSeg', 'v0'); setSeg('patSeg', cfg.pattern); setSeg('spdSeg', '2');
  parkChk.checked = cfg.parkingEnabled;
  rateSl.max = String(Math.max(20, designPeak() * 4));
  rateSl.value = String(traffic!.ratePerMin);
  pauseBtn.classList.remove('on'); pauseBtn.textContent = t('btn_pause');
  applyLang(lang);
  logEv(t('ev_gen')(cfg.floorsAbove, cfg.parking, sim!.cars.length));
  refreshStats(); refreshFloors();
  learn.rebuild();
}
function enterApp() {
  $('setup').hidden = true; $('app').hidden = false; $('modeWrap').hidden = false;
  running = true; paused = false; scene.computeFit(); learn.draw(); scrollTo(0, 0);
}
function reconfigure() { running = false; $('app').hidden = true; $('modeWrap').hidden = true; $('setup').hidden = false; renderSetup(); }

/* ═══════════════════════ LOOP ═══════════════════════ */
let lastT = performance.now(), statT = 0, lastVer = -1;
function frame(now: number) {
  const dtReal = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (running && sim) {
    if (!paused) {
      const dt = dtReal * speed;
      sim.advance(dt); shadow?.advance(dt);
      acc += dt; while (acc >= DT - 1e-9) acc -= DT;   // mirrors Sim.advance's carry-over
    }
    scene.render(sim, dtReal, acc);
    for (const c of sim.cars) {
      const ch = chips[c.id]; if (!ch) continue;
      const flLbl = lbl(Math.round(c.pos));
      if (ch.fl.textContent !== flLbl) ch.fl.textContent = flLbl;
      const st = `${c.phase === 'move' ? arrow(c.dir) : (c.phase === 'doors' ? '◇' : '•')} ${c.pax.length}/${c.cap}`;
      if (ch.st.textContent !== st) ch.st.textContent = st;
    }
    if (sim.callsVersion !== lastVer) { lastVer = sim.callsVersion; refreshFloors(); }
    statT += dtReal;
    if (statT > 0.25) { statT = 0; refreshStats(); if (sim.hallCalls.length) refreshFloors(); }
  }
  requestAnimationFrame(frame);
}

/* ═══════════════════════ TOOLTIPS ═══════════════════════ */
const TT = document.createElement('div'); TT.id = 'tooltip'; document.body.appendChild(TT);
let tipFor: string | null = null;
function showTip(icon: HTMLElement) {
  const key = icon.dataset.tip ?? ''; const txt = ts(key);
  if (!txt) return;
  tipFor = key; TT.textContent = txt; TT.style.display = 'block';
  const r = icon.getBoundingClientRect();
  const tw = TT.offsetWidth, th = TT.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(x, innerWidth - tw - 8));
  let y = r.bottom + 8;
  if (y + th > innerHeight - 8) y = r.top - th - 8;
  TT.style.left = x + 'px'; TT.style.top = y + 'px';
}
function hideTip() { TT.style.display = 'none'; tipFor = null; }
const tipOf = (e: Event) => e.target instanceof Element ? e.target.closest<HTMLElement>('.tip') : null;
document.addEventListener('pointerover', e => { const i = tipOf(e); if (i) showTip(i); });
document.addEventListener('pointerout', e => { const i = tipOf(e); if (i) hideTip(); });
document.addEventListener('focusin', e => { const i = tipOf(e); if (i) showTip(i); });
document.addEventListener('focusout', e => { const i = tipOf(e); if (i) hideTip(); });
document.addEventListener('click', e => {               // tap-to-toggle on touch
  const i = tipOf(e);
  if (!i) { hideTip(); return; }
  e.preventDefault();
  if (TT.style.display === 'block' && tipFor === i.dataset.tip) hideTip(); else showTip(i);
});
addEventListener('scroll', hideTip, true);
addEventListener('resize', scene.computeFit);

/* ═══════════════════════ BOOT ═══════════════════════ */
try { const l = localStorage.getItem('elevLang'); if (l === 'bg' || l === 'en') setLang(l); } catch { /* ignore */ }
scene.initCamera();
initSetup(() => { generate(); enterApp(); });
learn.initLearning({
  building: () => sim ? sim.cfg : buildingOf(cfg),
  regime: () => patternRegime(traffic ? traffic.pattern : cfg.pattern),
  swap: (ch, gainPct) => {
    if (!sim || mode !== 'learned') return;
    sim.setPolicy(learnedPolicy(ch));
    if (gainPct !== null) logEv(t('ev_learn_better')(learn.fmtPct(-gainPct)));
  },
});
renderSetup();
applyLang(lang);
tickerEl.textContent = t('ticker_init');
requestAnimationFrame(frame);
