'use strict';

/**
 * kosmos#990 (Josh, 2026-08-26): "prepopulate that with what it is currently
 * running on... we don't need to write the words 'change to'".
 *
 * 🛑 THE DANGEROUS HALF OF THIS CHANGE IS NOT THE WORDS. Prepopulating a menu
 * whose button was gated on "is anything selected" makes that button LIVE ON
 * ARRIVAL. One click would then restart a running agent onto the model it is
 * already on. So the pins below are mostly about the BUTTON, not the labels.
 *
 *   node --test web.runs-on-990.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the words Josh asked to remove are gone from both menus', () => {
  assert.ok(!/<option value="">Change to/.test(PAGE),
    'a "Change to..." placeholder is back, so a menu no longer answers what the agent is on');
  assert.ok(!/Change to&hellip;/.test(PAGE),
    'the Change to wording survives somewhere in the Runs on row');
});

/* BOTH sites that can enable Switch & Restart must compare against the current
   model. Two separate paths, and fixing one is the exact half-fix this card
   invites: the change handler only fires if the person TOUCHES the menu, so a
   paint-path miss ships a button that is live before anyone clicked anything.
   Each gate is extracted from its OWN function rather than grepped page-wide --
   a page-wide sweep also catches the account picker, which is correct by a
   different route (it gives the current option an EMPTY value, so `!sel.value`
   disables the button on its own) and would make this test lie about it. */
function fnBody(startsWith) {
  const a = PAGE.indexOf(startsWith);
  assert.ok(a > -1, 'anchor moved: ' + startsWith);
  const b = PAGE.indexOf('\nfunction ', a + 1);
  return PAGE.slice(a, b === -1 ? undefined : b);
}

test('the paint path cannot arm Switch & Restart on arrival', () => {
  const body = fnBody('async function paintModelPicker(a) {');
  const gate = (body.match(/go\.disabled = [^\n;]+/) || [])[0];
  assert.ok(gate, 'paintModelPicker no longer gates the button at all');
  assert.match(gate, /dataset\.current/,
    'the paint gate does not compare against the current model, so opening an agent arms Switch & Restart: ' + gate);
});

test('the change path cannot arm Switch & Restart on the model already running', () => {
  const a = PAGE.indexOf("document.getElementById('d-model').addEventListener('change'");
  assert.ok(a > -1, 'the d-model change handler moved');
  const gate = (PAGE.slice(a, PAGE.indexOf('});', a)).match(/go\.disabled = [^\n;]+/) || [])[0];
  assert.ok(gate, 'the d-model change handler no longer gates the button');
  assert.match(gate, /dataset\.current/,
    'picking the model the agent is already on leaves Switch & Restart live: ' + gate);
});

test('the provider gate still refuses a no-op switch', () => {
  assert.match(PAGE, /go\.disabled = !e\.target\.value \|\| !CURRENT \|\| e\.target\.value === providerOf\(CURRENT\)/,
    'the provider button no longer refuses the provider the agent is already on');
});

/* The two model tables diverge TODAY (status.js knows Claude Opus 4.8, the
   picker's create.js does not), so an agent can be on a model with no key.
   That agent must still see what it is on, and must NOT be offered it as a
   choice we cannot send. */
test('a model the picker has no key for is still stated, and is not offered', () => {
  assert.match(PAGE, /'<option value="" selected>' \+ esc\(runningName \|\| 'We cannot tell'\) \+ '<\/option>'/,
    'the unmatched-model arm is gone, so an agent on a model the menu cannot offer shows the wrong one as selected');
  assert.match(PAGE, /sel\.dataset\.current = currentModel \? currentModel\.key : '';/,
    'the current key is no longer recorded on the element, so both button gates silently compare against nothing');
});

test('the current provider is selectable, or it could not be shown as selected', () => {
  assert.match(PAGE, /if \(opt\.value === 'anthropic' \|\| opt\.value === 'openai'\) opt\.disabled = false;/,
    'the current provider option is being disabled again, which defeats the prepopulation it is meant to show');
});
