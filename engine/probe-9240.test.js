'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9240: a delivery check needs no message: msg --status (#8961) already says whether a direct message reached
   them and, when Kosmos can tell, whether it was read or answered. The project block, where --no-reply is taught
   (#9096), now says so, and no longer teaches --no-reply for a delivery test, so one block gives one answer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const { kosmosCliShown } = require('./clipath');

const P = [{ id: 'p1', name: 'Henderson lease', folder: '/tmp/henderson', agents: ['writer'] }];

test('kosmos#9240: a member is told to send no test message, and to check the real one with msg --status', () => {
  const flat = projects.blockBody(P, 'writer').replace(/\s+/g, ' ');   // pins the words, not where they wrap
  assert.ok(flat.includes('Do not send a test message to see if your direct messages reach someone: send the real one, then run'));
  assert.ok(flat.includes('`' + kosmosCliShown() + ' msg --status <id>` with the id your send printed.'),
    'the command is missing, or named without this machine\'s own kosmos');
  assert.ok(flat.includes('It says whether it reached them and, when Kosmos can tell, whether they read or answered it;'));
  // kosmos#9243: msgstatus's own "Kosmos cannot tell" is no reason either.
  assert.ok(flat.includes('that they have not read it yet, may read it later, or that Kosmos cannot tell, is no reason to send it again.'),
    'a not-read-yet or cannot-tell answer invites the next probe');
  // kosmos#9243: nothing real to send yet still gets no test message.
  assert.ok(flat.includes('With nothing real to send yet, there is no test message to send: `' + kosmosCliShown() + ' agent list` shows each agent\'s state now.'),
    'an agent with nothing to say yet is left to probe, or told of no read that answers it');
  assert.ok(flat.includes('A room post needs no test either: the post command says whom it reached, or that it could not post.'),
    'a room post is left with no guidance, so it gets the unmarked probe');
});

test('kosmos#9240: --no-reply is no longer taught for a delivery test, so the two lines cannot disagree', () => {
  const text = projects.blockBody(P, 'writer');
  assert.ok(!/tests delivery/.test(text), 'the block still teaches sending a --no-reply probe to test delivery');
  assert.match(text, /only closes a thread \(thanks, nothing needed\), put --no-reply first:/, 'control: the --no-reply rule itself stays');
});

test('kosmos#9240 control: a block with no member does not carry it, as the other member rules', () => {
  assert.ok(!projects.blockBody(P, '').includes('Do not send a test message'));
});
