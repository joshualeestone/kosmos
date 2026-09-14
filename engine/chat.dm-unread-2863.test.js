'use strict';

/**
 * #2863: a.dmUnread, the per-agent unread-DM count carried on the fleet
 * payload, and its /seen-style clear. This suite exercises the engine half in
 * engine/chat.js (dmUnreadAll / dmUnread / markDmSeen) against real DIRECT
 * threads written through the same appendMessage the reply route uses.
 *
 * ⚠️ SANDBOX BEFORE ANY REQUIRE, same rule as chat.test.js: AGENT_WORKFORCE_DATA
 * moves the record store (and the DIRECT threads + dm-seen.json) off the
 * operator's real app data. Every test uses a DISTINCT agent name so the shared
 * sandbox cannot let one test's cursor or thread bleed into another's.
 *
 * ⚠️ NO ROSTER-CARD LITERALS here, the fixture-discipline lint forbids a hand
 * built object carrying `sessionName`. These are chat MESSAGE entries
 * ({text, at, from}), not roster cards, so the rule does not apply; kept literal
 * on purpose so the count logic is what is under test, not a fleet fixture.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dmunread-test-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');

const T1 = '2026-09-11T00:00:00.000Z';
const T_CURSOR = '2026-09-11T01:00:00.000Z';
const T2 = '2026-09-11T02:00:00.000Z';

// An agent reply carries a string `from`; an operator message carries none.
function agentReply(agent, at) {
  const r = chat.appendMessage(chat.DIRECT, agent, { text: 'reply ' + at, at, from: agent });
  assert.equal(r.recorded, true, 'seed reply should record');
}
function operatorMsg(agent, at) {
  const r = chat.appendMessage(chat.DIRECT, agent, { text: 'from the person', at });
  assert.equal(r.recorded, true, 'seed operator message should record');
}

test('counts only the agent\'s replies, never the operator\'s own messages', () => {
  const a = 'ava-count';
  agentReply(a, T1);
  agentReply(a, T2);
  operatorMsg(a, T2); // must NOT count
  assert.equal(chat.dmUnreadAll()[a], 2);
  assert.equal(chat.dmUnread(a), 2);
});

test('the read cursor excludes replies at or before it', () => {
  const a = 'ava-cursor';
  agentReply(a, T1); // before the cursor
  agentReply(a, T2); // after the cursor
  chat.markDmSeen(a, Date.parse(T_CURSOR));
  assert.equal(chat.dmUnread(a), 1);
});

test('a reply timestamped exactly at the cursor is seen, not unread (boundary is <=)', () => {
  // The boundary is at <= since (engine/chat.js dmUnreadAll): a reply whose `at`
  // equals the cursor is already-seen. The test above only straddles the cursor
  // and never lands a reply ON it, so this pins the exact-equality edge directly.
  const a = 'ava-boundary';
  agentReply(a, T_CURSOR);            // exactly at the cursor -> excluded
  agentReply(a, T2);                  // strictly after -> counted
  chat.markDmSeen(a, Date.parse(T_CURSOR));
  assert.equal(chat.dmUnread(a), 1, 'the reply AT the cursor is excluded; only the later one counts');
});

test('opening the thread (markDmSeen at/after the last reply) zeroes the count', () => {
  const a = 'ava-clear';
  agentReply(a, T1);
  agentReply(a, T2);
  assert.equal(chat.dmUnread(a), 2);
  chat.markDmSeen(a, Date.parse(T2) + 1);
  assert.equal(chat.dmUnread(a), 0);
});

test('an agent with no DIRECT thread is 0, not null', () => {
  assert.equal(chat.dmUnread('ava-never-messaged'), 0);
});

test('counts are per-agent and independent', () => {
  const a = 'bo-one';
  const b = 'bo-two';
  agentReply(a, T2);
  agentReply(b, T1);
  agentReply(b, T2);
  const all = chat.dmUnreadAll();
  assert.equal(all[a], 1);
  assert.equal(all[b], 2);
});

test('a damaged thread is that agent\'s null (unknown), and the others survive', () => {
  const good = 'cy-good';
  const bad = 'cy-bad';
  agentReply(good, T2);
  // Write an unparseable DIRECT thread file for the bad agent.
  fs.writeFileSync(chat.threadFile(chat.DIRECT, bad), 'this is not json');
  const all = chat.dmUnreadAll();
  assert.equal(all[bad], null, 'a damaged thread is unknown for that agent');
  assert.equal(all[good], 1, 'a healthy sibling still reports its real count');
});

test('an unreadable seen cursor makes the whole map null (unknown is not zero)', () => {
  const a = 'dee-whole-null';
  agentReply(a, T2);
  fs.writeFileSync(chat.DM_SEEN, '{ not valid json');
  try {
    assert.equal(chat.dmUnreadAll(), null);
    assert.equal(chat.dmUnread(a), null);
  } finally {
    // Restore so later tests in this process are not poisoned.
    fs.rmSync(chat.DM_SEEN, { force: true });
  }
});

test('markDmSeen refuses a name it cannot key a thread under', () => {
  assert.throws(() => chat.markDmSeen('bad/name'), /agent name/);
  assert.throws(() => chat.markDmSeen(''), /which agent/);
});
