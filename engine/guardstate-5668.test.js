'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)
delete process.env.KOSMOS_GUARD_PANE_PATH;   // a board start: no pane PATH unless a test passes one

/*
 * #5668: every token-only guard run records its result per agent, for the agent's page; and the size count adds the
 * user-level settings file the agent's account reads (it reaches the same sandbox profile).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'guardstate-5668-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');

fs.mkdirSync(store.ROOT, { recursive: true });
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
// managedSettingsPath: null, so the host's real managed settings file (if an admin installed one) is never read here.
const BASE = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], managedSettingsPath: null };
const stateDir = () => path.join(store.ROOT, setup.GUARD_STATE_DIR);
const stateFile = (name) => path.join(stateDir(), encodeURIComponent(name) + '.json');
const quiet = (fn) => { const real = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = real; } };
// A user-level settings file whose deny list alone passes the measured ceiling (distinct paths, '//abs' spelling).
function bigAccount(name) {
  const d = path.join(SANDBOX, 'accounts', name);
  fs.mkdirSync(d, { recursive: true });
  const deny = Array.from({ length: 700 }, (_, i) => `Read(//acct/${name}/${String(i).padStart(4, '0')}-${'q'.repeat(60)}-${i})`);
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ permissions: { deny } }));
  return d;
}

test('#5668: each guard run records its result for that agent (ok, the reason, the warning), and later runs replace it', () => {
  const emptyAcct = path.join(SANDBOX, 'accounts', 'empty');
  fs.mkdirSync(emptyAcct, { recursive: true });
  assert.deepEqual(setup.guardTokenOnlyFolder(agentDir('gs-ok'), 'gs-ok', { ...BASE, accountConfigDir: emptyAcct }), { ok: true });
  let rec = setup.readGuardState();
  assert.equal(rec['gs-ok'].ok, true);
  assert.ok(!('because' in rec['gs-ok']) && !('warning' in rec['gs-ok']), JSON.stringify(rec['gs-ok']));
  assert.ok(!Number.isNaN(Date.parse(rec['gs-ok'].at)), 'no time on the record');
  // A different runner: not whole, with the reason. The first agent's line stays.
  const r = setup.guardTokenOnlyFolder(agentDir('gs-codex'), 'gs-codex', { ...BASE, runner: 'codex', runnerOf: () => 'codex', accountConfigDir: emptyAcct });
  assert.equal(r.ok, false);
  rec = setup.readGuardState();
  assert.equal(rec['gs-codex'].ok, false);
  assert.equal(rec['gs-codex'].because, r.because);
  assert.equal(rec['gs-ok'].ok, true, 'recording one agent dropped another');
  // Past the size: whole, with the warning; it replaces the earlier ok line.
  const w = quiet(() => setup.guardTokenOnlyFolder(agentDir('gs-ok'), 'gs-ok', { ...BASE, accountConfigDir: bigAccount('gs-ok') }));
  assert.equal(w.ok, true); assert.ok(w.warning, JSON.stringify(w));
  rec = setup.readGuardState();
  assert.equal(rec['gs-ok'].warning, w.warning);
  assert.equal(fs.statSync(stateFile('gs-ok')).mode & 0o777, 0o600, 'the record is not private to its owner');
});

test('#5668 (Pete\'s step 3): the account\'s user-level settings file counts toward the size; the default account is ~/.claude', () => {
  const dir = agentDir('gs-acct');
  const big = bigAccount('gs-acct');
  const r = quiet(() => setup.guardTokenOnlyFolder(dir, 'gs-acct', { ...BASE, accountConfigDir: big }));
  assert.ok(r.warning, 'the account file did not count: ' + JSON.stringify(r));
  // CONTROL: the same agent with an empty account file is under the ceiling.
  const empty = path.join(SANDBOX, 'accounts', 'none');
  fs.mkdirSync(empty, { recursive: true });
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'gs-acct', { ...BASE, accountConfigDir: empty }), { ok: true });
  // The account file's sandbox lists count too, both of them.
  for (const key of ['denyRead', 'denyWrite']) {
    const d = path.join(SANDBOX, 'accounts', 'sb-' + key);
    fs.mkdirSync(d, { recursive: true });
    const list = Array.from({ length: 700 }, (_, i) => `/acct/${key}/${String(i).padStart(4, '0')}-${'q'.repeat(60)}-${i}`);
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ sandbox: { filesystem: { [key]: list } } }));
    const s2 = quiet(() => setup.guardTokenOnlyFolder(dir, 'gs-acct', { ...BASE, accountConfigDir: d }));
    assert.ok(s2.warning, `the account file's sandbox ${key} did not count: ` + JSON.stringify(s2));
  }
  // No account named (the job names none): the default ~/.claude under home is the one read.
  const homeClaude = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(homeClaude, { recursive: true });
  fs.copyFileSync(path.join(big, 'settings.json'), path.join(homeClaude, 'settings.json'));
  try {
    const d = quiet(() => setup.guardTokenOnlyFolder(dir, 'gs-acct', { ...BASE, accountConfigDir: null }));
    assert.ok(d.warning, 'the default account file (~/.claude) did not count: ' + JSON.stringify(d));
  } finally { fs.rmSync(path.join(homeClaude, 'settings.json'), { force: true }); }
});

test('#5668: the board-start refresh records each listed agent it guards', () => {
  const sendertoken = require('./sendertoken');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-refresh'] }) + '\n');
  const dir = agentDir('gs-refresh');
  const empty = path.join(SANDBOX, 'accounts', 'refresh');
  fs.mkdirSync(empty, { recursive: true });
  const out = quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: empty, workerDir: () => dir }));
  assert.deepEqual(out.guarded, ['gs-refresh']);
  assert.equal(setup.readGuardState()['gs-refresh'].ok, true);
});

test('#5668: an unreadable or wrong-shaped record reads as none, and the next run writes a fresh one', () => {
  fs.rmSync(stateDir(), { recursive: true, force: true });
  fs.mkdirSync(stateDir(), { recursive: true });
  for (const bad of ['{nope', '[]', '{"ok":"yes"}']) {
    fs.writeFileSync(stateFile('gs-bad'), bad);
    assert.deepEqual(setup.readGuardState(), {}, bad);
  }
  const empty = path.join(SANDBOX, 'accounts', 'fresh');
  fs.mkdirSync(empty, { recursive: true });
  setup.guardTokenOnlyFolder(agentDir('gs-fresh'), 'gs-fresh', { ...BASE, accountConfigDir: empty });
  assert.equal(setup.readGuardState()['gs-fresh'].ok, true);
});

test('#5668 review 1: the agent folder\'s own settings.local.json counts toward the size (its denies are kept), and only settings.json is read from the account', () => {
  const dir = agentDir('gs-local');
  const empty = path.join(SANDBOX, 'accounts', 'local-empty');
  fs.mkdirSync(empty, { recursive: true });
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'gs-local', { ...BASE, accountConfigDir: empty }), { ok: true }, 'CONTROL: under the size without the local file');
  const deny = Array.from({ length: 700 }, (_, i) => `Read(//local/${String(i).padStart(4, '0')}-${'q'.repeat(60)}-${i})`);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { deny } }));
  const r = quiet(() => setup.guardTokenOnlyFolder(dir, 'gs-local', { ...BASE, accountConfigDir: empty }));
  assert.ok(r.warning, 'the agent folder\'s settings.local.json did not count: ' + JSON.stringify(r));
  fs.rmSync(path.join(dir, '.claude', 'settings.local.json'));
  // The account's settings.local.json is not a file Claude Code reads at user level: not counted.
  const acctLocal = path.join(SANDBOX, 'accounts', 'acct-local');
  fs.mkdirSync(acctLocal, { recursive: true });
  fs.writeFileSync(path.join(acctLocal, 'settings.local.json'), JSON.stringify({ permissions: { deny } }));
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'gs-local', { ...BASE, accountConfigDir: acctLocal }), { ok: true });
});

test('#5668 review 1: the record is denied to the agent in both layers, so it cannot hide its own notice', () => {
  const dir = agentDir('gs-protect');
  setup.guardTokenOnlyFolder(dir, 'gs-protect', { ...BASE, accountConfigDir: null });
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const rec = stateDir();
  const ruleAbs = (p) => '//' + String(p).replace(/^\/+/, '');
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(rec)}/**)`), 'the records are not denied to the file tools');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(real(rec)), 'the record is not denied to the sandboxed shell');
  // CONTROL: the token-only list beside it is denied the same way.
  const sendertoken = require('./sendertoken');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(sendertoken.tokenOnlyFile())})`));
});

test('#5668 review 1: the board-start refresh drops lines for agents no longer listed; a launch refresh does not', () => {
  const sendertoken = require('./sendertoken');
  const dir = agentDir('gs-keep');
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(stateFile('gs-gone'), JSON.stringify({ ok: false, because: 'old', at: 't' }));
  fs.writeFileSync(stateFile('gs-keep'), JSON.stringify({ ok: true, at: 't' }));
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-keep'] }) + '\n');
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: null, workerDir: () => dir, only: 'gs-keep' }));
  assert.ok(setup.readGuardState()['gs-gone'], 'a launch refresh (one agent) pruned another agent\'s line');
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: null, workerDir: () => dir }));
  const rec = setup.readGuardState();
  assert.equal(rec['gs-gone'], undefined, 'a line for an agent no longer listed stayed');
  assert.ok(rec['gs-keep'], 'CONTROL: the listed agent\'s line stays');
});

test('#5668 review 1: creation names the account it creates the agent on (its launch job is not written yet)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  const call = src.split('\n').find((l) => /guardTokenOnlyFolder\(workerDir\(name\), name, \{/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.ok(call, 'CONTROL: the creation guard call is found');
  assert.match(call, /accountConfigDir: configDir\b/, 'creation does not pass the account it is creating on');
});

test('#5668 review 2: each agent\'s line is its own file (a run writes only its own agent\'s, so it cannot write an older copy over another\'s), and a listed agent with no folder has none', () => {
  const sendertoken = require('./sendertoken');
  const empty = path.join(SANDBOX, 'accounts', 'race');
  fs.mkdirSync(empty, { recursive: true });
  // Sequential, so this shows the shape (one file each, another's line untouched), not a staged race.
  setup.guardTokenOnlyFolder(agentDir('gs-a'), 'gs-a', { ...BASE, runner: 'codex', runnerOf: () => 'codex', accountConfigDir: empty });
  const before = setup.readGuardState();
  setup.guardTokenOnlyFolder(agentDir('gs-b'), 'gs-b', { ...BASE, accountConfigDir: empty });
  assert.equal(before['gs-b'], undefined, 'CONTROL: gs-b was not recorded before');
  const after = setup.readGuardState();
  assert.equal(after['gs-a'].ok, false, 'another agent\'s not-whole line was lost');
  assert.equal(after['gs-b'].ok, true);
  // gs-a stays listed but its folder is gone: its line goes, so no stale state shows if it comes back.
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-a', 'gs-b'] }) + '\n');
  fs.rmSync(path.join(SANDBOX, 'workers', 'gs-a'), { recursive: true });
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: empty, workerDir: (n) => path.join(SANDBOX, 'workers', n), only: 'gs-a' }));
  assert.equal(setup.readGuardState()['gs-a'], undefined, 'a listed agent with no folder kept its old line');
  assert.ok(setup.readGuardState()['gs-b'], 'CONTROL: the other agent\'s line stays');
});

test('#5668 review 3: a board start does not replace a launch\'s not-whole line (it measures the board\'s PATH, not the agent\'s), but records an agent with no line', () => {
  const sendertoken = require('./sendertoken');
  const empty = path.join(SANDBOX, 'accounts', 'bs');
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-bs', 'gs-new'] }) + '\n');
  // The launch's run said not whole (here: a runner the guard cannot cover).
  setup.guardTokenOnlyFolder(agentDir('gs-bs'), 'gs-bs', { ...BASE, runner: 'codex', runnerOf: () => 'codex', accountConfigDir: empty, atLaunch: true });
  assert.equal(setup.readGuardState()['gs-bs'].ok, false, 'CONTROL: the launch recorded not whole');
  agentDir('gs-new');
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: empty, workerDir: (n) => path.join(SANDBOX, 'workers', n) }));
  const rec = setup.readGuardState();
  assert.equal(rec['gs-bs'].ok, false, 'a board start replaced the launch\'s not-whole line with its own reading');
  assert.equal(rec['gs-new'].ok, true, 'CONTROL: a board start records an agent with no line yet');
});

test('#5668 review 3: pruning reads the folder itself, so a malformed file for an unlisted agent goes (the re-read of the list just before pruning is not staged here)', () => {
  const sendertoken = require('./sendertoken');
  const dir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gs-junk.json'), '{nope');
  fs.writeFileSync(path.join(dir, 'gs-later.json'), JSON.stringify({ ok: true, at: 't' }));
  // The list names gs-later; the pass itself guards nobody (no folders), and prunes against the list read now.
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-later'] }) + '\n');
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, workerDir: () => null }));
  const left = fs.readdirSync(dir).sort();
  assert.ok(!left.includes('gs-junk.json'), 'a malformed file for an unlisted agent stayed: ' + left.join(','));
  // gs-later has no folder, so its line goes too (review 2); listed agents with a folder keep theirs (tested above).
});

test('#5668 review 4: an empty token-only list (none listed, or unreadable) prunes nothing', () => {
  const sendertoken = require('./sendertoken');
  const dir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gs-kept.json'), JSON.stringify({ ok: false, because: 'x', at: 't' }));
  for (const list of ['{not json', JSON.stringify({ agents: [] })]) {
    fs.writeFileSync(sendertoken.tokenOnlyFile(), list);
    quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, workerDir: () => null }));
    assert.ok(fs.existsSync(path.join(dir, 'gs-kept.json')), 'an empty or unreadable list pruned every line: ' + list);
  }
  // CONTROL: a list that names someone else does prune it.
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-other'] }));
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, workerDir: () => null }));
  assert.ok(!fs.existsSync(path.join(dir, 'gs-kept.json')), 'CONTROL: a list without it did not prune it');
});

test('#5668 review 5: a launch replaces an existing line (what the running agent has), and a board start replaces only an unreadable one', () => {
  const sendertoken = require('./sendertoken');
  const empty = path.join(SANDBOX, 'accounts', 'r5');
  fs.mkdirSync(empty, { recursive: true });
  const dir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-r5'] }) + '\n');
  agentDir('gs-r5');
  fs.writeFileSync(path.join(dir, 'gs-r5.json'), JSON.stringify({ ok: true, at: 't-old' }));
  // A launch through the supervisor's call, on a runner the guard cannot cover: the old "ok" line is replaced.
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, runnerOf: () => 'codex', accountConfigDir: empty, workerDir: (n) => path.join(SANDBOX, 'workers', n), only: 'gs-r5' }));
  let line = setup.readGuardState()['gs-r5'];
  assert.ok(line.at !== 't-old' && line.ok === false, 'a launch did not replace the existing line: ' + JSON.stringify(line));
  // A line cut off by a crash: a board start replaces it (it would otherwise hide every later reading).
  fs.writeFileSync(path.join(dir, 'gs-r5.json'), '{"ok": tr');
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: empty, workerDir: (n) => path.join(SANDBOX, 'workers', n) }));
  line = setup.readGuardState()['gs-r5'];
  assert.ok(line && line.ok === true, 'a board start left an unreadable line in place: ' + JSON.stringify(line));
  // CONTROL: a readable line is still not replaced by a board start.
  fs.writeFileSync(path.join(dir, 'gs-r5.json'), JSON.stringify({ ok: false, because: 'launch said so', at: 't-launch' }));
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, accountConfigDir: empty, workerDir: (n) => path.join(SANDBOX, 'workers', n) }));
  assert.equal(setup.readGuardState()['gs-r5'].at, 't-launch');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.new')), [], 'a temp file was left behind');
});

test('#5668 review 5: pruning sweeps a temp file a dead writer left (once it is old), and an empty agent name records nothing', () => {
  const sendertoken = require('./sendertoken');
  const dir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'gs-x.json.123.abcd.new');
  const fresh = path.join(dir, 'gs-y.json.124.abce.new');
  fs.writeFileSync(old, '{}');
  fs.writeFileSync(fresh, '{}');
  const past = (Date.now() - 5 * 60 * 1000) / 1000;
  fs.utimesSync(old, past, past);
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-somebody'] }) + '\n');
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, workerDir: () => null }));
  assert.ok(!fs.existsSync(old), 'an old temp file stayed');
  assert.ok(fs.existsSync(fresh), 'CONTROL: a temp file that may still be in use was removed');
  fs.rmSync(fresh, { force: true });
  setup.guardTokenOnlyFolder(agentDir('gs-noname'), '', { ...BASE, accountConfigDir: null });
  assert.ok(!fs.existsSync(path.join(dir, '.json')), 'an empty name wrote a line');
});

test('#5668 review 7: the admin\'s managed settings file counts toward the size; with no hard links a board start still records a new agent', () => {
  const dir = agentDir('gs-managed');
  const empty = path.join(SANDBOX, 'accounts', 'managed-empty');
  fs.mkdirSync(empty, { recursive: true });
  const big = path.join(bigAccount('gs-managed'), 'settings.json');
  const r = quiet(() => setup.guardTokenOnlyFolder(dir, 'gs-managed', { ...BASE, accountConfigDir: empty, managedSettingsPath: big }));
  assert.ok(r.warning, 'the managed settings file did not count: ' + JSON.stringify(r));
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'gs-managed', { ...BASE, accountConfigDir: empty, managedSettingsPath: null }), { ok: true }, 'CONTROL: without it, under the size');
  // A filesystem without hard links: the board start's exclusive create falls back to a rename where there is no line.
  const real = fs.linkSync;
  fs.linkSync = () => { const e = new Error('no links'); e.code = 'ENOTSUP'; throw e; };
  try {
    fs.rmSync(path.join(store.ROOT, setup.GUARD_STATE_DIR, 'gs-nolink.json'), { force: true });
    setup.guardTokenOnlyFolder(agentDir('gs-nolink'), 'gs-nolink', { ...BASE, accountConfigDir: empty, managedSettingsPath: null, boardStart: true });
  } finally { fs.linkSync = real; }
  assert.equal(setup.readGuardState()['gs-nolink'].ok, true, 'with no hard links a board start recorded nothing (the page would read as guarded)');
});

test('#5668 review 9: a board start that finds the guard not whole for a non-PATH reason replaces a readable ok line; a PATH reason does not', () => {
  const sendertoken = require('./sendertoken');
  const empty = path.join(SANDBOX, 'accounts', 'r9');
  fs.mkdirSync(empty, { recursive: true });
  const dir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['gs-r9'] }) + '\n');
  agentDir('gs-r9');
  fs.writeFileSync(path.join(dir, 'gs-r9.json'), JSON.stringify({ ok: true, at: 't-launch' }));
  // Not whole for a reason not about the PATH (here: a runner the guard cannot cover).
  quiet(() => setup.refreshTokenOnlyGuards({ ...BASE, runnerOf: () => 'codex', accountConfigDir: empty, workerDir: (n) => path.join(SANDBOX, 'workers', n) }));
  const line = setup.readGuardState()['gs-r9'];
  assert.ok(line.ok === false && line.at !== 't-launch', 'a board start that found the guard broken kept the older ok line: ' + JSON.stringify(line));
  // CONTROL: a PATH reason from a board start does not replace a readable line (the launch's PATH is what the agent has).
  fs.writeFileSync(path.join(dir, 'gs-r9.json'), JSON.stringify({ ok: true, at: 't-launch' }));
  const r = quiet(() => setup.guardTokenOnlyFolder(path.join(SANDBOX, 'workers', 'gs-r9'), 'gs-r9', { ...BASE, panePath: 'relative/bin', accountConfigDir: empty, boardStart: true }));
  assert.match(String(r.because), /^the PATH this agent starts with/, 'CONTROL: this board start\'s reason is the PATH one: ' + JSON.stringify(r));
  assert.equal(setup.readGuardState()['gs-r9'].at, 't-launch', 'a board start\'s PATH reading replaced the launch\'s line');
  // Where the filesystem refuses hard links, an unreadable line is still replaced by a board start (as with links).
  fs.writeFileSync(path.join(dir, 'gs-r9.json'), '{"ok": tr');
  const realLink = fs.linkSync;
  fs.linkSync = () => { const e = new Error('no links'); e.code = 'ENOTSUP'; throw e; };
  try { quiet(() => setup.guardTokenOnlyFolder(path.join(SANDBOX, 'workers', 'gs-r9'), 'gs-r9', { ...BASE, accountConfigDir: empty, boardStart: true })); } finally { fs.linkSync = realLink; }
  assert.equal(setup.readGuardState()['gs-r9'].ok, true, 'with no hard links an unreadable line was kept');
});

/* #5434 slice 25: the guard-state line is flushed before it is published, by either path: the board start's exclusive
   hard link, and the launch's rename. */
function publishRecording(fn) {
  const events = [];
  const fdPath = new Map();
  const real = { open: fs.openSync, fsync: fs.fsyncSync, link: fs.linkSync, rename: fs.renameSync };
  fs.openSync = (p, ...rest) => { const fd = real.open.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return real.fsync(fd); };
  fs.linkSync = (a, b) => { events.push(['publish', String(a), String(b)]); return real.link(a, b); };
  fs.renameSync = (a, b) => { events.push(['publish', String(a), String(b)]); return real.rename(a, b); };
  try { fn(); } finally { fs.openSync = real.open; fs.fsyncSync = real.fsync; fs.linkSync = real.link; fs.renameSync = real.rename; }
  return events;
}
for (const [label, extra] of [['the board start\'s exclusive link', { boardStart: true }], ['a launch\'s rename', {}]]) {
  test('#5434 slice 25: the guard-state line is flushed before ' + label + ' publishes it', () => {
    const name = 'gs-flush-' + (extra.boardStart ? 'start' : 'launch');
    const stateFile = path.join(store.ROOT, setup.GUARD_STATE_DIR, name + '.json');
    fs.rmSync(stateFile, { force: true });
    const empty = path.join(SANDBOX, 'accounts', 'flush-' + name);
    fs.mkdirSync(empty, { recursive: true });
    const events = publishRecording(() => quiet(() => setup.guardTokenOnlyFolder(agentDir(name), name, { ...BASE, accountConfigDir: empty, managedSettingsPath: null, ...extra })));
    const p = events.findIndex((e) => e[0] === 'publish' && e[2] === stateFile);
    assert.ok(p >= 0, 'nothing published the guard-state line: ' + JSON.stringify(events.filter((e) => e[0] === 'publish')));
    assert.ok(events.slice(0, p).some((e) => e[0] === 'fsync' && e[1] === events[p][1]), 'the guard-state line was not flushed before it was published');
  });
}
