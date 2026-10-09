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
  assert.ok(r.head.endsWith('detail…') || r.head.endsWith('lease…') || r.head.endsWith('the…'), r.head);
  assert.ok(r.head.length <= 201, r.head.length);
  assert.ok(!/\s…$/.test(r.head), 'a space before the ellipsis: ' + JSON.stringify(r.head));
  // CONTROL: the old head cut mid-word; this one ends on a word of the text.
  const lastWord = r.head.slice(0, -1).split(' ').pop();
  assert.ok(['the', 'lease', 'detail'].includes(lastWord), lastWord);
});

test('#5706: a very short first sentence ("Hi.") is not the summary; the opening is', () => {
  const text = 'Hi. ' + 'Here is the whole plan for the quarter, step by step '.repeat(30);
  const r = spillHead(text);
  assert.ok(r.head.startsWith('Hi. Here is the whole plan'), r.head);
  assert.ok(r.head.endsWith('…'), r.head);
});

test('#5706: one unbroken run of 200+ characters is cut at 200, never empty', () => {
  const r = spillHead('x'.repeat(900));
  assert.equal(r.head, 'x'.repeat(200) + '…');
  assert.equal(r.words, 1);
});
