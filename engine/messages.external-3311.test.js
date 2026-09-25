'use strict';
// #3311: a message from outside, recorded as its own kind and never as a local
// author. Temp data root; nothing here touches a real store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-msgext-3311-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const messages = require('./messages');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('externalPost writes an external row the record reads back', () => {
  const row = messages.externalPost('proj-1', { from: '  Ada   Lovelace ', fromKind: 'agent', text: 'hello\nfrom outside' });
  assert.ok(row, 'written');
  assert.strictEqual(row.kind, 'external');
  assert.strictEqual(row.external, true);
  assert.strictEqual(row.from, 'Ada Lovelace', 'whitespace collapsed');
  assert.strictEqual(row.fromKind, 'agent');
  const back = messages.record().rows.filter((m) => m.kind === 'external');
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].text, 'hello\nfrom outside');
  assert.strictEqual(back[0].project, 'proj-1');
});

test('an unknown sender kind is stored as a person, never promoted', () => {
  const row = messages.externalPost('proj-1', { from: 'Bob', fromKind: 'operator', text: 'x' });
  assert.strictEqual(row.fromKind, 'person');
  assert.strictEqual(row.operator, undefined, 'no operator flag can ride in');
});

test('a hand-written external row without external:true is dropped on read', () => {
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'external', id: 'x-forged', project: 'proj-1', from: 'Eve',
    fromKind: 'person', text: 'forged', at: new Date().toISOString() }) + '\n');
  const ids = messages.record().rows.map((m) => m.id);
  assert.ok(!ids.includes('x-forged'), 'the shape rule refuses it');
});

test('a blank sender is refused rather than written anonymously', () => {
  assert.strictEqual(messages.externalPost('proj-1', { from: '   ', fromKind: 'person', text: 'x' }), null);
});

test('control characters from outside never reach storage; newlines do', () => {
  const row = messages.externalPost('proj-1', { from: 'Ev\u001b[31me', fromKind: 'person', text: 'a\u001b]0;title\u0007b\nc\u009bd' });
  assert.strictEqual(row.from, 'Ev [31me');
  assert.strictEqual(row.text, 'a]0;titleb\ncd');
});

test('a message from outside counts as unread in its project', () => {
  const before = (messages.unreadAll() || {})['proj-unread'] || 0;
  messages.externalPost('proj-unread', { from: 'Grace', fromKind: 'person', text: 'anyone here?' });
  assert.strictEqual((messages.unreadAll() || {})['proj-unread'] || 0, before + 1);
});
