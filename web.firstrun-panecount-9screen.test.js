'use strict';

/**
 * install-flow-9screen: FR_STEPS must equal the number of fr-pane-N containers.
 *
 * 🛑 THE BUG THIS EXISTS FOR, and it shipped green through 4737 lifted-painter
 * tests: the 6->9 rework renumbered the panes and rewrote every frGo branch, but
 * left `const FR_STEPS = 7`. frGo clamps `if (step > FR_STEPS) step = FR_STEPS`
 * and shows/hides panes with `for (i = 1; i <= FR_STEPS; i++)`, so steps 8 and 9
 * were UNREACHABLE -- pressing Next on Success (step 7) clamped frGo(8) back to 7,
 * the wizard could never reach About-you or the fleet fork, and frFinish (only
 * reached from the fork) never ran, so first-run was never marked complete and
 * re-showed on every launch.
 *
 * The node suite missed it because those tests LIFT individual painters and run
 * them in isolation; nothing drives frGo(1)->frGo(9) navigation, so the clamp is
 * never hit. This guard is the cheap static cross-check that does catch it: the
 * app's own step constant against the panes actually in the DOM. It re-arms for
 * the next screen inserted or removed -- keep it keyed on the count, never a
 * literal.
 *
 *   node --test web.firstrun-panecount-9screen.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** Every numbered pane container in the markup, by its number. */
function paneNumbers(page) {
  const nums = [];
  for (const m of page.matchAll(/class="fr-pane"\s+id="fr-pane-(\d+)"/g)) nums.push(Number(m[1]));
  return nums.sort((a, b) => a - b);
}

/** The FR_STEPS constant the app ships. */
function frSteps(page) {
  const m = /const FR_STEPS = (\d+);/.exec(page);
  return m ? Number(m[1]) : null;
}

test('FR_STEPS equals the number of fr-pane-N containers, so the tail steps are reachable', () => {
  const panes = paneNumbers(PAGE);
  const steps = frSteps(PAGE);
  assert.ok(steps !== null, 'FR_STEPS is not declared; this guard is measuring nothing');
  assert.ok(panes.length > 0, 'no fr-pane-N containers found; this guard is measuring nothing');
  // The panes are numbered 1..N with no gaps -- frGo shows fr-pane-{step}.
  assert.deepEqual(panes, Array.from({ length: panes.length }, (_, i) => i + 1),
    `the fr-pane ids are not a gapless 1..N run: ${panes.join(',')}`);
  assert.equal(steps, panes.length,
    `FR_STEPS is ${steps} but there are ${panes.length} fr-pane-N containers: `
    + `frGo clamps to ${steps} and its show/hide loop stops at ${steps}, so panes `
    + `${steps + 1}..${panes.length} are unreachable and the wizard cannot complete.`);
  // The signed-off flow is 9 screens.
  assert.equal(steps, 9, 'the 9-screen flow should have FR_STEPS = 9');
});

test('every fr-pane-N carries its own <h2> (frFocusActiveHead focuses it; a null head breaks focus/aria)', () => {
  // frGo -> frFocusActiveHead(pane) does paneEl.querySelector('h2'); a pane with
  // no <h2> would leave FR_ACTIVE_H2 null and the dialog with no accessible name.
  const panes = paneNumbers(PAGE);
  for (const n of panes) {
    const open = PAGE.indexOf(`class="fr-pane" id="fr-pane-${n}"`);
    // slice to the next pane (or a safe window) and confirm an <h2> lives in it.
    const nextOpen = PAGE.indexOf('class="fr-pane" id="fr-pane-', open + 1);
    const slice = PAGE.slice(open, nextOpen === -1 ? open + 8000 : nextOpen);
    assert.match(slice, /<h2[ >]/, `fr-pane-${n} has no <h2> for frFocusActiveHead to focus`);
  }
});
