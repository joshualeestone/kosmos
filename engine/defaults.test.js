'use strict';

/**
 * The operating defaults' own suite (#539). This file is cited by
 * defaults.js's no-em-dash comment and did not exist until the doctrine
 * seam landed; the first test below makes that comment true instead of
 * aspirational.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const defaults = require('./defaults');

test('the composed block carries no em dash, because it teaches that rule', () => {
  assert.ok(!defaults.block().includes('—'),
    'the block contains an em dash while instructing agents never to use one');
  assert.ok(!defaults.block().includes('–'), 'an en dash is the same rule in a thinner coat');
});

test('appendTo refuses to add the block twice, keyed on the sentence a person is least likely to reformat', () => {
  const once = defaults.appendTo('# My agent\n');
  assert.equal(defaults.appendTo(once), once);
});

/* ⚠️ THE PAIRING GUARD (#539). The doctrine version is only meaningful if it
   moves WITH the text: editing BLOCK without bumping quietly tells every
   agent it is current, and bumping without editing banners the whole fleet
   over nothing. So the fingerprint of the composed block is pinned against
   the version, and whichever half moves alone reds here with instructions.
   When you change the block ON PURPOSE: bump DOCTRINE_VERSION, add a line
   to its log, and update the fingerprint below to the one this failure
   prints. That is the whole ceremony, and it is deliberately one line of
   friction. */
test('the doctrine version and the block text move together', () => {
  const print = crypto.createHash('sha256').update(defaults.block()).digest('hex').slice(0, 16);
  /* Kept per version rather than replaced, so the log in defaults.js and this
     map can be read against each other. */
  const PINNED = { 3: '78435e4dc9286b30', 4: '3ea7865f183bff5b', 5: 'c424dc531fca1b91', 6: '6b112e796679a028' };
  assert.ok(PINNED[defaults.DOCTRINE_VERSION],
    `DOCTRINE_VERSION ${defaults.DOCTRINE_VERSION} has no pinned fingerprint: add {${defaults.DOCTRINE_VERSION}: '${print}'} here and a line to the version log in defaults.js`);
  assert.equal(print, PINNED[defaults.DOCTRINE_VERSION],
    `the block's text changed but DOCTRINE_VERSION did not: bump it, log it, and pin the new fingerprint '${print}'`);
});

/**
 * #1253. The block told every agent to report "Blocked: on what, and who owns
 * it" and, twenty lines later, to deliver it with `kosmos msg`. Same word and
 * same two fields as the board's own state, one destination named, and the
 * board never heard from anybody: measured on this machine, `needs_you` was 22
 * of 21,500 self-reports with 14 of those from test agents, and `blocked` was
 * 255 of which 245 were the StopFailure hook reporting a provider error.
 *
 * 🔑 Pinned as CONTENT rather than as a fingerprint. The version test above
 * catches any change to the block; this one says which change must not be
 * undone, so a future edit that quietly drops the verb goes red with a reason
 * instead of just moving a hash.
 */
test('#1253: the block names the two states the board cannot see for itself', () => {
  const b = defaults.block();
  assert.match(b, /kosmos report needs_you/,
    'the state that means a person must act is not named anywhere an agent reads');
  assert.match(b, /kosmos report blocked --on <what> --owner <who>/,
    'blocked is instructed as a message and never as a state');

  /* The condition is half the instruction, and the ORIGINAL condition was
     unsatisfiable. This guard used to pin the sentence "Only when you have
     actually stopped."

     🛑 THAT CONDITION AND THE NEVER-STOP RULE CANNOT BOTH HOLD. The block two
     sections above says an agent never stops and that nobody may authorise a
     stop. If `needs_you` may only be reported once you HAVE stopped, then a
     compliant agent can never report it at all. **That is this card's own
     measurement wearing its cause:** 22 needs_you in 21,500 records, 14 of them
     test agents.

     The real property, which is what the original comment was reaching for, is
     that the board must not sit permanently red. There are two ways to get a
     permanent red and only one of them was guarded:

       set it while still working  <- the old sentence guarded this
       leave it set after the answer arrives  <- nothing guarded this

     The second is the one that actually happens now that reporting and carrying
     on is correct, so the copy must say to CLEAR it. Pinned as the property
     rather than as a literal sentence, because a detector keyed on one wording
     goes red on a rewrite that preserves the meaning. */
  assert.match(b, /Clear it when it is answered/,
    'the copy never tells an agent to clear needs_you, so the red becomes permanent');
  assert.match(b, /always on gets walked past/,
    'the reason a stale red is harmful was dropped, leaving a rule with no why');
  assert.doesNotMatch(b, /Only when you have actually stopped/,
    'the unsatisfiable condition is back: it cannot hold beside the never-stop rule');

  /* 🔑 THE CONTROL: the four message-reports must still be there. This adds a
     destination, it does not replace the one that was already taught. */
  assert.match(b, /Report four things, to whoever you report to/,
    'the four message reports were dropped rather than added to');
  assert.match(b, /kosmos msg <name>/, 'the messaging verbs went with them');
});

test('sections are DERIVED from the block: they re-join to it byte-for-byte', () => {
  const rejoined = defaults.sections().map((s) => s.text).join('\n');
  assert.equal(rejoined, defaults.block());
  assert.ok(defaults.sections().length >= 10, 'the block lost most of its sections');
  assert.equal(defaults.sections()[0].heading, '## How you work, whatever the job');
});

test('missingFrom names what a file lacks, and a complete file lacks nothing', () => {
  const full = defaults.appendTo('# My agent\n');
  assert.deepEqual(defaults.missingFrom(full), []);
  const none = defaults.missingFrom('# My agent\n\nJust my own words.\n');
  assert.equal(none.length, defaults.sections().length, 'a block-less file is not missing every section');
  /* A file with SOME sections: the person kept two, the refresh offers the
     rest and never the two they have -- heading-match presence, which the
     consent dialog makes safe by showing exactly what would be added. */
  const partial = '# My agent\n\n## How you work, whatever the job\n\nedited by hand\n\n### Never wait silently\n\nmy version\n';
  const missing = defaults.missingFrom(partial);
  assert.ok(!missing.some((s) => s.heading === '### Never wait silently'), 'a section the person carries was offered again');
  assert.ok(!missing.some((s) => s.heading === '## How you work, whatever the job'));
  assert.ok(missing.some((s) => s.heading === '### When you have been wrong'), 'an absent section was not offered');
});

/**
 * #1272. Josh, after roughly ten consecutive nights of the same thing: an agent
 * hits something that needs a decision, asks, and waits.
 *
 * 🔑 PINNED AS CONTENT, not as a fingerprint, for the same reason as #1253
 * above: the version test catches ANY change to the block; this one says which
 * changes must not be made.
 *
 * ⚠️ THE CLAUSE THAT MATTERS MOST IS "nobody may authorise a stop". On
 * 2026-08-27 all six agents on this fleet behaved CORRECTLY by the rule they
 * had and three ended the night waiting on the operator, because a supervisor
 * told them a named blocker counted as a clean stop. A rule that binds only the
 * agent asking cannot survive the person answering.
 */
test('#1272: the block grants the decision rather than forbidding the stop', () => {
  const b = defaults.block();

  // The floor is checkable; "keep working" is an intention and emits no signal.
  assert.match(b, /The floor is not "stop"\. The floor is "move to other work\."/);

  // The clause the previous attempts were missing.
  assert.match(b, /Nobody may authorise a stop/);
  assert.match(b, /permission IS the failure/);

  // A decidable test, not a judgement about importance.
  assert.match(b, /can it be undone/i);

  // Ask for decisions, never for data (Josh, 07:57).
  assert.match(b, /Ask them for decisions, never for data/);
  assert.match(b, /lazy in a way that looks diligent/);
  assert.match(b, /before you ask for a ruling, check whether one already exists/i);

  // The unit is defined and the tracker is optional (Josh, 07:15).
  assert.match(b, /WHATEVER YOUR SYSTEM\s+CALLS IT/);
  assert.match(b, /does not require a tracking system at all/);
});

test('#1272: neither report command is described as something you do after stopping', () => {
  const b = defaults.block();
  /* 🛑 THE ACTUAL DEFECT. The block already said "you find the next unblocked
     thing" at the top, and forty lines below gave two commands whose stated
     precondition was "when you have stopped" -- one of them ranked "the one
     that matters most". Prose forbade stopping; the tooling anticipated it and
     ranked it, and an agent reconciles that the only way it can. */
  assert.doesNotMatch(b, /when you have stopped/,
    'a report command is described as something you do after stopping, which is how '
    + 'the tooling grants what the prose forbids');
  // Both states are about the item, and both say to carry on.
  assert.match(b, /when THIS ITEM is parked/);
  assert.match(b, /when THIS ITEM needs an answer/);
  assert.match(b, /it marks\s+the item, it does not park you/);
});

test('#1272 CONTROL: the same reader would notice if those clauses were gone', () => {
  /* Without this, every assertion above passes on a build where `block()`
     returned the whole file, or any superset. It must be able to say NO. */
  const b = defaults.block();
  assert.doesNotMatch(b, /zzz-pete-not-in-the-block/);
  assert.ok(b.length > 2000 && b.length < 40000, `block is ${b.length} chars`);
});

/**
 * #1253: THE VERBS MUST BE DELIVERABLE, NOT MERELY PRESENT.
 *
 * 🛑 THIS IS THE PROPERTY THAT FAILED TWICE AND THAT EVERY OTHER TEST HERE IS
 * BLIND TO. Version 4 added the two board verbs and version 5 re-aimed them,
 * and both landed inside `### Telling people what is happening` -- a heading
 * every existing agent already holds. `missingFrom` filters on the HEADING, so
 * neither edit was ever re-offered to anybody. Measured 2026-08-28: 8 agents
 * created ever, 0 since #1255 merged, 8 before it as the control. Not one agent
 * has ever received the verbs.
 *
 * ⭐ An assertion that the words appear in `block()` passes in exactly that
 * situation, which is why both fixes shipped believing themselves delivered.
 * The question is not "is the text there" but "can an agent that already exists
 * still be given it".
 */
test('#1253: an agent holding the old headings is still offered the two verbs', () => {
  const all = defaults.sections();
  const owner = all.filter((s) => /kosmos report needs_you/.test(s.text));
  assert.equal(owner.length, 1, 'the verbs are duplicated across sections, or gone');

  /* A legacy agent: it holds every heading EXCEPT the one carrying the verbs.
     This is the real shape of the 8 agents on this machine. */
  const legacy = all.filter((s) => s.heading !== owner[0].heading)
    .map((s) => s.heading + '\n' + s.text).join('\n\n');

  const offered = defaults.missingFrom(legacy);
  assert.ok(offered.some((s) => /kosmos report needs_you/.test(s.text)),
    'a legacy agent would never be offered needs_you: the verbs sit under a heading it already has');
  assert.ok(offered.some((s) => /kosmos report blocked --on/.test(s.text)),
    'same for blocked, which is the other state the board cannot see for itself');

  /* CONTROL, and without it the assertions above are vacuous: missingFrom must
     be able to return NOTHING. An agent holding everything is offered nothing,
     so a passing result above means the filter actually discriminated. */
  const complete = all.map((s) => s.heading + '\n' + s.text).join('\n\n');
  assert.equal(defaults.missingFrom(complete).length, 0,
    'missingFrom offers sections to an agent that already has them all, so it is not filtering');
});

test('#1253 CONTROL: the delivery guard fails when the verbs move to an old heading', () => {
  /* Proves this file can detect the exact regression it was written for, rather
     than passing because everything happens to be fine today. It reproduces the
     bug by construction: put the verbs in a section a legacy agent holds. */
  const all = defaults.sections();
  const owner = all.find((s) => /kosmos report needs_you/.test(s.text));
  const older = all.find((s) => s.heading === '### Telling people what is happening');
  assert.ok(older, 'the section version 4 and 5 put the verbs in has been renamed');

  const moved = all.map((s) => s.heading === older.heading
    ? { heading: s.heading, text: s.text + '\n' + owner.text }
    : s).filter((s) => s.heading !== owner.heading);
  const legacy = moved.map((s) => s.heading + '\n' + s.text).join('\n\n');
  const offered = moved.filter((s) => !legacy.includes(s.heading));
  assert.ok(!offered.some((s) => /kosmos report needs_you/.test(s.text)),
    'the regression is not detectable: a legacy agent would still somehow be offered the verbs');
});
