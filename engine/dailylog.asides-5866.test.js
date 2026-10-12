'use strict';
/**
 * kosmos#5866: the two other kinds of file engine/chat.js sets aside beside a thread file. A `.superseded` file is an
 * earlier project's thread file and is compiled as a conversation, under a heading of its own. A thread file that is not read as a
 * conversation (a `.damaged` one, or one that will not parse) may be the only place some days' messages were: a
 * daily file with no readable messages left, for a day no later than that file could last have gained one, is not
 * pruned.
 * Nothing else changes: every day with readable rows is rewritten as before.
 *
 *   tools/run-tests.sh --only engine/dailylog.asides-5866.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dailylog-5866-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const dl = require('./dailylog');
const store = require('./store');
const chat = require('./chat');
const dayOf = (at) => (typeof at === 'string' && at.length >= 10 ? at.slice(0, 10) : null);
const timeOf = (at) => (typeof at === 'string' && at.length >= 16 ? at.slice(11, 16) : '');

const row = (day, text) => ({ at: `2026-09-${day}T09:00:00Z`, text, from: null });
const dirs = (label) => {
  const chatsDir = path.join(SANDBOX, 'chats-' + label);
  const outDir = path.join(SANDBOX, 'daily-' + label);
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  return { chatsDir, outDir };
};
const put = (dir, name, body) => fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
const day = (outDir, d) => fs.readFileSync(path.join(outDir, `2026-09-${d}.md`), 'utf8');
const NOW = new Date('2026-09-30T12:00:00Z');   // the run's clock, injected: later than every message date below
const dayFiles = (outDir) => fs.readdirSync(outDir).filter((n) => n.endsWith('.md')).sort();
const count = (hay, needle) => hay.split(needle).length - 1;
const SUPERSEDED = 'proj1.a.json.2026-01-01T000000000Z.4242.1791741600000.superseded';
// the <ms> in a set-aside name is when it was set aside; these two say 2026-10-11, later than NOW, so they bound nothing
const DAMAGED = 'direct..p.json.earlier.4242.1791741600000.damaged';
// The moment a set-aside file was last written: none of its messages can be later.
const lastWritten = (dir, name, iso) => { const t = new Date(iso); fs.utimesSync(path.join(dir, name), t, t); };

test('a .superseded file made by the REAL writer shares no row with the live file, and the daily log shows every message once', () => {
  // Liu Kang's question on the card (m4976): can a superseded file overlap the live one? Driven through
  // engine/chat.js itself: two messages under one project, then two under a LATER project of the same name.
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(SANDBOX) + path.sep), 'the data root is not inside this test\'s sandbox');
  const texts = ['old project one', 'old project two', 'new project one', 'new project two'];
  for (const [i, born] of [[0, '2026-01-01T00:00:00.000Z'], [1, '2026-01-01T00:00:00.000Z'], [2, '2026-06-01T00:00:00.000Z'], [3, '2026-06-01T00:00:00.000Z']]) {
    assert.equal(chat.appendMessage('proj1', 'agenta', { text: texts[i] }, born).recorded, true, texts[i]);
  }
  const chatsDir = path.join(store.ROOT, 'chats');
  const names = fs.readdirSync(chatsDir).sort();
  const aside = names.filter((n) => n.endsWith('.superseded'));
  assert.equal(aside.length, 1, 'the writer did not set the earlier project\'s file aside: ' + names.join(', '));
  const inAside = JSON.parse(fs.readFileSync(path.join(chatsDir, aside[0]), 'utf8')).messages.map((m) => m.text);
  const inLive = JSON.parse(fs.readFileSync(path.join(chatsDir, 'proj1.agenta.json'), 'utf8')).messages.map((m) => m.text);
  assert.deepEqual(inAside, texts.slice(0, 2), 'the set-aside file is not the whole earlier conversation');
  const readBack = Date.parse(dl.setAsideAt(aside[0]));
  assert.ok(Math.abs(Date.now() - readBack) < 60000, 'the set-aside time was not read out of the name the writer made: ' + aside[0]);
  assert.deepEqual(inLive, texts.slice(2), 'the live file did not start empty: a row is in both files');
  // no id on a row to tell two apart by, which is why nothing here dedupes
  assert.ok(!('id' in JSON.parse(fs.readFileSync(path.join(chatsDir, aside[0]), 'utf8')).messages[0]));

  const outDir = path.join(SANDBOX, 'daily-real');
  // one fixed day for every row, so a run that straddles midnight cannot split the headings over two daily files
  const oneDay = { dayOf: () => '2026-09-01', timeOf: () => '09:00', now: NOW };
  const s = dl.compileAll({ chatsDir, outDir, ...oneDay });
  assert.equal(s.refused, null);
  assert.deepEqual(s.unknownFiles, []);
  assert.equal(s.conversations, 2, 'the set-aside conversation was not read as one of its own');
  assert.equal(s.messages, 4);
  const all = dayFiles(outDir).map((n) => fs.readFileSync(path.join(outDir, n), 'utf8')).join('\n');
  for (const t of texts) assert.equal(count(all, t), 1, JSON.stringify(t) + ' is not in the daily log exactly once');
  assert.equal(count(all, '## proj1 : agenta (an earlier project of this name, begun "2026-01-01T00:00:00.000Z")'), 1, 'the earlier conversation has no heading of its own');
  assert.equal(count(all, '## proj1 : agenta\n'), 1);
  // each message sits under the right heading: the section that starts at a heading runs to the next heading
  const section = (heading) => { const from = all.indexOf(heading); const next = all.indexOf('\n## ', from + 1); return all.slice(from, next < 0 ? undefined : next); };
  assert.match(section('## proj1 : agenta (an earlier'), /old project one[\s\S]*old project two/);
  assert.doesNotMatch(section('## proj1 : agenta (an earlier'), /new project/);
  assert.match(section('## proj1 : agenta\n'), /new project one[\s\S]*new project two/);
  assert.doesNotMatch(section('## proj1 : agenta\n'), /old project/);

  // a THIRD project of the same name: two earlier ones now, each under its own heading, not merged into one
  assert.equal(chat.appendMessage('proj1', 'agenta', { text: 'third project one' }, '2026-09-01T00:00:00.000Z').recorded, true);
  assert.equal(fs.readdirSync(chatsDir).filter((n) => n.endsWith('.superseded')).length, 2);
  dl.compileAll({ chatsDir, outDir, ...oneDay });
  const again = dayFiles(outDir).map((n) => fs.readFileSync(path.join(outDir, n), 'utf8')).join('\n');
  assert.equal(count(again, 'begun "2026-01-01T00:00:00.000Z")'), 1);
  assert.equal(count(again, 'begun "2026-06-01T00:00:00.000Z")'), 1);
  for (const t of [...texts, 'third project one']) assert.equal(count(again, t), 1, JSON.stringify(t));
});

test('CONTROL then fix: days that live only in a .superseded file are kept, not pruned', () => {
  const { chatsDir, outDir } = dirs('sup');
  put(chatsDir, 'proj1.a.json', { messages: [row(13, 'thirteen'), row(14, 'fourteen')] });
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf }).written, ['2026-09-13', '2026-09-14']);
  // the earlier project's file is set aside and the later project starts its own
  fs.renameSync(path.join(chatsDir, 'proj1.a.json'), path.join(chatsDir, SUPERSEDED));
  put(chatsDir, 'proj1.a.json', { messages: [row(20, 'twenty')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(s.pruned, [], 'a day that lives in the set-aside file was pruned');
  assert.deepEqual(s.written, ['2026-09-13', '2026-09-14', '2026-09-20']);
  assert.deepEqual(s.held, []);
  assert.match(day(outDir, 13), /thirteen/);
  assert.match(day(outDir, 13), /## proj1 : a \(an earlier project of this name, set aside as "proj1\.a\.json\..*\.superseded"\)/, 'a set-aside file with no birth date is told apart by its own name');
  assert.doesNotMatch(day(outDir, 20), /earlier project/);
  // CONTROL: the same folder with the set-aside file gone is what the compiler saw before: those days are pruned
  fs.rmSync(path.join(chatsDir, SUPERSEDED));
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf }).pruned, ['2026-09-13', '2026-09-14']);
});

test('what a set-aside file says about when its project began goes into the heading escaped, on one line', () => {
  const { chatsDir, outDir } = dirs('born');
  put(chatsDir, SUPERSEDED, { projectBornAt: 'x\n## Forged heading', messages: [row(13, 'thirteen')] });
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(count(day(outDir, 13), '\n## '), 1, 'a line break in the file made a second heading');
  assert.match(day(outDir, 13), /begun "x\\n## Forged heading"\)/);
});

test('rows a person copied into both files show under two headings; nothing is merged or dropped', () => {
  // The writer cannot produce this (first test). If someone does it by hand, it stays visible.
  const { chatsDir, outDir } = dirs('copied');
  put(chatsDir, SUPERSEDED, { messages: [row(13, 'the same words')] });
  put(chatsDir, 'proj1.a.json', { messages: [row(13, 'the same words')] });
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(count(day(outDir, 13), 'the same words'), 2);
  assert.equal(count(day(outDir, 13), '## proj1 : a'), 2);
});

test('a .damaged file keeps the daily files only it could have filled from the prune; every day with readable rows is current', () => {
  const { chatsDir, outDir } = dirs('dmg');
  for (const d of [12, 13, 14]) put(outDir, `2026-09-${d}.md`, `COMPILED BEFORE THE DAMAGE ${d}`);
  put(outDir, '2026-09-17.md', 'STALE: no message has this day any more');
  put(chatsDir, DAMAGED, '{"messages":[{"at":"2026-09-12T09:00:00Z","text":"cut sh');
  lastWritten(chatsDir, DAMAGED, '2026-09-14T12:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(13, 'thirteen, another conversation'), row(14, 'fourteen, after the damage'), row(16, 'sixteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.refused, null);
  assert.deepEqual(s.unknownFiles, [DAMAGED]);
  // day 12 has no readable message left and is before the damaged file's last write: its messages may be that file's
  assert.deepEqual(s.held, ['2026-09-12']);
  assert.equal(day(outDir, 12), 'COMPILED BEFORE THE DAMAGE 12', 'a day only the damaged file could have filled was pruned');
  // every day with readable rows is rewritten, before the line or after it: none is less current than without this
  assert.deepEqual(s.written, ['2026-09-13', '2026-09-14', '2026-09-16']);
  assert.match(day(outDir, 13), /thirteen, another conversation/);
  // a stale day AFTER the day of the last write cannot be the damaged file's, and is pruned as usual
  assert.deepEqual(s.pruned, ['2026-09-17']);

  // SUCCESSIVE RUNS, the sequences reviewers used to find a freeze in earlier cuts: later messages on the day before
  // the damage, on the day of it, and one kept late under an earlier time, all arrive.
  put(chatsDir, 'direct..p.json', { messages: [
    row(13, 'thirteen, another conversation'), { at: '2026-09-13T23:30:00Z', text: 'thirteen, late evening', from: null },
    row(14, 'fourteen, after the damage'), { at: '2026-09-14T18:00:00Z', text: 'fourteen, in the evening', from: null },
  ] });
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.match(day(outDir, 13), /thirteen, late evening/, 'the day before the damage is frozen at an earlier compile');
  assert.match(day(outDir, 14), /fourteen, in the evening/, 'the day of the damage is frozen at an earlier compile');
  assert.deepEqual(s2.held, ['2026-09-12']);
  assert.deepEqual(s2.pruned, ['2026-09-16']);
  // a targeted run never prunes, so it holds nothing and writes its day
  const one = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW, onlyDay: '2026-09-13' });
  assert.deepEqual([one.written, one.held], [['2026-09-13'], []]);
});

test('the line is the day of the last write itself: that day is held, the next is not', () => {
  // The day a file was last written is the day most likely to hold its newest messages. Reviewers found it pruned.
  for (const [label, name, body] of [['aside', DAMAGED, 'junk'], ['live', 'direct..p.json', '{ broken']]) {
    const { chatsDir, outDir } = dirs('boundary-' + label);
    for (const d of [4, 5, 6]) put(outDir, `2026-09-0${d}.md`, `COMPILED ${d}`);
    put(chatsDir, name, body);
    lastWritten(chatsDir, name, '2026-09-05T13:00:00Z');
    put(chatsDir, 'proj1.b.json', { messages: [row(20, 'twenty')] });
    const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
    assert.deepEqual([s.held, s.pruned], [['2026-09-04', '2026-09-05'], ['2026-09-06']], label);
  }
});

test('with a damaged file present, every day with readable rows is written exactly as the same folder without it', () => {
  // The same folder compiled twice: once with the damaged file there, once without. Every day that has readable
  // rows comes out byte for byte the same; the only difference is the day kept from the prune.
  const withIt = dirs('same-with');
  const without = dirs('same-without');
  const live = { messages: [row(10, 'ten'), row(11, 'eleven'), { at: '2026-09-11T23:30:00Z', text: 'eleven, late', from: null }, row(20, 'twenty')] };
  for (const d of [withIt, without]) {
    put(d.chatsDir, 'direct..p.json', live);
    put(d.chatsDir, 'proj1.b.json', { messages: [row(11, 'eleven, elsewhere')] });
    put(d.outDir, '2026-09-05.md', 'ONLY THE DAMAGED FILE HAD THIS DAY');
  }
  put(withIt.chatsDir, DAMAGED, 'junk');
  lastWritten(withIt.chatsDir, DAMAGED, '2026-09-12T12:00:00Z');
  const a = dl.compileAll({ chatsDir: withIt.chatsDir, outDir: withIt.outDir, dayOf, timeOf, now: NOW });
  const b = dl.compileAll({ chatsDir: without.chatsDir, outDir: without.outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(a.written, b.written);
  for (const d of a.written) assert.equal(fs.readFileSync(path.join(withIt.outDir, d + '.md'), 'utf8'), fs.readFileSync(path.join(without.outDir, d + '.md'), 'utf8'), d);
  assert.deepEqual([a.held, a.pruned, b.pruned], [['2026-09-05'], [], ['2026-09-05']]);
});

test('with several such files, the LATEST moment sets what is held', () => {
  const { chatsDir, outDir } = dirs('several');
  for (const d of [10, 12, 14, 16]) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}`);
  const other = 'proj1.b.json.earlier.1.2.damaged';
  put(chatsDir, DAMAGED, 'junk');
  put(chatsDir, other, 'junk');
  lastWritten(chatsDir, DAMAGED, '2026-09-11T08:00:00Z');
  lastWritten(chatsDir, other, '2026-09-15T08:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(20, 'twenty')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s.unknownFiles, [DAMAGED, other].sort());
  assert.deepEqual(s.held, ['2026-09-10', '2026-09-12', '2026-09-14'], 'everything before the later of the two');
  assert.deepEqual(s.pruned, ['2026-09-16']);
  lastWritten(chatsDir, DAMAGED, '2026-09-15T08:00:00Z');
  lastWritten(chatsDir, other, '2026-09-11T08:00:00Z');
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW }).held, ['2026-09-10', '2026-09-12', '2026-09-14']);
});

test('the three bounds: the file\'s time, the set-aside time in its own name, and now', (t) => {
  const { chatsDir, outDir } = dirs('bounds');
  for (const d of ['09', '20', '28']) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}`);
  put(chatsDir, 'proj1.b.json', { messages: [{ at: '2026-10-01T09:00:00Z', text: 'october', from: null }] });
  // (1) a file time in the future, a name that says it was set aside on 2026-09-10: the name bounds it
  const setAside = new Date('2026-09-10T08:00:00Z').getTime();
  const named = `direct..p.json.earlier.4242.${setAside}.damaged`;
  assert.equal(dl.setAsideAt(named), '2026-09-10T08:00:00.000Z');
  assert.equal(dl.setAsideAt(`direct..p.json.earlier.4242.${setAside}.2.damaged`), '2026-09-10T08:00:00.000Z', 'a counter after the time');
  // not a time: a live file's key, no stamp at all, and a date someone typed into a name (12 or 14 digits)
  for (const none of ['direct..1234567890123.json', 'direct..p.json.damaged', 'direct..p.json.x.damaged', 'direct..p.json.backup.202609141200.damaged', 'direct..p.json.backup.20260914120000.damaged', '']) assert.equal(dl.setAsideAt(none), null, none);
  for (const kind of ['superseded', 'damaged', 'full']) assert.equal(dl.setAsideAt(`direct..p.json.x.1.${setAside}.${kind}`), '2026-09-10T08:00:00.000Z', kind);
  put(chatsDir, named, 'junk');
  lastWritten(chatsDir, named, '2099-01-01T00:00:00Z');
  for (const now of ['2026-10-02T08:00:00Z', '2026-10-09T08:00:00Z']) {
    const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: new Date(now) });
    assert.deepEqual([s.held, s.pruned], [['2026-09-09'], ['2026-09-20', '2026-09-28']], 'run at ' + now + ': the line moved with the clock');
    for (const d of ['20', '28']) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}`);
  }
  // (2) no time in the name and a file time in the future: now is the only bound left, so the line follows the clock.
  // That keeps more from the prune as days pass; it never stops a day being written.
  fs.rmSync(path.join(chatsDir, named));
  put(chatsDir, DAMAGED.replace('1791741600000', 'x'), 'junk');
  lastWritten(chatsDir, DAMAGED.replace('1791741600000', 'x'), '2099-01-01T00:00:00Z');
  const s3 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: new Date('2026-09-25T08:00:00Z') });
  assert.deepEqual([s3.held, s3.pruned], [['2026-09-09', '2026-09-20'], ['2026-09-28']]);
  // (3) a time that cannot be read at all (a link to nowhere) counts as now too
  fs.rmSync(path.join(chatsDir, DAMAGED.replace('1791741600000', 'x')));
  put(outDir, '2026-09-28.md', 'COMPILED 28');
  let linked = true;
  try { fs.symlinkSync(path.join(chatsDir, 'no-such-target'), path.join(chatsDir, DAMAGED.replace('1791741600000', 'x'))); } catch { linked = false; }
  if (!linked) { t.diagnostic('this filesystem or account cannot make a symlink: the unreadable-time arm was not run'); return; }
  const s4 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: new Date('2026-09-25T08:00:00Z') });
  assert.deepEqual([s4.held, s4.pruned], [['2026-09-09', '2026-09-20'], ['2026-09-28']]);
});

test('when the day of that moment cannot be worked out, every daily file is held from the prune', () => {
  const { chatsDir, outDir } = dirs('no-day');
  for (const d of [13, 25]) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}`);
  put(chatsDir, DAMAGED, 'junk');
  lastWritten(chatsDir, DAMAGED, '2026-09-14T12:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(21, 'twenty-one')] });
  // a day function that knows message times but not a file's (it returns nothing for one carrying milliseconds)
  const partial = (at) => (typeof at === 'string' && at.length === 20 ? at.slice(0, 10) : null);
  const s = dl.compileAll({ chatsDir, outDir, dayOf: partial, timeOf, now: NOW });
  assert.deepEqual([s.held, s.written, s.pruned], [['2026-09-13', '2026-09-25'], ['2026-09-21'], []], 'not knowing where the line is dropped the hold');
});

test('a .superseded file that will not parse, or holds no message list, is held like a damaged one, not skipped as junk', () => {
  const { chatsDir, outDir } = dirs('sup-bad');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, SUPERSEDED, '{"messages":[{"at":"2026-09-13T0');
  lastWritten(chatsDir, SUPERSEDED, '2026-09-14T23:00:00Z');
  put(chatsDir, 'proj1.a.json', { messages: [row(20, 'twenty')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual([s.unknownFiles, s.held, s.pruned], [[SUPERSEDED], ['2026-09-13'], []]);
  assert.equal(day(outDir, 13), 'COMPILED 13');
  put(chatsDir, SUPERSEDED, { notMessages: true });
  lastWritten(chatsDir, SUPERSEDED, '2026-09-14T23:00:00Z');
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW }).held, ['2026-09-13']);
});

test('a .superseded file whose own conversation had rolled over refuses the run, as a live one does (kosmos#5855)', () => {
  const { chatsDir, outDir } = dirs('sup-rolled');
  put(outDir, '2026-09-10.md', 'COMPILED 10');
  put(chatsDir, SUPERSEDED, { continues: 'proj1.a.json.x.full', carried: 1, messages: [row(13, 'carried')] });
  put(chatsDir, 'proj1.a.json', { messages: [row(20, 'twenty')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual(s.continuedFiles, [SUPERSEDED]);
  assert.deepEqual(dayFiles(outDir), ['2026-09-10.md'], 'the run wrote or pruned something');
  // the same sign when the file holds no message list, and when it will not parse at all
  for (const body of [JSON.stringify({ continues: 'proj1.a.json.x.full', messages: 'nope' }), '{"continues":"proj1.a.json.x.full","messages":[{"at":"2026-09-1']) {
    put(chatsDir, SUPERSEDED, body);
    const again = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
    assert.deepEqual([again.refused, again.continuedFiles], ['rolled-over', [SUPERSEDED]], body.slice(0, 40));
  }
});

test('a LIVE thread file chat.js would set aside as damaged holds the same days before it has been', () => {
  // The likely order of events: a file is damaged, the nightly compile runs, and only the next message sets it aside.
  // Skipped as junk in between, the days only it had were pruned before the hold could begin.
  for (const [label, body] of [['cut', '{"messages":[{"at":"2026-09-10T09:00:00Z","text":"cut sh'], ['shape', JSON.stringify({ messages: { not: 'a list' } })], ['digits', '{bad']]) {
    const { chatsDir, outDir } = dirs('live-' + label);
    const live = label === 'digits' ? 'direct..1234567890123.json' : 'direct..p.json';   // a key made of digits, as any other key
    put(outDir, '2026-09-10.md', 'COMPILED 10, ITS ROWS ONLY');
    put(chatsDir, live, body);
    lastWritten(chatsDir, live, '2026-09-12T09:00:00Z');
    put(chatsDir, 'proj1.b.json', { messages: [row(11, 'eleven, another conversation')] });
    const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
    assert.equal(s.readErrors, 0, label);
    assert.deepEqual([s.unknownFiles, s.held, s.pruned, s.written], [[live], ['2026-09-10'], [], ['2026-09-11']], label);
    // then the next message arrives: chat.js sets the file aside (same bytes, same time) and starts a fresh one
    fs.renameSync(path.join(chatsDir, live), path.join(chatsDir, live + '.earlier.4242.1791741600000.damaged'));
    put(chatsDir, live, { messages: [row(14, 'fourteen, after')] });
    assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW }).held, ['2026-09-10'], label + ': after it was set aside');
    assert.equal(day(outDir, 10), 'COMPILED 10, ITS ROWS ONLY', label);
  }
});

test('a file that cannot be READ this run behaves as it did before: no prune, and nothing is held', (t) => {
  const { chatsDir, outDir } = dirs('readerr');
  put(outDir, '2026-09-14.md', 'COMPILED 14');
  put(outDir, '2026-09-10.md', 'STALE 10');
  put(chatsDir, 'direct..ok.json', { messages: [row(14, 'fourteen'), row(21, 'twenty-one')] });
  fs.mkdirSync(path.join(chatsDir, 'direct..unreadable.json'));   // readFileSync throws EISDIR: a read error
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.readErrors, 1);
  // (`|| []`: this half describes the compiler from before the change too, which has no `held`)
  assert.deepEqual([s.held || [], s.pruned, s.written], [[], [], ['2026-09-14', '2026-09-21']]);
  assert.match(day(outDir, 14), /fourteen/, 'a readable day was not rewritten');
  assert.equal(day(outDir, 10), 'STALE 10', 'a read error did not stop the prune');
  // an unreadable .superseded file is a read error too, not an unknown file
  let linked = true;
  try { fs.symlinkSync(path.join(chatsDir, 'no-such-target'), path.join(chatsDir, SUPERSEDED)); } catch { linked = false; }
  if (!linked) { t.diagnostic('this filesystem or account cannot make a symlink: the unreadable .superseded arm was not run'); return; }
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s2.readErrors, 2);
  assert.deepEqual([s2.unknownFiles, s2.held, s2.pruned], [[], [], []]);
});

test('names: a thread file\'s name in front, the kind at the end; a folder so named is not a file', () => {
  const { chatsDir, outDir } = dirs('names');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, 'direct..p.json', { messages: [row(20, 'twenty')] });
  fs.mkdirSync(path.join(chatsDir, 'direct..q.json.x.damaged'));
  fs.mkdirSync(path.join(chatsDir, 'proj1.b.json.x.superseded'));
  put(chatsDir, 'notes.json.x.damaged', 'junk');
  put(chatsDir, 'direct..p.json.x.damagedish', 'junk');
  put(chatsDir, '.direct..p.json.x.damaged', 'junk');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual([s.unknownFiles, s.held, s.pruned], [[], [], ['2026-09-13']]);
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, 'p.json.json.x.damaged', 'junk');
  put(chatsDir, 'direct..p.json.damaged', 'junk');
  for (const n of ['p.json.json.x.damaged', 'direct..p.json.damaged']) lastWritten(chatsDir, n, '2026-09-14T12:00:00Z');
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual([s2.unknownFiles, s2.held], [['direct..p.json.damaged', 'p.json.json.x.damaged'], ['2026-09-13']]);
});

test('a rolled-over conversation still refuses the whole run, whatever else is in the folder (kosmos#5855)', () => {
  const { chatsDir, outDir } = dirs('with-full');
  put(outDir, '2026-09-05.md', 'COMPILED 5');
  put(chatsDir, DAMAGED, 'junk');
  lastWritten(chatsDir, DAMAGED, '2026-09-20T12:00:00Z');
  put(chatsDir, SUPERSEDED, { messages: [row(13, 'thirteen')] });
  put(chatsDir, 'direct..p.json.x.full', '{}');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual([s.written, s.pruned, s.held], [[], [], []]);
  assert.deepEqual(dayFiles(outDir), ['2026-09-05.md']);
  // the summary has the same keys refused, held, and plain; so has readConversations on both its returns
  const plain = dl.compileAll({ chatsDir: path.join(SANDBOX, 'no-such-folder'), outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(Object.keys(s).sort(), Object.keys(plain).sort());
  fs.rmSync(path.join(chatsDir, 'direct..p.json.x.full'));
  const heldRun = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(heldRun.held, ['2026-09-05'], 'precondition: this is a run that held a day');
  assert.deepEqual(Object.keys(heldRun).sort(), Object.keys(plain).sort());
  assert.deepEqual(Object.keys(dl.readConversations(path.join(SANDBOX, 'no-such-folder'))).sort(), Object.keys(dl.readConversations(chatsDir)).sort());
});

test('the command says which daily files it kept from the prune and why, and still exits 0', () => {
  const root = store.ROOT;
  assert.ok(path.resolve(root).startsWith(path.resolve(SANDBOX) + path.sep), 'the data root is not inside this test\'s sandbox: ' + root);
  const chatsDir = path.join(root, 'chats');
  const outDir = path.join(root, dl.CHATS_DAILY_DIRNAME);
  fs.rmSync(chatsDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(chatsDir, { recursive: true });
  // three days long ago, so the local day of each is a past day whatever the timezone
  const at = (d) => ({ at: `2020-03-0${d}T12:00:00Z`, text: 'day ' + d });
  put(chatsDir, 'direct..p.json', { messages: [at(4), at(6), at(8)] });
  const run = () => spawnSync(process.execPath, [path.join(__dirname, 'dailylog.js')], { env: process.env, encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout, /kept \d+ daily file/);   // control: nothing unreadable, nothing held, no such line
  const made = dayFiles(outDir).map((n) => n.slice(0, -3));
  assert.equal(made.length, 3);
  // the first and last day's messages are gone from every readable file, and two files cannot be read as conversations
  put(chatsDir, 'direct..p.json', { messages: [at(6)] });
  put(chatsDir, DAMAGED, 'junk');
  put(chatsDir, 'proj1.b.json.earlier.1.2.damaged', 'junk');
  put(chatsDir, 'proj1.c.json.earlier.1.2.damaged', 'junk');
  const held = run();
  assert.equal(held.status, 0, held.stderr);
  assert.equal(held.stderr, '');
  assert.ok(held.stdout.includes(`dailylog: kept 2 daily file(s) with no readable messages left (between ${made[0]} and ${made[2]}), because 3 file(s) in the chats folder could not be read as conversations and may hold messages from those days\n`), held.stdout);
  assert.deepEqual(dayFiles(outDir).map((n) => n.slice(0, -3)), made, 'a day was pruned');
  // one day kept: the day itself, no "between"
  fs.rmSync(path.join(outDir, made[2] + '.md'));
  const single = run();
  assert.ok(single.stdout.includes(`dailylog: kept 1 daily file(s) with no readable messages left (${made[0]}), because 3 file(s) in the chats folder`), single.stdout);
});

test('pin (convention 5): what this compiler assumes about the two kinds is what engine/chat.js does', () => {
  const src = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  // a superseded file is the whole earlier conversation, and the later one starts EMPTY: no row can be in both
  assert.match(src, /const moved = supersede\(projectId, agent, 'superseded'\);\n\s+if \(!moved\.ok\) \{\n\s+return \{ recorded: false, because: moved\.because \};\n\s+\}\n\s+existing = \{ messages: \[\] \};/,
    'engine/chat.js no longer starts the later project empty after setting the earlier file aside: check for rows in both');
  assert.ok(src.includes("const moved = supersede(projectId, agent, 'damaged');"), 'engine/chat.js no longer sets a damaged file aside as .damaged');
  // set aside by RENAME (the bytes, and the time they were last written, move with the file), beside the thread file
  assert.ok(src.includes('fs.renameSync(file, aside);'));
  assert.ok(src.includes('let aside = `${stem}.${suffix}`;'));
  // the set-aside time this compiler reads out of the name is the Date.now() chat.js puts there, with an optional counter
  assert.ok(src.includes('const stem = `${file}.${stamp}.${process.pid}.${Date.now()}`;'), 'engine/chat.js builds a set-aside name differently now: check setAsideAt');
  assert.ok(src.includes('aside = `${stem}.${n}.${suffix}`;'), 'engine/chat.js numbers a second aside differently now: check setAsideAt');
});
