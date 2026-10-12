'use strict';
/**
 * kosmos#5866: the two other kinds of file engine/chat.js sets aside beside a thread file. A `.superseded` file is a
 * whole earlier conversation and is compiled as one, under a heading of its own. A `.damaged` file (and a
 * `.superseded` file that will not parse) is not read: daily files for days before it was last written may hold its
 * messages, so they are left as they are, neither rewritten nor pruned. Later days compile as usual.
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

test('rows a person copied into both files show under two headings; nothing is merged or dropped', () => {
  // The writer cannot produce this (first test). If someone does it by hand, it stays visible.
  const { chatsDir, outDir } = dirs('copied');
  put(chatsDir, SUPERSEDED, { messages: [row(13, 'the same words')] });
  put(chatsDir, 'proj1.a.json', { messages: [row(13, 'the same words')] });
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(count(day(outDir, 13), 'the same words'), 2);
  assert.equal(count(day(outDir, 13), '## proj1 : a'), 2);
});

test('a .damaged file holds the daily files from before it was last written; that day and later compile as usual', () => {
  const { chatsDir, outDir } = dirs('dmg');
  for (const d of [12, 13, 14, 15]) put(outDir, `2026-09-${d}.md`, `COMPILED BEFORE THE DAMAGE ${d}`);
  put(outDir, '2026-09-17.md', 'STALE: no message has this day any more');
  put(chatsDir, DAMAGED, '{"messages":[{"at":"2026-09-13T09:00:00Z","text":"cut sh');
  lastWritten(chatsDir, DAMAGED, '2026-09-14T12:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(13, 'thirteen, from another day'), row(14, 'fourteen, after the damage'), row(15, 'fifteen'), row(16, 'sixteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.refused, null);
  assert.deepEqual(s.unknownFiles, [DAMAGED]);
  assert.deepEqual(s.held, ['2026-09-12', '2026-09-13'], 'the days before the damaged file was last written');
  assert.equal(day(outDir, 12), 'COMPILED BEFORE THE DAMAGE 12', 'a held day with no readable rows left was pruned');
  assert.equal(day(outDir, 13), 'COMPILED BEFORE THE DAMAGE 13', 'a held day was rewritten from the rows that can still be read');
  // the day it was last written can still gain messages, so it is compiled, and so is every later day
  assert.deepEqual(s.written, ['2026-09-14', '2026-09-15', '2026-09-16']);
  assert.match(day(outDir, 14), /fourteen, after the damage/);
  assert.deepEqual(s.pruned, ['2026-09-17'], 'a stale day after the damaged file\'s last write is still pruned');

  // A SECOND RUN, later the same day: a held day stays held, and the day of the damage picks up a new message.
  // (Holding that day too would freeze it at its first compile: the fault a reviewer found in the first cut.)
  put(chatsDir, 'direct..p.json', { messages: [row(13, 'thirteen, from another day'), row(14, 'fourteen, after the damage'), { at: '2026-09-14T18:00:00Z', text: 'fourteen, in the evening', from: null }] });
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.match(day(outDir, 14), /fourteen, in the evening/, 'the day the file was damaged is frozen at its first compile');
  assert.equal(day(outDir, 13), 'COMPILED BEFORE THE DAMAGE 13');
  assert.deepEqual(s2.held, ['2026-09-12', '2026-09-13']);
  assert.deepEqual(s2.pruned, ['2026-09-15', '2026-09-16'], 'days after the damage whose messages are gone are pruned as usual');
  // a targeted run of a held day leaves it alone; of a later day, writes it
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW, onlyDay: '2026-09-13' }).held, ['2026-09-13']);
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW, onlyDay: '2026-09-14' }).written, ['2026-09-14']);
  // a day before the damage that has NO daily file yet is written: nothing compiled is lost by that
  put(chatsDir, 'proj1.b.json', { messages: [row(10, 'ten, never compiled')] });
  assert.ok(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW }).written.includes('2026-09-10'));
});

test('CONTROL for the above: the same folder with no .damaged file rewrites and prunes as it always has', () => {
  const { chatsDir, outDir } = dirs('dmg-ctl');
  for (const d of [12, 13, 14]) put(outDir, `2026-09-${d}.md`, `COMPILED BEFORE ${d}`);
  put(chatsDir, 'direct..p.json', { messages: [row(13, 'thirteen'), row(14, 'fourteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s.written, ['2026-09-13', '2026-09-14']);
  assert.deepEqual(s.pruned, ['2026-09-12']);
  assert.match(day(outDir, 13), /thirteen/);
  // (`|| []`: this control describes the compiler from before the change too, which has no such fields)
  assert.deepEqual([s.held || [], s.unknownFiles || []], [[], []]);
});

test('KNOWN COST, pinned: a message kept late under an earlier time does not reach a held day', () => {
  // chat.js keeps a caller's `at` (a drained reply carries its original send time), so a readable file can gain a row
  // dated before the damage. The held day is not rewritten, so that row is missing from it. The plan gives this as
  // the price of not dropping the damaged file's rows; this test is here so the price is not forgotten.
  const { chatsDir, outDir } = dirs('late-row');
  put(outDir, '2026-09-13.md', 'COMPILED 13, WITH THE DAMAGED FILE\'S ROWS');
  put(chatsDir, DAMAGED, 'junk');
  lastWritten(chatsDir, DAMAGED, '2026-09-14T12:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(13, 'a reply kept on the 15th under its original time'), row(15, 'fifteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s.held, ['2026-09-13']);
  assert.equal(day(outDir, 13), 'COMPILED 13, WITH THE DAMAGED FILE\'S ROWS');
});

test('when the day a set-aside file was last written cannot be worked out, every existing daily file is held', () => {
  const { chatsDir, outDir } = dirs('no-day');
  for (const d of [13, 20]) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}`);
  put(chatsDir, DAMAGED, 'junk');
  lastWritten(chatsDir, DAMAGED, '2026-09-14T12:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(20, 'twenty'), row(21, 'twenty-one')] });
  // a day function that knows message times but not a file's (it returns nothing for one carrying milliseconds)
  const partial = (at) => (typeof at === 'string' && at.length === 20 ? at.slice(0, 10) : null);
  const s = dl.compileAll({ chatsDir, outDir, dayOf: partial, timeOf, now: NOW });
  assert.deepEqual(s.held, ['2026-09-13', '2026-09-20'], 'not knowing where the line is dropped the hold');
  assert.deepEqual([s.written, s.pruned], [['2026-09-21'], []]);
  assert.equal(day(outDir, 20), 'COMPILED 20');
});

test('with several such files, the LATEST last-written time sets what is held', () => {
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
  // and the other way round on disk gives the same answer
  lastWritten(chatsDir, DAMAGED, '2026-09-15T08:00:00Z');
  lastWritten(chatsDir, other, '2026-09-11T08:00:00Z');
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW }).held, ['2026-09-10', '2026-09-12', '2026-09-14']);
});

test('a last-written time in the future, or one that cannot be read, counts as now: today is never held', (t) => {
  const { chatsDir, outDir } = dirs('future');
  for (const d of [28, 30]) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}`);
  put(chatsDir, 'direct..p.json', { messages: [row(28, 'twenty-eight'), row(30, 'thirty, today')] });
  put(chatsDir, DAMAGED, 'junk');
  lastWritten(chatsDir, DAMAGED, '2099-01-01T00:00:00Z');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });   // NOW is 2026-09-30
  assert.deepEqual(s.held, ['2026-09-28'], 'a file dated in the future held today, or held nothing');
  assert.match(day(outDir, 30), /thirty, today/, 'today was frozen by a set-aside file dated in the future');
  // one whose time cannot be read at all (a link to nowhere)
  fs.rmSync(path.join(chatsDir, DAMAGED));
  put(outDir, '2026-09-30.md', 'COMPILED 30');
  let linked = true;
  try { fs.symlinkSync(path.join(chatsDir, 'no-such-target'), path.join(chatsDir, DAMAGED)); } catch { linked = false; }
  if (!linked) { t.diagnostic('this filesystem or account cannot make a symlink: the undatable arm was not run'); return; }
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s2.unknownFiles, [DAMAGED]);
  assert.deepEqual(s2.held, ['2026-09-28']);
  assert.match(day(outDir, 30), /thirty, today/);
});

test('the set-aside time in a file\'s own name bounds it too: a file time in the future does not move the line day by day', () => {
  // A reviewer's sequence: a .damaged file whose time is far in the future, and one run a day. Bounded by "now" alone,
  // the line would move forward each day and freeze every yesterday at its last compile. The name says when it was
  // set aside (2026-09-10 here), and nothing in it is later than that.
  const { chatsDir, outDir } = dirs('name-bound');
  const setAside = new Date('2026-09-10T08:00:00Z').getTime();
  const name = `direct..p.json.earlier.4242.${setAside}.damaged`;
  put(chatsDir, name, 'junk');
  lastWritten(chatsDir, name, '2099-01-01T00:00:00Z');
  for (const d of [9, 20]) put(outDir, `2026-09-${String(d).padStart(2, '0')}.md`, `COMPILED ${d}`);
  put(chatsDir, 'proj1.b.json', { messages: [{ at: '2026-09-20T07:00:00Z', text: 'twentieth, morning', from: null }, { at: '2026-09-20T15:00:00Z', text: 'twentieth, afternoon', from: null }] });
  for (const now of ['2026-09-21T08:00:00Z', '2026-09-25T08:00:00Z']) {
    const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: new Date(now) });
    assert.deepEqual(s.held, ['2026-09-09'], 'run at ' + now + ': the line moved with the clock');
    assert.match(day(outDir, 20), /twentieth, afternoon/, 'run at ' + now + ': a day after it was set aside is frozen');
  }
  // a counter after the <ms> (a second aside in the same millisecond) is read the same way
  fs.renameSync(path.join(chatsDir, name), path.join(chatsDir, `direct..p.json.earlier.4242.${setAside}.2.damaged`));
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW }).held, ['2026-09-09']);
});

test('a LIVE thread file that will not parse holds the same days, before chat.js has set it aside', () => {
  // The likely order of events: a file is damaged, the nightly compile runs, and only the next message sets it aside.
  // Skipped as junk in between, its days were pruned before the hold could begin.
  const { chatsDir, outDir } = dirs('live-bad');
  for (const d of [10, 11]) put(outDir, `2026-09-${d}.md`, `COMPILED ${d}, WITH ITS ROWS`);
  put(chatsDir, 'direct..p.json', '{"messages":[{"at":"2026-09-10T09:00:00Z","text":"cut sh');
  lastWritten(chatsDir, 'direct..p.json', '2026-09-12T09:00:00Z');
  put(chatsDir, 'proj1.b.json', { messages: [row(11, 'eleven, another conversation'), row(13, 'thirteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.readErrors, 0);
  assert.deepEqual(s.unknownFiles, ['direct..p.json']);
  assert.deepEqual(s.held, ['2026-09-10', '2026-09-11']);
  assert.deepEqual(s.pruned, []);
  assert.equal(day(outDir, 11), 'COMPILED 11, WITH ITS ROWS');
  assert.deepEqual(s.written, ['2026-09-13']);
  // then the next message arrives: the file is set aside (same bytes, same time) and a fresh one starts. Nothing changes.
  fs.renameSync(path.join(chatsDir, 'direct..p.json'), path.join(chatsDir, DAMAGED));
  put(chatsDir, 'direct..p.json', { messages: [row(14, 'fourteen, after')] });
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s2.held, ['2026-09-10', '2026-09-11']);
  assert.equal(day(outDir, 10), 'COMPILED 10, WITH ITS ROWS');
  // a live file's key made only of digits is not a set-aside time: its own last write still sets the line
  const d = dirs('live-digits');
  put(d.outDir, '2026-09-01.md', 'COMPILED 1');
  put(d.chatsDir, 'direct..1234567890123.json', '{bad');
  lastWritten(d.chatsDir, 'direct..1234567890123.json', '2026-09-12T09:00:00Z');
  const sd = dl.compileAll({ chatsDir: d.chatsDir, outDir: d.outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual([sd.held, sd.pruned], [['2026-09-01'], []], 'the digits in a live file\'s key were read as the time it was set aside');
  // a thread-named file that parses but is not a conversation is still just skipped: it is not a damaged one
  const c = dirs('live-other');
  put(c.outDir, '2026-09-10.md', 'STALE');
  put(c.chatsDir, 'proj1.b.json', { cursor: 1 });
  assert.deepEqual(dl.compileAll({ chatsDir: c.chatsDir, outDir: c.outDir, dayOf, timeOf, now: NOW }).pruned, ['2026-09-10']);
});

test('a .superseded file that will not parse, or holds no message list, is held like a damaged one, not skipped as junk', () => {
  const { chatsDir, outDir } = dirs('sup-bad');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, SUPERSEDED, '{"messages":[{"at":"2026-09-13T0');
  lastWritten(chatsDir, SUPERSEDED, '2026-09-14T23:00:00Z');
  put(chatsDir, 'proj1.a.json', { messages: [row(20, 'twenty')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s.unknownFiles, [SUPERSEDED]);
  assert.deepEqual(s.held, ['2026-09-13']);
  assert.deepEqual(s.pruned, []);
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
});

test('a file that cannot be READ this run behaves as it did before: no prune, and nothing is held', (t) => {
  // Unchanged on purpose. A day rewritten without an unreadable conversation is rewritten in full the next time it can
  // be read; holding it would freeze every day for as long as the file stays unreadable.
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
  // none of these is a set-aside thread file: the run prunes as usual
  fs.mkdirSync(path.join(chatsDir, 'direct..q.json.x.damaged'));
  fs.mkdirSync(path.join(chatsDir, 'proj1.b.json.x.superseded'));
  put(chatsDir, 'notes.json.x.damaged', 'junk');
  put(chatsDir, 'direct..p.json.x.damagedish', 'junk');
  put(chatsDir, '.direct..p.json.x.damaged', 'junk');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual([s.unknownFiles, s.held, s.pruned], [[], [], ['2026-09-13']]);
  // these are: an agent keyed exactly "json", and a name with nothing between the thread file's name and the kind
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, 'p.json.json.x.damaged', 'junk');
  put(chatsDir, 'direct..p.json.damaged', 'junk');
  for (const n of ['p.json.json.x.damaged', 'direct..p.json.damaged']) lastWritten(chatsDir, n, '2026-09-14T12:00:00Z');
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(s2.unknownFiles, ['direct..p.json.damaged', 'p.json.json.x.damaged']);
  assert.deepEqual(s2.held, ['2026-09-13']);
});

test('a rolled-over conversation still refuses the whole run, whatever else is in the folder (kosmos#5855)', () => {
  const { chatsDir, outDir } = dirs('with-full');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, DAMAGED, 'junk');
  put(chatsDir, SUPERSEDED, { messages: [row(13, 'thirteen')] });
  put(chatsDir, 'direct..p.json.x.full', '{}');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual([s.written, s.pruned, s.held], [[], [], []]);
  assert.equal(day(outDir, 13), 'COMPILED 13');
  // the summary has the same keys refused, held, and plain; so has readConversations on both its returns
  const plain = dl.compileAll({ chatsDir: path.join(SANDBOX, 'no-such-folder'), outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(Object.keys(s).sort(), Object.keys(plain).sort());
  fs.rmSync(path.join(chatsDir, 'direct..p.json.x.full'));
  lastWritten(chatsDir, DAMAGED, '2026-09-20T12:00:00Z');
  const heldRun = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: NOW });
  assert.deepEqual(heldRun.held, ['2026-09-13'], 'precondition: this is a run that held a day');
  assert.deepEqual(Object.keys(heldRun).sort(), Object.keys(plain).sort());
  assert.deepEqual(Object.keys(dl.readConversations(path.join(SANDBOX, 'no-such-folder'))).sort(), Object.keys(dl.readConversations(chatsDir)).sort());
});

test('the command says which daily files it left alone and why, and still exits 0', () => {
  const root = store.ROOT;
  assert.ok(path.resolve(root).startsWith(path.resolve(SANDBOX) + path.sep), 'the data root is not inside this test\'s sandbox: ' + root);
  const chatsDir = path.join(root, 'chats');
  const outDir = path.join(root, dl.CHATS_DAILY_DIRNAME);
  fs.rmSync(chatsDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(chatsDir, { recursive: true });
  // three days long ago, so the local day of each is a past day whatever the timezone
  put(chatsDir, 'direct..p.json', { messages: [{ at: '2020-03-04T12:00:00Z', text: 'a' }, { at: '2020-03-06T12:00:00Z', text: 'b' }, { at: '2020-03-08T12:00:00Z', text: 'c' }] });
  const run = () => spawnSync(process.execPath, [path.join(__dirname, 'dailylog.js')], { env: process.env, encoding: 'utf8' });
  // control: nothing set aside, nothing held, no such line
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout, /as they were/);
  const made = dayFiles(outDir).map((n) => n.slice(0, -3));
  assert.equal(made.length, 3);
  put(chatsDir, DAMAGED, 'junk');                      // last written now: every one of those days is before it
  put(chatsDir, 'proj1.b.json.earlier.1.2.damaged', 'junk');
  const held = run();
  assert.equal(held.status, 0, held.stderr);
  assert.equal(held.stderr, '');
  assert.ok(held.stdout.includes(`dailylog: left 3 daily file(s) already there as they were (between ${made[0]} and ${made[2]}), because 2 file(s) in the chats folder could not be read as conversations and may hold messages from those days\n`), held.stdout);
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
});
