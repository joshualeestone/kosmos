'use strict';
/**
 * The change dialog always leaves a way out (#1313).
 *
 * 🛑 THE DEFECT, AS JOSH MET IT ON 0.5.97. He pressed "Switch and restart", the
 * switch WORKED, and the modal sat on "Working…" with no button, no error and no
 * cancel. His words: *"it doesnt seem to be resolving and stuck on this screen"*.
 * He read a completed action as a hang, because nothing on the screen could tell
 * the two apart.
 *
 * 🔑 THE CAUSE WAS NOT A HANG AND NOT THE ENGINE. `changeDialog` disables its go
 * button and hides its cancel the moment you press, and EVERY path that brings
 * one back lives inside the `say` callback it hands to `run`. Four of the five
 * callers passed `say` through. The provider switch did not, so nothing ever
 * called it, and the dialog had no exit left.
 *
 * ⭐ SO THIS FILE PINS THE CLASS, NOT THE INSTANCE. Fixing the one caller closes
 * Josh's bug; a sixth caller written next month reopens it. What has to hold is
 * that the dialog is not a trap NO MATTER WHAT `run` DOES: speaks, throws, or
 * quietly returns having said nothing.
 *
 *   node --test web.change-dialog-exit-1313.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page.js');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/** A stub element that records the fields the dialog sets on it. */
function el() {
  return { textContent: '', hidden: false, disabled: false, onclick: null, focus() {} };
}

/** Drive the real `changeDialog` over stub elements and hand back what it left. */
async function press(run) {
  const nodes = {
    'chg-modal': el(), 'chg-title': el(), 'chg-small': el(),
    'chg-keep': el(), 'chg-go': el(), 'chg-msg': el(),
  };
  /* ⚠️ THE STUB GREW A KEYBOARD (#1316). `changeDialog` now registers a
     document-level Escape handler, so a stub with only `getElementById` throws
     before any of the assertions below run. The listeners are RECORDED rather
     than ignored, so a test that wants to press Escape can, and so that a
     handler registered twice would be visible rather than silently absorbed. */
  const listeners = [];
  const document = {
    getElementById: (id) => nodes[id] || null,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const changeDialog = new Function('document', `${page.lift(SCRIPT, 'changeDialog')}\nreturn changeDialog;`)(document);
  changeDialog({ title: 't', small: 's', go: 'Go', run });
  await nodes['chg-go'].onclick();
  return nodes;
}

/** Is there anything the person can actually press? */
const wayOut = (n) => (!n['chg-keep'].hidden) || (!n['chg-go'].hidden && !n['chg-go'].disabled);

test('#1313: a run that finishes WITHOUT speaking still leaves a way out', async () => {
  const n = await press(async () => { /* the provider switch's old shape: says nothing */ });
  assert.ok(wayOut(n),
    'the dialog has no button left after a silent run, which is the trap Josh sat in: '
    + `keep.hidden=${n['chg-keep'].hidden} go.hidden=${n['chg-go'].hidden} go.disabled=${n['chg-go'].disabled}`);
  assert.notEqual(n['chg-msg'].textContent, 'Working…',
    'the dialog is still saying Working after the work ended');
});

test('#1313: a run that THROWS leaves a way out and says what happened', async () => {
  const n = await press(async () => { throw new Error('the runner refused'); });
  assert.ok(wayOut(n), 'a thrown run left the dialog with nothing to press');
  assert.match(n['chg-msg'].textContent, /refused/,
    'the failure sentence was swallowed, so the person is told nothing');
});

test('#1313: a run that DOES speak is unchanged, and its own sentence wins', async () => {
  const n = await press(async (say) => { say('Switched to OpenAI.', true); });
  assert.ok(wayOut(n), 'a speaking run left no way out');
  assert.equal(n['chg-msg'].textContent, 'Switched to OpenAI.',
    'the run said one thing and the dialog showed another');
  assert.equal(n['chg-keep'].textContent, 'Done',
    'a successful run should offer Done rather than Close');
});

test('CONTROL: the harness can observe the trap, so the assertions above are live', async () => {
  /* The pre-fix shape, reproduced directly: everything that restores a control
     lives inside `say`, and a silent run never calls it. If this control cannot
     construct a trap, the three tests above prove nothing. */
  const n = { 'chg-keep': el(), 'chg-go': el() };
  n['chg-go'].disabled = true; n['chg-keep'].hidden = true;
  assert.ok(!wayOut(n), 'the reader says there is a way out of a dialog with both controls gone');
});

test('CONTROL: every changeDialog caller passes the callback through', () => {
  const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const runs = PAGE.split('\n').filter((l) => /^\s*run: /.test(l));
  assert.ok(runs.length >= 5, `only ${runs.length} run: callers found, so this scan is looking at the wrong thing`);
  const silent = runs.filter((l) => /run: \(\s*\) =>/.test(l));
  assert.deepEqual(silent, [],
    'a changeDialog caller takes no `say`, which is exactly how #1313 happened: ' + silent.join(' | '));
});
