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
/* #2647: the shared comment stripper (#1080), so the source-shape counts below
   judge CODE rather than the prose describing it. */
const { codeOnly } = require('./test-support/code-only');
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

test('#2559/#2911: the /api/a11y-status route serves the app grant LIVE (appGrant, read() fallback), not tmuxGrant', () => {
  // #2559 re-gate: the route now PREFERS the live TCC-db read of the app's own
  // Accessibility grant (appGrant), which flips the instant the toggle does, and falls
  // back to the native-file read() only for the GRANTED signal (never strands a granted
  // user). Both are the APP subject (Accessibility is keyed on the calling binary =
  // Kosmos.app). tmux's OWN grant is a SEPARATE subject, served by /api/tmux-a11y-status
  // (#2911); this route must NOT serve tmuxGrant. Anchor on the ASSIGNMENT statements
  // (which the stripped-out comments never contain) so reintroducing tmuxGrant reds this.
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const start = SERVER.indexOf("pathname === '/api/a11y-status'");
  assert.ok(start > -1, 'the /api/a11y-status route exists');
  // Slice the WHOLE handler (to the next route's `if (pathname ===` -- now the tmux-a11y
  // route) and STRIP block comments before asserting: the route comment names appGrant,
  // read and tmuxGrant in prose, so matching the raw slice greps the COPY, not the code
  // (a-check-containing-a-copy-cannot-fail).
  const nextRoute = SERVER.indexOf('if (pathname ===', start + 1);
  const code = SERVER.slice(start, nextRoute > -1 ? nextRoute : start + 3000).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /a11ystatus\.appGrant\(\)/, 'the a11y-status route reads the live app grant (appGrant), the #2559 re-gate source');
  assert.match(code, /a11ystatus\.read\(\)/, 'and falls back to native read() for the GRANTED signal (never strands a granted user)');
  assert.doesNotMatch(code, /a11ystatus\.tmuxGrant\(/, 'the a11y-status route does NOT serve tmuxGrant() (that is the tmux-a11y route)');
});

test('#2451: the S3 Automation gate names Kosmos, not tmux (the binary macOS shows + grants)', () => {
  // Josh sees "Kosmos" in the Accessibility list (the onboarding "Turn On" registers
  // the kosmos-app), so the gate row label, the mock Accessibility window row, and the
  // step caption must read "Kosmos". The internal data-gate="tmux" key stays (selector
  // for FR_GATES / the Turn On handler / render-gated-next), so this pins the VISIBLE
  // copy, not the attribute.
  assert.match(S3, /<span class="s3-gate-lbl">Kosmos<\/span>/, 'the app a11y gate row label reads "Kosmos"');
  assert.match(S3, /<span class="s3-mtxt">Kosmos<small>Control your computer<\/small>/, 'the app mock Accessibility row names Kosmos');
  assert.match(S3, /switch Kosmos and tmux to On/, 'the combined step caption asks to switch Kosmos on (#3075 one-box: Kosmos + tmux in one caption)');
  assert.doesNotMatch(S3, /<span class="s3-gate-lbl">TMUX<\/span>/, 'the old uppercase "TMUX" mislabel of the APP row is gone (#2451)');
  assert.doesNotMatch(S3, /switch TMUX to On/, 'the old "switch TMUX to On" caption for the APP row is gone (#2451)');
  // NOTE: #2911 legitimately reintroduces a LOWERCASE "tmux" mock + label -- but for the
  // SEPARATE tmux-AX row (data-gate="tmux-a11y"), tmux's own grant, NOT a mislabel of the
  // app row. That row is pinned by the dedicated #2911 test below. The #2451 fix here is
  // only that the APP row (data-gate="tmux") reads "Kosmos", which the positive arms pin.
});

test('#1: S3 Turn On FIRES the native prompt (tmux -> a11y-prompt), falling back to open-settings', () => {
  // #1 (Josh 0.6.39): the tmux "Turn On" must fire the real Accessibility PROMPT via
  // Kitty's /api/a11y-prompt trigger (which also injects tmux into the list so it is
  // grantable), not merely open Settings. It falls back to open-accessibility-settings
  // when the native trigger is unavailable. sleep is programmatic (pmset), not a prompt,
  // so it keeps opening Energy settings (no trigger).
  // Bound the slice to the handler's OWN closing `});` (a column-0 `\n});`, since it is a
  // top-level statement) rather than a fixed char offset -- a fixed window silently breaks
  // when the handler grows (e.g. the #2451/#2559 fr-recheck branch added at its top).
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

test('#2911: S3 asks for tmux\'s OWN Accessibility grant (data-gate="tmux-a11y") and detects it via /api/tmux-a11y-status', () => {
  // Josh (6.59 QA): "add a step 3 asking for accessibility for tmux ... turn on Kosmos,
  // tmux, and accessibility." tmux holds a SEPARATE Accessibility grant from the app's;
  // this tmux ask (folded into the combined caption + one-box mock at #3075, no longer a
  // separate step-3 sub-step) still gates on tmuxGrant's live reading.

  // The row + its visible copy (a distinct row from the app "Kosmos" one).
  assert.match(S3, /data-gate="tmux-a11y"/, 'S3 carries the tmux-accessibility gate row (data-gate="tmux-a11y")');
  assert.match(S3, /class="s3-gate-row" data-gate="tmux-a11y"[\s\S]{0,120}<span class="s3-gate-lbl">tmux<\/span>/,
    'the tmux-a11y gate row label reads "tmux"');
  assert.match(S3, /<span class="s3-mtxt">tmux<small>Control your computer<\/small>/, 'the tmux mock Accessibility row names tmux');
  // #3075 one-box: the tmux ask folded into the combined "2 - switch Kosmos and tmux to On"
  // caption (asserted positively at the #2451 test above); the tmux ROW, SWITCH and GATE here
  // carry the rest. Guard the fold itself: the separate step-3 "switch tmux to On" caption must
  // NOT come back (distinct from the #2451 uppercase-"TMUX" guard, which is about a mislabel).
  assert.doesNotMatch(S3, /switch tmux to On/, 'the retired separate "3 - switch tmux to On" caption stays folded into the combined one (#3075)');
  // #3075 ONE-BOX invariant, pinned STRUCTURALLY (the other asserts here are independent and
  // would all stay green if the panel were split back into two adjacent .s3-mock windows).
  // The tempered [\s\S] refuses to cross a second `<div class="s3-mock`, so BOTH switches must
  // sit inside a SINGLE mock for this to match; a two-mock regression breaks it.
  assert.match(
    S3,
    /<div class="s3-mock" data-win-hide>(?:(?!<div class="s3-mock")[\s\S])*?data-sw-gate="tmux"(?:(?!<div class="s3-mock")[\s\S])*?data-sw-gate="tmux-a11y"/,
    'both the Kosmos and tmux switches sit inside ONE .s3-mock (the #3075 one-box Accessibility panel)',
  );

  // FR_GATES routes it to the tmux-a11y status endpoint, granting only on trusted:true.
  assert.match(PAGE, /'tmux-a11y':\s*\{[\s\S]*?url:\s*'\/api\/tmux-a11y-status',[\s\S]*?granted:\s*\(r\)\s*=>[\s\S]*?r\.trusted === true/,
    'the tmux-a11y gate reads /api/tmux-a11y-status and grants only on trusted:true');

  // The route serves tmuxGrant() and maps present:false -> advisory (never a trap).
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const rstart = SERVER.indexOf("pathname === '/api/tmux-a11y-status'");
  assert.ok(rstart > -1, 'the /api/tmux-a11y-status route exists');
  const rnext = SERVER.indexOf('if (pathname ===', rstart + 1);
  const rcode = SERVER.slice(rstart, rnext > -1 ? rnext : rstart + 2000).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(rcode, /a11ystatus\.tmuxGrant\(\)/, 'the tmux-a11y route serves tmuxGrant()');
  assert.match(rcode, /present === false/, 'the route maps present:false (tmux not yet listed) to a non-blocking reading (never a trap, #2912)');

  // #3113: the Turn On for the tmux row now FIRES the tmux registration prompt
  // (/api/tmux-a11y-prompt) AND falls back to opening the Accessibility pane (shared with the
  // app row). The native trigger is what lets tmux acquire its OWN Accessibility TCC row, so
  // the row can leave the not-yet-listed "Checking..." state and offer a real Turn On. This
  // row had no trigger before #3113 (it sat stuck on "Checking..." with no affordance).
  const hs = PAGE.indexOf("getElementById('fr-pane-3').addEventListener");
  const handler = PAGE.slice(hs, PAGE.indexOf('\n});', hs));
  assert.match(handler, /gate === 'tmux-a11y'\s*\?\s*'\/api\/tmux-a11y-prompt'/,
    'the tmux-a11y Turn On fires the native tmux-a11y-prompt trigger (#3113)');
  assert.match(handler, /gate === 'tmux' \|\| gate === 'tmux-a11y'\)\s*\?\s*'\/api\/open-accessibility-settings'/,
    'the tmux-a11y Turn On falls back to opening the Accessibility pane (shared with the app row)');
});

test('#3113: the not-yet-listed tmux row is ACTIONABLE (Not activated + Turn On), never a dead "Checking..."', () => {
  // Josh's screenshot: the tmux row sat forever on "Checking..." with no affordance because
  // tmuxGrant reports present:false (tmux not yet in Accessibility) and the route mapped that to
  // a plain uncheckable reading. The fix keeps it NON-BLOCKING (the #2912 fail-safe) but flags
  // it actionable, so the poll paints the DEFAULT "Not activated" + Turn On state instead of the
  // spinner. Three layers pin this end to end:

  // (1) The route flags the present:false verdict actionable (and keeps it non-blocking).
  const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const rstart = SERVER.indexOf("pathname === '/api/tmux-a11y-status'");
  const rnext = SERVER.indexOf('if (pathname ===', rstart + 1);
  const rcode = SERVER.slice(rstart, rnext > -1 ? rnext : rstart + 2000).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(rcode, /present === false[\s\S]*?actionable:\s*true/,
    'the present:false (tmux not yet listed) verdict is flagged actionable:true');
  assert.match(rcode, /present === false[\s\S]*?checkable:\s*false/,
    'and it stays checkable:false (non-blocking -- the #2912 no-trap invariant is intact)');

  // (2) frReadGate carries the actionable flag off the reading (only for the uncheckable state).
  const rg = PAGE.indexOf('async function frReadGate(');
  const rgbody = PAGE.slice(rg, PAGE.indexOf('\n}', rg));
  assert.match(rgbody, /actionable\s*=\s*r\.actionable === true/,
    'frReadGate reads r.actionable off the reading');
  assert.match(rgbody, /state:\s*'uncheckable',\s*battOnly,\s*actionable/,
    'and returns it on the uncheckable branch (where it matters)');

  // (3) frPollGates paints an actionable-uncheckable row as the DEFAULT (Turn On) state -- NOT
  // data-checking -- and still does not gate Next (only 'blocked' sets anyBlocked).
  const pg = PAGE.indexOf('async function frPollGates(');
  const pgbody = PAGE.slice(pg, PAGE.indexOf('\n}', pg));
  assert.match(pgbody, /st === 'uncheckable' && !reads\[i\]\.actionable/,
    "an actionable-uncheckable row is NOT painted 'Checking...' (falls through to the default Turn On state)");
  assert.match(pgbody, /if \(st === 'blocked' && !\(spec && spec\.gatesNext === false\)\) anyBlocked = true;/,
    'only a definite blocked reading gates Next -- an actionable-uncheckable row never blocks (#2912 fail-safe)');
});

test('install-flow-9screen: the S3 Next go() guard reads fr-next.disabled and drives off the gate poll', () => {
  // #2559/#2911: S3's Next HARD-gates on the accessibility grants again (re-gated). The
  // go() GUARD (`if fr-next.disabled return`) is the defensive mechanism that actually
  // enforces it, and frGateStart drives the disabled state from the live poll. The
  // re-gate is trap-free not because nothing gates, but because the readings are LIVE and
  // FAIL-SAFE (uncheckable never blocks) -- pinned in the #2559/#2911 gating test below.
  const SCRIPT = PAGE.slice(PAGE.indexOf('<script'), PAGE.lastIndexOf('</script>'));
  const step3 = SCRIPT.slice(SCRIPT.indexOf('} else if (step === 3) {'), SCRIPT.indexOf('} else if (step === 4) {'));
  /* #2647: this asserted the ENTIRE frActions call as one literal line, so adding
     the Check-again alt reddened it on formatting rather than on meaning. The
     mechanism is the go() guard, asserted directly below. */
  assert.match(step3, /label: 'Next'/,
    "the S3 primary is no longer labelled 'Next'");
  /* win32-board-copy: the hop is frStepAfter(3), which is S4 (Notifications) on a Mac and,
     since #3112 walks the display order, S6 on Windows (Access(2) + Notifications(4) are
     macOS-only, so on Windows S3's next is pane 6); the go() guard this pins is unchanged. */
  assert.match(step3, /if \(document\.getElementById\('fr-next'\)\.disabled\) return; frGo\(frStepAfter\(3\)\);/,
    'the S3 Next go() still reads fr-next.disabled before advancing (the guard mechanism is intact)');
  /* #2647: and the Check-again control rides the nav's alt slot from here, which
     is the ONLY thing wiring it up: the old in-pane handler was delegated on
     #fr-pane-3 and #fr-alt sits outside every pane, so losing this argument
     leaves a button that renders and silently does nothing. */
  assert.match(step3, /label: 'Check again'/,
    'S3 no longer supplies the nav Check-again control (#2647)');
  assert.match(step3, /hint: 'Turned it on\? Tap to check\.'/,
    'S3 no longer supplies the Check-again hint copy (#2647)');
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

test('#2451/#2559 (7.58.24): S3 has a manual "Check again" button that fires an immediate gate re-check', () => {
  // Josh's screen "sat here forever" after he granted -- the poll was 1500ms and there
  // was no way to force it. Assert: a Check-again button in the S3 pane; a faster poll
  // interval than the old 1500ms; and the button wired to an immediate re-poll.
  /* 🛑 #2647 MOVED THIS CONTROL OUT OF THE PANE, so the three assertions that
     used to live here (an in-pane .s3-recheck button, the reassurance note, and
     the old hint copy) now assert the OPPOSITE, plus the new home. Josh could
     not see any of it before finishing the connection; the nav is always
     visible. The strength is kept, not traded away: the negative arms below
     would catch a re-added in-pane control, which is the realistic regression
     (a "restore the button" change that leaves two of them). */
  /* ⚠️ Asserted on the CONSTRUCT (a class attribute), not on the substring. The
     first version of this arm was `doesNotMatch(S3, /s3-recheck|fr-recheck/)`
     and it reddened on the COMMENTS left behind explaining the removal, which
     name those classes in prose. A substring cannot tell markup from a sentence
     about markup; `class="..."` can. */
  assert.doesNotMatch(S3, /class="[^"]*recheck/,
    'S3 still carries an in-pane Check-again control; #2647 moved it to the bottom nav, and two of '
    + 'them means the invisible one Josh complained about is back');
  assert.doesNotMatch(S3, /This can take a few seconds after you flip the switch/,
    'the reassurance line #2647 deleted is still rendered');
  assert.doesNotMatch(S3, /Turned it on already\? Tap to check now/,
    'the old long hint copy is still there; #2647 shortened it and moved it to the nav');
  // Its new home: the shared nav's far-left slot, with a hint span beside it.
  assert.match(PAGE, /id="fr-alt-hint"/,
    'the nav has no hint slot for the far-left secondary action (#2647)');
  // The poll interval is a named constant, faster than the old 1500ms.
  const m = PAGE.match(/const FR_GATE_POLL_MS = (\d+);/);
  assert.ok(m, 'FR_GATE_POLL_MS is a named constant');
  assert.ok(Number(m[1]) < 1500, `the gate poll is faster than the old 1500ms (got ${m[1]})`);
  assert.match(PAGE, /setInterval\(\(\) => frPollGates\(screenEl, gen\), FR_GATE_POLL_MS\)/,
    'the poll timer uses the FR_GATE_POLL_MS constant (not a hardcoded interval)');
  // The fr-recheck click fires an immediate re-poll of the active gated screen.
  // Bound the match to frRecheckGates's OWN body (to its closing `\n}`), not a lazy
  // scan across the whole 2MB file -- otherwise a stray later mention could false-pass.
  const frcs = PAGE.indexOf('function frRecheckGates()');
  const frcBody = PAGE.slice(frcs, PAGE.indexOf('\n}', frcs));
  assert.match(frcBody, /frPollGates\(FR_GATE_SCREEN, FR_GATE_GEN\)/,
    'frRecheckGates re-polls the active gated screen at the current generation');
  /* 🛑 THE WIRING ARM, REPOINTED RATHER THAN DROPPED, and it is the one that
     matters most on this card. The old assertion checked that the #fr-pane-3
     delegate routed a .fr-recheck click to frRecheckGates. That delegate can no
     longer see the control: #fr-alt lives in .fr-acts, OUTSIDE every pane. So a
     "move" done by relocating the class alone yields a button that renders,
     styles and focuses correctly and silently does nothing.
     ⇒ Assert the replacement chain end to end: step 3's alt.go calls
     frRecheckPress, and frRecheckPress calls frRecheckGates. Bounded to each
     function's own body so a stray later mention cannot false-pass. */
  const s3s = PAGE.indexOf('} else if (step === 3) {');
  const s3block = PAGE.slice(s3s, PAGE.indexOf('} else if (step === 4) {', s3s));
  assert.match(s3block, /go: \(e\) => frRecheckPress\(/,
    "step 3's nav Check-again is not wired to frRecheckPress, so pressing it does nothing");
  const prs = PAGE.indexOf('async function frRecheckPress(');
  assert.notEqual(prs, -1, 'frRecheckPress is gone; re-anchor this test');
  const prBody = PAGE.slice(prs, PAGE.indexOf('\n}', prs));
  assert.match(prBody, /await frRecheckGates\(\)/,
    'frRecheckPress does not actually re-check the gates');
  /* And it must still refuse to clobber an unread error on the shared status
     line, which is the subtle half that a retyped copy would have lost. */
  /* 🛑 COUNTED, NOT MATCHED, because the subtle half is that the error state is
     re-read TWICE: once before the await and once after, since a "Turn On"
     failure can land DURING it while both controls are live. A single substring
     hit cannot tell "read twice" from "read once", so the previous
     `assert.match(prBody, /fr-msg-err/)` was satisfied by a body that had lost
     the post-await re-read entirely, which is precisely the half a retyped copy
     drops. Verified: the one-hit form matches that mutant. */
  /* ⚠️ COUNTED ON CODE, NOT ON SOURCE. A raw count over the function body
     includes its COMMENTS, so a future line merely MENTIONING `fr-msg-err` in
     prose (entirely harmless, and this file's house style is comment-heavy)
     pushes it to 3 and reds an assertion about behaviour on a documentation
     edit. Measured: one added comment mention takes the raw count 2 -> 3 while
     codeOnly stays at 2.
     🔑 `codeOnly` is the shared, both-directions-tested stripper (#1080). This is
     the THIRD assertion on today's work to have reddened, or been about to
     redden, on prose rather than on code; the tool for it already exists. */
  assert.equal((codeOnly(prBody).match(/fr-msg-err/g) || []).length, 2,
    'frRecheckPress must read the shared #fr-s3-msg error state BOTH before and after the await; '
    + 'losing the post-await re-read silently wipes an error the person has not read');
});

test('#2587/#2559/#2911: only sleep is advisory; the accessibility gates block Next; the honest laptop note stays', () => {
  // #2587: a laptop that sleeps on battery cannot satisfy the sleep permission (macOS has
  // no never-sleep-on-battery switch), so that step never walls the user in -- sleep is
  // ADVISORY.
  // #2559/#2911 (Josh 2026-09-14): the accessibility rows are RE-GATED. The app grant
  // (data-gate="tmux") and tmux's own grant (data-gate="tmux-a11y") both BLOCK Next when
  // measured-not-granted. #2912 had made the app row advisory because its native
  // AXIsProcessTrusted reading false-negatived a just-granted permission; #2559 upgraded
  // the source to a LIVE TCC-db read (appGrant / tmuxGrant) that flips the instant the
  // toggle does, so re-gating is now trap-free (uncheckable never blocks). So ONLY sleep
  // carries gatesNext:false now; the two accessibility rows gate. The sleep row still
  // shows the honest laptop note; there is no "Continue anyway" button.

  // 1. sleep is non-gating (gatesNext:false) and keeps its battOnly predicate.
  // 🔑 Judge CODE, not the comments: these blocks describe gatesNext:false in prose
  // (e.g. "GATING (no gatesNext:false)"), so a raw substring check greps the copy and
  // fails on documentation (a-check-containing-a-copy-cannot-fail). codeOnly strips it.
  const frSleep = codeOnly(PAGE.slice(PAGE.indexOf("'sleep': {"), PAGE.indexOf("'tmux': {")));
  assert.ok(frSleep.length > 0, 'the FR_GATES.sleep block was not bounded (markers moved)');
  assert.match(frSleep, /gatesNext:\s*false/, 'FR_GATES.sleep is not marked gatesNext:false, so it would still gate Next');
  assert.match(frSleep, /battOnly:\s*\(r\)\s*=>\s*r\.battOnly === true/, 'FR_GATES.sleep lost its battOnly predicate');
  // 1b. the accessibility rows GATE now (#2559/#2911): neither carries gatesNext:false.
  //     Bound each block to the NEXT key so the slice does not run past into a sibling.
  const frTmux = codeOnly(PAGE.slice(PAGE.indexOf("'tmux': {"), PAGE.indexOf("'tmux-a11y': {")));
  assert.ok(frTmux.length > 0, 'the FR_GATES.tmux block was not bounded (markers moved)');
  assert.doesNotMatch(frTmux, /gatesNext:\s*false/, 'FR_GATES.tmux (app accessibility) must GATE now (#2559 re-gate): no gatesNext:false');
  const frTmuxA11y = codeOnly(PAGE.slice(PAGE.indexOf("'tmux-a11y': {"), PAGE.indexOf('\n};', PAGE.indexOf("'tmux-a11y': {"))));
  assert.ok(frTmuxA11y.length > 0, 'the FR_GATES.tmux-a11y block was not bounded (markers moved)');
  assert.doesNotMatch(frTmuxA11y, /gatesNext:\s*false/, 'FR_GATES.tmux-a11y (tmux accessibility) must GATE (#2911): no gatesNext:false');
  const frGatesStart = PAGE.indexOf('const FR_GATES = {');
  const frGatesBlock = codeOnly(PAGE.slice(frGatesStart, PAGE.indexOf('\n};', frGatesStart)));
  assert.equal((frGatesBlock.match(/gatesNext:\s*false/g) || []).length, 1,
    'only sleep is advisory now (gatesNext:false); S2 file-access and both S3 accessibility rows gate');

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
    'frPollGates blocks Next on a blocked row ONLY when it is a gating row -- an advisory (gatesNext:false) row never sets anyBlocked');
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
