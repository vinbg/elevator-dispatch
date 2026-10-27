/* Small DOM + formatting helpers shared by the UI modules. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const PALETTE = ['#FF6E5E', '#53C7F0', '#7ED491', '#C792EA', '#FFB454', '#F06595', '#63E6BE', '#A0C4FF'];
export const carColor = (i: number) => i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 47) % 360)} 72% 64%)`;

export const lblFor = (i: number, lob: number) => i < lob ? '−' + (lob - i) : String(i - lob + 1);
export const signedFor = (i: number, lob: number) => i < lob ? (i - lob) : (i - lob + 1);
export const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const arrow = (d: number) => d > 0 ? '▲' : d < 0 ? '▼' : '';

export function segWire(id: string, cb: (v: string) => void) {
  const seg = $(id);
  seg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset.v ?? '');
  });
}
export function setSeg(id: string, val: string | number) {
  document.querySelectorAll<HTMLButtonElement>('#' + id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === String(val)));
}
