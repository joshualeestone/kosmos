'use strict';
/**
 * kosmos#8410 item 1, the Windows half of #6173: the board keeps turning while the agent roster is read.
 *
 * On a Mac and Linux, engine/status.panes-async-6173.test.js pins this with a slow fake tmux, and it skips on Windows
 * (the fake is a sh script). On Windows the roster comes from `claude agents --json` through win32roster's shared
 * cached reader (makeCachedRun), wired into status.setPaneSource. status.paneRosterAsync calls a pane source
 * synchronously, so what keeps the board turning there is the cache: a stale answer is served at once and the fresh
 * read runs in the BACKGROUND, off the board's thread. These pin that through the real status.js, with the background
 * read a real child process that takes its time: the request itself is timed (it returns before the read could), and a
 * control times a cold cache's synchronous read the same way, so the measure can see a held request.
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
const SLOW_MS = 2000;   // reviews 2 and 3: room for a slow Windows runner's process spawn inside the request's budget (SLOW_MS / 2)

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

test('kosmos#8410: with a warm cache the roster answers at once, and the fresh read runs after it, off the board\'s thread', async () => {
  const clock = { t: 1000 };
  let syncReads = 0;
  let bgStarted = false;
  let bgFinishedAt = null;
  let bgDone = null;
  const bgFinished = new Promise((resolve) => { bgDone = resolve; });
  const read = slowChildRead([BUSY]);
  const cached = win32roster.makeCachedRun({
    run: () => { syncReads += 1; return [IDLE]; },
    runAsync: (cb) => { bgStarted = true; read((value) => { cb(value); bgFinishedAt = Date.now(); bgDone(); }); },
    now: () => clock.t, freshMs: 2000, staleMs: 30000,
  });
  await withSource(cached, async () => {
    const first = await status.paneRosterAsync();
    assert.deepEqual(first.map((p) => p.sessionName), ['raph-9a'], 'CONTROL: the roster reads the recorded agent');
    assert.equal(syncReads, 1, 'CONTROL: the first (cold) read is the one synchronous read');
    clock.t += 5000;   // stale, not expired: served at once, refreshed in the background

    // Review 1: time the REQUEST, not the window after it. The request must come back well before the slow read could,
    // with that read started and still running: then the read's time is spent off the board's thread.
    const t0 = Date.now();
    const stale = await status.paneRosterAsync();
    const took = Date.now() - t0;
    const returnedAt = Date.now();
    assert.deepEqual(stale.map((p) => p.sessionName), ['raph-9a'], 'the stale roster is served while the fresh read runs');
    assert.ok(took < SLOW_MS / 2, `the roster request took ${took} ms, as long as the read it should not wait for`);
    assert.equal(bgStarted, true, 'no background read was started: the stale roster was not refreshed off the thread');
    assert.equal(bgFinishedAt, null, 'the background read had already finished when the request returned');
    assert.equal(syncReads, 1, 'no synchronous read on the request path');
    // Fail, never hang, if the background read never answers.
    let bound = null;
    const timedOut = await Promise.race([bgFinished.then(() => false), new Promise((r) => { bound = setTimeout(() => r(true), 5000); })]);
    clearTimeout(bound);
    assert.equal(timedOut, false, 'the background read never answered');
    assert.ok(bgFinishedAt - returnedAt >= SLOW_MS / 2, 'CONTROL: the background read did not take its time, so this measures nothing');
    assert.equal(cached()[0].status, 'busy', 'the background answer is what the next ask gets');
  });
});

test('kosmos#8410 control: a cold cache reads synchronously, and the same timing sees the request held', async () => {
  const cached = win32roster.makeCachedRun({ run: slowSyncRead([IDLE]), runAsync: () => {}, now: () => 1000 });
  await withSource(cached, async () => {
    const t0 = Date.now();
    await status.paneRosterAsync();
    const took = Date.now() - t0;
    assert.ok(took >= SLOW_MS - 50, `CONTROL: a synchronous slow read returned in ${took} ms, so the timing above could not see one`);
  });
});
