'use strict';
/*
 * kosmos#2037 slice 2b: the standing daily product-feedback instruction. The PM
 * role's starting instructions tell the agent to answer, once a day, three
 * structured questions about Kosmos (bugs / not-wired-up, anything broken,
 * suggestions to improve it) and save it with the slice-2a verb
 * `kosmos feedback write`, on a once-a-day self-check cadence. The #2037 report
 * revision (Josh, 2026-09-05) made the note a 3-question prompt rather than a
 * free-form write-up and added an explicit rule inside the prompt: do not share
 * usernames, agent names or project names -- de-identification is authored in,
 * with feedbacksend.scrub() as the backstop.
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
  assert.match(i, /about Kosmos itself/, 'the note is product feedback about Kosmos itself, not the operator\'s own work');
  assert.match(i, /once a day/i, 'the cadence is daily');
  // #2037 revision: the note is a 3-question structured prompt, not a free write-up.
  assert.match(i, /bugs did you hit today|not\s+[\s\S]*wired up/i, 'Q1: bugs / not-wired-up');
  assert.match(i, /is anything broken/i, 'Q2: anything broken');
  assert.match(i, /make the app better/i, 'Q3: suggestions to improve');
  // #2037 revision: an explicit privacy rule lives inside the prompt itself.
  assert.match(i, /do not share usernames, agent names, or project names/i,
    'the prompt carries the explicit no-identifiers rule');
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
