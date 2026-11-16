'use strict';
/**
 * kosmos#8581: a stalled repeat is told again by counting the rule's own slots, so a day the clocks change is still one
 * slot. owed() is pure, so these use plain project objects and touch no store. The zone is pinned so the run means the
 * same on any machine.
 *
 *   node --test engine/repeatdue-dst-8581.test.js
 */
process.env.TZ = 'America/Chicago';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
// Repo convention: every root sandboxed before any require (owed() loads tasks and projects lazily).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rdd-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rdd-proj-'));
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
  const now = at(2026, 11, 16, 10, 5);   // the 10:00 slot, past its grace
  assert.equal(rd.owed(proj({ ...base, repeatSetAt: ago }), now).length, 0, 'same rule, same stall, under an hour on');
  assert.equal(rd.owed(proj({ ...base, repeatSetAt: iso(at(2026, 11, 16, 9, 40)) }), now).length, 1, 'new rule: told at its first due slot');
});

test('#8581: uneven times in a day are each counted: 09:00 and 17:00 is told once a day from either slot', () => {
  const ago = iso(at(2026, 11, 1, 9, 0));
  const rule = { every: 'day', at: ['09:00', '17:00'] };
  assert.equal(rd.stallSlots(rule, at(2026, 11, 15, 9, 0)), 2);
  assert.equal(rd.stallSlots(rule, at(2026, 11, 15, 17, 0)), 2);
  const t = (told) => ({ repeat: rule, repeatSetAt: ago, lastRunAt: ago, repeatDueToldAt: iso(told) });
  assert.equal(rd.owed(proj(t(at(2026, 11, 15, 9, 0))), at(2026, 11, 15, 17, 30)).length, 0, 'the same day: held');
  assert.equal(rd.owed(proj(t(at(2026, 11, 15, 9, 0))), at(2026, 11, 16, 9, 30)).length, 1, 'a day on: told');
  const close = { every: 'day', at: ['09:00', '09:30'] };
  const c = (told) => ({ repeat: close, repeatSetAt: ago, lastRunAt: ago, repeatDueToldAt: iso(told) });
  assert.equal(rd.owed(proj(c(at(2026, 11, 10, 9, 0))), at(2026, 11, 11, 9, 10)).length, 1, 'two close times: the next day is not skipped');
});

test('#8581: not told before the slot is overdue by its grace; control: after it', () => {
  // Ran on time yesterday, so only today's 9:30 slot can be owed.
  const task = { repeat: { every: 'day', at: '09:30' }, repeatSetAt: iso(at(2026, 11, 1, 9, 30)), lastRunAt: iso(at(2026, 11, 15, 9, 31)) };
  assert.equal(rd.owed(proj(task), at(2026, 11, 16, 9, 40)).length, 0, 'ten minutes late: within the 15-minute grace');
  assert.equal(rd.owed(proj(task), at(2026, 11, 16, 9, 46)).length, 1);
});

test('#8581: a run reported a little early answers its slot (as the missed count reads it); control: no run is owed', () => {
  const set = iso(at(2026, 11, 1, 9, 0));
  const hourly = { every: 'hour', minute: 0 };
  assert.equal(rd.owed(proj({ repeat: hourly, repeatSetAt: set, lastRunAt: iso(at(2026, 11, 16, 8, 50)) }), at(2026, 11, 16, 9, 16)).length, 0, 'hourly, run at 8:50 for 9:00');
  assert.equal(rd.owed(proj({ repeat: hourly, repeatSetAt: set, lastRunAt: iso(at(2026, 11, 16, 8, 0)) }), at(2026, 11, 16, 9, 16)).length, 1, 'control: the 9:00 run not reported');
  const q = { every: 'minutes', n: 15 };
  assert.equal(rd.owed(proj({ repeat: q, repeatSetAt: set, lastRunAt: iso(at(2026, 11, 16, 8, 58)) }), at(2026, 11, 16, 9, 4)).length, 0, 'every 15 minutes, run at 8:58 for 9:00');
  assert.equal(rd.owed(proj({ repeat: q, repeatSetAt: set, lastRunAt: iso(at(2026, 11, 16, 8, 30)) }), at(2026, 11, 16, 9, 4)).length, 1, 'control');
});
