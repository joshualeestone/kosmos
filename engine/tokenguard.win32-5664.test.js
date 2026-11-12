'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits

/*
 * kosmos#5664 step A: the token-only guard is written on Windows, as on Linux (file-tool rules only; the shell is not
 * sandboxed there), and says it is not whole while the PATH part is not covered on Windows.
 *
 * What was measured on Windows (Claude Code 2.1.319, the card): the //c/... rules hold for Read and Edit, case-blind,
 * and through junctions and 8.3 names WHEN THE RULE NAMES THE REAL PATH; a rule on a link's own path covers nothing.
 * These tests pin what Kosmos WRITES for each of those cases; they do not run Claude Code.
 *
 * The pure arms run on any host. The filesystem arms need a Windows filesystem (a junction, an 8.3 name), so they run
 * on the Windows runner and are skipped elsewhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenguard-5664-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');
fs.mkdirSync(store.ROOT, { recursive: true });

const WIN = process.platform === 'win32';
const NEEDS_WINDOWS = !WIN && 'needs a Windows filesystem (a junction, an 8.3 name) and a Windows host';
const PIN = { panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [] };
const DEPS = { dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), accountConfigDir: null, agentConfigDirs: [], ...PIN };
const WIN_PATH = /on Windows Kosmos does not cover the folders on this PATH yet/;

function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function deny(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).permissions.deny; }
const ruleFor = (tool, p, suffix = '') => `${tool}(${setup.ruleAbs(p, 'win32')}${suffix})`;

// ---- pure arms (any host) ----

test('withRealTwins: a rule whose literal part reaches another real path gets the same rule on the real path beside it', () => {
  const real = (p) => (/^C:\\link(\\|$)/i.test(p) ? p.replace(/^C:\\link/i, 'C:\\real') : p);
  const r = setup.withRealTwins(['Read(//c/link/Kosmos/board.token)', 'Edit(//c/link/Kosmos/worlds/*/Kosmos/board.token)', 'Read(//c/plain/x)'], 'win32', real);
  assert.deepEqual(r.rules, [
    'Read(//c/link/Kosmos/board.token)', 'Read(//c/real/Kosmos/board.token)',
    'Edit(//c/link/Kosmos/worlds/*/Kosmos/board.token)', 'Edit(//c/real/Kosmos/worlds/*/Kosmos/board.token)',
    'Read(//c/plain/x)',
  ]);
  assert.deepEqual(r.unsafe, []);
});

test('withRealTwins: a real path differing only in case adds nothing (Claude Code matches case-blind on Windows)', () => {
  const r = setup.withRealTwins(['Read(//c/USERS/X/board.token)'], 'win32', (p) => p.replace('USERS\\X', 'Users\\x'));
  assert.deepEqual(r.rules, ['Read(//c/USERS/X/board.token)']);
});

test('withRealTwins: a real path the rules cannot carry ([ ]) is named, never written', () => {
  const r = setup.withRealTwins(['Read(//c/link/board.token)'], 'win32', (p) => p.replace('C:\\link', 'C:\\odd [x]'));
  assert.deepEqual(r.rules, ['Read(//c/link/board.token)']);
  assert.equal(r.unsafe.length, 1);
  assert.match(r.unsafe[0], /cannot carry/);
});

test('withRealTwins: off Windows the rules are returned as they are (CONTROL: the same input twins on win32)', () => {
  const real = () => 'C:\\real\\x';
  assert.deepEqual(setup.withRealTwins(['Read(//c/link/x)'], 'darwin', real), { rules: ['Read(//c/link/x)'], unsafe: [] });
  assert.equal(setup.withRealTwins(['Read(//c/link/x)'], 'win32', real).rules.length, 2);
});

test('launchPathDirs on Windows names the PATH part as not covered, so the guard cannot read as whole', () => {
  const w = setup.launchPathDirs(agentDir('lp'), { ...PIN, platform: 'win32' });
  assert.deepEqual(w.unsafe, ['on Windows Kosmos does not cover the folders on this PATH yet']);
});

// ---- Windows filesystem arms ----

test('on Windows the guard is written in the //c/ form, with no sandbox block, and says only the PATH part is missing', { skip: NEEDS_WINDOWS }, () => {
  const dir = agentDir('plain');
  const g = setup.guardTokenOnlyFolder(dir, 'plain', DEPS);
  assert.equal(g.ok, false);
  assert.equal(g.unsupported, undefined, 'refused as unsupported, the old answer');
  assert.match(g.because, WIN_PATH);
  assert.equal(g.otherReason, null, 'a reason other than the PATH: ' + g.otherReason);
  const d = deny(dir);
  assert.ok(d.includes(ruleFor('Read', path.join(fs.realpathSync.native(store.ROOT), 'board.token'))), 'no board.token Read rule in the //c/ form');
  assert.equal(d.filter((r) => /^\w+\(\/\/[A-Za-z]:/.test(r)).length, 0, 'a rule in the native C:\\ form, measured to match nothing');
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.sandbox, undefined);
});

test('a data folder reached through a junction is denied on its REAL path, not only on the junction', { skip: NEEDS_WINDOWS }, () => {
  const realBase = path.join(SANDBOX, 'realdata');
  fs.mkdirSync(path.join(realBase, 'Kosmos'), { recursive: true });
  const junc = path.join(SANDBOX, 'juncdata');
  fs.symlinkSync(realBase, junc, 'junction');
  const dir = agentDir('junc');
  setup.guardTokenOnlyFolder(dir, 'junc', { ...DEPS, dataRoot: path.join(junc, 'Kosmos') });
  const d = deny(dir);
  const onReal = ruleFor('Read', path.join(fs.realpathSync.native(realBase), 'Kosmos', 'board.token'));
  const onJunction = ruleFor('Read', path.join(junc, 'Kosmos', 'board.token'));
  assert.ok(d.includes(onReal), 'the token is not denied on its real path (a rule on the junction alone covers nothing): ' + JSON.stringify(d.filter((r) => /board\.token\)$/.test(r))));
  assert.ok(d.includes(onJunction), 'CONTROL: the junction spelling is the one the rules were built from');
});

test('an agent folder given by its 8.3 short name is denied on its long real path', { skip: NEEDS_WINDOWS }, (t) => {
  const longDir = agentDir('a-very-long-agent-folder-name');
  let short = '';
  try { short = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:KOSMOS_T_P).ShortPath'], { encoding: 'utf8', env: { ...process.env, KOSMOS_T_P: longDir } }).trim(); } catch { short = ''; }
  if (!short || short.toLowerCase() === longDir.toLowerCase()) { t.skip('8.3 names are off on this volume'); return; }
  setup.guardTokenOnlyFolder(short, 'shorty', DEPS);
  const d = deny(longDir);
  assert.ok(d.includes(ruleFor('Edit', path.join(fs.realpathSync.native(longDir), '.claude', 'settings.json'))), 'the agent\'s own settings file is not denied on its long path: ' + JSON.stringify(d.filter((r) => /settings\.json\)$/.test(r))));
});

test('a folder whose name holds ( ) or [ ] is refused, as on Linux: nothing written, and it says why', { skip: NEEDS_WINDOWS }, () => {
  for (const name of ['paren (x)', 'bracket [x]']) {
    const dir = agentDir(name);
    const g = setup.guardTokenOnlyFolder(dir, name.replace(/\W/g, ''), DEPS);
    assert.equal(g.ok, false, name);
    assert.match(g.because, /character the permission rules cannot carry/, name);
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false, name + ': a partial guard was written');
  }
});

test('an instruction file\'s import is covered on Windows (its backslashes are separators, not rule syntax)', { skip: NEEDS_WINDOWS }, () => {
  const dir = agentDir('imports');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'See @notes.md\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'x\n');
  const g = setup.guardTokenOnlyFolder(dir, 'imports', DEPS);
  assert.equal(g.otherReason, null, 'the import was read as a path the rules cannot carry: ' + g.otherReason);
  // A target inside an agent's folder gets one mid-path glob per name (the agents' folder, *, the name), as elsewhere.
  assert.ok(deny(dir).includes(ruleFor('Edit', path.join(path.dirname(dir), '*', 'notes.md'))), 'the imported file is not denied: ' + JSON.stringify(deny(dir).filter((r) => /notes/.test(r))));
});
