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

test('parseChatFileName: a project literally id-ed "direct" (one dot) is a project, not dropped', () => {
  // chat.js documents this real case: a project named "Direct" -> id "direct" ->
  // file `direct.<key>.json` (ONE dot), distinct from the two-dot direct thread.
  // It must classify as a project, or that project's whole history is silently
  // missing from every daily log.
  const d = dl.parseChatFileName('direct.agentkey.json');
  assert.deepEqual(d, { kind: 'project', projectId: 'direct', key: 'agentkey' });
});

test('parseChatFileName: non-conversation files are skipped', () => {
  assert.equal(dl.parseChatFileName('room-seen.json'), null);
  assert.equal(dl.parseChatFileName('.DS_Store'), null);
  assert.equal(dl.parseChatFileName(''), null);
  assert.equal(dl.parseChatFileName('notjson.txt'), null);
  // The aside files engine/chat.js sets aside next to conversations: the
  // trailing `.superseded` / `.damaged` means the name does not end in `.json`,
  // so the anchored patterns exclude them. This is load-bearing (they hold real
  // conversation content that must not be double-rendered), so it is asserted.
  assert.equal(dl.parseChatFileName('direct..a.json.20260913.1234.5.superseded'), null);
  assert.equal(dl.parseChatFileName('proj1.a.json.20260913.1234.5.damaged'), null);
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

test('dayFileName/dayFromFileName round-trip and reject non-day files', () => {
  assert.equal(dl.dayFileName('2026-09-13'), '2026-09-13.md');
  assert.equal(dl.dayFromFileName('2026-09-13.md'), '2026-09-13');
  assert.equal(dl.dayFromFileName(dl.dayFileName('2026-01-01')), '2026-01-01', 'round-trips');
  // non-day files the pruner must never touch
  assert.equal(dl.dayFromFileName('README.md'), null);
  assert.equal(dl.dayFromFileName('2026-9-3.md'), null, 'an unpadded stem is not a day file');
  assert.equal(dl.dayFromFileName('2026-09-13.txt'), null);
  assert.equal(dl.dayFromFileName('2026-09-13'), null, 'a stem with no .md is not a day file');
});

test('flattenMessages: merges singular attachment + plural attachments and de-dups names', () => {
  const convos = [{
    desc: { kind: 'direct', key: 'a' },
    parsed: { messages: [
      {
        at: '2026-09-13T14:00:00Z', text: 'here', from: null,
        attachment: { id: '1', name: 'doc.pdf' },
        attachments: [{ id: '2', name: 'pic.png' }, { id: '3', name: 'doc.pdf' }],
      },
    ] },
  }];
  const { rows } = dl.flattenMessages(convos, dayOf);
  assert.equal(rows.length, 1);
  // both fields contribute, and the duplicate 'doc.pdf' appears once
  assert.deepEqual(rows[0].attachments.sort(), ['doc.pdf', 'pic.png']);
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
  // message bodies are blockquoted, so they are quoted verbatim
  assert.match(md, /> first/);
});

test('renderDay: a message that starts like a heading cannot hijack the structure', () => {
  const rows = [
    { at: '2026-09-13T14:00:00Z', label: 'Direct: a', from: null, text: '## not a real heading\n--- not a rule', attachments: [] },
  ];
  const md = dl.renderDay('2026-09-13', rows, timeOf);
  // Every body line is blockquoted, so no line is a bare ATX heading or hr that
  // would break the ## conversation grouping.
  assert.match(md, /> ## not a real heading/);
  assert.match(md, /> --- not a rule/);
  assert.doesNotMatch(md, /^## not a real heading/m, 'a message body must not render as a top-level heading');
  assert.doesNotMatch(md, /^--- not a rule/m, 'a message body must not render as a horizontal rule');
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

test('compileAll: a full re-run prunes a day whose messages are all gone', () => {
  const chatsDir = path.join(SANDBOX, 'chats-prune');
  const outDir = path.join(SANDBOX, 'chats-daily-prune');
  fs.mkdirSync(chatsDir, { recursive: true });
  const file = path.join(chatsDir, 'direct..p.json');
  fs.writeFileSync(file, JSON.stringify({ messages: [
    { at: '2026-09-13T09:00:00Z', text: 'day13', from: null },
    { at: '2026-09-14T09:00:00Z', text: 'day14', from: null },
  ] }));
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-13.md')));
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-14.md')));

  // The 09-13 messages are removed at the source; a full re-run must drop its file.
  fs.writeFileSync(file, JSON.stringify({ messages: [
    { at: '2026-09-14T09:00:00Z', text: 'day14', from: null },
  ] }));
  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.ok(!fs.existsSync(path.join(outDir, '2026-09-13.md')), 'an emptied day must be pruned');
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-14.md')), 'a day that still has messages stays');
  assert.deepEqual(summary.pruned, ['2026-09-13']);
});

test('compileAll: pruning only removes day-named files, and never on an onlyDay run', () => {
  const chatsDir = path.join(SANDBOX, 'chats-prune2');
  const outDir = path.join(SANDBOX, 'chats-daily-prune2');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(chatsDir, { recursive: true });
  // A non-day file a person may have dropped in the dir must survive.
  fs.writeFileSync(path.join(outDir, 'README.md'), 'keep me');
  // A stale day file that a full run would prune.
  fs.writeFileSync(path.join(outDir, '2020-01-01.md'), 'stale');
  fs.writeFileSync(path.join(chatsDir, 'direct..q.json'), JSON.stringify({ messages: [
    { at: '2026-09-14T09:00:00Z', text: 'today', from: null },
  ] }));

  // onlyDay run must NOT prune the stale file (targeted, other days untouched).
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf, onlyDay: '2026-09-14' });
  assert.ok(fs.existsSync(path.join(outDir, '2020-01-01.md')), 'an onlyDay run must not prune other days');

  // A full run prunes the stale day file but keeps the non-day README.
  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.ok(!fs.existsSync(path.join(outDir, '2020-01-01.md')), 'a full run prunes a stale day file');
  assert.ok(fs.existsSync(path.join(outDir, 'README.md')), 'a non-day file must never be pruned');
  assert.deepEqual(summary.pruned, ['2020-01-01']);
});

test('compileAll: prune:false leaves stale day files untouched (operator --out safety)', () => {
  const chatsDir = path.join(SANDBOX, 'chats-noprune');
  const outDir = path.join(SANDBOX, 'chats-daily-noprune');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '2019-01-01.md'), 'a day-named file the operator kept');
  fs.writeFileSync(path.join(chatsDir, 'direct..z.json'), JSON.stringify({ messages: [
    { at: '2026-09-14T09:00:00Z', text: 'today', from: null },
  ] }));
  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, prune: false });
  assert.deepEqual(summary.pruned, [], 'prune:false must prune nothing');
  assert.ok(fs.existsSync(path.join(outDir, '2019-01-01.md')), 'a stale day file must survive when pruning is off');
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-14.md')), 'writing still happens with prune off');
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
  assert.equal(summary.readable, false, 'a missing/unreadable chats dir is not readable');
});

test('compileAll: an UNREADABLE chats dir does NOT prune the compiled history (fail closed)', () => {
  // A pre-populated rollup dir, and a chats dir that cannot be listed. A default
  // run must NOT treat "could not read the source" as "no conversations" and
  // wipe the history; the stale-looking files must survive until the source is
  // genuinely readable-and-empty.
  const outDir = path.join(SANDBOX, 'chats-daily-failclosed');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '2026-09-13.md'), 'existing history');
  const summary = dl.compileAll({ chatsDir: path.join(SANDBOX, 'no-such-chats'), outDir, dayOf, timeOf });
  assert.equal(summary.readable, false);
  assert.deepEqual(summary.pruned, [], 'nothing may be pruned when the source is unreadable');
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-13.md')), 'the compiled history must survive an unreadable source');
});

test('readConversations: reports readable=false on a failed listing, true on success', () => {
  assert.equal(dl.readConversations(path.join(SANDBOX, 'nope-not-here')).readable, false);
  const good = path.join(SANDBOX, 'readable-chats');
  fs.mkdirSync(good, { recursive: true });
  assert.equal(dl.readConversations(good).readable, true, 'an existing (even empty) dir is readable');
});

test('compileAll: a per-file READ failure blocks pruning, but invalid JSON does not', () => {
  const chatsDir = path.join(SANDBOX, 'chats-readerr');
  const outDir = path.join(SANDBOX, 'chats-daily-readerr');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '2020-01-01.md'), 'stale but must survive a read error');
  fs.writeFileSync(path.join(chatsDir, 'direct..ok.json'), JSON.stringify({ messages: [
    { at: '2026-09-14T09:00:00Z', text: 'today', from: null },
  ] }));
  // A conversation-NAMED entry that is a DIRECTORY: readFileSync throws EISDIR,
  // i.e. a recognized conversation file whose bytes cannot be read.
  fs.mkdirSync(path.join(chatsDir, 'direct..unreadable.json'), { recursive: true });

  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(summary.readable, true, 'the listing itself succeeded');
  assert.ok(summary.readErrors >= 1, 'the unreadable conversation file must be counted');
  assert.deepEqual(summary.pruned, [], 'a per-file read error must block pruning (fail closed)');
  assert.ok(fs.existsSync(path.join(outDir, '2020-01-01.md')), 'the compiled history must survive a read error');
  assert.ok(fs.existsSync(path.join(outDir, '2026-09-14.md')), 'a readable day is still written');
});

test('compileAll: a readable but empty chats dir prunes ALL stale day files, keeps non-day files', () => {
  const chatsDir = path.join(SANDBOX, 'chats-empty-wipe');
  const outDir = path.join(SANDBOX, 'chats-daily-empty-wipe');
  fs.mkdirSync(chatsDir, { recursive: true }); // exists, readable, genuinely empty
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '2026-09-13.md'), 'stale');
  fs.writeFileSync(path.join(outDir, '2026-09-14.md'), 'stale');
  fs.writeFileSync(path.join(outDir, 'README.md'), 'keep');
  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(summary.readable, true);
  assert.equal(summary.days, 0, 'nothing to write from an empty source');
  assert.deepEqual(summary.pruned.slice().sort(), ['2026-09-13', '2026-09-14'], 'every stale day is pruned when the source is readable and empty');
  assert.ok(!fs.existsSync(path.join(outDir, '2026-09-13.md')));
  assert.ok(fs.existsSync(path.join(outDir, 'README.md')), 'a non-day file must survive even a full wipe');
});

test('the direct/project filename convention still matches engine/chat.js (pin, convention #5)', () => {
  // dailylog's DIRECT_THREAD_FILE / PROJECT_THREAD_FILE re-derive the on-disk
  // naming chat.js writes. chat.js does not export those regexes, so this pins
  // dailylog's assumptions against chat.js's actual naming literals: if chat.js
  // changes the form, this fails and dailylog must be re-synced.
  const chatSrc = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  assert.ok(chatSrc.includes('direct..${key}.json'), 'chat.js direct-thread naming changed; re-sync dailylog DIRECT_THREAD_FILE');
  assert.ok(chatSrc.includes('${id}.${key}.json'), 'chat.js project-thread naming changed; re-sync dailylog PROJECT_THREAD_FILE');
});

test('compileAll: invalid JSON is stable junk and does NOT block pruning', () => {
  const chatsDir = path.join(SANDBOX, 'chats-junk');
  const outDir = path.join(SANDBOX, 'chats-daily-junk');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '2020-01-01.md'), 'stale, should be pruned');
  fs.writeFileSync(path.join(chatsDir, 'direct..ok.json'), JSON.stringify({ messages: [
    { at: '2026-09-14T09:00:00Z', text: 'today', from: null },
  ] }));
  fs.writeFileSync(path.join(chatsDir, 'proj.bad.json'), '{ not valid json');

  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(summary.readErrors, 0, 'invalid JSON is junk, not a read error');
  assert.deepEqual(summary.pruned, ['2020-01-01'], 'junk must not block pruning of a genuinely stale day');
});
