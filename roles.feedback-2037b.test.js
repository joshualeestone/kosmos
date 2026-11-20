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
// #4632: the ready-made roles are downloaded; sandbox the data root and store the signed fixture
// first, so every-role sweeps below see the catalogue's roles too, and never the operator's own copy.
require('./test-support/catalogue-fixture').sandboxWithCatalogue('roles-feedback');
const assert = require('node:assert/strict');
const roles = require('./engine/roles');

/* kosmos#8735 slice 3: since #7374 the board itself asks one agent a day, Project Manager first, and its message
   (engine/feedbacknudge.js nudgeText) carries the questions and the commands. The PM's instructions keep that the ask
   comes, what it is about, and what the report must never carry; the questions and #3563 are pinned on the ask. */
const nudge = () => require('./engine/feedbacknudge').nudgeText();

test('the PM role says the daily product-feedback ask comes, what it is about, and what it must never carry', () => {
  const pm = roles.byKey('pm');
  assert.ok(pm, 'the pm role exists');
  const i = pm.instructions;
  assert.match(i, /While sending is on \(Settings, Automation\), Kosmos asks one agent a day, a\s+Project Manager first, for a short report about Kosmos itself/, 'the PM knows the ask comes, when, and that it is about Kosmos itself');
  assert.match(i, /when it asks you, do it/, 'the PM is told to answer the ask');
  // #2037 revision: the privacy rule stays in the brief as safety text, beside the ask's own copy.
  assert.match(i, /Never put usernames, agent names, project\s+names, or a secret, API key, token, or password in it/,
    'the brief carries the no-identifiers and no-secrets rule');
  assert.match(i, /It is sent to the\s+Kosmos team \(scrubbed\)\./);
});

test('#2037: the board\'s daily ask carries the write path, the self-check and the questions', () => {
  const t = nudge();
  assert.match(t, /kosmos feedback write/, 'the write command (the slice-2a verb)');
  assert.match(t, /kosmos feedback show/, 'the self-check, so a report already written is left alone');
  assert.match(t, /about Kosmos itself/, 'product feedback about Kosmos itself, not the operator\'s own work');
  assert.match(t, /once a day/i, 'the cadence is daily');
  assert.match(t, /bugs did you hit today/i, 'Q1: bugs / not-wired-up');
  assert.match(t, /is anything broken/i, 'Q2: anything broken');
  assert.match(t, /make the app better/i, 'Q3: suggestions to improve');
  assert.match(t, /No usernames, agent names or project names, and never a key, token or password/, 'the no-identifiers rule');
});

test('#3563: the board\'s ask asks for a qualitative tasks note, in words, never counts', () => {
  const t = nudge();
  // Josh, 2026-09-24: tasks go INSIDE the existing report as the agent's own words ("good, bad, or ugly"), "not as a
  // separate actual numerical call".
  assert.match(t, /how are tasks going\?/i, 'Q4: the tasks question is asked');
  assert.match(t, /bad or ugly/i, 'Q4 invites the bad and the ugly, not only the good');
  assert.match(t, /anything that is stuck/i, 'Q4 asks what is stuck');
  assert.match(t, /do not count them: no task tallies/i, 'Q4 forbids task counts (no numerical task telemetry)');
  assert.doesNotMatch(t, /no numbers/i, 'the no-counts rule names tasks, not every number in the report');
  assert.match(t, /no task titles or what a task says/i, 'Q4 forbids lifting task titles or contents');
  // The lead-in names how many questions there are; it must agree with the list.
  const numbered = t.match(/(?:^| )\d\. /g) || [];
  const words = { 4: 'four', 5: 'five', 6: 'six', 7: 'seven' };
  assert.ok(numbered.length >= 4, 'the ask lists at least the four questions');
  assert.ok(words[numbered.length], 'extend the words map when a question is added');
  assert.match(t, new RegExp('these ' + words[numbered.length] + ' questions'), 'the lead-in count agrees with the numbered list');
});

test('the daily-feedback instruction is PM-scoped, not fleet-wide', () => {
  // The store is one file per day (engine/feedback.js: idempotent replace), so a
  // single designated author avoids clobbering. Targeting the PM matches the
  // plan's recorded decision and Josh's "probably the PM".
  for (const r of roles.ROLES.filter((r) => r.key !== 'pm')) {
    assert.doesNotMatch(r.instructions, /Once a day: help make Kosmos better/,
      `role '${r.key}' must NOT carry the daily-feedback section; it is PM-scoped`);
  }
  // Positive control: the pm role DOES carry it, so the negative sweep above is
  // meaningful rather than passing because the string appears in no role at all.
  assert.match(roles.byKey('pm').instructions, /Once a day: help make Kosmos better/,
    'the pm role must carry it (control for the negative sweep)');
});
