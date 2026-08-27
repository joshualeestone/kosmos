'use strict';

/**
 * The found-agents list when there are a lot of them.
 *
 * 🛑 BOTH OF THESE WERE DRAWN ON 2026-08-22 AND NEVER BUILT, and the reason is
 * the reason to test them here rather than in a browser: no machine we own
 * reaches the threshold. The design
 * (Josh-Brain/Projects/kosmos-design/kosmos-found-agents-2026-08-22.html) draws
 * the same screen at 14 and at 412, and its own note says the fourteenth row
 * was INVENTED because the no-role case does not occur on this Mac.
 * ⭐ WE KEEP SHIPPING THE CASE WE CAN SEE. A test is the only witness the 412
 * case is ever going to get.
 *
 * The rulings under test are the design's, not new ones:
 *   - a drawer is US deciding what you do not need to see; a search box is YOU
 *     deciding, and it is reversible in one keystroke, so the count line always
 *     says BOTH numbers and how to get back
 *   - the box appears at a threshold, because on fourteen rows it is furniture
 *   - a heuristic may RANK, it may not ACT (no add-all, nothing pre-selected)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pageFnSource(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page; this test now checks nothing');
  let depth = 0;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(start, k + 1); }
  }
  throw new Error('could not find the end of ' + name);
}
// eslint-disable-next-line no-new-func
const foundCountLine = new Function([pageFnSource('foundCountLine'), 'return foundCountLine;'].join('\n'))();

test('CONTROL: the extracted function is the real one and can be wrong', () => {
  /* ⚠️ A regex cannot call a function. This file asserts on RESULTS, so it must
     first prove it is holding a callable that answers, or every assertion below
     would pass over an undefined identifier. */
  assert.equal(typeof foundCountLine, 'function');
  assert.notEqual(foundCountLine(1, 2, 'x'), foundCountLine(2, 2, ''));
});

test('the scroll instruction is a MEASUREMENT, not a row count', () => {
  /* 🛑 I SHIPPED THIS AS A CONSTANT AND IT WAS FALSE AT SMALL COUNTS. The
     design's line was written for fourteen rows, which do run past the fold. At
     three they do not, and the sentence told a person to scroll a list that ends
     in front of them. ⭐ A false instruction on a screen that is otherwise right
     is worse than none: it is the READER who ends up feeling wrong.
     🔑 And a row-count threshold would have been a second wrong constant --
     where the fold falls depends on the window, not on how many agents somebody
     has. */
  assert.equal(foundCountLine(14, 14, '', true), '14 agents. Scroll to see them all.');
  assert.equal(foundCountLine(3, 3, '', false), '3 agents.');
  assert.equal(foundCountLine(14, 14, '', false), '14 agents.',
    'fourteen rows in a tall window do not scroll either');
});

test('when we cannot tell whether it scrolls, we do not say it does', () => {
  /* Absent geometry (a stub, a hidden card, a list not yet laid out) arrives
     undefined, and the arm that says LESS is the one that cannot be wrong. */
  assert.equal(foundCountLine(3, 3, ''), '3 agents.');
  assert.equal(foundCountLine(3, 3, '', undefined), '3 agents.');
});

test('one agent is not "1 agents", and is not told to scroll', () => {
  assert.equal(foundCountLine(1, 1, ''), '1 agent.');
});

test('a search says BOTH numbers and the way back', () => {
  /* 🔑 THE DESIGN'S EXACT LINE at 412. Both numbers, because the whole reason a
     search box is allowed here instead of a drawer is that the person can see
     they are looking at a subset. */
  assert.equal(foundCountLine(3, 412, 'rick'), 'Showing 3 of 412. Clear the box to see them all.');
});

test('a search that matches nothing still says how to get back', () => {
  const line = foundCountLine(0, 412, 'zzz');
  assert.match(line, /zzz/, 'it does not name what was typed');
  assert.match(line, /412/, 'it does not say how many there really are');
  assert.match(line, /clear the box/i, 'it is the one arm with no way out');
});

test('the search box appears at a threshold, and the threshold is the design\'s', () => {
  const m = PAGE.match(/const FOUND_SEARCH_AT = (\d+);/);
  assert.ok(m, 'the threshold constant is gone; the box is either always or never');
  const at = Number(m[1]);
  assert.ok(at >= 20 && at <= 40,
    `the design says "somewhere around thirty it starts earning itself"; found ${at}`);
  assert.match(PAGE, /n >= FOUND_SEARCH_AT/, 'the painter no longer gates the box on the threshold');
});

test('every found row carries a haystack that includes its FOLDER', () => {
  /* 📌 The design's 412 drawing matches `patrick-notes` on its PATH, not its
     title, and says why: the folder is often the only thing the person
     remembers, even though it is deliberately not shown. */
  const hay = PAGE.match(/data-found-hay="' \+ esc\(\(([\s\S]{0,160}?)\)\.toLowerCase\(\)\)/);
  assert.ok(hay, 'the row no longer carries data-found-hay; search matches nothing');
  assert.match(hay[1], /a\.name/, 'the haystack does not include the name');
  assert.match(hay[1], /a\.role/, 'the haystack does not include the role');
  assert.match(hay[1], /a\.dir/, 'the haystack does not include the folder');
});

test('filtering HIDES rows rather than repainting the list', () => {
  /* 🛑 Rebuilding is forbidden here for a reason that predates search: each row
     carries the state of a button somebody already pressed, and this screen is
     the one place a person presses four in a row. */
  const handler = PAGE.slice(PAGE.indexOf("document.addEventListener('input'"));
  const body = handler.slice(0, handler.indexOf('\n});'));
  assert.match(body, /row\.hidden = /, 'the filter no longer hides rows');
  assert.ok(!/innerHTML/.test(body), 'the filter rebuilds markup, which discards pressed rows');
});
