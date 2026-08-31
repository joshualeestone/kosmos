'use strict';

/**
 * #1633: `canRunClaude` is written by `becomeStuck` and read by the stuck
 * screen, and until this file nothing asserted it from a DRIVEN flow.
 *
 * The stuck screen's only way out is *"open Terminal, type `claude`"*, and
 * `web/index.html` gates that suggestion on `canRunClaude` (#1595). The value is
 * a filesystem answer (`accessSync(claudeBinPath(), X_OK)`) that reaches a
 * person's screen, so the failure it guards against is telling somebody who is
 * already stuck to run a program that answers `command not found` (#205).
 *
 * ⚠️ THE GAP IS NARROWER THAN "NOTHING DRIVES becomeStuck", AND SAYING SO
 * MATTERS. `engine/connect.test.js` drives real flows into the stuck phase in
 * roughly a dozen places, as does `engine/connect.nobinary-1580.test.js`. What
 * none of them does is assert `canRunClaude`: the two files that reference the
 * field (`server.connect.test.js`, `engine.publicview-canrun-1595.test.js`)
 * build the state object by hand. This file closes that, and only that.
 *
 * 🛑 WHY THIS DRIVES `start()` RATHER THAN CALLING `becomeStuck` DIRECTLY.
 * The card offered two shapes: export `becomeStuck` with a `setDriverForTests`,
 * or drive the real flow to failure. This is the second, and it needs NO new
 * production surface -- no new export, and in particular no seam that weakens
 * the identity guard.
 *
 * That guard is the point. `becomeStuck` early-returns on `driver !== owner` so
 * a flow the person CANCELLED cannot later write a STUCK record, and so a stale
 * flow's failure cannot tear down the healthy flow that replaced it. A test seam
 * that lets a caller set `driver` would weaken exactly the mechanism whose job is
 * refusing callers. Driving `start()` keeps the guard fully armed: the flow this
 * file creates is the legitimate owner, which is why it reaches the write.
 *
 * 🛑 SERVE A LOCAL RELEASE OR THIS HITS downloads.claude.ai FOR REAL. Both arms
 * fail at the INSTALL step, which is downstream of the download, so both walk the
 * real `download()` -- and `download()` is plain `https.get`, so the injected
 * runner does not touch it. Measured before the fixture was added: each arm took
 * ~5.3s against the live service and ~65ms with the base pointed at a dead port,
 * an 80x difference that was entirely network. Both arms passed either way, so
 * the green never depended on the fixture and would not have revealed this.
 * `engine/connect.nobinary-1580.test.js` carries the same warning for the same
 * reason.
 *
 * ⚠️ THE INJECTED RUNNER MUST RETURN A FAILURE, NEVER THROW, AND THE REASON IS
 * NOT THE ONE IT LOOKS LIKE. `becomeStuck` calls the runner on its way out via
 * `killSession()`, but that call is fire-and-forget through two async frames, so
 * a synchronous throw becomes a REJECTED PROMISE rather than an exception that
 * unwinds the function. Measured: with a throwing runner the record is still
 * written (`phase=stuck canRunClaude=false`); what reddens the file is the
 * unhandled rejection, reported at process level with a stack through
 * `becomeStuck -> killSession -> tmux -> run` that reads as though the flow never
 * arrived. `run()` resolving `{ok:false}` and never rejecting is the contract the
 * rest of the file already relies on.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const nodePath = require('node:path');
const { mkTemp } = require('../test-support/tmpdir');

const SANDBOX = mkTemp('becomestuck1633-');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
const CFG_DIR = nodePath.join(SANDBOX, 'claude-config');
fs.mkdirSync(CFG_DIR, { recursive: true });
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(CFG_DIR, '.claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = CFG_DIR;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* #527: without this, a default-dir scoped read here would reach the operator's
   real ~/.claude.json. */
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');

const connect = require('./connect');

/** Same shape as `engine/connect.nobinary-1580.test.js`, for the same reason. */
function serveRelease(t, binary, checksum) {
  const paths = {
    '/latest': () => '9.9.5',
    '/9.9.5/manifest.json': () => JSON.stringify({ platforms: { [connect.platformKey()]: { checksum } } }),
    [`/9.9.5/${connect.platformKey()}/claude`]: () => binary,
  };
  const server = http.createServer((req, res) => {
    const answer = paths[req.url];
    if (!answer) { res.writeHead(404); res.end(); return; }
    const body = Buffer.isBuffer(answer()) ? answer() : Buffer.from(answer());
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

/**
 * Read the SETTLED state, not `start()`'s immediate return. `start()` returns
 * before `runFlow` has failed, so the immediate value cannot distinguish "wrote
 * the wrong verdict" from "has not written one yet".
 */
async function settled(ms = 8000) {
  const deadline = Date.now() + ms;
  const moving = [connect.PHASE.DOWNLOADING, connect.PHASE.INSTALLING, connect.PHASE.IDLE];
  while (Date.now() < deadline) {
    if (!moving.includes(connect.state().phase)) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return connect.state();
}

/**
 * Drive the real `start()` to a real install failure.
 *
 * ⚠️ The fixture's only variable is whether an executable exists at the bin path,
 * which is the question `becomeStuck` asks the disk. That is NOT the same as the
 * two arms walking identical code: the PRESENT arm additionally runs the
 * `--version` probe, which the injected runner answers `{ok:false}`, flipping
 * `haveBinary` false. Both then converge on the same install-failure path, which
 * is what makes them comparable. `installClaudeCode` unlinks the DOWNLOADED file,
 * not the bin path, so the PRESENT arm's executable survives to be seen.
 */
async function stuckWith(t, { binaryExists }) {
  /* Registered BEFORE the seam calls, so a throw from either still cleans up. */
  t.after(() => {
    connect.setRunner(null);
    connect.resetForTests();
    connect.setDryRun(true);
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
  });
  const fixture = crypto.randomBytes(8 * 1024);
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(
    t, fixture, crypto.createHash('sha256').update(fixture).digest('hex'));
  const bin = nodePath.join(SANDBOX, `claude-${Math.random().toString(36).slice(2, 8)}`);
  if (binaryExists) { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({}));
  connect.setRunner(() => ({ ok: false, stdout: '', stderr: '', message: 'forced by #1633 arm' }));
  connect.setDryRun(false);
  await connect.start();
  return settled();
}

/**
 * Pin the trigger. Without this the arms cannot say WHICH `becomeStuck` call
 * they exercised, and the trigger genuinely varies with the environment: a
 * download failure yields 'we could not download Claude' (connect.js:1317),
 * while the install failure these arms force yields the message below
 * (connect.js:1376, surfaced by the `if (!res.ok) becomeStuck(...)` at
 * connect.js:1458). Asserting it is what would have caught the missing release
 * server on the first run.
 */
const INSTALL_FAILURE = /did not finish setting itself up/;

test('#1633: a stuck flow WITH claude on disk records canRunClaude true', async (t) => {
  const st = await stuckWith(t, { binaryExists: true });
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.match(st.because, INSTALL_FAILURE,
    'reached STUCK by a different trigger than the install failure this arm forces');
  assert.equal(st.canRunClaude, true,
    'claude IS executable on disk, but the stuck screen would withhold the one way out it has');
});

test('#1633: a stuck flow with NO claude on disk records canRunClaude false', async (t) => {
  const st = await stuckWith(t, { binaryExists: false });
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.match(st.because, INSTALL_FAILURE,
    'reached STUCK by a different trigger than the install failure this arm forces');
  assert.equal(st.canRunClaude, false,
    'nothing is on disk, yet the stuck screen would tell somebody already stuck to type `claude` (#205)');
});

/**
 * ⭐ THE PAIR IS THE POINT. Either assertion alone is satisfied by a constant:
 * hardcode `true` and the first passes, hardcode `false` and the second does.
 * Only both together establish that the field TRACKS THE DISK, which is the
 * property the screen depends on. Both were proven red by mutation before this
 * file was committed; see the card for the transcript.
 *
 * 📌 The FALSE arm is the weaker half on its own and should not be read as
 * load-bearing alone: `publicView` writes `canRunClaude: s.canRunClaude || false`
 * (connect.js:508), so it cannot distinguish "computed false" from "never written
 * at all". The TRUE arm is what rules that out.
 */
