'use strict';
/* test-support/thread-fixture.js (#6059): a long thread seeded in one write, and the cases where it must fall back to
   real appends so a test's meaning cannot change. */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-threadfix-6059-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./engine/chat');
const { appendMany } = require('./test-support/thread-fixture');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const rows = (agent) => chat.readThread(chat.DIRECT, agent).messages;

test('205 same-shaped entries are one write, and read back exactly as 205 real appends do (control)', () => {
  const entries = Array.from({ length: 205 }, (_, i) => ({ text: 'm ' + i, at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), delivery: { state: chat.DELIVERY.PLACED } }));
  assert.equal(appendMany(chat, chat.DIRECT, 'fast', entries).via, 'one write');
  for (const e of entries) assert.equal(chat.appendMessage(chat.DIRECT, 'real', e).recorded, true);
  assert.deepEqual(rows('fast'), rows('real'), 'the one-write thread differs from the real one');
});

test('entries with no time get distinct, increasing times', () => {
  appendMany(chat, chat.DIRECT, 'notime', Array.from({ length: 5 }, (_, i) => ({ text: 'n ' + i })));
  const ats = rows('notime').map((m) => Date.parse(m.at));
  assert.equal(new Set(ats).size, 5, 'two rows share a time');
  assert.deepEqual([...ats].sort((x, y) => x - y), ats, 'times are not increasing');
});

test('it falls back to real appends for a differing field, a text the engine would store differently, or a thread at the cap', () => {
  assert.equal(appendMany(chat, chat.DIRECT, 'mixed', [{ text: 'a', from: null }, { text: 'b', wire: '1' }]).via, 'appendMessage');
  assert.equal(appendMany(chat, chat.DIRECT, 'spaced', [{ text: 'a  b' }, { text: 'x' }]).via, 'appendMessage', 'a text appendMessage would collapse was copied raw');
  assert.equal(appendMany(chat, chat.DIRECT, 'uni', [{ text: 'café' }, { text: 'x' }]).via, 'one write', 'a text the engine stores unchanged was refused');
  const near = Array.from({ length: chat.MAX_MESSAGES }, (_, i) => ({ text: 'c ' + i }));
  assert.equal(appendMany(chat, chat.DIRECT, 'cap', near).via, 'appendMessage');
  assert.equal(appendMany(chat, chat.DIRECT, 'ok', [{ text: 'a' }, { text: 'b' }]).via, 'one write', 'CONTROL: the fast path is taken when nothing forbids it');
});

test('review 2: a first entry whose time does not parse sends the rest through real appends (no made-up times from NaN)', () => {
  const out = appendMany(chat, chat.DIRECT, 'badtime', [{ text: 'a', at: 'not a time' }, { text: 'b' }, { text: 'c' }]);
  assert.equal(out.via, 'appendMessage');
  assert.deepEqual(rows('badtime').map((m) => m.text), ['a', 'b', 'c']);
});
