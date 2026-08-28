'use strict';
/**
 * The instructions banner repaints on every poll, and is not gated on the
 * editor having loaded (#1237).
 *
 * 🛑 THE DEFECT, AS JOSH MET IT ON 2026-08-27. The fourth of his observations
 * on #1213, and the one #1222 explicitly did not close:
 *
 *   "just the page refreshing made the error go away"
 *
 * #1222 fixed why the banner was WRONG. It stayed wrong because of something
 * else entirely. `tick` repainted it behind `fresh.isNamedOurs === true &&
 * INSTR_READY`, and the same poll body latches `INSTR_READY = false` on any
 * answer carrying `editable === false` -- which `server.js` returns for the
 * ordinary transient case of a pane it cannot tie to an agent by name. Nothing
 * in `tick` ever sets it back: the only `INSTR_READY = true` is inside
 * `loadInstructions`, which `tick` never calls. One blip therefore froze the
 * banner for the life of the open panel, and no later poll could clear it
 * however many times the verdict returned to `current`. Reloading ran
 * `loadInstructions`, which repaints unconditionally, so the alarm vanished
 * with nothing about the state having changed. Hence the refresh.
 *
 * 🔑 WHAT THIS FILE PROTECTS IS THE SEPARATION, NOT THE WORDING. `INSTR_READY`
 * answers "has the editor's text loaded". The banner answers "what is this
 * agent running". They are different questions and the banner was behind the
 * wrong one. Re-nesting the repaint inside that guard restores the freeze, and
 * that is what these assertions catch.
 *
 * ⚠️ WHY THE ASSERTIONS READ THE SOURCE. The poll is a six hundred line
 * function whose behaviour needs the whole board; the defect is not in what it
 * computes but in which conditional the call sits under. That is a structural
 * fact, so it is checked structurally, in the same spirit as the release-step
 * ordering tests. Each arm below is paired with a control proving it can fail.
 *
 *   node --test web.banner-latch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const nodePath = require('path');
const page = require('./test-support/page.js');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const TICK = page.lift(SCRIPT, 'tick');

/**
 * The same source with comments removed.
 *
 * 🛑 WRITTEN AFTER THIS FILE CAUGHT ITSELF. The last assertion below first read
 * the raw source and failed, because the explanatory comment added to `tick` by
 * this very fix contains the words `INSTR_READY = true` while explaining that
 * the poll never does that. A test that reads source has to be told the
 * difference between code and prose about code, or it reports on the sentence
 * describing the defect instead of on the defect.
 */
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const TICK_CODE = codeOnly(TICK);

/**
 * The `if (...)` condition immediately governing the first `renderStale` call
 * in a block of source. Walks back to the nearest `if (` and returns what is
 * between its parentheses, so the assertion is about the real guard rather
 * than about whatever words happen to sit near the call.
 */
function guardOf(src, call) {
  const at = src.indexOf(call);
  assert.ok(at > -1, 'the call ' + call + ' is not in this source at all');
  const ifAt = src.lastIndexOf('if (', at);
  assert.ok(ifAt > -1, 'no `if (` precedes ' + call);
  let depth = 0;
  for (let k = src.indexOf('(', ifAt); k < at; k += 1) {
    if (src[k] === '(') depth += 1;
    else if (src[k] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(src.indexOf('(', ifAt) + 1, k);
    }
  }
  assert.fail('the `if` before ' + call + ' never closes before the call');
}

test('the poll repaints the banner without waiting for the editor to have loaded', () => {
  const guard = guardOf(TICK, 'renderStale(fresh.instructions)');
  assert.ok(!/INSTR_READY/.test(guard),
    'the banner repaint is gated on INSTR_READY again, which is the #1237 freeze: '
    + 'one `editable: false` poll latches that flag off, `tick` never sets it back, '
    + 'and the banner can then only be cleared by reloading the page. Guard was: ' + guard);
});

test('CONTROL: the same reader DOES see INSTR_READY on the shape that had the defect', () => {
  const defective = `
    if (fresh && fresh.isNamedOurs === true && INSTR_READY) {
      renderStale(fresh.instructions);
    }`;
  const guard = guardOf(defective, 'renderStale(fresh.instructions)');
  assert.match(guard, /INSTR_READY/,
    'the reader cannot see INSTR_READY even when it is there, so the assertion above proves nothing');
});

test('the poll still declines to repaint a pane it cannot tie to an agent', () => {
  const guard = guardOf(TICK, 'renderStale(fresh.instructions)');
  assert.match(guard, /isNamedOurs/,
    'dropping the isNamedOurs condition trades a stuck banner for a flickering one: '
    + 'an untied pane resolves to the `unknown` arm, which is the loudest banner in the app, '
    + 'and a blip would now paint it. Skipping is safe only because no latch remains to hold it.');
});

test('CONTROL: that reader can also report a guard with no isNamedOurs in it', () => {
  const guard = guardOf('if (fresh && INSTR_READY) { renderStale(fresh.instructions); }',
    'renderStale(fresh.instructions)');
  assert.ok(!/isNamedOurs/.test(guard),
    'the reader claims isNamedOurs is present when it is not, so the assertion above proves nothing');
});

test('CONTROL: the comment stripper really removes prose, and keeps code', () => {
  const sample = '/* INSTR_READY = true in a block comment */\n'
    + 'a = 1; // INSTR_READY = true in a line comment\n'
    + 'INSTR_READY = false;';
  const got = codeOnly(sample);
  assert.ok(!/INSTR_READY\s*=\s*true/.test(got),
    'the stripper leaves prose behind, so the assertion below would read comments as code');
  assert.match(got, /INSTR_READY\s*=\s*false/,
    'the stripper ate real code, so the assertion below could pass on an empty string');
});

test('the latch the fix removes is still real: tick never re-arms INSTR_READY', () => {
  assert.ok(/INSTR_READY\s*=\s*false/.test(TICK_CODE),
    'the poll no longer latches INSTR_READY off. If that is deliberate, this file’s premise '
    + 'has changed and the reasoning above needs rewriting rather than the assertion relaxing.');
  assert.ok(!/INSTR_READY\s*=\s*true/.test(TICK_CODE),
    'the poll now sets INSTR_READY back to true. That would be a second, independent cure for '
    + '#1237, and the guard question above should be re-decided rather than left to two fixes.');
});
