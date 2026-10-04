'use strict';
/*
 * kosmos#5257: the project page's "Its screen" block, run for real (lifted from the shipped page) on each state a
 * thread read can carry. #5249 (#5223) gave a Windows agent, which has no window, "No screen to show" and the
 * engine's own sentence, and merged with no test for it (the browser-check arm needed a live thread the CI fixture
 * could not serve). This needs no thread: pjPaintScreen is fed the viewport a read would carry.
 *
 *   node --test web.pj-screen-5257.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

/* The three elements the block writes, and nothing else: a write to any other id throws, so a painter that grew a
   new dependency fails here rather than passing on a stub that ignored it. */
function paint(viewport, name = 'Mara') {
  const els = {
    'pj-screen': { hidden: true, text: null },
    'pj-screen-hint': { textContent: '' },
    'pj-screen-label': { textContent: '' },
  };
  const document = { getElementById: (id) => { if (!els[id]) throw new Error('unexpected element ' + id); return els[id]; } };
  const pjSetScreen = (el, text) => { el.text = text; };
  const run = new Function('document', 'pjSetScreen',
    page.lift(SCRIPT, 'pjSentence') + '\n' + page.lift(SCRIPT, 'pjPaintScreen') + '\nreturn pjPaintScreen;')(document, pjSetScreen);
  run({ viewport }, name);
  return { label: els['pj-screen-label'].textContent, hint: els['pj-screen-hint'].textContent, hidden: els['pj-screen'].hidden, text: els['pj-screen'].text };
}

const WIN_BECAUSE = 'on Windows an agent runs without a window, so there is no screen to show';

test('#5257: a Windows agent (noWindow) reads "No screen to show" and the engine\'s sentence, with no "right now" lead', () => {
  const got = paint({ text: null, noWindow: true, because: WIN_BECAUSE });
  assert.equal(got.label, 'No screen to show');
  assert.equal(got.hint, 'On Windows an agent runs without a window, so there is no screen to show.', 'the engine sentence, capitalised, one full stop');
  assert.doesNotMatch(got.hint, /We cannot see its screen right now/, 'a lasting fact read as a passing failure');
  assert.equal(got.hidden, true, 'an empty screen box was shown');
});

test('#5257 CONTROL: without noWindow the Windows wording never appears (a read that failed, on a Mac)', () => {
  const got = paint({ text: null, because: 'we could not reach the agents on this computer' });
  assert.equal(got.label, 'Its screen');
  assert.equal(got.hint, 'We cannot see its screen right now. We could not reach the agents on this computer.');
  assert.doesNotMatch(got.label + got.hint, /No screen to show/);
  // noWindow must be exactly true: a truthy non-boolean is not the Windows mark.
  assert.equal(paint({ text: null, noWindow: 'yes', because: 'x' }).label, 'Its screen');
  // A read with no viewport at all, and one with no reason, still say the honest generic line.
  assert.equal(paint(undefined).hint, 'We cannot see its screen right now.');
});

test('#5257 CONTROL: a captured screen is shown under the member\'s name (the branch this block guards against)', () => {
  const got = paint({ text: 'line one\nline two' }, 'Mara');
  assert.equal(got.label, 'What Mara\u2019s screen shows right now');
  assert.equal(got.hidden, false);
  assert.equal(got.text, 'line one\nline two');
  assert.match(got.hint, /^This is the window it is running in, as it looks right now\./);
});

test('#5257: paintThread hands its read and name to pjPaintScreen (the block is not painted some other way)', () => {
  const body = page.lift(SCRIPT, 'paintThread');
  assert.match(body, /pjPaintScreen\(body, name\);/);
  assert.doesNotMatch(body, /getElementById\('pj-screen-label'\)/, 'paintThread paints the label itself again, beside the lifted painter');
});
