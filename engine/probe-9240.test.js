'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9240: a delivery check needs no message: msg --status (#8961) already says whether a direct message was
   typed to them, read or answered (msgstatus.js's own words). The project block, where --no-reply is taught (#9096), now says so, and no longer
   teaches --no-reply for a delivery test, so one block gives one answer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const { kosmosCliShown } = require('./clipath');

const P = [{ id: 'p1', name: 'Henderson lease', folder: '/tmp/henderson', agents: ['writer'] }];

test('kosmos#9240: a member is told to send no test message, and to check the real one with msg --status', () => {
  const text = projects.blockBody(P, 'writer');
  assert.match(text, /Do not send a test message to see if your messages reach someone: send the real one, then run\n/);
  const want = '`' + kosmosCliShown() + ' msg --status <id>` with the id your send printed. It says whether it has been typed to them and,';
  assert.ok(text.includes(want), 'the line is missing, or names the command without this machine\'s own kosmos');
  assert.match(text, /when Kosmos can tell, whether they read or answered it\./);
});

test('kosmos#9240: --no-reply is no longer taught for a delivery test, so the two lines cannot disagree', () => {
  const text = projects.blockBody(P, 'writer');
  assert.ok(!/tests delivery/.test(text), 'the block still teaches sending a --no-reply probe to test delivery');
  assert.match(text, /only closes a thread \(thanks, nothing needed\), put --no-reply first:/, 'control: the --no-reply rule itself stays');
});

test('kosmos#9240 control: a block with no member does not carry it, as the other member rules', () => {
  assert.ok(!projects.blockBody(P, '').includes('Do not send a test message'));
});
