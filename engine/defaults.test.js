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
  const PINNED = { 3: '78435e4dc9286b30', 4: '3ea7865f183bff5b', 5: 'c424dc531fca1b91' };
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

  /* The condition is half the instruction. A needs_you reported by an agent
     that has NOT stopped paints the board red permanently, and a red that is
     always on is the same as no red. */
  assert.match(b, /Only when you have actually stopped/,
    'the copy tells an agent to report needs_you without saying when not to');

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
