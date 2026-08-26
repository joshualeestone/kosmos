"use strict";
/**
 * #867 (Josh, 2026-08-25 15:09 and 15:20, live-testing a fresh install):
 * "Totally dead stopped on this screen... Is it possible to put a progress
 * bar on this along with the animated K", and then, once the cause (a
 * shared-port collision with another macOS account's Kosmos) was in view:
 * "we should put a link to go ahead and open Kosmos."
 *
 * install/pkg-scripts/installing.html is the page opened while the .pkg
 * installer runs (install/pkg-scripts/postinstall templates __KOSMOS_PORT__
 * into it and opens it via a LaunchAgent). It had a spinner for the
 * ordinary wait, but its "taken" branch (something already answering on
 * the very first poll) hid every visual and left static text -- correct
 * about the cause, dead-looking regardless.
 *
 *   node --test install.installing-page.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, 'install', 'pkg-scripts', 'installing.html'), 'utf8');

test('the mark is the real K loader canvas, and the progress bar exists, both always in the markup', () => {
  // #892/#893 shipped a static badge; #905 (Josh, 2026-08-26, seeing it
  // live: "let's put our animated K that turns into a circle there")
  // replaced it with the same 155-dot canvas loader the create-an-agent
  // screen uses. Same dimensions, so the badge reads as one identity.
  assert.match(HTML, /<canvas class="mark" id="mark" width="132" height="154" aria-hidden="true"><\/canvas>/, 'the K loader canvas is gone');
  assert.match(HTML, /<div class="bar" id="bar" role="progressbar" aria-label="Installing"><i><\/i><\/div>/, 'the progress bar is gone');
  // Neither carries its own display:none the way #late/#taken do -- they
  // are meant to be visible from the very first paint.
  assert.doesNotMatch(HTML, /\.mark\s*{[^}]*display:\s*none/, 'the mark starts hidden');
  assert.doesNotMatch(HTML, /#bar\s*{[^}]*display:\s*none/, 'the bar starts hidden');
  // The ported loader itself: pinned by name and by its two distinctive
  // data arrays, not by re-checking its internal math line for line here
  // (that risk belongs to the source file's own tests).
  assert.match(HTML, /function startKLoader\(cv\) \{/, 'the ported K loader function is gone');
  assert.match(HTML, /var K_LOAD = \[/, 'the K loader lost its dot data');
  assert.match(HTML, /var CHECK_LOAD = \[/, 'the loader lost the finish/tick data it keeps for fidelity with the source');
});

test('settling stops the K loader where it sits, and freezes the bar in place, instead of hiding either', () => {
  assert.match(HTML, /function settle\(\)\{/, 'the settle() function is gone');
  const at = HTML.indexOf('function settle(){');
  const fn = HTML.slice(at, HTML.indexOf('}', at) + 1);
  assert.match(fn, /loader\.stop\(\)/, 'settle() no longer stops the K loader');
  assert.match(fn, /bar.*classList\.add\("settled"\)/, 'settle() no longer freezes the bar');
  assert.doesNotMatch(fn, /display\s*=\s*"none"/, 'settle() hides an element instead of freezing it in place');
  // Called on BOTH conclusions: the taken branch, and the real ready-to-open path.
  const onload = HTML.slice(HTML.indexOf('img.onload = function(){'), HTML.indexOf('img.onerror'));
  assert.equal((onload.match(/settle\(\);/g) || []).length, 2, 'settle() is not called on both the taken branch and the ready branch');
});

test('the loader never finishes into a checkmark on either ending -- neither is the pack\'s "clean finish"', () => {
  // The taken branch found someone else's board (not success); the real
  // ready branch calls location.replace() in the same tick settle() runs,
  // so a 900ms tick animation would never be seen. finish() stays unused.
  assert.doesNotMatch(HTML, /loader\.finish\(\)/, 'something now calls finish() -- confirm that ending is a genuine clean success before keeping this');
  assert.match(HTML, /stop: function \(\) \{ stopped = 1; \}/, 'the stop() capability this file adds on top of the ported source is gone');
});

test('a real link is offered, wired to the actual address, never auto-navigated', () => {
  assert.match(HTML, /<a class="go" id="go" href="#">Open it anyway<\/a>/, 'the taken-branch link is gone');
  assert.match(HTML, /getElementById\("go"\)\.href = base \+ "\/"/, 'the link is never pointed at the real address');
  // The refusal to auto-navigate is the actual safety property (the
  // installer's own BOARD_OURS gate makes the same call) and must survive:
  // only a real person's click reaches base+"/" in the taken branch.
  const takenBranch = HTML.slice(HTML.indexOf('if (first) {'), HTML.indexOf('return;\n      }\n      settle();'));
  assert.doesNotMatch(takenBranch, /location\.replace/, 'the taken branch navigates on its own -- the whole point was that only a click should');
});

test('the taken branch is honest that the board answering is often someone else\'s, not a rare exception', () => {
  // Angel's finding: install/kosmos's healthy() checks "is *a* Kosmos", not
  // "is MINE", so on a shared Mac this branch is the ORDINARY outcome for a
  // second macOS account, not an astronomically unlikely one. The copy must
  // say so instead of implying the link safely opens the reader's own board.
  assert.match(HTML, /often THEIRS, not yours/, 'the taken branch no longer names the common shared-Mac case');
  assert.doesNotMatch(HTML, /Open Kosmos</, 'the link still claims ownership it cannot verify');
  assert.match(HTML, /If it is not yours, close it without changing anything/, 'the safe-backout guidance for a wrong guess is gone');
  assert.match(HTML, /Your own copy of Kosmos is in Applications/, 'the Applications pointer for a wrong guess is gone');
});

test('the taken branch clears the ordinary-wait steps line so it stops contradicting the taken copy', () => {
  // Pigeon Pete, screenshotting 0.5.33/0.5.34: #steps still read "Setting
  // up. This usually takes a minute or two." directly above "Something is
  // already running" -- one sentence promising an install, the other
  // saying it never was one. #hint was already cleared on this branch;
  // #steps was not.
  const takenBranch = HTML.slice(HTML.indexOf('if (first) {'), HTML.indexOf('return;\n      }\n      settle();'));
  assert.match(takenBranch, /getElementById\("steps"\)\.textContent = ""/, 'the taken branch no longer clears the ordinary-wait steps line');
});

test('the ordinary wait keeps its own copy: unreadable time, then a slow-download note', () => {
  assert.match(HTML, /Setting up\. This usually takes a minute or two\./);
  assert.match(HTML, /Still going\. A slow download can take a few minutes/);
  assert.match(HTML, /if \(s >= 45\) document\.getElementById\("steps"\)\.textContent = "Setting up\. " \+ s \+ " seconds so far\."/);
  assert.match(HTML, /if \(s >= 180\) show\("late"\)/);
});

test('reduced motion turns off both animations, and dark mode is accounted for', () => {
  // The bar's spinner is still CSS, so it still turns off in CSS. The K
  // loader's motion is entirely canvas/JS now (startKLoader reads
  // prefers-reduced-motion itself and draws one still frame instead of
  // animating), so there is nothing left for a CSS rule to disable on
  // .mark -- pinned in the loader's own `slow` branch instead.
  assert.match(HTML, /@media \(prefers-reduced-motion:reduce\)\{\.bar>i\{animation:none\}\}/);
  assert.match(HTML, /var slow = window\.matchMedia && window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/,
    'the K loader stopped reading reduced-motion itself');
  assert.match(HTML, /if \(slow\) \{/, 'the loader lost its reduced-motion branch (one still frame instead of animating)');
  assert.match(HTML, /@media \(prefers-color-scheme:dark\)/);
});
