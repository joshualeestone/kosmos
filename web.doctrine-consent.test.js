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

/* #863 (Josh, 2026-08-25 10:41): "It just sort of printed out text that
   said 'Added' but then it just sat there on that screen... 'These were
   added. You can close this dialog.'" A bare "Added." left both buttons
   standing as if nothing changed: "Add them" still inviting a redundant
   second click, "Keep as it is" describing a state that no longer
   existed. */
test('a successful Add tells the person it is done and gives them the one thing left to do', () => {
  const at = SCRIPT.lastIndexOf("getElementById('doc-go').addEventListener");
  const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});', at));
  assert.match(handler, /msg\.textContent = 'Added\. You can close this dialog\.'/,
    'the bare "Added." dead-end is still there');
  assert.match(handler, /getElementById\('doc-go'\)\.disabled = true/,
    'Add them stays clickable after it already added them');
  assert.match(handler, /keep\.textContent = 'Close'/,
    'Keep as it is still describes a state that no longer exists once something was added');
  assert.match(handler, /keep\.focus\(\)/,
    'focus does not move to the one thing left to do');
  // The open handler resets both controls, so a later open (even for a
  // different agent) never inherits the last one's post-success state.
  const openAt = SCRIPT.indexOf("getElementById('d-doctrine-add').addEventListener");
  const openHandler = SCRIPT.slice(openAt, SCRIPT.indexOf('\n});', openAt));
  assert.match(openHandler, /querySelector\('#doc-go'\)\.disabled = false/,
    'a fresh open does not reset Add them back to enabled');
  assert.match(openHandler, /getElementById\('doc-keep'\)\.textContent = 'Keep as it is'/,
    'a fresh open does not reset Keep as it is back to its own label');
});

/* kosmos#1002 removed the fleet-wide button, so its label pin went with it.
   The em-dash guard did NOT: it is Josh's rule across every consent sentence
   and it merely happened to live in the same test as the thing being deleted.
   Splitting it out is the point -- a removal must not quietly take a guard
   with it just because they shared a function. */
test('no consent sentence anywhere carries an em dash', () => {
  const mine = [
    PAGE.slice(PAGE.indexOf('d-doctrine-note'), PAGE.indexOf('d-doctrine-note') + 700),
    PAGE.slice(PAGE.indexOf('doc-modal'), PAGE.indexOf('rst-modal')),
    SCRIPT.slice(SCRIPT.indexOf('DOCTRINE_PLAN'), SCRIPT.indexOf('function renderStale')),
  ].join('\n');
  assert.ok(!mine.includes('—'), 'an em dash crept into the consent surfaces');
});

test('the consent dialog carries the full modal machinery, not adjacency (Angel’s review of #643)', () => {
  /* Source pins for the wiring; the BEHAVIOUR (trap both directions,
     Escape, focus-return, accidental Enter landing harmless) is driven
     headed in tools/headed-doctrine-check.js, because a static pin cannot
     catch a leaked keystroke. */
  assert.ok(SCRIPT.includes("['doc-modal', ['doc-fold-sum', 'doc-keep', 'doc-go'], 'doc-keep']"),
    'doc-modal left the shared Tab-trap list');
  assert.ok(SCRIPT.includes('if (!document.getElementById(\'doc-modal\').hidden) closeDocModal();'),
    'doc-modal left the shared Escape listener');
  assert.ok(SCRIPT.includes('function closeDocModal'),
    'the close function with focus-return is gone');
  assert.ok(SCRIPT.includes("e.target.id === 'doc-modal'"),
    'a backdrop click no longer closes');
  /* kosmos#1002: the fleet dialog is gone, so assert it is GONE rather than
     dropping the line. A deleted assertion and a satisfied one look identical
     in a green run; this one fails if the removal is ever half-reverted. */
  assert.ok(!SCRIPT.includes('docf-modal') && !PAGE.includes('docf-modal'),
    'the removed fleet dialog is back in the page or the script');
  assert.ok(PAGE.includes('id="doc-fold-sum"'),
    'the fold summary lost its id, so the trap cannot list the tab stop and shift-Tab leaks backwards');
});

