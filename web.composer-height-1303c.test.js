'use strict';

/**
 * #1303 group C. Josh, 2026-08-28, reviewing 0.5.97:
 *
 *   "When I type into the dialog box, if it expands to two lines for the
 *    message that I'm sending, or three lines, or however many lines, and I
 *    send it, it stays stuck at that height instead of reverting back to a
 *    single line for another new message. It ends up consuming a huge amount of
 *    the page and then I can't get it to go back down."
 *
 * 🛑 IT IS BEHAVIOURAL, NOT COSMETIC. `pjGrowComposer` writes `style.height` in
 * PIXELS as you type. Clearing `value` does not touch an inline style, so a
 * three-line box kept a three-line height with nothing in it, for the rest of
 * the session, and no amount of deleting text brought it back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

/* The real pair, lifted from the shipped page rather than reimplemented. */
// eslint-disable-next-line no-new-func
const reset = new Function(
  page.lift(SCRIPT, 'pjGrowComposer') + '\n' + page.lift(SCRIPT, 'pjComposerReset')
  + '; return pjComposerReset;',
)();

/* A textarea models exactly two things here: what it holds, and the height the
   browser would need for it. `scrollHeight` follows the content the way the
   real element does, so the arithmetic under test is the real arithmetic. */
const box = (value, oneLine = 20, perLine = 20) => ({
  value,
  style: { height: '' },
  get scrollHeight() {
    const lines = this.value === '' ? 1 : this.value.split('\n').length;
    return oneLine + (lines - 1) * perLine;
  },
});

test('#1303C: sending a three-line message leaves a one-line box', () => {
  const el = box('one\ntwo\nthree');
  /* As typed: the grow ran on input and the box is three lines tall. */
  // eslint-disable-next-line no-new-func
  const grow = new Function(page.lift(SCRIPT, 'pjGrowComposer') + '; return pjGrowComposer;')();
  grow(el);
  assert.equal(el.style.height, '60px', 'the fixture does not model growth, so nothing below is a test');

  reset(el);
  assert.equal(el.value, '', 'the composer kept the sent words');
  assert.equal(el.style.height, '20px',
    'the box stayed at its expanded height with nothing in it, which is the defect');
});

test('#1303C: it is the HEIGHT that was stuck, not the text', () => {
  /* 🔑 THE CONTROL FOR THE DEFECT ITSELF. Clearing the value alone, which is
     what the send path did, leaves the inline height exactly where it was. If
     this row ever goes green the fix has become untestable, because the thing
     it repairs would no longer be broken in the first place. */
  const el = box('one\ntwo\nthree');
  // eslint-disable-next-line no-new-func
  const grow = new Function(page.lift(SCRIPT, 'pjGrowComposer') + '; return pjGrowComposer;')();
  grow(el);
  el.value = '';
  assert.equal(el.style.height, '60px',
    'clearing the value now resets the height on its own, so this test is measuring nothing');
});

test('#1303C: the send path uses the pair, not a bare value assignment', () => {
  /* The behavioural rows above prove the helper works. This one proves the
     SEND PATH calls it, which is where the defect actually lived. */
  const send = page.lift(SCRIPT, 'pjPostSend');
  assert.match(send, /pjComposerReset\(input\)/, 'the send path clears the box without resetting its height');
  assert.doesNotMatch(send, /input\.value = ''/, 'a bare clear is back, and it leaves the height behind');
});

test('#1303C: a null element is not an error, the same as its sibling', () => {
  assert.doesNotThrow(() => reset(null));
  assert.doesNotThrow(() => reset(undefined));
});
