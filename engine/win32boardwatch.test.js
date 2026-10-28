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

for (const sig of watch.SIGNALS) {
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
  assert.deepEqual(d.slept, [watch.SECOND_LOOK_AFTER_MS]);
  assert.ok(watch.SECOND_LOOK_AFTER_MS >= 2000 && watch.SECOND_LOOK_AFTER_MS <= 10000, 'a few seconds');
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
  assert.equal(lines(dir)[4], '2026-10-28T12:05:00.000Z board was not answering; started it. The last exit recorded: exited pid=11 code=1: an uncaught error (Error: boom) (at 2026-10-28T11:59:00.000Z)');
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
  assert.match(lines(dir)[0], /The last exit recorded: exited pid=11 code=130: a console signal \(SIGINT\)/);
});

test('#2988 lines that are not the board\'s own (an agent sharing the name) are never taken for an exit', () => {
  const dir = scratch('foreign');
  const file = path.join(dir, 'board.log');
  fs.writeFileSync(file, '2026-10-28T11:00:00.000Z board started pid=11 parent=21\nturn-failed: board exited pid=4 code=1\n');
  assert.equal(watch.lastExitSinceStart(file), null);
});

// ── the port the watchdog asks ──────────────────────────────────────────────

test('#2988 the port is the launcher\'s: PORT when usable, the default otherwise', () => {
  assert.equal(watch.boardPortFrom({}), 16180);
  assert.equal(watch.boardPortFrom({ PORT: '17001' }), 17001);
  assert.equal(watch.boardPortFrom({ PORT: 'nope' }), 16180);
  assert.equal(watch.boardPortFrom({ PORT: '70000' }), 16180);
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
function realUpdateDeps(c) {
  return deps({ updateInFlight: () => watch.updateInFlight({ anchorDir: c.anchor, root: c.root, lockHooks: { processImage: null } }) });
}

test('#2988 no journal and no lock: no update in flight, so a silent board is started', async () => {
  const c = install();
  assert.deepEqual(watch.updateInFlight({ anchorDir: c.anchor, root: c.root }), { inFlight: false });
  const d = realUpdateDeps(c);
  assert.equal((await runWith(scratch('log'), d)).action, 'started');
  assert.equal(d.ran, 1);
});

for (const phase of win32apply.PHASES) {
  test('#2988 an update journal at phase "' + phase + '": the watchdog does not /Run', async () => {
    const c = install();
    stage(c);
    rewrite(c, { phase });
    assert.equal(win32apply.readJournal(c.journal).state, 'unfinished', 'the journal is one the updater itself reads as unfinished');
    const d = realUpdateDeps(c);
    const r = await runWith(scratch('log'), d);
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
  assert.equal((await runWith(scratch('log'), d)).action, 'started');
});

test('#2988 a journal that cannot be read is a doubt, and a doubt starts nothing', async () => {
  const c = install();
  fs.writeFileSync(c.journal, '{ torn');
  const d = realUpdateDeps(c);
  const r = await runWith(scratch('log'), d);
  assert.equal(r.action, 'left');
  assert.equal(d.ran, 0);
});

test('#2988 the update lock held by a LIVE owner (the updater\'s own takeLock) starts nothing; a dead owner\'s lock does not hold', async () => {
  const c = install();
  fs.mkdirSync(c.work, { recursive: true });
  const text = win32update.takeLock(c.lock, () => {}, { processImage: null });
  try {
    const d = realUpdateDeps(c);
    const r = await runWith(scratch('log'), d);
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
  assert.equal((await runWith(scratch('log'), d2)).action, 'started');
});

test('#2988 a lock left beside a FINISHED journal is still the updater\'s, and still holds', async () => {
  const c = install();
  stage(c);
  rewrite(c, { phase: 'confirmed', finished: true, outcome: 'updated' });
  const text = win32update.takeLock(c.lock, () => {}, { processImage: null });
  try {
    const d = realUpdateDeps(c);
    assert.equal((await runWith(scratch('log'), d)).action, 'left');
    assert.equal(d.ran, 0);
  } finally {
    win32update.releaseLock(c.lock, text, () => {});
  }
});

// ── 4. the shim the watchdog task runs ──────────────────────────────────────

/* An anchor folder with the real shim, a pointer, and an engine whose watchdog records that it ran. */
function shimSetup() {
  const dir = scratch('shim');
  const anchor = path.join(dir, 'anchor');
  const engine = path.join(dir, 'app', 'engine');
  fs.mkdirSync(anchor, { recursive: true });
  fs.mkdirSync(engine, { recursive: true });
  const marker = path.join(dir, 'ran.json');
  fs.writeFileSync(path.join(engine, board.WATCH_ENGINE_FILE),
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
  fs.rmSync(path.join(s.engine, board.WATCH_ENGINE_FILE));
  assert.equal(s.runShim().status, 0);
  fs.rmSync(path.join(s.anchor, win32anchor.POINTER_NAME));
  assert.equal(s.runShim().status, 0);
  assert.equal(fs.existsSync(s.marker), false);
});

test('#2988 the engine file the shim names is this module, and it exports the entry the shim calls', () => {
  assert.equal(path.basename(require.resolve('./win32boardwatch')), board.WATCH_ENGINE_FILE);
  assert.equal(typeof watch.watchdogMain, 'function');
  assert.ok(!board.WATCH_JS.includes(board.MARKER_ENV), 'the watchdog is not the board: it must never stamp the board-task marker');
});

// ── 5. the watchdog task: its definition, its registration, its removal ─────

test('#2988 the watchdog task XML: a TimeTrigger from a fixed past start, every minute, no duration, IgnoreNew, headless, always on', () => {
  const env = { USERNAME: 'someone', USERDOMAIN: 'BOX', SystemRoot: 'C:\\Windows' };
  const xml = board.watchdogTaskXml({ node: 'C:\\K\\node.exe', watch: 'C:\\K\\board-watchdog.js', workingDir: 'C:\\Kosmos' }, env);
  assert.match(xml, /<Triggers><TimeTrigger><Repetition><Interval>PT1M<\/Interval><StopAtDurationEnd>false<\/StopAtDurationEnd><\/Repetition><StartBoundary>2020-01-01T00:00:00<\/StartBoundary><Enabled>true<\/Enabled><\/TimeTrigger><\/Triggers>/);
  assert.ok(Date.parse(board.WATCHDOG_START_BOUNDARY) < Date.now(), 'the start is in the past, so it fires from the next minute on');
  assert.ok(!/<Duration>/.test(xml), 'no duration: the repetition never ends');
  assert.ok(!/LogonTrigger/.test(xml), 'a logon trigger does not fire before the next logon (measured)');
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(xml, /<Settings>.*<Enabled>true<\/Enabled><\/Settings>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType><RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<UserId>BOX\\someone<\/UserId>/);
  assert.match(xml, /<Command>C:\\Windows\\System32\\conhost\.exe<\/Command><Arguments>--headless &quot;C:\\K\\node\.exe&quot; &quot;C:\\K\\board-watchdog\.js&quot;<\/Arguments><WorkingDirectory>C:\\Kosmos<\/WorkingDirectory>/);
  assert.ok(xml.includes(board.WATCHDOG_REMOVE_HINT.replace(/"/g, '&quot;')), 'it says how to remove it');
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
