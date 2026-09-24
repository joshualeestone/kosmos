'use strict';
/*
 * kosmos#2037 slice 2b: the standing daily product-feedback instruction. The PM
 * role's starting instructions tell the agent to answer, once a day, three
 * structured questions about Kosmos (bugs / not-wired-up, anything broken,
 * suggestions to improve it) and save it with the slice-2a verb
 * `kosmos feedback write`, on a once-a-day self-check cadence. The #2037 report
 * revision (Josh, 2026-09-05) made the note a question prompt rather than a
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
  // #2037 revision: the note is a structured question prompt, not a free write-up
  // (three questions then; #3563 added a fourth, on tasks).
  assert.match(i, /bugs did you hit today|not\s+[\s\S]*wired up/i, 'Q1: bugs / not-wired-up');
  assert.match(i, /is anything broken/i, 'Q2: anything broken');
  assert.match(i, /make the app better/i, 'Q3: suggestions to improve');
  // #2037 revision: an explicit privacy rule lives inside the prompt itself.
  assert.match(i, /do not share usernames, agent names, or project names/i,
    'the prompt carries the explicit no-identifiers rule');
});

test('#3563: the report asks for a qualitative tasks note, in words, never counts', () => {
  const i = roles.byKey('pm').instructions;
  // Josh, 2026-09-24: tasks go INSIDE the existing report as the agent's own
  // words ("good, bad, or ugly"), "not as a separate actual numerical call".
  assert.match(i, /how are tasks going\?/i, 'Q4: the tasks question is asked');
  assert.match(i, /bad or\s+ugly/i, 'Q4 invites the bad and the ugly, not only the good');
  assert.match(i, /anything that is stuck/i, 'Q4 asks what is stuck');
  assert.match(i, /do not count them: no task\s+tallies/i, 'Q4 forbids task counts (no numerical task telemetry)');
  // Scoped to tasks: a bare "no numbers" would read as banning a version or an
  // error code from Q1-Q3, which is what makes those reports useful.
  assert.doesNotMatch(i, /no numbers/i, 'the no-counts rule names tasks, not every number in the report');
  assert.match(i, /no task titles or what\s+a task says/i, 'Q4 forbids lifting task titles or contents');
  // The lead-in names how many questions there are; it must agree with the list,
  // or adding Q4 without updating "three" reads as a report with a stray extra.
  const section = i.slice(i.indexOf('## Once a day: help make Kosmos better'));
  const numbered = section.match(/^\d+\. /gm) || [];
  const words = { 4: 'four', 5: 'five', 6: 'six', 7: 'seven' };
  assert.ok(numbered.length >= 4, 'the section lists at least the four questions');
  assert.ok(words[numbered.length], 'extend the words map when a question is added');
  assert.match(section, new RegExp('these ' + words[numbered.length] + ' questions'),
    'the lead-in count agrees with the numbered list');
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
