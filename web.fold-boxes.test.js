'use strict';

/**
 * #370, Josh 2026-08-23 19:30: "Boxes, fold to one if engineering mode is
 * turned off in settings, leave it and the tmux window if engineering mode is
 * turned on." The project page's one derivation of that fold.
 *
 * #2691, Josh 2026-09-10: "All of that needs to go away. I don't know why it
 * appears on some projects sometimes." The one-to-one box used to reappear in
 * the Off (folded) view whenever an agent was waiting on an answer -- the
 * #2575/#2146 asking-override. Josh walked that override back, so the fold is
 * now UNCONDITIONAL: Off hides the box whether or not an agent is asking. The
 * waiting agent is still signalled in the roster ("Needs you" + the #2699 red
 * triangle) and answered through the detail view (#d-qask), so no function is
 * lost -- see docs/browser-checks/render-engmode-gate-2131.js.
 *
 *   node --test web.fold-boxes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function apply(engOn, asking) {
  /* The function runs against a stub document so the truth table is the
     function's own, not a re-statement of it here. `asking` sets the question
     panel's visibility the way paintThread would; after #2691 the fold no
     longer reads it, and this test proves that by driving both values of it. */
  const state = {
    vp: { hidden: undefined },
    box: { hidden: undefined },
    q: { hidden: !asking },
  };
  const src = page.lift(SCRIPT, 'pjApplyEngMode');
  const fn = new Function('ENG_ON', 'document', src + '\npjApplyEngMode();');
  fn(engOn, {
    querySelector: (sel) => (sel === '.pj-viewport' ? state.vp : null),
    getElementById: (id) => (id === 'pj-thread' ? state.box
      : (id === 'pj-question' ? state.q : null)),
  });
  return state;
}

test('off folds to one box and hides the window, on keeps both (#370)', () => {
  // Engineering mode OFF, nobody asking: one composer. Box and window gone.
  let s = apply(false, false);
  assert.equal(s.box.hidden, true, 'the one-to-one box survived the fold');
  assert.equal(s.vp.hidden, true, 'the raw window shows with the mode off');

  // Engineering mode ON: both stay.
  s = apply(true, false);
  assert.equal(s.box.hidden, false, 'the one-to-one box did not come back in Engineering mode');
  assert.equal(s.vp.hidden, false, 'the raw window did not come back in Engineering mode');
});

test('#2691: the fold is unconditional in Off -- a waiting agent no longer reopens the box', () => {
  // OFF and an agent IS waiting (q visible): the box STAYS folded. This is the
  // #2575/#2146 asking-override, walked back. The waiting signal + answer live
  // in the roster and the detail view now, not in this room box.
  let s = apply(false, true);
  assert.equal(s.box.hidden, true,
    'a waiting agent reopened the one-to-one box in Off -- the #2691 walk-back regressed');
  assert.equal(s.vp.hidden, true, 'the raw window leaked in Off');

  // ON and asking: the box is up because ENG is on, not because of the question.
  s = apply(true, true);
  assert.equal(s.box.hidden, false, 'Engineering mode stopped showing the box');

  // The fold depends ONLY on the mode: Off hides it and On shows it, whether or
  // not an agent is asking. (If this ever fails, the fold has started reading a
  // question state again -- the override coming back.)
  assert.equal(apply(false, false).box.hidden, apply(false, true).box.hidden,
    'the Off fold now depends on whether an agent is asking');
  assert.equal(apply(true, false).box.hidden, apply(true, true).box.hidden,
    'the On fold now depends on whether an agent is asking');
});

test('#2691: the Off-mode dismiss machinery is gone (no breadcrumb, no PJ_THREAD_HIDDEN)', () => {
  // The Hide link + safety breadcrumb existed only to collapse/restore the box
  // in the Off asking-override. With that override removed they are dead, and
  // Josh named the hide link for removal. Pin their absence so a re-add is loud.
  const src = page.lift(SCRIPT, 'pjApplyEngMode');
  assert.doesNotMatch(src, /pj-thread-show/,
    'pjApplyEngMode still touches the removed #pj-thread-show breadcrumb');
  assert.doesNotMatch(src, /PJ_THREAD_HIDDEN/,
    'pjApplyEngMode still reads the removed per-session dismiss flag');
  assert.equal(PAGE.indexOf('id="pj-thread-hide"'), -1,
    'the removed head "Hide" button markup is back');
  assert.equal(PAGE.indexOf('id="pj-thread-show"'), -1,
    'the removed safety breadcrumb markup is back');
  assert.doesNotMatch(SCRIPT, /PJ_THREAD_HIDDEN/,
    'the removed per-session dismiss flag is still declared or assigned somewhere');
});

test('every question toggle re-derives the fold, so the box cannot go stale between polls', () => {
  /* The fold reads no question state now, but paintThread still flips the
     question panel and must re-derive the fold on every flip (a general
     invariant, unchanged by #2691). Count the toggles against the
     re-derivations in the same statement neighbourhood. */
  const toggles = [...SCRIPT.matchAll(/qWrap\.hidden = (?:true|false);|getElementById\('pj-question'\)\.hidden = true;/g)];
  assert.ok(toggles.length >= 5, 'the question toggles moved; restate this pin against the new shape');
  for (const m of toggles) {
    const after = SCRIPT.slice(m.index, m.index + 200);
    assert.match(after, /pjApplyEngMode\(\)/,
      'a question toggle does not re-derive the fold: ' + after.slice(0, 60).replace(/\s+/g, ' '));
  }
});
