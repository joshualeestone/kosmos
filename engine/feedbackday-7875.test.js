'use strict';

/* kosmos#7875 item 1: `kosmos feedback day`, the asking agent's own day for its feedback report (engine/feedbackday.js).
   Readers are injected: no live store is read. Dates are built in local time, as feedback.dateKey reads them. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const day = require('./feedbackday');
const fb = require('./feedback');

const DATE = '2026-11-03';
const at = (h, m, d = 3) => new Date(2026, 10, d, h, m).toISOString();

function run(o) {
  return day.digest({ name: 'Dana', date: DATE, listTaskFiles: () => [], readTask: () => [], ...o });
}

test('#7875: today\'s conversation both ways, oldest first, as time, who and the first line', () => {
  const out = run({ readThread: () => [
    { at: at(14, 5), text: 'Second from them', from: null },
    { at: at(9, 30), text: 'Can you check the catalogue?\nMore detail below.', from: null },
    { at: at(9, 32), text: 'On it.', from: 'Dana' },
  ] });
  assert.ok(out.includes('Your conversation with your person today: 2 from them, 1 from you.'), out.join('\n'));
  const i = out.indexOf('  09:30 them: Can you check the catalogue?');
  assert.ok(i > 0, out.join('\n'));
  assert.equal(out[i + 1], '  09:32 you: On it.');
  assert.equal(out[i + 2], '  14:05 them: Second from them');
});

test('#7875: only today counts; another agent\'s message is not "you"', () => {
  const out = run({ readThread: () => [
    { at: at(23, 50, 2), text: 'Yesterday', from: null },
    { at: at(10, 0), text: 'Today', from: 'Eli' },
  ] });
  const text = out.join('\n');
  assert.ok(!text.includes('Yesterday'), text);
  assert.ok(text.includes('10:00 them: Today'), text);   // CONTROL: today's row is shown
});

test('#7875: an unreadable conversation says so, never "nothing today"', () => {
  const out = run({ readThread: () => { throw new Error('unreadable'); } }).join('\n');
  assert.ok(out.includes('Kosmos could not read it on this computer'), out);
  assert.ok(!out.includes('nothing today'), out);
  const empty = run({ readThread: () => [] }).join('\n');
  assert.ok(empty.includes('Your conversation with your person: nothing today.'), empty);   // CONTROL: empty is not unreadable
});

test('#7875: a long day keeps the newest messages and says it was cut', () => {
  const msgs = [];
  for (let i = 0; i < day.MAX_MESSAGES + 5; i++) msgs.push({ at: at(8 + Math.floor(i / 60), i % 60), text: 'm' + i, from: null });
  const out = run({ readThread: () => msgs });
  assert.ok(out.includes('  (the last ' + day.MAX_MESSAGES + ')'), out.join('\n'));
  assert.ok(out.some((l) => l.endsWith(': m' + (day.MAX_MESSAGES + 4))), 'the newest is kept');
  assert.ok(!out.some((l) => l.endsWith(': m0')), 'the oldest is dropped');
});

test('#7875: a long first line is cut to LINE_MAX', () => {
  const line = day.firstLine('x'.repeat(day.LINE_MAX + 50));
  assert.equal(line.length, day.LINE_MAX);
  assert.ok(line.endsWith('...'));
  assert.equal(day.firstLine('\n\n  hello  \nworld'), 'hello');
});

test('#7875: tasks this agent changed today, by number and kinds, never a title; others\' rows and other days left out', () => {
  const rows = {
    'catalog.task-3': [
      { at: at(10, 0), kind: 'assigned', by: 'Dana', title: 'SECRET TITLE' },
      { at: at(11, 0), kind: 'built', by: 'Dana' },
      { at: at(11, 5), kind: 'built', by: 'Dana' },
    ],
    'catalog.task-7': [{ at: at(12, 0), kind: 'built', by: 'Eli' }],
    'launch.task-1': [{ at: at(9, 0, 2), kind: 'created', addedBy: 'Dana', addedVia: 'process' }],
    'launch.task-2': [{ at: at(9, 0), kind: 'created', addedBy: 'Dana', addedVia: 'process' }],
    'launch.task-4': [{ at: at(9, 0), kind: 'created', by: 'Dana' }, { at: at(9, 5), kind: 'said', text: 'x' }],
  };
  const out = run({
    readThread: () => [],
    listTaskFiles: () => ['launch.task-2.jsonl', 'catalog.task-3.jsonl', 'catalog.task-7.jsonl', 'launch.task-1.jsonl', 'launch.task-4.jsonl', 'notes.txt'],
    readTask: (p, n) => rows[p + '.task-' + n] || [],
  });
  const text = out.join('\n');
  assert.ok(text.includes('  catalog #3: assigned, built'), text);
  assert.ok(text.includes('  launch #2: created'), text);
  assert.ok(!text.includes('catalog #7'), 'another agent\'s change is not listed');
  assert.ok(!text.includes('launch #1'), 'yesterday\'s change is not listed');
  assert.ok(!text.includes('launch #4'), 'a created row is the agent\'s by addedBy, never by a `by` it does not carry; a said row names nobody');
  assert.ok(!text.includes('SECRET TITLE'), 'no title');
  assert.ok(text.indexOf('catalog #3') < text.indexOf('launch #2'), 'by project');
});

test('#7875: Kosmos\'s own line and a menu keystroke are not messages', () => {
  const out = run({ readThread: () => [
    { at: at(9, 0), text: 'Paused for today\'s limit', from: 'Dana', kosmos: true },
    { at: at(9, 1), text: '1', from: null, wire: '1' },
    { at: at(9, 2), text: 'Real', from: null },
  ] }).join('\n');
  assert.ok(out.includes('1 from them, 0 from you'), out);
  assert.ok(!out.includes('Paused'), out);
});

test('#7875: the task folder: absent is none, unreadable throws (so the digest says so), today\'s files only', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fday-'));
  try {
    assert.deepEqual(day.listTaskFilesIn(path.join(tmp, 'absent'), DATE, fb.dateKey), []);
    const notDir = path.join(tmp, 'file');
    fs.writeFileSync(notDir, 'a file where the folder should be');   // readdir fails with ENOTDIR, not ENOENT
    assert.throws(() => day.listTaskFilesIn(notDir, DATE, fb.dateKey));
    const dir = path.join(tmp, 'tasks');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'p.task-1.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'p.task-2.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'other.txt'), '');
    const old = new Date(2026, 10, 1, 12, 0);
    fs.utimesSync(path.join(dir, 'p.task-2.jsonl'), old, old);
    const today = fb.dateKey(new Date());
    assert.deepEqual(day.listTaskFilesIn(dir, today, fb.dateKey), ['p.task-1.jsonl']);
    const bad = day.digest({ name: 'Dana', date: DATE, readThread: () => [], listTaskFiles: () => day.listTaskFilesIn(notDir, DATE, fb.dateKey) }).join('\n');
    assert.ok(bad.includes('Kosmos could not read them on this computer'), bad);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#7875: the record name is the token\'s KEY (where the board files its records), the window\'s name without one', () => {
  const env = { X: 1 };
  assert.equal(day.recordName(env, { agentToken: () => 't', resolveName: () => ({ ok: true, name: 'Mara', key: 'mara' }) }), 'mara');
  assert.equal(day.recordName(env, { agentToken: () => 't', resolveName: () => ({ ok: true, name: 'Mara', key: 'mara', twins: true }) }), null);
  assert.equal(day.recordName(env, { agentToken: () => 't', resolveName: () => ({ ok: false }) }), null);
  assert.equal(day.recordName(env, { agentToken: () => null, resolveKeepSender: () => ({ ok: true, name: 'angel' }) }), 'angel');
  assert.equal(day.recordName(env, { agentToken: () => null, resolveKeepSender: () => ({ ok: false }) }), null);
});

test('#7875: no tasks today and unreadable tasks read differently', () => {
  assert.ok(run({ readThread: () => [] }).includes('Tasks you changed today: none.'));
  const bad = run({ readThread: () => [], listTaskFiles: () => { throw new Error('no'); } }).join('\n');
  assert.ok(bad.includes('Tasks you changed today: Kosmos could not read them on this computer.'), bad);
});

test('#7875: the default day is the report\'s own day (feedback.today)', () => {
  const out = day.digest({ name: 'Dana', readThread: () => [], listTaskFiles: () => [], readTask: () => [] });
  assert.ok(out[0].includes(fb.today()), out[0]);
});

test('#7875: the daily ask and the Project Manager\'s instructions both name kosmos feedback day', () => {
  assert.match(require('./feedbacknudge').nudgeText(), /first run `kosmos feedback day`/);
  const pm = JSON.stringify(require('./roles').byKey('pm'));
  assert.match(pm, /kosmos feedback day/);
});

test('#7875: the Windows CLI runs feedback day: refuses nobody, extra words, and prints the asking agent\'s day', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  async function win(argv, recordName) {
    const out = []; const err = [];
    const stub = { recordName: () => recordName, digest: (o) => ['DAY OF ' + o.name] };
    const code = await cli.main(argv, { env: {}, out: (x) => out.push(x), err: (x) => err.push(x), engine: { feedbackday: stub } });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }
  const nobody = await win(['feedback', 'day'], null);
  assert.equal(nobody.code, 1);
  assert.match(nobody.err, /cannot tell which agent is asking/);
  assert.equal(nobody.out, '');
  const extra = await win(['feedback', 'day', 'more'], 'dana');
  assert.equal(extra.code, 2);
  const ok = await win(['feedback', 'day'], 'dana');
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out, 'DAY OF dana');
});

test('#7875: both CLIs carry the day subcommand and list it in their usage', () => {
  const root = path.join(__dirname, '..');
  const sh = fs.readFileSync(path.join(root, 'install', 'kosmos'), 'utf8');
  const win = fs.readFileSync(path.join(root, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  assert.match(sh, /\n {4}day\)\n/);
  assert.match(sh, /day\.recordName\(process\.env\)/);
  assert.match(sh, /day\.digest\(\{ name \}\)/);
  assert.match(sh, /kosmos feedback day {16}\(your own day/);
  assert.match(win, /day: feedbackDay/);
  assert.match(win, /kosmos feedback day {16}\(your own day/);
});
