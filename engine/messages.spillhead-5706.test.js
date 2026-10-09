'use strict';
/* #5706 (user feedback, 2026-10-09): a long message to an agent is put in a file, and the pane shows a line in its
   place. That line now says what the message is about (its first sentence, or its opening cut at a whole word) and
   how long the whole is, so the agent can decide whether to open the file without a read step first. The sender is
   already named in the envelope ahead of it. Pure: no board, no files.

     node --test engine/messages.spillhead-5706.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _spillHead: spillHead } = require('./messages');

test('#5706: a first sentence that ends within 200 characters is the head, then an ellipsis (there is always more)', () => {
  const text = 'The lease renewal is due on the first of the month. ' + 'More detail follows here. '.repeat(60);
  const r = spillHead(text);
  assert.equal(r.head, 'The lease renewal is due on the first of the month. \u2026');
  assert.equal(r.words, (text.match(/\S+/g) || []).length);
});

test('#5706: no sentence end within 200 characters: cut at a whole word, with an ellipsis', () => {
  const text = 'the lease detail '.repeat(80);
  const r = spillHead(text);
  assert.ok(r.head.endsWith('\u2026'), r.head);
  assert.ok(r.head.length <= 201, r.head.length);
  assert.ok(!/\s\u2026$/.test(r.head), 'a space before the ellipsis: ' + JSON.stringify(r.head));
  // The old head was text.slice(0, 200), which cuts a word in two here; this one ends on a whole word.
  assert.ok(/\S$/.test(text.slice(0, 200)) && /\S/.test(text.charAt(200)), 'CONTROL: this text really does cut mid-word at 200');
  const lastWord = r.head.slice(0, -1).split(' ').pop();
  assert.ok(['the', 'lease', 'detail'].includes(lastWord), lastWord);
});

test('#5706: a very short first sentence ("Hi.") is not the summary; the opening is', () => {
  const text = 'Hi. ' + 'Here is the whole plan for the quarter, step by step '.repeat(30);
  const r = spillHead(text);
  assert.ok(r.head.startsWith('Hi. Here is the whole plan'), r.head);
  assert.ok(r.head.endsWith('\u2026'), r.head);
});

test('#5706: one unbroken run of 200+ characters is cut at 200, never empty', () => {
  const r = spillHead('x'.repeat(900));
  assert.equal(r.head, 'x'.repeat(200) + '\u2026');
  assert.equal(r.words, 1);
});

test('#5706 review 1: a list number or an abbreviation is not a sentence end, so the head is not a fragment passed off as whole', () => {
  for (const text of [
    'Summary of the changes in this PR: 1. The first change to the build. 2. The second. ' + 'More. '.repeat(150),
    'We need the tools for the job, e.g. A hammer and a saw are on the list for later. ' + 'More. '.repeat(150),
    'I met with the landlord at 3 p.m. Then we walked through the whole flat together. ' + 'More. '.repeat(150),
  ]) {
    const r = spillHead(text);
    assert.ok(!/(?:\b1\.|e\.g\.|p\.m\.)(?: …)?$/.test(r.head), 'a fragment read as a sentence: ' + r.head);
  }
  // CONTROL: a real sentence after such a word is still found.
  assert.equal(spillHead('I met with the landlord at 3 p.m. Then we walked through the whole flat. Next. ' + 'More. '.repeat(150)).head,
    'I met with the landlord at 3 p.m. Then we walked through the whole flat. \u2026');
});

test('#5706 review 1: a full stop at the 200th character inside a word (release3.5) is not a sentence end', () => {
  /* A long word (release3.5), so the abbreviation rule cannot be what refuses it. */
  const lead = 'z'.repeat(150) + ' ' + 'y'.repeat(39) + ' release3';   // the "." of "release3.5" is the 200th character
  const text = lead + '.5 next ' + 'word '.repeat(200);
  assert.equal(text.indexOf('.'), 199, 'CONTROL: the full stop sits at index 199');
  const r = spillHead(text);
  assert.ok(r.head.endsWith('\u2026'), r.head.slice(-20));
  assert.ok(!/release3\.\s*\u2026$/.test(r.head), r.head.slice(-20));   // review 5: every head ends in an ellipsis now
});

test('#5706 review 1: a slice that already ends on a whole word keeps it, and a trailing comma is dropped', () => {
  /* Review 3: "vwxyz" ends exactly at the 200th character and a space follows it, so the cut must keep it. */
  const text = 'abcd '.repeat(39) + 'vwxyz' + ' ' + 'more '.repeat(200);
  assert.equal(text.charAt(200), ' ', 'CONTROL: a space follows the 200th character');
  const r = spillHead(text);
  assert.equal(r.head, 'abcd '.repeat(39) + 'vwxyz\u2026');
  const comma = spillHead('a'.repeat(150) + ' ' + 'b'.repeat(40) + ', ' + 'c'.repeat(300));
  assert.ok(!/,\u2026$/.test(comma.head), comma.head.slice(-10));
});

test('#5706 review 2: known abbreviations are not sentence ends, and a short real word still is', () => {
  for (const text of [
    'Please forward this to Mrs. Smith before the end of the week, thanks a lot. ' + 'More. '.repeat(150),
    'The meeting with Acme Inc. Was moved to Thursday at the usual place and time. ' + 'More. '.repeat(150),
    'The letter came from Prof. Jones about the grant application and its budget. ' + 'More. '.repeat(150),
    'I had a long meeting yesterday with Gen. Smith about the budget for next year. ' + 'More. '.repeat(150),
    'Yesterday we hiked up Mt. Rainier with the whole team and two of the dogs too. ' + 'More. '.repeat(150),
    'Results were reported by Smith et al. The study showed a clear effect on rents. ' + 'More. '.repeat(150),
  ]) {
    const r = spillHead(text);
    assert.ok(!/(?:Mrs|Inc|Prof|Gen|Mt|al)\.(?: …)?$/.test(r.head), 'an abbreviation read as a sentence end: ' + r.head);
  }
  // CONTROL: a real sentence that ends in a short word is still the head.
  assert.equal(spillHead('Please send the signed lease back to me. Then we can book the movers for May. ' + 'More. '.repeat(150)).head,
    'Please send the signed lease back to me. \u2026');
});

test('#5706 review 2: a cut never ends on half of an emoji', () => {
  const r = spillHead('a' + '\u{1F600}'.repeat(150));
  assert.ok(!/[\uD800-\uDBFF]\u2026$/.test(r.head), 'a lone high surrogate before the ellipsis');
  assert.ok(r.head.endsWith('\u{1F600}\u2026'), JSON.stringify(r.head.slice(-4)));
});

test('#5706 review 4: every head ends in an ellipsis, so even a word the list misses cannot pass a fragment off as whole', () => {
  // "Messrs." is not in the list: the head may stop there, but it still says there is more.
  const r = spillHead('The deed was signed by the brothers, Messrs. Hart and Lowe, at the bank on Friday. ' + 'More. '.repeat(150));
  assert.ok(r.head.endsWith('\u2026'), r.head);
  for (const text of ['A real first sentence that is long enough. ' + 'More. '.repeat(150), 'the lease detail '.repeat(80)]) {
    assert.ok(spillHead(text).head.endsWith('\u2026'), spillHead(text).head);
  }
});

test('#5706 review 5: a head is never only an ellipsis', () => {
  const r = spillHead(', '.repeat(400));
  assert.notEqual(r.head, '\u2026');
  assert.ok(r.head.length > 1, JSON.stringify(r.head.slice(0, 10)));
});
