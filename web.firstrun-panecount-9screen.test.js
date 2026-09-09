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

test('#2497: first-run frPaintFleet forces the no-agent Giddy Up screen and fires no auto-scan', () => {
  // The onboarding S9 painter must land every first run on the create / "Giddy Up" screen
  // (as if the machine had no agents) and must NOT auto-scan/auto-import: the forced create
  // render returns BEFORE any frScanAgents/frFindAgents call, and ahead of the adopt/create/
  // unknown path fork, so a non-empty roster still lands on Giddy Up. (#2497, Josh 2026-09-08.)
  const open = PAGE.indexOf('function frPaintFleet() {');
  assert.ok(open !== -1, 'frPaintFleet is gone; this guard is measuring nothing');
  const end = PAGE.indexOf('\n}', open);   // the file's function terminator (} at column 0)
  assert.ok(end !== -1, 'could not find the end of frPaintFleet');
  const body = PAGE.slice(open, end);

  // The forced no-agent create / Giddy Up render is present.
  assert.match(body, /title\.textContent = 'Create your first agent\.';/,
    'frPaintFleet no longer forces the create heading on first run');
  assert.match(body, /Let\\u2019s get started\./,
    'frPaintFleet no longer shows the Giddy Up "Let’s get started" copy');
  assert.match(body, /frActions\(\{ label: 'Giddy Up', go: \(\) => frFinish\(openCreate\) \}\)/,
    'frPaintFleet no longer renders the Giddy Up action');

  const forced = body.indexOf("frActions({ label: 'Giddy Up'");
  const forcedReturn = body.indexOf('return;', forced);
  assert.ok(forced !== -1 && forcedReturn !== -1, 'the forced Giddy Up block or its return is gone');

  // Discovery must still EXIST in the function (kept-but-bypassed arms; the card says do not
  // delete the engine) -- but every call must sit AFTER the forced return, so none fires on first run.
  const firstScan = body.indexOf('frScanAgents(');
  const firstFind = body.indexOf('frFindAgents(');
  assert.ok(firstScan !== -1 || firstFind !== -1,
    'no frScanAgents/frFindAgents in frPaintFleet: discovery was deleted (keep it) or this guard is vacuous');
  if (firstScan !== -1) assert.ok(forcedReturn < firstScan,
    'a frScanAgents call runs before the forced Giddy Up return: onboarding still auto-scans');
  if (firstFind !== -1) assert.ok(forcedReturn < firstFind,
    'a frFindAgents call runs before the forced Giddy Up return: onboarding still auto-discovers');

  // The forced return precedes the path fork, so first run lands on Giddy Up regardless of fleet.
  const firstPathBranch = body.search(/if \(path === /);
  assert.ok(firstPathBranch === -1 || forcedReturn < firstPathBranch,
    'the forced Giddy Up return comes after a path branch; a non-empty roster would miss it');
});

test('#2497 follow-on: the Giddy Up welcome carries the manual-import POINTER sub-line', () => {
  // Everyone now lands on the create / Giddy Up welcome, including a user who already runs agents
  // in Claude Code or Codex that onboarding deliberately no longer scoops up. One quiet sub-line
  // under "Let's get started." points that user at the manual Import path on the next screen, so
  // "where are my agents?" does not reappear one screen later. A silent deletion of the pointer
  // reintroduces exactly the confusion #2497 removes, so guard it here (source match, the same
  // shape this file already uses for the welcome copy above).
  const open = PAGE.indexOf('function frPaintFleet() {');
  assert.ok(open !== -1, 'frPaintFleet is gone; this guard is measuring nothing');
  const end = PAGE.indexOf('\n}', open);
  assert.ok(end !== -1, 'could not find the end of frPaintFleet');
  const body = PAGE.slice(open, end);

  // The copy is split across a string concat in the source, so each phrase below is chosen to sit
  // entirely within one fragment and never crosses the ' + ' break (a phrase spanning the break
  // could never match). Together they pin the whole pointer: the question and the Import pointer.
  assert.match(body, /Already have agents in Claude Code or Codex on this Mac\?/,
    'the #2497 manual-import pointer sub-line is gone from the Giddy Up welcome');
  assert.match(body, /bring one into Kosmos from the next screen, under Import\./,
    'the #2497 pointer no longer names the manual Import path on the next screen');
  // It must be a POINTER, not a scan: it renders as a static hint paragraph, not a discovery call.
  assert.match(body, /class="dhint"[^>]*>Already have agents/,
    'the pointer sub-line is not the muted .dhint hint paragraph it should be');
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
