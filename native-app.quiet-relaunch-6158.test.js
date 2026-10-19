'use strict';

/**
 * #6158: a restart nobody asked for, made while another app is in front, never takes focus.
 *
 * The rule (relaunchMayActivate) and the one-shot flag (consumeQuietRelaunch) are proven by running them, in the
 * Swift selftest (--kosmos-app-stale-selftest, rows "quiet:"). What no selftest can construct is the AppKit wiring
 * around them: NSWorkspace.OpenConfiguration in relaunch() and the launch's NSApp.activate. So this reads the source,
 * as native-app.stale-silences.test.js does, and holds the two places the focus was taken.
 *
 *   node --test native-app.quiet-relaunch-6158.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

function body(signature) {
  const start = SRC.indexOf(signature);
  assert.ok(start > 0, signature + ' moved or was renamed');
  const end = SRC.indexOf('\n    func ', start + 10) > 0 ? Math.min(...['\n    func ', '\n    private func ', '\n    @objc func ']
    .map((m) => SRC.indexOf(m, start + 10)).filter((i) => i > 0)) : -1;
  assert.ok(end > start, 'could not find the end of ' + signature);
  return SRC.slice(start, end);
}

test('the instrument is reading something', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#6158: the relaunch opens the fresh copy activating only when relaunchMayActivate says so, and says why', () => {
  const r = body('private func relaunch(mine: String, theirs: String, target: URL');
  assert.match(r, /let mayActivate = relaunchMayActivate\(asked: asked, wasActive: NSApp\.isActive\)/, 'the rule is not asked with the real answers');
  assert.match(r, /conf\.activates = mayActivate/, 'the fresh copy is opened activating whatever the rule says');
  assert.match(r, /relaunchEnv\.removeValue\(forKey: kRelaunchQuietEnvKey\)/, 'an inherited quiet flag could decide a later restart');
  assert.match(r, /if !mayActivate \{ relaunchEnv\[kRelaunchQuietEnvKey\] = "1" \}/, 'the fresh copy is not told it was a quiet restart');
  assert.match(r, /conf\.environment = relaunchEnv\b/, 'the environment that carries the flag is not the one handed over');
  assert.ok(r.indexOf('conf.activates = mayActivate') < r.indexOf('NSWorkspace.shared.openApplication'), 'activates is set after the app was already opened');
});

test('#6158: the launch reads the flag once and does not activate itself after a quiet restart', () => {
  const l = body('func applicationDidFinishLaunching(_ notification: Notification) {');
  assert.equal((l.match(/consumeQuietRelaunch\(\)/g) || []).length, 1, 'the flag is not read exactly once at launch');
  assert.match(l, /let launchedQuietly = consumeQuietRelaunch\(\)/, 'the guard does not use the value the flag was read as');
  assert.match(l, /if launchedQuietly \{ logLine\([^\n]*\) \}\n\s*else \{ NSApp\.activate\(ignoringOtherApps: true\) \}/,
    'the launch activates itself even after a quiet restart');
  /* Every OTHER activate in the launch is the duplicate guard's, which raises the SURVIVOR and exits; none may take
     focus for this copy. */
  const activates = l.match(/NSApp\.activate\(ignoringOtherApps: true\)/g) || [];
  assert.equal(activates.length, 1, 'a second unconditional NSApp.activate appeared in the launch: ' + activates.length);
});
