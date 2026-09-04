'use strict';
/*
 * kosmos#2037 slice 2b: the standing daily product-feedback instruction. The PM
 * role's starting instructions tell the agent to author a daily note of what did
 * not work about Kosmos + what would make it better, and save it with the
 * slice-2a verb `kosmos feedback write`, on a once-a-day self-check cadence.
 *
 * The cadence is a self-check (check `kosmos feedback show` first, skip if today
 * already has one) because the product has NO daily/cron scheduler: the only
 * periodic machinery is minute-scale setInterval sweeps in server.js. So the
 * instruction itself carries the cadence.
 *
 * PM-scoped, not fleet-wide (plan feedback-author-2037.md; Josh: "an agent,
 * probably the PM, writes and assembles"). The store is one markdown file per
 * local day (idempotent replace), so more than one daily author would clobber;
 * one designated author is the right shape.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const roles = require('./engine/roles');

test('the PM role carries the daily product-feedback instruction (write path + self-check + Kosmos-scoped)', () => {
  const pm = roles.byKey('pm');
  assert.ok(pm, 'the pm role exists');
  const i = pm.instructions;
  assert.match(i, /kosmos feedback write/, 'the PM is told the write command (the slice-2a verb)');
  assert.match(i, /kosmos feedback show/, 'the PM is told to self-check today first (the cadence, since no scheduler exists)');
  assert.match(i, /did not work about Kosmos/, 'the note is product feedback about Kosmos itself, not the operator\'s own work');
  assert.match(i, /once a day/i, 'the cadence is daily');
});

test('the daily-feedback instruction is PM-scoped, not fleet-wide', () => {
  // The store is one file per day (engine/feedback.js: idempotent replace), so a
  // single designated author avoids clobbering. Targeting the PM matches the
  // plan's recorded decision and Josh's "probably the PM".
  for (const r of roles.ROLES.filter((r) => r.key !== 'pm')) {
    assert.doesNotMatch(r.instructions, /kosmos feedback write/,
      `role '${r.key}' must NOT carry the daily-feedback instruction; it is PM-scoped`);
  }
  // Positive control: the pm role DOES carry it, so the negative sweep above is
  // meaningful rather than passing because the string appears in no role at all.
  assert.match(roles.byKey('pm').instructions, /kosmos feedback write/,
    'the pm role must carry it (control for the negative sweep)');
});
