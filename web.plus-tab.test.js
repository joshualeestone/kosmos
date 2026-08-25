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
  const holding = SEC.slice(SEC.indexOf('id="plus-holding"'), SEC.indexOf('id="plus-flow"'));
  assert.doesNotMatch(holding, /<button|<input|<select/,
    'the holding place grew a control, which is a working-looking button the service cannot honour yet');
  assert.match(SEC, /id="plus-flow" hidden/, 'the flow does not start hidden');
  assert.match(holding, /Sign-up is not open yet/, 'the holding place stopped saying the honest sentence');
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
  assert.match(paint, /holding\.hidden = false;\s*\n\s*flow\.hidden = true;/,
    'the unconfigured state does not rest on the holding place');
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
    'plus-holding': { hidden: false },
    'plus-flow': { hidden: true },
    'plus-switch': { textContent: '' },
    'plus-status': { textContent: '' },
    'plus-enrol': { hidden: false },
    'plus-devices': { hidden: false },
  };
  const pending = [];
  const fetchImpl = () => new Promise((resolve) => { pending.push(resolve); });
  const run = new Function('document', 'fetch', 'plusWords', 'paintDevices',
    'let PLUS_EPOCH = 0;\n' + src + '\nreturn paintPlus;')(
    { getElementById: (id) => els[id] }, fetchImpl, (t) => t, () => {});

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
