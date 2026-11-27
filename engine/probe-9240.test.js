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
  assert.match(text, /`msg --status <id>`, with the id your send printed,\s+says whether they read or answered it\./);
});
