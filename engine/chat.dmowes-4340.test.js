'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4340: chat.dmOwes decides "does the agent owe the person an answer?" from the ONE-TO-ONE thread's own rows.
 * The person's rows carry no `from` and a `delivery`; the agent's replies carry `from` = the agent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');

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
