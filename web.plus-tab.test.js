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

test('the flow gates on configured, and the section paints on arrival, never on the poll', () => {
  const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
  const paint = SCRIPT.slice(SCRIPT.indexOf('async function paintPlus('), SCRIPT.indexOf('\ndocument.getElementById(\'plus-switch\')'));
  assert.match(paint, /configured !== true/, 'the flow no longer gates on the machine being configured');
  assert.match(paint, /holding\.hidden = false;\s*\n\s*flow\.hidden = true;/,
    'the unconfigured state does not rest on the holding place');
  assert.match(SCRIPT, /if \(section === 'plus'\) paintPlus\(\);/,
    'the tab no longer paints on arrival');
});
