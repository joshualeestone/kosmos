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
  nodes.__listeners = listeners;   // #4963: so a test can press Escape
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

/* #4963 (Josh, 0.7.16): "you should not be able to press Done ... we shouldnt even show that button until
   the process is totally complete". While a restart is waking the agent the dialog shows no button. That is
   only acceptable because it is still not a trap: Escape closes it (the wake goes on without the dialog),
   and if the wake helper never reports, Close comes back once its longest wait has passed. */
test('#4963: while the agent is waking there is no button, but Escape still closes the dialog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });   // the fallback timer must not hold the process open
  const n = await press(async (say) => { say('Restarted on Gemini. Waking them…', true, true); });
  assert.equal(n['chg-keep'].hidden, true, 'a button is offered while the agent is still waking');
  assert.equal(n['chg-msg'].textContent, 'Restarted on Gemini. Waking them…');
  const esc = n.__listeners.filter((l) => l.type === 'keydown');
  assert.equal(esc.length, 1, 'the dialog lost its Escape handler');
  esc[0].fn({ key: 'Escape' });
  assert.equal(n['chg-modal'].hidden, true, 'Escape did not close a dialog whose switch has already happened');
});

test('#4963: while the agent is waking, a tap outside the dialog closes it (no Escape on a phone)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const n = await press(async (say) => { say('Restarted on Gemini. Waking them…', true, true); });
  assert.equal(typeof n['chg-modal'].onclick, 'function', 'the backdrop has no way out while waking');
  n['chg-modal'].onclick({ target: { id: 'chg-title' } });
  assert.equal(n['chg-modal'].hidden, false, 'a tap INSIDE the dialog closed it');
  n['chg-modal'].onclick({ target: n['chg-modal'] });
  assert.equal(n['chg-modal'].hidden, true, 'a tap on the backdrop did not close a waking dialog');
});

test('#4963 CONTROL: before the switch has happened, a tap outside does not close it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const n = await press(async (say) => { say('Switched to OpenAI.', true); });
  if (typeof n['chg-modal'].onclick === 'function') n['chg-modal'].onclick({ target: n['chg-modal'] });
  assert.equal(n['chg-modal'].hidden, false, 'a finished, non-waking dialog closed on a backdrop tap, which this change did not add');
});

test('#4963: if the wake never reports, Close comes back, so the dialog is never a trap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const n = await press(async (say) => { say('Restarted on Gemini. Waking them…', true, true); });
  assert.equal(n['chg-keep'].hidden, true);
  t.mock.timers.tick(59000);
  assert.equal(n['chg-keep'].hidden, true, 'the button came back before the wake could have finished');
  t.mock.timers.tick(2000);
  assert.ok(wayOut(n), 'the dialog stayed with nothing to press after the longest wake had passed');
  assert.equal(n['chg-keep'].textContent, 'Close', 'an unfinished wake must not be offered as Done');
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
