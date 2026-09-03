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

test('kosmos#1214/#1940: the first-run Accessibility pane offers the button, and Continue is the out', () => {
  assert.ok(OFFER.indexOf('id="fr-pane-5"') > -1 && OFFER.length > 0, 'the offer pane exists');
  assert.match(OFFER, /id="fr-a11y-open"/, 'it has its own Open Accessibility settings button');
  // #1940 (Josh's copy, Mona Lisa's design): the copy names the exact action.
  // Anchored on the second line of the copy (the first, "...Turn on", wraps in the
  // source, so a single-space match across the newline would miss).
  assert.match(OFFER, /'Tmux' in Accessibility to enable this/,
    'the copy names the exact action -- turn on Tmux in Accessibility (Josh ruled the plain words, not the reassuring ones)');
  // #1940 removed the in-pane "This one is optional ... or later in Settings" line
  // (Josh's copy). The offer-not-require RULING is unchanged; the out is now the
  // shared Continue button, not an in-pane sentence. Assert the MECHANISM, not the
  // deleted wording: step 5's Continue proceeds to frGo(6) unconditionally (no gate).
  assert.match(SCRIPT, /step === 5[\s\S]{0,1000}frActions\(\{ label: 'Continue', go: \(\) => frGo\(6\) \}\)/,
    'the Accessibility step Continue proceeds unconditionally (offer-not-require preserved via Continue)');
  assert.doesNotMatch(OFFER, /This one is optional/,
    '#1940: the redundant in-pane optional line is gone -- Continue is the out');
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

test('kosmos#1214/#1940: the Settings box name is stable; #1940 removed the first-run "later in Settings" pointer', () => {
  // The Settings side is unchanged: the accessibility toggle still sits under the
  // "Keeping agents running" box. This stays the ground truth for where you turn
  // it on later.
  const btnIdx = PAGE.indexOf('id="set-a11y-open"');
  assert.ok(btnIdx > -1, 'the Settings accessibility button exists');
  const before = PAGE.slice(0, btnIdx);
  const hIdx = before.lastIndexOf('<h3 class="dlab"');
  assert.ok(hIdx > -1, 'the button sits under a labelled Settings box');
  const boxLabel = PAGE.slice(hIdx).match(/<h3 class="dlab"[^>]*>([^<]+)<\/h3>/)[1].trim();
  assert.equal(boxLabel, 'Keeping agents running',
    'sanity: the box holding the button is the one this offer names');

  // The #1214 property that matters: the first-run offer POINTS a person at THAT
  // box by its real name, so a Settings reorganisation fails here rather than
  // leaving a wrong direction on a live screen. #1940 REWORDED the pointer (Mona
  // Lisa's decision after I flagged that deleting the whole line silently reverted
  // this out): the pushy "This one is optional ... now, or later" framing is gone,
  // but the orientation "You can turn this on anytime in Settings, under Keeping
  // agents running" stays -- so the location pin still holds.
  assert.ok(OFFER.includes(boxLabel),
    'the first-run offer must name the box that actually holds the button ('
    + boxLabel + '); a Settings reorganisation would break this, which is the point');
  assert.doesNotMatch(OFFER, /This one is optional/,
    '#1940: the pushy "optional / now-or-later" framing is gone (the pointer stays, reworded)');
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
