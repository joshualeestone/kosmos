'use strict';

/**
 * `runFlow`'s HOOK WIRING, pinned from outside (#1569).
 *
 * 🛑 WHAT IS AND IS NOT ALREADY COVERED. `installClaudeCode` has 17 contract
 * tests, and it type-guards all five hooks: a missing or non-function hook
 * throws at `connect.js:1093`. So the gap is not an ABSENT hook. It is a hook
 * wired to a WRONG IMPLEMENTATION -- one that compiles, runs, and passes.
 * Measured on the card: four of the five can be mutated with the whole suite
 * green, because every one of those 17 tests sits on the CALLEE's side of the
 * seam and supplies its own hooks.
 *
 * ⚠️ AND `connect.cancel()` CANNOT PIN `cancelled`. It destroys `activeRequest`
 * directly, so a download aborts whether or not the hook is wired. The hook is
 * the SOLE abort mechanism in exactly one scenario: when a second flow REPLACES
 * the driver rather than cancelling it. That is the scenario built here.
 *
 * These tests do not edit `engine/connect.js`; that file is contended.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const { mkTemp } = require('../test-support/tmpdir');

/* ⚠️ SANDBOX BEFORE REQUIRING: `store` fixes its root at load and `subscription`
   reads its config path at load, so a require above this line reads the
   operator's real machine. */
const SANDBOX = mkTemp('hookwiring1569-');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = nodePath.join(SANDBOX, 'claude-config-dir');

const connect = require('./connect');

/* 🛑 WITHOUT THIS, `start()` RETURNS `connected` IMMEDIATELY AND NEVER REACHES
   THE DOWNLOAD. Measured: on a signed-in machine it short-circuits before the
   binary check, so both tests below timed out waiting for DOWNLOADING and the
   hooks were never exercised. Clearing the sandboxed config is what makes the
   flow take the install path. (That short-circuit ordering is itself filed as
   kosmos#1580; this test only has to get past it.) */
const clearClaudeConfig = () => {
  try { fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true }); } catch { /* fine */ }
};

/* A release whose binary download is HELD OPEN until the test releases it, so a
   second flow can replace the driver while the first is parked mid-stream. */
function serveHeldRelease(t, { version, binary, checksum }) {
  let release = null;
  const held = new Promise((r) => { release = r; });
  const paths = {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({
      platforms: { [connect.platformKey()]: { checksum } },
    }),
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === `/${version}/${connect.platformKey()}/claude`) {
      res.writeHead(200, { 'content-length': binary.length });
      res.write(binary.subarray(0, 1024));      // first chunk, then park
      await held;
      res.end(binary.subarray(1024));           // the rest, after the swap
      return;
    }
    const answer = paths[req.url];
    if (!answer) { res.writeHead(404); res.end(); return; }
    const body = Buffer.from(answer());
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      /* 🛑 RELEASE, THEN DROP THE SOCKETS, THEN CLOSE. `server.close()` alone
         waits on the held response and leaves the connection open, and a leaked
         socket from this file made an unrelated suite fail with a bare
         `TypeError: fetch failed` -- a failure that looks like the other file's
         bug and is this one's. Measured: 3105 pass without this file, one
         failure with it. */
      t.after(() => {
        try { release(); } catch { /* already released */ }
        try { server.closeAllConnections(); } catch { /* older node */ }
        server.close();
      });
      resolve({ base: `http://127.0.0.1:${server.address().port}`, release: () => release() });
    });
  });
}

function until(fn, ms = 8000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok = false;
      try { ok = fn(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timed out waiting'));
      return setTimeout(tick, 20);
    };
    tick();
  });
}

/**
 * 🛑 THE `cancelled` PIN IS NOT HERE, AND THAT IS A MEASURED RESULT RATHER THAN
 * AN OMISSION.
 *
 * The card proposes driving `connect.start()` twice so the second claim replaces
 * the first owner, then asserting the first flow never installs. I built it. It
 * passed, and then it passed just as happily with `cancelled: () => false`
 * wired in -- so it pinned nothing, which is the exact defect this card exists
 * to fix. It was removed rather than shipped.
 *
 * ⚠️ THE SHAPE NEEDS TWO CONDITIONS THAT CANNOT BOTH HOLD ON THIS CODE:
 *   - a second `start()` REFUSES while a driver exists (`if (driver) return
 *     state();`, connect.js:830), so the driver is never replaced by simply
 *     starting again;
 *   - `cancel()` therefore has to run first -- and it destroys the in-flight
 *     request directly, so flow A's download dies whatever the hook returns.
 *
 * ⇒ On the download path, `cancelled` has no observable effect from outside the
 * module, because the only route to a replaced driver also kills the thing the
 * hook would have stopped. Pinning it needs either a seam that replaces the
 * driver without cancelling, or a test on the callee side supplying its own
 * hooks (which `connect.install-997.test.js` already does, and which is why the
 * whole-suite mutation stayed green in the first place).
 *
 * Recorded on kosmos#1569 with the measurement, so the next person does not
 * rebuild the same unfalsifiable test.
 */

test('DOWNLOADING carries a zeroed progress, because writeState REPLACES rather than merges', async (t) => {
  /**
   * `onPhase` writes `progress: {got:0,total:null}` with DOWNLOADING. Dropping
   * that field leaves a PREVIOUS flow's numbers on screen under a fresh
   * download, and the whole suite stays green: no contract test on the callee
   * side can see what the caller chose to write.
   */
  const binary = crypto.randomBytes(64 * 1024);
  const checksum = crypto.createHash('sha256').update(binary).digest('hex');
  const { base, release } = await serveHeldRelease(t, { version: '9.9.6', binary, checksum });
  clearClaudeConfig();
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = base;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = nodePath.join(SANDBOX, 'no-such-claude-1569b');

  connect.setRunner(() => ({ ok: true, stdout: '' }));
  connect.setDryRun(false);
  t.after(() => { connect.setRunner(null); connect.resetForTests(); });

  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.DOWNLOADING);
  const st = connect.state();

  assert.ok(st.progress, 'DOWNLOADING carries no progress object at all');
  /* ⚠️ SCOPED TO WHAT ONE FLOW CAN SHOW. This pins that DOWNLOADING carries a
     ZEROED progress. It does NOT construct a previous flow whose numbers survive: this
     fixture runs one flow in a fresh process, and an earlier version of this message
     claimed otherwise. Measured, under both realistic mutations (drop the field, or
     merge instead of replace) it is the line ABOVE that fires, never this one. */
  assert.equal(st.progress.got, 0,
    `DOWNLOADING did not zero its progress: ${JSON.stringify(st.progress)}`);

  /* 🛑 THE ASSERTION THIS FIXTURE WAS ACTUALLY BUILT FOR, AND WITHOUT IT THE
     HELD-OPEN APPARATUS IS INERT. `onPhase(DOWNLOADING)` fires BEFORE the binary is
     requested, so everything above is read before a single chunk can land: measured,
     serving the body in one shot instead of parking it failed 0 times in 10, so the
     hold, the release plumbing and the socket teardown existed to manage a hazard only
     the unused apparatus created. This card's plan said `onProgress` could not be
     pinned from outside the module. THAT WAS WRONG, and the harness disproving it was
     already sitting in this file: `connect.state().progress` reports onProgress's
     output verbatim while a download is parked mid-stream. */
  await until(() => (connect.state().progress || {}).got > 0);
  const mid = connect.state();
  assert.equal(mid.progress.got, 1024,
    `progress.got does not report bytes received while parked: ${JSON.stringify(mid.progress)}`);
  assert.equal(mid.progress.total, binary.length,
    `progress.total does not report content-length, so got and total may be swapped: ${JSON.stringify(mid.progress)}`);

  /* ⚠️ AND THIS IS WHAT MAKES THE `got === 0` ABOVE MEAN ANYTHING. A field that
     is always 0 satisfies it forever. Having watched the same field move 0 -> 1024 in
     one flow, the zero at DOWNLOADING is a value the code chose rather than a constant.
     The previous control was `hasOwnProperty(st, 'phase')`, which `publicView` makes
     invariantly true: a control whose two outcomes cannot differ. */
  assert.notEqual(mid.progress.got, st.progress.got,
    'control: progress never changed, so the zero asserted above proves nothing');
  release();
});
