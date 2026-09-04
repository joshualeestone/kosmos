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
  const m = SRC.match(/func applicationDidFinishLaunching\([\s\S]{0,1300}/);
  assert.ok(m, 'applicationDidFinishLaunching moved');
  const head = m[0];
  assert.ok(head.includes('consumeFreshRelaunchHandoff('), 'the guard does not consume the relaunch handoff -- the #2094 relaunch would be treated as a duplicate');
  assert.ok(head.includes('shouldDeferToExistingInstance('), 'the guard does not call the decision');
  assert.ok(head.includes('other?.activate()') && head.includes('NSApp.terminate('), 'a duplicate must activate the existing instance and terminate itself');
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
