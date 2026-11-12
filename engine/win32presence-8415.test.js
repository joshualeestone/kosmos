'use strict';
/**
 * kosmos#8415: a Windows supervisor records its own presence (engine/win32presence.js), so an agent whose supervisor
 * is up BETWEEN Claude children reads as running unseen ("could not check"), not "Not running", and an agent whose
 * supervisor is dead is not mistaken for running by a stale or reused pid in its state file.
 *
 * Off Windows the pipe is a unix socket in the sandbox (the pipePath seam); on the Windows runner (tools/windows-tests.js
 * selects this file by name) the real \\.\pipe\ path is used, and fs.existsSync is the real check.
 *
 *   node --test engine/win32presence-8415.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32presence-8415-')));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = path.join(SANDBOX, 'settings.json');

const store = require('./store');
const presence = require('./win32presence');
const ss = require('./win32streamstate');
const create = require('./create');

const DIR = () => path.join(store.ROOT, 'win32-state');
function reset() { fs.rmSync(DIR(), { recursive: true, force: true }); }
let sockN = 0;
/* A pipe path this process can listen on: the real namespace on Windows, a sandbox unix socket elsewhere. */
const pipePath = () => (process.platform === 'win32' ? undefined : path.join(SANDBOX, 's' + (sockN++) + '.sock'));
function stateFile(name, pid) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(path.join(DIR(), name + '.json'),
    JSON.stringify({ v: ss.STATE_FILE_VERSION, state: 'idle', sessionId: 's-' + name, pid, at: new Date().toISOString() }));
}
function presenceFile(name, rec) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(path.join(DIR(), name + presence.PRESENCE_EXT), JSON.stringify(rec));
}
const waitFor = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 10)); }
  return true;
};

test('kosmos#8415: a supervisor up between children (no state file) is running, and stops being so when it stops', async () => {
  reset();
  const h = presence.start('between', { pipePath: pipePath() });
  try {
    assert.ok(await waitFor(() => fs.existsSync(presence.presencePath('between'))), 'no presence record was written once listening');
    const rec = presence.readPresence('between');
    assert.equal(rec.pid, process.pid, 'the record names this process');
    assert.ok(fs.existsSync(rec.pipe), 'the pipe the record names is not there');
    assert.ok(ss.liveNames().has('between'), 'a supervisor that is up, with no state file (between children), does not read as running');
    assert.ok(create.runningJobs('win32').has('between'), 'create.runningJobs (what server.js reads) misses it');
  } finally { h.stop(); }
  assert.equal(fs.existsSync(presence.presencePath('between')), false, 'a clean stop left its presence record behind');
  assert.equal(ss.liveNames().has('between'), false, 'a stopped supervisor still reads as running');
});

test('kosmos#8415: a record whose pipe and pid are gone is a dead supervisor, even with a live pid in its state file (reuse, Fast Startup)', () => {
  reset();
  stateFile('ghost', 4242);   // the old child's pid, now somebody else's live process
  presenceFile('ghost', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: 'gone-pipe' });
  const alive = (pid) => pid === 4242;
  const running = ss.liveNames({ isAlive: alive, pipeExists: () => false });
  assert.equal(running.has('ghost'), false, 'a dead supervisor\'s agent read as running because its old pid is alive again');
  // CONTROL: the same state file with no presence record keeps #8410's rule (a supervisor from before this change).
  fs.rmSync(path.join(DIR(), 'ghost' + presence.PRESENCE_EXT));
  assert.equal(ss.liveNames({ isAlive: alive, pipeExists: () => false }).has('ghost'), true,
    'CONTROL: with no presence record the state-file rule no longer answers');
});

test('kosmos#8415 review 1: a pipe that looks gone while the record\'s pid is alive decides nothing (a busy pipe can miss a look)', () => {
  reset();
  stateFile('busy', 4242);
  presenceFile('busy', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: 'busy-pipe' });
  const running = ss.liveNames({ isAlive: () => true, pipeExists: () => false });
  assert.ok(running.has('busy'), 'one missed look at a live supervisor\'s pipe made a running agent read Not running');
  reset();
  presenceFile('busy', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: 'busy-pipe' });
  assert.equal(ss.liveNames({ isAlive: () => true, pipeExists: () => false }).has('busy'), false,
    'CONTROL: with no state file to answer, an undecided record must not read running');
});

test('kosmos#8415 review 1: a look that misses once is retried', () => {
  reset();
  presenceFile('retry', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: 'p' });
  let n = 0;
  const running = ss.liveNames({ isAlive: () => false, pipeExists: () => (n++ > 0) });
  assert.ok(running.has('retry'), 'a pipe seen on the second look read as gone');
  assert.equal(n, 2);
});

test('kosmos#8415 review 1: a leftover record from a crashed run is removed at start, so a pipe that then fails to open leaves the state file to answer', async () => {
  reset();
  stateFile('crashed', 4242);
  presenceFile('crashed', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: 'old-dead-pipe' });
  const problems = [];
  const h = presence.start('crashed', { pipePath: path.join(SANDBOX, 'no-such-dir', 'x.sock'), onProblem: (w) => problems.push(w) });
  try {
    assert.equal(fs.existsSync(presence.presencePath('crashed')), false, 'the old run\'s record survived the new start');
    assert.ok(await waitFor(() => problems.length > 0), 'a pipe that could not open was not said');
    assert.ok(ss.liveNames({ isAlive: (pid) => pid === 4242, pipeExists: () => false }).has('crashed'),
      'a live agent whose new pipe failed read Not running because of the old run\'s record');
  } finally { h.stop(); }
});

test('kosmos#8415: a pipe that is up decides even when the state file names a dead pid or none', () => {
  reset();
  stateFile('up', 9999);   // the last child's pid, now dead
  presenceFile('up', { v: presence.PRESENCE_VERSION, pid: 4242, pipe: 'live-pipe' });
  const running = ss.liveNames({ isAlive: () => false, pipeExists: (p) => p === 'live-pipe' });
  assert.ok(running.has('up'));
});

test('kosmos#8415: a record this version cannot read is ignored, and its agent falls back to the state-file rule', () => {
  reset();
  stateFile('odd', 4242);
  presenceFile('odd', { v: 99, pid: 4242, pipe: 'p' });
  presenceFile('junk', 'not an object');
  fs.writeFileSync(path.join(DIR(), 'broken' + presence.PRESENCE_EXT), '{');
  let asked = 0;
  const running = ss.liveNames({ isAlive: (pid) => pid === 4242, pipeExists: () => { asked += 1; return false; } });
  assert.ok(running.has('odd'), 'an unreadable record must not hide the state-file answer');
  assert.equal(asked, 0, 'a record this version cannot read was still looked at');
  assert.equal(running.has('junk'), false);
  assert.equal(running.has('broken'), false);
});

test('kosmos#8415: a stop removes only its own record, never a newer supervisor\'s (restart overlap)', () => {
  reset();
  presenceFile('swap', { v: presence.PRESENCE_VERSION, pid: process.pid + 1, pipe: 'newer' });
  assert.equal(presence.clearPresence('swap', process.pid), false, 'it reported removing a record that is not its own');
  assert.equal(presence.readPresence('swap').pipe, 'newer', 'the newer supervisor\'s record was erased');
  presenceFile('swap', { v: presence.PRESENCE_VERSION, pid: process.pid, pipe: 'mine' });
  assert.equal(presence.clearPresence('swap', process.pid), true);
  assert.equal(presence.readPresence('swap'), null, 'its own record was not removed');
  assert.deepEqual(fs.readdirSync(DIR()).filter((f) => f.includes('.clear')), [], 'a claim file was left behind');
});

test('kosmos#8415: a look at the pipe does not hold it: many looks in a row stay true', async () => {
  reset();
  const h = presence.start('looks', { pipePath: pipePath() });
  try {
    assert.ok(await waitFor(() => presence.readPresence('looks') !== null));
    const p = presence.readPresence('looks').pipe;
    for (let i = 0; i < 200; i++) assert.ok(fs.existsSync(p), 'look ' + i + ' saw no pipe');
    assert.ok(ss.liveNames().has('looks'));
  } finally { h.stop(); }
});

test('kosmos#8415 review 2: real connections (what a look is on Windows), half of them dropped at once by the client, leave the pipe up and throw nothing', async () => {
  reset();
  const net = require('node:net');
  const h = presence.start('conns', { pipePath: pipePath() });
  const escaped = [];
  const onUncaught = (e) => escaped.push(e);
  process.on('uncaughtException', onUncaught);
  try {
    assert.ok(await waitFor(() => presence.readPresence('conns') !== null));
    const p = presence.readPresence('conns').pipe;
    const one = (abrupt) => new Promise((resolve) => {
      const c = net.connect(p);
      c.on('error', () => resolve());
      c.on('close', () => resolve());
      c.on('connect', () => { if (abrupt) c.destroy(); });   // a client that leaves at once, as a look does
    });
    for (let i = 0; i < 50; i++) await one(i % 2 === 0);
    await Promise.all(Array.from({ length: 50 }, (_, i) => one(i % 2 === 1)));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(escaped, [], 'a connection to the presence pipe raised an uncaught exception');
    assert.ok(fs.existsSync(p), 'the pipe is gone after being connected to');
    assert.ok(ss.liveNames().has('conns'), 'after many connections the supervisor no longer reads as running');
  } finally { process.removeListener('uncaughtException', onUncaught); h.stop(); }
});

test('kosmos#8415: off Windows with no socket path given, start does nothing (no stray socket file)', () => {
  if (process.platform === 'win32') return;
  reset();
  const before = fs.readdirSync(process.cwd());
  const h = presence.start('nowhere');
  h.stop();
  assert.equal(h.pipe, null);
  assert.deepEqual(fs.readdirSync(process.cwd()), before, 'start made a file in the working folder');
  assert.equal(fs.existsSync(presence.presencePath('nowhere')), false);
});

test('kosmos#8415: main() starts the presence record for its agent and its stop ends it', () => {
  const sup = require('./win32supervisor');
  const launcher = require('./win32launch');
  const calls = [];
  const stopped = [];
  launcher.setSpawn(() => { const c = new EventEmitter(); c.pid = 4242; c.stdin = { destroyed: false, write() {}, end() { this.destroyed = true; } }; return c; });
  sup.setLiveReader(() => []);
  const cwd = path.join(SANDBOX, 'work', 'pres');
  fs.mkdirSync(cwd, { recursive: true });
  const handle = sup.main(['pres', cwd, '-', '-', 'claude'], {
    watchHost: () => ({ stop() {} }),
    exitLater: () => {},
    hostAlive: () => true,
    agentBrowser: () => 'b.json',
    agentPermission: () => 'p.json',
    presence: (name, opts) => { calls.push({ name, opts }); return { stop() { stopped.push(name); } }; },
  });
  try {
    assert.equal(calls.length, 1, 'main() did not start a presence record');
    assert.equal(calls[0].name, 'pres');
    assert.equal(typeof calls[0].opts.onProblem, 'function', 'a presence problem has nowhere to be said');
    assert.deepEqual(stopped, []);
  } finally {
    handle.stop();
    launcher.setSpawn(null);
    sup.setLiveReader(null);
  }
  assert.deepEqual(stopped, ['pres'], 'stopping the supervisor did not end its presence record');
});
