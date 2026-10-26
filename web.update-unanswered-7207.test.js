'use strict';

/**
 * #7207 (Josh, 2026-10-26 10:28): an Update press that got NO answer (the board restarting, very often to install the
 * update that press started) offered Update again, so he pressed it "like a million times". The dialog now waits for
 * the board to answer and decides what to say from its status through one pure function, driven here branch by branch:
 * a new version is done; a new boot on the same version restarted without updating; the same boot answering never
 * went away; three minutes of silence is the deadline; anything else waits.
 *
 *   node --test web.update-unanswered-7207.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
function lift(name) {
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  return script.slice(start, end);
}
// eslint-disable-next-line no-new-func
const verdict = new Function(lift('unansweredPressVerdict') + '\nreturn unansweredPressVerdict;')();

const MIN = 60 * 1000;
const base = { elapsedMs: 10 * 1000, reached: false, before: '0.7.68', now: null, bootBefore: 'boot-A', bootNow: null };
const v = (over) => verdict({ ...base, ...over });

test('no answer yet waits, until three minutes have passed', () => {
  assert.equal(v({}), 'waiting');
  assert.equal(v({ elapsedMs: 3 * MIN - 1 }), 'waiting');
  assert.equal(v({ elapsedMs: 3 * MIN }), 'deadline');
});

test('the board answering on a NEW version is done, whether or not its boot changed', () => {
  assert.equal(v({ reached: true, now: '0.7.69', bootNow: 'boot-B' }), 'done');
  assert.equal(v({ reached: true, now: '0.7.69', bootNow: 'boot-A' }), 'done');
});

test('a new boot on the SAME version restarted without updating', () => {
  assert.equal(v({ reached: true, now: '0.7.68', bootNow: 'boot-B' }), 'restarted');
});

test('the same boot answering never went away (the press may not have reached it), never "done" or "restarted"', () => {
  assert.equal(v({ reached: true, now: '0.7.68', bootNow: 'boot-A' }), 'answering');
  // CONTROL: an answer settles even after the deadline would have passed: an answer beats a clock.
  assert.equal(v({ reached: true, now: '0.7.68', bootNow: 'boot-A', elapsedMs: 10 * MIN }), 'answering');
});

test('with nothing known from before, an answer is never read as done or restarted', () => {
  assert.equal(v({ reached: true, before: null, now: '0.7.69', bootBefore: null, bootNow: 'boot-B' }), 'answering');
  assert.equal(v({ reached: true, now: null, bootNow: null }), 'answering');
  // Version from before unknown, boots known and different: the new boot may BE the update, so never "restarted".
  assert.equal(v({ reached: true, before: null, now: '0.7.69', bootNow: 'boot-B' }), 'answering');
  // CONTROL: the same answer with the version from before known is "restarted" (same version) or "done" (new one).
  assert.equal(v({ reached: true, now: '0.7.68', bootNow: 'boot-B' }), 'restarted');
});

test('the dialog waits instead of offering the button again (wiring, text only)', () => {
  const press = script.slice(script.indexOf("document.getElementById('uc-go').addEventListener('click'"));
  assert.match(press, /if \(!res\) \{ waitForUnansweredPress\(rollingBack\); return; \}/,
    'a press with no answer does not go to the wait');
  const wait = lift('waitForUnansweredPress');
  assert.match(wait, /go\.disabled = true;/, 'the button is not turned off while waiting');
  assert.equal((wait.match(/if \(gen !== UPD_WAIT_GEN \|\| dlg\.hidden\) return;/g) || []).length, 2,
    'closing or reopening the dialog does not stop the asking, before and after each status read');
  for (const fn of ['openUpdConfirm', 'closeUpdConfirm']) {
    assert.match(lift(fn), /UPD_WAIT_GEN \+= 1;/, fn + ' does not end a wait still writing into the dialog');
  }
  assert.match(wait, /unansweredPressVerdict\(/, 'the wait does not decide through the pure function');
});

test('a button turned into Reload only reloads, it never also presses Update', () => {
  const press = script.slice(script.indexOf("document.getElementById('uc-go').addEventListener('click'"));
  const head = press.slice(0, press.indexOf('fetch(endpoint'));
  assert.match(head, /if \(go\.dataset\.reloadOnly === '1'\) return;/, 'the press listener does not stand down for Reload');
  // Every place that turns the button into Reload marks it so, and every opening clears the mark.
  const reloads = script.match(/go\.onclick = \(\) => window\.location\.reload\(\);/g) || [];
  const marks = script.match(/go\.dataset\.reloadOnly = '1';[^\n]*\n\s*go\.onclick = \(\) => window\.location\.reload\(\);/g) || [];
  assert.ok(reloads.length >= 2, 'expected both Reload sites (the 409 and the deadline), found ' + reloads.length);
  assert.equal(marks.length, reloads.length, 'a Reload site does not mark the button reload-only');
  assert.match(lift('openUpdConfirm'), /delete go\.dataset\.reloadOnly;/, 'opening the dialog keeps an old Reload mark');
});
