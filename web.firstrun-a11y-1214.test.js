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

test('#2451: the /api/a11y-status route serves Kosmos.app trust (a11ystatus.read), not tmuxGrant', () => {
  // The gate bug was the ROUTE wiring, not the web layer: serving tmuxGrant() (tmux's
  // path-keyed TCC row, the WRONG subject) returns checkable:false on a normal box, so
  // the pill sticks on "Checking..." and the fail-safe leaves Next enabled (Josh's
  // #2451 symptom). Accessibility is keyed on the CALLING binary, so read() (the
  // native app's own AXIsProcessTrusted = Kosmos.app, the binary the onboarding
  // registers) is the correct subject. Pin the route to read() and away from tmuxGrant.
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const start = SERVER.indexOf("pathname === '/api/a11y-status'");
  assert.ok(start > -1, 'the /api/a11y-status route exists');
  // Slice the WHOLE handler (to the next route's `if (pathname ===`) and STRIP block
  // comments before asserting: the route comment names both read() and tmuxGrant() in
  // prose, so matching the raw slice greps the COPY, not the code, and cannot fail when
  // the bug is reintroduced (a-check-containing-a-copy-cannot-fail). Anchor on the
  // ASSIGNMENT statement (`reading = a11ystatus.X()`), which the comment never contains,
  // so reintroducing tmuxGrant in the code reds this test.
  const nextRoute = SERVER.indexOf('if (pathname ===', start + 1);
  const code = SERVER.slice(start, nextRoute > -1 ? nextRoute : start + 3000).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /reading\s*=\s*a11ystatus\.read\(\)/, 'the a11y-status route serves a11ystatus.read() (Kosmos.app trust)');
  assert.doesNotMatch(code, /a11ystatus\.tmuxGrant\(/, 'the a11y-status route no longer serves tmuxGrant() (the wrong subject)');
});

test('#2451: the S3 Automation gate names Kosmos, not tmux (the binary macOS shows + grants)', () => {
  // Josh sees "Kosmos" in the Accessibility list (the onboarding "Turn On" registers
  // the kosmos-app), so the gate row label, the mock Accessibility window row, and the
  // step caption must read "Kosmos". The internal data-gate="tmux" key stays (selector
  // for FR_GATES / the Turn On handler / render-gated-next), so this pins the VISIBLE
  // copy, not the attribute.
  assert.match(S3, /<span class="s3-gate-lbl">Kosmos<\/span>/, 'the a11y gate row label reads "Kosmos"');
  assert.match(S3, /<span class="s3-mtxt">Kosmos<small>Control your computer<\/small>/, 'the mock Accessibility row names Kosmos');
  assert.match(S3, /switch Kosmos to On/, 'the step caption says "switch Kosmos to On"');
  assert.doesNotMatch(S3, /<span class="s3-gate-lbl">TMUX<\/span>/, 'the old "TMUX" visible label is gone');
  assert.doesNotMatch(S3, /<span class="s3-mtxt">tmux<small>/, 'the old "tmux" mock row is gone');
  assert.doesNotMatch(S3, /switch TMUX to On/, 'the old "switch TMUX to On" caption is gone');
});

test('#1: S3 Turn On FIRES the native prompt (tmux -> a11y-prompt), falling back to open-settings', () => {
  // #1 (Josh 0.6.39): the tmux "Turn On" must fire the real Accessibility PROMPT via
  // Kitty's /api/a11y-prompt trigger (which also injects tmux into the list so it is
  // grantable), not merely open Settings. It falls back to open-accessibility-settings
  // when the native trigger is unavailable. sleep is programmatic (pmset), not a prompt,
  // so it keeps opening Energy settings (no trigger).
  // Bound the slice to the handler's OWN closing `});` (a column-0 `\n});`, since it is a
  // top-level statement) rather than a fixed char offset -- a fixed window silently breaks
  // when the handler grows or shrinks (e.g. #2648 REMOVED the in-pane .fr-recheck branch that
  // used to sit at its top; a dynamic bound tracks that with no edit here).
  const h1s = PAGE.indexOf("getElementById('fr-pane-3').addEventListener");
  const handler = PAGE.slice(h1s, PAGE.indexOf('\n});', h1s));
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
  // #2648 made this a two-arg frActions (a "Check again" alt was added), so match the gated
  // primary itself rather than the whole single-arg call: the disabled-check is the gate.
  assert.match(step3, /label: 'Next', go: \(\) => \{ if \(document\.getElementById\('fr-next'\)\.disabled\) return; frGo\(4\); \}/,
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
  const EM_DASH_SPELLINGS = ['—', '&mdash;', '&#8212;', '&#x2014;', '\\u{2014}'];
  for (const spelling of EM_DASH_SPELLINGS) {
    assert.ok(!S3.includes(spelling), 'an em dash (' + spelling + ') reached the S3 copy');
  }
  // #2648: the recheck copy ('Check again' + its hint) moved OUT of the S3 pane slice above
  // and into the step-3 frActions call, so the S3 scan no longer covers it. Guard the moved
  // user-facing strings here too, or a future edit to the nav-alt label/hint could ship an em
  // dash uncaught (org rule: ask which surfaces have NO guard, not just where the defect is).
  const s3blk = PAGE.slice(PAGE.indexOf('} else if (step === 3) {'), PAGE.indexOf('} else if (step === 4) {'));
  const movedCopy = [...s3blk.matchAll(/\b(?:label|hint):\s*'([^']*)'/g)].map((m) => m[1]).join(' ');
  assert.ok(movedCopy.length > 0, 'sanity: found the step-3 frActions label/hint copy to guard (guard is not vacuous)');
  for (const spelling of EM_DASH_SPELLINGS) {
    assert.ok(!movedCopy.includes(spelling), 'an em dash (' + spelling + ') reached the step-3 nav-alt copy');
  }
});

test('#2451/#2559 + #2648: S3 "Check again" is the far-left nav alt (moved out of the pane body), with its shortened hint, wired to an immediate gate re-check', () => {
  // Josh's screen "sat here forever" after he granted -- the poll was 1500ms and there was
  // no way to force it (#2451/#2559). #2648: the in-pane Check-again button sat under the
  // rows, below the fold on first load, so the person could not see it when they needed it;
  // it moved into the bottom nav (far-left #fr-alt), which is always visible, carrying a
  // shortened hint. These assert the NEW placement + wiring and are red-capable on the old
  // in-pane design.

  // It is NO LONGER an in-pane button, and the reassurance note is deleted (#2648 item 4).
  assert.ok(!/class="s3-recheck fr-recheck"[^>]*>Check again</.test(S3),
    'the in-pane .s3-recheck "Check again" button is gone from S3 (moved to the nav)');
  assert.ok(!S3.includes('This can take a few seconds after you flip the switch'),
    'the old "this can take a few seconds" reassurance note is deleted (#2648 item 4)');

  // The footer carries the optional hint span, and frActions drives it from alt.hint.
  assert.match(PAGE, /id="fr-alt-hint"/, 'the footer has the #fr-alt-hint span (#2648)');
  const fa = PAGE.indexOf('function frActions(');
  const faBody = PAGE.slice(fa, PAGE.indexOf('// install-flow-9screen', fa));
  assert.match(faBody, /a\.hint/, 'frActions renders an alt.hint into the footer hint span');

  // Step 3 renders the "Check again" alt with the shortened hint, wired to frRecheckGates.
  const s3s = PAGE.indexOf('} else if (step === 3) {');
  const s3block = PAGE.slice(s3s, PAGE.indexOf('} else if (step === 4) {', s3s));
  assert.match(s3block, /label:\s*'Check again'/, 'step 3 renders a "Check again" nav alt');
  assert.match(s3block, /hint:\s*'Turned it on\? Tap to check\.'/,
    'the Check again alt carries the shortened hint (#2648 item 3)');
  assert.match(s3block, /frRecheckGates\(\)/,
    'the step-3 "Check again" alt fires an immediate frRecheckGates()');

  // The poll interval is a named constant, faster than the old 1500ms (unchanged by #2648).
  const m = PAGE.match(/const FR_GATE_POLL_MS = (\d+);/);
  assert.ok(m, 'FR_GATE_POLL_MS is a named constant');
  assert.ok(Number(m[1]) < 1500, `the gate poll is faster than the old 1500ms (got ${m[1]})`);
  assert.match(PAGE, /setInterval\(\(\) => frPollGates\(screenEl, gen\), FR_GATE_POLL_MS\)/,
    'the poll timer uses the FR_GATE_POLL_MS constant (not a hardcoded interval)');
  // frRecheckGates itself re-polls the active gated screen (unchanged).
  const frcs = PAGE.indexOf('function frRecheckGates()');
  const frcBody = PAGE.slice(frcs, PAGE.indexOf('\n}', frcs));
  assert.match(frcBody, /frPollGates\(FR_GATE_SCREEN, FR_GATE_GEN\)/,
    'frRecheckGates re-polls the active gated screen at the current generation');
});

test('#2587: the sleep step is ADVISORY (never gates Next); Accessibility still gates; the honest laptop note stays', () => {
  // Josh's ruling: a laptop that sleeps on battery cannot satisfy the sleep permission
  // (macOS has no never-sleep-on-battery switch), so the step must not wall the user in.
  // The sleep row never disables Next; Accessibility/file-access still gate (they are
  // satisfiable + required). The honest note replaces the useless Turn On on the laptop
  // (battOnly) case only. There is no "Continue anyway" button -- Next just works.

  // 1. sleep is marked non-gating (gatesNext:false), keeps its battOnly predicate, and is
  //    the ONLY advisory gate (tmux/file-access must still gate).
  const frSleep = PAGE.slice(PAGE.indexOf("'sleep': {"), PAGE.indexOf("'tmux': {"));
  assert.ok(frSleep.length > 0 && frSleep.length < 1100, 'the FR_GATES.sleep block was not bounded (markers moved)');
  assert.match(frSleep, /gatesNext:\s*false/, 'FR_GATES.sleep is not marked gatesNext:false, so it would still gate Next');
  assert.match(frSleep, /battOnly:\s*\(r\)\s*=>\s*r\.battOnly === true/, 'FR_GATES.sleep lost its battOnly predicate');
  const frGatesStart = PAGE.indexOf('const FR_GATES = {');
  const frGatesBlock = PAGE.slice(frGatesStart, PAGE.indexOf('\n};', frGatesStart));
  assert.equal((frGatesBlock.match(/gatesNext:\s*false/g) || []).length, 1,
    'exactly one gate (sleep) may be advisory; the Accessibility/tmux gate must still gate Next');

  // 2. frReadGate surfaces battOnly alongside the state (for the note).
  const frs = PAGE.indexOf('async function frReadGate(');
  const frBody = PAGE.slice(frs, PAGE.indexOf('\n}', frs));
  assert.match(frBody, /battOnly\s*=\s*spec\.battOnly\s*\?\s*spec\.battOnly\(r\) === true/, 'frReadGate does not read the battOnly flag');

  // 3. frPollGates: a blocked row gates Next ONLY when its spec is not gatesNext:false, so a
  //    blocked sleep row never disables Next. data-battonly is set for the note; data-granted
  //    only on the granted state. The old data-continued override is gone.
  const fps = PAGE.indexOf('async function frPollGates(');
  const fpBody = PAGE.slice(fps, PAGE.indexOf('\n}', fps));
  assert.match(fpBody, /st === 'blocked' && !\(spec && spec\.gatesNext === false\)\)\s*anyBlocked = true/,
    'frPollGates still lets an advisory (gatesNext:false) row block Next');
  assert.match(fpBody, /reads\[i\]\.battOnly && st === 'blocked'\)\s*row\.setAttribute\('data-battonly'/,
    'frPollGates does not mark the battOnly row with data-battonly (for the note)');
  assert.match(fpBody, /if \(st === 'granted'\) \{ row\.setAttribute\('data-granted'/, 'data-granted must be set only on the granted state');
  assert.doesNotMatch(fpBody, /data-continued/, 'a stale data-continued override survives in frPollGates');

  // 4. The sleep row markup: the honest note stays; the Continue button + caveat pill are GONE.
  const sleepStart = S3.indexOf('s3-gate-row" data-gate="sleep"');
  const tmuxStart = S3.indexOf('s3-gate-row" data-gate="tmux"');
  assert.ok(sleepStart > -1 && tmuxStart > sleepStart, 'the sleep/tmux gate row markup markers were not found in order');
  const sleepRow = S3.slice(sleepStart, tmuxStart);
  assert.match(sleepRow, /class="s3-battonly-note">Your agents keep working while this computer is plugged in and open/,
    'the honest laptop note (Mona copy) is missing or altered');
  assert.doesNotMatch(sleepRow, /s3-continue|Continue anyway|s3-continued-pill/,
    'the Continue-anyway button / caveat pill must be gone -- the step no longer gates Next, so there is nothing to click past');

  // 5. The pane handler has no .s3-continue branch any more.
  const hs = PAGE.indexOf("getElementById('fr-pane-3').addEventListener");
  const handler = PAGE.slice(hs, PAGE.indexOf('\n});', hs));
  assert.doesNotMatch(handler, /closest\('\.s3-continue'\)/, 'a stale .s3-continue handler branch survives');

  // 6. CSS: data-battonly still hides the useless Turn On and shows the note; no stale escape CSS.
  assert.match(S3, /\.s3-gate-row\[data-battonly\] \.s3-req\{display:none\}/, 'the battOnly state does not hide the useless Turn On');
  assert.match(S3, /\.s3-gate-row\[data-battonly\] \.s3-battonly\{display:flex/, 'the battOnly note is not shown when data-battonly is set');
  assert.doesNotMatch(S3, /s3-continued-pill|s3-continue\{|data-continued/, 'stale escape CSS (continue button / caveat pill / data-continued) survives');
});
