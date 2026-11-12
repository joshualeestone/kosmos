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
/* A made-up pipe name of the shape the reader accepts on Windows (a `kosmos-sup-` pipe); the pipeExists seam answers for it. */
const FAKE = (tag) => presence.PIPE_PREFIX + 'test' + tag.replace(/[^a-z0-9]/gi, '');
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
/* On Windows a look at a pipe (fs.existsSync) takes its free instance, and the server opens the next one only on its
   own next loop turn. In production the reader is the board, another process; here the reader and the supervisor are
   the SAME process, so a second look in the same tick finds the pipe busy (measured on the Windows runner, PR #8426's
   first run). One turn between looks is what the 200-look test proved enough. */
const turn = () => new Promise((r) => setImmediate(r));
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
    await turn();
    assert.ok(ss.liveNames().has('between'), 'a supervisor that is up, with no state file (between children), does not read as running');
    await turn();
    assert.ok(create.runningJobs('win32').has('between'), 'create.runningJobs (what server.js reads) misses it');
  } finally { h.stop(); }
  assert.equal(fs.existsSync(presence.presencePath('between')), false, 'a clean stop left its presence record behind');
  assert.equal(ss.liveNames().has('between'), false, 'a stopped supervisor still reads as running');
});

test('kosmos#8415: a record whose pipe and pid are gone is a dead supervisor, even with a live pid in its state file (reuse, Fast Startup)', () => {
  reset();
  stateFile('ghost', 4242);   // the old child's pid, now somebody else's live process
  presenceFile('ghost', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('gone-pipe') });
  const alive = (pid) => pid === 4242;
  const running = ss.liveNames({ isAlive: alive, pipeExists: () => false });
  assert.equal(running.has('ghost'), false, 'a dead supervisor\'s agent read as running because its old pid is alive again');
  // CONTROL: the same state file with no presence record keeps #8410's rule (a supervisor from before this change).
  fs.rmSync(path.join(DIR(), 'ghost' + presence.PRESENCE_EXT));
  assert.equal(ss.liveNames({ isAlive: alive, pipeExists: () => false }).has('ghost'), true,
    'CONTROL: with no presence record, the state-file rule should answer (live pid) and did not');
});

test('kosmos#8415 review 1: a pipe that looks gone while the record\'s pid is alive decides nothing (the control is the arm that can fail)', () => {
  reset();
  stateFile('busy', 4242);
  presenceFile('busy', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('busy-pipe') });
  const running = ss.liveNames({ isAlive: () => true, pipeExists: () => false });
  assert.ok(running.has('busy'), 'one missed look at a live supervisor\'s pipe made a running agent read Not running');
  reset();
  presenceFile('busy', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('busy-pipe') });
  assert.equal(ss.liveNames({ isAlive: () => true, pipeExists: () => false }).has('busy'), false,
    'CONTROL: with no state file to answer, an undecided record must not read running');
});

test('kosmos#8415 review 1: a look that misses once is retried', () => {
  reset();
  presenceFile('retry', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('retry') });
  let n = 0;
  const running = ss.liveNames({ isAlive: () => true, pipeExists: () => (n++ > 0) });
  assert.ok(running.has('retry'), 'a pipe seen on the second look read as gone');
  assert.equal(n, 2);
});

test('kosmos#8415 review 3: a missing pipe whose pid is dead is decided on one look, with no pause (a crashed run\'s record)', () => {
  reset();
  presenceFile('crashedrec', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('crashedrec') });
  let n = 0;
  const t0 = Date.now();
  const running = ss.liveNames({ isAlive: () => false, pipeExists: () => { n += 1; return false; } });
  assert.equal(running.has('crashedrec'), false);
  assert.equal(n, 1, 'a dead supervisor\'s record was looked at twice (and paused) on every poll');
  assert.ok(Date.now() - t0 < 1000);
});

test('kosmos#8415 review 3: a start keeps an older record whose pipe is still up (restart overlap), and drops one whose pipe is gone', { skip: process.platform === 'win32' && 'forces a failed open with a socket path; that this fails on Windows is not measured' }, () => {
  reset();
  presenceFile('overlap', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('olderup') });
  const bad = path.join(SANDBOX, 'no-such-dir', 'y.sock');
  let h = presence.start('overlap', { pipePath: bad, pipeExists: (p) => p === FAKE('olderup') });
  h.stop();
  assert.equal(presence.readPresence('overlap') && presence.readPresence('overlap').pipe, FAKE('olderup'),
    'a start removed the record of an older supervisor that is still up');
  h = presence.start('overlap', { pipePath: bad, pipeExists: () => false });
  h.stop();
  assert.equal(presence.readPresence('overlap'), null, 'CONTROL: a record whose pipe is gone survived a start');
});

test('kosmos#8415 review 4: a pipe that fails to open during a restart overlap also drops the older record, so the agent is not read dead when the older one exits', { skip: process.platform === 'win32' && 'forces a failed open with a socket path; that this fails on Windows is not measured' }, async () => {
  reset();
  stateFile('ov2', 4242);
  presenceFile('ov2', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('older2') });
  const problems = [];
  const h = presence.start('ov2', { pipePath: path.join(SANDBOX, 'no-such-dir', 'z.sock'), pipeExists: (p) => p === FAKE('older2'), isAlive: () => true, onProblem: (w) => problems.push(w) });
  try {
    assert.ok(await waitFor(() => problems.length > 0), 'the failed open was not said');
    assert.equal(presence.readPresence('ov2'), null, 'the older supervisor\'s record survived a failed open, and will read this live agent as dead once that supervisor exits');
    assert.ok(ss.liveNames({ isAlive: (pid) => pid === 4242, pipeExists: () => false }).has('ov2'), 'the state file no longer answers for the live agent');
  } finally { h.stop(); }
});

test('kosmos#8415 review 5: a record write that fails twice during an overlap drops the older record (no stale "dead")', async () => {
  reset();
  stateFile('wf', 4242);
  presenceFile('wf', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('olderwf') });
  const problems = [];
  let tries = 0;
  const h = presence.start('wf', { pipePath: pipePath(), pipeExists: (p) => p === FAKE('olderwf'), isAlive: () => true,
    save: () => { tries += 1; throw Object.assign(new Error('busy'), { code: 'EPERM' }); }, onProblem: (w) => problems.push(w) });
  try {
    assert.ok(await waitFor(() => problems.length > 0), 'a failed write was not said');
    assert.equal(tries, 2, 'the write was not retried once');
    assert.equal(presence.readPresence('wf'), null, 'the older record survived a failed write and will read this live agent dead');
    assert.ok(ss.liveNames({ isAlive: (pid) => pid === 4242, pipeExists: () => false }).has('wf'));
  } finally { h.stop(); }
});

test('kosmos#8415 review 5: a successful start replaces an older record that is still up with its own', async () => {
  reset();
  presenceFile('rep', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('olderrep') });
  const h = presence.start('rep', { pipePath: pipePath(), pipeExists: (p) => p === FAKE('olderrep') || fs.existsSync(p), isAlive: () => true });
  try {
    assert.ok(await waitFor(() => presence.readPresence('rep') && presence.readPresence('rep').pid === process.pid), 'the new record never replaced the older one');
  } finally { h.stop(); }
});

test('kosmos#8415 review 3: on Windows a record that names a pipe that is not ours is ignored', { skip: process.platform !== 'win32' && 'the prefix rule applies only on Windows' }, () => {
  reset();
  stateFile('foreign', 9999);
  presenceFile('foreign', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: '\\\\.\\pipe\\someone-else' });
  assert.equal(presence.readPresence('foreign'), null);
  assert.equal(ss.liveNames({ isAlive: () => false, pipeExists: () => true }).has('foreign'), false, 'a foreign pipe answered for the agent');
});

test('kosmos#8415 review 1: a leftover record from a crashed run is removed at start, so a pipe that then fails to open leaves the state file to answer', { skip: process.platform === 'win32' && 'forces a failed open with a socket path; that this fails on Windows is not measured' }, async () => {
  reset();
  stateFile('crashed', 4242);
  presenceFile('crashed', { v: presence.PRESENCE_VERSION, pid: 5151, pipe: FAKE('old-dead-pipe') });
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
  presenceFile('up', { v: presence.PRESENCE_VERSION, pid: 4242, pipe: FAKE('live-pipe') });
  const running = ss.liveNames({ isAlive: (pid) => pid === 4242, pipeExists: (p) => p === FAKE('live-pipe') });
  assert.ok(running.has('up'));
  // review 7: the same live pipe with its supervisor's pid dead is a stranger holding an old name: not running.
  assert.equal(ss.liveNames({ isAlive: () => false, pipeExists: (p) => p === FAKE('live-pipe') }).has('up'), false,
    'a pipe up with its supervisor\'s pid dead read as running (a stranger can take a dead supervisor\'s pipe name)');
});

test('kosmos#8415: a record this version cannot read is ignored, and its agent falls back to the state-file rule', () => {
  reset();
  stateFile('odd', 4242);
  presenceFile('odd', { v: 99, pid: 4242, pipe: FAKE('odd') });
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
  presenceFile('swap', { v: presence.PRESENCE_VERSION, pid: process.pid + 1, pipe: FAKE('newer') });
  assert.equal(presence.clearPresence('swap', process.pid), false, 'it reported removing a record that is not its own');
  assert.equal(presence.readPresence('swap').pipe, FAKE('newer'), 'the newer supervisor\'s record was erased');
  presenceFile('swap', { v: presence.PRESENCE_VERSION, pid: process.pid, pipe: FAKE('mine') });
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
    /* A turn of the event loop between looks, so the server can re-arm a pipe instance on Windows (where a look
       connects); the board looks once per poll, never 200 times in a row. */
    for (let i = 0; i < 200; i++) { assert.ok(fs.existsSync(p), 'look ' + i + ' saw no pipe'); await new Promise((r) => setImmediate(r)); }
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
    await turn();
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
