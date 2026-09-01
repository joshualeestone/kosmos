'use strict';

/**
 * kosmos#1214: the first-run Accessibility offer.
 *
 * Josh, main channel 2026-08-27, three screenshots: an agent's work triggered
 * the macOS "tmux wants access to control System Events / Accessibility" prompt
 * mid-task, and he wanted it turned on up front so the user is never ambushed.
 * The literal "grant it during install" cannot be built (TCC: only the user can
 * grant Accessibility, in System Settings). The achievable version, ruled by
 * Josh on 2026-09-01, is OFFER-not-require: a first-run step that explains it and
 * opens the setting, with Continue proceeding either way and a sentence pointing
 * at where to do it later.
 *
 * This pins the wiring and, most importantly, the LOCATION: the offer names the
 * Settings box that ACTUALLY holds the same button, so a Settings reorganisation
 * cannot leave the direction pointing at a pane that moved (Splinter: "pin the
 * LOCATION, not just the words").
 *
 *   node --test web.firstrun-a11y-1214.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

/* The offer's own pane, sliced by the two panes that bracket it in FILE order:
   the Accessibility pane is fr-pane-5 (placed right after the model pane), and
   About-you is fr-pane-6. */
const OFFER = PAGE.slice(PAGE.indexOf('id="fr-pane-5"'), PAGE.indexOf('id="fr-pane-6"'));

test('kosmos#1214: the first-run Accessibility pane offers the button and an out', () => {
  assert.ok(OFFER.indexOf('id="fr-pane-5"') > -1 && OFFER.length > 0, 'the offer pane exists');
  assert.match(OFFER, /id="fr-a11y-open"/, 'it has its own Open Accessibility settings button');
  assert.match(OFFER, /work in your other applications on this computer/i,
    'it explains the benefit in the plain words Josh ruled, not the reassuring ones');
  assert.match(OFFER, /optional/i, 'it says the offer is optional -- Josh ruled offer-not-require');
});

test('kosmos#1214: the offer reuses the SAME action as the Settings button, not a new mechanism', () => {
  // The firstrun button and the Settings button both open the one endpoint.
  const handler = SCRIPT.slice(SCRIPT.indexOf("getElementById('fr-a11y-open')"),
    SCRIPT.indexOf("getElementById('fr-a11y-open')") + 800);
  assert.match(handler, /fetch\('\/api\/open-accessibility-settings', \{ method: 'POST' \}\)/,
    'the firstrun button POSTs the same open-accessibility-settings endpoint the Settings button does');
  // And the Settings button still exists and uses the same endpoint (the source of truth).
  assert.match(SCRIPT, /getElementById\('set-a11y-open'\)[\s\S]{0,400}\/api\/open-accessibility-settings/,
    'the Settings button is unchanged and shares the endpoint');
});

test('kosmos#1214: LOCATION pin -- the offer names the box that actually holds the button', () => {
  // Walk from the real Settings button back to the heading of the box it sits
  // in. That heading is the ground truth for "where you turn this on later".
  const btnIdx = PAGE.indexOf('id="set-a11y-open"');
  assert.ok(btnIdx > -1, 'the Settings accessibility button exists');
  const before = PAGE.slice(0, btnIdx);
  const hIdx = before.lastIndexOf('<h3 class="dlab"');
  assert.ok(hIdx > -1, 'the button sits under a labelled Settings box');
  const boxLabel = PAGE.slice(hIdx).match(/<h3 class="dlab"[^>]*>([^<]+)<\/h3>/)[1].trim();
  assert.equal(boxLabel, 'Keeping agents running',
    'sanity: the box holding the button is the one this offer names');

  // The property that matters: the firstrun offer points a person at THAT box by
  // its real name. If Settings renames or moves the box, this fails rather than
  // leaving a wrong direction on a live screen.
  assert.ok(OFFER.includes(boxLabel),
    'the first-run offer must name the box that actually holds the button ('
    + boxLabel + '); a Settings reorganisation would break this, which is the point');
});

test('kosmos#1214: the step is wired -- 7 steps, Accessibility at 5, Continue proceeds without granting', () => {
  assert.match(SCRIPT, /const FR_STEPS = 7;/, 'the wizard now has 7 steps');
  assert.match(SCRIPT, /const FR_STEP_YOU = 6;/, 'About-you moved to step 6');
  assert.match(SCRIPT, /5: 'Accessibility', 6: 'About you', 7: 'Your agents'/,
    'the eyebrows place Accessibility at 5, About-you at 6, the fleet at 7');
  // Step 5's branch sets a title and a Continue that goes to step 6 regardless of
  // whether the person opened the setting (offer-not-require: no gate on Continue).
  const step5 = SCRIPT.slice(SCRIPT.indexOf('} else if (step === 5) {'),
    SCRIPT.indexOf('} else if (step === 6) {'));
  assert.match(step5, /fr-title'\)\.textContent = '[^']*your other apps/i, 'step 5 sets its own title');
  assert.match(step5, /frActions\(\{ label: 'Continue', go: \(\) => frGo\(6\) \}\)/,
    'Continue proceeds to About-you (step 6) with no second gate -- the offer is not required');
  // frActions is called with a SINGLE argument (just the primary Continue): no
  // alt, no conditional go, so nothing gates proceeding on the grant. (Contrast
  // the About-you step, whose Continue waits on two required fields.)
  const actionsCall = step5.match(/frActions\([\s\S]*?\}\);/);
  assert.ok(actionsCall && !/\bnext\.disabled\b|aria-disabled|if \(next\.disabled\)/.test(actionsCall[0]),
    'the step-5 actions do not gate Continue on anything');
});

test('kosmos#1214: no em dashes in the offer copy (house rule)', () => {
  for (const spelling of ['—', '&mdash;', '&#8212;', '&#x2014;', '\\u{2014}']) {
    assert.ok(!OFFER.includes(spelling), 'an em dash (' + spelling + ') reached the offer copy');
  }
});
