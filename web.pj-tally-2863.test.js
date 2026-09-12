'use strict';
/**
 * #2863 (Josh): the PROJECTS half of the top unread-message tally, the rollup of
 * the per-project unread bubbles ("tally those at the top... so you can see where
 * notifications are happening and need you"). This is the projects "Messages" tile
 * summing p.unread across the active board; the agents twin (a.dmUnread) shipped
 * first and is guarded by web.dm-tally-2863.test.js.
 *
 *   node --test web.pj-tally-2863.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* The sum is inline in paintProjects(); extract the exact expression from source
   and evaluate it (with PJ_CURRENT injected, since the reduce suppresses the open
   project), so the test guards the REAL reduce rather than a paraphrase. */
const m = SCRIPT.match(/const pjDmTotal = (active\.reduce\([\s\S]*?\}, 0\));/);
const sumOf = (projects, current = null) => {
  assert.ok(m, 'the pjDmTotal reduce is gone from paintProjects()');
  return new Function('active', 'PJ_CURRENT', 'return ' + m[1] + ';')(projects, current);
};

test('the tally sums project unread across the active board, and null/negative contribute 0', () => {
  assert.equal(sumOf([{ id: 'a', unread: 3 }, { id: 'b', unread: 5 }]), 8, 'the tally does not sum the per-project counts');
  assert.equal(sumOf([{ id: 'a', unread: 3 }, { id: 'b', unread: null }, { id: 'c', unread: 5 }]), 8, 'an unknown (null) count was not treated as 0');
  assert.equal(sumOf([{ id: 'a', unread: 3 }, { id: 'b' }, { id: 'c', unread: -2 }]), 3, 'a missing or negative count was not treated as 0');
  assert.equal(sumOf([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]), 0, 'zeros did not sum to zero');
});

test('sub-projects count too: the reduce is flat over active, so a nested badge is in the tally', () => {
  /* Sub-projects are their own rows in `active` (linked by p.parent), so a flat
     sum catches every visible badge, parent and child alike. */
  assert.equal(sumOf([{ id: 'top', unread: 2 }, { id: 'kid', parent: 'top', unread: 4 }]), 6,
    'a sub-project unread was dropped from the tally');
});

test('the project whose thread is open (PJ_CURRENT) is excluded, so the tally agrees with its suppressed badge', () => {
  const projects = [{ id: 'p1', unread: 5 }, { id: 'p2', unread: 3 }];
  assert.equal(sumOf(projects, 'p1'), 3, 'the open project (p1) unread was counted, disagreeing with its own suppressed badge');
  assert.equal(sumOf(projects, null), 8, 'control: with no project open, both count');
});

test('the Messages tile is wired: set from the sum, hidden at zero', () => {
  assert.match(SCRIPT, /document\.getElementById\('st-pjdm'\)\.textContent = String\(pjDmTotal\);/,
    'the tile count is not set from the sum');
  assert.match(SCRIPT, /document\.getElementById\('st-pjdm-tile'\)\.hidden = pjDmTotal <= 0;/,
    'the tile is not hidden at zero (a quiet board would carry an empty Messages tile)');
});

test('a failed read shows the tile as unknown-and-hidden, not a stale count', () => {
  /* pjTilesUnknown() is loadProjects catch's tile-blanker; the projects twin of
     the agents failed-poll reset. */
  const unknown = SCRIPT.match(/function pjTilesUnknown\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(unknown, 'pjTilesUnknown() is gone');
  assert.match(unknown[0], /document\.getElementById\('st-pjdm'\)\.textContent = '\?';/,
    'a failed read leaves a stale Messages count standing');
  assert.match(unknown[0], /document\.getElementById\('st-pjdm-tile'\)\.hidden = true;/,
    'a failed read does not hide the Messages tile');
});

test('the tile markup and its muted (non-alert) glyph are present', () => {
  assert.match(PAGE, /<div class="stat" id="st-pjdm-tile" hidden[^>]*>[\s\S]*?<b id="st-pjdm"[^>]*>0<\/b><span class="slab">Messages<\/span>/,
    'the projects Messages tile markup is missing or malformed');
  /* Its own glyph, NOT the red .haz alert mark: unread messages point you
     somewhere, they are not a fault (the same choice the agents tile makes). */
  assert.doesNotMatch(PAGE.match(/<div class="stat" id="st-pjdm-tile"[\s\S]*?<\/div>/)[0], /class="haz"/,
    'the projects Messages tile wears the red alert mark; it should carry its own muted glyph');
});
