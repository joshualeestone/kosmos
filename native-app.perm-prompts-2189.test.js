'use strict';
/*
 * kosmos#1 / #2189: on-demand permission prompts. Josh's 0.6.39 fresh-account test
 * found the permission screens' grant buttons never fired the REAL macOS prompts (they
 * only appeared later at Import) and tmux was not even in the Accessibility list. The
 * fix: the button POSTs, the engine records a request (engine/promptrequest.js), and
 * the NATIVE app fires the matching prompt UNDER tmux so it is attributed to tmux -- the
 * responsible process that owns the folder-TCC grant and that the agents use.
 *
 * The AppKit binary cannot be booted by a unit test, so this pins the SOURCE wiring so a
 * source edit that breaks the seam fails the fast suite (the runtime is exercised on a
 * compiled binary by the build-bundle smoke + a real fresh-install verify on staging).
 * It is the sibling of native-app.a11y-writer-2125.test.js and the same posture.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SRC = fs.readFileSync('native-app/main.swift', 'utf8');
const ENGINE = fs.readFileSync('engine/fileaccessstatus.js', 'utf8');

test('the instrument is reading something', () => {
  assert.ok(SRC.length > 40000, `main.swift read back only ${SRC.length} bytes; assertions would pass for the wrong reason`);
});

test('storeFileURL resolves the shared store dir the DATA override first, then appends AgentWorkforce/<name>', () => {
  assert.ok(SRC.includes('func storeFileURL('), 'storeFileURL moved or was renamed');
  const fn = SRC.slice(SRC.indexOf('func storeFileURL('), SRC.indexOf('func a11yStatusURL()'));
  assert.ok(fn.includes('AGENT_WORKFORCE_DATA'), 'storeFileURL does not honor AGENT_WORKFORCE_DATA; a moved data dir would desync from the engine');
  assert.ok(fn.includes('appendingPathComponent("AgentWorkforce/\\(name)")'),
    'storeFileURL does not append AgentWorkforce/<name>; the request/status files would land where the engine does not look');
});

test('the file-access writer path MATCHES the engine reader path (cross-language seam agrees)', () => {
  // engine/fileaccessstatus.js: FILE = path.join(store.ROOT, 'file-access-status.json').
  // The Swift writer must resolve the SAME store dir + the SAME filename, or writer and
  // reader miss each other silently (the two-copies-of-one-fact defect).
  assert.match(ENGINE, /path\.join\(store\.ROOT,\s*'file-access-status\.json'\)/,
    'the engine reader no longer reads file-access-status.json under store.ROOT; the writer assertion below is checking a stale contract');
  assert.ok(SRC.includes('func fileAccessStatusURL()'), 'fileAccessStatusURL moved or was renamed');
  assert.ok(SRC.includes('storeFileURL("file-access-status.json")'),
    'fileAccessStatusURL does not resolve file-access-status.json via storeFileURL; it would write where the engine does not read');
});

test('fileAccessReading has the test-only mock seam (both arms) AND falls through to the real probe', () => {
  const fn = SRC.slice(SRC.indexOf('func fileAccessReading()'), SRC.indexOf('func writeFileAccessStatus('));
  assert.ok(fn.includes('KOSMOS_FILEACCESS_FORCE_GRANTED'),
    'the mock seam is gone; the granted:false path cannot be exercised on a dev box that already holds Full Disk Access');
  assert.match(fn, /"1"\s*\|\|\s*v == "true"/, 'the mock does not honor the granted arm');
  assert.match(fn, /"0"\s*\|\|\s*v == "false"/, 'the mock does not honor the not-granted (gating) arm');
  // The real reading probes the three TCC-protected folders; enumerating them is what
  // both fires the prompt and measures the grant.
  assert.ok(fn.includes('contentsOfDirectory'), 'fileAccessReading does not attempt a real folder read, so it neither fires the prompt nor measures the grant');
  for (const folder of ['Documents', 'Downloads', 'Desktop']) {
    assert.ok(fn.includes(`"${folder}"`), `fileAccessReading does not probe ${folder}; that TCC folder would go unchecked`);
  }
  // It must probe ALL THREE unconditionally (accumulate, not early-return): each
  // enumerate fires that folder's own prompt, so a `return` inside the loop would
  // surface only the first ungranted folder's prompt per click. Scope the check to the
  // loop body (the mock seam above legitimately `return false`s).
  const loop = fn.slice(fn.indexOf('for folder in'), fn.indexOf('return allGranted'));
  assert.ok(loop.length > 0, 'fileAccessReading no longer accumulates into allGranted; the all-three-probe guarantee is unpinned');
  // A return STATEMENT (line-start), not the word "return" in a comment.
  assert.ok(!/\n[ \t]*return\b/.test(loop),
    'fileAccessReading returns from inside the folder loop; one click must attempt all three so every folder prompt fires');
  assert.ok(loop.includes('allGranted = false'),
    'fileAccessReading does not record a failed folder into allGranted');
});

test('writeFileAccessStatus emits EXACTLY the shape fileaccessstatus.js parses (boolean granted + ISO8601 at)', () => {
  // fileaccessstatus.js requires typeof rec.granted === 'boolean' and a Date.parse-able
  // rec.at; anything else reads as checkable:false. Pin the exact JSON template.
  assert.ok(SRC.includes('"{\\"granted\\":\\(granted),\\"at\\":\\"\\(at)\\"}'),
    'the written JSON shape drifted; fileaccessstatus.js needs a boolean `granted` and an ISO8601 `at`');
  const fn = SRC.slice(SRC.indexOf('func writeFileAccessStatus('), SRC.indexOf('func writeFileAccessStatus(') + 900);
  assert.ok(fn.includes('ISO8601DateFormatter()'), 'the timestamp is not ISO8601; fileaccessstatus.js Date.parse would reject it');
});

test('the --kosmos-app-fileaccessprompt hatch writes the (real or mocked) grant reading', () => {
  assert.ok(SRC.includes('"--kosmos-app-fileaccessprompt"'), 'the fileaccessprompt hatch is gone; the file-access grant is never fired or measured');
  assert.match(SRC, /writeFileAccessStatus\(granted:\s*fileAccessReading\(\)\)/,
    'the fileaccessprompt hatch does not write fileAccessReading() through writeFileAccessStatus()');
});

test('the request watcher is started at launch and consumes BOTH request files under tmux', () => {
  // Started from didFinishLaunching (its body ends at the startA11yTrustChecks
  // definition), or an on-demand prompt could never fire. Anchored to the next method
  // rather than a fixed char count, so the assertion cannot silently fall short of a
  // call that moved deeper into a growing launch body.
  const launch = SRC.slice(SRC.indexOf('func applicationDidFinishLaunching('), SRC.indexOf('private func startA11yTrustChecks()'));
  assert.ok(launch.includes('startPromptRequestWatcher()'), 'the prompt-request watcher is never started; a grant button POST would never fire a prompt');
  assert.ok(SRC.includes('func startPromptRequestWatcher()'), 'startPromptRequestWatcher moved or was renamed');

  assert.ok(SRC.includes('func checkPromptRequests()'), 'checkPromptRequests moved or was renamed');
  const check = SRC.slice(SRC.indexOf('func checkPromptRequests()'), SRC.indexOf('private func consumeRequest('));
  assert.ok(check.includes('consumeRequest(named: "a11y-prompt-request"'), 'the a11y prompt request is not consumed');
  assert.ok(check.includes('consumeRequest(named: "file-access-prompt-request"'), 'the file-access prompt request is not consumed');
  assert.ok(check.includes('--kosmos-app-axprompt'), 'the a11y request does not fire the axprompt hatch');
  assert.ok(check.includes('--kosmos-app-fileaccessprompt'), 'the file-access request does not fire the fileaccessprompt hatch');
  // The a11y branch also refreshes the verdict so the poll flips without the 60s wait.
  assert.ok(check.includes('--kosmos-app-axcheck'), 'the a11y request does not refresh the axcheck, so the pill would not flip promptly');
});

test('consumeRequest consumes-before-firing, fires only on a successful delete, and drops a stale request', () => {
  const fn = SRC.slice(SRC.indexOf('private func consumeRequest('), SRC.indexOf('private func spawnAxHatchUnderTmux('));
  const removeAt = fn.indexOf('removeItem');
  const fireAt = fn.indexOf('fire()');
  assert.ok(removeAt !== -1 && fireAt !== -1, 'consumeRequest must both delete the request and fire');
  assert.ok(removeAt < fireAt, 'consumeRequest fires before deleting; successive ticks could launch the hatch twice');
  // Fire ONLY if the consume delete succeeded: a non-optional `try removeItem` in a
  // do/catch that returns before fire(). A best-effort `try?` that fired anyway would
  // re-fire the prompt every tick when the delete fails (prompt spam).
  assert.ok(fn.includes('try FileManager.default.removeItem(at: url)'),
    'consumeRequest uses a best-effort delete then fires unconditionally; a failed delete would re-fire the prompt every tick');
  const consumeCatch = fn.indexOf('catch {', fn.indexOf('try FileManager.default.removeItem(at: url)'));
  assert.ok(consumeCatch !== -1 && consumeCatch < fireAt && /return/.test(fn.slice(consumeCatch, fireAt)),
    'a failed consume delete must return before fire(), or it re-fires the prompt on the next tick');
  // A request older than 30s is dropped, not fired (it is from a previous run).
  assert.ok(/timeIntervalSince\([^)]*\)\s*>\s*30/.test(fn),
    'consumeRequest does not drop a >30s-stale request; a leftover from a prior run would fire a surprise prompt');
});
