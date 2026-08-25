"use strict";
/**
 * #734: the loose line under the Agents counts is gone, and so is its slot.
 *
 *   node --test web.agents-summary.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the summary slot is gone and nothing writes to it', () => {
  assert.doesNotMatch(PAGE, /id="summary"/);
  assert.doesNotMatch(PAGE, /getElementById\('summary'\)/);
  assert.doesNotMatch(PAGE, /we could not read at all, so some agents may be missing/);
  assert.doesNotMatch(PAGE, /bits\.push\(`\$\{c\.unknown\} we cannot read`\)/);
});

test('the floor fact is said in full on This Mac, with the line the board could not read', () => {
  assert.match(PAGE, /<p class="dhint" id="set-unreadable" role="status" tabindex="-1" hidden/);
  assert.match(PAGE, /unreadEl\.append\(unreadSay \+ ' The board could not read:'\)/);
  assert.match(PAGE, /for \(const raw of \(c\.unreadableSamples \|\| \[\]\)\)/);
  assert.match(PAGE, /unreadEl\.hidden = !floor;/);
});

test('a floored Agents count is a tap to This Mac (no hover on an iPad), and stops being one when the read is whole', () => {
  assert.match(PAGE, /agTile\.classList\.toggle\('floor', floor\);/);
  assert.match(PAGE, /agTile\.setAttribute\('role', 'button'\); agTile\.setAttribute\('tabindex', '0'\);/);
  assert.match(PAGE, /agTile\.removeAttribute\('role'\); agTile\.removeAttribute\('tabindex'\); agTile\.removeAttribute\('aria-label'\);/);
  assert.match(PAGE, /if \(!agTile\.classList\.contains\('floor'\)\) return; showTab\('settings'\); settingsOpen\('mac', \{ focus: false \}\);/);
});

test('the floor fact moved onto the Agents pill, said only when the count is a floor', () => {
  assert.match(PAGE, /const unreadSay = floor\n\s+\? 'At least ' \+ c\.total \+ '\. '/);
  assert.match(PAGE, /agTile\.title = unreadSay;/);
  assert.match(PAGE, /could not be read, so an agent may be missing\.'\n\s+: '';/, 'a full read clears the title');
});

test('the one sentence that still needs a line has its own, and it is the only writer', () => {
  assert.match(PAGE, /<p class="fmsg board-msg" id="board-msg" role="status" aria-live="polite" hidden><\/p>/);
  const writers = PAGE.match(/getElementById\('board-msg'\)/g) || [];
  assert.equal(writers.length, 2, 'one visibility gate and one writer (the could-not-open receipt), nothing else');
  assert.match(PAGE, /getElementById\('board-msg'\);\n\s+if \(msg\) \{\n\s+msg\.textContent = 'We could not open '/);
});
