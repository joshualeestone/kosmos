'use strict';

/**
 * The Plus Account tab (Josh, 2026-08-23 19:15): a holding place FIRST,
 * with the real flow gated on this machine actually having a relay
 * configured, and no hostname anywhere in the copy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const at = PAGE.indexOf('id="s-sec-plus"');
const end = PAGE.indexOf('</section>', PAGE.indexOf('id="plus-flow"'));
const SEC = PAGE.slice(at, end);

// Brace-matched extraction, not an open-ended keyword search: see the
// #743 boundary-overshoot test below for why that class of anchor is
// unsafe on this file.
function pageFnSource(name) {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  let start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  if (script.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let stop = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { stop = k + 1; break; } }
  }
  assert.ok(stop > start, name + ' has no matching close brace');
  return script.slice(start, stop);
}

test('the holding place has NO controls, and the flow starts hidden (no dead buttons)', () => {
  assert.ok(at > 0 && end > at, 'the Plus section moved; re-anchor');
  /* 🛑 SCOPED TO STATE 1 (#1615), AND THE NARROWING IS THE FINDING RATHER THAN A
     LOOSENING. This read "no controls in the pane before the flow", encoding a real
     principle: do not ship a working-looking button the service cannot honour. Josh
     INVERTED that on 2026-08-30: "i dont care if the app side is ready yet ... i want to
     see all the design implemented". design/plus-flow.html draws state 2 with an email
     field and a Send me a code button, unwired, deliberately.
     ⇒ The rule no longer holds for state 2 and STILL HOLDS for state 1, which is
     marketing plus a link and has no reason to grow a control. Scoping keeps the
     protection exactly where it is still true rather than deleting it wholesale. */
  const holding = SEC.slice(SEC.indexOf('id="plus-state1"'), SEC.indexOf('id="plus-state2"'));
  assert.ok(holding.length > 200,
    'the state 1 slice is empty or tiny; re-anchor before trusting the assertion below');
  /* 🛑 NARROWED AGAIN, BECAUSE THE SPEC MOVED, NOT BECAUSE IT WAS INCONVENIENT.
     This forbade EVERY control in state 1. `/design/journeys` and `/design/first-step`,
     which are now the spec and supersede the older mocks, both draw TWO DOORS on the
     first screen: join on the site, sign in here.
     ⇒ What the rule actually protects is "do not ship a button the service cannot
     honour". A control that NAVIGATES to another screen honours exactly what it says. So
     the prohibition moves from "no controls" to "no control that promises a service",
     which is what it always meant.
     ⚠️ AND STATE 2 IS OTHERWISE UNREACHABLE: paintPlus shows it only for a configured
     machine and nothing signals payment yet, so without this door the designed sign-in
     screen cannot be seen at all. Deleting the rule wholesale would have been wrong, and
     so would keeping it and hiding a designed screen. */
  const controls = holding.match(/<(button|input|select)[^>]*/g) || [];
  for (const c of controls) {
    assert.match(c, /id="plus-signin-open"/,
      'state 1 grew a control that is not the sign-in door: ' + c
      + '. State 1 is marketing, a link, and the door to state 2. Anything that promises '
      + 'a service belongs in state 2, which is where the service lives.');
  }
  /* PAGE, not SEC: the markup is in the section and the handler is in the script far
     below it. My first version searched SEC and reported a missing handler that was
     present, which is the same wrong-window mistake this file keeps catching. */
  /* ⚠️ ANCHOR ON THE BINDING, NOT THE ID. My first version matched the id string
     followed by any addEventListener within 1200 characters, and the id appears in the
     MARKUP with unrelated handlers nearby, so removing the real handler left it green.
     Measured. The variable name only exists where the handler is. */
  assert.match(PAGE, /plusSignInOpen\.addEventListener/,
    'the state 1 sign-in door has no handler, so it is exactly the dead button this rule '
    + 'exists to prevent');
  assert.match(SEC, /id="plus-flow" hidden/, 'the flow does not start hidden');
  /* #1615 re-anchored `plus-holding` -> `plus-state1` when the pane became three states.
     THE ASSERTION IS UNCHANGED AND DELIBERATELY SO: signup is still not open (Stripe is in
     SANDBOX as of 2026-08-30), so the sentence is still true and must still be said. Only
     the id moved. If signup opens, this sentence becomes false and the guard should be the
     thing that makes somebody notice. */
  assert.match(holding, /Sign-up is not open yet/, 'state 1 stopped saying the honest sentence');
});

test('no hostname or price appears in the Plus copy: the domain is temporary and the price is not ruled', () => {
  assert.doesNotMatch(SEC, /installkosmos\.com|\.app\b|https?:\/\//,
    'a hostname leaked into the Plus copy; the domain is explicitly temporary');
  assert.doesNotMatch(SEC, /\$\d/, 'a price leaked into the copy; pricing is not ruled');
});

test('the flow gates on configured, and the section paints on arrival', () => {
  const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
  const pStart = SCRIPT.indexOf('async function paintPlus(');
  const pEnd = SCRIPT.indexOf("document.getElementById('plus-switch')", pStart);
  assert.ok(pStart > -1 && pEnd > pStart, 'the paintPlus region moved; re-anchor (an open-ended slice would pass against the whole script)');
  const paint = SCRIPT.slice(pStart, pEnd);
  assert.match(paint, /configured !== true/, 'the flow no longer gates on the machine being configured');
  /* #1615: the pane is three states now, so this asserts the RULE across all three
     rather than the two-line shape it used to pin. An unconfigured machine shows state 1
     and hides BOTH the sign-in and the connected flow; a configured one shows only the
     flow. Pinning the old literal would have cemented a spelling that the design
     deliberately replaced. */
  /* 🛑 THIS PINNED `state2.hidden = true` IN BOTH BRANCHES, WHICH CEMENTED THE DEFECT.
     State 2 is unreachable today because nothing tells the app somebody has paid. Asserting
     that in both branches encoded "state 2 is never shown" as the RULE, so the very edit
     that wires it up would have gone red - a guard standing in the way of the intended next
     step, which is worse than no guard.
     ⇒ Assert what must NOT regress and leave state 2 free: an unconfigured machine shows
     state 1 and NOT the connected flow; a configured one shows the flow and NOT state 1.
     Whether state 2 is visible is the thing that will legitimately change. */
  assert.match(paint, /state1\.hidden = false;/, 'the unconfigured state no longer shows state 1');
  assert.match(paint, /state1\.hidden = false;[\s\S]{0,120}flow\.hidden = true;/,
    'the unconfigured state no longer hides the connected flow');
  assert.match(paint, /state1\.hidden = true;[\s\S]{0,120}flow\.hidden = false;/,
    'the configured state no longer shows the flow with state 1 hidden');
  assert.match(SCRIPT, /if \(section === 'plus'\) paintPlus\(\);/,
    'the tab no longer paints on arrival');
});

test('#743: the status line stays fresh while the tab is open, not only on arrival', () => {
  // Pete sat on "Starting the connection." for minutes after the tunnel
  // was already up: paintPlus ran on arrival and on a few explicit
  // triggers, but nothing repainted it while the section just sat open,
  // unlike the device-ask list beside it (its own 5s poll). The fix rides
  // the main status tick(), gated on the section actually being on
  // screen so a hidden Plus section still costs nobody a fetch.
  // Brace-matched, not an open-ended keyword search: the next ASYNC
  // function after tick() is ~220 lines past its actual close (a run of
  // plain `function`/`const` declarations sits between), so a search for
  // the next `async function` overshoots into topLevelReset/syncUrl/
  // showTab and a pin against that slice would keep passing even if the
  // guard moved out of tick() into one of those instead.
  const tick = pageFnSource('tick');
  assert.doesNotMatch(tick, /\nfunction topLevelReset\(/,
    'CONTROL: the extraction ran past tick() into the next function, so the pin below would prove nothing');
  assert.match(tick, /if \(URL_TAB === 'settings' && SETTINGS_SEC === 'plus'\) paintPlus\(\);/,
    'the status tick no longer keeps the Plus section fresh while it is the one on screen');
});

test('#743: a slower poll cannot revert a faster user click (or vice versa)', () => {
  // The tick-driven repaint above gave paintPlus() a second, recurring
  // caller on top of its gesture-triggered ones (the switch, arrival,
  // setup-complete) -- two in-flight fetches can now race, and whichever
  // RESOLVES LAST used to win regardless of which was DISPATCHED last.
  // PLUS_EPOCH (the same shape INSTR_EPOCH already guards the status
  // poll with) fixes it: only the response from the most recently
  // dispatched call may paint.
  const src = pageFnSource('paintPlus');
  assert.match(src, /const epoch = \(PLUS_EPOCH \+= 1\);/,
    'paintPlus no longer tokens its own call before the fetch');
  assert.match(src, /if \(epoch !== PLUS_EPOCH\) return;/,
    'paintPlus no longer discards a response from a call that is not the latest dispatched');

  // Behavioural: run it for real, with the SECOND call's fetch resolving
  // FIRST (the exact inversion a naive "last resolved wins" would get
  // wrong), and assert the state left on screen is the second call's.
  const els = {
    'plus-state1': { hidden: false },
    'plus-state2': { hidden: true },
    'plus-flow': { hidden: true },
    'plus-switch': { textContent: '' },
    'plus-status': { textContent: '' },
    'plus-enrol': { hidden: false },
    'plus-devices': { hidden: false },
    'plus-second': { hidden: false },
  };
  const pending = [];
  const fetchImpl = () => new Promise((resolve) => { pending.push(resolve); });
  const run = new Function('document', 'fetch', 'plusWords', 'paintDevices', 'plusSecondDisarm',
    'let PLUS_EPOCH = 0;\n' + src + '\nreturn paintPlus;')(
    { getElementById: (id) => els[id] }, fetchImpl, (t) => t, () => {}, () => {});

  const callA = run();  // dispatched first: on
  const callB = run();  // dispatched second: off -- must win regardless of resolve order
  assert.equal(pending.length, 2, 'both calls did not reach the fetch');
  // B (dispatched second) resolves FIRST.
  pending[1]({ json: async () => ({ configured: true, on: false, status: {}, enrolled: true }) });
  // A (dispatched first, slower) resolves SECOND, after B already painted.
  pending[0]({ json: async () => ({ configured: true, on: true, status: {}, enrolled: true }) });
  return Promise.all([callA, callB]).then(() => {
    assert.equal(els['plus-switch'].textContent, 'Turn on',
      'the slower, earlier-dispatched call overwrote the later click -- the exact revert Pete would see');
  });
});
