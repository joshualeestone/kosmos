'use strict';
/**
 * kosmos#8581: a stalled repeat is told again by counting the rule's own slots, so a day the clocks change is still one
 * slot. owed() is pure, so these use plain project objects and touch no store. The zone is pinned so the run means the
 * same on any machine.
 *
 *   node --test engine/repeatdue-dst-8581.test.js
 */
process.env.TZ = 'America/Chicago';
const test = require('node:test');
const assert = require('node:assert/strict');
const rd = require('../engine/repeatdue');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
function proj(task) {
  return [{ id: 'p1', name: 'Daily', agents: ['rex'], tasks: [{ number: 1, sentence: 'Check', parts: [{ n: 1, sentence: 'Check', who: 'rex' }], ...task }] }];
}

test('#8581: the zone is pinned (a control: spring forward really is 23 hours here)', () => {
  assert.equal(at(2027, 3, 14, 9, 30) - at(2027, 3, 13, 9, 30), 23 * 60 * 60000);
});

test('#8581: a stalled daily repeat is told on the spring-forward day; control: an ordinary day', () => {
  const ago = iso(at(2027, 3, 1, 9, 30));
  const task = (told) => ({ repeat: { every: 'day', at: '09:30' }, repeatSetAt: ago, lastRunAt: ago, repeatDueToldAt: iso(told) });
  assert.equal(rd.owed(proj(task(at(2027, 3, 13, 9, 30))), at(2027, 3, 14, 10, 0)).length, 1, 'DST day: told');
  assert.equal(rd.owed(proj(task(at(2027, 3, 10, 9, 30))), at(2027, 3, 11, 10, 0)).length, 1, 'ordinary day: told');
  assert.equal(rd.owed(proj(task(at(2027, 3, 14, 9, 30))), at(2027, 3, 14, 10, 0)).length, 0, 'the same slot again: not told');
});

test('#8581: a stalled twice-daily repeat is told once a day, not at each slot', () => {
  const ago = iso(at(2026, 11, 1, 9, 0));
  const task = { repeat: { every: 'day', at: ['09:00', '21:00'] }, repeatSetAt: ago, lastRunAt: ago, repeatDueToldAt: iso(at(2026, 11, 15, 9, 0)) };
  assert.equal(rd.owed(proj(task), at(2026, 11, 15, 21, 30)).length, 0, '12 hours on: held');
  assert.equal(rd.owed(proj(task), at(2026, 11, 16, 9, 30)).length, 1, 'a day on: told');
});

test('#8581: a rule changed after the last line starts afresh; control: unchanged, the stall holds it', () => {
  const ago = iso(at(2026, 11, 1, 9, 0));
  const told = iso(at(2026, 11, 16, 9, 30));
  const base = { repeat: { every: 'minutes', n: 15 }, lastRunAt: ago, repeatDueToldAt: told };
  const now = at(2026, 11, 16, 10, 0);
  assert.equal(rd.owed(proj({ ...base, repeatSetAt: ago }), now).length, 0, 'same rule, same stall, under an hour on');
  assert.equal(rd.owed(proj({ ...base, repeatSetAt: iso(at(2026, 11, 16, 9, 40)) }), now).length, 1, 'new rule: told at its first due slot');
});
