'use strict';
/**
 * A restart that did not take is not reported as one.
 *
 * 🛑 WHAT WAS LIVE. The handler asked only whether the response was `ok`. The
 * route answers 400 for a REFUSED restart and 200 for everything else --
 * including PARTIAL, whose own sentence is "we could not close its window, so
 * it is still running the older instructions. Nothing was changed." So a
 * partial restart closed the dialog, wrote a success note, and left the notice
 * saying the agent needs restarting. Josh, 2026-08-22, three times in a row:
 * "The modal goes away. Literally nothing happens at all."
 *
 * ⚠️ THIS TEST CANNOT ASSERT THE FIX FOR HIS MACHINE, and saying so is part of
 * the finding: whether his restart is PARTIAL, or is genuinely RESTARTED with a
 * start time that arrives too late, is a reading nobody here can take. What it
 * pins is that the screen stops calling every 200 a success, so the next press
 * says which.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nodePath = require('path');
const page = require('./test-support/page.js');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const took = new Function(`${page.lift(SCRIPT, 'restartTook')}\nreturn restartTook;`)();
const line = new Function(`${page.lift(SCRIPT, 'restartFailureLine')}\nreturn restartFailureLine;`)();

test('only the restarted outcome counts as a restart', () => {
  assert.equal(took(true, { outcome: 'restarted' }), true);
  // 🛑 THE DEFECT ITSELF: 200 with an outcome that says nothing was changed.
  assert.equal(took(true, { outcome: 'partial' }), false);
  assert.equal(took(false, { outcome: 'refused' }), false);
  // A 200 whose body could not be parsed is not evidence of anything.
  assert.equal(took(true, null), false);
  assert.equal(took(true, {}), false);
});

test('the failure line carries the engine\'s sentence and both halves of the step list', () => {
  const said = line({
    outcome: 'partial',
    because: 'we could not close Anna\'s window, so it is still running the older instructions.',
    steps: [{ label: 'closed its window', ok: false }],
  });
  assert.match(said, /could not close Anna's window/);
  assert.match(said, /What failed: closed its window\./);
  // ⚠️ The steps that WORKED are named too: a restart that closed the window and
  // still did not take is a different machine problem from one that could not
  // close it, and the person reporting it cannot tell us which unless we say.
  const mixed = line({
    outcome: 'partial',
    because: 'it did not come back.',
    steps: [{ label: 'closed its window', ok: true }, { label: 'asked it to start again now', ok: false }],
  });
  assert.match(mixed, /What failed: asked it to start again now\./);
  assert.match(mixed, /What worked: closed its window\./);
});

test('it still says something when the engine says nothing', () => {
  /* The dialog stays open on a failure, so an empty line is a dialog with a
     dead button and no reason in it. */
  assert.match(line(null), /could not restart/i);
  assert.match(line({ outcome: 'partial' }), /could not restart/i);
});
