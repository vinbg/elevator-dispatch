/* Leaderboard: the machine-readable JSON plus plain-text and Markdown renderings of it. */
import type { Regime } from '../sim/types.ts';
import type { Scenario, SplitName } from '../traffic/scenario.ts';
import { SCORE } from './run.ts';
import { GATE_DOC, breakdown, comparisons, type Agg, type Comparison, type PolicyId, type PolicyResult, type PolicySpec } from './suite.ts';

export interface PolicyEntry {
  id: PolicyId; label: string; rank: number; info?: PolicySpec['info'];
  overall: Agg; byRegime: Partial<Record<Regime, Agg>>; byBuilding: Record<string, Agg>;
}

export interface Leaderboard {
  meta: {
    date: string; split: SplitName; seeds: number; seedRange: [number, number]; scenarios: number;
    buildings: string[]; windows: string[]; score: string; gate: string; lowerIsBetter: true;
  };
  policies: PolicyEntry[];           // ranked by overall mean score
  comparisons: Comparison[];
}

export function leaderboard(scs: readonly Scenario[], results: readonly PolicyResult[], split: SplitName, seedRange: [number, number]): Leaderboard {
  const policies = results.map(r => ({ id: r.spec.id, label: r.spec.label, rank: 0, info: r.spec.info, ...breakdown(scs, r.runs) }))
    .sort((a, b) => a.overall.score - b.overall.score);
  policies.forEach((p, i) => { p.rank = i + 1; });
  return {
    meta: {
      date: new Date().toISOString(), split, seeds: new Set(scs.map(s => s.seed)).size, seedRange, scenarios: scs.length,
      buildings: [...new Set(scs.map(s => s.id.slice(0, s.id.indexOf('/'))))],
      windows: [...new Set(scs.map(s => s.id.slice(s.id.indexOf('/') + 1, s.id.indexOf('#'))))],
      score: SCORE.doc, gate: GATE_DOC, lowerIsBetter: true,
    },
    policies, comparisons: comparisons(results),
  };
}

/* ───── formatting ───── */

const f = (x: number, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '—';
const sg = (x: number, d = 2) => (x > 0 ? '+' : '') + f(x, d);
const arrow = (d: number) => d < 0 ? '↓' : d > 0 ? '↑' : '=';
const verdict = (c: Comparison) => c.hi < 0 ? 'better' : c.lo > 0 ? 'worse' : 'n.s.';

/** aligned plain-text table; columns listed in `left` are left-aligned, the rest right-aligned */
export function textTable(head: string[], rows: string[][], left: number[] = [0]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => left.includes(i) ? c.padEnd(w[i]) : c.padStart(w[i])).join('  ').trimEnd();
  return [line(head), w.map(n => '─'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}

const mdTable = (head: string[], rows: string[][], left: number[] = [0]) =>
  [`| ${head.join(' | ')} |`, `|${head.map((_, i) => left.includes(i) ? ' :--- ' : ' ---: ').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

const METRIC_HEAD = ['n', 'score', 'avgWait', 'p95Wait', 'maxWait', 'long%', 'avgTrip', 'journey', 'thru/min', 'energy', 'served', 'unserved'];
const metricRow = (a: Agg) => [String(a.n), f(a.score, 2), f(a.avgWait), f(a.p95Wait), f(a.maxWait), f(a.longWaitPct), f(a.avgTrip),
  f(a.avgJourney), f(a.throughput, 2), f(a.energy, 2), f(a.served), f(a.unserved)];

const note = (p: PolicyEntry) => p.info ? `${p.info.kind}, ${p.info.createdAt.slice(0, 10)}${p.info.sameAsV0 ? ', = v0 params' : ''}` : '';

function cmpRows(lb: Leaderboard, baseline: PolicyId, md = false): string[][] {
  return lb.comparisons.filter(c => c.baseline === baseline).map(c => [
    md ? `\`${c.policy}\`` : c.policy, f(c.candScore, 2), f(c.baseScore, 2),
    `${arrow(c.meanDiff)} ${sg(c.meanDiff)}`, `[${sg(c.lo)}, ${sg(c.hi)}]`, `${sg(c.pct, 1)}%`, sg(c.p95Diff, 1), verdict(c),
    c.beats ? (md ? '✅ pass' : '✓ pass') : (md ? '❌ fail' : '✗ fail'),
  ]);
}
const CMP_HEAD = ['policy', 'score', 'base', 'Δ score', '95% CI', 'Δ %', 'Δ p95', 'sig.', 'gate'];

export function renderText(lb: Leaderboard, opts: { quiet?: boolean } = {}): string {
  const m = lb.meta, out: string[] = [];
  out.push(`Elevator dispatch eval — ${m.split} split, ${m.scenarios} scenarios (${m.buildings.length} buildings × ${m.windows.length} windows × ${m.seeds} seeds), paired`);
  out.push(`score = ${m.score}   (lower is better)`, '');
  if (!opts.quiet) for (const p of lb.policies) {
    out.push(`▸ ${p.id} — ${p.label}${p.info ? `  [${note(p)}; ${p.info.source}]` : ''}`);
    const rows = [['overall', ...metricRow(p.overall)]];
    for (const [r, a] of Object.entries(p.byRegime)) rows.push([`  ${r}`, ...metricRow(a!)]);
    for (const [b, a] of Object.entries(p.byBuilding)) rows.push([`  ${b}`, ...metricRow(a)]);
    out.push(textTable(['', ...METRIC_HEAD], rows), '');
  }
  out.push('Leaderboard (mean over all scenarios)');
  out.push(textTable(['#', 'policy', 'score', 'avgWait', 'p95Wait', 'long%', 'avgTrip', 'energy', 'note'],
    lb.policies.map(p => [String(p.rank), p.id, f(p.overall.score, 2), f(p.overall.avgWait), f(p.overall.p95Wait),
      f(p.overall.longWaitPct), f(p.overall.avgTrip), f(p.overall.energy, 2), note(p)]), [1, 8]), '');
  for (const b of ['v0', 'naive'] as const) {
    const rows = cmpRows(lb, b);
    if (rows.length) out.push(`Paired vs ${b}  (Δ = policy − ${b}; ↓ = lower score = better)`, textTable(CMP_HEAD, rows, [0, 7, 8]), '');
  }
  out.push(`gate: ${m.gate}`);
  return out.join('\n');
}

export function renderMarkdown(lb: Leaderboard): string {
  const m = lb.meta, out: string[] = [];
  out.push('## Dispatch leaderboard', '');
  out.push(`${m.split} split · ${m.scenarios} scenarios (${m.buildings.length} buildings × ${m.windows.length} windows × ${m.seeds} seeds, seeds ${m.seedRange[0]}–${m.seedRange[0] + m.seeds - 1}) · every policy runs the same scenarios (paired) · ${m.date.slice(0, 10)}`, '');
  const vs = (id: PolicyId, b: PolicyId) => { const c = lb.comparisons.find(x => x.policy === id && x.baseline === b); return c ? `${sg(c.pct, 1)}%` : '—'; };
  const gate = (id: PolicyId) => { const c = lb.comparisons.find(x => x.policy === id && x.baseline === 'v0'); return c ? (c.beats ? '✅' : '❌') : '—'; };
  out.push(mdTable(['#', 'policy', 'score ↓', 'avg wait (s)', 'p95 wait (s)', 'waits > 60 s', 'avg trip (s)', 'energy', 'vs naive', 'vs v0', 'beats v0'],
    lb.policies.map(p => [String(p.rank), `\`${p.id}\``, `**${f(p.overall.score, 2)}**`, f(p.overall.avgWait), f(p.overall.p95Wait),
      `${f(p.overall.longWaitPct)}%`, f(p.overall.avgTrip), f(p.overall.energy, 2), vs(p.id, 'naive'), vs(p.id, 'v0'), gate(p.id)]), [1]), '');
  const regimes = Object.keys(lb.policies[0]?.byRegime ?? {}) as Regime[];
  if (regimes.length) {
    out.push('**Score by regime**', '');
    out.push(mdTable(['policy', ...regimes], lb.policies.map(p => [`\`${p.id}\``, ...regimes.map(r => f(p.byRegime[r]!.score, 2))])), '');
  }
  const buildings = m.buildings;
  out.push('**Score by building**', '');
  out.push(mdTable(['policy', ...buildings], lb.policies.map(p => [`\`${p.id}\``, ...buildings.map(b => f(p.byBuilding[b].score, 2))])), '');
  for (const b of ['v0', 'naive'] as const) {
    const rows = cmpRows(lb, b, true);
    if (rows.length) out.push(`**Paired vs \`${b}\`** (Δ = policy − ${b}, 95% bootstrap CI)`, '', mdTable(CMP_HEAD, rows, [0, 7, 8]), '');
  }
  out.push(`**Score** (lower is better): \`${m.score}\``, '', `**Gate**: ${m.gate}.`, '');
  return out.join('\n');
}
