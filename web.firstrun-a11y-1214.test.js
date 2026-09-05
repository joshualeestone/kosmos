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

test('kosmos#1214/#1940/#2125: the first-run Accessibility pane offers the button, and Continue is now GATED', () => {
  assert.ok(OFFER.indexOf('id="fr-pane-5"') > -1 && OFFER.length > 0, 'the offer pane exists');
  assert.match(OFFER, /id="fr-a11y-open"/, 'it has its own Open Accessibility settings button');
  // #1940 (Josh's copy, Mona Lisa's design): the copy names the exact action.
  // Anchored on the second line of the copy (the first, "...Turn on", wraps in the
  // source, so a single-space match across the newline would miss).
  assert.match(OFFER, /'Tmux' in Accessibility to enable this/,
    'the copy names the exact action -- turn on Tmux in Accessibility (Josh ruled the plain words, not the reassuring ones)');
  // #2125 slice 3 (Josh, 2026-09-04) SUPERSEDES #1214's offer-not-require: step 5's
  // Continue is now GATED on a real Accessibility check. It proceeds to frGo(6) ONLY
  // when fr-next is not disabled; frPollA11y disables it on a POSITIVE not-trusted
  // reading and re-enables it the instant the user grants -- a browser (uncheckable)
  // and any read failure fail SAFE, so Continue stays live. Assert the GATED mechanism.
  assert.match(SCRIPT, /step === 5[\s\S]{0,1400}frActions\(\{ label: 'Continue', go: \(\) => \{ if \(document\.getElementById\('fr-next'\)\.disabled\) return; frGo\(6\); \} \}\)/,
    'the Accessibility step Continue is GATED -- proceeds to step 6 only when not disabled by the check (#2125 supersedes offer-not-require)');
  assert.match(SCRIPT, /step === 5[\s\S]{0,1400}frPollA11y\(/,
    'step 5 starts the Accessibility gate poll (frPollA11y), which drives the disabled state');
  assert.doesNotMatch(OFFER, /This one is optional/,
    '#1940: the redundant in-pane optional line is gone');
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

test('kosmos#1214/#2125: the Settings box name is stable; #2125 replaced the first-run pointer with what-to-toggle guidance', () => {
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

  // #2125 slice 3 SUPERSEDED the #1214 "point at the Settings box" out. The step is
  // no longer optional-with-a-later-pointer (Continue is gated), so the "anytime in
  // Settings, under Keeping agents running" sentence is GONE -- replaced by
  // what-to-toggle guidance that names WHERE the toggle actually is (the Accessibility
  // list) and the Automation grant macOS may also ask for. The Settings box itself,
  // asserted above, is unchanged ground truth for turning it on later.
  assert.match(OFFER, /Find <b>Tmux<\/b> in the Accessibility list/,
    'the first-run offer names where the toggle actually is (the Accessibility list); #2125 replaced the old Settings-box pointer');
  assert.match(OFFER, /control your computer/,
    'the guidance also names the Automation grant macOS may ask for (both grants tmux needs)');
  assert.doesNotMatch(OFFER, /This one is optional/,
    '#1940: the pushy "optional / now-or-later" framing is gone');
});

test('kosmos#1214/#2125: the step is wired -- 7 steps, Accessibility at 5, Continue GATED on the check', () => {
  assert.match(SCRIPT, /const FR_STEPS = 7;/, 'the wizard now has 7 steps');
  assert.match(SCRIPT, /const FR_STEP_YOU = 6;/, 'About-you moved to step 6');
  assert.match(SCRIPT, /5: 'Accessibility', 6: 'About you', 7: 'Your agents'/,
    'the eyebrows place Accessibility at 5, About-you at 6, the fleet at 7');
  const step5 = SCRIPT.slice(SCRIPT.indexOf('} else if (step === 5) {'),
    SCRIPT.indexOf('} else if (step === 6) {'));
  assert.match(step5, /fr-title'\)\.textContent = '[^']*your other apps/i, 'step 5 sets its own title');
  // #2125 slice 3 (Josh, 2026-09-04) SUPERSEDES the 09-01 offer-not-require: step 5's
  // Continue is GATED on a real Accessibility check. It proceeds to frGo(6) ONLY when
  // fr-next is not disabled, and frPollA11y drives that disabled state -- it disables
  // on a POSITIVE not-trusted reading and re-enables on trusted; a browser
  // (uncheckable) and any read failure fail SAFE (Continue stays live), so the gate
  // never strands a browser tester or an unreadable machine.
  assert.match(step5, /frActions\(\{ label: 'Continue', go: \(\) => \{ if \(document\.getElementById\('fr-next'\)\.disabled\) return; frGo\(6\); \} \}\)/,
    'Continue is gated: it proceeds to About-you (step 6) only when the check has not disabled it');
  assert.match(step5, /frPollA11y\(/,
    'step 5 starts the Accessibility gate poll (frPollA11y), the mechanism that drives the disabled state');
});

test('kosmos#1214: no em dashes in the offer copy (house rule)', () => {
  for (const spelling of ['—', '&mdash;', '&#8212;', '&#x2014;', '\\u{2014}']) {
    assert.ok(!OFFER.includes(spelling), 'an em dash (' + spelling + ') reached the offer copy');
  }
});
