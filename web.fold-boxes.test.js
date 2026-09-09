'use strict';

/**
 * #370, Josh 2026-08-23 19:30: "Boxes, fold to one if engineering mode is
 * turned off in settings, leave it and the tmux window if engineering mode
 * is turned on." The project page's one derivation of that fold.
 *
 *   node --test web.fold-boxes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function apply(engOn, asking, hidden) {
  /* The function runs against a stub document so the truth table is the
     function's own, not a re-statement of it here. `hidden` is #2575's
     per-session dismiss (PJ_THREAD_HIDDEN); the `crumb` stub is its safety
     breadcrumb (#pj-thread-show). */
  const state = {
    vp: { hidden: undefined },
    box: { hidden: undefined },
    q: { hidden: !asking },
    crumb: { hidden: undefined, textContent: '' },
  };
  const src = page.lift(SCRIPT, 'pjApplyEngMode');
  const fn = new Function('ENG_ON', 'PJ_THREAD_HIDDEN', 'document', src + '\npjApplyEngMode();');
  fn(engOn, !!hidden, {
    querySelector: (sel) => (sel === '.pj-viewport' ? state.vp : null),
    getElementById: (id) => (id === 'pj-thread' ? state.box
      : (id === 'pj-question' ? state.q
      : (id === 'pj-thread-show' ? state.crumb : null))),
  });
  return state;
}

test('off folds to one box, on keeps the box and the window, a waiting agent overrides the fold (#370)', () => {
  // Engineering mode OFF, nobody asking: one composer. Box and window gone.
  let s = apply(false, false);
  assert.equal(s.box.hidden, true, 'the one-to-one box survived the fold');
  assert.equal(s.vp.hidden, true, 'the raw window shows with the mode off');

  // OFF but an agent is waiting on an answer: the box comes back, because the
  // question panel and the number-typing composer live inside it. The raw
  // window stays gated: safety shows the question, not the whole screen.
  s = apply(false, true);
  assert.equal(s.box.hidden, false, 'a waiting agent could not be answered with the mode off');
  assert.equal(s.vp.hidden, true, 'the override leaked the raw window too');

  // Engineering mode ON: both stay, whatever the question state.
  s = apply(true, false);
  assert.equal(s.box.hidden, false);
  assert.equal(s.vp.hidden, false);
});

test('#2575: dismissing the area hides it even while an agent is asking, but the safety breadcrumb keeps the waiting signal', () => {
  // OFF, an agent is asking, and the person dismissed the area: the box stays
  // hidden (the clutter Josh reported is gone), and the breadcrumb shows so the
  // waiting agent is never silently dropped -- the false-calm #370 forbids.
  let s = apply(false, true, true);
  assert.equal(s.box.hidden, true, 'a dismissed area kept surfacing the question + second composer');
  assert.equal(s.crumb.hidden, false, 'the safety breadcrumb did not show, so a real waiting agent went silent');
  assert.match(s.crumb.textContent, /waiting on an answer/, 'the breadcrumb does not name the waiting state');

  // OFF, asking, NOT dismissed: unchanged safety behaviour -- the box shows and
  // there is no breadcrumb (the full panel is already up).
  s = apply(false, true, false);
  assert.equal(s.box.hidden, false, 'the un-dismissed waiting override regressed');
  assert.equal(s.crumb.hidden, true, 'the breadcrumb showed while the full box was already up');

  // ENG mode ON: the dismiss never hides the box (engineer affordance + safety
  // both need it), and no breadcrumb is shown.
  s = apply(true, true, true);
  assert.equal(s.box.hidden, false, 'the dismiss wrongly hid the box in engineering mode');
  assert.equal(s.crumb.hidden, true, 'a breadcrumb showed in engineering mode where the box is already up');
});

test('every question toggle re-derives the fold, so the box cannot go stale between polls', () => {
  /* The fold reads the question panel's visibility, so any place that flips
     it must re-derive. Count the toggles against the re-derivations in the
     same statement neighbourhood: a new toggle without its call fails here. */
  const toggles = [...SCRIPT.matchAll(/qWrap\.hidden = (?:true|false);|getElementById\('pj-question'\)\.hidden = true;/g)];
  assert.ok(toggles.length >= 5, 'the question toggles moved; restate this pin against the new shape');
  for (const m of toggles) {
    const after = SCRIPT.slice(m.index, m.index + 200);
    assert.match(after, /pjApplyEngMode\(\)/,
      'a question toggle does not re-derive the fold: ' + after.slice(0, 60).replace(/\s+/g, ' '));
  }
});
