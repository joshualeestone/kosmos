'use strict';
/**
 * The projects sort (#168). Josh, 2026-08-21: "maybe not a filter but
 * definitely a sort", beside the view toggle. Spec on the card (Mona Lisa,
 * 2026-08-23), written falsifiable; these are its checks, run against the
 * shipped functions lifted out of the page rather than a copy of them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

function lifted() {
  const src = liftAll(SCRIPT, ['pjSortMode', 'sortProjects']);
  // The two constants the functions read, pinned to the page's own values so a
  // changed default fails here rather than silently reordering the board.
  const consts = /const PJ_SORTS = \[[^\]]*\];\s*const PJ_SORT_DEFAULT = '[a-z]+';/.exec(SCRIPT);
  assert.ok(consts, 'PJ_SORTS / PJ_SORT_DEFAULT left the page or changed shape');
  return new Function(`${consts[0]}\n${src}\nreturn { pjSortMode, sortProjects, PJ_SORTS, PJ_SORT_DEFAULT };`)();
}

const P = (name, createdAt, extra) => ({ id: name.toLowerCase(), name, createdAt, ...(extra || {}) });
const ten = P('Bravo', '2026-08-21T10:00:00Z');
const eleven = P('alpha', '2026-08-21T11:00:00Z');
const twelve = P('Charlie', '2026-08-21T12:00:00Z');

test('the four orders do what their option text says', () => {
  const { sortProjects } = lifted();
  const names = (mode) => sortProjects([ten, eleven, twelve], mode).map((p) => p.name);
  assert.deepEqual(names('newest'), ['Charlie', 'alpha', 'Bravo'], 'Newest first');
  assert.deepEqual(names('oldest'), ['Bravo', 'alpha', 'Charlie'], 'Oldest first');
  assert.deepEqual(names('az'), ['alpha', 'Bravo', 'Charlie'], 'Name A to Z ignores case');
  assert.deepEqual(names('za'), ['Charlie', 'Bravo', 'alpha'], 'Name Z to A is the exact reverse');
});

test('the default is newest first, and an unknown saved value falls back to it', () => {
  const { pjSortMode, sortProjects, PJ_SORT_DEFAULT, PJ_SORTS } = lifted();
  assert.equal(PJ_SORT_DEFAULT, 'newest', 'the card rules newest first; move this row on the card, not here');
  assert.deepEqual(PJ_SORTS, ['newest', 'oldest', 'az', 'za']);
  for (const bad of [null, undefined, '', 'updated', 'org', 42]) {
    assert.equal(pjSortMode(bad), 'newest', `saved value ${JSON.stringify(bad)} was trusted`);
  }
  for (const good of PJ_SORTS) assert.equal(pjSortMode(good), good);
  // With no mode at all the sort behaves as the default, so a caller that
  // forgets the argument cannot paint store order by accident.
  assert.deepEqual(sortProjects([ten, twelve], undefined).map((p) => p.name), ['Charlie', 'Bravo']);
});

test('a sort is not a filter: every row survives every order, including undated and nameless ones', () => {
  const { sortProjects, PJ_SORTS } = lifted();
  const undated = P('Delta', undefined);
  const undated2 = P('Echo', 'not a date');
  const nameless = { id: 'x', createdAt: '2026-08-21T09:00:00Z' };
  const all = [ten, undated, eleven, nameless, twelve, undated2];
  for (const mode of PJ_SORTS) {
    const out = sortProjects(all, mode);
    assert.equal(out.length, all.length, `${mode} dropped a project`);
    assert.deepEqual([...out].sort((a, b) => a.id.localeCompare(b.id)), [...all].sort((a, b) => a.id.localeCompare(b.id)),
      `${mode} lost or invented a project`);
  }
  // Undated rows sort after every dated one under BOTH date orders, keeping
  // their store order among themselves.
  for (const mode of ['newest', 'oldest']) {
    const out = sortProjects(all, mode).map((p) => p.id);
    assert.deepEqual(out.slice(-2), ['delta', 'echo'], `${mode}: undated rows are not last, in store order`);
  }
  // Input untouched.
  assert.deepEqual(all.map((p) => p.id), ['bravo', 'delta', 'alpha', 'x', 'charlie', 'echo'], 'sortProjects mutated its input');
  // Never throws on garbage.
  assert.deepEqual(sortProjects(null, 'az'), []);
  assert.deepEqual(sortProjects([null, undefined], 'newest').length, 2);
});

test('ties are stable: equal dates and equal names keep store order', () => {
  const { sortProjects } = lifted();
  const same = [P('Same', '2026-08-21T10:00:00Z', { id: 'a' }), P('Same', '2026-08-21T10:00:00Z', { id: 'b' }), P('Same', '2026-08-21T10:00:00Z', { id: 'c' })];
  for (const mode of ['newest', 'oldest', 'az', 'za']) {
    assert.deepEqual(sortProjects(same, mode).map((p) => p.id), ['a', 'b', 'c'], `${mode} reordered ties`);
  }
});

test('the control sits in the projects statsrow between the counts and the view toggle, with the four options in order', () => {
  const row = /<div class="statsrow">([\s\S]*?)<p class="fmsg" id="pj-list-msg"/.exec(PAGE);
  assert.ok(row, 'the projects statsrow was not found');
  const html = row[1];
  const iStats = html.indexOf('id="st-pj"');
  const iSort = html.indexOf('id="pj-sort"');
  const iToggle = html.indexOf('data-scope="projects"');
  assert.ok(iStats > -1 && iSort > -1 && iToggle > -1, 'a piece of the row is missing');
  assert.ok(iStats < iSort && iSort < iToggle, 'the sort is not between the counts and the toggle');
  const options = [...html.matchAll(/<option value="([a-z]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['az', 'Name A to Z'], ['za', 'Name Z to A']],
    'the option text or order moved; the card rules these exact words');
  assert.match(html, /<select id="pj-sort" aria-label="Sort projects">/, 'the select lost its accessible name');
  assert.match(html, /<label class="sortctl" for="pj-sort"><span class="slab">Sort<\/span>/, 'the visible Sort label is gone');
  // Never disabled by markup; it stays enabled at zero projects on purpose.
  assert.doesNotMatch(html, /id="pj-sort"[^>]*disabled/, 'the select ships disabled');
});

test('paintProjects sorts the active cards and the archived disclosure alike, and persists like the layout does', () => {
  const fn = /function paintProjects\(\) \{([\s\S]*?)\n\}/.exec(SCRIPT);
  assert.ok(fn, 'paintProjects not found');
  assert.match(fn[1], /sortProjects\(PROJECTS\.filter\(\(p\) => !p\.archived\), PJ_SORT\)/, 'active cards are not sorted');
  assert.match(fn[1], /sortProjects\(PROJECTS\.filter\(\(p\) => p\.archived\), PJ_SORT\)/, 'the archived disclosure is not sorted; one order for the page');
  assert.match(SCRIPT, /localStorage\.setItem\('kosmos\.sort\.projects', PJ_SORT\)/, 'the choice is not saved');
  assert.match(SCRIPT, /localStorage\.getItem\('kosmos\.sort\.projects'\)/, 'the choice is not read back on boot');
  // The count tile is written from `active.length` and nothing the sort does
  // changes a length: pinned so a filter cannot sneak in under this name.
  assert.match(fn[1], /document\.getElementById\('st-pj'\)\.textContent = String\(active\.length\)/);
});
