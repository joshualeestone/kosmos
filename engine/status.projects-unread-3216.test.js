'use strict';
/*
 * #3216: status.projectsUnreadTotal -- the RAW active-projects DM-unread total the
 * always-polled /api/status carries so a cross-tab Projects nav badge stays fresh. The
 * load-bearing properties, each of which keeps it ONE derivation with the client's pjDmTotal
 * (web/index.html) and never shows a phantom badge:
 *   - sums messages.unreadAll()[p.id] over NON-ARCHIVED projects only (archived excluded, the
 *     same split the client's `active` set applies);
 *   - RAW: it does NOT exclude the open project (the client subtracts PJ_CURRENT in tick(),
 *     which the server cannot know), so this is the pre-exclusion total;
 *   - unknown -> 0: a null unreadMap (unreadable messages) and a non-array projects list both
 *     sum to 0, matching pjDmTotal's `Number.isFinite(v) && v>0 ? v : 0` so a missing bubble
 *     never surfaces as a badge.
 *
 *   node --test engine/status.projects-unread-3216.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

const P = (id, archived) => ({ id, archived });

test('sums unread across non-archived projects', () => {
  const projects = [P('a'), P('b'), P('c')];
  const unread = { a: 2, b: 3, c: 5 };
  assert.equal(status.projectsUnreadTotal(projects, unread), 10);
});

test('EXCLUDES archived projects (matches the client active set)', () => {
  const projects = [P('a'), P('b', true), P('c')];
  const unread = { a: 2, b: 100, c: 5 };
  assert.equal(status.projectsUnreadTotal(projects, unread), 7, 'the archived project b (100) is not counted');
});

test('RAW: does NOT exclude any open project (that is the client tick() subtraction)', () => {
  // The server has no PJ_CURRENT; every non-archived project with unread counts here.
  const projects = [P('open'), P('other')];
  const unread = { open: 4, other: 1 };
  assert.equal(status.projectsUnreadTotal(projects, unread), 5);
});

test('a project with no entry in the unread map contributes 0', () => {
  const projects = [P('a'), P('b')];
  const unread = { a: 3 };
  assert.equal(status.projectsUnreadTotal(projects, unread), 3);
});

test('non-finite / <=0 unread values are treated as 0 (pjDmTotal parity)', () => {
  const projects = [P('a'), P('b'), P('c'), P('d'), P('e')];
  const unread = { a: 0, b: -2, c: null, d: NaN, e: 4 };
  assert.equal(status.projectsUnreadTotal(projects, unread), 4, 'only e=4 counts');
});

test('unknown -> 0: null / non-object unread map sums to 0', () => {
  const projects = [P('a'), P('b')];
  assert.equal(status.projectsUnreadTotal(projects, null), 0);
  assert.equal(status.projectsUnreadTotal(projects, undefined), 0);
  assert.equal(status.projectsUnreadTotal(projects, 'nope'), 0);
});

test('a non-array projects list sums to 0 (fail-safe, never a phantom badge)', () => {
  assert.equal(status.projectsUnreadTotal(null, { a: 5 }), 0);
  assert.equal(status.projectsUnreadTotal(undefined, { a: 5 }), 0);
  assert.equal(status.projectsUnreadTotal('nope', { a: 5 }), 0);
});

test('a null/garbage project row is skipped, not thrown on', () => {
  const projects = [null, P('a'), { archived: true }, P('b')];
  const unread = { a: 2, b: 3 };
  assert.equal(status.projectsUnreadTotal(projects, unread), 5);
});

test('empty inputs sum to 0', () => {
  assert.equal(status.projectsUnreadTotal([], {}), 0);
});
