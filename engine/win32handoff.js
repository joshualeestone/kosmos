'use strict';
/**
 * #570: a board started BY HAND from the unpacked Windows zip hands itself to its
 * logon task, instead of serving from the launcher's console window.
 *
 * 🛑 THE WINDOW WAS THE BOARD. `Kosmos.exe` runs server.js in the foreground of
 * the console it opens, so closing that window killed the board -- the class of
 * defect #2714 removed from every Scheduled Task, left standing on the one window a
 * person is most likely to close. And from the first logon on, the task's headless
 * board is already serving, so every later double-click printed "port 16180 is
 * already in use ... Kosmos stopped" over a board that was working fine. Measured
 * on the Windows box with a 0.6.55 zip; the plan has the numbers.
 *
 * 🔑 SO THE HAND-STARTED BOARD STARTS THE TASK AND LEAVES. The task already exists
 * (`win32board.ensureInstalled` registered or refreshed it a moment earlier in the
 * same boot), it runs headless, and it is what a logon starts anyway -- so after
 * this there is exactly one way the board runs on Windows, whichever way it was
 * started. Exiting 0 lets the launcher close its window by itself; its opener is
 * already waiting to put the board in the browser.
 *
 * ⚠️ EVERY UNCERTAIN STEP FALLS BACK TO SERVING IN THE WINDOW, which is exactly the
 * behaviour before this module. A hand-off that could not be confirmed must never
 * leave a person with no board at all.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

/* How long the task's board has to answer after `/Run`. Measured: 1.2s on the box
   from `/Run` to listening; the launcher's opener gives up after 20s, so this stays
   well inside that and still allows a slow disk ten times the measured start. */
const TASK_BOARD_ANSWER_WAIT_MS = 12000;

/* How long an ended board has to let go of the port. win32board.restart measured
   the port staying bound for about a second after `/End`. */
const PORT_RELEASE_WAIT_MS = 10000;

/* The update case ends an OLDER board that the launcher's opener may be signing
   the browser in to at this very moment: it minted a single-use boot nonce there,
   and the browser redeems it a beat later. The cookie that redemption sets is the
   durable one, so it keeps working on the new board -- but only if the old board
   is still up to redeem it. This is the beat. */
const OLD_BOARD_GRACE_MS = 3000;

/* One probe's budget, and the gap between probes while waiting. */
const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 300;

/* The page names its own version (tools/build-*-bundle.sh bake it, #269), and GET /
   needs no token, so this is how one board tells whether another is itself. */
const VERSION_META = /<meta name="kosmos-version" content="([^"]*)">/;

function versionInPage(html) {
  const m = VERSION_META.exec(String(html || ''));
  return m ? m[1] : null;
}

/* This install's own version, read from the page it would serve -- the same file
   the answering board's version comes from, so the two are one derivation. */
function ownVersion(appDir) {
  try { return versionInPage(fs.readFileSync(path.join(appDir, 'web', 'index.html'), 'utf8')); } catch { return null; }
}

/* Is a board answering on this port, and which version is it? Never rejects. */
function probeBoard(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: PROBE_TIMEOUT_MS }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 65536) body += d; });
      res.on('end', () => resolve({ answering: true, version: versionInPage(body) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ answering: false, version: null }));
  });
}

/**
 * Should this boot hand off at all? Every "no" keeps today's behaviour: serve here.
 * `ensured` is win32board.ensureInstalled's answer from this same boot.
 */
function skipReason(o) {
  if (o.platform !== 'win32') return 'not Windows';
  if (o.byTask) return 'the logon task started this board';
  if (!o.bundle) return 'this board runs from a source checkout';
  if (!o.live) return 'live execution is not armed';
  const e = o.ensured;
  /* Only a task that was just registered or refreshed is known to be enabled AND to
     name this install. A task the person switched off or removed means they chose
     the window, and the window is what they get. */
  if (!e || !e.ok || (e.action !== 'registered' && e.action !== 'refreshed')) {
    return 'the logon task is not ready (' + ((e && (e.action || e.because)) || 'unknown') + ')';
  }
  return null;
}

/**
 * Hand this hand-started board to its logon task, or say why not.
 *
 * Resolves (never rejects) to one of:
 *   { serve: false, exitCode: 0, say }         the task's board is serving; leave
 *   { serve: true,  attempted: false, because } no hand-off was due; serve here
 *   { serve: true,  attempted: true,  because } one was tried and not confirmed
 *
 * `deps` are seams: platform, bundle, byTask, live, board (status/end/runNow),
 * probe, sleep and now. The defaults are the real ones.
 */
async function handOffToTask(opts) {
  const o = opts || {};
  const appDir = o.appDir || path.resolve(__dirname, '..');
  const board = o.board || require('./win32board');
  const probe = o.probe || probeBoard;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || Date.now;
  const facts = {
    platform: o.platform || process.platform,
    byTask: o.byTask !== undefined ? o.byTask : board.startedByTask(),
    bundle: o.bundle !== undefined ? o.bundle : Boolean(board.bundleRoot()),
    live: o.live !== undefined ? o.live : require('./live-execution').liveExecutionAllowed(),
    ensured: o.ensured,
  };
  const skip = skipReason(facts);
  if (skip) return { serve: true, attempted: false, because: skip };

  const port = o.port;
  const mine = o.version !== undefined ? o.version : ownVersion(appDir);
  const isMine = (p) => p.answering && (mine ? p.version === mine : true);
  async function waitUntil(test, ms) {
    const until = now() + ms;
    for (;;) {
      const p = await probe(port);
      if (test(p)) return p;
      if (now() >= until) return null;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  const gone = (p) => !p.answering;

  try {
    const first = await probe(port);
    if (first.answering && mine && first.version === mine) {
      return { serve: false, exitCode: 0, say: 'Kosmos is already running. Your browser is opening it.' };
    }
    if (first.answering) {
      /* Another version answers. Only the TASK's board can be replaced from here:
         anything else on the port (a board in another window, or not a board at
         all) is somebody else's, and serving here reproduces today's message. */
      if (!board.status().running) {
        return { serve: true, attempted: true, because: 'something the logon task did not start is already using port ' + port };
      }
      await sleep(OLD_BOARD_GRACE_MS);
      const ended = board.end();
      if (!ended.ok) return { serve: true, attempted: true, because: ended.because };
      if (!(await waitUntil(gone, PORT_RELEASE_WAIT_MS))) {
        return { serve: true, attempted: true, because: 'the older Kosmos did not stop' };
      }
    }
    const ran = board.runNow();
    if (!ran.ok) return { serve: true, attempted: true, because: ran.because };
    /* `schtasks /Run` reports success for a run that started nothing (measured,
       win32board.taskXml), so the proof is a board answering with THIS version. */
    if (await waitUntil(isMine, TASK_BOARD_ANSWER_WAIT_MS)) {
      return { serve: false, exitCode: 0, say: 'Kosmos is running in the background now, and starts by itself when you log in. You can close this window.' };
    }
    /* Not confirmed. End the task so a late start cannot take the port from the
       board about to serve here, then let it go. */
    board.end();
    await waitUntil(gone, PORT_RELEASE_WAIT_MS);
    return { serve: true, attempted: true, because: 'the background board did not answer within ' + Math.round(TASK_BOARD_ANSWER_WAIT_MS / 1000) + 's' };
  } catch (err) {
    return { serve: true, attempted: true, because: 'the hand-off failed (' + String((err && err.message) || err) + ')' };
  }
}

module.exports = { handOffToTask };
