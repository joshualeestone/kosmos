'use strict';
/**
 * kosmos#5855 step 2: the daily-log compiler reads a rolled-over conversation whole. Its earlier rows sit in `.full`
 * files beside the thread file, each named by the file after it (`continues`); when every one can be followed, the
 * conversation compiles as if it had never rolled over, and the run is not refused. When one cannot, the run is
 * refused as before (dailylog.rollover-5855.test.js).
 *
 * Every rollover here is made by engine/chat.js's own writer (appendMessage on a full thread file), in Kosmos's own
 * chats folder inside this test's sandbox, and then moved to a folder of its own, so that a chain one test breaks
 * is not in the folder another test compiles.
 *
 *   tools/run-tests.sh --only engine/dailylog.chain-5855.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dailylog-chain-5855-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const dl = require('./dailylog');
const chat = require('./chat');
const dayOf = (at) => (typeof at === 'string' && at.length >= 10 ? at.slice(0, 10) : null);
const timeOf = (at) => (typeof at === 'string' && at.length >= 16 ? at.slice(11, 16) : '');

const MAX = chat.MAX_MESSAGES;
const BORN = '2026-08-01T00:00:00.000Z';
/* Row i of a conversation: the first 400 on the 13th, the next 300 on the 14th, the rest on the 15th. A rollover
   carries the last 200 rows, so the 15th STRADDLES it: some of its rows only in the full file, some in both. */
const dayFor = (i) => (i < 400 ? '2026-09-13' : i < 700 ? '2026-09-14' : '2026-09-15');
const row = (tag, i, day) => ({
  at: `${day || dayFor(i)}T${String(9 + Math.floor(i / 60) % 10).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
  text: `${tag} message ${i}`, from: null, delivery: { state: chat.DELIVERY.PLACED, because: null },
});

/* A full thread file for (projectId, agent), written as chat.js would have left it, in Kosmos's own chats folder. */
function fullThread(projectId, agent, tag, born = BORN) {
  const file = chat.threadFile(projectId, agent);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const messages = Array.from({ length: MAX }, (_, i) => row(tag, i));
  fs.writeFileSync(file, JSON.stringify({ project: projectId, agent, projectBornAt: born, messages }));
  return file;
}
/* The real rollover: one more message through chat.js's writer. Returns the name of the file it set aside. */
function rollOver(projectId, agent, text, at, born = BORN) {
  const kept = chat.appendMessage(projectId, agent, { text, at, delivery: { state: chat.DELIVERY.PLACED } }, born);
  assert.equal(kept.recorded, true, 'precondition: the writer refused the message: ' + kept.because);
  const now = JSON.parse(fs.readFileSync(chat.threadFile(projectId, agent), 'utf8'));
  assert.ok(now.continues && now.continues.endsWith('.full'), 'precondition: the writer did not roll over');
  return now.continues;
}
/* Move this thread's files (the thread file and everything set aside beside it) into a folder of their own. */
function isolate(label, projectId, agent) {
  const file = chat.threadFile(projectId, agent);
  const base = path.basename(file);
  const chatsDir = path.join(SANDBOX, 'chats-' + label);
  fs.mkdirSync(chatsDir, { recursive: true });
  for (const n of fs.readdirSync(path.dirname(file))) {
    if (n === base || n.startsWith(base + '.')) fs.renameSync(path.join(path.dirname(file), n), path.join(chatsDir, n));
  }
  return { chatsDir, outDir: path.join(SANDBOX, 'daily-' + label), base };
}
const dayFiles = (outDir) => fs.readdirSync(outDir).filter((n) => n.endsWith('.md')).sort();
const readDay = (outDir, d) => fs.readFileSync(path.join(outDir, d + '.md'), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
/* How many times `tag message i` is in the compiled days, for every i in [0, n): a message is whole-line bounded by
   the next character not being a digit. */
function timesEach(outDir, tag, n) {
  const all = dayFiles(outDir).map((f) => fs.readFileSync(path.join(outDir, f), 'utf8')).join('\n');
  const seen = new Map();
  for (const m of all.matchAll(new RegExp(`${tag} message (\\d+)(?!\\d)`, 'g'))) seen.set(Number(m[1]), (seen.get(Number(m[1])) || 0) + 1);
  const wrong = [];
  for (let i = 0; i < n; i += 1) if (seen.get(i) !== 1) wrong.push(`${i}:${seen.get(i) || 0}`);
  return wrong;
}

/* One conversation, compiled whole BEFORE it rolls over, then rolled over by the real writer. */
function rolled(label, agent) {
  fullThread('chain', agent, label);
  const whole = path.join(SANDBOX, 'whole-' + label);
  const first = dl.compileAll({ chatsDir: chat.chatsDir(), outDir: whole, dayOf, timeOf, prune: false });
  assert.equal(first.refused, null, 'precondition: the conversation compiles before it rolls over');
  const before = {};
  for (const d of ['2026-09-13', '2026-09-14', '2026-09-15']) before[d] = readDay(whole, d);
  const aside = rollOver('chain', agent, `${label} after the rollover`, '2026-09-16T09:00:00Z');
  const fromChat = chat.asideChain('chain', agent, true);
  const current = chat.readThread('chain', agent, BORN);
  return { ...isolate(label, 'chain', agent), before, aside, fromChat, current };
}

test('a rolled-over conversation compiles whole: every earlier day as it was before the rollover, and the new day', () => {
  const { chatsDir, outDir, before, aside } = rolled('whole', 'agenta');
  // start from the days as they stood before the rollover, so a wrong prune or a short rewrite would show
  fs.mkdirSync(outDir, { recursive: true });
  for (const d of Object.keys(before)) fs.writeFileSync(path.join(outDir, d + '.md'), before[d]);
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null, 'a chain the writer made was refused');
  assert.deepEqual([s.rolledOver, s.continued], [0, 0]);
  assert.deepEqual(s.chainFiles, [aside], 'the file that was read is named');
  assert.equal(s.messages, MAX + 1, 'every row once: the full file\'s, and the one after it');
  assert.deepEqual(s.pruned, []);
  assert.deepEqual(dayFiles(outDir), ['2026-09-13.md', '2026-09-14.md', '2026-09-15.md', '2026-09-16.md']);
  for (const d of Object.keys(before)) assert.equal(readDay(outDir, d), before[d], d + ' is not what it was before the rollover');
  assert.match(readDay(outDir, '2026-09-16'), /whole after the rollover/);
  assert.deepEqual(timesEach(outDir, 'whole', MAX), [], 'messages not in the days exactly once (index:times)');
  // the originals are untouched
  assert.equal(JSON.parse(fs.readFileSync(path.join(chatsDir, aside), 'utf8')).messages.length, MAX);
});

test('CONTROL: the same folder without the full file is refused, and from the current file alone two days would go', () => {
  const { chatsDir, outDir, before, aside, base } = rolled('control', 'agentb');
  fs.mkdirSync(outDir, { recursive: true });
  for (const d of Object.keys(before)) fs.writeFileSync(path.join(outDir, d + '.md'), before[d]);
  fs.rmSync(path.join(chatsDir, aside));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual(s.continuedFiles, [base]);
  assert.deepEqual(s.chainFiles, []);
  for (const d of Object.keys(before)) assert.equal(readDay(outDir, d), before[d], d + ' changed in a refused run');
  // what the refusal prevents: the current file with its link removed is all a compile would have
  const cur = JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'));
  delete cur.continues; delete cur.carried;
  fs.writeFileSync(path.join(chatsDir, base), JSON.stringify(cur));
  const alone = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.deepEqual(alone.pruned, ['2026-09-13', '2026-09-14']);
  assert.notEqual(readDay(outDir, '2026-09-15'), before['2026-09-15'], 'the straddling day was not rewritten short');
});

test('the chain this compiler follows is the one engine/chat.js follows, and the rows are merged as it merges them', () => {
  const { chatsDir, base, fromChat, current } = rolled('same', 'agentc');
  const parsed = JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'));
  const mine = dl.followChain(chatsDir, base, 'agentc', parsed);
  assert.equal(mine.complete, true);
  assert.equal(fromChat.length, 1, 'precondition: chat.js followed the chain before the files were moved');
  assert.deepEqual(mine.earlier, fromChat);
  const { conversations } = dl.readConversations(chatsDir);
  assert.equal(conversations.length, 1);
  assert.deepEqual(conversations[0].parsed.messages, chat.chainRows(fromChat, current.messages, current.carried));
  assert.equal(conversations[0].parsed.messages.length, MAX + 1);
});

test('followChain never follows a name with a path separator in it, even one that resolves to the real full file', () => {
  const { chatsDir, base, aside } = rolled('sep', 'agentp');
  const parsed = JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'));
  assert.equal(dl.followChain(chatsDir, base, 'agentp', parsed).earlier.length, 1, 'precondition: the name itself is followed');
  fs.mkdirSync(path.join(chatsDir, base + '.d'));
  for (const sep of ['/', '\\']) {
    const sneaky = `${base}.d${sep}..${sep}${aside}`;
    assert.ok(sneaky.startsWith(base + '.') && sneaky.endsWith('.full'), 'precondition: only the separator stops it');
    assert.deepEqual(dl.followChain(chatsDir, base, 'agentp', { ...parsed, continues: sneaky }), { complete: false, earlier: [] }, sneaky);
  }
});

test('two rollovers: both full files are followed, oldest first, and every message is in the days once', () => {
  fullThread('chain', 'agentd', 'twice');
  const firstAside = rollOver('chain', 'agentd', 'twice message ' + MAX, '2026-09-16T09:00:00Z');
  // fill the current file to the limit again (it holds 200 carried rows and one new one), then one more message
  const file = chat.threadFile('chain', 'agentd');
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cur.messages.length, 201);
  for (let i = MAX + 1; cur.messages.length < MAX; i += 1) cur.messages.push(row('twice', i, '2026-09-17'));
  const last = MAX + (MAX - 201);
  fs.writeFileSync(file, JSON.stringify(cur));
  const secondAside = rollOver('chain', 'agentd', 'twice message ' + (last + 1), '2026-09-18T09:00:00Z');
  assert.notEqual(secondAside, firstAside);
  const fromChat = chat.asideChain('chain', 'agentd', true);
  assert.deepEqual(fromChat.map((a) => a.name), [firstAside, secondAside], 'precondition: chat.js follows both, oldest first');
  const { chatsDir, outDir, base } = isolate('twice', 'chain', 'agentd');
  const mine = dl.followChain(chatsDir, base, 'agentd', JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8')));
  assert.deepEqual(mine, { complete: true, earlier: fromChat });
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.deepEqual(s.chainFiles, [firstAside, secondAside].sort());
  assert.equal(s.messages, last + 2, 'rows 0 to ' + (last + 1) + ', each once');
  assert.deepEqual(timesEach(outDir, 'twice', last + 2), [], 'messages not in the days exactly once (index:times)');
});

test('a carried row changed after the rollover is compiled from the newer copy, once', () => {
  const { chatsDir, outDir, base } = rolled('newer', 'agente');
  const cur = JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'));
  assert.equal(cur.messages[0].text, 'newer message ' + (MAX - 200), 'precondition: the first carried row');
  cur.messages[0].text = 'the carried row as the current file has it';
  fs.writeFileSync(path.join(chatsDir, base), JSON.stringify(cur));
  dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  const day = readDay(outDir, '2026-09-15');
  assert.equal(count(day, 'the carried row as the current file has it'), 1);
  assert.doesNotMatch(day, new RegExp(`newer message ${MAX - 200}(?!\\d)`), 'the older copy of that row was compiled too');
});

test('a chain that cannot be followed whole refuses the run, whatever broke it, and no day file changes', async (t) => {
  const breaks = {
    'the full file holds another agent\'s rows': (dir, aside) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, aside), 'utf8'));
      fs.writeFileSync(path.join(dir, aside), JSON.stringify({ ...rec, agent: 'someoneelse' }));
    },
    'the full file belongs to an earlier project of this name': (dir, aside) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, aside), 'utf8'));
      fs.writeFileSync(path.join(dir, aside), JSON.stringify({ ...rec, projectBornAt: '2020-01-01T00:00:00.000Z' }));
    },
    'the full file will not parse': (dir, aside) => {
      fs.writeFileSync(path.join(dir, aside), fs.readFileSync(path.join(dir, aside), 'utf8').slice(0, 500));
    },
    'the full file holds no message list': (dir, aside) => {
      fs.writeFileSync(path.join(dir, aside), JSON.stringify({ agent: 'x', projectBornAt: BORN, messages: 'none' }));
    },
    'the full file names itself': (dir, aside) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, aside), 'utf8'));
      fs.writeFileSync(path.join(dir, aside), JSON.stringify({ ...rec, continues: aside, carried: 0 }));
    },
    'the full file names an earlier one that is not there': (dir, aside, base) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, aside), 'utf8'));
      fs.writeFileSync(path.join(dir, aside), JSON.stringify({ ...rec, continues: base + '.gone.full', carried: 0 }));
    },
    'the full file names an earlier file in an empty string': (dir, aside) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, aside), 'utf8'));
      fs.writeFileSync(path.join(dir, aside), JSON.stringify({ ...rec, continues: '' }));
    },
    'the current file names a file that is not this thread\'s': (dir, aside, base) => {
      const other = 'chain.other.json.x.full';
      fs.renameSync(path.join(dir, aside), path.join(dir, other));
      const cur = JSON.parse(fs.readFileSync(path.join(dir, base), 'utf8'));
      fs.writeFileSync(path.join(dir, base), JSON.stringify({ ...cur, continues: other }));
    },
    'the current file names a path outside the folder': (dir, aside, base) => {
      const cur = JSON.parse(fs.readFileSync(path.join(dir, base), 'utf8'));
      fs.writeFileSync(path.join(dir, base), JSON.stringify({ ...cur, continues: '../' + aside }));
    },
  };
  let n = 0;
  for (const [what, damage] of Object.entries(breaks)) {
    n += 1;
    await t.test(what, () => {
      const { chatsDir, outDir, before, aside, base } = rolled('broken' + n, 'agentf' + n);
      fs.mkdirSync(outDir, { recursive: true });
      for (const d of Object.keys(before)) fs.writeFileSync(path.join(outDir, d + '.md'), before[d]);
      damage(chatsDir, aside, base);
      const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
      assert.equal(s.refused, 'rolled-over');
      assert.deepEqual(s.continuedFiles, [base], 'the thread file whose chain broke is named');
      assert.deepEqual(s.chainFiles, [], 'a file of a broken chain was counted as read');
      assert.deepEqual([s.written, s.pruned], [[], []]);
      assert.deepEqual(dayFiles(outDir), ['2026-09-13.md', '2026-09-14.md', '2026-09-15.md']);
      for (const d of Object.keys(before)) assert.equal(readDay(outDir, d), before[d], d + ' changed');
    });
  }
});

test('a full file no thread file leads to refuses the run, beside a chain that was followed whole', () => {
  const { chatsDir, outDir, aside, base } = rolled('orphan', 'agentg');
  const orphan = base + '.20260101T000000Z.1.1767225600000.full';
  // the followed file's rows but one: a file whose rows were not all read
  const rec = JSON.parse(fs.readFileSync(path.join(chatsDir, aside), 'utf8'));
  fs.writeFileSync(path.join(chatsDir, orphan), JSON.stringify({ ...rec, messages: rec.messages.slice(1) }));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual(s.rolledOverFiles, [orphan], 'only the file that was not reached is listed');
  assert.deepEqual(s.continuedFiles, []);
  assert.deepEqual(s.chainFiles, [aside]);
  assert.ok(!fs.existsSync(outDir), 'a refused run created its output folder');
});

test('a rollover interrupted after the full file was set aside leaves a second name for it, which does not refuse the run', () => {
  // the interruption: the hard link under the aside name exists, the fresh file was never written
  const file = fullThread('chain', 'agentl', 'twin');
  const first = path.basename(file) + '.20260801T000000000Z.999.1791000000000.full';
  fs.linkSync(file, path.join(path.dirname(file), first));
  // the next message: the writer rolls the same full file over again, under a new name
  const second = rollOver('chain', 'agentl', 'twin after the rollover', '2026-09-16T09:00:00Z');
  assert.notEqual(second, first);
  assert.deepEqual(chat.asideChain('chain', 'agentl', true).map((a) => a.name), [second], 'precondition: chat.js follows the second name only');
  const { chatsDir, outDir, base } = isolate('twin', 'chain', 'agentl');
  assert.deepEqual(fs.readdirSync(chatsDir).sort(), [base, first, second].sort(), 'precondition: both names are there');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null, 'a copy of a file that was read refused the run');
  assert.deepEqual(s.chainFiles, [first, second].sort());
  assert.equal(s.messages, MAX + 1, 'the copy\'s rows were compiled a second time');
  assert.deepEqual(timesEach(outDir, 'twin', MAX), []);
  // the same name over another thread's followed file is not a copy of this thread's: still refused
  const other = 'chain.agentz.json.x.full';
  fs.renameSync(path.join(chatsDir, first), path.join(chatsDir, other));
  const no = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(no.refused, 'rolled-over');
  assert.deepEqual(no.rolledOverFiles, [other]);
});

test('an interrupted rollover, then a later project of the same name: the second name for the earlier file does not refuse the run', () => {
  // the interruption: the hard link under the aside name exists, the fresh file was never written
  const file = fullThread('chain', 'agentq', 'again');
  const twin = path.basename(file) + '.20260801T000000000Z.999.1791000000000.full';
  fs.linkSync(file, path.join(path.dirname(file), twin));
  // then the first message of a LATER project: the writer sets the full thread file aside as .superseded
  const later = '2026-10-01T00:00:00.000Z';
  assert.equal(chat.appendMessage('chain', 'agentq', { text: 'later project', at: '2026-10-02T09:00:00Z' }, later).recorded, true);
  const { chatsDir, outDir, base } = isolate('again', 'chain', 'agentq');
  const names = fs.readdirSync(chatsDir);
  assert.deepEqual([names.length, names.filter((n) => n.endsWith('.superseded')).length, names.includes(twin), names.includes(base)], [3, 1, true, true], names.join(' '));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null, 'a second name for a conversation file that was read refused the run');
  assert.deepEqual(s.chainFiles, [twin]);
  assert.equal(s.messages, MAX + 1);
  assert.deepEqual(timesEach(outDir, 'again', MAX), []);
});

test('a full file that was there to follow but not in the folder listing refuses the run', (t) => {
  // a rollover that lands after the folder was listed: the name is in `continues`, the file can be read, and the
  // listing this run took does not have it
  const { chatsDir, outDir, aside, base } = rolled('late', 'agentr');
  const real = fs.readdirSync;
  t.after(() => { fs.readdirSync = real; });
  fs.readdirSync = (dir, ...rest) => {
    const got = real(dir, ...rest);
    return dir === chatsDir ? got.filter((n) => n !== aside) : got;
  };
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  fs.readdirSync = real;
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual([s.continuedFiles, s.rolledOverFiles, s.chainFiles], [[base], [], []]);
});

test('rows that are not messages, and a carried count out of bounds, are read as engine/chat.js reads them', () => {
  // two rollovers, so the second full file carries rows from the first; then things only a hand could put there
  fullThread('chain', 'agents', 'odd');
  const firstAside = rollOver('chain', 'agents', 'odd message ' + MAX, '2026-09-16T09:00:00Z');
  const file = chat.threadFile('chain', 'agents');
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = MAX + 1; cur.messages.length < MAX; i += 1) cur.messages.push(row('odd', i, '2026-09-17'));
  fs.writeFileSync(file, JSON.stringify(cur));
  const secondAside = rollOver('chain', 'agents', 'odd after the second', '2026-09-18T09:00:00Z');
  const dir = path.dirname(file);
  // non-rows at the head of the second full file, inside the rows it carried from the first
  const second = JSON.parse(fs.readFileSync(path.join(dir, secondAside), 'utf8'));
  assert.equal(second.carried, 200, 'precondition');
  second.messages.unshift(null, { text: 7, at: '2026-09-15T09:00:00Z' }, 'a string');
  fs.writeFileSync(path.join(dir, secondAside), JSON.stringify(second));
  const check = (label, carried, expected) => {
    const now = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...now, carried }));
    const fromChat = chat.asideChain('chain', 'agents', true);
    assert.deepEqual(fromChat.map((a) => a.name), [firstAside, secondAside], label + ': precondition, chat.js follows both');
    const thread = chat.readThread('chain', 'agents', BORN);
    const served = chat.chainRows(fromChat, thread.messages, thread.carried);
    const base = path.basename(file);
    assert.deepEqual(dl.followChain(dir, base, 'agents', JSON.parse(fs.readFileSync(file, 'utf8'))).earlier, fromChat, label);
    const mine = dl.readConversations(dir).conversations.find((c) => c.desc.key === 'agents');
    assert.deepEqual(mine.parsed.messages, served, label + ': not the rows engine/chat.js serves');
    assert.equal(served.length, expected, label);
  };
  const all = MAX + (MAX - 200) + 1;   // the first file, the second file's own rows, and the last message
  check('as written', 200, all);
  check('a carried count larger than the file', 5000, all + 200);
  check('a negative carried count', -1, all + 200);
  isolate('odd', 'chain', 'agents');
});

test('a thread file with no project date that rolls over under one compiles whole, as chat.js follows it (kosmos#5900)', () => {
  // The fresh file is stamped with the project's date and the full file has none. Since kosmos#5900 engine/chat.js
  // follows that link, so this compiler does too, by the same rule. The comparison below covers this one shape (a dated
  // current file, one undated full file); the test after it checks the other half of the rule without chat.js.
  const file = chat.threadFile('chain', 'agentm');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ project: 'chain', agent: 'agentm', messages: Array.from({ length: MAX }, (_, i) => row('undated', i)) }));
  rollOver('chain', 'agentm', 'undated after the rollover', '2026-09-16T09:00:00Z');
  const fromChat = chat.asideChain('chain', 'agentm', true);
  assert.equal(fromChat.length, 1, 'precondition: chat.js follows a full file with no project date');
  const { chatsDir, outDir, base } = isolate('undated', 'chain', 'agentm');
  const cur = JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'));
  assert.ok(cur.projectBornAt, 'precondition: the fresh file carries the project date');
  assert.equal(fromChat[0].messages.length, MAX);
  assert.equal(JSON.parse(fs.readFileSync(path.join(chatsDir, fromChat[0].name), 'utf8')).projectBornAt, undefined, 'precondition: the full file has no project date');
  const mine = dl.followChain(chatsDir, base, 'agentm', cur);
  assert.equal(mine.complete, true);
  assert.deepEqual(mine.earlier, fromChat);
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.equal(s.messages, MAX + 1);
  assert.deepEqual(s.chainFiles, [fromChat[0].name]);
});

test('a dated full file behind an undated one is not followed: after the first undated file only undated ones follow', () => {
  // The control for the rule above: the walk may drop the date once, never pick one up again.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-undated-'));
  const base = 'chain.agentp.json';
  const rows = (tag) => [0, 1].map((i) => row(tag, i));
  fs.writeFileSync(path.join(dir, base + '.a.full'), JSON.stringify({ project: 'chain', agent: 'agentp', projectBornAt: BORN, messages: rows('oldest') }));
  fs.writeFileSync(path.join(dir, base + '.b.full'), JSON.stringify({ project: 'chain', agent: 'agentp', continues: base + '.a.full', carried: 0, messages: rows('middle') }));
  const cur = { project: 'chain', agent: 'agentp', projectBornAt: BORN, continues: base + '.b.full', carried: 0, messages: rows('newest') };
  fs.writeFileSync(path.join(dir, base), JSON.stringify(cur));
  try {
    const got = dl.followChain(dir, base, 'agentp', cur);
    assert.equal(got.complete, false);
    assert.deepEqual(got.earlier.map((e) => e.name), [base + '.b.full']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a direct conversation that rolled over compiles whole', () => {
  const file = chat.threadFile(chat.DIRECT, 'agentn');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ project: chat.DIRECT, agent: 'agentn', messages: Array.from({ length: MAX }, (_, i) => row('direct', i)) }));
  const kept = chat.appendMessage(chat.DIRECT, 'agentn', { text: 'direct after the rollover', at: '2026-09-16T09:00:00Z', delivery: { state: chat.DELIVERY.PLACED } });
  assert.equal(kept.recorded, true, kept.because);
  const fromChat = chat.asideChain(chat.DIRECT, 'agentn', true);
  assert.equal(fromChat.length, 1, 'precondition: chat.js follows it');
  const { chatsDir, outDir, base } = isolate('direct', chat.DIRECT, 'agentn');
  assert.equal(base, 'direct..agentn.json');
  assert.deepEqual(dl.followChain(chatsDir, base, 'agentn', JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'))).earlier, fromChat);
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.equal(s.messages, MAX + 1);
  assert.deepEqual(timesEach(outDir, 'direct', MAX), []);
});

test('KNOWN LIMIT: a current file damaged after a rollover is set aside, and the days it shared are written without its rows', () => {
  // The same limit as for any `.damaged` file (kosmos#5866): its rows cannot be read, the prune is limited, and a
  // day it shares with readable rows is written without them. Pinned here because a rollover makes that day likely.
  fullThread('chain', 'agento', 'hurt');
  const aside = rollOver('chain', 'agento', 'hurt message ' + MAX, '2026-09-15T20:00:00Z');
  const say = (i, at) => assert.equal(chat.appendMessage('chain', 'agento', { text: 'hurt message ' + i, at, delivery: { state: chat.DELIVERY.PLACED } }, BORN).recorded, true);
  say(MAX + 1, '2026-09-15T21:00:00Z');
  say(MAX + 2, '2026-09-16T09:00:00Z');
  const file = chat.threadFile('chain', 'agento');
  const outDir = path.join(SANDBOX, 'daily-hurt');
  const whole = dl.compileAll({ chatsDir: chat.chatsDir(), outDir, dayOf, timeOf });
  assert.equal(whole.messages, MAX + 3, 'precondition: compiled whole before the damage');
  const day15 = readDay(outDir, '2026-09-15');
  // the damage, then the next message: the writer sets the file aside as .damaged and continues from the full file
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 300));
  say(MAX + 3, '2026-09-17T09:00:00Z');
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([now.continues, now.carried, now.messages.length], [aside, undefined, 1], 'precondition: relinked to the full file, nothing carried');
  const { chatsDir } = isolate('hurt', 'chain', 'agento');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, now: new Date('2026-09-17T10:00:00Z') });
  assert.equal(s.refused, null);
  assert.equal(s.unknownFiles.length, 1, 'the .damaged file is counted as not read');
  assert.equal(s.messages, MAX + 1, 'the full file\'s rows and the one after the damage');
  assert.deepEqual(timesEach(outDir, 'hurt', MAX), [], 'a row of the full file is missing or doubled');
  assert.deepEqual(s.held, ['2026-09-16'], 'the day only the damaged file held is kept, not pruned');
  assert.deepEqual(s.pruned, []);
  // the limit: the 15th is rewritten from the full file alone, so the two rows only the damaged file held are gone
  assert.notEqual(readDay(outDir, '2026-09-15'), day15);
  assert.doesNotMatch(readDay(outDir, '2026-09-15'), new RegExp(`hurt message ${MAX + 1}(?!\\d)`));
});

test('one full file reached from two conversation files is read for neither: the run is refused', () => {
  const { chatsDir, outDir, aside, base } = rolled('shared', 'agenth');
  // a second file of the same thread that names the same full file: the writer never makes this
  const second = base + '.20260101T000000Z.1.1767225600000.superseded';
  fs.copyFileSync(path.join(chatsDir, base), path.join(chatsDir, second));
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, 'rolled-over');
  assert.deepEqual(s.continuedFiles, [base, second].sort());
  assert.deepEqual(s.rolledOverFiles, [aside]);
  assert.deepEqual(s.chainFiles, []);
});

test('an earlier project\'s conversation that had rolled over is compiled whole under its own heading', () => {
  fullThread('reborn', 'agenti', 'first');
  const aside = rollOver('reborn', 'agenti', 'first project, after its rollover', '2026-09-16T09:00:00Z');
  // a LATER project of the same name: the writer sets the earlier project's thread file aside and starts empty
  const later = '2026-10-01T00:00:00.000Z';
  assert.equal(chat.appendMessage('reborn', 'agenti', { text: 'second project, first message', at: '2026-10-02T09:00:00Z' }, later).recorded, true);
  const { chatsDir, outDir, base } = isolate('reborn', 'reborn', 'agenti');
  const names = fs.readdirSync(chatsDir).sort();
  const superseded = names.filter((n) => n.endsWith('.superseded'));
  assert.deepEqual([superseded.length, names.filter((n) => n.endsWith('.full')).length, names.length], [1, 1, 3], 'precondition: one of each: ' + names.join(' '));
  const live = JSON.parse(fs.readFileSync(path.join(chatsDir, base), 'utf8'));
  assert.equal(live.continues, undefined, 'precondition: the later project does not continue the earlier one\'s file');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf });
  assert.equal(s.refused, null);
  assert.deepEqual(s.chainFiles, [aside]);
  assert.equal(s.conversations, 2);
  assert.equal(s.messages, MAX + 2);
  assert.deepEqual(timesEach(outDir, 'first', MAX), [], 'the earlier project\'s messages not in the days exactly once (index:times)');
  const heading = /^## reborn : agenti \(an earlier project of this name, begun "2026-08-01T00:00:00\.000Z"\)$/m;
  for (const d of ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']) assert.match(readDay(outDir, d), heading, d);
  assert.doesNotMatch(readDay(outDir, '2026-10-02'), /an earlier project/);
  assert.match(readDay(outDir, '2026-10-02'), /second project, first message/);
});

test('a targeted onlyDay run writes the straddling day whole', () => {
  const { chatsDir, outDir, before } = rolled('oneday', 'agentj');
  const s = dl.compileAll({ chatsDir, outDir, dayOf, timeOf, onlyDay: '2026-09-15' });
  assert.equal(s.refused, null);
  assert.deepEqual(s.written, ['2026-09-15']);
  assert.equal(readDay(outDir, '2026-09-15'), before['2026-09-15']);
});

test('the command compiles a rolled-over conversation and exits 0', () => {
  const root = require('./store').ROOT;
  assert.ok(path.resolve(root).startsWith(path.resolve(SANDBOX) + path.sep), 'the data root is not inside this test\'s sandbox: ' + root);
  // every other test moved its files out of Kosmos's own chats folder; this one leaves its rollover there
  assert.deepEqual(fs.readdirSync(chat.chatsDir()).filter((n) => dl.parseChatFileName(n) || dl.isRolledOverFileName(n)), [], 'precondition: the folder is empty of conversations');
  fullThread('chain', 'agentk', 'cli');
  rollOver('chain', 'agentk', 'cli after the rollover', '2026-09-16T09:00:00Z');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'dailylog.js')], { env: process.env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.match(run.stdout, new RegExp(`^dailylog: ${MAX + 1} messages across 1 conversations -> 4 daily file\\(s\\) in `));
});
