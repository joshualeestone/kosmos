'use strict';

/**
 * #1438: every modal needs a way out BY DEFAULT, not by hand.
 *
 * 🛑 THE SWEEP IS NOT THE POINT. #1316's sweep already established that all 12
 * modals are fine today, and confirming them again is worth nothing. What was
 * missing is the thing that FAILS when the 13th has no way out. This file is
 * that thing.
 *
 * ⭐ WHY A DEFAULT IS MISSING AT ALL: there is no shared modal helper. Every
 * modal wires its own buttons by hand, and the page says so beside
 * `updconfirm`: "A new sibling does not inherit a guard by sitting beside one."
 * Josh has hit the consequence twice, #1313 and #1316.
 *
 * ── WHAT COUNTS AS A WAY OUT, AND WHY IT IS THIS AND NOT SOMETHING TIDIER ──
 *
 * ⚠️ MEASURED, because my first two rules were both wrong:
 *
 *   "the modal id sits near an Escape handler"   -> PROXIMITY, not wiring. It
 *      would pass a modal whose id merely appears near an unrelated handler,
 *      which is the same "matches anywhere" hole #1387 has.
 *   "at least two buttons"                       -> OVER-EAGER. It flags
 *      `acct-add-modal` ("Close") and `am-modal` ("Cancel"), whose SINGLE
 *      button IS the way out.
 *
 * ✅ The rule that survives both: **at least one action that is not the
 * primary or destructive one.** A single "Close" passes, because closing is
 * the way out. A lone "Quit" does not, because the only exit is forward, and
 * that is exactly the shape Josh reported in #1316.
 *
 * 📌 It asserts a SHAPE, never a label or a byte-exact rule. Nothing consumes
 * those (see #1430, which is the card about what pinning them costs).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** Every modal wrapper, and the actions row belonging to it. */
function modalsIn(html) {
  const out = [];
  for (const w of html.matchAll(/<div class="rm-back"[^>]*id="([a-z0-9-]+)"/g)) {
    const ai = html.indexOf('class="rm-acts"', w.index);
    if (ai < 0) { out.push({ id: w[1], acts: null, buttons: [] }); continue; }
    const acts = html.slice(ai, html.indexOf('</div>', ai));
    const buttons = [...acts.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    out.push({ id: w[1], acts, buttons });
  }
  return out;
}

const isPrimary = (cls) => /uprime|danger/.test(cls);
const wayOut = (m) => m.buttons.some((c) => !isPrimary(c));

test('#1438: every modal has an action that is not the primary one', () => {
  const modals = modalsIn(PAGE);
  assert.ok(modals.length >= 10,
    'found ' + modals.length + ' modals, so this test is looking in the wrong place');

  const stuck = modals.filter((m) => !wayOut(m)).map((m) => m.id);
  assert.deepEqual(stuck, [],
    'these modals offer no way out except the action itself, which is what Josh hit twice');
});

test('#1438: every modal has an actions row at all', () => {
  /* A modal with no `rm-acts` has no buttons to reason about, and the check
     above would pass it vacuously on an empty list. */
  const missing = modalsIn(PAGE).filter((m) => m.acts === null).map((m) => m.id);
  assert.deepEqual(missing, [], 'a modal with no actions row cannot offer a way out');
});

test('#1438 DEAD arm: the rule passes a modal whose only button IS the exit', () => {
  /* `acct-add-modal` is a single "Close" and `am-modal` a single "Cancel".
     A rule demanding two buttons would flag both, and they are correct. This
     arm exists because that was my first rule and it was wrong. */
  const one = '<div class="rm-back" id="only-close-modal" hidden>'
    + '<div class="rm-box" role="dialog" aria-modal="true">'
    + '<div class="rm-acts"><button class="btn" type="button">Close</button></div></div></div>';
  const m = modalsIn(one)[0];
  assert.equal(m.buttons.length, 1);
  assert.equal(wayOut(m), true, 'a lone Close IS a way out and must not be flagged');
});

test('#1438 PRECISION arm: a modal whose only button is the ACTION is caught', () => {
  /* The #1316 shape, in miniature: one button, and pressing it does the thing
     you are trying to escape. This is the case the whole file exists for, and
     without this arm the two above would pass on a rule that flags nothing. */
  const stuck = '<div class="rm-back" id="quit-only-modal" hidden>'
    + '<div class="rm-box" role="alertdialog" aria-modal="true">'
    + '<div class="rm-acts"><button class="btn uprime" type="button">Quit</button></div></div></div>';
  const m = modalsIn(stuck)[0];
  assert.equal(wayOut(m), false, 'a lone primary action is NOT a way out');

  const danger = stuck.replace('uprime', 'danger-btn');
  assert.equal(wayOut(modalsIn(danger)[0]), false, 'and the destructive spelling is caught too');
});
