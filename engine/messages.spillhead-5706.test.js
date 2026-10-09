'use strict';
/* #5706 (user feedback, 2026-10-09): a long message to an agent is put in a file, and the pane shows a line in its
   place. That line now says what the message is about (its first sentence, or its opening cut at a whole word) and
   how long the whole is, so the agent can decide whether to open the file without a read step first. The sender is
   already named in the envelope ahead of it. Pure: no board, no files.

     node --test engine/messages.spillhead-5706.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _spillHead: spillHead } = require('./messages');

test('#5706: a first sentence that ends within 200 characters is the head, whole, with no ellipsis', () => {
  const text = 'The lease renewal is due on the first of the month. ' + 'More detail follows here. '.repeat(60);
  const r = spillHead(text);
  assert.equal(r.head, 'The lease renewal is due on the first of the month.');
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
    assert.ok(!/(?:\b1\.|e\.g\.|p\.m\.)$/.test(r.head), 'a fragment read as a sentence: ' + r.head);
  }
  // CONTROL: a real sentence after such a word is still found.
  assert.equal(spillHead('I met with the landlord at 3 p.m. Then we walked through the whole flat. Next. ' + 'More. '.repeat(150)).head,
    'I met with the landlord at 3 p.m. Then we walked through the whole flat.');
});

test('#5706 review 1: a full stop at the 200th character inside a word (release3.5) is not a sentence end', () => {
  /* A long word (release3.5), so the abbreviation rule cannot be what refuses it: only reading past the slice can. */
  const lead = 'z'.repeat(150) + ' ' + 'y'.repeat(39) + ' release3';   // the "." of "release3.5" is the 200th character
  const text = lead + '.5 next ' + 'word '.repeat(200);
  assert.equal(text.indexOf('.'), 199, 'CONTROL: the full stop sits at index 199');
  const r = spillHead(text);
  assert.ok(r.head.endsWith('\u2026'), r.head.slice(-20));
  assert.ok(!r.head.endsWith('release3.'), r.head.slice(-20));
});

test('#5706 review 1: a slice that already ends on a whole word keeps it, and a trailing comma is dropped', () => {
  const r = spillHead('abcd '.repeat(40) + 'efgh, ' + 'more '.repeat(200));
  assert.equal(r.head, 'abcd '.repeat(40).trim() + '\u2026');
  const comma = spillHead('a'.repeat(150) + ' ' + 'b'.repeat(40) + ', ' + 'c'.repeat(300));
  assert.ok(!/,\u2026$/.test(comma.head), comma.head.slice(-10));
});
