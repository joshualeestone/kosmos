'use strict';
/**
 * kosmos#8410 item 1, the Windows half of #6173: the board keeps turning while the agent roster is read.
 *
 * On a Mac and Linux, engine/status.panes-async-6173.test.js pins this with a slow fake tmux, and it skips on Windows
 * (the fake is a sh script). On Windows the roster comes from `claude agents --json` through win32roster's shared
 * cached reader (makeCachedRun), wired into status.setPaneSource. status.paneRosterAsync calls a pane source
 * synchronously, so what keeps the board turning there is the cache: a stale answer is served at once and the fresh
 * read runs in the BACKGROUND, off the board's thread. These pin that through the real status.js, with the background
 * read a real child process that takes its time, and a control proving the measure can see a held thread: a cold cache
 * reads synchronously and the board does not turn at all (as the cache's own comment says it does).
 *
 *   node -r ./tools/no-schtasks-preload.cjs --test engine/win32roster.board-turns-8410.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

// A sandbox data root BEFORE requiring anything that reads the store.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32roster-turns-8410-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const status = require('./status');
const win32roster = require('./win32roster');

const IDLE = { pid: 100, cwd: 'w', kind: 'interactive', startedAt: 1, sessionId: 'aaaa-1111', name: 'raph-9a', status: 'idle' };
const BUSY = { ...IDLE, status: 'busy' };
const RECORD = { read: () => ({ 'aaaa-1111': { name: 'raph-9a', runner: '' } }) };
const SLOW_MS = 300;

/* A background read that really takes SLOW_MS: a node child that answers after a timer, so the wait is off this
   process's thread exactly as the real `claude agents --json` child is. */
function slowChildRead(answer) {
  return (cb) => {
    execFile(process.execPath, ['-e', `setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(answer))}), ${SLOW_MS})`],
      { encoding: 'utf8', windowsHide: true }, (err, out) => cb(err ? null : JSON.parse(out)));
  };
}

/* A synchronous read that holds the thread for SLOW_MS, as the cold read's execFileSync does. */
function slowSyncRead(answer) {
  return () => {
    execFileSync(process.execPath, ['-e', `setTimeout(() => {}, ${SLOW_MS})`], { windowsHide: true });
    return answer;
  };
}

function withSource(cached, fn) {
  status.setPaneSource(win32roster.make({ run: cached, record: RECORD, codexLive: () => [] }));
  return Promise.resolve().then(fn).finally(() => status.setPaneSource(null));
}

test('kosmos#8410: with a warm cache the roster answers at once and the board keeps turning while the fresh read runs', async () => {
  const clock = { t: 1000 };
  let syncReads = 0;
  let bgDone = null;
  let bgStarted = false;
  const bgFinished = new Promise((resolve) => { bgDone = resolve; });
  const read = slowChildRead([BUSY]);
  const cached = win32roster.makeCachedRun({
    run: () => { syncReads += 1; return [IDLE]; },
    runAsync: (cb) => { bgStarted = true; read((value) => { cb(value); bgDone(); }); },
    now: () => clock.t, freshMs: 2000, staleMs: 30000,
  });
  await withSource(cached, async () => {
    const first = await status.paneRosterAsync();
    assert.deepEqual(first.map((p) => p.sessionName), ['raph-9a'], 'CONTROL: the roster reads the recorded agent');
    assert.equal(syncReads, 1, 'CONTROL: the first (cold) read is the one synchronous read');
    clock.t += 5000;   // stale, not expired: served at once, refreshed in the background

    let turns = 0;
    const iv = setInterval(() => { turns += 1; }, 5);
    const stale = await status.paneRosterAsync();
    // A cache that read synchronously here would never start the background read: fail, never hang (a regression
    // that removes the stale path must read red, so the wait below is bounded too).
    assert.equal(bgStarted, true, 'no background read was started: the stale roster was not refreshed off the thread');
    let bound = null;
    const timedOut = await Promise.race([bgFinished.then(() => false), new Promise((r) => { bound = setTimeout(() => r(true), 5000); })]);
    clearTimeout(bound);
    assert.equal(timedOut, false, 'the background read never answered');
    clearInterval(iv);

    assert.deepEqual(stale.map((p) => p.sessionName), ['raph-9a'], 'the stale roster is served while the fresh read runs');
    assert.equal(syncReads, 1, 'no synchronous read on the request path');
    assert.ok(turns > 10, `the board's thread barely turned while the roster was read (${turns} turns in about ${SLOW_MS} ms)`);
    const fresh = cached();
    assert.equal(fresh[0].status, 'busy', 'the background answer is what the next ask gets');
  });
});

test('kosmos#8410 control: a cold cache reads synchronously and holds the board, so the measure above can see a held thread', async () => {
  const cached = win32roster.makeCachedRun({ run: slowSyncRead([IDLE]), runAsync: () => {}, now: () => 1000 });
  await withSource(cached, async () => {
    let turns = 0;
    const iv = setInterval(() => { turns += 1; }, 5);
    const started = Date.now();
    status.paneRoster();
    const held = Date.now() - started;
    clearInterval(iv);
    assert.ok(held >= SLOW_MS - 50, `CONTROL: the slow read did not take its time (${held} ms), so this measures nothing`);
    assert.equal(turns, 0, 'a timer fired during a synchronous read: the control measures nothing');
  });
});
