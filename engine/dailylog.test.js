'use strict';
/**
 * dailylog: the daily conversation-log compiler (#2924). The load-bearing
 * properties: it is READ-ONLY over chats/ (originals never change), an absent
 * `from` renders as the operator ("You", #175), a message with no `at` is
 * counted rather than mis-bucketed, non-conversation files in chats/ are
 * skipped, and a re-run overwrites each day's file idempotently.
 *
 *   node --test engine/dailylog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dailylog-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const dl = require('./dailylog');

// Deterministic day/time derivation from the ISO string (UTC), so assertions do
// not depend on the runner's timezone.
const dayOf = (at) => (typeof at === 'string' && at.length >= 10 ? at.slice(0, 10) : null);
const timeOf = (at) => (typeof at === 'string' && at.length >= 16 ? at.slice(11, 16) : '');

test('parseChatFileName: direct thread', () => {
  assert.deepEqual(dl.parseChatFileName('direct..agentkey.json'), { kind: 'direct', key: 'agentkey' });
});

test('parseChatFileName: project thread', () => {
  assert.deepEqual(dl.parseChatFileName('proj123.3-slug.json'), { kind: 'project', projectId: 'proj123', key: '3-slug' });
});

test('parseChatFileName: a direct file is NOT misclassified as a project', () => {
  const d = dl.parseChatFileName('direct..x.json');
  assert.equal(d.kind, 'direct', 'direct must be tested before the looser project pattern');
});

test('parseChatFileName: non-conversation files are skipped', () => {
  assert.equal(dl.parseChatFileName('room-seen.json'), null);
  assert.equal(dl.parseChatFileName('.DS_Store'), null);
  assert.equal(dl.parseChatFileName(''), null);
  assert.equal(dl.parseChatFileName('notjson.txt'), null);
});

test('flattenMessages: absent/blank from becomes the operator (null), string from kept', () => {
  const convos = [{
    desc: { kind: 'direct', key: 'a' },
    parsed: { messages: [
      { at: '2026-09-13T14:00:00Z', text: 'hi', from: null },
      { at: '2026-09-13T14:01:00Z', text: 'hello', from: '3-agent' },
      { at: '2026-09-13T14:02:00Z', text: 'blank', from: '   ' },
    ] },
  }];
  const { rows } = dl.flattenMessages(convos, dayOf);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].from, null);
  assert.equal(rows[1].from, '3-agent');
  assert.equal(rows[2].from, null, 'a blank from is the operator, not a whitespace name');
});

test('flattenMessages: undated + non-string-text messages are skipped and counted', () => {
  const convos = [{
    desc: { kind: 'direct', key: 'a' },
    parsed: { messages: [
      { text: 'no at here', from: null },
      { at: '2026-09-13T14:00:00Z', text: 'dated', from: null },
      { at: '2026-09-13T14:01:00Z', text: 12345, from: null },
      { at: '2026-09-13T14:02:00Z' },
    ] },
  }];
  const { rows, undated } = dl.flattenMessages(convos, dayOf);
  assert.equal(rows.length, 1, 'only the well-formed dated message survives');
  assert.equal(undated, 1, 'the message with no at is counted as undated');
});

test('groupByDay: rows split by their day', () => {
  const rows = [
    { day: '2026-09-13', at: '2026-09-13T10:00:00Z', label: 'x', from: null, text: 'a' },
    { day: '2026-09-14', at: '2026-09-14T10:00:00Z', label: 'x', from: null, text: 'b' },
    { day: '2026-09-13', at: '2026-09-13T11:00:00Z', label: 'x', from: null, text: 'c' },
  ];
  const byDay = dl.groupByDay(rows);
  assert.equal(byDay.size, 2);
  assert.equal(byDay.get('2026-09-13').length, 2);
  assert.equal(byDay.get('2026-09-14').length, 1);
});

test('renderDay: operator shown as You, messages time-ordered, attachments noted', () => {
  const rows = [
    { at: '2026-09-13T14:05:00Z', label: 'Direct: a', from: '3-agent', text: 'second', attachments: [] },
    { at: '2026-09-13T14:00:00Z', label: 'Direct: a', from: null, text: 'first', attachments: ['pic.png'] },
  ];
  const md = dl.renderDay('2026-09-13', rows, timeOf);
  assert.match(md, /# Kosmos conversations - 2026-09-13/);
  assert.match(md, /## Direct: a/);
  assert.match(md, /\*\*You\*\* - 14:00/);
  assert.match(md, /\*\*3-agent\*\* - 14:05/);
  assert.match(md, /\[shared: pic\.png\]/);
  // time ordering: the operator's 14:00 "first" precedes the agent's 14:05 "second"
  assert.ok(md.indexOf('first') < md.indexOf('second'), 'messages must be in time order');
});

test('compileAll: end to end, writes per-day files, leaves originals unchanged, idempotent, skips junk', () => {
  const chatsDir = path.join(SANDBOX, 'chats');
  const outDir = path.join(SANDBOX, 'chats-daily');
  fs.mkdirSync(chatsDir, { recursive: true });

  const directFile = path.join(chatsDir, 'direct..agentA.json');
  const directBody = JSON.stringify({ agent: 'agentA', messages: [
    { at: '2026-09-13T09:00:00Z', text: 'morning', from: null },
    { at: '2026-09-14T09:00:00Z', text: 'next day', from: '3-agentA' },
  ] });
  fs.writeFileSync(directFile, directBody);
  fs.writeFileSync(path.join(chatsDir, 'proj1.agentB.json'), JSON.stringify({ agent: 'agentB', messages: [
    { at: '2026-09-13T10:00:00Z', text: 'in a project', from: null },
  ] }));
  // Junk that must be ignored: a seen-cursor and a dotfile and an unparseable file.
  fs.writeFileSync(path.join(chatsDir, 'room-seen.json'), JSON.stringify({ cursor: 1 }));
  fs.writeFileSync(path.join(chatsDir, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(chatsDir, 'proj2.bad.json'), '{ not valid json');

  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(summary.conversations, 2, 'only the two real conversation files count');
  assert.equal(summary.messages, 3);
  assert.deepEqual(summary.written, ['2026-09-13', '2026-09-14']);

  const day13 = fs.readFileSync(path.join(outDir, '2026-09-13.md'), 'utf8');
  assert.match(day13, /## Direct: agentA/);
  assert.match(day13, /## proj1 : agentB/);
  assert.match(day13, /morning/);
  assert.match(day13, /in a project/);
  assert.doesNotMatch(day13, /next day/, 'a message from another day must not appear');

  // Originals unchanged (read-only over chats/).
  assert.equal(fs.readFileSync(directFile, 'utf8'), directBody, 'the compiler must not touch the original chats file');

  // Idempotent: re-running produces byte-identical output.
  const before = fs.readFileSync(path.join(outDir, '2026-09-13.md'), 'utf8');
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  const after = fs.readFileSync(path.join(outDir, '2026-09-13.md'), 'utf8');
  assert.equal(after, before, 're-running must overwrite with identical content');
});

test('compileAll: onlyDay restricts the write to a single day', () => {
  const chatsDir = path.join(SANDBOX, 'chats2');
  const outDir = path.join(SANDBOX, 'chats-daily2');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.writeFileSync(path.join(chatsDir, 'direct..z.json'), JSON.stringify({ messages: [
    { at: '2026-09-13T09:00:00Z', text: 'day13', from: null },
    { at: '2026-09-14T09:00:00Z', text: 'day14', from: null },
  ] }));
  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, onlyDay: '2026-09-14' });
  assert.deepEqual(summary.written, ['2026-09-14']);
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-14.md')));
  assert.ok(!fs.existsSync(path.join(outDir, '2026-09-13.md')), 'onlyDay must not write other days');
});

test('compileAll: a missing chats dir yields an empty, non-crashing result', () => {
  const summary = dl.compileAll({ chatsDir: path.join(SANDBOX, 'does-not-exist'), outDir: path.join(SANDBOX, 'out-empty'), dayOf, timeOf });
  assert.equal(summary.conversations, 0);
  assert.equal(summary.days, 0);
});
