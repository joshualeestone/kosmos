'use strict';
/**
 * kosmos#5855: kosmos#5841's rollover. When a conversation rolls over at its message cap, the full file is set aside
 * as `<thread file>.<stamp>.<pid>.<ms>[.<n>].full` and a fresh file carries a copy of its newest rows and names the
 * file it continues. The daily-log compiler does not read that chain. Compiling from the current files alone would rewrite a day that straddles
 * the rollover with fewer rows and prune every day whose rows live only in a `.full` file, so on either sign of a
 * rollover (such a file in the folder, or a current file that names one) the compiler refuses the run: nothing
 * written, nothing pruned, and it says why.
 *
 *   node --test engine/dailylog.rollover-5855.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dailylog-5855-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const dl = require('./dailylog');
const dayOf = (at) => (typeof at === 'string' && at.length >= 10 ? at.slice(0, 10) : null);
const timeOf = (at) => (typeof at === 'string' && at.length >= 16 ? at.slice(11, 16) : '');

const ASIDE = 'direct..p.json.20261011T180000Z.4242.1791741600000.full';
const WHOLE = [
  { at: '2026-09-13T09:00:00Z', text: 'day13 only in the full file', from: null },
  { at: '2026-09-14T09:00:00Z', text: 'day14 only in the full file', from: null },
  { at: '2026-09-15T09:00:00Z', text: 'day15 early, only in the full file', from: null },
  { at: '2026-09-15T10:00:00Z', text: 'day15 late, carried', from: null },
];

/* A conversation compiled whole, then rolled over the way kosmos#5841 does it: the full file aside under `asideName`
   (null: gone from the folder), and a fresh current file carrying a copy of the newest row plus one new message, and
   naming the file it continues unless `opts.names` is false. Returns the dirs and the three day
   files' bytes from before the rollover. */
function rolledOver(label, asideName, opts = {}) {
  const chatsDir = path.join(SANDBOX, 'chats-' + label);
  const outDir = path.join(SANDBOX, 'daily-' + label);
  fs.mkdirSync(chatsDir, { recursive: true });
  const file = path.join(chatsDir, 'direct..p.json');
  fs.writeFileSync(file, JSON.stringify({ messages: WHOLE }));
  const first = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(first.written, ['2026-09-13', '2026-09-14', '2026-09-15'], 'precondition: the whole conversation compiles to three days');
  const before = {};
  for (const d of first.written) before[d] = fs.readFileSync(path.join(outDir, d + '.md'), 'utf8');
  if (asideName) fs.renameSync(file, path.join(chatsDir, asideName)); else fs.rmSync(file);
  const fresh = { messages: [WHOLE[3], { at: '2026-09-16T09:00:00Z', text: 'day16, after the rollover', from: null }] };
  if (opts.names !== false) Object.assign(fresh, { continues: asideName || ASIDE, carried: 1 });
  fs.writeFileSync(file, JSON.stringify(fresh));
  return { chatsDir, outDir, before, file };
}
const dayFiles = (outDir) => fs.readdirSync(outDir).filter((n) => n.endsWith('.md')).sort();

test('isRolledOverFileName: a thread file\'s name, a dot, and .full at the end (chat.js\'s rule for following one)', () => {
  // the last two are names chat.js never writes but WOULD follow, so a renamed or restored file must count here too
  for (const yes of [ASIDE, 'proj1.3-slug.json.20261011T180000Z.1.2.full', 'direct..p.json.20261011T180000Z.4242.1791741600000.2.full', 'direct..p.json.full', 'direct..p.json.x.superseded.full']) {
    assert.equal(dl.isRolledOverFileName(yes), true, yes);
    assert.equal(dl.parseChatFileName(yes), null, yes + ' must not also read as a current conversation file');
  }
  // an agent whose key is exactly "json": its thread file is `<id>.json.json`, so the name ends at the SECOND ".json."
  for (const yes of ['p.json.json.20261011T1.1.1791741600000.full', 'direct..json.json.20261011T1.1.1791741600000.full', 'p.json.json.full']) {
    assert.equal(dl.isRolledOverFileName(yes), true, yes);
  }
  assert.deepEqual(dl.parseChatFileName('p.json.json'), { kind: 'project', projectId: 'p', key: 'json' }, 'precondition: a key of "json" is a real thread file name');
  // not a thread file's name in front (a stray file must not turn the daily log off), or not .full at the end
  for (const no of ['direct..p.json', 'proj1.3-slug.json', 'room-seen.json', 'notes.json.full', 'a.json.full', 'room-seen.json.bak.full', '.direct..p.json.x.full', 'direct..p.jsonfull', 'direct..p.full', 'notes.full', 'direct..p.json.x.superseded', 'direct..p.json.x.damaged', 'direct..p.json.x.fullish', '', null, undefined, 7]) {
    assert.equal(dl.isRolledOverFileName(no), false, String(no));
  }
});

test('CONTROL (the hazard, by proxy): compiled from a current file alone, one day shrinks and two are deleted', () => {
  // BY PROXY: the full file is deleted and the fresh file does not name it, because with the fix in place there is no
  // sign of a rollover this compiler would overlook. What this shows is what compiling from the current file alone
  // does; that a real rollover used to be overlooked is shown by the tests below failing without the fix. It asserts
  // nothing this change added, so it passes on the compiler from before the change too.
  const { chatsDir, outDir, before } = rolledOver('hazard', null, { names: false });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(s.pruned, ['2026-09-13', '2026-09-14'], 'the days that live only in the full file were pruned');
  assert.deepEqual(dayFiles(outDir), ['2026-09-15.md', '2026-09-16.md']);
  const day15 = fs.readFileSync(path.join(outDir, '2026-09-15.md'), 'utf8');
  assert.notEqual(day15, before['2026-09-15'], 'the straddling day was rewritten');
  assert.doesNotMatch(day15, /day15 early/, 'and lost the row that only the full file holds');
});

test('without a rolled-over file the summary says so: not refused, none counted', () => {
  const chatsDir = path.join(SANDBOX, 'chats-plain');
  const outDir = path.join(SANDBOX, 'daily-plain');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.writeFileSync(path.join(chatsDir, 'direct..p.json'), JSON.stringify({ messages: WHOLE }));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.equal(s.rolledOver, 0);
  const missing = dl.compileAll({ chatsDir: path.join(SANDBOX, 'no-such-folder'), outDir, dayOf, timeOf });
  assert.equal(missing.refused, null);
  assert.deepEqual([missing.rolledOver, missing.continued], [0, 0]);
  // readConversations has two returns of its own (the listing failed, the listing worked): the same keys from both
  assert.deepEqual(Object.keys(dl.readConversations(path.join(SANDBOX, 'no-such-folder'))).sort(), Object.keys(dl.readConversations(chatsDir)).sort());
});

test('a FOLDER with such a name is not a rolled-over file (chat.js could not follow it), and does not refuse the run', () => {
  const chatsDir = path.join(SANDBOX, 'chats-folder');
  const outDir = path.join(SANDBOX, 'daily-folder');
  fs.mkdirSync(path.join(chatsDir, 'direct..q.json.a.full'), { recursive: true });
  fs.writeFileSync(path.join(chatsDir, 'direct..p.json'), JSON.stringify({ messages: [WHOLE[0]] }));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.equal(s.rolledOver, 0);
  assert.deepEqual(s.written, ['2026-09-13']);
});

test('with a rolled-over file present the run is refused: nothing written, nothing pruned, every day file as it was', () => {
  const { chatsDir, outDir, before } = rolledOver('refused', ASIDE);
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.equal(s.rolledOver, 1);
  assert.equal(s.continued, 1);
  assert.deepEqual(s.written, []);
  assert.deepEqual(s.pruned, []);
  assert.equal(s.days, 0);
  assert.equal(s.readable, true);
  assert.deepEqual(dayFiles(outDir), ['2026-09-13.md', '2026-09-14.md', '2026-09-15.md'], 'no day removed, and the new day not half-written');
  for (const d of Object.keys(before)) {
    assert.equal(fs.readFileSync(path.join(outDir, d + '.md'), 'utf8'), before[d], d + ' changed');
  }
  // the originals are untouched, the aside included
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(chatsDir, ASIDE), 'utf8')).messages, WHOLE);
});

test('the other sign alone refuses too: a current file that names an earlier file, with no .full file in the folder', () => {
  // a person moved the full file away, or a rollover landed after the folder was listed
  const { chatsDir, outDir, before } = rolledOver('named', null);
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.equal(s.rolledOver, 0);
  assert.equal(s.continued, 1);
  assert.deepEqual(dayFiles(outDir), ['2026-09-13.md', '2026-09-14.md', '2026-09-15.md']);
  for (const d of Object.keys(before)) assert.equal(fs.readFileSync(path.join(outDir, d + '.md'), 'utf8'), before[d], d + ' changed');
  // an empty or non-string `continues` is not a sign (chat.js reads only a non-empty string)
  for (const junk of ['', null, 7, {}]) {
    const c = path.join(SANDBOX, 'chats-junk-' + String(typeof junk) + String(junk).length);
    fs.mkdirSync(c, { recursive: true });
    fs.writeFileSync(path.join(c, 'direct..p.json'), JSON.stringify({ continues: junk, messages: [WHOLE[0]] }));
    assert.equal(dl.compileAll({ chatsDir: c, outDir: path.join(SANDBOX, 'daily-junk'), dayOf, timeOf }).refused, null, 'continues=' + JSON.stringify(junk));
  }
});

test('the states an interrupted rollover can leave are refused too', () => {
  // (1) the rollover hard-links the full file aside and stopped before writing the fresh one: both names, same bytes
  const a = rolledOver('linked', null, { names: false });
  fs.writeFileSync(a.file, JSON.stringify({ messages: WHOLE }));
  // a filesystem that cannot hard-link gets a copy: to this compiler the two are the same state, two names, same bytes
  try { fs.linkSync(a.file, path.join(a.chatsDir, ASIDE)); } catch { fs.copyFileSync(a.file, path.join(a.chatsDir, ASIDE)); }
  const s1 = dl.compileAll({ chatsDir: a.chatsDir, outDir: a.outDir, dayOf, timeOf });
  assert.equal(s1.refused, 'rolled-over');
  assert.deepEqual([s1.rolledOver, s1.continued], [1, 0]);
  assert.deepEqual(dayFiles(a.outDir), ['2026-09-13.md', '2026-09-14.md', '2026-09-15.md']);
  // (2) where it renames instead, and stopped there: the full file aside and NO current file at all
  const b = rolledOver('renamed', ASIDE);
  fs.rmSync(b.file);
  const s2 = dl.compileAll({ chatsDir: b.chatsDir, outDir: b.outDir, dayOf, timeOf });
  assert.equal(s2.refused, 'rolled-over');
  assert.deepEqual([s2.rolledOver, s2.continued, s2.conversations], [1, 0, 0]);
  assert.deepEqual(dayFiles(b.outDir), ['2026-09-13.md', '2026-09-14.md', '2026-09-15.md'], 'an empty-looking folder with a full file in it pruned everything');
});

test('a targeted onlyDay run is refused too: that day may be the one that straddles the rollover', () => {
  const { chatsDir, outDir, before } = rolledOver('onlyday', ASIDE);
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, onlyDay: '2026-09-15' });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual(s.written, []);
  assert.equal(fs.readFileSync(path.join(outDir, '2026-09-15.md'), 'utf8'), before['2026-09-15']);
});

test('one rolled-over conversation refuses the run for every conversation (a day file holds them all)', () => {
  const { chatsDir, outDir } = rolledOver('mixed', ASIDE);
  fs.writeFileSync(path.join(chatsDir, 'proj1.b.json'), JSON.stringify({ messages: [{ at: '2026-09-20T09:00:00Z', text: 'another conversation', from: null }] }));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.equal(s.conversations, 2, 'the current files were still read and counted');
  assert.deepEqual(Object.keys(s).sort(), Object.keys(dl.compileAll({ chatsDir: path.join(SANDBOX, 'no-such-folder'), outDir, dayOf, timeOf })).sort(), 'a refused summary has the same keys as any other');
  assert.ok(!fs.existsSync(path.join(outDir, '2026-09-20.md')));
});

test('the command says why and exits non-zero, so a scheduled run cannot read as "compiled, nothing new"', () => {
  const root = require('./store').ROOT;
  const chatsDir = path.join(root, 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.writeFileSync(path.join(chatsDir, 'direct..p.json'), JSON.stringify({ messages: [WHOLE[3]] }));
  const run = () => spawnSync(process.execPath, [path.join(__dirname, 'dailylog.js')], { env: process.env, encoding: 'utf8' });
  // control: with no rolled-over file the same command compiles and exits 0
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 messages across 1 conversations -> 1 daily file/);
  fs.writeFileSync(path.join(chatsDir, ASIDE), JSON.stringify({ messages: WHOLE }));
  const no = run();
  assert.equal(no.status, 3);
  assert.match(no.stderr, /dailylog: not compiled\. A conversation in the chats folder has its earlier part kept in a separate file/);
  assert.match(no.stderr, /Nothing was written or removed/);
  assert.equal(no.stdout, '', 'a refused run printed a success line');
  // a targeted run, and one into another folder, are refused the same way and create nothing
  const other = path.join(SANDBOX, 'elsewhere');
  const day = spawnSync(process.execPath, [path.join(__dirname, 'dailylog.js'), '--day', '2026-09-15', '--out', other], { env: process.env, encoding: 'utf8' });
  assert.equal(day.status, 3);
  assert.equal(day.stdout, '');
  assert.equal(day.stderr, no.stderr, 'a targeted run was refused in different words');
  assert.ok(!fs.existsSync(other), 'a refused run created its output folder');
  assert.match(no.stderr, /There is nothing to fix in the folder/);
});

test('pin (convention 5): what this compiler takes as the signs of a rollover is what engine/chat.js writes and follows', () => {
  const src = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  // WHERE and HOW an aside is named, for every kind: beside the thread file, the file's own name first, the kind last.
  // This holds before and after the rollover lands (supersede builds every aside), so it is asserted either way.
  assert.ok(src.includes('const stem = `${file}.${stamp}.${process.pid}.${Date.now()}`;'), 'engine/chat.js no longer builds an aside name from the thread file\'s own path: check where rolled-over files live');
  assert.ok(src.includes('let aside = `${stem}.${suffix}`;'), 'engine/chat.js no longer ends an aside name with its kind');
  const kind = /^const ROLL_KIND = '([^']+)';$/m.exec(src);
  if (kind) {
    // the rollover (kosmos#5841 piece 2) is in this tree: its suffix, its rule for following a file, and the field a
    // fresh file names its predecessor in must be the ones this compiler reads
    assert.equal(kind[1], 'full');
    assert.equal(dl.isRolledOverFileName('direct..p.json.x.' + kind[1]), true);
    assert.ok(src.includes("n.startsWith(base + '.') && n.endsWith('.' + ROLL_KIND)"), 'engine/chat.js follows a rolled-over file by a different rule now');
    assert.ok(src.includes("continues: typeof parsed.continues === 'string' && parsed.continues ? parsed.continues : null"), 'engine/chat.js reads `continues` differently now');
    assert.ok(src.includes('continues: path.basename(moved.aside)'), 'engine/chat.js no longer writes the file it rolled over from into `continues`');
    assert.ok(src.includes('...(existing.continues ? { continues: existing.continues } : {}),'), 'engine/chat.js no longer keeps `continues` on a later write');
    assert.ok(src.includes("if (!n.startsWith(base + '.') || !n.endsWith('.' + ROLL_KIND)) continue;"), 'engine/chat.js finds a thread\'s own newest rolled-over file by a different rule now');
  } else {
    // it is not in this tree yet: chat.js must still be refusing at the cap, or this pin has gone blind
    assert.match(src, /this conversation has reached the \$\{MAX_MESSAGES\} messages Kosmos keeps, so we did not add to it/,
      'engine/chat.js neither rolls over under ROLL_KIND nor refuses at the cap: update this pin to the new rollover naming');
  }
});
