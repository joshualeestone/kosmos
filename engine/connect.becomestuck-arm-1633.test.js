'use strict';

/**
 * #1633: `canRunClaude` is written by `becomeStuck` and read by the stuck
 * screen, and until this file nothing asserted it from a DRIVEN flow.
 *
 * The stuck screen's only way out is *"open Terminal, type `claude`"*, and
 * `web/index.html` gates that suggestion on `canRunClaude` (#1595). The value is
 * a filesystem answer that reaches a person's screen, so the failure it guards
 * against is telling somebody who is
 * already stuck to run a program that answers `command not found` (#205).
 *
 * 🛑 THE MECHANISM, NAMED EXACTLY, BECAUSE A NEARBY WRONG ONE IS EASY TO
 * ASSUME. `becomeStuck` writes `claudeHatchAvailable()` (connect.js:2446),
 * which is `runners.resolveBin('claude').present` -> `isRunnable()`, and
 * `isRunnable` does `statSync().isFile()` BEFORE `accessSync(X_OK)`
 * (runners.js:191). `claudeBinPath()` is NOT on that path at all, and a bare
 * `accessSync(claudeBinPath(), X_OK)` is what production did BEFORE #1592 --
 * it succeeds on a directory, which is the whole point of the third arm below.
 *
 * ⚠️ THE GAP IS NARROWER THAN "NOTHING DRIVES becomeStuck", AND SAYING SO
 * MATTERS. `engine/connect.test.js` drives real flows into the stuck phase in
 * roughly a dozen places (17 `PHASE.STUCK` references), and
 * `engine/connect.nobinary-1580.test.js` in a handful more (4 stuck references
 * in total, not the same order of magnitude). What none of them does is assert
 * `canRunClaude` FROM A DRIVEN FLOW. Measured: three other test files reference
 * the field, and they split two ways.
 *
 *   server.connect.test.js                  builds the state object by hand
 *   engine.publicview-canrun-1595.test.js   builds the state object by hand
 *   engine.runnable-not-directory.test.js   asserts it as SOURCE TEXT, reading
 *                                           connect.js off disk and matching the
 *                                           writeState line (its :1322)
 *
 * 🛑 THE CLAIM IS "NONE ASSERTS IT DOWNSTREAM OF A `start()`", AND THE WIDER
 * ONE IS FALSE: `server.connect.test.js` DOES call `connect.start()` (its :251
 * and :749), just never on a path reaching `canRunClaude`, whose three sites
 * there are a source grep (:797) and two hand-built harness states (:1146,
 * :1170). Driving `start()` and reading the settled STUCK record is what this
 * file adds, and the only thing it claims.
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
 * 🛑 SERVE A LOCAL RELEASE OR THIS HITS downloads.claude.ai FOR REAL. All three arms
 * fail at the INSTALL step, which is downstream of the download, so ALL THREE walk
 * the real `download()` -- and `download()` uses plain node http/https and sits OUTSIDE the
 * injected runner seam, so a runner stub does not touch it. (The fixture below
 * is served over plain `http://127.0.0.1`, which is why naming `https.get`
 * specifically would have been wrong.) Measured before the fixture was added: each arm took ~5.3s against the live
 * service. Pointing the base at a DEAD PORT gave ~65ms, and that number is an
 * ISOLATION CONTROL rather than this file's cost: it proves the 5.3s was
 * network, not that the disk arms are that fast. With the fixture actually
 * serving, the shipped cost is ~70ms per arm. Both DISK arms AS THE FILE THEN
 * STOOD (it had two; it now ships three) passed in all three configurations
 * AT THE TIME, so the green never depended on the fixture and could not have
 * revealed this. That is no longer true of the shipped file: the `because`
 * assertion added afterwards reddens the dead-port configuration, because a
 * download failure carries a different message. Stated with the qualifier so
 * this does not read as contradicting the note on that assertion below.
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
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { mkTemp } = require('../test-support/tmpdir');
const { serveRelease } = require('../test-support/release-fixture');

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
const subscription = require('./subscription');

/**
 * Read the SETTLED state, not `start()`'s immediate return. `start()` returns
 * before `runFlow` has failed, so the immediate value cannot distinguish "wrote
 * the wrong verdict" from "has not written one yet".
 */
async function settled(ms = 8000) {
  const deadline = Date.now() + ms;
  const moving = [connect.PHASE.DOWNLOADING, connect.PHASE.INSTALLING, connect.PHASE.IDLE];
  let timedOut = true;
  while (Date.now() < deadline) {
    if (!moving.includes(connect.state().phase)) { timedOut = false; break; }
    await new Promise((r) => setTimeout(r, 60));
  }
  /* ⚠️ REPORTED SEPARATELY, because otherwise a slow machine and a wrong
     verdict produce the SAME red. On timeout the phase is whatever the flow
     last wrote, and asserting on it would blame becomeStuck for contention. */
  return { ...connect.state(), timedOut };
}

/**
 * Drive the real `start()` to a real install failure.
 *
 * ⚠️ TWO INPUTS, THREE STATES, and the states are what `becomeStuck` asks the
 * disk about:
 *
 *     binaryExists: true,  directoryInstead: false   -> an executable FILE
 *     binaryExists: false, directoryInstead: false   -> NOTHING at the path
 *     binaryExists: false, directoryInstead: true    -> a DIRECTORY at the path
 *
 * (The bin path itself also differs per arm, for the reason given at the call
 * site.) That is NOT the same as the three arms walking identical code: the
 * PRESENT arm additionally runs the `--version` probe, which the injected
 * runner answers `{ok:false}`, flipping `haveBinary` false. All three then
 * converge on the same install-failure path, which is what makes them
 * comparable. `installClaudeCode` unlinks the DOWNLOADED file,
 * not the bin path, so the PRESENT arm's executable survives to be seen.
 */
async function stuckWith(t, { binaryExists, directoryInstead = false }) {
  /* Registered BEFORE the seam calls, so a throw from either still cleans up. */
  t.after(() => {
    connect.setRunner(null);
    subscription.setRunner(null);
    connect.resetForTests();
    connect.setDryRun(true);
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
  });
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE =
    await serveRelease(t, { platformKey: connect.platformKey() });
  /* 🔑 A DISTINCT PATH PER ARM IS LOAD-BEARING, not tidiness: the PRESENT arm
     writes an 0755 file, and if the ABSENT arm reused that path it would find a
     real executable and report canRunClaude true. The names alone are distinct
     and SANDBOX is a fresh mkTemp per process, so no random suffix is needed;
     a stable filename also keeps a failure message reproducible. */
  const bin = nodePath.join(SANDBOX, `claude-${directoryInstead ? 'dir' : binaryExists ? 'present' : 'absent'}`);
  if (directoryInstead) { fs.mkdirSync(bin, { recursive: true }); }
  else if (binaryExists) { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({}));
  /* Unreachable on this path today (the config fixture is `{}`, so
     `subscription.check()` never returns CONNECTED), but it is a latent
     subprocess spawn held closed only by the fixture's shape. One line. */
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));
  connect.setRunner(() => ({ ok: false, stdout: '', stderr: '', message: 'forced by #1633 arm' }));
  connect.setDryRun(false);
  await connect.start();
  return settled();
}

/**
 * Pin the trigger. Without this the arms cannot say WHICH `becomeStuck` call
 * they exercised, and the trigger genuinely varies with the environment: a
 * download failure yields 'we could not download Claude', while the install
 * failure these arms force yields the message below (returned by
 * `installClaudeCode` and surfaced by `runFlow`'s
 * `if (!res.ok) becomeStuck(owner, res.message, res.detail)`).
 *
 * BOTH come from `installClaudeCode`. `download()` has NO failure return, it
 * THROWS, and 'we could not download Claude' is what installClaudeCode's own
 * catch turns that throw into. Both failure points live inside
 * `installClaudeCode`; they are not two functions.
 *
 * Asserting it is what would have caught the missing release server on the
 * first run.
 */
const INSTALL_FAILURE = /did not finish setting itself up/;

test('#1633: a stuck flow WITH claude on disk records canRunClaude true', async (t) => {
  const st = await stuckWith(t, { binaryExists: true });
  assert.equal(st.timedOut, false,
    'the flow never settled within the deadline; this is contention, not a verdict about canRunClaude');
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.match(st.because, INSTALL_FAILURE,
    'reached STUCK by a different trigger than the install failure this arm forces');
  assert.equal(st.canRunClaude, true,
    'claude IS executable on disk, but the stuck screen would withhold the one way out it has');
});

test('#1633: a stuck flow with NO claude on disk records canRunClaude false', async (t) => {
  const st = await stuckWith(t, { binaryExists: false });
  assert.equal(st.timedOut, false,
    'the flow never settled within the deadline; this is contention, not a verdict about canRunClaude');
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.match(st.because, INSTALL_FAILURE,
    'reached STUCK by a different trigger than the install failure this arm forces');
  assert.equal(st.canRunClaude, false,
    'nothing is on disk, yet the stuck screen would tell somebody already stuck to type `claude` (#205)');
});

/**
 * ⭐ A DIRECTORY IS NOT RUNNABLE, ASSERTED FROM THE DRIVEN FLOW.
 *
 * `fs.accessSync(path, X_OK)` SUCCEEDS ON A DIRECTORY. If `canRunClaude` were
 * computed that way, a directory at the bin path would report `true` and the
 * stuck screen would tell somebody already stuck to type `claude` and get
 * `command not found`, which is the #205 harm the field exists to prevent.
 *
 * `becomeStuck` asks `claudeHatchAvailable()` instead, which reaches
 * `runners.isRunnable()` and does a `statSync().isFile()` first. #1592 made
 * that change and `engine.runnable-not-directory.test.js` guards it AT THE UNIT.
 *
 * 🔑 THIS ARM IS NOT THAT TEST AND DOES NOT DUPLICATE IT. That one calls the
 * helper directly; this one drives the REAL `start()` to a REAL failure and
 * reads the value out of the STUCK record the screen is served from. The unit
 * guard would stay green if `becomeStuck` stopped calling the helper. This one
 * would not.
 *
 * 🛑 DO NOT "FIX" THIS ARM BACK TO ASSERTING `true`. An earlier version did,
 * as a deliberate characterisation: a bare `accessSync(X_OK)` DOES succeed on a
 * directory, so before #1592 that was the real behaviour. #1592 put
 * `statSync().isFile()` in front of it, and `false` is now correct. A card
 * raised against the old behaviour (kosmos#1859) was closed as already-fixed.
 *
 * ⚠️ The measured timeline, because it is the reusable part and a loose version
 * of it is easy to write:
 *
 *   2026-08-30 18:44  #1592 fix AUTHORED (fed47fc5)
 *   2026-08-31 09:29  this arm written        <- fix existed, but NOT on main
 *   2026-09-01 02:38  #1592 reaches origin/main
 *   2026-09-02 10:46  kosmos#1859 filed       <- fix on main for ~32 hours
 *   2026-09-02 11:07  closed as already-fixed
 *
 * ⇒ Writing the arm was defensible; a fetch that morning would not have shown
 * the fix. FILING THE CARD A DAY LATER WAS THE DEFECT, and by then one `git
 * fetch` would have settled it. Being behind is harmless; being behind ON THE
 * FILE YOU ARE MAKING A CLAIM ABOUT is not.
 */
test('#1633: a DIRECTORY at the bin path is not runnable, via the driven flow', async (t) => {
  const st = await stuckWith(t, { binaryExists: false, directoryInstead: true });
  assert.equal(st.timedOut, false,
    'the flow never settled within the deadline; this is contention, not a verdict');
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.match(st.because, INSTALL_FAILURE,
    'reached STUCK by a different trigger than the install failure this arm forces');
  assert.equal(st.canRunClaude, false,
    'a DIRECTORY at the bin path was reported runnable, so the stuck screen would '
    + 'tell somebody already stuck to type `claude` and get command not found (#205)');
});

/**
 * 🛑 THESE THREE ARMS ARE macOS-ONLY, AND THE FAILURE SHAPE WOULD MISLEAD.
 * `download()` gates on `platformGate.isSupported(process.platform)` and throws
 * on anything else, which `installClaudeCode` turns into "we could not download
 * Claude". On a Linux runner all three arms would red on the INSTALL_FAILURE
 * `because` match with a message that reads as a PRODUCT fault rather than an
 * unsupported-platform one. CI is `macos-latest`
 * (`.github/workflows/test.yml`), so this is not live today; it is written down
 * because the reader who eventually sees that red will otherwise go hunting in
 * `becomeStuck`.
 *
 * ⭐ THE SET IS THE POINT, AND THERE ARE THREE OF THEM. Either of the first
 * two alone is satisfied by a constant: hardcode `true` and PRESENT passes,
 * hardcode `false` and ABSENT does. Only together do they establish that the
 * field TRACKS THE DISK, which is the property the screen depends on. The
 * DIRECTORY arm then pins WHICH disk question is asked, since a bare
 * `accessSync(X_OK)` succeeds on a directory and would satisfy both of the
 * others.
 *
 * All three are proven red by mutation, and the transcript is in the plan file
 * (`.claude/plans/becomestuck-arm-1633.md`), not "the card" -- an earlier
 * version of this line said the card and described only two arms.
 *
 * 📌 The FALSE arm is the weaker half on its own and should not be read as
 * load-bearing alone: `publicView` writes `canRunClaude: s.canRunClaude || false`
 * (`publicView`), so it cannot distinguish "computed false" from "never written
 * at all". The TRUE arm is what rules that out.
 */
