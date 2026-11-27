'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9240: a delivery-check probe that needs no reply. Both halves exist (msg --no-reply, #7893; msg --status,
   #8961); what was missing is the guide saying to use them for a delivery check. These arms pin that sentence in the
   block every agent is given. */
const test = require('node:test');
const assert = require('node:assert/strict');
const messages = require('./messages');

test('kosmos#9240: the guide says to check delivery with msg --status, not with another message', () => {
  const text = messages.blockBody();
  assert.match(text, /To check that a message reached someone, do not send another one:/);
  assert.match(text, /msg --status <id>` \(the id `[^`]*msg` printed\) says whether they read or\nanswered it\./);
});

test('kosmos#9240: the guide says a test message that needs no answer goes with --no-reply', () => {
  assert.match(messages.blockBody(), /A test message that needs no answer goes with --no-reply\./);
});

test('kosmos#9240 CONTROL: the general --no-reply teaching it sits beside is still there', () => {
  assert.match(messages.blockBody(), /To send one that needs no answer, put\n--no-reply before the name:/);
});
