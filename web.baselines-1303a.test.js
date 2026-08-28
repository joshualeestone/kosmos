'use strict';
/**
 * kosmos#1303 A item 2: Agents, Projects and Tasks share one baseline.
 *
 * 🛑 I CLOSED GROUP A WITHOUT THIS AND SPLINTER CAUGHT IT. What I verified was
 * that the head BOXES had equal tops and heights, for TWO of the three columns.
 * "The band is gone" and "the labels are aligned" are different assertions, and
 * I had only made the first.
 *
 * MEASURED text bottoms, 1440 wide:
 *     before   agents 68.5 · projects 64.5 · tasks 77.0    spread 12.5px
 *     after    68.5 · 68.5 · 68.5                          spread 0
 *
 *   node --test web.baselines-1303a.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const rule = (needle) => {
  const n = PAGE.split(needle).length - 1;
  assert.equal(n, 1, `the anchor ${needle} matches ${n} places`);
  return PAGE.slice(PAGE.indexOf(needle), PAGE.indexOf('}', PAGE.indexOf(needle)) + 1);
};

test('the projects head takes the agents head\'s top padding', () => {
  /* agents   45 + 6 (head padding) + 4.5 (centring in the 22px lead) = 55.5
     projects 45 + 2 + 4.5 = 51.5   <- four pixels, and it was the padding. */
  assert.match(rule('body.consolidated #rail-projects {'), /padding: 6px 10px 4px/,
    'the projects head is back to 2px of top padding, so its label sits 4px high');
});

test('the tasks column comes up to meet them', () => {
  // 12px put its label at 63 against the rails' 55.5.
  assert.match(rule('.pj3 > aside.pjcol:not(.pjsplit) { margin-top:'), /margin-top: 3\.5px/,
    'the tasks column margin changed, so its label leaves the shared baseline');
});

/**
 * ⚠️ THE HALF-PIXEL IS LOAD-BEARING AND A ROUND NUMBER IS WRONG. 4.5 is the
 * rails' own centring and it left Tasks exactly 1px low, because that label has
 * `line-height: 16px` where the rail names have `normal`. Somebody tidying 3.5
 * to 4 reintroduces a visible misalignment, so this says why.
 */
test('the tasks label line-height is what the 3.5 is compensating for', () => {
  const r = rule('.pj3 > aside.pjcol:not(.pjsplit) { margin-top:');
  assert.ok(!/margin-top: 4px|margin-top: 5px/.test(r), 'rounded to a whole pixel');
  assert.match(PAGE, /line-height: 16px` where the rail\s+names/,
    'the note explaining the half-pixel was removed, so the next person will round it');
});
