'use strict';
/**
 * The tmux box covers BOTH permissions macOS asks about (#1214).
 *
 * Josh met "tmux wants access to control system events... it would like to
 * control this computer using accessibility features" mid-task. This box existed
 * and was about FOLDERS, so it did not merely omit his case: it told him this is
 * "asking to reach a folder you gave it work in", and closed with "Kosmos never
 * goes outside its own folders unless you ask an agent to", which reads as
 * refuted by the box in front of him.
 *
 * ⇒ A careful reader was left MORE alarmed. That is what these assertions pin.
 *
 *   node --test web.tmux-box-1214.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

/** The rendered sentence a person reads, tags and entities resolved. */
function boxText() {
  const h = PAGE.indexOf('If you see a box asking about');
  assert.notEqual(h, -1, 'the tmux box heading is gone');
  const p = PAGE.indexOf('<p class="dhint"', h);
  const end = PAGE.indexOf('</p>', p);
  assert.ok(p > h && end > p, 'the box has no paragraph');
  return PAGE.slice(p, end)
    .replace(/<[^>]+>/g, '')
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&rsquo;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

test('it names both permissions, not just folders', () => {
  const t = boxText();
  assert.match(t, /open one of your\s*folders|open one of your folders/, 'the folder case is still covered');
  assert.match(t, /control this computer/, 'the Accessibility case is not covered, which is the #1214 report');
});

test('the reassurance is true of BOTH, not only of folders', () => {
  const t = boxText();
  /* 🛑 THE SENTENCE THAT HAD TO GO. It was true and reassuring about file
     access and flatly wrong beside a box asking to control the computer.
     A reassurance that the reader can see is false is worse than none. */
  assert.doesNotMatch(t, /never goes outside its own folders/,
    'the folder-only reassurance is back, and it is refuted by the app-control box');
  assert.match(t, /only does what you asked an agent to do/,
    'the reassurance that covers both is gone');
});

test('the app-control half is stated plainly, not softened away', () => {
  // Josh's ruling, relayed 2026-08-28: agents acting in your other applications
  // IS the feature, and softening it is what would make it false.
  const t = boxText();
  assert.match(t, /working in another app for you/,
    'the capability is no longer said in the person\'s own terms');
  assert.doesNotMatch(t, /\b(never|cannot|will not) (touch|control|use) (other|another|your other) app/i,
    'the box denies a capability the product has');
});

test('all four facts #1004 required still survive', () => {
  const t = boxText();
  assert.match(t, /macOS sometimes asks/, 'what the box is');
  assert.match(t, /Allow it/, 'what to press');
  assert.match(t, /that one job stops, nothing else/, 'what each choice costs');
  assert.match(t, /only does what you asked/, 'the reassurance');
});

test('it stays short, because shortening this page was a direct instruction', () => {
  /* #1004 cut this box on Josh's instruction, 70 words to 59 by its own count,
     and 59 by this test's count too, so the two agree. This allows a small
     increase for covering a second permission and no more: the point is that
     the box cannot quietly grow back into the thing he complained about. */
  const n = boxText().split(/\s+/).filter(Boolean).length;
  assert.ok(n <= 70, `the tmux box is ${n} words, back at the length Josh asked to cut`);
  assert.ok(n >= 55, `the tmux box is ${n} words, too short to still carry all four facts`);
});

test('the word tmux is still here on purpose, and still the only place', () => {
  /* Two rulings say Kosmos must not introduce this word. This box is the
     exception because macOS puts it on the screen first, and #1004's comment
     says so. A future "fix" that removes it takes away the one explanation of a
     word a person was handed. */
  assert.match(boxText(), /"tmux"/, 'the box stopped naming the word macOS shows');
});
