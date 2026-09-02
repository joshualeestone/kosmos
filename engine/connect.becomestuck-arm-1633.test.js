'use strict';

/*
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
 * ⚠️ THE GAP IS NARROWER THAN "NOTHING DRIVES becomeStuck", AND THE NARROW
 * WORDING IS LOAD-BEARING: no other file ASSERTS `canRunClaude` DOWNSTREAM OF A
 * `start()`.
 *
 * 🛑 IT IS NOT THAT NO FILE DOES BOTH. `server.connect.test.js:749` drives a
 * real `start()` into an assertion whose accepted set INCLUDES `PHASE.STUCK`
 * (its :751 is a three-way disjunction, not a stuck assertion), AND the file
 * references the field at :797/:1146/:1170 -- just never on one path. **Every looser wording of this claim has
 * been false**, so keep the verb: ASSERTS, downstream of a `start()`. Driving
 * `start()` and reading the settled STUCK record is what this file adds, and the
 * only thing it claims.
 *
 * 📌 The per-file census (which instrument each file uses) is stated ONCE, at
 * the third arm below; the counts and the command that reproduces them are in
 * the plan.
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
 * specifically would be wrong.) Without the fixture each arm costs seconds of
 * real network instead of milliseconds -- an 80x regression that the arms cannot
 * reveal, because they pass either way.
 * `engine/connect.nobinary-1580.test.js` carries the same warning for the same
 * reason. The measured figures are in the plan.
 *
 * ⚠️ THE INJECTED RUNNER MUST RETURN A FAILURE, NEVER THROW, AND THE REASON IS
 * NOT THE ONE IT LOOKS LIKE. `becomeStuck` calls the runner on its way out via
 * `killSession()`, but that call is fire-and-forget through two async frames, so
 * a synchronous throw becomes a REJECTED PROMISE rather than an exception that
 * unwinds the function. The record is still written; what reddens the file is an
 * unhandled rejection whose stack reads as though the flow never arrived, which
 * sends you hunting in the wrong place. `run()` resolving `{ok:false}` and never
 * rejecting is the contract the rest of the file already relies on.
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
 * Both messages come from `installClaudeCode`: the install failure yields the
 * one above, and a download failure yields 'we could not download Claude'. Two
 * failure points inside one function, so asserting the message is what pins
 * WHICH of them the arms exercised.
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
 * 🔑 THIS FILE IS NOT THAT TEST AND DOES NOT DUPLICATE IT. ⭐ WHAT IT ADDS, AS
 * A STRUCTURAL FACT RATHER THAN A MUTATION RESULT: these are the ONLY assertions
 * in the repo that ASSERT `canRunClaude` DOWNSTREAM OF A REAL `start()`. Four test
 * files reference the field (`git grep -c canRunClaude -- '*.test.js'`); the
 * other three build the state object by hand, match the PAGE source
 * (`server.connect.test.js:797` slices `web/index.html`, NOT `connect.js`), or
 * match `connect.js` as source text (`runnable-not-directory`).
 *
 * A mutation confirms that is not redundant -- a `writeState` that drops the
 * field reddens exactly one test in the whole suite, here -- but ⚠️ THAT
 * MUTATION IS SYNTHETIC: `writeState` is a blind spread, so losing one field
 * takes a `delete` naming it, which no natural refactor produces. 📌 The
 * REALISTIC version of that class (`publicView` dropping the field, which is
 * literally #1595) is already caught by
 * `engine.publicview-canrun-1595.test.js`. **So do not sell these arms as the
 * guard against the likely bug.** They are the only thing asserting this field
 * from a driven flow, which is narrower and actually true.
 *
 * ⚠️ AND IT IS NOT A SUBSET EITHER WAY. The unit guard pins the EXACT source
 * text of the writeState line, so a refactor changing NO behaviour reddens it
 * while these correctly stay green. It asserts THE SHAPE OF A LINE; these assert
 * THE VALUE THAT REACHES THE SCREEN.
 *
 * 🛑 DO NOT UPGRADE THIS TO A UNIQUENESS CLAIM ABOUT THE INSTALL-FAILURE
 * WIRING (`connect.js:1708`): two other tests redden on that too. Table in the
 * plan.
 *
 * 🛑 DO NOT "FIX" THIS ARM BACK TO ASSERTING `true`. An earlier version did,
 * as a deliberate characterisation: a bare `accessSync(X_OK)` DOES succeed on a
 * directory, so before #1592 that was the real behaviour. #1592 put
 * `statSync().isFile()` in front of it, and `false` is now correct. A card
 * raised against the old behaviour (kosmos#1859) was closed as already-fixed;
 * the dated timeline is in the plan.
 */
test('#1633: a DIRECTORY at the bin path is not runnable, via the driven flow', async (t) => {
  const st = await stuckWith(t, { binaryExists: false, directoryInstead: true });
  assert.equal(st.timedOut, false,
    'the flow never settled within the deadline; this is contention, not a verdict about canRunClaude');
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.match(st.because, INSTALL_FAILURE,
    'reached STUCK by a different trigger than the install failure this arm forces');
  assert.equal(st.canRunClaude, false,
    'a DIRECTORY at the bin path was reported runnable, so the stuck screen would '
    + 'tell somebody already stuck to type `claude` and get command not found (#205)');
});

/*
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
 * All three are proven red by mutation; the transcript is in the plan file
 * (`.claude/plans/becomestuck-arm-1633.md`).
 *
 * 📌 The FALSE arm is the weaker half on its own and should not be read as
 * load-bearing alone: `publicView` writes `canRunClaude: s.canRunClaude || false`
 * (connect.js:578), so it cannot distinguish "computed false" from "never
 * written at all". The TRUE arm is what rules that out.
 */
