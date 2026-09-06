'use strict';
/**
 * PR-C2 (#2037 + #2020): install-flow Screen 6 "self-improving" consent switches.
 * Renet's install-flow-9screen ships the Screen 6 MARKUP (two s6-sw pill SPANS,
 * #fr-s6-feedback / #fr-s6-createping, role=switch, aria-checked default-ON). This
 * pins the BEHAVIOR PR-C2 wires in: the toggle handlers flip aria-checked and PUT
 * the existing backends (/api/feedback-setting, /api/ping-setting), bind click +
 * Space/Enter, and the frGo step-6 branch refreshes on show (paints default-ON).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);
function codeOnly(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE = codeOnly(RAW);

test('Screen 6 ships the two consent switches as default-ON role=switch spans', () => {
  assert.match(PAGE, /id="fr-s6-feedback"[^>]*role="switch"[^>]*aria-checked="true"/, 'feedback switch missing or not default-ON');
  assert.match(PAGE, /id="fr-s6-createping"[^>]*role="switch"[^>]*aria-checked="true"/, 'create-ping switch missing or not default-ON');
});

test('Screen 6 carries the signed-off eyebrow, headline and both switch copies', () => {
  assert.match(PAGE, /Self improving/i, 'the eyebrow is missing');
  assert.match(PAGE, /Help make Kosmos work better for everyone/, 'the headline is missing');
  assert.match(PAGE, /Have an agent send a daily report with any bugs or improvement suggestions\./, 'the feedback copy is missing');
  assert.match(PAGE, /Let Kosmos know when you create an agent\./, 'the create-ping copy is missing');
});

test('each toggle handler flips aria-checked and PUTs its own backend', () => {
  const fb = lift('frFeedbackToggle');
  assert.match(fb, /aria-checked|frSwSet/, 'the feedback toggle does not read/flip aria-checked');
  assert.match(fb, /\/api\/feedback-setting/, 'the feedback toggle does not target /api/feedback-setting');
  assert.match(fb, /method:\s*'PUT'/, 'the feedback toggle does not PUT');
  const pg = lift('frPingToggle');
  assert.match(pg, /aria-checked|frSwSet/, 'the ping toggle does not read/flip aria-checked');
  assert.match(pg, /\/api\/ping-setting/, 'the ping toggle does not target /api/ping-setting');
  assert.match(pg, /method:\s*'PUT'/, 'the ping toggle does not PUT');
});

test('each refresh drives the switch from the backend GET, guarding could-not-read (never a false Off)', () => {
  const rf = lift('frRefreshFeedback');
  assert.match(rf, /fetch\('\/api\/feedback-setting'\)/, 'the feedback refresh does not GET the backend');
  assert.match(rf, /aria-checked|frSwSet/, 'the feedback refresh does not set the switch from the read');
  assert.match(rf, /res\.ok/, 'the feedback refresh does not guard a non-ok read');
  const rp = lift('frRefreshPing');
  assert.match(rp, /fetch\('\/api\/ping-setting'\)/, 'the ping refresh does not GET the backend');
  assert.match(rp, /aria-checked|frSwSet/, 'the ping refresh does not set the switch from the read');
  assert.match(rp, /res\.ok/, 'the ping refresh does not guard a non-ok read');
});

test('both switches bind click AND keydown (a role=switch is keyboard-operable)', () => {
  assert.match(PAGE, /'fr-s6-feedback'/, 'the feedback id is not wired in JS');
  assert.match(PAGE, /'fr-s6-createping'/, 'the ping id is not wired in JS');
  assert.match(PAGE, /addEventListener\('click'/, 'no click binding on the S6 switches');
  assert.match(PAGE, /addEventListener\('keydown'/, 'no keydown binding (Space/Enter) on the S6 switches');
  assert.match(PAGE, /'Enter'|' '/, 'Space/Enter is not handled in the keydown binding');
});

test('the frGo step-6 branch refreshes both switches on show (so default-ON paints)', () => {
  const frGo = lift('frGo');
  const s6 = frGo.slice(frGo.indexOf('step === 6'));
  const nextBranch = s6.indexOf('step === 7');
  const branch = nextBranch > -1 ? s6.slice(0, nextBranch) : s6;
  assert.match(branch, /frRefreshFeedback\(\)/, 'frGo step 6 does not call frRefreshFeedback');
  assert.match(branch, /frRefreshPing\(\)/, 'frGo step 6 does not call frRefreshPing');
});
