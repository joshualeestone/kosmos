'use strict';

/**
 * #539's two surfaces hold Mona Lisa's rulings verbatim, and the consent
 * mechanics are the ones the engine's contract requires. Source-level pins:
 * the engine's behaviour is driven end-to-end in server.test.js and
 * engine/doctrine.test.js; what can rot HERE is the copy and the wiring,
 * so that is what these hold.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

test('the banner is quiet and says missing-a-block, never behind', () => {
  assert.ok(SCRIPT.includes('was made before Kosmos’s working rules.'),
    'the ruled banner sentence is gone');
  const note = PAGE.match(/<div class="([^"]*)" id="d-doctrine-note"/);
  assert.ok(note && note[1].includes('fhint') && !note[1].includes('stale-note'),
    'the banner wears the warning tint the ruling forbids');
  assert.ok(PAGE.includes('id="d-doctrine-later"'), 'Not now is missing');
});

test('the dialog shows the change before the click: body sentence, headings list, and the Show-them fold', () => {
  assert.ok(PAGE.includes('Your words stay exactly as they are. These go underneath, under their own heading, so you can see where yours end and ours begin.'));
  assert.ok(PAGE.includes('id="doc-fold-text"'), 'the full-text fold is gone');
  assert.ok(/id="doc-keep"[^>]*>Keep as it is</.test(PAGE), 'the harmless answer lost its ruled words');
  assert.ok(SCRIPT.includes("document.getElementById('doc-keep').focus()"),
    'the harmless answer does not open focused');
  /* Keep before Add in the DOM, so tab order and the ruling agree. */
  assert.ok(PAGE.indexOf('id="doc-keep"') < PAGE.indexOf('id="doc-go"'));
});

test('the click writes what the dialog showed: the plan hash rides the refresh POST', () => {
  const go = SCRIPT.slice(SCRIPT.indexOf("getElementById('doc-go')"), SCRIPT.indexOf("getElementById('doc-go')") + 900);
  assert.ok(go.includes('doctrine/refresh') && go.includes('hash: plan.hash'),
    'the consent no longer proves which composition it consented to');
});

test('the fleet click is consent for the LISTED names only, and its verdicts are the ruled sentences', () => {
  const go = SCRIPT.slice(SCRIPT.indexOf("getElementById('docf-go')"), SCRIPT.indexOf("getElementById('docf-go')") + 1400);
  assert.ok(go.includes('names: DOCF_NAMES'), 'the fleet POST sends something other than the listed names');
  assert.ok(SCRIPT.includes('you said Not now for '), 'the declined verdict sentence is gone');
  assert.ok(SCRIPT.includes('Already has them.'), 'the already-current verdict is gone');
  assert.ok(SCRIPT.includes('will get the working rules'), 'the changing list stopped naming its consequence');
});

test('the fleet button lives in Advanced with the ruled label, and no sentence anywhere carries an em dash', () => {
  assert.ok(PAGE.includes('Add the working rules to every agent that is missing them&hellip;'));
  const mine = [
    PAGE.slice(PAGE.indexOf('d-doctrine-note'), PAGE.indexOf('d-doctrine-note') + 700),
    PAGE.slice(PAGE.indexOf('doc-modal'), PAGE.indexOf('rst-modal')),
    SCRIPT.slice(SCRIPT.indexOf('DOCTRINE_PLAN'), SCRIPT.indexOf('function renderStale')),
  ].join('\n');
  assert.ok(!mine.includes('—'), 'an em dash crept into the consent surfaces');
});
