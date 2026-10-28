'use strict';
/**
 * #2988: the Windows board's supervision (engine/win32boardwatch.js) and the watchdog task that
 * runs it (engine/win32board.js).
 *
 * 🛑 NOTHING REAL IS TOUCHED. Every schtasks call goes to a stub runner (win32board.setRunner),
 * the anchor to a stub anchorer, every port look to a stub, and every log and journal to a scratch
 * folder. The live `\Kosmos\board` task and the live board's port are out of reach: the watchdog's
 * scheduler and port are always injected here.
 *
 * Mac-runnable: the platform is passed, never read, and the one child process each real-process
 * arm starts is this same node.
 *
 *   node --test engine/win32boardwatch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');

const watch = require('./win32boardwatch');
const board = require('./win32board');
const win32anchor = require('./win32anchor');
const win32apply = require('./win32apply');
const win32update = require('./win32update');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-boardwatch-2988-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

let n = 0;
function scratch(name) {
  n += 1;
  const dir = path.join(SANDBOX, (name || 'case') + '-' + n);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const readLog = (dir) => { try { return fs.readFileSync(path.join(dir, 'board.log'), 'utf8'); } catch { return ''; } };
const lines = (dir) => readLog(dir).split('\n').filter(Boolean);
const ISO = '\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z';

/* A process stand-in: pid, ppid, listeners, and an exit() that runs the exit listeners as Node
   does, then remembers the code instead of ending this test. */
function fakeProc(pid, ppid) {
  const p = new EventEmitter();
  p.pid = pid;
  p.ppid = ppid;
  p.exits = [];
  p.exit = (code) => { p.exits.push(code); p.emit('exit', code); };
  return p;
}
/* exitWhenParentGone, captured: the test fires onGone itself. */
function capturedWatch() {
  const w = { opts: null };
  w.arm = (opts) => { w.opts = opts; return { armed: true, stop() {} }; };
  return w;
}

// ── 1. the board's exit-cause line ──────────────────────────────────────────

test('#2988 a task-started board writes one start line with its pid and its parent', () => {
  const dir = scratch('start');
  const p = fakeProc(111, 222);
  const r = watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm, now: () => Date.parse('2026-10-28T12:00:00.000Z') });
  assert.equal(r.armed, true);
  assert.deepEqual(lines(dir), ['2026-10-28T12:00:00.000Z board started pid=111 parent=222']);
});

test('#2988 its host gone (the /End path): the cause is set BEFORE the exit, and the exit code is still 0', () => {
  const dir = scratch('host');
  const p = fakeProc(111, 222);
  const w = capturedWatch();
  watch.recordBoardExits({ proc: p, logDir: dir, watch: w.arm });
  assert.equal(w.opts.parentPid, 222, 'it watches its own parent');
  w.opts.onGone(222);
  assert.deepEqual(p.exits, [0]);
  assert.match(lines(dir)[1], new RegExp('^' + ISO + ' board exited pid=111 code=0: its host process \\(pid 222\\) was gone$'));
});

test('#2988 its host gone, through the REAL exitWhenParentGone (the watch it replaced in server.js)', () => {
  const dir = scratch('realwatch');
  const p = fakeProc(111, 222);
  let tick = null;
  watch.recordBoardExits({
    proc: p, logDir: dir, isAlive: () => false,
    setInterval: (fn) => { tick = fn; return { unref() {} }; }, clearInterval: () => {},
  });
  assert.equal(typeof tick, 'function', 'the parent watch was armed');
  tick();
  assert.deepEqual(p.exits, [0]);
  assert.match(lines(dir)[1], /board exited pid=111 code=0: its host process \(pid 222\) was gone$/);
});

for (const sig of ['SIGHUP', 'SIGINT', 'SIGBREAK', 'SIGTERM']) {
  test('#2988 a console signal (' + sig + ') is recorded and exits with the conventional code', () => {
    const dir = scratch('sig');
    const p = fakeProc(111, 222);
    watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
    const num = os.constants.signals[sig];
    const code = 128 + (Number.isInteger(num) ? num : 1);
    p.emit(sig);
    assert.deepEqual(p.exits, [code]);
    assert.match(lines(dir)[1], new RegExp('board exited pid=111 code=' + code + ': a console signal \\(' + sig + '\\)$'));
  });
}

test('#2988 round 1: with another SIGINT handler already there (engine/remote.js), ours runs FIRST, writes the line, and leaves the exit to it', () => {
  const dir = scratch('sigfirst');
  const p = fakeProc(111, 222);
  const order = [];
  /* remote.js's shape: it runs, then (on Windows) the process is gone, so nothing after it would run. */
  p.on('SIGINT', () => { order.push('remote, with the line ' + (readLog(dir).includes('exited') ? 'already written' : 'NOT written')); });
  watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
  p.emit('SIGINT');
  assert.deepEqual(order, ['remote, with the line already written']);
  assert.deepEqual(p.exits, [], 'another handler owns the exit, so ours does not seize it');
  assert.match(lines(dir).pop(), /board exited pid=111 signal=SIGINT: a console signal \(SIGINT\)$/);
});

test('#2988 round 1: our signal handler is prepended ahead of one registered earlier', () => {
  const p = fakeProc(111, 222);
  const remote = () => {};
  p.on('SIGTERM', remote);
  watch.recordBoardExits({ proc: p, logDir: scratch('prepend'), watch: capturedWatch().arm });
  assert.notEqual(p.listeners('SIGTERM')[0], remote, 'the earlier handler would run first and end the process on Windows');
  assert.equal(p.listeners('SIGTERM')[1], remote);
});

test('#2988 round 1: a REAL process with engine/remote loaded first still writes the SIGINT line', () => {
  /* A real signal cannot be sent to a child here (on Windows, child.kill('SIGINT') is TerminateProcess,
     which runs no handler at all). So the child emits SIGINT to itself with process.emit: that runs
     the real listener chain in its real order (our handler, then remote.js's, which reaps, removes
     itself and re-raises with process.kill). It proves the order and the line; it does not prove how
     Windows delivers a console Ctrl+C to a headless board. */
  const dir = scratch('realsig');
  const script = [
    "require(" + JSON.stringify(path.join(__dirname, 'remote.js')) + ");",
    'const w = require(' + JSON.stringify(path.join(__dirname, 'win32boardwatch.js')) + ');',
    'w.recordBoardExits({ logDir: ' + JSON.stringify(dir) + ', watch: () => ({ armed: true }) });',
    "process.emit('SIGINT');",
    'setTimeout(() => {}, 2000);',
  ].join('\n');
  const r = cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
  const got = lines(dir);
  assert.equal(got.length, 2, 'start and exit lines: ' + JSON.stringify(got) + ' status ' + r.status + ' ' + r.stderr);
  assert.match(got[1], new RegExp('board exited pid=' + r.pid + ' signal=SIGINT: a console signal \\(SIGINT\\)$'));
});

test('#2988 an uncaught error is recorded with its first line, through the monitor (no behaviour change)', () => {
  const dir = scratch('uncaught');
  const p = fakeProc(111, 222);
  watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
  assert.equal(p.listenerCount('uncaughtException'), 0, 'it adds no uncaughtException handler, which would keep a broken board alive');
  const err = new TypeError('boom happened\n    at somewhere (x.js:1:1)');
  p.emit('uncaughtExceptionMonitor', err, 'uncaughtException');
  p.exit(1);
  assert.match(lines(dir)[1], /board exited pid=111 code=1: an uncaught error \(TypeError: boom happened\)$/);
});

test('#2988 a secret in an uncaught error never reaches the log', () => {
  const dir = scratch('secret');
  const p = fakeProc(111, 222);
  watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
  p.emit('uncaughtExceptionMonitor', new Error('call failed with sk-ant-' + 'a'.repeat(30)), 'uncaughtException');
  p.exit(1);
  assert.ok(!readLog(dir).includes('a'.repeat(30)), readLog(dir));
  assert.match(readLog(dir), /\[redacted-secret\]/);
});

test('#2988 an error something else catches is not taken for the cause of a later exit', () => {
  const dir = scratch('caught');
  const p = fakeProc(111, 222);
  watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
  p.on('uncaughtException', () => {});
  p.emit('uncaughtExceptionMonitor', new Error('survived'), 'uncaughtException');
  p.exit(0);
  assert.match(lines(dir)[1], /board exited pid=111 code=0: it exited by itself$/);
});

test('#2988 an exit of its own is recorded with its code, once', () => {
  const dir = scratch('normal');
  const p = fakeProc(111, 222);
  watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
  p.exit(3);
  p.emit('exit', 3);
  assert.equal(lines(dir).length, 2, readLog(dir));
  assert.match(lines(dir)[1], /board exited pid=111 code=3: it exited by itself$/);
});

test('#2988 a log that cannot be written never throws into the board', () => {
  const blocker = path.join(scratch('blocked'), 'a-file');
  fs.writeFileSync(blocker, 'not a folder');
  const p = fakeProc(111, 222);
  assert.doesNotThrow(() => watch.recordBoardExits({ proc: p, logDir: path.join(blocker, 'logs'), watch: capturedWatch().arm }));
  assert.doesNotThrow(() => p.exit(0));
});

/* The real process: 'exit' runs after an uncaught error, and a plain exit, in node itself. */
function runChild(logDir, body) {
  const script = [
    'const w = require(' + JSON.stringify(path.join(__dirname, 'win32boardwatch.js')) + ');',
    'w.recordBoardExits({ logDir: ' + JSON.stringify(logDir) + ', watch: () => ({ armed: true }) });',
    body,
  ].join('\n');
  return cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
}

test('#2988 a REAL process: an uncaught error is the exit line, and the process still dies with code 1', () => {
  const dir = scratch('realuncaught');
  const r = runChild(dir, "setTimeout(() => { throw new Error('real boom'); }, 5);");
  assert.equal(r.status, 1, r.stderr);
  assert.match(lines(dir)[0], new RegExp('board started pid=' + r.pid + ' '));
  assert.match(lines(dir)[1], new RegExp('board exited pid=' + r.pid + ' code=1: an uncaught error \\(Error: real boom\\)$'));
});

test('#2988 a REAL process: an unhandled rejection is the exit line too', () => {
  const dir = scratch('realreject');
  const r = runChild(dir, "Promise.reject(new Error('real reject'));");
  assert.equal(r.status, 1, r.stderr);
  assert.match(lines(dir)[1], /code=1: an uncaught error \(Error: real reject\)$/);
});

test('#2988 a REAL process: a plain exit is recorded with its code', () => {
  const dir = scratch('realexit');
  const r = runChild(dir, 'process.exit(7);');
  assert.equal(r.status, 7);
  assert.match(lines(dir)[1], /code=7: it exited by itself$/);
});

test('#2988 server.js records exits only for a task-started board, in place of the bare parent watch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const guarded = /if \(require\('\.\/engine\/win32board'\)\.startedByTask\(\)\) \{\s*require\('\.\/engine\/win32boardwatch'\)\.recordBoardExits\(\{\}\);\s*\}/;
  assert.match(src, guarded, 'recordBoardExits must sit inside the startedByTask() guard, so a hand-started board\'s Ctrl+C is unchanged');
  assert.equal((src.match(/recordBoardExits\(/g) || []).length, 1, 'armed in exactly one place');
  assert.ok(!/exitWhenParentGone\(\{ onGone: \(\) => process\.exit\(0\) \}\)/.test(src), 'the old bare watch is gone (recordBoardExits arms it, with its cause)');
});

// ── 2. the watchdog's gates ─────────────────────────────────────────────────

const STATUS_ON = { known: true, registered: true, enabled: true, running: null };
function deps(over) {
  const d = {
    ran: 0, slept: [],
    board: { status: () => STATUS_ON, runNow: () => { d.ran += 1; return { ok: true }; } },
    mayStartBoard: () => true,
    updateInFlight: () => ({ inFlight: false }),
    look: async () => ({ silent: true }),
    sleep: async (ms) => { d.slept.push(ms); },
    now: () => Date.parse('2026-10-28T12:05:00.000Z'),
  };
  return Object.assign(d, over || {});
}
const runWith = (dir, d, extra) => watch.watchdogRun({ logDir: dir, port: 9, deps: d, ...(extra || {}) });

test('#2988 every gate open: it /Runs the board task once, after a second look a few seconds later, and says so in one line', async () => {
  const dir = scratch('open');
  const looks = [];
  const d = deps({ look: async (port) => { looks.push(port); return { silent: true }; } });
  const r = await runWith(dir, d);
  assert.equal(r.action, 'started', JSON.stringify(r));
  assert.equal(d.ran, 1);
  assert.deepEqual(looks, [9, 9], 'two looks at this account\'s port');
  assert.deepEqual(d.slept, [5000], 'a few seconds between the two looks');
  assert.deepEqual(lines(dir), ['2026-10-28T12:05:00.000Z board was not answering; started it. No exit was recorded, so it was killed or crashed hard']);
});

const CLOSED = [
  ['this computer connects to another computer\'s Kosmos (#4382)', { mayStartBoard: () => false }],
  ['an update is in flight at the first check', { updateInFlight: () => ({ inFlight: true, why: 'an update has not finished' }) }],
  ['the update state is not known', { updateInFlight: () => null }],
  ['a board answers on the first look', { look: async () => ({ silent: false }) }],
  ['the board task could not be read', { board: { status: () => ({ known: false, because: 'x' }), runNow: () => { throw new Error('ran'); } } }],
  ['there is no board task', { board: { status: () => ({ known: true, registered: false }), runNow: () => { throw new Error('ran'); } } }],
  ['the board task is switched off (a deliberate stop)', { board: { status: () => ({ ...STATUS_ON, enabled: false }), runNow: () => { throw new Error('ran'); } } }],
  ['the board task is already running (a /Run would be ignored)', { board: { status: () => ({ ...STATUS_ON, running: true }), runNow: () => { throw new Error('ran'); } } }],
];
for (const [what, over] of CLOSED) {
  test('#2988 gate closed, ' + what + ': no /Run, and NOTHING is written', async () => {
    const dir = scratch('closed');
    const d = deps(over);
    const r = await runWith(dir, d);
    assert.equal(r.action, 'left', JSON.stringify(r));
    assert.equal(d.ran, 0);
    assert.equal(readLog(dir), '', 'a run that does nothing writes nothing');
  });
}

test('#2988 a board that answers on the SECOND look (mid-boot, mid-hand-off) is not started', async () => {
  const dir = scratch('second');
  let k = 0;
  const d = deps({ look: async () => { k += 1; return { silent: k === 1 }; } });
  const r = await runWith(dir, d);
  assert.equal(r.action, 'left');
  assert.equal(d.ran, 0);
  assert.equal(readLog(dir), '');
});

test('#2988 an update that began between the two looks is not raced', async () => {
  const dir = scratch('updlate');
  let k = 0;
  const d = deps({ updateInFlight: () => { k += 1; return k === 1 ? { inFlight: false } : { inFlight: true, why: 'an update has not finished' }; } });
  const r = await runWith(dir, d);
  assert.equal(r.action, 'left');
  assert.equal(d.ran, 0);
});

test('#2988 a /Run Task Scheduler refused is one line that says so, never "started"', async () => {
  const dir = scratch('refused');
  const d = deps();
  d.board = { status: () => STATUS_ON, runNow: () => ({ ok: false, because: 'we could not start the board (ERROR: Access is denied.)' }) };
  const r = await runWith(dir, d);
  assert.equal(r.action, 'start-failed');
  assert.match(lines(dir)[0], /board was not answering; could not start it \(we could not start the board \(ERROR: Access is denied\.\)\)\. No exit was recorded/);
});

test('#2988 a check that throws never throws out of the watchdog, and starts nothing', async () => {
  const dir = scratch('throws');
  for (const over of [{ mayStartBoard: () => { throw new Error('x'); } }, { look: async () => { throw new Error('x'); } }, { board: { status: () => { throw new Error('x'); }, runNow: () => { throw new Error('ran'); } } }]) {
    const d = deps(over);
    const r = await runWith(dir, d);
    assert.equal(r.action, 'left');
    assert.equal(d.ran, 0);
  }
  assert.equal(readLog(dir), '');
});

test('#2988 watchdogMain resolves (never rejects), with the same answer as one run', async () => {
  const dir = scratch('main');
  const d = deps({ mayStartBoard: () => false });
  const r = await watch.watchdogMain({ logDir: dir, port: 9, deps: d });
  assert.equal(r.action, 'left');
});

// ── the line it writes when it starts the board ──────────────────────────────

test('#2988 the watchdog quotes the last exit recorded since the last start', async () => {
  const dir = scratch('quote');
  fs.writeFileSync(path.join(dir, 'board.log'), [
    '2026-10-28T10:00:00.000Z board started pid=10 parent=20',
    '2026-10-28T10:30:00.000Z board exited pid=10 code=0: its host process (pid 20) was gone',
    '2026-10-28T11:00:00.000Z board started pid=11 parent=21',
    '2026-10-28T11:59:00.000Z board exited pid=11 code=1: an uncaught error (Error: boom)',
    '',
  ].join('\n'));
  await runWith(dir, deps());
  assert.equal(lines(dir)[4], '2026-10-28T12:05:00.000Z board was not answering; started it. The last exit of the background board: exited pid=11 code=1: an uncaught error (Error: boom) (at 2026-10-28T11:59:00.000Z)');
});

test('#2988 an exit from an EARLIER life does not explain this one: no exit since the last start is a hard kill', async () => {
  const dir = scratch('earlier');
  fs.writeFileSync(path.join(dir, 'board.log'), [
    '2026-10-28T10:00:00.000Z board started pid=10 parent=20',
    '2026-10-28T10:30:00.000Z board exited pid=10 code=1: an uncaught error (Error: old)',
    '2026-10-28T11:00:00.000Z board started pid=11 parent=21',
    '',
  ].join('\n'));
  await runWith(dir, deps());
  assert.match(lines(dir)[3], /board was not answering; started it\. No exit was recorded, so it was killed or crashed hard$/);
});

test('#2988 an exit line rotated aside (board.log.1) is still found', async () => {
  const dir = scratch('rotated');
  fs.writeFileSync(path.join(dir, 'board.log.1'), '2026-10-28T11:00:00.000Z board started pid=11 parent=21\n2026-10-28T11:59:00.000Z board exited pid=11 code=130: a console signal (SIGINT)\n');
  await runWith(dir, deps());
  assert.match(lines(dir)[0], /The last exit of the background board: exited pid=11 code=130: a console signal \(SIGINT\)/);
});

test('#2988 an agent named "board" shares board.log through its supervisor\'s own logger, and its lines are never taken for the board\'s exit', async () => {
  const dir = scratch('foreign');
  const p = fakeProc(11, 21);
  watch.recordBoardExits({ proc: p, logDir: dir, watch: capturedWatch().arm });
  /* What engine/win32supervisor.js writes for an agent named "board": the same logger, the same file. */
  require('./win32supervisorlog').logger('board', { dir }).line('board exited pid=4 code=1: an agent line that happens to look like the board\'s');
  assert.equal(lines(dir).length, 2, readLog(dir));
  await runWith(dir, deps());
  assert.match(lines(dir)[2], /started it\. No exit was recorded, so it was killed or crashed hard$/);
});

// ── the crash-loop guard (round 1) ──────────────────────────────────────────

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-28T12:00:00.000Z');
/* One tick a minute from T0, with a board that is silent (or answering) as `silentAt(minute)` says. */
async function ticks(dir, minutes, silentAt) {
  const clock = { t: T0 };
  const d = deps({ now: () => clock.t, look: async () => ({ silent: silentAt(Math.round((clock.t - T0) / MIN)) }) });
  const startedAt = [];
  for (let m = 0; m < minutes; m += 1) {
    clock.t = T0 + m * MIN;
    const before = d.ran;
    await runWith(dir, d);
    if (d.ran > before) startedAt.push(m);
  }
  return startedAt;
}

test('#2988 round 1: a board that dies on every boot is started 3 times in 15 minutes, then once every 15, with ONE line saying so', async () => {
  const dir = scratch('loop');
  fs.writeFileSync(path.join(dir, 'board.log'), '2026-10-28T11:59:00.000Z board started pid=10 parent=20\n2026-10-28T11:59:30.000Z board exited pid=10 code=1: an uncaught error (Error: first)\n');
  const startedAt = await ticks(dir, 40, () => true);
  assert.deepEqual(startedAt, [0, 1, 2, 17, 32], 'on 7c916e1413 every one of the 40 ticks was a /Run');
  const loopLines = lines(dir).filter((l) => l.includes('kept starting and stopping'));
  assert.deepEqual(loopLines, ['2026-10-28T12:03:00.000Z board kept starting and stopping (3 starts in 15 minutes), so it is now started at most once every 15 minutes. '
    + 'The first exit of the background board: exited pid=10 code=1: an uncaught error (Error: first) (at 2026-10-28T11:59:30.000Z)']);
});

test('#2988 round 1: three starts spread over more than 15 minutes are not a loop', async () => {
  const dir = scratch('spread');
  const startedAt = await ticks(dir, 30, (m) => m % 8 === 0);
  assert.deepEqual(startedAt, [0, 8, 16, 24]);
  assert.ok(!readLog(dir).includes('kept starting'));
});

test('#2988 round 1: the back-off clears once a board has answered for 10 minutes, and a later death is started at once', async () => {
  const dir = scratch('clear');
  /* dead 0-3 (loop), answering 4-15, dead again from 16 */
  const startedAt = await ticks(dir, 20, (m) => m < 4 || m >= 16);
  assert.deepEqual(startedAt, [0, 1, 2, 16, 17, 18], 'a new run of starts, counted afresh (a fourth at 19 would be a new loop)');
  assert.ok(lines(dir).some((l) => /board has answered for 10 minutes, so it is started again whenever it stops$/.test(l)), readLog(dir));
  assert.equal(fs.existsSync(path.join(dir, 'board-watchdog.json')), true, 'a fresh state for the new start');
});

test('#2988 round 1: a board that answered only briefly does not clear the back-off', async () => {
  const dir = scratch('brief');
  /* dead 0-3 (loop), answering 4-6, dead from 7: the back-off from the start at 2 holds until 17 */
  const startedAt = await ticks(dir, 20, (m) => m < 4 || m >= 7);
  assert.deepEqual(startedAt, [0, 1, 2, 17]);
});

test('#2988 round 1: a torn guard file starts fresh rather than holding a back-off', async () => {
  const dir = scratch('torn');
  fs.writeFileSync(path.join(dir, 'board-watchdog.json'), '{ torn');
  const startedAt = await ticks(dir, 1, () => true);
  assert.deepEqual(startedAt, [0]);
});

// ── the port the watchdog asks ──────────────────────────────────────────────

test('#2988 the port is the launcher\'s: PORT when usable, the default otherwise', async () => {
  for (const [env, want] of [[{}, 16180], [{ PORT: '17001' }, 17001], [{ PORT: 'nope' }, 16180], [{ PORT: '70000' }, 16180]]) {
    const asked = [];
    const d = deps({ look: async (port) => { asked.push(port); return { silent: false }; } });
    await watch.watchdogRun({ logDir: scratch('port'), env, deps: d });
    assert.deepEqual(asked, [want], JSON.stringify(env));
  }
});

// ── 3. "no update in flight", through the updater's own readers ─────────────

const OLD = '0.6.60';
const NEW = '0.6.61';
function install() {
  const dir = scratch('upd');
  const root = path.join(dir, 'Kosmos');
  const anchor = path.join(dir, 'anchor');
  const work = path.join(root, win32update.WORK_DIRNAME);
  const staged = path.join(work, win32update.STAGED_DIRNAME);
  fs.mkdirSync(staged, { recursive: true });
  fs.mkdirSync(path.join(root, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(anchor, { recursive: true });
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), path.join(root, 'app', 'engine'));
  return { dir, root, anchor, work, staged, journal: path.join(anchor, win32anchor.UPDATE_JOURNAL_NAME), lock: path.join(work, win32update.LOCK_NAME) };
}
function stage(c) {
  return win32apply.writeStagedJournal(c.journal, {
    root: c.root, anchor: c.anchor, fromVersion: OLD, fromIdentity: OLD + '+a',
    prepared: { version: NEW, expectedIdentity: NEW + '+b', sha256: 'a'.repeat(64), runtimeChanged: false, stagedDir: c.staged },
    board: { pid: null, port: 9 }, now: Date.now(),
  });
}
function rewrite(c, change) {
  const j = JSON.parse(fs.readFileSync(c.journal, 'utf8'));
  fs.writeFileSync(c.journal, JSON.stringify({ ...j, ...change }, null, 2));
}
/* The watchdog with every other gate open, and the REAL update check for this install. */
function realUpdateDeps() {
  const d = deps();
  delete d.updateInFlight;   // the watchdog's own default: win32apply.readJournal and win32update.lockHeldNow
  return d;
}
const realRun = (c, d) => runWith(scratch('log'), d, { anchorDir: c.anchor, root: c.root });

test('#2988 no journal and no lock: no update in flight, so a silent board is started', async () => {
  const c = install();
  const d = realUpdateDeps(c);
  assert.equal((await realRun(c, d)).action, 'started');
  assert.equal(d.ran, 1);
});

for (const phase of win32apply.PHASES) {
  test('#2988 an update journal at phase "' + phase + '": the watchdog does not /Run', async () => {
    const c = install();
    stage(c);
    rewrite(c, { phase });
    assert.equal(win32apply.readJournal(c.journal).state, 'unfinished', 'the journal is one the updater itself reads as unfinished');
    const d = realUpdateDeps(c);
    const r = await realRun(c, d);
    assert.equal(r.action, 'left');
    assert.match(r.why, /an update has not finished/);
    assert.equal(d.ran, 0);
  });
}

test('#2988 a finished journal is no update in flight', async () => {
  const c = install();
  stage(c);
  rewrite(c, { phase: 'confirmed', finished: true, outcome: 'updated' });
  const d = realUpdateDeps(c);
  assert.equal((await realRun(c, d)).action, 'started');
});

test('#2988 a journal that cannot be read is a doubt, and a doubt starts nothing', async () => {
  const c = install();
  fs.writeFileSync(c.journal, '{ torn');
  const d = realUpdateDeps(c);
  const r = await realRun(c, d);
  assert.equal(r.action, 'left');
  assert.equal(d.ran, 0);
});

test('#2988 the update lock held by a LIVE owner (the updater\'s own takeLock) starts nothing; a dead owner\'s lock does not hold', async () => {
  const c = install();
  fs.mkdirSync(c.work, { recursive: true });
  const text = win32update.takeLock(c.lock, () => {}, { processImage: null });
  try {
    const d = realUpdateDeps(c);
    const r = await realRun(c, d);
    assert.equal(r.action, 'left');
    assert.match(r.why, /the update lock is held/);
    assert.equal(d.ran, 0);
  } finally {
    win32update.releaseLock(c.lock, text, () => {});
  }
  /* A lock whose process is gone: the pid of a child that has already exited. */
  const gone = cp.spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(c.lock, JSON.stringify({ pid: gone, at: Date.now(), token: 'x' }));
  const d2 = realUpdateDeps(c);
  assert.equal((await realRun(c, d2)).action, 'started');
});

test('#2988 round 5: after a move, a lock held under the RUNNING engine\'s folder holds even though the finished journal names the old one', async () => {
  const c = install();
  stage(c);
  rewrite(c, { phase: 'confirmed', finished: true, outcome: 'updated' });
  /* The engine now runs from another folder (a move after that update), and its own updater holds the lock there. */
  const now = path.join(c.dir, 'Moved', 'Kosmos');
  const nowWork = path.join(now, win32update.WORK_DIRNAME);
  fs.mkdirSync(nowWork, { recursive: true });
  const lockAt = path.join(nowWork, win32update.LOCK_NAME);
  const text = win32update.takeLock(lockAt, () => {}, { processImage: null });
  try {
    const d = realUpdateDeps();
    const r = await runWith(scratch('log'), d, { anchorDir: c.anchor, root: now });
    assert.equal(r.action, 'left', JSON.stringify(r));
    assert.match(r.why, /the update lock is held/);
    assert.equal(d.ran, 0);
  } finally {
    win32update.releaseLock(lockAt, text, () => {});
  }
});

test('#2988 round 6: a hold that appears only while the crash-loop guard runs still stops the /Run', async () => {
  /* After the second look, the watchdog's clock is read first by the second hold check and then by the
     crash-loop guard. The real hold is written at the guard's clock read, after both earlier checks have
     passed: only a read after the guard can see it. */
  const anchor = scratch('guardhold');
  let armed = false;
  let reads = 0;
  const d = deps({
    now: () => {
      if (armed) { reads += 1; if (reads === 2) watch.holdBoard(anchor, 'moving'); }
      return Date.now();
    },
  });
  delete d.held;   // the watchdog's own reading of the hold files
  d.sleep = async () => { armed = true; };
  const r = await runWith(scratch('log'), d, { anchorDir: anchor });
  assert.equal(r.action, 'left', JSON.stringify(r));
  assert.match(r.why, /the board was stopped on purpose \(moving\)/);
  assert.equal(d.ran, 0, 'on cee40c8beb this /Run went ahead');
});

test('#2988 round 6: a broken update lock is said once in board.log, and the mark clears once the lock reads normally', async () => {
  const dir = scratch('brokenlock');
  let broken = true;
  const d = deps({ updateInFlight: () => (broken
    ? { inFlight: true, why: 'the update lock is a folder, not a file', brokenLock: 'C:\\Kosmos\\.kosmos-update\\prepare.lock' }
    : { inFlight: false }) });
  await runWith(dir, d);
  await runWith(dir, d);
  const said = lines(dir).filter((l) => l.includes('board note: Kosmos is not starting the board again on its own'));
  assert.equal(said.length, 1, readLog(dir));
  assert.match(said[0], /because a file the updater uses \(C:\\Kosmos\\\.kosmos-update\\prepare\.lock\) cannot be read, so Kosmos cannot tell whether an update is running\. If Kosmos is not updating, remove that file\.$/);
  assert.equal(d.ran, 0);
  broken = false;
  await runWith(dir, deps({ look: async () => ({ silent: false }) }));
  await runWith(dir, deps({ updateInFlight: d.updateInFlight, look: async () => ({ silent: false }) }));
  broken = true;
  await runWith(dir, d);
  assert.equal(lines(dir).filter((l) => l.includes('board note: Kosmos is not starting the board again on its own')).length, 2, 'said again after the lock read normally once');
});

test('#2988 round 6 (WIRING CHECK, a source match, not behaviour): a window board that loses the port to the background board says so in board.log, and the hold refresh stops after ten minutes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /err\.code === 'EADDRINUSE'\) \{\s*try \{ require\('\.\/engine\/win32boardwatch'\)\.boardLogNote\("This window's Kosmos could not start because the background board took its place; Kosmos is running in the background\."\)/);
  assert.match(src, /if \(handOffHoldRefreshes > 10\) \{ stopHandOffHold\(\); return; \}/);
});

test('#2988 a lock left beside a FINISHED journal is still the updater\'s, and still holds', async () => {
  const c = install();
  stage(c);
  rewrite(c, { phase: 'confirmed', finished: true, outcome: 'updated' });
  const text = win32update.takeLock(c.lock, () => {}, { processImage: null });
  try {
    const d = realUpdateDeps(c);
    assert.equal((await realRun(c, d)).action, 'left');
    assert.equal(d.ran, 0);
  } finally {
    win32update.releaseLock(c.lock, text, () => {});
  }
});

// ── 4. the shim the watchdog task runs ──────────────────────────────────────

/* The engine file the shim loads: this module's own name, which the shim must spell the same. */
const ENGINE_FILE = 'win32boardwatch.js';
/* An anchor folder with the real shim, a pointer, and an engine whose watchdog records that it ran. */
function shimSetup() {
  const dir = scratch('shim');
  const anchor = path.join(dir, 'anchor');
  const engine = path.join(dir, 'app', 'engine');
  fs.mkdirSync(anchor, { recursive: true });
  fs.mkdirSync(engine, { recursive: true });
  const marker = path.join(dir, 'ran.json');
  fs.writeFileSync(path.join(engine, ENGINE_FILE),
    'exports.watchdogMain = async (o) => { require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', JSON.stringify(o)); };\n');
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), engine + '\r\n');
  fs.writeFileSync(path.join(anchor, board.WATCH_NAME), board.WATCH_JS);
  const runShim = () => cp.spawnSync(process.execPath, [path.join(anchor, board.WATCH_NAME)], { encoding: 'utf8', timeout: 30000 });
  return { anchor, engine, marker, runShim };
}

test('#2988 the shim runs the engine\'s watchdog through the pointer, hands it its own folder, and exits 0', () => {
  const s = shimSetup();
  const r = s.runShim();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.marker, 'utf8')), { anchorDir: s.anchor });
});

test('#2988 the shim does not even LOAD the engine while an update is unfinished (the engine folder may be mid-move)', () => {
  for (const journal of [JSON.stringify({ finished: false, phase: 'moving-in' }), '{ torn', JSON.stringify({ phase: 'staged' })]) {
    const s = shimSetup();
    fs.writeFileSync(path.join(s.anchor, win32anchor.UPDATE_JOURNAL_NAME), journal);
    const r = s.runShim();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(s.marker), false, 'loaded the engine with this journal: ' + journal);
  }
  const done = shimSetup();
  fs.writeFileSync(path.join(done.anchor, win32anchor.UPDATE_JOURNAL_NAME), JSON.stringify({ finished: true }));
  assert.equal(done.runShim().status, 0);
  assert.equal(fs.existsSync(done.marker), true, 'a finished journal is no reason to skip');
});

test('#2988 the shim with no pointer, or a pointer to an engine without the watchdog, does nothing and exits 0', () => {
  const s = shimSetup();
  fs.rmSync(path.join(s.engine, ENGINE_FILE));
  assert.equal(s.runShim().status, 0);
  fs.rmSync(path.join(s.anchor, win32anchor.POINTER_NAME));
  assert.equal(s.runShim().status, 0);
  assert.equal(fs.existsSync(s.marker), false);
});

test('#2988 the engine file the shim names is this module, and it exports the entry the shim calls', () => {
  assert.equal(path.basename(require.resolve('./win32boardwatch')), ENGINE_FILE);
  assert.ok(board.WATCH_JS.includes(JSON.stringify(ENGINE_FILE)), 'the shim names this module');
  assert.equal(typeof watch.watchdogMain, 'function');
  assert.ok(!board.WATCH_JS.includes(board.MARKER_ENV), 'the watchdog is not the board: it must never stamp the board-task marker');
});

// ── round 2: the board hold (a move, or a hand-off serving in a window) ─────

/* Is the watchdog held off at this instant? watchdogRun reads its gates up to the first port look
   synchronously, so calling it captures the hold as it is NOW (inside a synchronous copy seam too);
   the answer is read when the promise settles. */
function heldAt(anchor, now) {
  const d = deps({ now: now || Date.now });   // a hold is judged against the clock it was written by
  delete d.held;
  return runWith(scratch('log'), d, { anchorDir: anchor }).then((r) => /the board was stopped on purpose/.test(r.why || ''));
}
const holdFilesIn = (dir) => { try { return fs.readdirSync(dir).filter((n) => /^board-hold\.\d+\.json$/.test(n)); } catch { return []; } };

test('#2988 round 2: a live hold stops the watchdog; an expired hold, a dead owner\'s hold and a released hold do not', async () => {
  const anchor = scratch('hold');
  const tick = async (extra) => { const d = deps({ now: Date.now }); delete d.held; const r = await runWith(scratch('log'), d, { anchorDir: anchor, ...(extra || {}) }); return { r, ran: d.ran }; };
  const h = watch.holdBoard(anchor, 'Kosmos is being moved to C:\\Kosmos', { ttlMs: 60000 });
  assert.equal(h.held, true);
  let t = await tick();
  assert.equal(t.ran, 0, 'held');
  assert.match(t.r.why, /the board was stopped on purpose \(Kosmos is being moved to C:\\Kosmos\)/);
  h.release();
  assert.deepEqual(holdFilesIn(anchor), [], 'released');
  assert.equal((await tick()).ran, 1, 'released: no hold');

  watch.holdBoard(anchor, 'old', { ttlMs: 1000, now: () => Date.now() - 5000 });
  assert.equal((await tick()).ran, 1, 'an expired hold does not block');

  const gone = cp.spawnSync(process.execPath, ['-e', '0']).pid;
  watch.holdBoard(anchor, 'crashed', { pid: gone });
  assert.equal((await tick()).ran, 1, 'a dead owner\'s hold does not block');

  fs.writeFileSync(path.join(anchor, 'board-hold.' + process.pid + '.json'), JSON.stringify({ pid: process.pid, until: Date.now() + 24 * 3600 * 1000 }));
  assert.equal((await tick()).ran, 1, 'a hold claiming more than five minutes is not honoured');
});

test('#2988 round 3: one file per owner: a second holder does not cancel the first, release removes only its own, dead owners\' files are tidied', async () => {
  const anchor = scratch('owners');
  const first = watch.holdBoard(anchor, 'first', { pid: process.pid });
  const other = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
  try {
    const second = watch.holdBoard(anchor, 'second', { pid: other.pid });
    assert.equal(holdFilesIn(anchor).length, 2, 'two owners, two files');
    second.release();
    assert.deepEqual(holdFilesIn(anchor), ['board-hold.' + process.pid + '.json'], 'release removed only its own file');
    assert.equal(await heldAt(anchor), true, 'the first hold still holds after the second let go');
    watch.holdBoard(anchor, 'third', { pid: other.pid });
    first.release();
    assert.equal(await heldAt(anchor), true, 'and the other way round');
  } finally { other.kill(); }
  await new Promise((r) => other.once('exit', r));
  assert.equal(await heldAt(anchor), false, 'a dead owner\'s hold is ignored');
  const gone = cp.spawnSync(process.execPath, ['-e', '0']).pid;
  watch.holdBoard(anchor, 'crashed', { pid: gone, ttlMs: 1000, now: () => Date.now() - 5000 });
  const mine = watch.holdBoard(anchor, 'tidy', { pid: process.pid });
  assert.deepEqual(holdFilesIn(anchor), ['board-hold.' + process.pid + '.json'], 'writing a hold tidies the dead and expired ones');
  mine.release();
});

test('#2988 round 3: a hold that cannot be written says why', () => {
  const blocker = path.join(scratch('nohold'), 'a-file');
  fs.writeFileSync(blocker, 'x');
  const h = watch.holdBoard(path.join(blocker, 'anchor'), 'x');
  assert.equal(h.held, false);
  assert.match(h.because, /^Kosmos could not save a note it needed: (access was denied|a file was missing|something is in the way) \(E[A-Z]+\)$/);
});

test('#2988 round 2: a hold taken after the first look (between the two looks) still stops the /Run', async () => {
  const anchor = scratch('holdlate');
  const d = deps({ now: Date.now });
  delete d.held;
  d.sleep = async () => { watch.holdBoard(anchor, 'late'); };
  const r = await runWith(scratch('log'), d, { anchorDir: anchor });
  assert.equal(r.action, 'left');
  assert.match(r.why, /the board was stopped on purpose \(late\)/, 'held by the hold, not by a failure');
  assert.equal(d.ran, 0);
});

test('#2988 round 2: the shim leaves a live hold alone without loading the engine, and ignores an expired or dead one', () => {
  const s = shimSetup();
  const h = watch.holdBoard(s.anchor, 'moving');
  assert.equal(s.runShim().status, 0);
  assert.equal(fs.existsSync(s.marker), false, 'loaded the engine under a live hold');
  h.release();
  const gone = cp.spawnSync(process.execPath, ['-e', '0']).pid;
  watch.holdBoard(s.anchor, 'crashed', { pid: gone });
  assert.equal(s.runShim().status, 0);
  assert.equal(fs.existsSync(s.marker), true, 'a dead owner\'s hold must not stop the shim');
  fs.rmSync(s.marker);
  watch.holdBoard(s.anchor, 'old', { ttlMs: 1000, now: () => Date.now() - 5000 });
  s.runShim();
  assert.equal(fs.existsSync(s.marker), true, 'an expired hold must not stop the shim');
});

/* A Kosmos folder in a sandbox's Downloads, served (until it is ended) by its task's board. */
function moveCase(name) {
  const base = scratch(name);
  const from = path.join(base, 'Downloads', 'Kosmos');
  const to = path.join(base, 'Programs', 'Kosmos');
  const holdDir = path.join(base, 'anchor');
  fs.mkdirSync(from, { recursive: true });
  fs.writeFileSync(path.join(from, 'manifest.json'), JSON.stringify({ product: 'kosmos', platform: 'win32', version: '0.6.61' }));
  for (const e of ['app', 'runtime']) { fs.mkdirSync(path.join(from, e), { recursive: true }); fs.writeFileSync(path.join(from, e, 'x'), 'x'); }
  return { from, to, holdDir, base: { from, to, port: 9, holdDir, entries: ['manifest.json', 'app', 'runtime'], liveExecutionAllowed: () => true,
    readPointer: () => path.join(from, 'app', 'engine'), endBoardServingHere: true, sleep: async () => {}, pidState: () => 'gone' } };
}

test('#2988 round 2: the move holds the board from before its /End until it returns, and a tick during the copy does not /Run', async () => {
  const relocator = require('./win32relocate');
  for (const fail of [false, true]) {
    const c = moveCase('move');
    let stopped = false;
    const seen = { atCopy: [] };
    const r = await relocator.relocate({
      ...c.base,
      probe: async () => (stopped ? { answering: false, outcome: 'refused' } : { answering: true, identity: 'x', startedByTask: true }),
      endBoard: () => { seen.atEnd = heldAt(c.holdDir); stopped = true; return { ok: true }; },
      copy: (src, dst) => {
        seen.atCopy.push(heldAt(c.holdDir));
        if (fail) throw new Error('disk full');
        fs.cpSync(src, dst, { recursive: true });
      },
      anchor: () => ({ ok: true }),
    });
    assert.equal(r.ok, !fail, JSON.stringify(r));
    assert.equal(await seen.atEnd, true, 'the hold is written BEFORE the /End');
    assert.ok(seen.atCopy.length > 0);
    for (const p of seen.atCopy) assert.equal(await p, true, 'a watchdog tick during the copy sees the hold');
    assert.deepEqual(holdFilesIn(c.holdDir), [], 'released when the move returns, ' + (fail ? 'on failure too' : 'after success'));
  }
});

test('#2988 round 3: a copy that outlasts one hold (5 minutes) keeps the board held throughout, by refreshing it', async () => {
  const relocator = require('./win32relocate');
  const c = moveCase('slowmove');
  const clock = { t: Date.now() };
  let stopped = false;
  const seen = [];
  /* The hold files' own expiry, read straight off disk, against the move's clock: a second witness that
     does not depend on the watchdog's reading of the clock. */
  const allHoldFiles = () => { try { return fs.readdirSync(c.holdDir).filter((n) => /^board-hold(\.\d+)?\.json$/.test(n)); } catch { return []; } };
  const liveUntil = (at) => allHoldFiles().some((n) => {
    try { return JSON.parse(fs.readFileSync(path.join(c.holdDir, n), 'utf8')).until > at; } catch { return false; }
  });
  const witnessed = [];
  const r = await relocator.relocate({
    ...c.base, now: () => clock.t,
    probe: async () => (stopped ? { answering: false, outcome: 'refused' } : { answering: true, identity: 'x', startedByTask: true }),
    endBoard: () => { stopped = true; return { ok: true }; },
    /* Each top-level entry takes four minutes: twelve in all, more than two holds. */
    copy: (src, dst) => {
      clock.t += 4 * 60 * 1000;
      seen.push(heldAt(c.holdDir, () => clock.t));
      witnessed.push(liveUntil(clock.t));
      fs.cpSync(src, dst, { recursive: true });
    },
    anchor: () => { seen.push(heldAt(c.holdDir, () => clock.t + 4 * 60 * 1000)); witnessed.push(liveUntil(clock.t + 4 * 60 * 1000)); return { ok: true }; },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(witnessed, [true, true, true, true], 'the hold file on disk never lapsed during the copy');
  assert.equal(seen.length, 4);
  const got = [];
  for (const p of seen) got.push(await p);
  assert.deepEqual(got, [true, true, true, true], 'held at the end of every entry and up to the anchor (on cb4989f52f it lapsed after five minutes)');
});

test('#2988 round 3: a board that came up during the copy is ended again before the pointer moves', async () => {
  const relocator = require('./win32relocate');
  const c = moveCase('midcopy');
  let serving = true;
  const events = [];
  const r = await relocator.relocate({
    ...c.base,
    probe: async () => (serving ? { answering: true, identity: 'x', startedByTask: true } : { answering: false, outcome: 'refused' }),
    endBoard: () => { events.push('end'); serving = false; return { ok: true }; },
    copy: (src, dst) => {
      fs.cpSync(src, dst, { recursive: true });
      if (src.endsWith('runtime')) { serving = true; events.push('a board came up'); }
    },
    anchor: () => { events.push('anchor'); return { ok: true }; },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(events, ['end', 'a board came up', 'end', 'anchor']);
});

test('#2988 round 3: a move whose hold cannot be written says so in its result (the log the launcher prints)', async () => {
  const relocator = require('./win32relocate');
  const c = moveCase('moveunheld');
  fs.writeFileSync(c.holdDir, 'a file where the anchor folder should be');
  let stopped = false;
  const r = await relocator.relocate({
    ...c.base,
    probe: async () => (stopped ? { answering: false, outcome: 'refused' } : { answering: true, identity: 'x', startedByTask: true }),
    endBoard: () => { stopped = true; return { ok: true }; },
    copy: (src, dst) => fs.cpSync(src, dst, { recursive: true }),
    anchor: () => ({ ok: true }),
  });
  assert.equal(r.ok, true);
  const note = /^Kosmos could not keep its restart check from starting the board during the move, because Kosmos could not save a note it needed: (access was denied|a file was missing|something is in the way) \(E[A-Z]+\)\. The board may have started again from the old folder\.$/;
  assert.ok((r.notes || []).some((n) => note.test(n)), JSON.stringify(r.notes));
});

test('#2988 round 5: the move\'s notes also land in board.log, the one place a person can find them later', async () => {
  const relocator = require('./win32relocate');
  const c = moveCase('notelog');
  const logDir = path.join(c.holdDir + '-logs');
  fs.writeFileSync(c.holdDir, 'a file where the anchor folder should be');
  let stopped = false;
  const r = await relocator.relocate({
    ...c.base, logDir,
    probe: async () => (stopped ? { answering: false, outcome: 'refused' } : { answering: true, identity: 'x', startedByTask: true }),
    endBoard: () => { stopped = true; return { ok: true }; },
    copy: (src, dst) => fs.cpSync(src, dst, { recursive: true }),
    anchor: () => ({ ok: true }),
  });
  assert.ok((r.notes || []).length >= 1);
  const logged = lines(logDir);
  for (const n of r.notes) assert.ok(logged.some((l) => l.endsWith(' board note: ' + n)), 'not in board.log: ' + n + '\n' + logged.join('\n'));
});

test('#2988 round 4: a hold whose first write worked but whose refresh fails mid-copy is in the move\'s notes', async () => {
  const relocator = require('./win32relocate');
  const c = moveCase('refreshfail');
  let stopped = false;
  let broke = false;
  const own = path.join(c.holdDir, 'board-hold.' + process.pid + '.json');
  const r = await relocator.relocate({
    ...c.base,
    probe: async () => (stopped ? { answering: false, outcome: 'refused' } : { answering: true, identity: 'x', startedByTask: true }),
    endBoard: () => { stopped = true; return { ok: true }; },
    copy: (src, dst) => {
      if (!broke) { broke = true; fs.rmSync(own, { force: true }); fs.mkdirSync(own); }   // the next refresh cannot replace a folder
      fs.cpSync(src, dst, { recursive: true });
    },
    anchor: () => ({ ok: true }),
  });
  assert.equal(r.ok, true);
  const said = (r.notes || []).filter((n) => /^Kosmos could not keep its restart check from starting the board during the move, because Kosmos could not save a note it needed/.test(n));
  assert.equal(said.length, 1, 'said once: ' + JSON.stringify(r.notes));
});

test('#2988 round 4: at the second look a board in a window of its own (or any other program) is left alone, and said truly', async () => {
  const relocator = require('./win32relocate');
  for (const [what, later, note] of [
    ['a window board', { answering: true, identity: 'x', startedByTask: false }, /^After Kosmos was copied, something that Kosmos's startup job did not start was answering on port 9, so Kosmos was moved and that program was left alone\.$/],
    ['an unreadable look', { answering: false, outcome: 'timed-out' }, /^After Kosmos was copied, Kosmos could not tell what is using port 9, so Kosmos was moved and whatever it is was left alone\.$/],
  ]) {
    const c = moveCase('secondlook');
    let phase = 'serving';
    const ends = [];
    const r = await relocator.relocate({
      ...c.base,
      probe: async () => (phase === 'serving' ? { answering: true, identity: 'x', startedByTask: true } : phase === 'stopped' ? { answering: false, outcome: 'refused' } : later),
      endBoard: () => { ends.push(phase); phase = 'stopped'; return { ok: true }; },
      copy: (src, dst) => { fs.cpSync(src, dst, { recursive: true }); if (src.endsWith('runtime')) phase = 'other'; },
      anchor: () => ({ ok: true }),
    });
    assert.equal(r.ok, true, what);
    assert.deepEqual(ends, ['serving'], what + ': only the task\'s board was ended');
    assert.ok((r.notes || []).some((n) => note.test(n)), what + ': ' + JSON.stringify(r.notes));
    assert.ok(!(r.notes || []).some((n) => /Restart your computer/.test(n)), what);
  }
});

test('#2988 round 4: with NO board at the start (the pointer still names this folder), the move holds the board off and ends one that comes up anyway', async () => {
  const relocator = require('./win32relocate');
  const c = moveCase('noboard');
  let serving = false;
  const events = [];
  const held = [];
  const r = await relocator.relocate({
    ...c.base,
    probe: async () => (serving ? { answering: true, identity: 'x', startedByTask: true } : { answering: false, outcome: 'refused' }),
    endBoard: () => { events.push('end'); serving = false; return { ok: true }; },
    copy: (src, dst) => {
      held.push(heldAt(c.holdDir));
      fs.cpSync(src, dst, { recursive: true });
      if (src.endsWith('runtime')) { serving = true; events.push('a board came up'); }
    },
    anchor: () => { events.push('anchor'); return { ok: true }; },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const p of held) assert.equal(await p, true, 'a watchdog tick mid-copy does not /Run');
  assert.deepEqual(events, ['a board came up', 'end', 'anchor']);
  assert.deepEqual(holdFilesIn(c.holdDir), [], 'released');
});

test('#2988 round 4: a board that cannot be stopped is named, and "restart your computer" is said only when the pointer moved', async () => {
  const relocator = require('./win32relocate');
  for (const [anchored, ending] of [[true, /Restart your computer to start Kosmos from its new folder\.$/], [false, /It keeps running from the old folder\.$/]]) {
    const c = moveCase('stuck');
    let phase = 'serving';
    const r = await relocator.relocate({
      ...c.base, portReleaseWaitMs: 0,
      probe: async () => (phase === 'stopped' ? { answering: false, outcome: 'refused' } : { answering: true, identity: 'x', startedByTask: true }),
      endBoard: () => { if (phase === 'serving') { phase = 'stopped'; return { ok: true }; } return { ok: false, because: 'access is denied' }; },
      copy: (src, dst) => { fs.cpSync(src, dst, { recursive: true }); if (src.endsWith('runtime')) phase = 'back'; },
      anchor: () => (anchored ? { ok: true } : { ok: false, because: 'the anchor folder is read-only' }),
    });
    assert.equal(r.ok, true);
    const n = (r.notes || []).find((x) => x.startsWith('A Kosmos board started from the old folder while Kosmos was being moved, and it could not be stopped: access is denied. '));
    assert.ok(n, JSON.stringify(r.notes));
    assert.match(n, ending);
  }
});

test('#2988 round 4: a board.log note is written as a note, and is never taken for an exit', async () => {
  const dir = scratch('note');
  fs.writeFileSync(path.join(dir, 'board.log'), '2026-10-28T11:00:00.000Z board started pid=11 parent=21\n');
  watch.boardLogNote('Kosmos could not keep its restart check from starting the background board while this window started, because x.', { logDir: dir });
  assert.match(lines(dir)[1], /^\S+ board note: Kosmos could not keep its restart check/);
  await runWith(dir, deps());
  assert.match(lines(dir)[2], /No exit was recorded/);
});

test('#2988 round 2: the hand-off that serves in a window holds the board before its /End and leaves the release to the board once it listens', async () => {
  const handoff = require('./win32handoff');
  const holdDir = scratch('handoffhold');
  const seen = {};
  let ended = false;
  const fakeBoard = {
    startedByTask: () => false, bundleRoot: () => 'C:\\Kosmos', status: () => ({ known: true, registered: true, enabled: true, running: null }),
    runNow: () => ({ ok: true }),
    end: () => { seen.atEnd = heldAt(holdDir); ended = true; return { ok: true }; },
  };
  const r = await handoff.handOffToTask(handOffOpts(fakeBoard, holdDir));
  assert.equal(r.serve, true, JSON.stringify(r));
  assert.equal(ended, true, 'the not-confirmed path ends the task: ' + r.because);
  assert.equal(await seen.atEnd, true, 'held before the /End');
  assert.equal(await heldAt(holdDir), true, 'still held while this board boots');
  assert.equal(r.holdProblem, undefined);
  /* Round 5: server.js refreshes it every minute while the board starts; a refresh rewrites the hold. */
  const file = path.join(holdDir, 'board-hold.' + process.pid + '.json');
  const before = JSON.parse(fs.readFileSync(file, 'utf8')).at;
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.refreshHold(), true);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).at > before, 'the refresh wrote it again');
  r.releaseHold();
  assert.equal(await heldAt(holdDir), false, 'released once the board listens (server.js calls releaseHold)');
});

function handOffOpts(fakeBoard, holdDir) {
  let t = 0;
  return {
    platform: 'win32', env: {}, byTask: false, bundle: true, live: true, ensured: { ok: true, action: 'refreshed' },
    port: 9, identity: 'me', startedAt: 0, now: () => t, sleep: async (ms) => { t += ms; },
    probe: async () => ({ answering: false, outcome: 'refused' }), board: fakeBoard, holdDir, signalEnv: {},
    worlds: { worldenv: { bootedBaseDir: () => null, bootedWorld: () => null }, guard: { retractAttempt: () => false, recordAttempt: () => {} } },
  };
}

test('#2988 round 3: a hand-off whose hold cannot be written says so (server.js prints holdProblem)', async () => {
  const handoff = require('./win32handoff');
  const blocker = path.join(scratch('handoffnohold'), 'a-file');
  fs.writeFileSync(blocker, 'x');
  const fakeBoard = {
    startedByTask: () => false, bundleRoot: () => 'C:\\Kosmos', status: () => ({ known: true, registered: true, enabled: true, running: null }),
    runNow: () => ({ ok: true }), end: () => ({ ok: true }),
  };
  const r = await handoff.handOffToTask(handOffOpts(fakeBoard, path.join(blocker, 'anchor')));
  assert.equal(r.serve, true);
  assert.match(r.holdProblem || '', /^Kosmos could not save a note it needed: (access was denied|a file was missing|something is in the way) \(E[A-Z]+\)$/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /if \(handOff\.holdProblem\) \{[\s\S]{0,400}process\.stderr\.write\(holdNote[\s\S]{0,120}boardLogNote\(holdNote\)/, 'wiring check: server.js prints it and writes it to board.log');
});

test('#2988 round 5 (WIRING CHECK, a source match, not behaviour): server.js refreshes the hand-off\'s hold every minute, unref\'d, and stops when the board listens or fails', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /handOffHoldTimer = setInterval\(\(\) => \{[\s\S]{0,200}try \{ handOff\.refreshHold\(\); \}[\s\S]{0,120}60 \* 1000\);\s*if \(typeof handOffHoldTimer\.unref === 'function'\) handOffHoldTimer\.unref\(\);/);
  assert.match(src, /start\(\)\.then\(\(\) => \{\s*stopHandOffHold\(\);/);
  assert.match(src, /\}\)\.catch\(\(err\) => \{\s*stopHandOffHold\(\);/);
});

test('#2988 round 2 (WIRING CHECK, a source match, not behaviour): server.js releases the hand-off\'s hold once the board is listening', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /start\(\)\.then\(\(\) => \{[\s\S]{0,400}handOff\.releaseHold\(\)/);
});

// ── 5. the watchdog task: its definition, its registration, its removal ─────

test('#2988 the watchdog task XML: a TimeTrigger from a fixed past start, every minute, no duration, IgnoreNew, headless, always on', () => {
  const env = { USERNAME: 'someone', USERDOMAIN: 'BOX', SystemRoot: 'C:\\Windows' };
  const xml = board.watchdogTaskXml({ node: 'C:\\K\\node.exe', watch: 'C:\\K\\board-watchdog.js', workingDir: 'C:\\Kosmos' }, env);
  assert.match(xml, /<Triggers><TimeTrigger><Repetition><Interval>PT1M<\/Interval><StopAtDurationEnd>false<\/StopAtDurationEnd><\/Repetition><StartBoundary>2020-01-01T00:00:00<\/StartBoundary><Enabled>true<\/Enabled><\/TimeTrigger><\/Triggers>/);
  assert.ok(Date.parse(xml.match(/<StartBoundary>([^<]+)</)[1]) < Date.now(), 'the start is in the past, so it fires from the next minute on');
  assert.ok(!/<Duration>/.test(xml), 'no duration: the repetition never ends');
  assert.ok(!/LogonTrigger/.test(xml), 'a logon trigger does not fire before the next logon (measured)');
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(xml, /<Settings>.*<Enabled>true<\/Enabled><\/Settings>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType><RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<UserId>BOX\\someone<\/UserId>/);
  assert.match(xml, /<Command>C:\\Windows\\System32\\conhost\.exe<\/Command><Arguments>--headless &quot;C:\\K\\node\.exe&quot; &quot;C:\\K\\board-watchdog\.js&quot;<\/Arguments><WorkingDirectory>C:\\Kosmos<\/WorkingDirectory>/);
  assert.ok(xml.includes('Remove with: schtasks /Delete /F /TN &quot;Kosmos\\board-watchdog&quot;'), 'it says how to remove it');
  assert.match(xml, /that is its only off switch: switching this check off is undone the next time Kosmos starts/);
  assert.equal(board.WATCHDOG_TASK_NAME, 'Kosmos\\board-watchdog');
  assert.ok(!board.WATCHDOG_TASK_NAME.startsWith(require('./win32job').TASK_PREFIX), 'never mistaken for an agent');
});

/* The board suite's scheduler stub, with the /Create definitions captured as they were written. */
const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };
const XML = (enabled) => ({ ok: true, out: '<?xml version="1.0"?><Task><Settings>' + (enabled ? '' : '<Enabled>false</Enabled>') + '</Settings><Triggers><LogonTrigger/></Triggers></Task>' });
const ROW = { ok: true, out: '"BOX","\\Kosmos\\board","N/A","Ready","Interactive only","N/A","267014"\r\n' };
function runner(script) {
  const calls = [];
  const xmls = {};
  const fn = (args) => {
    calls.push(args.join(' '));
    if (args[0] === '/Query') {
      if (args.includes('/XML')) return script.xml || NOT_FOUND;
      if (args.includes('/V')) return script.verbose || NOT_FOUND;
      return NOT_FOUND;
    }
    if (args[0] === '/Create') xmls[args[3]] = fs.readFileSync(args[5]).toString('utf16le');
    const fail = script.fail && script.fail[args.join(' ')];
    return fail || { ok: true, out: 'SUCCESS' };
  };
  fn.calls = calls;
  fn.xmls = xmls;
  return fn;
}
const ANCHOR = scratch('anchor');
const ENV = { USERNAME: 'someone', USERDOMAIN: 'BOX', AGENT_WORKFORCE_DATA: ANCHOR, SystemRoot: 'C:\\Windows' };
const BUNDLE = { platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true };
const CLAIM_DIR = win32anchor.anchorDir('win32', ANCHOR, ENV);
test.beforeEach(() => {
  board.setAnchorer(() => ({ ok: true, node: path.join(ANCHOR, 'node.exe'), dir: ANCHOR, pointer: path.join(ANCHOR, 'engine-path') }));
  fs.mkdirSync(CLAIM_DIR, { recursive: true });
  try { fs.rmSync(path.join(CLAIM_DIR, board.CLAIM_NAME), { force: true }); } catch { /* best effort */ }
});
test.afterEach(() => { board.setRunner(null); board.setAnchorer(null); });

const READY = { xml: XML(true), verbose: ROW };
const DISABLED = { xml: XML(false), verbose: ROW };

test('#2988 ensureInstalled registers the watchdog right after a NEW board task, and writes its shim', () => {
  const r = runner({});
  board.setRunner(r);
  const out = board.ensureInstalled(BUNDLE);
  assert.equal(out.action, 'registered', out.because);
  assert.deepEqual(out.watchdog, { ok: true, task: board.WATCHDOG_TASK_NAME });
  const creates = r.calls.filter((c) => c.startsWith('/Create'));
  assert.deepEqual(creates.map((c) => c.split(' ')[3]), ['Kosmos\\board', 'Kosmos\\board-watchdog'], r.calls.join(' | '));
  assert.equal(fs.readFileSync(path.join(ANCHOR, board.WATCH_NAME), 'utf8'), board.WATCH_JS);
  assert.match(r.xmls['Kosmos\\board-watchdog'], /<TimeTrigger>/);
  assert.match(r.xmls['Kosmos\\board-watchdog'], new RegExp(board.WATCH_NAME.replace('.', '\\.')));
  assert.ok(!('installed' in out) && !('started' in out), 'nothing internal leaks into the answer');
});

test('#2988 ensureInstalled refreshes the watchdog with an ENABLED board task, and never touches the board task\'s switch', () => {
  const r = runner(READY);
  board.setRunner(r);
  const out = board.ensureInstalled(BUNDLE);
  assert.equal(out.action, 'refreshed', out.because);
  assert.equal(out.watchdog.ok, true);
  assert.ok(r.calls.includes('/Create /F /TN Kosmos\\board-watchdog /XML ' + r.calls.find((c) => c.includes('board-watchdog')).split(' ')[5]));
  assert.ok(!r.calls.some((c) => /^\/Change/.test(c)), 'no /Change of any task: ' + r.calls.join(' | '));
  assert.match(r.xmls['Kosmos\\board'], /<Settings>.*<Enabled>true<\/Enabled><\/Settings>/s, 'the board task keeps the switch it was read with');
});

for (const [what, script, claimFirst] of [['switched off', DISABLED, false], ['removed after Kosmos claimed it', {}, true], ['unreadable', { xml: { ok: false, out: 'ERROR: Access is denied.' } }, false]]) {
  test('#2988 a board task ' + what + ' gets no watchdog from this boot', () => {
    if (claimFirst) board.claim(BUNDLE);
    const r = runner(script);
    board.setRunner(r);
    const out = board.ensureInstalled(BUNDLE);
    assert.ok(!r.calls.some((c) => c.includes('board-watchdog')), r.calls.join(' | '));
    assert.equal(out.watchdog, undefined);
  });
}

test('#2988 a watchdog Windows would not register is said, and the board task\'s answer stands', () => {
  const r = runner({ ...READY, fail: {} });
  const fn = (args, opts) => (args[0] === '/Create' && args[3] === board.WATCHDOG_TASK_NAME ? { ok: false, out: 'ERROR: Access is denied.' } : r(args, opts));
  board.setRunner(fn);
  const out = board.ensureInstalled(BUNDLE);
  assert.equal(out.ok, true);
  assert.equal(out.action, 'refreshed');
  assert.deepEqual(out.watchdog, { ok: false, because: 'we could not register the job that restarts the board if it stops (ERROR: Access is denied.)' });
});

test('#2988 the watchdog never makes a boot spend more than its two schtasks timeouts: it gets what is left, or waits for the next boot', () => {
  const T = board.SCHTASKS_TIMEOUT_MS;
  for (const [what, cost, expectWatchdog] of [
    ['a quick scheduler', () => 50, true],
    ['every call takes its whole allowance', (granted) => granted, false],
  ]) {
    const clock = { t: 0 };
    const inner = runner(READY);
    const granted = [];
    board.setRunner((args, opts) => { granted.push(opts && opts.timeoutMs); clock.t += cost(opts && opts.timeoutMs); return inner(args); });
    const out = board.ensureInstalled({ ...BUNDLE, now: () => clock.t });
    assert.ok(clock.t <= 2 * T, what + ': ' + clock.t);
    assert.equal(out.watchdog.ok, expectWatchdog, what + ': ' + JSON.stringify(out.watchdog));
    if (!expectWatchdog) assert.match(out.watchdog.because, /no time left/);
    else assert.ok(granted[granted.length - 1] > 0 && granted[granted.length - 1] <= T, 'the watchdog\'s /Create was given a bounded time: ' + granted.join(','));
  }
});

test('#2988 remove() takes the watchdog FIRST, then the board; a watchdog that is not there is already removed', () => {
  const r = runner({});
  board.setRunner(r);
  assert.equal(board.remove(BUNDLE).ok, true);
  assert.deepEqual(r.calls, ['/Delete /F /TN Kosmos\\board-watchdog', '/Delete /F /TN Kosmos\\board']);

  board.setRunner((args) => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  assert.equal(board.remove(BUNDLE).ok, true);
});

test('#2988 remove() with a watchdog Windows would not delete is not ok, and says which job', () => {
  board.setRunner((args) => (args[3] === board.WATCHDOG_TASK_NAME ? { ok: false, out: 'ERROR: Access is denied.' } : { ok: true, out: 'SUCCESS' }));
  const out = board.remove(BUNDLE);
  assert.equal(out.ok, false);
  assert.equal(out.boardRemoved, true);
  assert.match(out.because, /restarts the board if it stops \(ERROR: Access is denied\.\)/);
});
