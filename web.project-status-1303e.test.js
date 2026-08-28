'use strict';
/**
 * kosmos#1303 group E: a project with no agents shows no status.
 *
 * Josh: "On the Projects tab I don't want to show 'no agents' as a status for a
 * project."
 *
 * ⚠️ THE REST OF GROUP E IS NOT HERE, deliberately. The one-line restructure was
 * built, measured, and REVERTED because it did not do what he asked; the numbers
 * are on the card. This file covers only what shipped.
 *
 *   node --test web.project-status-1303e.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

function pillOf() {
  const at = PAGE.indexOf('function pjPillOf(p, unreadable) {');
  assert.notEqual(at, -1, 'pjPillOf is gone');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  // eslint-disable-next-line no-eval
  return eval('(' + src.replace('function pjPillOf', 'function') + ')');
}

test('a project with no agents gets no status label at all', () => {
  const f = pillOf();
  const got = f({ summary: { total: 0 } }, false);
  assert.equal(got.label, '', 'the "No agents yet" status is back');
  assert.equal(got.glyph, '', 'an empty status should carry no glyph either');
});

test('every OTHER state still has its label, so this did not silence the pill', () => {
  /* 🛑 THE CONTROL THAT MATTERS. Returning an empty label for everything would
     pass the test above and remove the status from the whole product. */
  const f = pillOf();
  assert.equal(f({ summary: { total: 3, needsYou: 1 } }, false).label, 'Needs you');
  assert.equal(f({ summary: { total: 3, working: 1 } }, false).label, 'Working');
  assert.equal(f({ summary: { total: 3 } }, false).label, 'Nothing running');
  assert.equal(f({ summary: { total: 3, unseen: 1 } }, false).label, 'Can’t tell');
});

test('the row omits the pill element when there is no label', () => {
  /* An empty `<span class="pjpill">` would still take its margins and gaps, so
     the fix has to be in the builder and not only in the label. */
  assert.match(PAGE, /\(pill\.label \? '<span class="pjpill '/,
    'the row renders a pill unconditionally again, so an empty one is emitted');
});
