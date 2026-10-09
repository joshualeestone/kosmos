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
const BASE = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [] };
const stateFile = () => path.join(store.ROOT, setup.GUARD_STATE_FILE);
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
  assert.equal(fs.statSync(stateFile()).mode & 0o777, 0o600, 'the record is not private to its owner');
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
  for (const bad of ['{nope', '[]', '{"agents":[1]}']) {
    fs.writeFileSync(stateFile(), bad);
    assert.deepEqual(setup.readGuardState(), {}, bad);
  }
  const empty = path.join(SANDBOX, 'accounts', 'fresh');
  fs.mkdirSync(empty, { recursive: true });
  setup.guardTokenOnlyFolder(agentDir('gs-fresh'), 'gs-fresh', { ...BASE, accountConfigDir: empty });
  assert.equal(setup.readGuardState()['gs-fresh'].ok, true);
});
