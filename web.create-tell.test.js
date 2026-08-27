'use strict';

/**
 * 🪦 THE CREATED-PING CHECKBOX IS GONE, AND THIS FILE IS ITS MARKER.
 *
 * It used to hold seven tests about `createTellPaint` and the three states of
 * the create-screen checkbox. Josh removed the setting on 2026-08-26, item 3:
 * "the 'Let the Kosmos team know when you create an agent' - they both need to
 * be removed." Both surfaces went: the Settings row first, then this one.
 *
 * ⭐ THE FILE IS KEPT RATHER THAN DELETED so that anyone who puts the control
 * back gets a red from the file named after it, instead of a green suite and a
 * silent send. Deleting it would leave the strongest signal about this decision
 * in a commit message nobody reads.
 *
 * The real guarantee now lives in engine/ping.test.js, which asserts the
 * control's ABSENCE and that the send defaults OFF together, because absence
 * alone is only half: a removed control over a default-on send is worse than
 * what he complained about and cannot be fixed by the person.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('the create-screen ping control, and its painter, are gone', () => {
  for (const gone of ['id="create-tell"', 'id="create-tell-wrap"', 'id="create-tell-note"',
    'function createTellPaint', 'refreshCreateTell']) {
    assert.equal(PAGE.includes(gone), false,
      gone + ' is back. If that is deliberate, engine/ping.js must stop defaulting the send ON in the same change.');
  }
});

test('the create screen itself is still there, so the absences above mean something', () => {
  assert.match(PAGE, /id="create-go"/);
  assert.match(PAGE, /id="create-instr"/);
});

test('and the create request no longer reads a control that does not exist', () => {
  /* The submit builder did `getElementById('create-tell').checked`. With the
     box gone that is a throw on the last click of the flow every new person
     walks, which is the worst place in the product to put one. */
  assert.doesNotMatch(PAGE, /getElementById\('create-tell'\)/);
  assert.match(PAGE, /b\.tellKosmos = false;/,
    'the create request stopped saying false explicitly, so the server default (true) takes over');
});
