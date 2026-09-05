'use strict';
/*
 * kosmos#2125 slice 3: the native Accessibility WRITER. Accessibility trust is a TCC
 * fact the Node engine cannot read (#1344); only a native AXIsProcessTrusted call can.
 * The kosmos-app runs that check -- attributed to tmux via macOS's responsible-process
 * model, the same attribution that makes tmux the folder-TCC owner -- and writes the
 * verdict where engine/a11ystatus.js reads it, gating the first-run Continue button.
 *
 * This file pins the WIRING (read from SOURCE, an AppKit binary no unit test can boot)
 * so a source edit that breaks it fails the fast suite. The RUNTIME false-block path
 * (writer -> engine -> gate, with the trust value MOCKED) is exercised on a real
 * compiled binary by tools/test-a11y-writer-mock-2125.sh and the build-bundle smoke.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SRC = fs.readFileSync('native-app/main.swift', 'utf8');
const ENGINE = fs.readFileSync('engine/a11ystatus.js', 'utf8');

test('the instrument is reading something', () => {
  assert.ok(SRC.length > 40000, `main.swift read back only ${SRC.length} bytes; assertions would pass for the wrong reason`);
});

test('imports ApplicationServices (AXIsProcessTrusted lives there)', () => {
  assert.match(SRC, /^import ApplicationServices/m, 'ApplicationServices is not imported; AXIsProcessTrusted/AXIsProcessTrustedWithOptions would not resolve');
});

test('the writer path MATCHES the engine reader path (the cross-language seam agrees)', () => {
  // engine/a11ystatus.js: FILE = path.join(store.ROOT, 'a11y-status.json'), and
  // store.ROOT is <app-support-base>/AgentWorkforce. The Swift writer resolves the
  // SAME base and MUST append the SAME "AgentWorkforce/a11y-status.json", or the
  // writer and reader miss each other silently (the two-copies-of-one-fact defect).
  assert.match(ENGINE, /path\.join\(store\.ROOT,\s*'a11y-status\.json'\)/,
    'the engine reader no longer reads a11y-status.json under store.ROOT; the writer assertion below is checking a stale contract');
  assert.ok(SRC.includes('func a11yStatusURL()'), 'a11yStatusURL() moved or was renamed');
  assert.ok(SRC.includes('appendingPathComponent("AgentWorkforce/a11y-status.json")'),
    'the writer does not append "AgentWorkforce/a11y-status.json"; it would write where the engine does not read');
  // The base resolution mirrors boardTokenValue()/relaunchHandoffURL(): the DATA
  // override first (so a moved data dir is followed), else HOME + Library/Application
  // Support, else the OS app-support dir. Pin the override arm -- getting it wrong is
  // exactly how the writer and the board's engine would resolve different dirs.
  const fn = SRC.slice(SRC.indexOf('func a11yStatusURL()'), SRC.indexOf('func axTrustReading()'));
  assert.ok(fn.includes('AGENT_WORKFORCE_DATA'), 'a11yStatusURL does not honor AGENT_WORKFORCE_DATA; a moved data dir would desync from the engine');
});

test('axTrustReading has the test-only mock seam AND falls through to the real call', () => {
  const fn = SRC.slice(SRC.indexOf('func axTrustReading()'), SRC.indexOf('func writeA11yStatus('));
  assert.ok(fn.includes('KOSMOS_AXCHECK_FORCE_TRUSTED'),
    'the mock seam is gone; the trusted:false (gating) path cannot be exercised on a dev box where AXIsProcessTrusted always returns true');
  // Both mock directions, so the seam is not a one-way stub that could only ever say true.
  assert.match(fn, /"1"\s*\|\|\s*v == "true"/, 'the mock does not honor the trusted arm');
  assert.match(fn, /"0"\s*\|\|\s*v == "false"/, 'the mock does not honor the not-trusted (gating) arm');
  // The real source is the LAST word: an override that never fell through to
  // AXIsProcessTrusted would ship a permanently-mocked reading.
  assert.match(fn, /return AXIsProcessTrusted\(\)\s*\n\}/, 'axTrustReading does not fall through to the real AXIsProcessTrusted()');
});

test('writeA11yStatus emits EXACTLY the shape a11ystatus.js parses (boolean trusted + parseable at)', () => {
  const fn = SRC.slice(SRC.indexOf('func writeA11yStatus('), SRC.indexOf('func a11yStatusURL()') > SRC.indexOf('func writeA11yStatus(') ? SRC.length : SRC.indexOf('func writeA11yStatus(') + 1400);
  // a11ystatus.js requires `typeof rec.trusted === 'boolean'` and a Date.parse-able
  // `rec.at`; anything else is read as checkable:false. Pin the exact JSON template.
  assert.ok(SRC.includes('"{\\"trusted\\":\\(trusted),\\"at\\":\\"\\(at)\\"}'),
    'the written JSON shape drifted; a11ystatus.js needs a boolean `trusted` and an ISO8601 `at`');
  assert.ok(SRC.includes('ISO8601DateFormatter()'), 'the timestamp is not ISO8601; a11ystatus.js Date.parse would reject it and read the verdict as stale/uncheckable');
});

test('the --kosmos-app-axcheck hatch writes the (real or mocked) trust reading', () => {
  assert.ok(SRC.includes('"--kosmos-app-axcheck"'), 'the axcheck hatch is gone; build-kosmos-bundle.sh cannot smoke the writer and nothing keeps the verdict fresh');
  assert.match(SRC, /writeA11yStatus\(trusted:\s*axTrustReading\(\)\)/, 'the axcheck hatch does not write axTrustReading() through writeA11yStatus()');
});

test('the --kosmos-app-axprompt hatch shows the system prompt (adds Tmux to the Accessibility list)', () => {
  assert.ok(SRC.includes('"--kosmos-app-axprompt"'), 'the axprompt hatch is gone; the Open-Accessibility button would open a list with nothing to enable (Josh bug #2)');
  assert.ok(SRC.includes('AXIsProcessTrustedWithOptions') && SRC.includes('kAXTrustedCheckOptionPrompt'),
    'axprompt does not call AXIsProcessTrustedWithOptions with the prompt option, so it neither prompts nor adds the process to the list');
});

test('the runtime wiring spawns the axcheck UNDER tmux, on launch and on a timer', () => {
  assert.ok(SRC.includes('func startA11yTrustChecks()'), 'startA11yTrustChecks moved or was renamed');
  const fn = SRC.slice(SRC.indexOf('func startA11yTrustChecks()'), SRC.indexOf('func currentlyTrusted()'));
  assert.ok(fn.includes('--kosmos-app-axcheck'), 'the runtime wiring never spawns the axcheck, so the verdict is never refreshed and the gate is permanently inert');
  assert.ok(fn.includes('Timer.scheduledTimer'), 'there is no repeating refresh; a one-shot reading would go stale and the gate would fall back to fail-safe forever');
  // The under-tmux spawn is the whole attribution design: the AX read must be tmux's,
  // not the app's. Pin the private-socket spawn so a refactor to a bare spawn (which
  // would read the APP's trust -- a false reading) reds here.
  const spawn = SRC.slice(SRC.indexOf('func spawnAxHatchUnderTmux('), SRC.indexOf('func spawnAxHatchUnderTmux(') + 1400);
  assert.ok(spawn.includes('/bin/tmux'), 'the hatch is not spawned under the bundled tmux; the AX read would be attributed to the app, a false reading');
  assert.match(spawn, /"-L",\s*"kosmos-axcheck",\s*"new-session"/, 'the under-tmux spawn does not use a private tmux server socket; it could touch the user\'s own tmux sessions');
});

test('applicationDidFinishLaunching starts the Accessibility checks', () => {
  const start = SRC.indexOf('func applicationDidFinishLaunching(');
  const end = SRC.indexOf('MARK: #2125 slice 3', start);
  assert.ok(end > start, 'the normal-launch path landmark moved');
  assert.ok(SRC.slice(start, end).includes('startA11yTrustChecks()'),
    'launch does not start the Accessibility checks, so nothing writes the verdict and the gate stays inert');
});

test('the one-shot prompt only fires when NOT already trusted (no repeated prompts)', () => {
  const fn = SRC.slice(SRC.indexOf('func startA11yTrustChecks()'), SRC.indexOf('func currentlyTrusted()'));
  assert.match(fn, /!a11yPromptFired\s*&&\s*!currentlyTrusted\(\)/,
    'the prompt is not guarded by both the one-shot flag AND a not-trusted reading; an already-trusted user would be prompted, or it would prompt every launch');
});
