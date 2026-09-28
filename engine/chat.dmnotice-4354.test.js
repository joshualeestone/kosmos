'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4354: Kosmos's own words in the agent's name (the daily-limit notice, marked `kosmos: true`) stand in for an
 * answer only while the agent is paused. The rule (chat.dmOwes) and the mark through the real writer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-dmnotice-4354-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const chat = require('./chat');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT, chat.threadFile(chat.DIRECT, 'nova4354')]);

const A = 'nova4354';
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const question = { text: 'did it go out?', at: at(10), delivery: { state: chat.DELIVERY.PLACED } };
const notice = { text: 'I paused myself at today\'s token limit', at: at(5), from: A, kosmos: true };

test('the notice clears the question only while the agent is paused', () => {
  assert.equal(chat.dmOwes([question, notice], A, { paused: true }).state, 'clear');
  assert.equal(chat.dmOwes([question, notice], A, { paused: false }).state, 'owes');
  assert.equal(chat.dmOwes([question, notice], A).state, 'owes', 'a caller that cannot say must not hide the line');
});

test('the agent\'s own reply clears it whether or not it is paused, and lastSentAt skips the notice when running', () => {
  const reply = { text: 'yes', at: at(2), from: A };
  assert.equal(chat.dmOwes([question, notice, reply], A, { paused: false }).state, 'clear');
  assert.equal(chat.dmOwes([question, reply], A, { paused: true }).state, 'clear');
  assert.equal(chat.dmOwes([question, notice], A, { paused: false }).lastSentAt, null);
});

test('the mark survives the real writer, only as true, and an ordinary reply carries none', () => {
  chat.appendMessage(chat.DIRECT, A, { ...question });
  chat.appendMessage(chat.DIRECT, A, { text: 'notice', at: at(5), from: A, kosmos: true });
  chat.appendMessage(chat.DIRECT, A, { text: 'odd', at: at(4), from: A, kosmos: 'yes' });
  chat.appendMessage(chat.DIRECT, A, { text: 'reply', at: at(3), from: A });
  const rows = chat.readThread(chat.DIRECT, A).messages;
  assert.equal(rows.find((m) => m.text === 'notice').kosmos, true, 'appendMessage dropped the mark');
  assert.equal('kosmos' in rows.find((m) => m.text === 'odd'), false, 'a mark that is not exactly true was kept');
  assert.equal('kosmos' in rows.find((m) => m.text === 'reply'), false);
});

test('the notice stands only in the pause it was written in (review of #4354: a later pause does not revive it)', () => {
  const since = (minAgo) => ({ paused: true, pausedSince: at(minAgo) });
  assert.equal(chat.noticeStands(notice, since(6)), true, 'written after this pause began');
  assert.equal(chat.noticeStands(notice, { paused: true, pausedSince: notice.at }), true, 'written the moment it began');
  assert.equal(chat.noticeStands(notice, since(1)), false, 'written in an earlier pause');
  assert.equal(chat.noticeStands(notice, { paused: true, pausedSince: null }), true, 'a pause with no start time counts it');
  assert.equal(chat.noticeStands(notice, { paused: false, pausedSince: at(6) }), false);
  assert.equal(chat.noticeStands(notice, null), false);
  assert.equal(chat.noticeStands({ ...notice, at: 'not a time' }, since(6)), false);
  assert.equal(chat.dmOwes([question, notice], A, since(1)).state, 'owes', 'an old notice hid the line under a new pause');
  assert.equal(chat.dmOwes([question, notice], A, since(6)).state, 'clear');
});

test('swarm.pauseOf: switched off with its start time; running, not a swarm, or unreadable reads as not paused', () => {
  const swarm = require('./swarm');
  const on = swarm.birthProfile({ dailyTokenLimit: 1000 });
  const off = { ...on, swarm: swarm.pausedFor(swarm.settingsOf(on), 'limit', Date.parse(at(3))) };
  assert.deepEqual(swarm.pauseOf(off), { paused: true, pausedSince: at(3) });
  assert.deepEqual(swarm.pauseOf(on), { paused: false, pausedSince: null });
  assert.deepEqual(swarm.pauseOf({ role: 'pm' }), { paused: false, pausedSince: null });
  assert.deepEqual(swarm.pauseOf({}), { paused: false, pausedSince: null });
});
