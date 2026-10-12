'use strict';
/**
 * kosmos#5866: the two other kinds of file engine/chat.js sets aside beside a thread file, and a thread file that
 * cannot be read. A `.superseded` file is a whole earlier conversation and is compiled as one, under a heading of its
 * own. A `.damaged` file, a `.superseded` file that will not parse, and an unreadable thread file hold messages this
 * compiler cannot know: daily files that may hold them are left as they are, neither rewritten nor pruned.
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
const dayFiles = (outDir) => fs.readdirSync(outDir).filter((n) => n.endsWith('.md')).sort();
const count = (hay, needle) => hay.split(needle).length - 1;
const SUPERSEDED = 'proj1.a.json.2026-01-01T000000000Z.4242.1791741600000.superseded';
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
  const s = dl.compileAll({ chatsDir, outDir });
  assert.equal(s.refused, null);
  assert.deepEqual(s.unknownFiles, []);
  assert.equal(s.conversations, 2, 'the set-aside conversation was not read as one of its own');
  assert.equal(s.messages, 4);
  const all = dayFiles(outDir).map((n) => fs.readFileSync(path.join(outDir, n), 'utf8')).join('\n');
  for (const t of texts) assert.equal(count(all, t), 1, JSON.stringify(t) + ' is not in the daily log exactly once');
  assert.equal(count(all, '## proj1 : agenta (an earlier project of this name)'), 1, 'the earlier conversation has no heading of its own');
  assert.equal(count(all, '## proj1 : agenta\n'), 1);
  assert.ok(all.indexOf('old project one') > all.indexOf('(an earlier project of this name)') || all.indexOf('old project one') < all.indexOf('## proj1 : agenta\n'),
    'an earlier message sits under the live conversation\'s heading');
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
  assert.match(day(outDir, 13), /## proj1 : a \(an earlier project of this name\)/);
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

test('a .damaged file holds the daily files it could have messages in, and no later ones', () => {
  const { chatsDir, outDir } = dirs('dmg');
  for (const d of [13, 14, 15]) put(outDir, `2026-09-${d}.md`, `COMPILED BEFORE THE DAMAGE ${d}`);
  put(outDir, '2026-09-17.md', 'STALE: no message has this day any more');
  put(chatsDir, DAMAGED, '{"messages":[{"at":"2026-09-13T09:00:00Z","text":"cut sh');
  lastWritten(chatsDir, DAMAGED, '2026-09-14T12:00:00Z');
  put(chatsDir, 'direct..p.json', { messages: [row(14, 'fourteen, after the damage'), row(15, 'fifteen'), row(16, 'sixteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.deepEqual(s.unknownFiles, [DAMAGED]);
  assert.deepEqual(s.held, ['2026-09-13', '2026-09-14'], 'the days the damaged file could have messages in');
  assert.equal(day(outDir, 13), 'COMPILED BEFORE THE DAMAGE 13', 'a held day with no readable rows left was pruned or rewritten');
  assert.equal(day(outDir, 14), 'COMPILED BEFORE THE DAMAGE 14', 'a held day was rewritten from the rows that can still be read');
  // later than the damaged file was last written: none of its messages can be there
  assert.deepEqual(s.written, ['2026-09-15', '2026-09-16']);
  assert.match(day(outDir, 15), /fifteen/);
  assert.deepEqual(s.pruned, ['2026-09-17'], 'a stale day after the damaged file\'s last write is still pruned');
});

test('CONTROL for the above: the same folder with no .damaged file rewrites and prunes as it always has', () => {
  const { chatsDir, outDir } = dirs('dmg-ctl');
  for (const d of [13, 14, 15]) put(outDir, `2026-09-${d}.md`, `COMPILED BEFORE ${d}`);
  put(chatsDir, 'direct..p.json', { messages: [row(14, 'fourteen'), row(15, 'fifteen')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(s.held, []);
  assert.deepEqual(s.unknownFiles, []);
  assert.deepEqual(s.written, ['2026-09-14', '2026-09-15']);
  assert.deepEqual(s.pruned, ['2026-09-13']);
  assert.match(day(outDir, 14), /fourteen/);
});

test('a .superseded file that will not parse is held like a damaged one, not skipped as junk', () => {
  const { chatsDir, outDir } = dirs('sup-bad');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, SUPERSEDED, '{"messages":[{"at":"2026-09-13T0');
  lastWritten(chatsDir, SUPERSEDED, '2026-09-13T23:00:00Z');
  put(chatsDir, 'proj1.a.json', { messages: [row(20, 'twenty')] });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(s.unknownFiles, [SUPERSEDED]);
  assert.deepEqual(s.held, ['2026-09-13']);
  assert.deepEqual(s.pruned, []);
  assert.equal(day(outDir, 13), 'COMPILED 13');
  // one that parses but is not a conversation is the same: its messages cannot be known
  put(chatsDir, SUPERSEDED, { notMessages: true });
  lastWritten(chatsDir, SUPERSEDED, '2026-09-13T23:00:00Z');
  assert.deepEqual(dl.compileAll({ chatsDir, outDir, dayOf, timeOf }).held, ['2026-09-13']);
});

test('a thread file that cannot be READ holds every existing daily file: none is rewritten short, none pruned', () => {
  const { chatsDir, outDir } = dirs('readerr');
  put(outDir, '2026-09-14.md', 'COMPILED 14, WITH ROWS FROM BOTH CONVERSATIONS');
  put(outDir, '2026-09-10.md', 'COMPILED 10');
  put(chatsDir, 'direct..ok.json', { messages: [row(14, 'fourteen'), row(21, 'twenty-one')] });
  fs.mkdirSync(path.join(chatsDir, 'direct..unreadable.json'));   // readFileSync throws EISDIR: a read error
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.ok(s.readErrors >= 1);
  assert.deepEqual(s.held, ['2026-09-10', '2026-09-14']);
  assert.equal(day(outDir, 14), 'COMPILED 14, WITH ROWS FROM BOTH CONVERSATIONS', 'a shared day was rewritten without the unreadable conversation');
  assert.deepEqual(s.pruned, []);
  assert.deepEqual(s.written, ['2026-09-21'], 'a day with no daily file yet is still written');
  // a targeted run of a held day leaves it alone too
  const one = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, onlyDay: '2026-09-14' });
  assert.deepEqual([one.written, one.held], [[], ['2026-09-14']]);
  // CONTROL: once the file can be read again, the same run rewrites and prunes
  fs.rmdirSync(path.join(chatsDir, 'direct..unreadable.json'));
  const after = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual([after.held, after.pruned, after.written], [[], ['2026-09-10'], ['2026-09-14', '2026-09-21']]);
  assert.match(day(outDir, 14), /fourteen/);
});

test('a set-aside file that cannot be dated holds every existing daily file', (t) => {
  const { chatsDir, outDir } = dirs('undated');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(outDir, '2026-09-29.md', 'COMPILED 29');
  put(chatsDir, 'direct..p.json', { messages: [row(29, 'twenty-nine'), row(30, 'thirty')] });
  let linked = true;
  try { fs.symlinkSync(path.join(chatsDir, 'no-such-target'), path.join(chatsDir, DAMAGED)); } catch { linked = false; }
  if (!linked) { t.skip('this filesystem or account cannot make a symlink, so there is no undatable file to test'); return; }
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(s.unknownFiles, [DAMAGED]);
  assert.deepEqual(s.held, ['2026-09-13', '2026-09-29']);
  assert.equal(day(outDir, 29), 'COMPILED 29');
  assert.deepEqual(s.written, ['2026-09-30']);
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
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual([s.unknownFiles, s.held, s.pruned], [[], [], ['2026-09-13']]);
  // these are: an agent keyed exactly "json", and a name with nothing between the thread file's name and the kind
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, 'p.json.json.x.damaged', 'junk');
  put(chatsDir, 'direct..p.json.damaged', 'junk');
  for (const n of ['p.json.json.x.damaged', 'direct..p.json.damaged']) lastWritten(chatsDir, n, '2026-09-13T12:00:00Z');
  const s2 = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(s2.unknownFiles, ['direct..p.json.damaged', 'p.json.json.x.damaged']);
  assert.deepEqual(s2.held, ['2026-09-13']);
});

test('a rolled-over conversation still refuses the whole run, whatever else is in the folder (kosmos#5855)', () => {
  const { chatsDir, outDir } = dirs('with-full');
  put(outDir, '2026-09-13.md', 'COMPILED 13');
  put(chatsDir, DAMAGED, 'junk');
  put(chatsDir, SUPERSEDED, { messages: [row(13, 'thirteen')] });
  put(chatsDir, 'direct..p.json.x.full', '{}');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual([s.written, s.pruned, s.held], [[], [], []]);
  assert.equal(day(outDir, 13), 'COMPILED 13');
  // the summary has the same keys refused, held, and plain
  const plain = dl.compileAll({ chatsDir: path.join(SANDBOX, 'no-such-folder'), outDir, dayOf, timeOf });
  assert.deepEqual(Object.keys(s).sort(), Object.keys(plain).sort());
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
  fs.mkdirSync(outDir, { recursive: true });
  put(chatsDir, 'direct..p.json', { messages: [{ at: '2020-03-04T12:00:00Z', text: 'long ago', from: null }] });
  const run = () => spawnSync(process.execPath, [path.join(__dirname, 'dailylog.js')], { env: process.env, encoding: 'utf8' });
  // control: nothing set aside, nothing held, no such line
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout, /left .* as they were/);
  const made = dayFiles(outDir);
  assert.equal(made.length, 1);
  put(chatsDir, DAMAGED, 'junk');   // last written now: later than the 2020 day, so that day is held
  const held = run();
  assert.equal(held.status, 0, held.stderr);
  assert.equal(held.stderr, '');
  assert.ok(held.stdout.includes('dailylog: left 1 daily file(s) already there as they were (' + made[0].slice(0, -3) + '), because 1 file(s) in the chats folder could not be read as conversations and may hold messages from those days\n'), held.stdout);
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
