'use strict';
/**
 * kosmos#1316: every modal has a way back that is not the action.
 *
 * Josh, on Cmd-Q: "we also need a Cancel here... Right now I hit it and if I'm
 * like 'Oh crap, I didn't mean to quit the app,' I'm stuck."
 *
 * 🛑 THIS IS THE SWEEP, NOT THE TWO FIXES. Two repairs would close the card and
 * leave the class open, and the card says why: a missing default, not two
 * misses. So this asserts the property across EVERY modal in the page, and the
 * count is part of the assertion: a check that walks two modals and passes says
 * nothing about the ten nobody looked at.
 *
 *   node --test web.modal-way-out-1316.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const SWIFT = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

/** Every element in the page carrying aria-modal, by the id of its backdrop. */
function modals() {
  const out = [];
  const re = /<(\w+)([^>]*aria-modal[^>]*)>/g;
  let m;
  while ((m = re.exec(PAGE))) {
    const before = PAGE.slice(0, m.index);
    const ids = [...before.matchAll(/<\w+[^>]*id="([^"]+)"[^>]*>/g)].map((x) => x[1]);
    out.push(ids[ids.length - 1]);
  }
  return out;
}

test('the sweep still covers every modal, and the count is the assertion', () => {
  /* 🔑 A FLOOR AND A CEILING. Without the floor a renamed attribute finds zero
     modals and this file passes while checking nothing. Without the ceiling a
     new modal joins the page and nobody notices it was never swept. */
  const found = modals();
  assert.ok(found.length >= 12,
    `only ${found.length} modals found; the sweep stopped seeing them, so every assertion below is vacuous`);
  assert.ok(found.length <= 14,
    `${found.length} modals now, up from 13. A new one joined the page: sweep it, then raise this number.`);
});

/**
 * ⭐ THE SWEEP ITSELF, AS A TABLE. Every modal, named, with the mechanism that
 * lets Escape out of it. This replaced a proximity heuristic (does "Escape"
 * appear within N characters of the id) which gave a FALSE NEGATIVE on code I
 * had just written and knew worked: `changeDialog` holds its element in a local
 * called `back`, so the id is nowhere near the handler.
 *
 * 🛑 A PROXIMITY GUESS IS NOT AN ASSERTION. It fails when code moves and passes
 * when two unrelated things sit close together, and both directions are silent.
 * A table costs more lines and says what was actually checked.
 */
const ESCAPES_VIA = {
  updconfirm:       /Escape[\s\S]{0,300}updconfirm/,
  'hist-modal':     /Escape[\s\S]{0,300}hist-modal/,
  'pol-modal':      /pol-modal'\)\.hidden\) return;/,
  'doc-modal':      /Escape[\s\S]{0,300}doc-modal/,
  'rst-modal':      /Escape[\s\S]{0,300}rst-modal/,
  'chg-modal':      /const onEsc = \(e\) => \{\n\s*if \(e\.key !== 'Escape'/,
  'nt-modal':       /Escape[\s\S]{0,300}nt-modal/,
  'mem-modal':      /mem-modal'\)\.hidden\) return;/,
  'acct-add-modal': /Escape[\s\S]{0,300}acct-add-modal/,
  'del-modal':      /del-modal'\)\.addEventListener\('keydown'[\s\S]{0,80}Escape/,
  'rm-modal':       /Escape[\s\S]{0,300}rm-modal/,
  /* Added by kosmos#1303 H: the add-a-member picker became a dialog, and this
     sweep caught it the moment it did -- the table refused a modal nobody had
     checked. The guard doing its job on its own author. */
  'am-modal':      /am-modal'\)\.hidden\) return;/,
};

test('every modal has a named way out with Escape, and the table covers them all', () => {
  const found = modals().filter((id) => id !== 'fr-dots' && id !== 'firstrun');
  const untabled = found.filter((id) => !(id in ESCAPES_VIA));
  assert.deepEqual(untabled, [],
    'these modals are not in the table, so nobody checked them: ' + untabled.join(', '));

  const missing = [];
  for (const [id, re] of Object.entries(ESCAPES_VIA)) {
    if (!re.test(PAGE)) missing.push(id);
  }
  assert.deepEqual(missing, [], 'these modals lost their Escape: ' + missing.join(', '));

  /* 🔑 THE CONTROL. Every pattern above is specific enough to fail, so prove the
     harness can say no: a modal that does not exist must not match anything. */
  assert.equal(/Escape[\s\S]{0,300}no-such-modal-xyz/.test(PAGE), false,
    'the matcher says yes to a modal that does not exist');
});

test('first-run is excluded deliberately, and that exclusion is stated', () => {
  /* It is a flow with its own Not-now controls, not a dismissible dialog, and
     Escape through it would drop somebody into a half-configured product. Named
     here so the exclusion is a decision on the record rather than a gap. */
  const found = modals();
  assert.ok(found.includes('fr-dots') || found.includes('firstrun'),
    'first-run stopped being a modal, so this exclusion may no longer be needed');
});

test('the modal Josh got stuck in refuses Escape only while the request is in flight', () => {
  /* ⚠️ NOT "Escape always closes it". Once the destructive button is pressed the
     switch is happening, and hiding the modal then would tell the person they
     cancelled something that is going ahead. A key that silently means the
     opposite of what it says is worse than one that does nothing. */
  const at = PAGE.indexOf('const onEsc = (e) => {');
  assert.notEqual(at, -1, 'the changeDialog Escape handler is gone');
  const fn = PAGE.slice(at, PAGE.indexOf('};', at) + 2);
  assert.match(fn, /goBtn\.disabled/, 'Escape no longer refuses to fire mid-flight');
  assert.match(fn, /back\.hidden/, 'Escape can fire for a dialog nobody opened');
  // And it is torn down, or reopening stacks handlers.
  const closeAt = PAGE.indexOf('const close = () => {\n    back.hidden = true;');
  assert.notEqual(closeAt, -1, 'the changeDialog close is gone');
  assert.match(PAGE.slice(closeAt, closeAt + 300), /removeEventListener\('keydown', onEsc\)/,
    'the Escape listener is never removed, so reopening the dialog stacks them');
  /* 🛑 AND IT IS ACTUALLY ATTACHED. A perturbation that deleted the
     addEventListener left every other assertion here green: the handler still
     EXISTED, it just never ran. Defining a listener and registering it are two
     facts and this file was only checking the first. */
  assert.match(PAGE, /document\.addEventListener\('keydown', onEsc\);\n  keep\.onclick = close;/,
    'the changeDialog Escape handler is defined but never registered, so it does nothing');
});

/* ── the native app ─────────────────────────────────────────────────────── */

test('the quit dialog has a Cancel, and it is the button Escape lands on', () => {
  assert.match(SWIFT, /static let quitButtons[\s\S]{0,200}\["Close the app", "Cancel"\]/,
    'the quit dialog lost its Cancel');
  const keys = SWIFT.match(/static func quitKeyEquivalents[\s\S]*?\n    \}/);
  assert.ok(keys, 'quitKeyEquivalents is gone');
  assert.match(keys[0], /cancelIndex \{ return "\\u\{1b\}" \}/, 'Escape no longer lands on Cancel');
  assert.match(keys[0], /returnIndex \{ return "\\r" \}/, 'Return no longer lands anywhere');
});

test('the quit dialog BRANCHES on the answer instead of confirming whatever comes back', () => {
  /* 🛑 THE ACTUAL DEFECT. It had one button and treated ANY return from
     runModal() as "Close the app" -- so Escape quit the app. Not "Escape did
     nothing": an NSAlert with one button returns on Escape too, and every
     return was read as confirmation. The only way out of a dialog about
     quitting was to quit. */
  const at = SWIFT.indexOf('private func showQuitDialog()');
  assert.notEqual(at, -1, 'showQuitDialog is gone');
  const fn = SWIFT.slice(at, SWIFT.indexOf('\n    }', at) + 6);
  assert.match(fn, /guard clicked == spec\.destructiveIndex else \{/,
    'the quit dialog stopped branching on which button was pressed');
  assert.match(fn, /return false/, 'there is no path out of showQuitDialog that keeps the app open');
  assert.doesNotMatch(fn, /any return from runModal/,
    'the one-button comment is still there, so the second button was not really added');
});

test('the accept branch is derived from the spec, not a hardcoded first-button literal', () => {
  // The house rule, stated on the relaunch alert: with the literal, swapping the
  // two TITLES inverts the product silently and Cancel becomes the quit.
  const at = SWIFT.indexOf('private func showQuitDialog()');
  const fn = SWIFT.slice(at, SWIFT.indexOf('\n    }', at) + 6);
  assert.doesNotMatch(fn, /clicked == 0\b/, 'the branch compares against a literal index');
  assert.match(fn, /spec\.destructiveIndex/, 'the branch no longer reads the spec');
});
