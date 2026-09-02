'use strict';

/**
 * #1918: the 401 error tells the user to run /login, and the product must give
 * them a way to reach the fix.
 *
 *   node --test web.reauth-reach-1918.test.js
 *
 * A real external tester was boxed in on 0.6.22: the agent surfaced
 * "● Please run /login · API Error: 401 OAuth access token has expired." and
 * there was NOWHERE in the product to run it (the Terminal tab is read-only, the
 * message box below it talks to the AGENT not the shell, and the raw "/login" is
 * a passthrough from the underlying CLI that is correct in a terminal and false
 * here). The interactive re-auth surface already exists (Settings -> Accounts ->
 * "Sign in again"); the gap was that the agent page relayed the CLI's remedy with
 * no in-product path to it. This pins the reachable affordance: a "Sign in again"
 * button on the agent page, shown ONLY when sign-in is what is broken, that opens
 * the existing re-auth surface.
 *
 * 🔑 RUN, DO NOT GREP, for the branch logic. The toggle is a live branch
 * (`a.state !== 'auth_failed'`) and the click is a live handler; a source match
 * cannot tell a live branch from a dead one, so both are extracted and executed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A button stub that records its hidden state and any click listener. */
function fakeButton() {
  return {
    id: 'd-reauth', hidden: false, _click: null,
    addEventListener(evt, fn) { if (evt === 'click') this._click = fn; },
  };
}
function stubDoc(btn) {
  return {
    getElementById(id) {
      if (id === 'd-reauth') return btn;
      throw new Error('the snippet asked for #' + id + ', which this stub does not carry');
    },
  };
}

test('the affordance exists in the markup and is hidden by default', () => {
  /* Structural: the button must ship and start hidden, so a healthy agent never
     sees it before the paint logic decides. */
  const m = PAGE.match(/<button[^>]*id="d-reauth"[^>]*>([^<]*)<\/button>/);
  assert.ok(m, 'the #d-reauth button is not in the page');
  assert.match(m[0], /\bhidden\b/, 'the re-auth button does not start hidden');
  assert.match(m[1], /Sign in again/, 'the button does not name the re-auth action');
});

test('the toggle SHOWS the button on auth_failed and HIDES it otherwise (run, both arms)', () => {
  const m = SCRIPT.match(/const reauthBtn = document\.getElementById\('d-reauth'\);\s*\n\s*if \(reauthBtn\) reauthBtn\.hidden = a\.state !== 'auth_failed';/);
  assert.ok(m, 'the paint toggle for #d-reauth moved or changed shape; restate this pin');
  const toggle = new Function('document', 'a', m[0]);

  // auth_failed -> shown. This is the reachable-remedy case the card is about.
  const b1 = fakeButton(); b1.hidden = true;
  toggle(stubDoc(b1), { state: 'auth_failed' });
  assert.equal(b1.hidden, false, 'the re-auth button stayed hidden while the agent sign-in was broken');

  // 🛑 CONTROL, the discriminating arm: a healthy/idle agent must NOT see it. A
  // button that were always shown would pass the arm above and fail here.
  const b2 = fakeButton(); b2.hidden = false;
  toggle(stubDoc(b2), { state: 'idle' });
  assert.equal(b2.hidden, true, 'the re-auth button is shown for a non-auth state, so it reads as an action a healthy agent needs');

  // A second non-auth state, so the pin is about auth_failed specifically, not
  // about one particular other value.
  const b3 = fakeButton(); b3.hidden = false;
  toggle(stubDoc(b3), { state: 'working' });
  assert.equal(b3.hidden, true, 'the re-auth button is shown for a working agent');
});

test('the button is wired to open the re-auth surface, PANEL first (run the click)', () => {
  /* 🛑 THE PANEL, NOT JUST THE SECTION. The button lives on the detail panel, and the
     top-level panels are mutually exclusive: opening the accounts SECTION without first
     switching to the settings PANEL is a dead control (the #1918 wording-only dead end).
     So this asserts showTab('settings') is called BEFORE settingsOpen('accounts'), in
     order. An earlier version of this test stubbed only settingsGo and asserted the
     section open; it stayed green while the button did nothing, because it pinned the
     callee instead of the user-visible navigation. Observing showTab is what makes it
     red-capable for the real reachability contract. */
  const m = SCRIPT.match(/\(\(\) => \{\s*const rb = document\.getElementById\('d-reauth'\);\s*if \(rb\) rb\.addEventListener\('click', \(\) => \{ showTab\('settings'\); settingsOpen\('accounts'\); \}\);\s*\}\)\(\);/);
  assert.ok(m, 'the one-time wiring for #d-reauth moved or changed shape; restate this pin');
  const btn = fakeButton();
  const calls = [];
  const wire = new Function('document', 'showTab', 'settingsOpen', m[0]);
  wire(stubDoc(btn), (t) => calls.push(['showTab', t]), (sec) => calls.push(['settingsOpen', sec]));
  assert.ok(typeof btn._click === 'function', 'nothing listens to the re-auth button');
  btn._click();
  assert.deepEqual(calls, [['showTab', 'settings'], ['settingsOpen', 'accounts']],
    'the click does not switch to the settings PANEL before opening the accounts section (dead control)');
});
