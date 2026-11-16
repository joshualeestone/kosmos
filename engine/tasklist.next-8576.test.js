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

const NOW = new Date(2026, 10, 16, 12, 0).getTime();   // local noon: the day counts are local calendar days, so any time zone agrees
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

test('days are calendar days on this computer\'s clock, not 24-hour blocks', () => {
  // 09:00 local; the day before at 13:00 is under 24 hours back, and two days before at 23:00 is under 48.
  const morning = new Date(2026, 10, 16, 9, 0).getTime();
  const at = (y, mo, d, h) => new Date(y, mo, d, h, 0).toISOString();
  const r = (when) => tasklist.acrossLines({ all: true, listState: 'open', tasks: [{ projectId: 'web', number: 4, sentence: 'x', lastActivityAt: when }] }, 'open', { now: morning }).lines[0];
  assert.match(r(at(2026, 10, 15, 13)), /\(last activity yesterday\)$/, 'yesterday afternoon read as today');
  assert.match(r(at(2026, 10, 14, 23)), /\(last activity 2 days ago\)$/, 'two days ago late in the evening read as yesterday');
  assert.match(r(at(2026, 10, 16, 0)), /\(last activity today\)$/, 'CONTROL: just after midnight is today');
});

test('what a held task waits on, from its hold', () => {
  const held = (x) => row({ lastActivityAt: ago(3), onHold: true, ...x }, 'held');
  assert.match(held({ onHoldUntil: { task: 7 } }), /\(last activity 3 days ago; waits on task 7 to close\)$/);
  assert.match(held({ onHoldUntil: { at: new Date(NOW + 4 * DAY).toISOString() } }), /\(last activity 3 days ago; waits until .+\)$/);
  assert.match(held({ onHoldForPerson: true }), /\(last activity 3 days ago; waits on the person\)$/);
  assert.match(held({ onHoldByPerson: true }), /\(last activity 3 days ago; held by the person\)$/);
  assert.match(held({ onHoldForPerson: true, onHoldUntil: { task: 7 } }), /; waits on the person and task 7 to close\)$/, 'a hold for the person until a task says both');
  assert.match(held({ onHoldForPerson: true, onHoldUntil: { at: new Date(NOW + 4 * DAY).toISOString() } }), /; waits on the person, until .+\)$/);
  assert.match(held({ onHoldUntil: { task: 7 }, holdUntilMet: true }), /; its hold's condition is met, but it is still on hold\)$/, 'a hold whose task closed was said as still waiting');
  assert.match(held({ onHoldUntil: { at: new Date(NOW - DAY).toISOString() } }), /; its hold's condition is met, but it is still on hold\)$/, 'a hold whose time passed was said as still waiting');
  assert.match(held({ onHoldUntil: { task: 7 }, holdUntilMet: false }), /; waits on task 7 to close\)$/, 'CONTROL: a condition not met still waits');
  assert.match(held({ onHoldUntil: { at: new Date(NOW - 60000).toISOString() }, holdUntilMet: false }), /; waits until .+\)$/, 'this computer\'s clock overrode the board\'s answer');
  assert.match(held({ onHoldByPerson: true, onHoldUntil: { at: new Date(NOW - DAY).toISOString() } }), /still on hold \(only the person can lift it\)\)$/, 'a person\'s hold does not lift itself');
  assert.match(held({}), /\(last activity 3 days ago\)$/, 'a plain hold says only when it last moved');
});

test('a built task waits on a review, a paused project on being resumed, a repeating one on its next run', () => {
  const built = rows('built', [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'], lastActivityAt: ago(2), builtAt: ago(2) }])[0];
  assert.equal(built, 'web  #4  built  ada  Fix it  (last activity 2 days ago; waits on a review and close)');
  assert.match(row({ lastActivityAt: ago(2), projectPaused: true }), /; waits on its project being resumed\)$/);
  const builtPaused = rows('built', [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'], lastActivityAt: ago(2), builtAt: ago(2), projectPaused: true }])[0];
  assert.match(builtPaused, /; waits on a review and close\)$/, 'a built task in a paused project is in the built list because its review can still happen');
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
  const allStale = tasklist.acrossLines({ all: true, listState: 'open', quietDays: 1, tasks: [{ projectId: 'web', number: 3, sentence: 'x', lastActivityAt: ago(4) }] }, 'stale', { days: 1, now: NOW }).lines;
  assert.equal(allStale[0], 'web  #3  open  nobody  x  (quiet 4 days)', '--all --stale keeps its own words');
});
