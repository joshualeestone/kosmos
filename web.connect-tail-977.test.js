'use strict';

/**
 * kosmos#977: the tail of the add-a-Claude-account flow.
 *
 * Two defects, and both are the same shape -- a screen describing a state that
 * is not the one the person is in.
 *
 *   node --test web.connect-tail-977.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
function token(name, after) {
  const from = after ? PAGE.indexOf(after) : 0;
  const m = PAGE.slice(from).match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, '--' + name + ' is not defined' + (after ? ' in the dark block' : ''));
  return m[1];
}

/* An instruction phrased as a requirement makes its ABSENCE read as a failure.
   Josh went looking for an email that never arrives. The first-run flow has
   used the conditional all along; Settings was the outlier. */
test('the code step is conditional, because the code does not always come', () => {
  /* ⚠️ LIVE LINES ONLY. The first version of this searched the whole page and
     matched the COMMENT that quotes the old sentence for the record -- it
     reported a defect that was not there, which is the same mistake as reading
     an element's order out of a comment. A string count is not a semantic
     fact, and a comment quoting what a sentence USED to say is a record worth
     keeping, not copy worth failing on. */
  const live = PAGE.split('\n').filter((l) => {
    const t = l.trimStart();
    return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
  }).join('\n');
  assert.ok(!/Enter the code from your email to finish/.test(live),
    'the code step is phrased as a requirement again, so a sign-in with no email reads as broken');
  assert.ok(!/Enter the code from your email to try again/.test(live),
    'a retry sentence still demands an email code');
  assert.match(PAGE, /If Claude gives you a code, paste it here\. If it does not, the sign-in finishes on its own\./,
    'the Settings flow lost the conditional wording');
});

test('the success state says the outcome instead of where to go looking for it', () => {
  assert.ok(!/Connected\. The new account is on the list above\./.test(PAGE),
    'the success note asks the person to verify the outcome themselves on the screen that just did the work');
  assert.match(PAGE, /note\.classList\.add\('is-connected'\)/,
    'the connected note lost its state class, so the word is the only signal');
});

/* ⚠️ EVERY OTHER ARM MUST PUT THE GREEN BACK. A recheck can move from connected
   to failed, and a note left wearing the tick is the same defect with the
   states swapped. */
test('a failure cannot inherit the connected dressing', () => {
  const i = PAGE.indexOf("} else if (phase === 'stuck'");
  assert.ok(i > -1, 'the failure arm moved; re-anchor');
  const arm = PAGE.slice(i, i + 700);
  assert.match(arm, /note\.classList\.remove\('is-connected'\)/,
    'the failure arm does not clear the connected class, so a failed sign-in can render green with a tick');
});

/* The connected BUTTON is white on a green fill and carries its own ground.
   Green TEXT sits on whatever is behind it, so it needs its own dark value --
   the same trap as --danger, met twice in one evening. */
test('the connected green is legible as TEXT in both themes', () => {
  const light = token('ok');
  const dark = token('ok', '@media (prefers-color-scheme: dark) {');
  assert.ok(ratio(light, '#ffffff') >= 4.5, `--ok is ${ratio(light, '#ffffff').toFixed(2)}:1 on a card`);
  assert.ok(ratio(dark, '#17191c') >= 4.5, `--ok is ${ratio(dark, '#17191c').toFixed(2)}:1 on a dark card`);
  assert.ok(ratio(light, '#17191c') < 4.5,
    'the control has stopped working: the light green now passes on a dark card, so this test no longer proves the dark value is needed');
});
