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

test('the mark and progress bar exist and are always in the markup, not only for the ordinary wait', () => {
  assert.match(HTML, /<div class="mark" id="mark" aria-hidden="true">K<\/div>/, 'the K mark is gone');
  assert.match(HTML, /<div class="bar" id="bar" role="progressbar" aria-label="Installing"><i><\/i><\/div>/, 'the progress bar is gone');
  // Neither carries its own display:none the way #late/#taken do -- they
  // are meant to be visible from the very first paint.
  assert.doesNotMatch(HTML, /#mark\s*{[^}]*display:\s*none/, 'the mark starts hidden');
  assert.doesNotMatch(HTML, /#bar\s*{[^}]*display:\s*none/, 'the bar starts hidden');
});

test('settling freezes the mark and bar in place instead of hiding them', () => {
  assert.match(HTML, /function settle\(\)\{/, 'the settle() function is gone');
  const at = HTML.indexOf('function settle(){');
  const fn = HTML.slice(at, HTML.indexOf('}', at) + 1);
  assert.match(fn, /mark.*classList\.add\("settled"\)/, 'settle() no longer freezes the mark');
  assert.match(fn, /bar.*classList\.add\("settled"\)/, 'settle() no longer freezes the bar');
  assert.doesNotMatch(fn, /display\s*=\s*"none"/, 'settle() hides an element instead of freezing it in place');
  // Called on BOTH conclusions: the taken branch, and the real ready-to-open path.
  const onload = HTML.slice(HTML.indexOf('img.onload = function(){'), HTML.indexOf('img.onerror'));
  assert.equal((onload.match(/settle\(\);/g) || []).length, 2, 'settle() is not called on both the taken branch and the ready branch');
});

test('a real "Open Kosmos" link is offered, wired to the actual address, never auto-navigated', () => {
  assert.match(HTML, /<a class="go" id="go" href="#">Open Kosmos<\/a>/, 'the Open Kosmos link is gone');
  assert.match(HTML, /getElementById\("go"\)\.href = base \+ "\/"/, 'the link is never pointed at the real address');
  // The refusal to auto-navigate is the actual safety property (the
  // installer's own BOARD_OURS gate makes the same call) and must survive:
  // only a real person's click reaches base+"/" in the taken branch.
  const takenBranch = HTML.slice(HTML.indexOf('if (first) {'), HTML.indexOf('return;\n      }\n      settle();'));
  assert.doesNotMatch(takenBranch, /location\.replace/, 'the taken branch navigates on its own -- the whole point was that only a click should');
  assert.match(HTML, /open Kosmos from Applications instead, or Finder/, 'the Applications fallback for a wrong guess is gone');
});

test('the ordinary wait keeps its own copy: unreadable time, then a slow-download note', () => {
  assert.match(HTML, /Setting up\. This usually takes a minute or two\./);
  assert.match(HTML, /Still going\. A slow download can take a few minutes/);
  assert.match(HTML, /if \(s >= 45\) document\.getElementById\("steps"\)\.textContent = "Setting up\. " \+ s \+ " seconds so far\."/);
  assert.match(HTML, /if \(s >= 180\) show\("late"\)/);
});

test('reduced motion turns off both animations, and dark mode is accounted for', () => {
  assert.match(HTML, /@media \(prefers-reduced-motion:reduce\)\{\.mark,\.bar>i\{animation:none\}\}/);
  assert.match(HTML, /@media \(prefers-color-scheme:dark\)/);
});
