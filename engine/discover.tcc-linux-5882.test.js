'use strict';
/**
 * kosmos#5882: on a platform with no folder permission (Linux, Windows), the import scan walks ~/Documents,
 * ~/Downloads and ~/Desktop in the engine. Only macOS hands them to the app's hatch (#2125). Before, all three were
 * marked tcc on every platform, so a Linux board sent them to a hatch nothing answers and never read them.
 *
 * 🛑 SANDBOXED: HOME is a mkdtemp folder; the hatch is a stand-in that records what it is handed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tcc5882-')));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
fs.mkdirSync(process.env.HOME, { recursive: true });
const discover = require('./discover');
const platform = require('./platform');
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const AGENT = 'You are **Probe**, a project manager.\n\nMore text so the head reads.\n';
const docsAgent = path.join(process.env.HOME, 'Documents', 'probe');
fs.mkdirSync(docsAgent, { recursive: true });
fs.writeFileSync(path.join(docsAgent, 'CLAUDE.md'), AGENT);

function hatch() {
  const calls = [];
  const fn = (roots) => { calls.push(roots.map((r) => path.basename(r.dir))); return { dirs: [], loose: [], bounded: {} }; };
  fn.calls = calls;
  return fn;
}
const dirsOf = (r) => ((r && r.candidates) || []).map((c) => c.dir);

test('#5882: only macOS has the folder permission', () => {
  assert.equal(platform.hasFolderPermission('darwin'), true);
  for (const p of ['linux', 'win32', 'freebsd']) assert.equal(platform.hasFolderPermission(p), false, p);
});

test('#5882: on Linux and Windows the import roots carry no tcc mark; on macOS all three do', () => {
  for (const p of ['linux', 'win32']) {
    const roots = discover.defaultScanRoots({ importScan: true, platform: p }).filter((r) => ['Documents', 'Downloads', 'Desktop'].includes(path.basename(r.dir)));
    assert.equal(roots.length, 3, p);
    assert.ok(roots.every((r) => r.tcc !== true), `${p}: a folder was routed to the hatch`);
  }
  const mac = discover.defaultScanRoots({ importScan: true, platform: 'darwin' }).filter((r) => r.tcc === true);
  assert.deepEqual(mac.map((r) => path.basename(r.dir)).sort(), ['Desktop', 'Documents', 'Downloads']);
});

test('#5882: a Linux import scan FINDS an agent in ~/Documents and hands nothing to the hatch; macOS (control) hands it over', () => {
  for (const p of ['linux', 'win32']) {
    const h = hatch();
    const r = discover.scan({ importScan: true, platform: p, tccScan: h });
    assert.ok(dirsOf(r).includes(docsAgent), `${p}: the agent in Documents was not found`);
    assert.equal(h.calls.flat().length, 0, `${p}: the hatch was asked`);
  }
  const h = hatch();
  const mac = discover.scan({ importScan: true, platform: 'darwin', tccScan: h });
  assert.deepEqual(h.calls.flat().sort(), ['Desktop', 'Documents', 'Downloads'], 'CONTROL: macOS hands the three to the hatch');
  assert.ok(!dirsOf(mac).includes(docsAgent), 'CONTROL: on macOS the engine itself does not walk Documents');
});

test('#5882 review 1: a deep sibling tree that spends the shared budget does not starve Downloads (own budget off macOS)', () => {
  for (let i = 0; i < 40; i++) fs.mkdirSync(path.join(process.env.HOME, 'src', `d${i}`, 'x'), { recursive: true });
  const drop = path.join(process.env.HOME, 'Downloads');
  fs.mkdirSync(drop, { recursive: true });
  fs.writeFileSync(path.join(drop, 'probe.md'), 'You are **Dropped**, a planner.\n\nMore text so the head reads.\n');
  const r = discover.scan({ importScan: true, platform: 'linux', tccScan: hatch(), maxDirs: 30 });
  const files = ((r && r.importable) || []).map((x) => x.file || x.path || x.dir || '');
  assert.ok(files.some((f) => String(f).includes(path.join('Downloads', 'probe.md'))), `the agent file in Downloads was starved: ${JSON.stringify(files)}`);
  assert.equal(r.bounded.dirs, true, 'CONTROL: the shared budget really was spent (the src tree is bigger than it)');
});

test('#5882 review 1: the own budget is a real bound, and its folders are counted in bounded.visited', () => {
  for (let i = 0; i < 20; i++) fs.mkdirSync(path.join(process.env.HOME, 'Documents', `deep${i}`, 'y'), { recursive: true });
  const max = 5;
  const r = discover.scan({ importScan: true, platform: 'linux', tccScan: hatch(), maxDirs: max });
  // Both trees are bigger than the budget, so each spends it: shared plus own, never more than twice the budget.
  assert.ok(r.bounded.visited > max, `the own budget's folders were not counted: ${r.bounded.visited}`);
  assert.ok(r.bounded.visited <= 2 * max, `the own budget was not a bound: ${r.bounded.visited} folders`);
  assert.equal(r.bounded.dirs, true);
});

test('#5882 review 2: a missing root after the budget is spent exactly is not a truncation (as before); a real one is', () => {
  const only = path.join(SB, 'one-dir');
  fs.mkdirSync(only, { recursive: true });
  const r = discover.scan({ roots: [{ dir: only, maxDepth: 0 }, { dir: path.join(SB, 'not-there'), maxDepth: 3 }], maxDirs: 1 });
  assert.equal(r.bounded.dirs, false, 'a root that does not exist was counted as cut off');
  const other = path.join(SB, 'two-dir');
  fs.mkdirSync(other, { recursive: true });
  const c = discover.scan({ roots: [{ dir: only, maxDepth: 0 }, { dir: other, maxDepth: 0 }], maxDirs: 1 });
  assert.equal(c.bounded.dirs, true, 'CONTROL: a real root left unread is said');
});

test('#5882 review 3: off macOS the drop folders come before Documents, so a deep Documents cannot spend their budget', () => {
  const roots = discover.defaultScanRoots({ importScan: true, platform: 'linux' }).filter((r) => r.ownBudget);
  assert.deepEqual(roots.map((r) => path.basename(r.dir)), ['Downloads', 'Desktop', 'Documents']);
  const mac = discover.defaultScanRoots({ importScan: true, platform: 'darwin' }).filter((r) => r.tcc);
  assert.deepEqual(mac.map((r) => path.basename(r.dir)), ['Documents', 'Downloads', 'Desktop'], 'CONTROL: macOS order unchanged');
  // Documents (20+ folders from an earlier test) on an own budget of 3: the Downloads file is still read.
  const r = discover.scan({ importScan: true, platform: 'linux', tccScan: hatch(), maxDirs: 3 });
  const files = ((r && r.importable) || []).map((x) => String(x.file || x.path || x.dir || ''));
  assert.ok(files.some((f) => f.includes(path.join('Downloads', 'probe.md'))), JSON.stringify(files));
});

test('#5882 review 3: with the folder budget and the candidate cap both full, the flags read as before (count, not dirs)', () => {
  const a = path.join(SB, 'cap-a');
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, 'CLAUDE.md'), AGENT);
  const b = path.join(SB, 'cap-b');
  fs.mkdirSync(b, { recursive: true });
  const r = discover.scan({ roots: [{ dir: a, maxDepth: 0 }, { dir: b, maxDepth: 0 }], maxDirs: 1, maxCandidates: 1 });
  assert.deepEqual([r.bounded.count, r.bounded.dirs], [true, false], JSON.stringify(r.bounded));
});
