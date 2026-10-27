/* CSS-3D building: shafts, slabs, floor labels, hall lanterns, cars; camera drag / zoom / auto-rotate. */
import type { Sim } from '../sim/sim.ts';
import { $, clamp, carColor, lblFor } from './util.ts';

const FLOOR_H = 30, SHAFT_W = 46, GAP = 12, DEPTH = 48;
let BW = 0, BH = 0, baseScale = 1;

const world = $('world');
const zoomEl = $('zoomEl');
const stage = $('stage');

interface CarView { el: HTMLElement; occ: HTMLElement; CH: number }
export const lanterns: { up: HTMLSpanElement; dn: HTMLSpanElement }[] = [];
const views: CarView[] = [];

const shaftX = (i: number) => -BW / 2 + GAP + SHAFT_W / 2 + i * (SHAFT_W + GAP);
const yOfLine = (L: number) => BH / 2 - L * FLOOR_H;

function el(cls: string, parent: HTMLElement = world) { const e = document.createElement('div'); e.className = cls; parent.appendChild(e); return e; }
function face(parent: HTMLElement, w: number, h: number, tf: string, cls: string) {
  const f = el('face ' + cls, parent);
  f.style.cssText += `width:${w}px;height:${h}px;left:${-w / 2}px;top:${-h / 2}px;transform:${tf};`;
  return f;
}
function obj(x: number, y: number, z: number, parent?: HTMLElement) { const o = el('obj', parent); o.style.transform = `translate3d(${x}px,${y}px,${z}px)`; return o; }

export function buildScene(sim: Sim) {
  world.innerHTML = ''; lanterns.length = 0; views.length = 0;
  const N = sim.cars.length, LEVELS = sim.levels, LOBBY = sim.lobby;
  BW = N * SHAFT_W + (N + 1) * GAP;
  BH = LEVELS * FLOOR_H;
  const g = obj(0, BH / 2 + 2, 0);
  face(g, Math.max(560, BW + 260), Math.max(560, BW + 260), 'rotateX(90deg)', 'groundP');
  const labelStep = LEVELS > 26 ? 2 : 1;
  for (let L = 0; L <= LEVELS; L++) {
    const o = obj(0, yOfLine(L), 0);
    face(o, BW + 34, DEPTH + 30, 'rotateX(90deg)', L === LEVELS ? 'roof' : (L === LOBBY ? 'slab main' : 'slab'));
  }
  for (let i = 0; i < N; i++) {
    const o = obj(shaftX(i), 0, 0);
    face(o, SHAFT_W, BH, `translateZ(${DEPTH / 2}px)`, 'shaftF frontF');
    face(o, SHAFT_W, BH, `translateZ(${-DEPTH / 2}px)`, 'shaftF');
    face(o, DEPTH, BH, `rotateY(90deg) translateZ(${SHAFT_W / 2}px)`, 'shaftF');
    face(o, DEPTH, BH, `rotateY(-90deg) translateZ(${SHAFT_W / 2}px)`, 'shaftF');
  }
  for (let L = 0; L < LEVELS; L++) {
    const y = yOfLine(L) - FLOOR_H / 2;
    if (L % labelStep === 0 || L === LOBBY || L === LEVELS - 1) {
      const lab = obj(-BW / 2 - 30, y, DEPTH / 2 + 2);
      const tx = el('flabel', lab); tx.textContent = lblFor(L, LOBBY);
      tx.style.cssText += 'position:absolute;left:-13px;top:-5px;';
    }
    const lw = obj(-BW / 2 - 9, y, DEPTH / 2 + 2);
    const box = el('lant', lw); box.style.cssText += 'position:absolute;left:-7px;top:-9px;';
    const up = document.createElement('span'); up.textContent = '▲';
    const dn = document.createElement('span'); dn.textContent = '▼';
    box.append(up, dn); lanterns.push({ up, dn });
  }
  for (const car of sim.cars) {
    const CW = Math.round(clamp(26 + car.cap * 1.4, 30, 46));
    const CH = car.cap >= 12 ? 25 : 22, CD = Math.round(clamp(30 + car.cap * 1.2, 34, 46));
    const o = obj(shaftX(car.id), 0, 0); o.classList.add('car');
    const col = carColor(car.id);
    const fr = face(o, CW, CH, `translateZ(${CD / 2}px)`, 'carFace carFront'); fr.style.background = col;
    const occ = document.createElement('div'); occ.className = 'occ'; occ.textContent = '0'; fr.appendChild(occ);
    const dl = document.createElement('div'); dl.className = 'door doorL'; fr.appendChild(dl);
    const dr = document.createElement('div'); dr.className = 'door doorR'; fr.appendChild(dr);
    face(o, CW, CH, `rotateY(180deg) translateZ(${CD / 2}px)`, 'carFace').style.background = col;
    face(o, CD, CH, `rotateY(90deg) translateZ(${CW / 2}px)`, 'carFace carSide').style.background = col;
    face(o, CD, CH, `rotateY(-90deg) translateZ(${CW / 2}px)`, 'carFace carSide').style.background = col;
    face(o, CW, CD, `rotateX(90deg) translateZ(${CH / 2}px)`, 'carFace carTop').style.background = col;
    views.push({ el: o, occ, CH });
  }
  computeFit();
}

export function computeFit() {
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !BW) { baseScale = 1; return; }
  baseScale = Math.min((rect.width * 0.9) / (BW + 70), (rect.height * 0.9) / (BH + 30), 1.2);
}

/* camera */
let rx = -16, ry = -24, zoom = 1, autorot = true;
if (matchMedia('(prefers-reduced-motion: reduce)').matches) autorot = false;
let drag: { x: number; y: number; rx: number; ry: number } | null = null;
export const resetZoom = () => { zoom = 1; };

export function initCamera() {
  stage.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('.stageBtns')) return; drag = { x: e.clientX, y: e.clientY, rx, ry }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!drag) return; ry = drag.ry + (e.clientX - drag.x) * 0.4; rx = clamp(drag.rx + (e.clientY - drag.y) * 0.25, -45, 4); });
  stage.addEventListener('pointerup', () => drag = null);
  stage.addEventListener('pointercancel', () => drag = null);
  stage.addEventListener('wheel', e => { e.preventDefault(); zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.5, 2); }, { passive: false });
  const rotBtn = $('rotBtn');
  const syncRot = () => rotBtn.classList.toggle('on', autorot);
  rotBtn.onclick = () => { autorot = !autorot; syncRot(); }; syncRot();
}

/** `lead` = sim seconds accumulated but not yet stepped (smooths motion between fixed DT ticks) */
export function render(sim: Sim, dtReal: number, lead: number) {
  if (autorot && !drag) ry += dtReal * 3.5;
  zoomEl.style.transform = `scale(${baseScale * zoom})`;
  world.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
  for (const c of sim.cars) {
    const v = views[c.id]; if (!v) continue;
    let pos = c.pos;
    if (c.phase === 'move' && c.target !== null) {
      const p = pos + c.dir * lead / sim.secPerFloor;
      pos = c.dir > 0 ? Math.min(p, c.target) : Math.max(p, c.target);
    }
    v.el.style.transform = `translate3d(${shaftX(c.id)}px,${yOfLine(pos) - v.CH / 2 - 1}px,0)`;
    v.el.classList.toggle('open', c.phase === 'doors' && c.doorLeft > 0.6);
    const occ = String(c.pax.length);
    if (v.occ.textContent !== occ) v.occ.textContent = occ;
  }
}
