'use strict';
/**
 * kosmos#8576 (feedback): on the list across every project (kosmos task list --all), each row says when the task last
 * moved and, where the board's own fields say, what it waits on next, so a coordinator can tell waiting from drift
 * without the --stale threshold. Only when the board sent lastActivityAt; an older board's rows print as they did.
 *
 *   node --test engine/tasklist.next-8576.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const tasklist = require('./tasklist');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY - 60000).toISOString();
const rows = (state, list) => tasklist.acrossLines({ all: true, listState: state, tasks: list }, state === 'held' ? 'blocked' : state, { now: NOW }).lines;
const row = (x, state = 'open') => rows(state, [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'], ...x }])[0];

test('the last activity is said in days, and a task with no date says so', () => {
  assert.equal(row({ lastActivityAt: new Date(NOW - 60000).toISOString() }), 'web  #4  open  ada  Fix it  (last activity today)');
  assert.equal(row({ lastActivityAt: ago(1) }), 'web  #4  open  ada  Fix it  (last activity yesterday)');
  assert.equal(row({ lastActivityAt: ago(9) }), 'web  #4  open  ada  Fix it  (last activity 9 days ago)');
  assert.equal(row({ lastActivityAt: null }), 'web  #4  open  ada  Fix it  (no activity on record)');
  assert.equal(row({ lastActivityAt: new Date(NOW + DAY).toISOString() }), 'web  #4  open  ada  Fix it  (last activity today)', 'a clock ahead of this one never prints a negative day');
});

test('what a held task waits on, from its hold', () => {
  const held = (x) => row({ lastActivityAt: ago(3), onHold: true, ...x }, 'held');
  assert.match(held({ onHoldUntil: { task: 7 } }), /\(last activity 3 days ago; waits on task 7 to close\)$/);
  assert.match(held({ onHoldUntil: { at: '2026-11-20T15:00:00Z' } }), /\(last activity 3 days ago; waits until .+\)$/);
  assert.match(held({ onHoldForPerson: true }), /\(last activity 3 days ago; waits on the person\)$/);
  assert.match(held({ onHoldByPerson: true }), /\(last activity 3 days ago; held by the person\)$/);
  assert.match(held({}), /\(last activity 3 days ago\)$/, 'a plain hold says only when it last moved');
});

test('a built task waits on a review, a paused project on being resumed, a repeating one on its next run', () => {
  const built = rows('built', [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'], lastActivityAt: ago(2), builtAt: ago(2) }])[0];
  assert.equal(built, 'web  #4  built  ada  Fix it  (last activity 2 days ago; waits on a review and close)');
  assert.match(row({ lastActivityAt: ago(2), projectPaused: true }), /; waits on its project being resumed\)$/);
  assert.match(row({ lastActivityAt: ago(2), repeat: { every: 'day' }, repeatNextWords: 'tomorrow at 9:00' }), /; next run tomorrow at 9:00\)$/);
});

test('CONTROL: an older board that sends no lastActivityAt prints its rows as before, held and built ones too', () => {
  assert.equal(row({}), 'web  #4  open  ada  Fix it');
  assert.equal(row({ onHold: true, onHoldUntil: { task: 7 } }, 'held'), 'web  #4  blocked  ada  Fix it');
  assert.equal(rows('built', [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'], builtAt: ago(2) }])[0], 'web  #4  built  ada  Fix it');
});

test('the words go only on the list across every project, not on one project\'s --stale list', () => {
  const stale = tasklist.acrossLines({ listState: 'open', quietDays: 1, tasks: [{ number: 3, sentence: 'x', lastActivityAt: ago(4) }] }, 'stale', { project: 'web', days: 1, now: NOW }).lines;
  assert.equal(stale[0], '#3  open  nobody  x  (quiet 4 days)');
});
