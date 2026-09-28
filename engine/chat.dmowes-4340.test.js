'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4340: chat.dmOwes decides "does the agent owe the person an answer?" from the ONE-TO-ONE thread's own rows.
 * The person's rows carry no `from` and a `delivery`; the agent's replies carry `from` = the agent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
/* A SANDBOXED data root before chat is required: the writer test below appends a real thread file, and without
   this it lands in the person's own Kosmos data (it did, once, while this was being written). */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-dmowes-4340-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const chat = require('./chat');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');
/* Measured against the REAL data root, not the variable (#4365 review: an empty variable made startsWith('')
   always true). The thread file is checked too, because that is what the writer test below creates. */
assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT, chat.threadFile(chat.DIRECT, 'nova-writer-probe')]);

const A = 'nova';
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const person = (minAgo, state = chat.DELIVERY.PLACED) => ({ text: 'hi', at: at(minAgo), delivery: { state } });
const reply = (minAgo, from = A) => ({ text: 'on it', at: at(minAgo), from });

test('never spoken to: clear, whatever the agent has said', () => {
  assert.equal(chat.dmOwes([], A).state, 'clear');
  assert.equal(chat.dmOwes([reply(3)], A).state, 'clear');
});

test('a person message that reached the agent, with no reply after it: owes', () => {
  const r = chat.dmOwes([person(5)], A);
  assert.equal(r.state, 'owes');
  assert.equal(typeof r.lastHeardAt, 'string');
  assert.equal(r.lastSentAt, null);
});

test('answered after the person spoke: clear; spoken to again after that: owes', () => {
  assert.equal(chat.dmOwes([person(5), reply(3)], A).state, 'clear');
  assert.equal(chat.dmOwes([person(9), reply(7), person(2)], A).state, 'owes');
});

test('a person message that did NOT reach the agent puts it in no debt', () => {
  for (const state of Object.values(chat.DELIVERY).filter((s) => s !== chat.DELIVERY.PLACED)) {
    assert.equal(chat.dmOwes([person(5, state)], A).state, 'clear', 'undelivered (' + state + ') made it owe');
  }
  assert.equal(chat.dmOwes([{ text: 'hi', at: at(5) }], A).state, 'clear', 'a row with no delivery made it owe');
});

test('a MENU ANSWER (a row with a wire: the keystroke that answered the agent\'s question) is not a message to reply to', () => {
  const menu = { ...person(5), text: 'Yes, and don\'t ask again', wire: '2' };
  assert.equal(chat.dmOwes([menu], A).state, 'clear', 'pressing a menu button put the agent in debt');
  assert.equal(chat.dmOwes([person(9), menu], A).state, 'owes', 'CONTROL: a real message before it is still owed');
  assert.equal(chat.dmOwes([{ ...person(5), wire: null }], A).state, 'owes', 'an ordinary message (wire null) stopped counting');
});

test('KNOWN LIMIT: a TYPED answer to a question the agent asked in prose still counts as owed (nothing stored says so)', () => {
  const typed = { ...person(5), text: 'call it report-final' };
  assert.equal(chat.dmOwes([typed], A).state, 'owes',
    'a typed row is now excused: if this is deliberate, update the #4340 known limit and this test together');
});

test('a menu answer goes through the REAL writer with its wire, and reads back as owing nothing', () => {
  const T = 'menu-writer-4340';
  chat.appendMessage(chat.DIRECT, T, { text: 'Yes, and don\'t ask again', wire: '2', at: at(5), delivery: { state: chat.DELIVERY.PLACED } });
  const rows = chat.readThread(chat.DIRECT, T).messages;
  assert.equal(rows[rows.length - 1].wire, '2', 'the writer dropped the wire, so the menu rule could never fire');
  assert.equal(chat.dmOwes(rows, T).state, 'clear');
  chat.appendMessage(chat.DIRECT, T, { text: 'and the invoice?', at: at(1), delivery: { state: chat.DELIVERY.PLACED } });
  assert.equal(chat.dmOwes(chat.readThread(chat.DIRECT, T).messages, T).state, 'owes', 'CONTROL: a real message after it is owed');
});

test('only the agent\'s own rows are its answer; another author (a question row for someone else) is not', () => {
  assert.equal(chat.dmOwes([person(5), reply(3, 'someone-else')], A).state, 'owes');
});

test('a thread we could not read is UNKNOWN, never a confident clear', () => {
  const r = chat.dmOwes(null, A);
  assert.equal(r.state, 'unknown');
  assert.match(r.because, /could not read/);
});

test('a row whose time does not parse is skipped, not read as long ago', () => {
  assert.equal(chat.dmOwes([{ text: 'x', at: 'not a time', delivery: { state: chat.DELIVERY.PLACED } }], A).state, 'clear');
  assert.equal(chat.dmOwes([person(5), { text: 'x', at: 12345, from: A }], A).state, 'owes',
    'a reply with no real timestamp cleared the debt');
});

