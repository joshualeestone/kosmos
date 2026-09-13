'use strict';
/**
 * #570: a board started BY HAND from the unpacked Windows zip hands itself to its
 * logon task, instead of serving from the launcher's hidden console (or its
 * --console window).
 *
 * 🛑 THE WINDOW WAS THE BOARD. `Kosmos.exe` ran server.js in the foreground of
 * the console it opened, so closing that window killed the board -- the class of
 * defect #2714 removed from every Scheduled Task, left standing on the one window a
 * person is most likely to close. And from the first logon on, the task's headless
 * board is already serving, so every later double-click printed "port 16180 is
 * already in use ... Kosmos stopped" over a board that was working fine. Measured
 * on the Windows box with a 0.6.55 zip; the plan has the numbers.
 *
 * 🔑 SO THE HAND-STARTED BOARD STARTS THE TASK AND LEAVES. The task already exists
 * (`win32board.ensureInstalled` registered or refreshed it a moment earlier in the
 * same boot), it runs headless, and it is what a logon starts anyway -- so after
 * this there is one way the board runs on Windows, whichever way it was started.
 * Exiting 0 lets the launcher exit with it (closing its --console window, if it has
 * one); its opener is already waiting to put the board in the browser.
 *
 * ⚠️ WHAT IT CANNOT CONFIRM, IT LEAVES TO THE LAUNCHER, which is the behaviour
 * before this module: this board serves from the launcher's hidden console (or its
 * --console window), and a GUI Kosmos.exe shows a box that stays the person's handle
 * on it once this board is listening (HANDOFF_CHECK_FOR_SERVING_AFTER_MS). All inside
 * a budget that ends before the opener
 * gives up (see HANDOFF_BUDGET_MS), so a fallback still gets the browser signed in.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

/**
 * 🛑 ONE BUDGET FOR THE WHOLE HAND-OFF, MEASURED FROM PROCESS START, because the
 * browser opener does not wait for us. `tools/kosmos-open-board.js` waits 20s for
 * a board and then opens the PLAIN url, which an enforcing Windows board answers
 * with the #2007 403. So whatever this does -- succeed, replace an older board, or
 * give up and serve from the launcher -- a board must be answering before then.
 * ⚠️ THE BUDGET IS NOT THE WORST CASE, and the difference is spelled out so it is
 * not rediscovered: a probe already in flight at the deadline can take
 * PROBE_TIMEOUT_MS (no wait starts one past its own end), and the fallback's
 * port-release wait has a floor of MIN_PORT_RELEASE_WAIT_MS (below) that the
 * budget does not cut. Worst case from process start: 12 + 2 (a last probe) + 2
 * (the release floor) + 2 (its last probe) = 18s, plus the `/End` spawn, inside
 * the opener's 20s. Measured on the box: boot to the hand-off
 * about 2s, `/Run` to a listening board 1.2s, a whole update 8.9s from the
 * double-click -- so 12s still covers the update, grace included.
 */
const HANDOFF_BUDGET_MS = 12000;

/* The update case ends an OLDER board that the launcher's opener may be signing
   the browser in to at this very moment: it minted a single-use boot nonce there,
   and the browser redeems it a beat later. The cookie that redemption sets is the
   durable one, so it keeps working on the new board -- but only if the old board
   is still up to redeem it. NOT MEASURED: an allowance for a browser that is
   already running (the box's Edge took the url in well under a second by eye). A
   browser that loses the race either finds no board for a second or two (after
   `/End`, before the new board listens) or reaches the new board with a nonce it
   never minted -- nonces live in the minting board's memory. Either way the page
   is not signed in, and a relaunch of Kosmos signs it in. */
const OLD_BOARD_GRACE_MS = 3000;

/* Whatever the budget says, an ended board gets this long to let go of the port
   before this one tries to bind it: serving here into a port still held would only
   die on EADDRINUSE. win32board.restart measured the port staying bound about a
   second after `/End`. This floor is why the worst case exceeds the budget (see
   HANDOFF_BUDGET_MS). */
const MIN_PORT_RELEASE_WAIT_MS = 2000;

/* A task board still booting can answer AFTER our `/Run` as another board -- an
   older build, or the world it was booting into -- and the second round replaces
   it. Two rounds, never a loop. */
const MAX_ROUNDS = 2;

/* One probe's budget, and the gap between probes while waiting. */
const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 300;

/**
 * When Kosmos.exe starts asking whether the board it started is serving from it: the
 * arithmetic spelled out at HANDOFF_BUDGET_MS, as one value (tools/windows/
 * KosmosLauncher.cs, CheckForServingAfterMs, pinned equal by
 * tools.win-launcher-native.test.js).
 * ⚠️ NOT A WORST CASE. Every schtasks call in the hand-off is a synchronous spawn with
 * its own timeout, so a `/Run` that starts just inside the budget can still be confirmed
 * after this, and a slow first boot can pass it before the hand-off begins. So the
 * launcher never decides on time alone: from this mark it polls, and shows its box only
 * once this board is LISTENING, which start() does only after the hand-off has decided
 * to serve here.
 */
const HANDOFF_CHECK_FOR_SERVING_AFTER_MS = HANDOFF_BUDGET_MS + PROBE_TIMEOUT_MS + MIN_PORT_RELEASE_WAIT_MS + PROBE_TIMEOUT_MS;

/**
 * 🔑 THE RUNNING BOARD'S IDENTITY COMES FROM A HEADER, NEVER FROM THE PAGE.
 * server.js reads `web/index.html` per request, so a new zip unpacked over the
 * running install -- the folder Explorer's Extract All offers by default -- makes
 * the OLD board serve the NEW page. The header is `boardIdentity` -- the build
 * and the booted world -- as the process computed it at start, so it names the
 * code, and the world, that is actually answering.
 * ⚠️ A board without the header predates this module, so it is never taken for
 * this one: a task board without it is replaced once.
 * GET / needs no token, so any caller can ask; the version is on the page anyway.
 */
const BOARD_IDENTITY_HEADER = 'x-kosmos-board';

/**
 * Which build this app is: its package.json version, plus the commit the zip was
 * built from when it runs from the bundle. The version alone is not enough:
 * Windows zips are cut from main between version bumps, so two 0.6.55 zips can
 * carry different code. Both sides of the comparison call THIS function -- the
 * running board once at start for its header, the launching board for itself --
 * so there is one derivation. Never throws.
 */
function buildIdentity(appDir) {
  let version = '';
  try { version = String(JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version || ''); } catch { /* unreadable: no identity */ }
  if (!version) return null;
  let sha = '';
  /* The manifest sits at the bundle ROOT, beside runtime\node.exe. A source
     checkout has no runtime\node.exe, so a stray ../manifest.json beside a repo is
     never read. */
  const root = path.resolve(appDir, '..');
  try {
    if (fs.existsSync(path.join(root, 'runtime', 'node.exe'))) {
      sha = String(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).source_sha || '');
    }
  } catch { /* no manifest: the version alone */ }
  return /^[0-9a-f]{7,40}$/.test(sha) ? version + '+' + sha.slice(0, 12) : version;
}

/**
 * What an answering board must match to be "this one": the build AND the Kosmos
 * world it booted into. A board of this very build serving ANOTHER world (a world
 * switch whose restart never happened) is not the board this launch would serve,
 * and calling it "already running" would land the person on the wrong world's
 * data. Both sides call this with their own booted world (worldenv.bootedWorld()),
 * the running board once at start for its header and the launching one for
 * itself. Round 4 of the review found the gap once named worlds could hand off.
 */
function boardIdentity(build, worldId) {
  return build ? String(build) + '@' + String(worldId || '') : null;
}

/**
 * THIS boot's world attempt: taken back while a hand-off is tried, put back if
 * this board ends up serving after all.
 *
 * 🛑 THE TASK'S BOARD READS IT BEFORE WE ARE DONE. worldenv's bootstrap records
 * an attempt for a named world (#2528) that only `listening` clears. If it is
 * still on disk when `/Run` starts the task, the task's board counts it as a
 * failed boot -- and for a world that has never served, ONE is enough to abandon
 * it for the default world (measured on a sandbox registry in review round 5).
 * So it is retracted before the task can run, and restored only if this board
 * goes on to serve in its window, where a crash must still count.
 * Retract, not clear: attempts earlier boots really made still count. Seams:
 * `worldenv`, `guard`. Never throws.
 */
function thisBootsWorldAttempt(deps) {
  const d = deps || {};
  let taken = false;
  const withGuard = (fn) => {
    try {
      const we = d.worldenv || require('./worldenv');
      const guard = d.guard || require('./worldbootguard');
      return fn(guard, we.bootedBaseDir(), we.bootedWorld());
    } catch { return false; /* fail-open, as at the bind */ }
  };
  return {
    retract() { taken = Boolean(withGuard((g, base, id) => g.retractAttempt(base, id))); },
    restore() { if (taken) { withGuard((g, base, id) => g.recordAttempt(base, id)); taken = false; } },
  };
}

/* Is a board answering on this port, and which board is it? Never rejects. */
function probeBoard(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: PROBE_TIMEOUT_MS }, (res) => {
      res.resume();
      const named = res.headers[BOARD_IDENTITY_HEADER];
      res.on('end', () => resolve({ answering: true, identity: typeof named === 'string' && named ? named : null }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ answering: false, identity: null }));
  });
}

/* The logon task runs with the account's environment, not this launch's. A launch
   that asked for its own port or its own data folder would be handed to a board
   that serves neither -- and the hand-off would then end that working board as
   "not answering". Those launches serve from the launcher (its hidden console, or
   its --console window). */
function overriddenBy(env) {
  const e = env || {};
  if (e.PORT) return 'PORT';
  return Object.keys(e).find((k) => k.startsWith('AGENT_WORKFORCE_') && e[k]) || null;
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
  const override = overriddenBy(o.env);
  if (override) return 'this launch sets ' + override + ', which the logon task would not use';
  const e = o.ensured;
  /* Only a task that was just registered or refreshed is known to be enabled AND to
     name this install. A task the person switched off or removed means they chose
     to run Kosmos from the launcher, and that is what they get. */
  if (!e || !e.ok || (e.action !== 'registered' && e.action !== 'refreshed')) {
    return 'the logon task is not ready (' + ((e && (e.action || e.because)) || 'unknown') + ')';
  }
  return null;
}

/**
 * The hand-off itself, once handOffToTask has decided one is due. Resolves to the
 * same shapes as handOffToTask; a throw is handled by the caller.
 */
async function attemptHandOff(o, deps) {
  const { board, probe, sleep, now } = deps;
  const port = o.port;
  /* server.js passes its BOARD_IDENTITY; without one nothing is ever "this one". */
  const mine = o.identity || null;
  const startedAt = o.startedAt !== undefined ? o.startedAt : now() - Math.round(process.uptime() * 1000);
  const deadline = startedAt + HANDOFF_BUDGET_MS;
  const left = () => Math.max(0, deadline - now());
  const isMine = (p) => p.answering && Boolean(mine) && p.identity === mine;
  /* Never STARTS a probe past `until`, so one wait overshoots by at most the
     probe already in flight (PROBE_TIMEOUT_MS) -- the figure the worst case in
     HANDOFF_BUDGET_MS is built from. */
  async function waitUntil(test, ms) {
    const until = now() + ms;
    for (;;) {
      const p = await probe(port);
      if (test(p)) return p;
      const rest = until - now();
      if (rest <= 0) return null;
      await sleep(Math.min(POLL_INTERVAL_MS, rest));
    }
  }
  const gone = (p) => !p.answering;
  const serveHere = (because) => ({ serve: true, attempted: true, because });

  const handedOff = { serve: false, exitCode: 0, say: 'Kosmos is running in the background now, and starts by itself when you log in.' };

  let ran = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0 && left() <= 0) break;
    const p = await probe(port);
    if (isMine(p)) return ran ? handedOff : { serve: false, exitCode: 0, say: 'Kosmos is already running. Your browser is opening it.' };
    if (p.answering) {
      /* Another board answers (another build, or another world). Only the TASK's
         board can be replaced from here:
         anything else on the port (a board in another window, or not a board at
         all) is somebody else's, and serving here reproduces today's message. */
      if (!board.status().running) return serveHere('something the logon task did not start is already using port ' + port);
      /* With no time left to start its replacement, a working older board is
         worth more than a window: keep it, and let this launch report the port. */
      if (left() <= 0) return serveHere('there was no time left to replace the older Kosmos that is running');
      await sleep(Math.min(OLD_BOARD_GRACE_MS, left()));
      const ended = board.end();
      if (!ended.ok) return serveHere(ended.because);
      if (!(await waitUntil(gone, Math.max(left(), MIN_PORT_RELEASE_WAIT_MS)))) return serveHere('the older Kosmos did not stop');
    }
    if (left() <= 0) break;
    const r = board.runNow();
    if (!r.ok) return serveHere(r.because);
    ran = true;
    /* `schtasks /Run` reports success for a run that started nothing (measured,
       win32board.taskXml), so only a board answering as THIS one is proof. Any
       other board answering instead is a task board that was still booting when we
       looked -- an older build, or another world -- and the next round replaces it. */
    const up = await waitUntil((q) => q.answering, left());
    if (!up) break;
    if (isMine(up)) return handedOff;
  }
  /* Not confirmed. End the task so a late start cannot take the port from the
     board about to serve here, then let it go. */
  if (!ran) return serveHere('there was no time left to start the background board');
  board.end();
  await waitUntil(gone, Math.max(left(), MIN_PORT_RELEASE_WAIT_MS));
  return serveHere('the background board did not answer in time');
}

/**
 * Hand this hand-started board to its logon task, or say why not.
 *
 * Resolves (never rejects) to one of:
 *   { serve: false, exitCode: 0, say }         the task's board is serving; leave
 *   { serve: true,  attempted: false, because } no hand-off was due; serve here
 *   { serve: true,  attempted: true,  because } one was tried and not confirmed
 *
 * `identity` is this process's boardIdentity, computed at start by server.js. The
 * rest are seams with real defaults: platform, env, bundle, byTask, live, board
 * (status/end/runNow), probe, sleep, now, startedAt, and `worlds` (the worldenv
 * and worldbootguard thisBootsWorldAttempt uses).
 */
async function handOffToTask(opts) {
  const o = opts || {};
  try {
    const board = o.board || require('./win32board');
    const probe = o.probe || probeBoard;
    const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = o.now || Date.now;
    const skip = skipReason({
      platform: o.platform || process.platform,
      env: o.env || process.env,
      byTask: o.byTask !== undefined ? o.byTask : board.startedByTask(),
      bundle: o.bundle !== undefined ? o.bundle : Boolean(board.bundleRoot()),
      live: o.live !== undefined ? o.live : require('./live-execution').liveExecutionAllowed(),
      ensured: o.ensured,
    });
    if (skip) return { serve: true, attempted: false, because: skip };

    /* This boot's world attempt comes off BEFORE the task can run (see
       thisBootsWorldAttempt), and goes back on if this board serves after all. */
    const attempt = thisBootsWorldAttempt(o.worlds);
    attempt.retract();
    const result = await attemptHandOff(o, { board, probe, sleep, now })
      .catch((err) => ({ serve: true, attempted: true, because: 'the hand-off failed (' + String((err && err.message) || err) + ')' }));
    if (result.serve) attempt.restore();
    return result;
  } catch (err) {
    return { serve: true, attempted: true, because: 'the hand-off failed (' + String((err && err.message) || err) + ')' };
  }
}

module.exports = { handOffToTask, buildIdentity, boardIdentity, BOARD_IDENTITY_HEADER, HANDOFF_CHECK_FOR_SERVING_AFTER_MS };
