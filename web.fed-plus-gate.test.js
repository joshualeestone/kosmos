'use strict';

/**
 * The federation Kosmos+ gate (Josh launch spec, 2026-09-21).
 *
 *   node --test web.fed-plus-gate.test.js
 *
 * The #3312 federation UI was hidden on prod by a plain sourceChannel gate (#3330).
 * It now gates on the mode fedGateMode() computes from sourceChannel + the
 * federation-live flip + the viewer's Plus entitlement:
 *   - 'show'   : the fed UI (a Kosmos+ member on a live channel, or staging)
 *   - 'signup' : a "sign up for Kosmos+" prompt (a non-member on a live channel)
 *   - 'hidden' : nothing (before the coordinated flip)
 *
 * The REAL fedGateMode is lifted and exercised. The two properties that make this a
 * LAUNCH gate and not a leak:
 *   (a) FAIL-SAFE on prod: an unknown/absent entitlement is NEVER 'show'.
 *   (b) READY-TO-FLIP: prod stays 'hidden' until federationLive === true.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync('web/index.html', 'utf8'));
const fedGateMode = new Function(lift(SCRIPT, 'fedGateMode') + '\nreturn fedGateMode;')();

test('#fedgate: prod stays HIDDEN until the coordinated flip (federationLive !== true)', () => {
  // Ready-to-flip: whatever the entitlement, an un-flipped prod shows nothing.
  assert.equal(fedGateMode('prod', false, true), 'hidden', 'not flipped + member');
  assert.equal(fedGateMode('prod', undefined, true), 'hidden', 'flag absent + member');
  assert.equal(fedGateMode('prod', false, false), 'hidden', 'not flipped + non-member');
  assert.equal(fedGateMode('prod', false, undefined), 'hidden', 'not flipped + unknown');
});

test('#fedgate: a live prod shows the fed UI to a member, the sign-up prompt to everyone else', () => {
  assert.equal(fedGateMode('prod', true, true), 'show', 'member -> fed UI');
  assert.equal(fedGateMode('prod', true, false), 'signup', 'non-member -> sign-up prompt');
});

test('#fedgate: FAIL-SAFE -- an unknown/absent entitlement on a live prod is NEVER the fed UI', () => {
  // The leak that must never happen: a viewer whose Plus state the engine could not
  // resolve must not see federation on prod. Unknown resolves to the sign-up prompt.
  assert.equal(fedGateMode('prod', true, undefined), 'signup', 'unknown -> sign-up, not show');
  assert.equal(fedGateMode('prod', true, null), 'signup', 'null -> sign-up, not show');
  assert.equal(fedGateMode('prod', true, 0), 'signup', '0 (falsy non-bool) -> sign-up, not show');
  assert.equal(fedGateMode('prod', true, 'yes'), 'signup', 'a truthy non-true string -> sign-up, not show');
});

test('#fedgate: staging is always a live review surface', () => {
  // A member reviewer sees the fed UI; a non-member reviewer sees the sign-up prompt;
  // and while entitlement is not yet wired (unknown), staging keeps SHOWING the fed UI
  // so review is not blocked -- this is the #3330 staging-review continuity.
  assert.equal(fedGateMode('staging', false, true), 'show', 'staging member (no flag needed)');
  assert.equal(fedGateMode('staging', false, false), 'signup', 'staging explicit non-member');
  assert.equal(fedGateMode('staging', false, undefined), 'show', 'staging + unwired entitlement -> show (review continuity)');
});

test('#fedgate: the gate CSS + stamping + prompt are wired into the page', () => {
  const PAGE = fs.readFileSync('web/index.html', 'utf8');
  // The status tick stamps the computed mode.
  assert.match(SCRIPT, /fedGateStamp\(data\)/, 'the status tick calls fedGateStamp');
  assert.match(SCRIPT, /setAttribute\('data-fed-ui'/, 'fedGateStamp stamps data-fed-ui');
  // The CSS hides the fed entry points unless mode is show, and the prompt unless signup.
  assert.match(PAGE, /html:not\(\[data-fed-ui="show"\]\) \.pj-mode/, 'fed entry points gated to show mode');
  assert.match(PAGE, /html:not\(\[data-fed-ui="signup"\]\) #pj-plus-signup/, 'sign-up prompt gated to signup mode');
  // The prompt markup + its route into the in-app Plus section (no hardcoded domain).
  assert.match(PAGE, /id="pj-plus-signup"/, 'the sign-up prompt element exists');
  assert.match(PAGE, /id="pj-plus-signup-go"/, 'the sign-up button exists');
  assert.match(SCRIPT, /function fedPlusSignupGo\(\)[\s\S]*settingsGo\('plus'\)/, 'sign-up routes to the in-app Plus section');
  assert.doesNotMatch(SCRIPT, /fedPlusSignupGo[\s\S]{0,120}https?:\/\//, 'no hardcoded sign-up URL (Josh ruling)');
});
