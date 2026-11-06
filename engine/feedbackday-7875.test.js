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
  return day.digest({ name: 'Dana', date: DATE, listTaskFiles: () => [], readTask: () => [], isGuide: () => false, replyChannel: () => null, ...o });
}

test('#7875: today\'s conversation both ways, oldest first, as time, who and the first line', () => {
  const out = run({ readThread: () => [
    { at: at(14, 5), text: 'Second from them', from: null },
    { at: at(9, 30), text: 'Can you check the catalogue?\nMore detail below.', from: null },
    { at: at(9, 32), text: 'On it.', from: 'Dana' },
  ] });
  assert.ok(out.includes('Your conversation with your person in Kosmos today: 2 from them, 1 from you.'), out.join('\n'));
  const i = out.indexOf('  09:30 them: Can you check the catalogue?');
  assert.ok(i > 0, out.join('\n'));
  assert.equal(out[i + 1], '  09:32 you: On it.');
  assert.equal(out[i + 2], '  14:05 them: Second from them');
});

test('#7875: only today counts; another agent\'s row is neither you nor your person', () => {
  const out = run({ readThread: () => [
    { at: at(23, 50, 2), text: 'Yesterday', from: null },
    { at: at(10, 0), text: 'From Eli', from: 'Eli' },
    { at: at(10, 1), text: 'Today', from: null },
  ] });
  const text = out.join('\n');
  assert.ok(!text.includes('Yesterday'), text);
  assert.ok(!text.includes('From Eli'), text);
  assert.ok(text.includes('10:01 them: Today'), text);   // CONTROL: today's row from the person is shown
  assert.ok(text.includes('1 from them, 0 from you'), text);
});

test('#7875: an unreadable conversation says so, never "nothing today"', () => {
  const out = run({ readThread: () => { throw new Error('unreadable'); } }).join('\n');
  assert.ok(out.includes('Kosmos could not read it on this computer'), out);
  assert.ok(!out.includes('nothing today'), out);
  const empty = run({ readThread: () => [] }).join('\n');
  assert.ok(empty.includes('Your conversation with your person in Kosmos: nothing today.'), empty);   // CONTROL: empty is not unreadable
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
    'catalog.task-8': [{ at: at(12, 0), kind: 'built', by: 'Dana', person: true }],
    'launch.task-1': [{ at: at(9, 0, 2), kind: 'created', addedBy: 'Dana', addedVia: 'process' }],
    'launch.task-2': [{ at: at(9, 0), kind: 'created', addedBy: 'Dana', addedVia: 'process' }],
    'launch.task-4': [{ at: at(9, 0), kind: 'created', by: 'Dana' }, { at: at(9, 5), kind: 'said', text: 'x' }],
    'launch.task-5': [{ at: at(9, 0), kind: 'created', addedBy: 'Dana', addedVia: 'webhook' }],
  };
  const out = run({
    readThread: () => [],
    listTaskFiles: () => ['launch.task-2.jsonl', 'catalog.task-3.jsonl', 'catalog.task-7.jsonl', 'catalog.task-8.jsonl', 'launch.task-1.jsonl', 'launch.task-4.jsonl', 'launch.task-5.jsonl', 'notes.txt'],
    readTask: (p, n) => rows[p + '.task-' + n] || [],
  });
  const text = out.join('\n');
  assert.ok(text.includes('  catalog #3: assigned, built'), text);
  assert.ok(text.includes('  launch #2: created'), text);
  assert.ok(!text.includes('catalog #7'), 'another agent\'s change is not listed');
  assert.ok(!text.includes('catalog #8'), 'a mark the person made is not the agent\'s, as AGENT_ROW');
  assert.ok(!text.includes('launch #1'), 'yesterday\'s change is not listed');
  assert.ok(!text.includes('launch #5'), 'a webhook labelled like the agent did not create it as the agent');
  assert.ok(!text.includes('launch #4'), 'a created row is the agent\'s by addedBy, never by a `by` it does not carry; a said row names nobody');
  assert.ok(!text.includes('SECRET TITLE'), 'no title');
  assert.ok(text.indexOf('catalog #3') < text.indexOf('launch #2'), 'by project');
});

test('#7875: Kosmos\'s own line is not a message; the person\'s menu answer is', () => {
  const out = run({ readThread: () => [
    { at: at(9, 0), text: 'Paused for today\'s limit', from: 'Dana', kosmos: true },
    { at: at(9, 1), text: 'Yes, go ahead', from: null, wire: '1' },
    { at: at(9, 2), text: 'Real', from: null },
  ] }).join('\n');
  assert.ok(out.includes('2 from them, 0 from you'), out);
  assert.ok(!out.includes('Paused'), out);
  assert.ok(out.includes('09:01 them: Yes, go ahead'), out);
});

test('#7875: the task folder: absent is none, unreadable throws (so the digest says so), today\'s files only', () => {
  const today = fb.dateKey(new Date());   // taken before the files are written, so a run across midnight cannot split
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
    assert.deepEqual(day.listTaskFilesIn(dir, today, fb.dateKey), ['p.task-1.jsonl']);
    fs.chmodSync(path.join(dir, 'p.task-1.jsonl'), 0o000);   // one transcript it cannot open: an error, never "no change"
    if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) assert.throws(() => day.listTaskFilesIn(dir, today, fb.dateKey));
    fs.chmodSync(path.join(dir, 'p.task-1.jsonl'), 0o600);
    const bad = day.digest({ name: 'Dana', date: DATE, readThread: () => [], listTaskFiles: () => day.listTaskFilesIn(notDir, DATE, fb.dateKey) }).join('\n');
    assert.ok(bad.includes('Kosmos could not read them on this computer'), bad);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#7875: who is asking: a token\'s KEY reads the thread and its own spelling also counts on tasks; the window without one', () => {
  const env = { X: 1 };
  // A token whose own spelling is not its key is read under that spelling, never the key (which may be another agent's).
  assert.deepEqual(day.recordWho(env, { agentToken: () => 't', resolveName: () => ({ ok: true, name: 'Mara', key: 'mara' }) }), { name: 'Mara', also: [] });
  assert.deepEqual(day.recordWho(env, { agentToken: () => 't', resolveName: () => ({ ok: true, key: 'mara' }) }), { name: 'mara', also: [] });
  assert.deepEqual(day.recordWho(env, { agentToken: () => 't', resolveName: () => ({ ok: true, name: 'mara', key: 'mara' }) }), { name: 'mara', also: [] });
  assert.equal(day.recordWho(env, { agentToken: () => 't', resolveName: () => ({ ok: true, name: 'Mara', key: 'mara', twins: true }) }), null);
  assert.equal(day.recordWho(env, { agentToken: () => 't', resolveName: () => ({ ok: false }) }), null);
  assert.deepEqual(day.recordWho(env, { agentToken: () => null, resolveKeepSender: () => ({ ok: true, name: 'angel' }) }), { name: 'angel', also: [] });
  // A window name that is not its own key is read exactly (no thread can exist under it), never under the key form,
  // which may be another agent's thread.
  assert.deepEqual(day.recordWho(env, { agentToken: () => null, resolveKeepSender: () => ({ ok: true, name: 'Angel' }) }), { name: 'Angel', also: [] });
  assert.equal(day.recordWho(env, { agentToken: () => null, resolveKeepSender: () => ({ ok: false }) }), null);
});

test('#7875: a name Kosmos keeps no conversation under says so; a file with no words reads as a file', () => {
  const bad = Object.assign(new Error('that is not an agent name we can keep a thread under'), { code: 'BAD_THREAD' });
  const out = run({ readThread: () => { throw bad; } }).join('\n');
  assert.ok(out.includes('Kosmos keeps no conversation under this agent\'s name.'), out);
  assert.ok(!out.includes('could not read it'), out);
  const file = run({ readThread: () => [{ at: at(9, 0), text: '', from: null }] }).join('\n');
  assert.ok(file.includes('09:00 them: (a file, no words)'), file);
});

test('#7875: the digest reminds the agent not to copy names or words into the report', () => {
  assert.match(run({ readThread: () => [] })[1], /Do not copy names, project names, task numbers or your person's words/);
});

test('#7875: the setup guide\'s conversation is never read or printed (what the person pasted stays hidden)', () => {
  let read = false;
  const out = run({ isGuide: () => true, readThread: () => { read = true; return [{ at: at(9, 0), text: 'sk-SECRETKEY', from: null }]; } }).join('\n');
  assert.equal(read, false);
  assert.ok(out.includes('not shown for the setup guide'), out);
  assert.ok(!out.includes('SECRETKEY'), out);
  assert.ok(!out.includes('could not read it'), out);
  const unsure = run({ isGuide: () => { throw new Error('cannot tell'); }, readThread: () => [{ at: at(9, 0), text: 'sk-SECRETKEY', from: null }] }).join('\n');
  assert.ok(!unsure.includes('SECRETKEY'), 'a guide check that cannot tell counts as the guide');
  assert.ok(unsure.includes('could not tell whether you are the setup guide'), unsure);
});

test('#7875: a resend recorded as a copy is not counted twice', () => {
  const out = run({ readThread: () => [
    { at: at(9, 0), text: 'Once', from: null },
    { at: at(9, 1), text: 'Once', from: null, delivery: { state: 'placed', duplicateOf: 'x' } },
  ] }).join('\n');
  assert.ok(out.includes('1 from them, 0 from you'), out);
});

test('#7875: no tasks today and unreadable tasks read differently', () => {
  assert.ok(run({ readThread: () => [] }).includes('Tasks you changed today: none.'));
  const bad = run({ readThread: () => [], listTaskFiles: () => { throw new Error('no'); } }).join('\n');
  assert.ok(bad.includes('Tasks you changed today: Kosmos could not read them on this computer.'), bad);
});

test('#7875: the default day is the report\'s own day (feedback.today)', () => {
  const today = fb.today();
  const out = day.digest({ name: 'Dana', readThread: () => [], listTaskFiles: () => [], readTask: () => [], isGuide: () => false });
  assert.ok(out[0].includes(today), out[0]);
});

test('#7875: the real resolver (no seams): no token and no window is nobody', () => {
  assert.equal(day.recordWho({ PATH: process.env.PATH }), null);
});

test('#7875: the Mac/Linux CLI\'s own day script runs: with nobody identified it refuses with exit 1 and prints nothing', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  const arm = sh.slice(sh.indexOf('\n    day)\n'));
  const body = arm.slice(arm.indexOf('"$NODE" -e \'') + '"$NODE" -e \''.length, arm.indexOf('\' "$KOSMOS_HOME/app"'));
  assert.match(body, /recordWho/);
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', body, path.join(__dirname, '..')],
    { env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /cannot tell which agent is asking, so it prints nobody's day/);
  assert.equal(r.stdout, '');
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
    const env = { MARK: 'this call' };
    const stub = { recordWho: (e) => { assert.equal(e, env, 'the CLI asks with its own environment'); return recordName ? { name: recordName, also: [] } : null; },
      digest: (o) => ['DAY OF ' + o.name] };
    const code = await cli.main(argv, { env, out: (x) => out.push(x), err: (x) => err.push(x), engine: { feedbackday: stub } });
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
  // The Mac arm is checked by its source only: running it needs a staged Kosmos runtime ($NODE, $KOSMOS_HOME/app).
  assert.match(sh, /day\.recordWho\(process\.env\)/);
  assert.match(sh, /day\.digest\(who\)/);
  assert.match(sh, /Try: write \| show \| list \| day \| pull/);
  assert.match(sh, /kosmos feedback day {16}\(your own day/);
  assert.match(win, /day: feedbackDay/);
  assert.match(win, /kosmos feedback day {16}\(your own day/);
});
