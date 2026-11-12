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
const WIN_PATH = /on Windows Kosmos does not yet cover the programs this agent starts from/;

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
  assert.deepEqual(setup.withRealTwins(['Read(//c/link/x)'], 'darwin', real), { rules: ['Read(//c/link/x)'], unsafe: [], tokenUnsafe: [], misses: [] });
  assert.equal(setup.withRealTwins(['Read(//c/link/x)'], 'win32', real).rules.length, 2);
});

test('withRealTwins: a link to a drive root, or to a folder holding the home, is named as too wide, never written', () => {
  const home = 'C:\\Users\\x';
  const tooWide = (p) => p === 'D:\\' || home.toLowerCase().startsWith(p.toLowerCase().replace(/\\?$/, '\\')) || p.toLowerCase() === home.toLowerCase();
  const r = setup.withRealTwins(['Edit(//c/link/**)', 'Edit(//c/up/**)'], 'win32', (p) => (p === 'C:\\link' ? 'D:\\' : p === 'C:\\up' ? 'C:\\Users' : p), tooWide);
  assert.deepEqual(r.rules, ['Edit(//c/link/**)', 'Edit(//c/up/**)']);
  assert.equal(r.unsafe.length, 2);
  assert.ok(r.unsafe.every((u) => /too wide/.test(u)), JSON.stringify(r.unsafe));
  // CONTROL: a narrower suffix under the same link keeps its twin (the rule stays narrow).
  const n = setup.withRealTwins(['Edit(//c/link/.claude-*/settings.json)'], 'win32', (p) => (p === 'C:\\link' ? 'D:\\' : p), tooWide);
  assert.deepEqual(n.rules, ['Edit(//c/link/.claude-*/settings.json)', 'Edit(//d/.claude-*/settings.json)']);
});

test('withRealTwins: a path whose real place cannot be worked out is named (fails closed), not skipped', () => {
  const r = setup.withRealTwins(['Read(//c/link/board.token)'], 'win32', () => { throw new Error('EACCES'); });
  assert.deepEqual(r.rules, ['Read(//c/link/board.token)']);
  assert.match(r.unsafe[0], /could not be worked out/);
});

test('withRealTwins: a gap on a board-token rule is flagged as the token\'s own (the guard refuses), one elsewhere is not', () => {
  const real = (p) => p.replace('C:\\link', 'C:\\odd [x]');
  const t = setup.withRealTwins(['Read(//c/link/Kosmos/board.token)'], 'win32', real);
  assert.equal(t.tokenUnsafe.length, 1, 'a token rule gap was not flagged as the token\'s');
  const o = setup.withRealTwins(['Edit(//c/link/.claude/settings.json)'], 'win32', real);
  assert.equal(o.unsafe.length, 1);
  assert.equal(o.tokenUnsafe.length, 0, 'CONTROL: a gap elsewhere is not the token\'s');
});

test('withRealTwins: a rule on a network share, or a drive that resolves to one, is named (never resolved, never claimed)', () => {
  let asked = 0;
  const real = (p) => { asked++; return /^Z:/i.test(p) ? p.replace(/^Z:/i, '\\\\srv\\data') : p; };
  const share = setup.withRealTwins(['Read(//srv/data/Kosmos/board.token)'], 'win32', real);
  assert.equal(asked, 0, 'a share path was resolved (a network lookup that can send the person\'s credentials)');
  assert.equal(share.tokenUnsafe.length, 1, 'a token rule on a share was claimed');
  const mapped = setup.withRealTwins(['Edit(//z/Kosmos/undo/**)'], 'win32', real);
  assert.equal(mapped.unsafe.length, 1);
  assert.match(mapped.unsafe[0], /network share/);
  assert.equal(mapped.rules.length, 1, 'a twin on the share was written');
  // CONTROL: a local drive rule is untouched.
  assert.deepEqual(setup.withRealTwins(['Edit(//c/Kosmos/undo/**)'], 'win32', real).unsafe, []);
});

test('withRealTwins: a token rule reached by a pattern refuses when a folder the pattern matches is a link', () => {
  const same = (p) => p;
  const links = (d) => (d === 'C:\\K\\worlds' ? ['w2'] : []);
  const r = setup.withRealTwins(['Read(//c/K/worlds/*/Kosmos/board.token)'], 'win32', same, undefined, links);
  assert.equal(r.tokenUnsafe.length, 1, 'a world folder that is a link went unseen');
  assert.match(r.tokenUnsafe[0], /C:\\K\\worlds\\w2/);
  // CONTROL: no link there, nothing named; and a non-token rule by a pattern is not checked this way.
  assert.deepEqual(setup.withRealTwins(['Read(//c/K/worlds/*/Kosmos/board.token)'], 'win32', same, undefined, () => []).unsafe, []);
  assert.deepEqual(setup.withRealTwins(['Edit(//c/K/worlds/*/Kosmos/undo/**)'], 'win32', same, undefined, links).unsafe, []);
});

test('withRealTwins: only a rule ENDING in the token\'s name is a token rule (board.token.md is not)', () => {
  const real = (p) => p.replace('C:\\link', 'C:\\odd [x]');
  assert.equal(setup.withRealTwins(['Edit(//c/link/notes/board.token.md)'], 'win32', real).tokenUnsafe.length, 0);
  assert.equal(setup.withRealTwins(['Read(//c/link/Kosmos/.board.token.*)'], 'win32', real).tokenUnsafe.length, 1, 'CONTROL: the temp copy is the token\'s');
});

test('#8437 isProtectedRule: the token, sender tokens, hand-off and own settings are protected; an import is not', () => {
  const rules = {
    tokenPaths: ['C:\\K\\Kosmos\\board.token'], tokenTmps: ['C:\\K\\Kosmos\\.board.token'], tokenDirs: ['C:\\K\\Kosmos\\sendertokens'],
    launchSecretDirs: ['C:\\K\\Kosmos\\launch-secrets'], settingsFiles: ['C:\\A\\.claude\\settings.json'], settingsDir: 'C:\\A\\.claude',
  };
  assert.equal(setup.isProtectedRule('Read(//c/K/Kosmos/board.token)', rules), true);
  assert.equal(setup.isProtectedRule('Read(//c/K/Kosmos/.board.token.*)', rules), true, 'the temp copy');
  assert.equal(setup.isProtectedRule('Read(//c/K/Kosmos/sendertokens/**)', rules), true);
  assert.equal(setup.isProtectedRule('Read(//c/k/kosmos/LAUNCH-SECRETS/**)', rules), true, 'case-blind on Windows');
  assert.equal(setup.isProtectedRule('Edit(//c/A/.claude/settings.json)', rules), true);
  // CONTROL: an instruction file's import, a sibling folder that merely shares a prefix, a start-up file elsewhere.
  assert.equal(setup.isProtectedRule('Edit(//c/Users/x/notes.md)', rules), false);
  assert.equal(setup.isProtectedRule('Read(//c/K/Kosmos/sendertokens-old/x)', rules), false, 'a name that only starts the same is not under it');
  assert.equal(setup.isProtectedRule('Edit(//c/Users/x/.mcp.json)', rules), false);
});

test('launchPathDirs on Windows names the PATH part as not covered, so the guard cannot read as whole', () => {
  const w = setup.launchPathDirs(agentDir('lp'), { ...PIN, platform: 'win32' });
  assert.deepEqual(w.unsafe, ['on Windows Kosmos does not cover the folders on this PATH yet']);
});

// ---- Windows filesystem arms ----

test('on Windows the guard is written in the //c/ form, with no sandbox block, and names the PATH and shell parts as missing', { skip: NEEDS_WINDOWS }, () => {
  const dir = agentDir('plain');
  const g = setup.guardTokenOnlyFolder(dir, 'plain', DEPS);
  assert.equal(g.ok, false);
  assert.equal(g.unsupported, undefined, 'refused as unsupported, the old answer');
  assert.match(g.because, WIN_PATH);
  // On Windows the PATH part travels as the run's own part (otherReason), never as a launch's pathReason.
  assert.equal(g.pathReason, null);
  assert.equal(g.otherReason, 'on Windows Kosmos does not yet cover the programs this agent starts from; and on Windows its shell is not sandboxed, so it is kept from the token in its file tools only', 'a reason other than the PATH and the shell, or one of them missing');
  const d = deny(dir);
  assert.ok(d.includes(ruleFor('Read', path.join(fs.realpathSync.native(store.ROOT), 'board.token'))), 'no board.token Read rule in the //c/ form');
  assert.equal(d.filter((r) => /^\w+\(\/\/[A-Za-z]:/.test(r)).length, 0, 'a rule in the native C:\\ form, measured to match nothing');
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.sandbox, undefined);
});

test('on Windows the guard says its shell is not sandboxed on every run, so it never reads whole while that is so (condition 1)', () => {
  // Any host: platform injected. The shell part is said on every Windows run, whatever else is or is not covered.
  const dir = agentDir('shellsays');
  const g = setup.guardTokenOnlyFolder(dir, 'shellsays', { ...DEPS, platform: 'win32' });
  assert.equal(g.ok, false);
  assert.match(g.because, /its shell is not sandboxed, so it is kept from the token in its file tools only/);
});

test('on Windows a launch hand-off folder the rules cannot carry is NAMED, not folded into the PATH sentence', () => {
  // An app folder named "Kosmos (1)": its launch-secrets Read rule cannot be written, and Windows has no sandbox behind it.
  const appRoot = path.join(SANDBOX, 'Kosmos (1)');
  fs.mkdirSync(appRoot, { recursive: true });
  const dir = agentDir('handoff');
  const g = setup.guardTokenOnlyFolder(dir, 'handoff', { ...DEPS, platform: 'win32', appRoot });
  assert.equal(g.ok, false);
  assert.match(g.because, /a folder the guard protects could not be covered \(.*launch-secrets/, 'the hand-off folder went unnamed: ' + g.because);
  // CONTROL: a plain app folder adds no such part.
  const plainApp = path.join(SANDBOX, 'KosmosApp');
  fs.mkdirSync(plainApp, { recursive: true });
  const g2 = setup.guardTokenOnlyFolder(agentDir('handoff2'), 'handoff2', { ...DEPS, platform: 'win32', appRoot: plainApp });
  assert.doesNotMatch(g2.because, /a folder the guard protects could not be covered/);
});

test('what the agent\'s page is told: a board start on Windows records the guard as NOT whole', { skip: NEEDS_WINDOWS }, () => {
  /* A board start keeps only a LAUNCH's PATH part (review 13), and no Windows launch records one, so a PATH part sent
     as pathReason was dropped here and the line read whole (the page then showed the protection as complete). */
  const dir = agentDir('pagecheck');
  setup.guardTokenOnlyFolder(dir, 'pagecheck', { ...DEPS, boardStart: true });
  const line = setup.readGuardState({ dataRoot: store.ROOT }).pagecheck;
  assert.ok(line, 'no guard state recorded');
  assert.equal(line.ok, false, 'the page would show the guard as complete: ' + JSON.stringify(line));
  assert.match(line.because, WIN_PATH);
  // A second board start (the next board restart) keeps it not whole.
  setup.guardTokenOnlyFolder(dir, 'pagecheck', { ...DEPS, boardStart: true });
  assert.equal(setup.readGuardState({ dataRoot: store.ROOT }).pagecheck.ok, false, 'a later board start recorded it whole');
  // CONTROL: a plain run (not a board start) records the same.
  const dir2 = agentDir('pagecheck2');
  setup.guardTokenOnlyFolder(dir2, 'pagecheck2', DEPS);
  assert.equal(setup.readGuardState({ dataRoot: store.ROOT }).pagecheck2.ok, false);
});

test('a line recorded before step A (the old refusal, a bare reason) is replaced at the next board start, not kept for good', { skip: NEEDS_WINDOWS }, () => {
  const dir = agentDir('legacy');
  const stateDir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(stateDir, { recursive: true });
  const old = 'on Windows this guard has not been shown to hold yet, so Kosmos does not claim it';
  fs.writeFileSync(path.join(stateDir, 'legacy.json'), JSON.stringify({ ok: false, because: old, at: '2026-11-01T00:00:00.000Z' }));
  setup.guardTokenOnlyFolder(dir, 'legacy', { ...DEPS, boardStart: true });
  const line = setup.readGuardState({ dataRoot: store.ROOT }).legacy;
  assert.equal(line.ok, false);
  assert.doesNotMatch(line.because, /not been shown to hold/, 'the old refusal was kept as a launch part: ' + line.because);
  assert.match(line.because, WIN_PATH);
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

test('a data folder behind a junction that leads nowhere is refused (the token itself would be open), nothing written', { skip: NEEDS_WINDOWS }, () => {
  const gone = path.join(SANDBOX, 'gone-target');
  fs.mkdirSync(gone, { recursive: true });
  const junc = path.join(SANDBOX, 'dangling');
  fs.symlinkSync(gone, junc, 'junction');
  fs.rmSync(gone, { recursive: true, force: true });   // the junction stays, leading nowhere (an unmounted volume, a removed target)
  assert.throws(() => setup.realOrLeafStrict(path.join(junc, 'Kosmos', 'board.token')), /could not be worked out/);
  assert.equal(setup.realOrLeafStrict(path.join(SANDBOX, 'not-made-yet', 'x')), path.join(fs.realpathSync.native(SANDBOX), 'not-made-yet', 'x'), 'CONTROL: a path not made yet still resolves through its parent');
  const dir = agentDir('dangling');
  const g = setup.guardTokenOnlyFolder(dir, 'dangling', { ...DEPS, dataRoot: path.join(junc, 'Kosmos') });
  assert.equal(g.ok, false);
  assert.match(g.because, /the board token is reached through a link/);
  assert.doesNotMatch(g.because, /the rest of the guard is in place/, 'the token gap read as a side gap');
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false, 'a guard missing its token rule was written');
});

test('a protected place that is not the token, behind a junction that leads nowhere, refuses too (nothing written)', { skip: NEEDS_WINDOWS }, () => {
  const home2 = path.join(SANDBOX, 'home-dangling');
  fs.mkdirSync(home2, { recursive: true });
  const gone = path.join(SANDBOX, 'gone-claude');
  fs.mkdirSync(gone, { recursive: true });
  fs.symlinkSync(gone, path.join(home2, '.claude'), 'junction');
  fs.rmSync(gone, { recursive: true, force: true });   // the account's .claude now leads nowhere
  const dir = agentDir('danglinghome');
  const g = setup.guardTokenOnlyFolder(dir, 'danglinghome', { ...DEPS, home: home2 });
  assert.equal(g.ok, false);
  assert.match(g.because, /a place the guard protects is reached through a link or share whose real place Kosmos cannot deny/);
  assert.doesNotMatch(g.because, /Claude Code reads at start/, 'the gap was filed as a start-up file');
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false, 'a guard with a gap in its own protection was written');
});

test('#8437: an import whose real place cannot be denied leaves the guard written and NOT whole, the token still denied', { skip: NEEDS_WINDOWS }, () => {
  // The imported file is reached through a junction into a folder whose name the rules cannot carry ([ ]): its twin
  // misses. An import is no protected place, so the guard is written (as on Linux) and says it is not whole.
  const odd = path.join(SANDBOX, 'imports-real [x]');
  fs.mkdirSync(odd, { recursive: true });
  fs.writeFileSync(path.join(odd, 'notes.md'), 'x\n');
  const link = path.join(SANDBOX, 'imports-link');
  fs.symlinkSync(odd, link, 'junction');
  const dir = agentDir('importmiss');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'See @' + path.join(link, 'notes.md').replace(/\\/g, '/') + '\n');
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'importmiss', DEPS);
    assert.equal(g.ok, false);
    assert.doesNotMatch(g.because, /reached through a link or share whose real place Kosmos cannot deny/, 'an incidental import refused the whole guard: ' + g.because);
    assert.match(g.because, /imports-link/, 'the import gap was not named: ' + g.because);
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')), 'the guard was not written');
    assert.ok(deny(dir).includes(ruleFor('Read', path.join(fs.realpathSync.native(store.ROOT), 'board.token'))), 'the token is not denied');
  } finally {
    // The guard reads every agent folder's instruction files, so this import must not reach the tests after this one.
    fs.rmSync(path.join(dir, 'CLAUDE.md'), { force: true });
  }
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
  // The only part missing is the Windows PATH part; before #5664 the import was read as a path the rules cannot carry.
  assert.doesNotMatch(String(g.otherReason), /cannot carry|could not be covered/, 'the import was read as uncarriable: ' + g.otherReason);
  assert.match(String(g.otherReason), WIN_PATH);
  // A target inside an agent's folder gets one mid-path glob per name (the agents' folder, *, the name), as elsewhere.
  assert.ok(deny(dir).includes(ruleFor('Edit', path.join(path.dirname(dir), '*', 'notes.md'))), 'the imported file is not denied: ' + JSON.stringify(deny(dir).filter((r) => /notes/.test(r))));
});
