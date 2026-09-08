'use strict';

/**
 * kosmos#1214 (as folded into install-flow-9screen): the Accessibility grant.
 *
 * Josh, main channel 2026-08-27: an agent's work triggered the macOS "tmux wants
 * to control System Events / Accessibility" prompt mid-task, and he wanted it
 * turned on up front so the user is never ambushed. The literal "grant it during
 * install" cannot be built (TCC: only the user can grant Accessibility, in System
 * Settings). The achievable version is a first-run step that explains it and opens
 * the setting.
 *
 * install-flow-9screen (Josh's signed-off 9-screen flow, 2026-09-05) RETIRED the
 * standalone Accessibility step (old fr-pane-5) and folded the tmux/Accessibility
 * concern into the new S3 "Automation" screen (fr-pane-3), as one of its two
 * permission gates (data-gate="tmux"), alongside the sleep gate. So this file now
 * pins the S3 tmux gate: the gate row, the "Turn On" -> open-accessibility-settings
 * wiring, the gate poll that reads /api/a11y-status, and the Settings-side ground
 * truth (unchanged). The old standalone-step assertions (fr-a11y-open, frPollA11y,
 * FR_STEPS=7, the eyebrow map) are gone with the screen they tested.
 *
 *   node --test web.firstrun-a11y-1214.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* The S3 Automation pane, sliced by the two panes that bracket it in file order:
   S3 is fr-pane-3, and S4 (Notifications) is fr-pane-4. */
const S3 = PAGE.slice(PAGE.indexOf('id="fr-pane-3"'), PAGE.indexOf('id="fr-pane-4"'));

test('install-flow-9screen: the tmux/Accessibility concern is the S3 gate, with a sleep gate beside it', () => {
  assert.ok(S3.indexOf('id="fr-pane-3"') > -1 && S3.length > 0, 'the S3 Automation pane exists');
  assert.match(S3, /data-gate="tmux"/, 'S3 carries the tmux permission gate row');
  assert.match(S3, /data-gate="sleep"/, 'S3 carries the sleep permission gate row beside it');
  // Each gate row has a "Turn On" button and Mona's THREE-state pill contract (#2085):
  // Not activated (red, + Turn On) / Checking... (neutral, no button) / Activated (green).
  assert.match(S3, /class="s3-on"[^>]*>Turn On</, 'the gate rows carry a Turn On button');
  assert.match(S3, /s3-pill-req">Not activated</, 'the not-granted pill reads "Not activated" (#2085 fold of "Needs Activated")');
  assert.doesNotMatch(S3, /Needs Activated/, 'the old "Needs Activated" copy is gone (#2085)');
  assert.match(S3, /s3-pill-wait">Checking/, 'the cannot-check pill reads "Checking..." (#2085 neutral 3rd state)');
  assert.match(S3, /s3-pill-ok">&#10003; Activated</, 'the granted pill reads "✓ Activated"');
});

test('install-flow-9screen: the gate poll reads /api/a11y-status for the tmux grant (fail-safe, positive-only)', () => {
  // FR_GATES maps the tmux gate to the Accessibility status endpoint; a row is
  // granted only on a measured trusted:true. Each gate now owns a granted(r) and a
  // blocked(r) predicate (kosmos#2347): tmux/sleep are pure reads (checkable+grant),
  // so the regexes tolerate the checkable-gating prefix and the added blocked line
  // while still pinning the endpoint + grant condition.
  assert.match(PAGE, /'tmux':\s*\{[\s\S]*?url:\s*'\/api\/a11y-status',[\s\S]*?granted:\s*\(r\)\s*=>[\s\S]*?r\.trusted === true/,
    'the tmux gate reads /api/a11y-status and grants only on trusted:true');
  // And the sleep gate reads its own status endpoint.
  assert.match(PAGE, /'sleep':\s*\{[\s\S]*?url:\s*'\/api\/sleep-status',[\s\S]*?granted:\s*\(r\)\s*=>[\s\S]*?r\.prevented === true/,
    'the sleep gate reads /api/sleep-status and grants only on prevented:true');
  // file-access reads its status endpoint and BLOCKS on the prompt-free presence
  // signal (nativePresent && !granted), because reading it fires the TCC prompt so
  // there is no entry-time verdict (kosmos#2347). This is the S2 gate.
  assert.match(PAGE, /'file-access':\s*\{[\s\S]*?url:\s*'\/api\/file-access-status',[\s\S]*?blocked:\s*\(r\)\s*=>[\s\S]*?r\.nativePresent === true && r\.granted !== true/,
    'the file-access gate reads /api/file-access-status and blocks on nativePresent && !granted');
});

test('#1: S3 Turn On FIRES the native prompt (tmux -> a11y-prompt), falling back to open-settings', () => {
  // #1 (Josh 0.6.39): the tmux "Turn On" must fire the real Accessibility PROMPT via
  // Kitty's /api/a11y-prompt trigger (which also injects tmux into the list so it is
  // grantable), not merely open Settings. It falls back to open-accessibility-settings
  // when the native trigger is unavailable. sleep is programmatic (pmset), not a prompt,
  // so it keeps opening Energy settings (no trigger).
  const handler = PAGE.slice(PAGE.indexOf("getElementById('fr-pane-3').addEventListener"),
    PAGE.indexOf("getElementById('fr-pane-3').addEventListener") + 1200);
  assert.match(handler, /\/api\/a11y-prompt/,
    'the tmux Turn On fires the native a11y-prompt trigger (#1)');
  assert.match(handler, /\/api\/open-accessibility-settings/,
    'the tmux Turn On falls back to open-accessibility-settings');
  assert.match(handler, /\/api\/open-sleep-settings/,
    'the sleep Turn On POSTs the open-sleep-settings endpoint (no prompt, programmatic)');
  // And the Settings accessibility button still exists and uses the same endpoint
  // (the source of truth).
  assert.match(PAGE, /getElementById\('set-a11y-open'\)[\s\S]{0,400}\/api\/open-accessibility-settings/,
    'the Settings button is unchanged and shares the endpoint');
});

test('install-flow-9screen: the S3 Continue/Next is GATED -- unlocks only when both gates are granted', () => {
  const SCRIPT = PAGE.slice(PAGE.indexOf('<script'), PAGE.lastIndexOf('</script>'));
  const step3 = SCRIPT.slice(SCRIPT.indexOf('} else if (step === 3) {'), SCRIPT.indexOf('} else if (step === 4) {'));
  assert.match(step3, /frActions\(\{ label: 'Next', go: \(\) => \{ if \(document\.getElementById\('fr-next'\)\.disabled\) return; frGo\(4\); \} \}\)/,
    'the S3 Next is gated: it proceeds to S4 only when the check has not disabled it');
  assert.match(step3, /frGateStart\(pane\)/,
    'S3 starts the permission-gate poll (frGateStart), which drives the disabled state');
});

test('kosmos#1214: the Settings accessibility box name is stable ground truth', () => {
  // The Settings side is unchanged: the accessibility toggle still sits under the
  // "Keeping agents running" box. This stays the ground truth for where you turn it
  // on later.
  const btnIdx = PAGE.indexOf('id="set-a11y-open"');
  assert.ok(btnIdx > -1, 'the Settings accessibility button exists');
  const before = PAGE.slice(0, btnIdx);
  const hIdx = before.lastIndexOf('<h3 class="dlab"');
  assert.ok(hIdx > -1, 'the button sits under a labelled Settings box');
  const boxLabel = PAGE.slice(hIdx).match(/<h3 class="dlab"[^>]*>([^<]+)<\/h3>/)[1].trim();
  assert.equal(boxLabel, 'Keeping agents running',
    'sanity: the box holding the accessibility button is "Keeping agents running"');
});

test('kosmos#1214: no em dashes in the S3 gate copy (house rule)', () => {
  for (const spelling of ['—', '&mdash;', '&#8212;', '&#x2014;', '\\u{2014}']) {
    assert.ok(!S3.includes(spelling), 'an em dash (' + spelling + ') reached the S3 copy');
  }
});
