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

test('a running state still has its label, so this did not silence the pill', () => {
  /* 🛑 THE CONTROL THAT MATTERS. Returning an empty label for everything would
     pass the tests around it and remove the status from the whole product. */
  const f = pillOf();
  assert.equal(f({ summary: { total: 3, needsYou: 1 } }, false).label, 'Issue');
  assert.equal(f({ summary: { total: 3, working: 1 } }, false).label, 'Working');
  // (Restarting is not asserted here: its glyph is GLYPH.restarting, which this lifted copy cannot see.)
});

test('#4730: no badge when nothing runs or we cannot tell (Josh, 2026-09-30)', () => {
  /* "if there's nothing running or we can't tell, let's just not display a badge here. Let's only
     display a badge if something is actually running." */
  const f = pillOf();
  for (const [what, p, unreadable] of [
    ['nothing running', { summary: { total: 3 } }, false],
    ['an unseen member', { summary: { total: 3, unseen: 1 } }, false],
    ['an unreadable roster', { summary: { total: 3, working: 1 } }, true],
  ]) {
    const got = f(p, unreadable);
    assert.equal(got.label, '', what + ': a badge is back (' + got.label + ')');
    assert.equal(got.glyph, '', what + ': an empty badge still carries a glyph');
  }
});

test('#4730: the Projects card draws no "we cannot see" line', () => {
  const at = PAGE.indexOf('function projectCard(');
  assert.notEqual(at, -1, 'projectCard is gone');
  const body = PAGE.slice(at, PAGE.indexOf('\n}', at));
  // The emitted strings, not the words (the comment explaining their removal quotes them).
  assert.doesNotMatch(body, /' we cannot see'|'we cannot see how they are doing/, 'the card says "we cannot see" again');
  assert.doesNotMatch(body, /class="pj-who"/, 'the card emits the pj-who line again');
});

test('#4730: list rows are shaded by the fold walk, visible rows only', () => {
  assert.match(PAGE, /row\.classList\.toggle\('pj-stripe', !shouldHide && \(shown\+\+ % 2 === 1\)\)/,
    'the stripe is no longer set from the visible-row count in applyConsFold');
  assert.match(PAGE, /body:not\(\.consolidated\)\.pj-roadmap #pj-list:not\(\.asgrid\) \.pj-row\.pj-stripe \{/,
    'the stripe rule is not scoped to the tab list view');
});

test('the row omits the pill element when there is no label', () => {
  /* An empty `<span class="pjpill">` would still take its margins and gaps, so
     the fix has to be in the builder and not only in the label. */
  assert.match(PAGE, /\(pill\.label \? '<span class="pjpill '/,
    'the row renders a pill unconditionally again, so an empty one is emitted');
});
