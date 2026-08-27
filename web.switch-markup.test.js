'use strict';

/**
 * #229: the auto-update switch read off-by-default in the MARKUP while the
 * engine defaulted on, so the first paint (before the setting loads) showed a
 * confident Off about a setting whose shipped default is On. Josh relies on
 * this switch to protect a demo, so it has to read truthfully.
 *
 * The runtime half is fixed and locked elsewhere: `paintSwitch` hides a switch
 * until its position is known and strips `aria-checked` in the unread state
 * (server.test.js, the autoPaint three-state test), the engine defaults on and
 * persists (engine/autoupdate.test.js), and `off` genuinely stops an install
 * (engine/update.test.js). I also verified the live switch end to end in a real
 * browser: on -> aria-checked "true", off -> "false", and off survives a
 * restart (docs/browser-checks/render-switch-states.js, run headed=0).
 *
 * The one thing those do NOT cover is the STATIC markup default, which was the
 * card's original defect. A reintroduced `aria-checked="false"` in the HTML
 * would pass every runtime test and bring the first-paint flash straight back:
 * an absent-or-hidden switch is honest, a static Off is a claim nobody set.
 * This guard pins the markup so that cannot happen silently.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** The opening tag of the `<button id="...">` for one switch. */
function openingTag(id) {
  const re = new RegExp('<button[^>]*\\bid="' + id + '"[^>]*>');
  const m = PAGE.match(re);
  assert.ok(m, 'the switch button #' + id + ' vanished from the page');
  return m[0];
}

// Every switch on the Settings surface. The card names the update switch, but
// the defect class is shared, and #229's paint fix generalised to all of them.
const SWITCHES = ['auto-toggle', 'lim-toggle', 'eng-toggle'];

test('#229: no switch carries a static aria-checked in the markup', () => {
  for (const id of SWITCHES) {
    const tag = openingTag(id);
    assert.doesNotMatch(tag, /aria-checked/,
      '#' + id + ' has a static aria-checked in the markup, so it reads a definite '
      + 'position before its setting has loaded. That is the #229 defect: for the '
      + 'update switch the static answer was Off while the engine default is On. '
      + 'Positions come only from paintSwitch, after the setting is read.');
  }
});

test('#229: every switch starts hidden, so it draws no position until painted', () => {
  for (const id of SWITCHES) {
    const tag = openingTag(id);
    assert.match(tag, /\shidden(\s|>)/,
      '#' + id + ' is not hidden in the markup, so it is on screen before its '
      + 'setting is read. A switch with no aria-checked that is also visible reads '
      + 'as Off (an absent value is a confident false), which is the same #229 '
      + 'defect by another route. paintSwitch un-hides it once it has a position.');
  }
});
