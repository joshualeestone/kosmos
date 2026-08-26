'use strict';

/**
 * The footer offers the control that matches the state (#995).
 *
 * Josh, 2026-08-26 11:26, with a screenshot: *"if we could put a 'reload'
 * button so it would be like 'Reload' to update to Beta Version 0.5.66. Right
 * now it tells me twice to reload but the only button is Check For Update. If
 * we know there is an update available we dont need the 'Check for Update'."*
 *
 * 🛑 THE BUG WAS POSITIONAL. `putBtn('Check for Update')` sat OUTSIDE the
 * branch that knows the page is stale, so in the one state where Kosmos has
 * already determined the answer, the only control offered to go and ask it.
 *
 * ⚠️ AND THE BUTTON IS NOT GATED ON `UPD_ASKED` WHILE THE SENTENCE IS. That
 * asymmetry is the fix, not an oversight: a verdict answers a question and
 * until somebody asks there is none, but a control is not a verdict. Josh
 * never pressed Check -- the news reached him from the build line, which
 * announces staleness unasked. A button gated on UPD_ASKED leaves his
 * screenshot exactly as it was, which is why the ungated case is asserted
 * FIRST below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/**
 * Drives the REAL paintUpdateCard against a stub document, so a drift in the
 * shipped function is a red test rather than a restatement that stays green.
 */
function paint({ baked, running, asked, look, offer }) {
  const btn = { textContent: '', dataset: {}, hidden: true, disabled: true };
  const line = { textContent: '' };
  const doc = {
    getElementById: (id) => (id === 'upd-btn' ? btn : line),
    querySelector: () => ({ getAttribute: () => baked }),
  };
  // eslint-disable-next-line no-new-func
  new Function('document', 'UPD_ASKED', 'UPD_CHECKING', 'RUNNING', 'LOOK', 'OFFER',
    page.liftAll(SCRIPT, ['bakedVersion', 'pageIsStale', 'paintUpdateCard'])
    + '\npaintUpdateCard(RUNNING, OFFER, LOOK);')(doc, asked, false, running, look, offer);
  return { label: btn.textContent, act: btn.dataset.act, line: line.textContent };
}

const LOOKED = { looked: true, reached: true, readable: true };

test("⭐ Josh's exact case: stale page, never pressed Check -- the button says Reload", () => {
  const r = paint({ baked: '0.5.65', running: '0.5.66', asked: false, look: LOOKED });
  assert.equal(r.label, 'Reload', 'the one state where Kosmos knows the answer still offered to go and ask it');
  assert.equal(r.act, 'reload');
  /* The sentence stays gated: he asked for the button, not for a verdict he
     did not request. The build line above already carries the news. */
  assert.equal(r.line, '', 'an unasked verdict appeared alongside the fix');
});

test('stale page after a check: the button is Reload AND the verdict is the stale one', () => {
  const r = paint({ baked: '0.5.65', running: '0.5.66', asked: true, look: LOOKED });
  assert.equal(r.label, 'Reload');
  assert.equal(r.act, 'reload');
  assert.match(r.line, /older than the Kosmos running it/);
});

test('CONTROL: a page that is NOT stale keeps Check for Update', () => {
  /* Without this, the two above would pass on a build that had simply
     relabelled the button everywhere, which would take away the only control
     that exists when there is genuinely nothing to reload for. */
  const r = paint({ baked: '0.5.66', running: '0.5.66', asked: true, look: LOOKED });
  assert.equal(r.label, 'Check for Update');
  assert.equal(r.act, 'check');
  assert.equal(r.line, 'Up to date.');
});

test('CONTROL: an offer still wins -- Update is not replaced by Reload', () => {
  /* An offer means bytes to install, which is a different act from repainting
     a page, and it has a confirm in front of it. A stale page underneath an
     offer must not downgrade the button to Reload. */
  const r = paint({
    baked: '0.5.65', running: '0.5.66', asked: true, look: LOOKED, offer: { version: '0.5.70' },
  });
  assert.equal(r.label, 'Update');
  assert.equal(r.act, 'update');
});

test('the click handler acts on the reload act, and does it without a confirm', () => {
  /* Nothing is installed and nothing is irreversible, so unlike Update this
     one does not open the confirm dialog. Asserted against the shipped source
     rather than by driving the DOM, because the act is a location.reload(). */
  const handler = page.liftAll(SCRIPT, ['updCheckNowClick']);
  const at = handler.indexOf("dataset.act === 'reload'");
  assert.notEqual(at, -1, 'the reload act has no branch in the click handler');
  const arm = handler.slice(at, handler.indexOf("dataset.act === 'update'"));
  assert.match(arm, /location\.reload\(\)/, 'the reload arm does not reload');
  assert.doesNotMatch(arm, /updconfirm/, 'the reload arm opens the install confirm');
});
