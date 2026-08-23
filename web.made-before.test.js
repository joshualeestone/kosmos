'use strict';

/**
 * #149/#150: an agent with no launch file says "Made before Kosmos recorded
 * this" instead of "Unknown Model", and the model picker refuses in the
 * state's own words with the way in.
 *
 * The server decides `neverRecorded` (tied pane, no plist: engine/status.js);
 * these pins hold the SCREEN's half: every surface splits on the flag rather
 * than re-deriving it, and the fault wording survives for the state that IS
 * a fault. Delete the flag from modelLine and the first pair goes red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

/* modelLine reads cardStOf(a).pres only to pick WHICH name wins; both states
   under test carry no name at all, so a stub answering 'off' for everything
   cannot decide the assertion. Stubbed rather than lifted because cardStOf
   drags the CARD_ST table with it, and the table is not what this test pins. */
function runModelLine(agent) {
  const src = liftAll(SCRIPT, ['modelLine']);
  const run = new Function('a', `
    const cardStOf = () => ({ pres: 'off' });
    ${src}
    return modelLine(a);
  `);
  return run(agent);
}

test('no model and no launch file reads as history; no model WITH one stays the admission', () => {
  assert.equal(runModelLine({ neverRecorded: true }), 'Made before Kosmos recorded this',
    'the never-recorded state still reads as a lookup fault');
  assert.equal(runModelLine({ neverRecorded: false }), 'Unknown Model',
    'the fault state was relabelled as history, which hides a breakage');
  /* An absent flag (an old server, a stranger row) must fail toward the
     admission: claiming history needs the server to have said so. */
  assert.equal(runModelLine({}), 'Unknown Model',
    'a row that never carried the flag was given the history sentence');
  /* And a model name beats the flag: the sentence is only for the state with
     nothing to show. */
  assert.equal(runModelLine({ neverRecorded: true, plannedModelName: 'Claude Sonnet 5' }), 'Claude Sonnet 5',
    'a readable model was displaced by the history sentence');
});

test('the picker and the explainer both name the way in, and only for the never-recorded state', () => {
  /* Text-level pins on the page: the wording ruled on card #150, the
     migration path, and the #362 reason the path is gated. Each pin anchors
     on text UNIQUE to its surface: the first version of the explainer pin
     matched the picker's sentence too, so deleting the explainer's path
     left it green while its failure message named the wrong survivor. */
  assert.match(PAGE, /Made before Kosmos recorded how it starts, so there is no launch file to change\. /,
    'the picker refusal no longer names the state');
  assert.match(PAGE, /add it from Found agents in Settings to bring it in/,
    'the picker refusal no longer names the way in');
  assert.match(PAGE, /waiting will not add one\. /,
    'the runs-on explainer no longer says the state is permanent');
  assert.match(PAGE, /To bring it in: stop it, then add it from Found agents in Settings/,
    'the runs-on explainer no longer names the migration path for a running agent');
  assert.match(PAGE, /To bring it in: add it from Found agents in Settings/,
    'the runs-on explainer no longer has the stopped wording, so a stopped agent is told to stop');
  assert.match(PAGE, /will not write a launch file while it runs some other way/,
    'the running-state reason (the #362 gate) is gone');
  /* The explainer element exists and starts hidden, so every OTHER agent
     shows nothing rather than a stale sentence. */
  assert.match(PAGE, /id="d-runson-why" hidden/,
    'the explainer does not start hidden, so it can linger across an agent switch');
  /* And the model-message slot is cleared at the switch moment, so one
     agent's refusal cannot stand on another's panel. Structural pin on the
     clear living in openDetail, before the paints. */
  const od = PAGE.slice(PAGE.indexOf('function openDetail('), PAGE.indexOf('function openDetail(') + 4000);
  assert.ok(/d-model-msg/.test(od),
    'openDetail no longer clears the model message, so a refusal lingers across an agent switch');
});
