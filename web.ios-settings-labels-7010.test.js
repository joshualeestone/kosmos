'use strict';

/**
 * kosmos#7010: the iPhone's native Settings tab shows the computer's own phone switches with the board's own words
 * (ios/Kosmos/SettingsLogic.swift, Settings.Kind). ios/LogicTests/run-settings.sh checks that too, but iOS CI runs
 * only when ios/** changes, so a change to the board's wording or to the computer's kinds would not run it. This
 * runs on every pull request: it reads the Swift as text and fails when the phone and the board stop saying the
 * same thing.
 *
 *   node --test web.ios-settings-labels-7010.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const swift = read('ios/Kosmos/SettingsLogic.swift');
const page = read('web/index.html');

/** Settings.Kind's labels, by case: `case .needsYou: return "When an agent needs me"`. */
function swiftLabels() {
  const out = {};
  for (const m of swift.matchAll(/case \.([a-zA-Z]+): return "([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

test('#7010: the phone has a switch for exactly the kinds the computer keeps', () => {
  const kinds = Object.keys(swiftLabels()).sort();
  const defaults = read('engine/phonenotify.js').match(/const KIND_DEFAULTS = \{([^}]*)\}/);
  assert.ok(defaults, 'engine/phonenotify.js has no KIND_DEFAULTS');
  const computer = [...defaults[1].matchAll(/([a-zA-Z]+):/g)].map((m) => m[1]).sort();
  assert.deepEqual(kinds, computer, 'the phone and the computer list different kinds');
  const cases = swift.match(/case ([a-zA-Z, ]+)\n/)[1].split(',').map((x) => x.trim()).sort();
  assert.deepEqual(cases, computer, 'Settings.Kind cases and the computer kinds differ');
});

test('#7010: each switch, and the master, says what the board says', () => {
  // Each board row is "<div>label ..." then its own button's data-kind, so a label is checked against ITS row's
  // switch: two labels swapped on either side fail.
  for (const [kind, label] of Object.entries(swiftLabels())) {
    const at = page.indexOf('<div>' + label);
    assert.ok(at > -1, kind + ': the phone says "' + label + '", the board says something else');
    const own = page.slice(at, at + 600).match(/data-kind="([a-zA-Z]+)"/);
    assert.equal(own && own[1], kind, kind + ': the board row with these words is another switch');
  }
  const master = swift.match(/static let masterLabel = "([^"]+)"/)[1];
  assert.ok(page.includes('<b>' + master + '</b>'), 'the master switch is worded differently on the board');
});
