'use strict';
/*
 * kosmos#2124: the native app must run as a SINGLE instance. A fresh install ran
 * multiple because macOS keys single-instance on bundle PATH, and the installer's
 * launched copy + the dragged /Applications copy are different paths. The fix dedups
 * by bundle id in applicationDidFinishLaunching -- EXCEPT the #2094 self-update relaunch,
 * which hands the fresh copy a one-shot handoff so it is not deduped to nothing.
 *
 * Read from SOURCE (an AppKit delegate no unit test can construct); the RUNTIME both-arms
 * check is the --kosmos-app-instance-selftest hatch, run + diffed by build-kosmos-bundle.sh.
 * This file pins the WIRING so a source edit that breaks it fails the fast suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SRC = fs.readFileSync('native-app/main.swift', 'utf8');

test('the instrument is reading something', () => {
  assert.ok(SRC.length > 40000, `main.swift read back only ${SRC.length} bytes; assertions would pass for the wrong reason`);
});

test('the pure decision is present and encodes BOTH arms (!handoff && otherRunning)', () => {
  assert.ok(SRC.includes('func shouldDeferToExistingInstance('), 'the single-instance decision moved or was renamed');
  // The whole point: defer ONLY on a normal launch (no handoff) with another instance up.
  assert.match(SRC, /return\s*!handoff\s*&&\s*otherRunning/, 'the decision is not `!handoff && otherRunning`; a relaunch could be deduped to nothing, or a duplicate let through');
});

test('applicationDidFinishLaunching dedups: consume handoff, then defer -> activate other + terminate', () => {
  const m = SRC.match(/func applicationDidFinishLaunching\([\s\S]{0,1600}/);
  assert.ok(m, 'applicationDidFinishLaunching moved');
  const head = m[0];
  assert.ok(head.includes('consumeFreshRelaunchHandoff('), 'the guard does not consume the relaunch handoff -- the #2094 relaunch would be treated as a duplicate');
  assert.ok(head.includes('shouldDeferToExistingInstance('), 'the guard does not call the decision');
  assert.ok(head.includes('other?.activate()') && head.includes('NSApp.terminate('), 'a duplicate must activate the existing instance and terminate itself');
});

test('the defer block terminates CLEANLY: sets isActuallyQuitting BEFORE terminate (no quit dialog can cancel the dedup)', () => {
  // NSApp.terminate re-enters applicationShouldTerminate, which shows the "Your agents
  // keep running" quit dialog unless isActuallyQuitting is set -- and a dismissed dialog
  // returns .terminateCancel, leaving the DUPLICATE open and defeating #2124. The dedup
  // is not a person-initiated quit, so it must set the flag first, like the #2094 relaunch.
  const i = SRC.indexOf('shouldDeferToExistingInstance(handoff: handoff');
  assert.ok(i > 0, 'the defer guard moved');
  const block = SRC.slice(i, i + 800);
  const flagAt = block.indexOf('isActuallyQuitting = true');
  const termAt = block.indexOf('NSApp.terminate(');
  assert.ok(flagAt > 0, 'the defer block does not set isActuallyQuitting -- a dedup would pop the quit dialog and a dismissal leaves the duplicate open');
  assert.ok(termAt > flagAt, 'isActuallyQuitting must be set BEFORE NSApp.terminate in the defer block, or the re-entered quit dialog can cancel the termination');
});

test('the relaunch-failure path removes the fallback token (a stale token must not outlive a failed relaunch)', () => {
  // If openApplication fails, this instance stays open; a lingering token would let a
  // manual reopen within its TTL skip the dedup and run as a duplicate.
  const j = SRC.indexOf('relaunch FAILED');
  assert.ok(j > 0, 'the relaunch-failure log line moved');
  // Window spans the log line + explanatory comment + the cleanup, up to the alert build.
  const failBlock = SRC.slice(j, SRC.indexOf('NSAlert()', j) > j ? SRC.indexOf('NSAlert()', j) : j + 1200);
  assert.ok(failBlock.includes('removeItem(at:') && failBlock.includes('relaunchHandoffURL('), 'the relaunch-failure path does not remove the fallback token, so a failed relaunch can leave a duplicate-enabling token behind');
});

test('the env handoff is unset after consumption (not left to propagate to descendant processes)', () => {
  const c = SRC.indexOf('func consumeFreshRelaunchHandoff(');
  assert.ok(c > 0, 'consumeFreshRelaunchHandoff moved');
  const body = SRC.slice(c, c + 900);
  assert.ok(body.includes('unsetenv(kRelaunchHandoffEnvKey)'), 'the env handoff is not unset -- a stale value would be inherited by descendant processes and could wrongly skip a future dedup');
});

test('the #2094 relaunch hands off BOTH ways before opening the fresh copy', () => {
  // The env channel (robust primary, no disk) and the file token (fallback) must both be
  // set BEFORE openApplication, or a failed token write reintroduces the quit-to-nothing race.
  const i = SRC.indexOf('conf.createsNewApplicationInstance = true');
  const j = SRC.indexOf('openApplication(at: target');
  assert.ok(i > 0 && j > i, 'the relaunch open moved');
  const between = SRC.slice(i, j);
  assert.ok(between.includes('kRelaunchHandoffEnvKey') && between.includes('conf.environment'), 'the relaunch does not set the handoff env var on the launch');
  assert.ok(between.includes('writeRelaunchHandoffToken()'), 'the relaunch does not write the fallback token file');
});

test('the env handoff MERGES onto the current environment (does not replace it)', () => {
  // Replacing conf.environment would strip KOSMOS_HOME etc. from the fresh copy.
  assert.match(SRC, /conf\.environment\s*=\s*ProcessInfo\.processInfo\.environment[\s\S]{0,80}\.merging\(/, 'conf.environment is set without merging the current environment');
});

test('the runtime both-arms selftest hatch exists (build-time gate drives it)', () => {
  assert.ok(SRC.includes('"--kosmos-app-instance-selftest"'), 'the instance selftest hatch is gone; build-kosmos-bundle.sh cannot diff the decision table');
});
