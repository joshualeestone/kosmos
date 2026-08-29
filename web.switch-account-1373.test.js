'use strict';

/**
 * #1373: the switch offers WHICH OpenAI sign-in, and only reports a pick when a
 * person actually picked.
 *
 * ⚠️ WHAT THIS FILE CAN AND CANNOT SEE, said plainly so nobody reads more into a
 * green than is there. These assertions read the SOURCE. They can see that a
 * guard is present and what it is keyed on; they cannot see the rendered page,
 * so they cannot tell whether the control actually appears. The rendering half
 * is `docs/browser-checks/render-model-change.js`, and neither file replaces the
 * other.
 *
 * 🛑 IT EXISTS BECAUSE THE HONESTY RULE HAS NO OTHER GUARD. The route says "the
 * OpenAI sign-in you picked" on one branch and "your OpenAI sign-in" on the
 * other, and the FIRST DRAFT OF THIS FEATURE SENT THE PRESELECTED ACCOUNT ON
 * EVERY SWITCH -- so a person who never opened the menu was told they had
 * chosen. Every test passed. The route's own comment forbids exactly that
 * ("Saying 'the one you picked' when nobody picked would be the invention this
 * route refuses elsewhere") and nothing enforced it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

test('#1373: the reader works at all', () => {
  /* The control. Every assertion below is an existence test on a big file, and
     an existence test whose reader is broken reports the same thing as a
     genuinely missing guard. */
  assert.match(PAGE, /id="d-provider"/, 'the page reader found no #d-provider, so it is not reading the page');
  assert.match(SERVER, /api\/agent\/\[\^\/\]\+\/provider|\/provider\$/, 'the server reader found no provider route');
});

test('#1373: the switch offers a sign-in to choose', () => {
  assert.match(PAGE, /id="d-provider-account"/, 'the picker is gone from the markup');
  /* Sized with its siblings. Left out of the shared rule it sizes to its longest
     option and sits visibly narrower than the select above it, which is the
     defect the comment on that rule was written about. */
  const widthRule = PAGE.match(/^#create-model,[^\n]*\{ flex: 1; min-width: 220px; \}$/m);
  assert.ok(widthRule, 'the shared select width rule moved or was renamed');
  assert.match(widthRule[0], /#d-provider-account\b/,
    'the sign-in picker is not in the shared width rule, so it will size differently from the select above it');
});

test('#1373: a preselected option is NOT reported as a choice', () => {
  /* THE LOAD-BEARING ONE. Three parts, and the guard is worthless without all
     three: a flag that starts false, a person's own change event that sets it,
     and a send that consults it. */
  assert.match(PAGE, /let SWITCH_ACCT_TOUCHED = false;/,
    'the touched flag is gone, so a preselect can be reported as a pick again');
  /* 🛑 THIS ARM WAS DECORATION AND A REVIEWER PROVED IT BY MUTATION, WHICH I THEN
     REPRODUCED: deleting the reset from inside fillSwitchAccounts left it GREEN,
     because the pattern matched the `let SWITCH_ACCT_TOUCHED = false;` DECLARATION
     about 178 characters above `const openai`. It asserted that the two strings
     exist near each other, which they do whether or not the reset survives.
     ⇒ Anchored on the function's OWN first line instead, so the match can only be
     satisfied by a reset that is genuinely inside the body. This is the arm that
     stops a pick made on one agent leaking to the next one you open. */
  assert.match(PAGE, /if \(!sel \|\| !prov\) return;\s*SWITCH_ACCT_TOUCHED = false;/,
    'the flag is not reset inside fillSwitchAccounts, so a pick on one agent carries to the next');
  /* 🔑 PINNED ON THE PROPERTY, NOT THE SPELLING. This caught a real change of mine
     (the listener moved behind a null-checked variable) and the PROPERTY was intact,
     so the assertion was wrong rather than the code. Loosened on the axis nothing
     depends on (inline call or via a local) and kept tight on the one that matters:
     the flag is set by a CHANGE event on THAT element, which is what makes a pick a
     pick. Re-pinning the new exact spelling would just re-arm the trap. */
  assert.match(PAGE, /getElementById\('d-provider-account'\)[\s\S]{0,400}?addEventListener\('change'[\s\S]{0,160}?SWITCH_ACCT_TOUCHED = true;/,
    'nothing sets the touched flag from the picker\'s own change event, so a real pick would never be reported');
  assert.match(PAGE, /account: \(acctSel && !acctSel\.hidden && SWITCH_ACCT_TOUCHED\)/,
    'the switch sends the account without consulting the touched flag');
});

/* 🛑 THE ONE CALL NOTHING COVERED. `paintAccountPicker` fills ACCOUNTS, which is
   the picker's only source, so without this call the menu stays hidden until the
   provider dropdown is touched a SECOND time. Hidden is a legitimate state, so the
   bug would not announce itself.
   ⚠️ And the browser check cannot catch it either: it waits 1500ms after `goto`
   before choosing a provider, by which time ACCOUNTS is already populated, so the
   check stays green with this line deleted. That is why it is pinned here. */
test('#1373: the picker is refilled when the accounts actually arrive', () => {
  /* ⚠️ THE WINDOW HAS TO BE THE FUNCTION, NOT "ROUGHLY AFTER IT". The first version
     sliced to the next `\nlet `, which lands about 185 lines PAST the end of
     paintAccountPicker and spanned four more functions. It went red today only
     because exactly one `fillSwitchAccounts()` happened to sit in that span; a call
     added in any of those four would have let the pinned one be deleted silently.
     `\n}` is this file's function terminator at column 0. */
  const at = PAGE.indexOf('async function paintAccountPicker');
  assert.notEqual(at, -1, 'paintAccountPicker is gone, so this test is measuring nothing');
  const end = PAGE.indexOf('\n}', at);
  assert.notEqual(end, -1, 'could not find the end of paintAccountPicker');
  const body = PAGE.slice(at, end);
  assert.match(body, /fillSwitchAccounts\(\)/,
    'paintAccountPicker no longer refills the switch picker, so it stays hidden until the provider menu is touched twice');
});

test('#1373: the picker is not offered where it can do nothing', () => {
  /* paintProviderPicker sets #d-provider to the agent's CURRENT provider, so on
     an agent already on OpenAI this menu would render live while Switch stays
     disabled and the engine would refuse anyway. */
  assert.match(PAGE, /const armed = !!CURRENT && prov\.value !== providerOf\(CURRENT\);/,
    'the armed gate is gone, so the picker renders on an agent already on OpenAI');
  assert.match(PAGE, /if \(!openai \|\| !armed \|\| !list\.length\)/,
    'the hidden condition no longer consults the armed gate');
});

/* 🛑 THE PAGE-TO-ROUTE KEY IS THE ONE THING NEITHER SIDE'S TESTS PINNED. The page
   test above pins that the page SENDS `account`; the engine test pins that
   `setProvider` HONOURS `accountDir`. Nothing pinned the join, so renaming
   `body.account` in server.js left every test in the repo green while the feature
   silently reverted to the stated default: the exact silent-wrong-account failure
   this card exists to end.
   ⚠️ AND AN HTTP-LEVEL TEST CANNOT CLOSE IT TODAY, which is worth knowing rather
   than rediscovering. The route calls `remove.restart()`, which runs
   `launchctl bootstrap` and would register REAL launchd services on the developer's
   machine (I did that by accident earlier on this branch and had to boot three
   out). That call is guarded by AGENT_WORKFORCE_DRY_RUN, and DRY_RUN ALSO disables
   the whole account block in setProvider, so the only setting that makes the route
   safe to drive is the setting that makes the feature inert.
   ⇒ Source-pinned here deliberately. The coupling is filed as kosmos#1465;
      when it is fixed, replace this with a real request through the route. */
test('#1373: the page-to-route key is pinned on BOTH sides, so a rename cannot pass', () => {
  assert.match(SERVER, /accountDir:\s*body && typeof body\.account === 'string' \? body\.account : null/,
    'server.js no longer reads body.account into accountDir, so the page sends a key the route ignores');
  assert.match(PAGE, /account: \(acctSel && !acctSel\.hidden && SWITCH_ACCT_TOUCHED\)/,
    'the page no longer sends `account`, so the route can never receive a pick');
});

test('#1373: the route says a different sentence for a pick than for a default', () => {
  assert.match(SERVER, /acct\.chosen/, 'the route no longer distinguishes a pick from a stated default');
  assert.match(SERVER, /It runs on the OpenAI sign-in you picked/, 'the chosen-account sentence is gone');
  assert.match(SERVER, /It runs on your OpenAI sign-in/, 'the stated-default sentence is gone');
  /* And they must be the two arms of ONE conditional, not two strings that
     happen to exist: an unconditional "you picked" is the defect this guards. */
  assert.match(SERVER,
    /acct\.chosen[\s\S]{0,220}?It runs on the OpenAI sign-in you picked[\s\S]{0,220}?It runs on your OpenAI sign-in/,
    'the two sentences are no longer the arms of the chosen conditional');
});
