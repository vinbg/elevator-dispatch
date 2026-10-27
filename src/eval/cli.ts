/* npm run eval -- [--policy naive|v0|champion|nn|all[,…]] [--split test|validation] [--seeds N]
                   [--champion path] [--nn path] [--out dir] [--quiet] [--gate]
   Runs every scenario of the split for every policy (paired), prints the tables, writes the leaderboard. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SUITE, suiteScenarios, type SplitName } from '../traffic/scenario.ts';
import { BASELINES, POLICY_IDS, championSpec, naiveSpec, runAll, v0Spec, type PolicyId, type PolicySpec } from './suite.ts';
import { leaderboard, renderMarkdown, renderText } from './report.ts';

const { values: a } = parseArgs({
  options: {
    policy: { type: 'string', default: 'all' }, split: { type: 'string', default: 'test' }, seeds: { type: 'string' },
    champion: { type: 'string', default: 'results/champion.json' }, nn: { type: 'string', default: 'results/nn-champion.json' },
    out: { type: 'string' }, quiet: { type: 'boolean', default: false }, gate: { type: 'boolean', default: false },
  },
});
const die = (msg: string): never => { console.error(`eval: ${msg}`); process.exit(2); };
const log = (msg: string) => { if (!a.quiet) console.error(msg); };

const split = a.split as SplitName;
if (split !== 'test' && split !== 'validation') die(`--split must be test|validation, got ${a.split}`);
const [s0, s1] = SUITE.seeds[split], allSeeds = s1 - s0;
const seeds = a.seeds === undefined ? allSeeds : Number(a.seeds);
if (!Number.isInteger(seeds) || seeds < 1) die(`--seeds must be a positive integer, got ${a.seeds}`);

const asked = a.policy.split(',').map(s => s.trim()).filter(Boolean);
for (const p of asked) if (p !== 'all' && !(POLICY_IDS as readonly string[]).includes(p)) die(`unknown policy "${p}" (${POLICY_IDS.join('|')}|all)`);
const want = new Set<PolicyId>(asked.includes('all') ? POLICY_IDS : asked as PolicyId[]);
for (const b of BASELINES) want.add(b);                     // baselines always run: every comparison is against them
if (a.gate) want.add('champion');

const specs: PolicySpec[] = [];
for (const id of POLICY_IDS) {
  if (!want.has(id)) continue;
  if (id === 'naive') specs.push(naiveSpec);
  else if (id === 'v0') specs.push(v0Spec);
  else {
    const { spec, why } = championSpec(id, id === 'nn' ? a.nn : a.champion);
    if (spec) specs.push(spec);
    else if (id === 'champion' || !asked.includes('all')) console.error(`eval: skipping ${id} — ${why}`);   // a missing nn under "all" is normal
  }
}
if (a.gate && !specs.some(s => s.id === 'champion')) die('--gate needs a champion');

const scs = suiteScenarios(split, { seeds });
log(`running ${specs.length} policies × ${scs.length} scenarios (${split}, ${Math.min(seeds, allSeeds)} seeds)…`);
const results = runAll(scs, specs, (id, ms) => log(`  ${id.padEnd(8)} ${(ms / 1000).toFixed(1)} s`));
const lb = leaderboard(scs, results, split, [s0, s1]);
console.log('\n' + renderText(lb, { quiet: a.quiet }));

// the committed leaderboard is the full test split with every policy; anything else needs an explicit --out
const full = split === 'test' && seeds >= allSeeds && asked.includes('all');
const outDir = a.out ?? (full ? 'results' : null);
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'leaderboard.json'), JSON.stringify(lb, null, 2) + '\n');
  writeFileSync(join(outDir, 'leaderboard.md'), renderMarkdown(lb));
  console.log(`\nwrote ${join(outDir, 'leaderboard.json')} and ${join(outDir, 'leaderboard.md')}`);
} else log('\n(partial run — leaderboard not written; pass --out DIR to write it anyway)');

if (a.gate) {
  const c = lb.comparisons.find(x => x.policy === 'champion' && x.baseline === 'v0')!;
  console.log(`\ngate: champion vs v0 ${c.beats ? 'PASS' : 'FAIL'} (Δ ${c.meanDiff.toFixed(3)}, CI [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}], Δp95 ${c.p95Diff.toFixed(2)} s)`);
  if (!c.beats) process.exitCode = 1;
}
