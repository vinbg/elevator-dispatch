/* Setup screen: the editable building config (persisted as localStorage `elevCfg`). */
import type { BuildingConfig, ElevatorSpec } from '../sim/types.ts';
import { designPeak as peakOf, type Pattern } from '../traffic/traffic.ts';
import { t } from './i18n.ts';
import { $, clamp, carColor, lblFor, signedFor, segWire, setSeg } from './util.ts';

export interface UiCfg {
  floorsAbove: number; parking: number; apartments: number; residents: number;
  secPerFloor: number; doorTime: number; hold: number; boardTime: number; parkingEnabled: boolean;
  pattern: Pattern; rateAuto: boolean; rate: number;
  elevators: ElevatorSpec[];   // home = signed floor number
}

export const MAX_CARS = 16;
export const DEFAULT_CFG: UiCfg = {
  floorsAbove: 17, parking: 1, apartments: 230, residents: 460,
  secPerFloor: 1.5, doorTime: 2.0, hold: 2.0, boardTime: 0.5, parkingEnabled: true,
  pattern: 'mixed', rateAuto: false, rate: 5,
  elevators: [{ cap: 8, home: 1 }, { cap: 12, home: 1 }, { cap: 12, home: 9 }, { cap: 8, home: 14 }],
};
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

function loadCfg(): UiCfg {
  try {
    const s = localStorage.getItem('elevCfg');
    if (s) {
      const c = JSON.parse(s) as Partial<UiCfg> & { dwell?: number };
      if (c && c.elevators && c.elevators.length) {
        const m: UiCfg & { dwell?: number } = { ...clone(DEFAULT_CFG), ...c };
        if (c.doorTime == null && c.dwell != null) { m.doorTime = Math.max(0, c.dwell - 1.5); m.hold = 1.5; }  // migrate old single dwell
        delete m.dwell;
        return m;
      }
    }
  } catch { /* corrupt or blocked storage */ }
  return clone(DEFAULT_CFG);
}
export function saveCfg() { try { localStorage.setItem('elevCfg', JSON.stringify(cfg)); } catch { /* ignore */ } }
export let cfg = loadCfg();

export const designPeak = () => peakOf(cfg.residents);

export const buildingOf = (c: UiCfg): BuildingConfig => ({
  floorsAbove: c.floorsAbove, parking: c.parking, apartments: c.apartments, residents: c.residents,
  secPerFloor: c.secPerFloor, doorTime: c.doorTime, hold: c.hold, boardTime: c.boardTime,
  elevators: c.elevators.map(e => ({ cap: clamp(e.cap, 2, 30), home: e.home })),
});

export function capSummary(elevs: ElevatorSpec[]) {
  const m = new Map<number, number>(); elevs.forEach(e => m.set(e.cap, (m.get(e.cap) || 0) + 1));
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${n}×${c}`).join(' + ');
}

export function buildSpec() {
  const parkPart = cfg.parking ? `−${cfg.parking} ${t('w_parking')} + ` : '';
  return `<b>${cfg.apartments} ${t('w_apts')}</b> · ≈<b>${cfg.residents} ${t('w_res')}</b> · `
       + `${cfg.parking + cfg.floorsAbove} ${t('w_levels')} (${parkPart}1–${cfg.floorsAbove}) · `
       + `<b>${cfg.elevators.length}</b> ${t('w_cars')} · ${capSummary(cfg.elevators)} · <b>${cfg.secPerFloor} s</b>/${t('w_floor')}`;
}
const syncSpec = () => { $('spec').innerHTML = buildSpec(); };

export function updateElevSummary() {
  const tot = cfg.elevators.reduce((s, e) => s + e.cap, 0);
  $('elevSummary').textContent = t('elev_summary')(cfg.elevators.length, capSummary(cfg.elevators), tot);
}

const num = (id: string) => +$<HTMLInputElement>(id).value;
const setVal = (id: string, v: number) => { $<HTMLInputElement>(id).value = String(v); };

function homeOptions(sel: number) {
  const lob = clamp(num('cfgParking') || 0, 0, 6);
  const fa = clamp(num('cfgFloors') || 2, 2, 60);
  let html = '';
  for (let i = lob + fa - 1; i >= 0; i--) {
    const sf = signedFor(i, lob);
    html += `<option value="${sf}" ${sf === sel ? 'selected' : ''}>${lblFor(i, lob)}</option>`;
  }
  return html;
}
function renderElevRows() {
  const host = $('elevRows');
  host.innerHTML = '';
  cfg.elevators.forEach((e, i) => {
    const row = document.createElement('div'); row.className = 'erow';
    row.innerHTML = `<div class="tagn" style="color:${carColor(i)}">${String.fromCharCode(65 + i)}</div>
      <input type="number" min="2" max="30" step="1" value="${e.cap}" data-i="${i}" data-k="cap">
      <select data-i="${i}" data-k="home">${homeOptions(e.home)}</select>`;
    host.appendChild(row);
  });
  host.querySelectorAll<HTMLInputElement>('input[data-k=cap]').forEach(inp => {
    inp.onchange = () => { const i = +inp.dataset.i!; cfg.elevators[i].cap = clamp(Math.round(+inp.value || 8), 2, 30); inp.value = String(cfg.elevators[i].cap); updateElevSummary(); syncSpec(); };
  });
  host.querySelectorAll<HTMLSelectElement>('select[data-k=home]').forEach(sel => {
    sel.onchange = () => { cfg.elevators[+sel.dataset.i!].home = +sel.value; };
  });
  updateElevSummary();
}
const syncRateAuto = () => {
  $('rateManualWrap').style.display = cfg.rateAuto ? 'none' : '';
  $('rateAutoLbl').textContent = t('rate_auto')(designPeak());
};
export function renderSetup() {
  setVal('cfgFloors', cfg.floorsAbove);
  setVal('cfgParking', cfg.parking);
  setVal('cfgApts', cfg.apartments);
  setVal('cfgRes', cfg.residents);
  setVal('cfgSpf', cfg.secPerFloor);
  setVal('cfgDoor', cfg.doorTime);
  setVal('cfgHold', cfg.hold);
  setVal('cfgBoard', cfg.boardTime);
  setVal('cfgCount', cfg.elevators.length);
  setVal('cfgRate', cfg.rate);
  $<HTMLInputElement>('cfgRateAuto').checked = cfg.rateAuto;
  $<HTMLInputElement>('cfgPark').checked = cfg.parkingEnabled;
  setSeg('cfgPatSeg', cfg.pattern);
  syncRateAuto();
  renderElevRows();
  syncSpec();
}
function syncElevCount(n: number) {
  n = clamp(Math.round(n || 1), 1, MAX_CARS);
  const spread = [1, 1, 9, 14, 5, 17, 3, 11, 7, 12, 2, 16, 4, 10, 6, 13];
  while (cfg.elevators.length < n) { const i = cfg.elevators.length; cfg.elevators.push({ cap: i % 2 ? 12 : 8, home: spread[i % spread.length] || 1 }); }
  while (cfg.elevators.length > n) cfg.elevators.pop();
}

export function initSetup(onStart: () => void) {
  const bind = (id: string, fn: () => void) => { $<HTMLInputElement>(id).onchange = fn; };
  bind('cfgFloors', () => { cfg.floorsAbove = clamp(Math.round(num('cfgFloors') || 17), 2, 60); setVal('cfgFloors', cfg.floorsAbove); renderElevRows(); syncSpec(); });
  bind('cfgParking', () => { cfg.parking = clamp(Math.round(num('cfgParking') || 0), 0, 6); setVal('cfgParking', cfg.parking); renderElevRows(); syncSpec(); });
  bind('cfgApts', () => { cfg.apartments = clamp(Math.round(num('cfgApts') || 1), 1, 5000); setVal('cfgApts', cfg.apartments); syncSpec(); });
  bind('cfgRes', () => { cfg.residents = clamp(Math.round(num('cfgRes') || 1), 1, 20000); setVal('cfgRes', cfg.residents); $('rateAutoLbl').textContent = t('rate_auto')(designPeak()); syncSpec(); });
  bind('cfgSpf', () => { cfg.secPerFloor = clamp(num('cfgSpf') || 1.5, 0.3, 6); setVal('cfgSpf', cfg.secPerFloor); syncSpec(); });
  bind('cfgDoor', () => { cfg.doorTime = clamp(num('cfgDoor') || 0, 0, 12); setVal('cfgDoor', cfg.doorTime); });
  bind('cfgHold', () => { cfg.hold = clamp(num('cfgHold') || 1.5, 0.5, 12); setVal('cfgHold', cfg.hold); });
  bind('cfgBoard', () => { const v = num('cfgBoard'); cfg.boardTime = clamp(Number.isFinite(v) ? v : DEFAULT_CFG.boardTime, 0, 3); setVal('cfgBoard', cfg.boardTime); });
  bind('cfgCount', () => { syncElevCount(num('cfgCount')); setVal('cfgCount', cfg.elevators.length); renderElevRows(); syncSpec(); });
  bind('cfgRate', () => { cfg.rate = clamp(Math.round(num('cfgRate') || 0), 0, 150); setVal('cfgRate', cfg.rate); });
  bind('cfgRateAuto', () => { cfg.rateAuto = $<HTMLInputElement>('cfgRateAuto').checked; syncRateAuto(); });
  bind('cfgPark', () => { cfg.parkingEnabled = $<HTMLInputElement>('cfgPark').checked; });
  segWire('cfgPatSeg', v => { cfg.pattern = v as Pattern; });
  $('defaultsBtn').onclick = () => { cfg = clone(DEFAULT_CFG); renderSetup(); };
  $('startBtn').onclick = () => { saveCfg(); onStart(); };
}
