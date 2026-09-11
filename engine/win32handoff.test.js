'use strict';
/**
 * #570: a board started by hand from the Windows zip hands itself to its logon
 * task instead of serving from the launcher's window.
 *
 * 🛑 NO REAL schtasks, NO REAL PORT. The board's task ops, the port probe, the
 * clock and the platform are all injected, so a Mac asserts the Windows arm and no
 * suite ever starts or ends a real board.
 *
 *   node --test engine/win32handoff.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { handOffToTask } = require('./win32handoff');

const REFRESHED = { ok: true, action: 'refreshed' };
const MINE = '0.6.55';

/* A fake world: a clock that sleeping advances, a port whose occupant changes as
   the task is ended and run, and a record of every task op in order. */
function world({ occupant = null, taskRunning = false, runStarts = true, runOk = true, endFrees = true } = {}) {
  const w = { t: 0, occupant, taskRunning, ops: [], probes: 0 };
  w.board = {
    status: () => ({ registered: true, enabled: true, running: w.taskRunning }),
    end: () => {
      w.ops.push('end');
      if (w.taskRunning && endFrees) { w.taskRunning = false; w.occupant = null; }
      return { ok: true };
    },
    runNow: () => {
      w.ops.push('run');
      if (!runOk) return { ok: false, because: 'we could not start the board (access denied)' };
      if (runStarts) { w.taskRunning = true; w.pendingStart = w.t + 1200; }
      return { ok: true };
    },
  };
  w.probe = async () => {
    w.probes++;
    if (w.pendingStart !== undefined && w.t >= w.pendingStart) { w.occupant = MINE; delete w.pendingStart; }
    /* null: nothing on the port. '': a board whose page names no version. */
    return w.occupant === null ? { answering: false, version: null } : { answering: true, version: w.occupant || null };
  };
  w.sleep = async (ms) => { w.ops.push('sleep:' + ms); w.t += ms; };
  w.now = () => w.t;
  w.opts = (extra) => Object.assign({
    platform: 'win32', byTask: false, bundle: true, live: true, ensured: REFRESHED,
    port: 16180, version: MINE, board: w.board, probe: w.probe, sleep: w.sleep, now: w.now,
  }, extra || {});
  w.taskOps = () => w.ops.filter((o) => !o.startsWith('sleep'));
  return w;
}

// ── when no hand-off is due, nothing is touched ────────────────────────────

for (const [name, extra, why] of [
  ['a Mac', { platform: 'darwin' }, /not Windows/],
  ['the task\'s own board', { byTask: true }, /logon task started/],
  ['a source checkout', { bundle: false }, /source checkout/],
  ['an unarmed process', { live: false }, /not armed/],
  ['a task the person switched off', { ensured: { ok: true, action: 'left-disabled' } }, /left-disabled/],
  ['a task the person removed', { ensured: { ok: false, action: 'left-removed' } }, /left-removed/],
  ['a registration that failed', { ensured: { ok: false, action: 'failed', because: 'x' } }, /failed/],
  ['no ensureInstalled answer', { ensured: null }, /unknown/],
]) {
  test('no hand-off for ' + name + ': serve here and touch nothing', async () => {
    const w = world();
    const r = await handOffToTask(w.opts(extra));
    assert.equal(r.serve, true);
    assert.equal(r.attempted, false, 'a skipped hand-off must not print the "could not move" line');
    assert.match(r.because, why);
    assert.deepEqual(w.ops, [], 'nothing may be ended or run');
    assert.equal(w.probes, 0, 'not even a probe');
  });
}

test('a freshly registered task is handed off to, the same as a refreshed one', async () => {
  const w = world();
  const r = await handOffToTask(w.opts({ ensured: { ok: true, action: 'registered' } }));
  assert.equal(r.serve, false);
  assert.deepEqual(w.taskOps(), ['run']);
});

// ── the ordinary cases ──────────────────────────────────────────────────────

test('first run: nothing answers, the task is run, and this board leaves once the task\'s board answers', async () => {
  const w = world();
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.equal(r.exitCode, 0, 'exit 0, so the launcher closes its window instead of holding it');
  assert.match(r.say, /background/);
  assert.deepEqual(w.taskOps(), ['run'], 'run once, end nothing');
});

test('relaunch: the same version already answers, so leave at once and touch nothing', async () => {
  const w = world({ occupant: MINE, taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.equal(r.exitCode, 0);
  assert.match(r.say, /already running/);
  assert.deepEqual(w.ops, [], 'a working board must not be bounced by a double-click');
});

test('update by hand: an older task board is given the grace period, ended, and replaced', async () => {
  const w = world({ occupant: '0.6.37', taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.match(r.say, /background/);
  assert.deepEqual(w.taskOps(), ['end', 'run'], 'end the old board BEFORE running, or the new one dies on the port');
  const grace = w.ops.indexOf('sleep:3000');
  assert.ok(grace >= 0 && grace < w.ops.indexOf('end'),
    'the old board stays up long enough for the browser to redeem its boot nonce there');
});

test('an older board with no version in its page is treated as another version, not as this one', async () => {
  const w = world({ occupant: '', taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.deepEqual(w.taskOps(), ['end', 'run']);
});

// ── every case it cannot confirm serves here, as before ────────────────────

test('a board the task did not start holds the port: leave it alone and serve here', async () => {
  const w = world({ occupant: '0.6.37', taskRunning: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /did not start/);
  assert.deepEqual(w.taskOps(), [], 'somebody else\'s board is never ended from here');
});

test('the task\'s board never answers: end the task so a late start cannot steal the port, then serve here', async () => {
  const w = world({ runStarts: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /did not answer/);
  assert.deepEqual(w.taskOps(), ['run', 'end']);
  assert.ok(w.t >= 12000, 'it waited the full answer budget before giving up');
});

test('a board of ANOTHER version answering after /Run is not proof: fall back', async () => {
  const w = world();
  w.board.runNow = () => { w.ops.push('run'); w.occupant = '0.6.37'; return { ok: true }; };
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
});

test('a /Run that fails: serve here with its reason', async () => {
  const w = world({ runOk: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /access denied/);
});

test('an older board that will not stop: serve here, and never run a second board onto its port', async () => {
  const w = world({ occupant: '0.6.37', taskRunning: true, endFrees: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.match(r.because, /did not stop/);
  assert.deepEqual(w.taskOps(), ['end'], 'no /Run while the port is still held');
});

test('a probe that throws does not escape: serve here', async () => {
  const w = world();
  const r = await handOffToTask(w.opts({ probe: async () => { throw new Error('boom'); } }));
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /boom/);
});

// ── the real probe, against a real local server ────────────────────────────

const { BOARD_VERSION_HEADER } = require('./win32handoff');

test('the default probe reads the version the running process names in its header, and says "not answering" on a closed port', async () => {
  const http = require('node:http');
  const srv = http.createServer((q, s) => { s.writeHead(200, { [BOARD_VERSION_HEADER]: '9.9.9' }); s.end('<html></html>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const w = world();
    const opts = w.opts({ port, version: '9.9.9' });
    delete opts.probe;
    const r = await handOffToTask(opts);
    assert.equal(r.serve, false, 'the real probe saw the same version and reported the board as already running');
    assert.match(r.say, /already running/);
  } finally { await new Promise((r) => srv.close(r)); }
  const w2 = world({ runStarts: false });
  const opts2 = w2.opts({ port });
  delete opts2.probe;
  const r2 = await handOffToTask(opts2);
  assert.equal(r2.serve, true, 'nothing answers on the closed port, so the unstarted task is not proof');
});

test('🛑 an OLD board serving a NEW page (a zip unpacked over the running install) is not taken for this one', async () => {
  /* server.js reads web/index.html per request, so after an unpack-over the old
     process serves the new page, version meta included. Only the header names the
     code that is running, and an old board has none. */
  const http = require('node:http');
  const srv = http.createServer((q, s) => { s.end('<html><head><meta name="kosmos-version" content="9.9.9"></head></html>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const w = world({ taskRunning: true });
    w.board.end = () => { w.ops.push('end'); return { ok: true }; };
    const opts = w.opts({ port, version: '9.9.9' });
    delete opts.probe;
    const r = await handOffToTask(opts);
    assert.notEqual(r.say, 'Kosmos is already running. Your browser is opening it.');
    assert.equal(w.taskOps()[0], 'end', 'the old task board is ended so the new code can serve');
  } finally { await new Promise((r) => srv.close(r)); }
});

test('its own version is read from this install\'s package.json, the file the header comes from', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const p = require('node:path');
  const app = fs.mkdtempSync(p.join(os.tmpdir(), 'aw-handoff-570-'));
  try {
    fs.writeFileSync(p.join(app, 'package.json'), JSON.stringify({ name: 'agent-workforce', version: '1.2.3' }));
    const w = world({ occupant: '1.2.3', taskRunning: true });
    const opts = w.opts({ appDir: app });
    delete opts.version;
    const r = await handOffToTask(opts);
    assert.equal(r.serve, false);
    assert.match(r.say, /already running/, 'same version as package.json on disk');
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('the board serves the header with the version its process loaded', async () => {
  /* The other half of the comparison, pinned at the source: server.js's static
     shell must send BOARD_VERSION_HEADER from its package.json `version`. */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /\[BOARD_VERSION_HEADER\]: version/, 'the page response no longer names the running version');
  assert.match(src, /const \{ version \} = require\('\.\/package\.json'\)/, 'the version is no longer package.json\'s, read once at start');
});
