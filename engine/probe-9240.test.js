'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9240: a delivery-check probe that needs no reply. msg --status (#8961) already says whether a direct message
   was read or answered, so a delivery check needs no second message; the guide every agent is given now says so.
   (Marking a test message --no-reply is taught in the project block, projects.js #9096, pinned in fyihint-9096.) */
const test = require('node:test');
const assert = require('node:assert/strict');
const messages = require('./messages');

test('kosmos#9240: the guide says to check a direct message arrived with msg --status, not with another message', () => {
  const text = messages.blockBody();
  assert.match(text, /To check that a direct message you sent arrived,\s+do not send another one:/);
  // With the machine's own command in front, as every command in this block is (bare kosmos is not on a stock PATH).
  assert.match(text, /`\S+ msg --status <id>`, with the id your send printed, says whether they read or\s+answered it\./);
  assert.ok(!/`msg --status/.test(text), 'the command is taught bare, without the machine\'s own kosmos in front');
});
