'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9105: the built route takes every delivered file (`files`) and the files a checker checks (`check`), tells the
 * checkers of each file a mark replaced, and says a withdrawal of several files to the marker. Adapted from
 * server.filereplace-8307.test.js (whose one-file cases still run there). The store's side:
 * engine/tasks.builtfiles-9105.test.js.
 *
 * Original header, kosmos#8307: a built mark whose file replaces the one kept says so in the line it types (which file it replaces, and
 * that a check of that file no longer counts), and reaches whoever checked the old file. A withdrawal is said to the
 * marker alone, so a withdrawn file sent back says nothing to anyone. The CLI's task list carries what it replaced, never its path; the Tasks view leaves the current path
 * out. A task the person marked built refuses an agent's new file. engine/tasks.filereplace-8307.test.js has the store's
 * side.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builtfiles-9105.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtfiles-9105-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
require('./test-support/faketmux-win').serveOnWindows();   // kosmos#8378: fake tmux's reads on Windows, where its script cannot run
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
  ]).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const a of ['mona', 'zed', 'ivy']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => {
  const m = sendertoken.mint(name);
  assert.equal(m.ok, true, m.because);
  return { 'x-kosmos-agent-token': m.token };
};
const mark = (n, as, body = {}) => post(`/api/project/${projectId}/task/${n}/built`, body, as);
const told = (r) => (r.json.delivered || []).map((d) => d.agent).sort();
const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);
const D = 'sha256:' + 'd'.repeat(64);
const P_REPORT = path.join(SANDBOX, 'report.md');
const P_DATA = path.join(SANDBOX, 'data.csv');
const two = () => [{ name: 'report.md', fingerprint: A, file_path: P_REPORT }, { name: 'data.csv', fingerprint: B, file_path: P_DATA }];
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
async function capture(fn) {
  const chat = require('./engine/chat');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const r = await fn();
    return { r, typed: pastedMessages(sends) };
  } finally {
    chat.resetForTests();
  }
}

/* The typed text, as server.test.js pastedMessages reads it: set-buffer chunks up to each Enter. */
function pastedMessages(calls) {
  const msgs = [];
  let cur = '';
  let has = false;
  for (const a of calls) {
    if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
    else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { msgs.push(cur); cur = ''; has = false; }
  }
  if (has) msgs.push(cur);
  return msgs;
}


test('#9105: a mark with two files stores both, and the line names each with its fingerprint', async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver the report and its data', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Read it', who: 'zed' });
  const { r, typed } = await capture(() => mark(n, asAgent('mona'), { files: two(), fingerprint: A, file_path: P_REPORT, note: 'both' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(stored(n).builtFiles.map((e) => [e.name, e.fingerprint, e.path]), [['report.md', A, P_REPORT], ['data.csv', B, P_DATA]]);
  assert.equal(stored(n).builtFingerprint, A);
  assert.equal(typed.length, 1, JSON.stringify(typed));
  assert.match(typed[0], new RegExp(" - files 'report\\.md' " + A + ", 'data\\.csv' " + B + ' \\(check your copy with'));
  assert.doesNotMatch(typed[0], / - fingerprint /, 'the one-file words were typed as well');
  assert.doesNotMatch(typed[0], new RegExp(SANDBOX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'a file path was typed into a pane');
});

test('#9105: CONTROL: one file still types the one-file words', async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver one file', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Read it', who: 'zed' });
  const { r, typed } = await capture(() => mark(n, asAgent('mona'), { files: [two()[0]], fingerprint: A, file_path: P_REPORT, note: 'one' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(typed[0], new RegExp(' - fingerprint ' + A + ' \\(check your copy'));
  assert.doesNotMatch(typed[0], / - files /);
});

test('#9105: replacing two checked files tells each checker which one it checked', async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver two to replace', who: 'mona' }).number;
  assert.equal((await mark(n, asAgent('mona'), { files: two() })).status, 200);
  assert.equal((await mark(n, asAgent('zed'), { check: ['report.md'], note: 'read the report' })).status, 200);
  assert.equal((await mark(n, asAgent('ivy'), { check: ['data.csv'], note: 'read the data' })).status, 200);
  assert.deepEqual(stored(n).builtFiles.map((e) => e.checkedBy), [['zed'], ['ivy']]);
  const { r, typed } = await capture(() => mark(n, asAgent('mona'), {
    files: [{ name: 'report.md', fingerprint: C }, { name: 'data.csv', fingerprint: D }], note: 'both redone' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(told(r), ['ivy', 'zed']);
  const toZed = typed.find((t) => /you checked 'report\.md'/.test(t));
  const toIvy = typed.find((t) => /you checked 'data\.csv'/.test(t));
  assert.ok(toZed && toIvy, JSON.stringify(typed));
  assert.doesNotMatch(toZed, /you checked [^-]*data\.csv/, 'zed was told it checked a file it never did');
  for (const line of typed) assert.match(line, new RegExp("it replaces 2 files sent earlier \\('report\\.md' " + A + ", 'data\\.csv' " + B + '\\)'));
});

test('#9105: re-sending one file tells only that file\'s checker', async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver two, change one', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: two() });
  await mark(n, asAgent('zed'), { check: ['report.md'], note: 'read the report' });
  await mark(n, asAgent('ivy'), { check: ['data.csv'], note: 'read the data' });
  const { r, typed } = await capture(() => mark(n, asAgent('mona'), { files: [{ name: 'data.csv', fingerprint: D }], note: 'new data' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(told(r), ['ivy'], 'a checker of the unchanged file was told: ' + JSON.stringify(r.json));
  // On a task with several files the one file is named, both as sent and as replaced.
  assert.match(typed[0], new RegExp(" - file 'data\\.csv', fingerprint " + D + ' \\(check your copy'));
  assert.match(typed[0], new RegExp("it replaces 'data\\.csv' as sent earlier \\(" + B + '\\).*you checked that one'));
  assert.deepEqual(stored(n).builtFiles.find((e) => e.name === 'report.md').checkedBy, ['zed'], 'the unchanged file lost its check');
});

test('#9105: a bad check or bad files is a 400 with the reason, and nothing is stored', async () => {
  const n = tasks.create(projectId, { sentence: 'Refusals', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: two() });
  const before = JSON.stringify(stored(n));
  const a = await mark(n, asAgent('zed'), { check: ['nope.txt'] });
  assert.equal(a.status, 400);
  assert.match(a.json.error, /no file named 'nope.txt' is delivered/);
  const b = await mark(n, asAgent('mona'), { files: [{ name: 'x', fingerprint: A }, { name: 'x', fingerprint: B }] });
  assert.equal(b.status, 400);
  assert.match(b.json.error, /two files named/);
  assert.equal(JSON.stringify(stored(n)), before, 'a refused mark changed the task');
});

test('#9105: the sender\'s mark with no file withdraws both, and the answer names them', async () => {
  const n = tasks.create(projectId, { sentence: 'Withdraw two', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: two() });
  const r = await mark(n, asAgent('mona'), { note: 'not ready' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.summary, /the 2 files you sent are withdrawn \('report\.md', 'data\.csv'\)\. To keep them, mark it again with --file and each path\./);
  assert.doesNotMatch(r.json.summary, /["\\]/, 'the CLI sed cannot read a quote or backslash');
});


/* The Mac CLI (install/kosmos), driven as server.builtsha-6330.test.js drives it. */
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const sha = (s) => 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, extra = {}, port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '', ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
const OUT = path.join(SANDBOX, 'out');
fs.mkdirSync(path.join(OUT, 'other'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.md'), 'the report\n');
fs.writeFileSync(path.join(OUT, 'data.csv'), 'a,b\n');
fs.writeFileSync(path.join(OUT, 'other', 'report.md'), 'another report\n');
const macOnly = { skip: process.platform === 'win32' && 'the Mac CLI' };

test('#9105 Mac: --file twice sends both files, each fingerprinted, and prints each', macOnly, async () => {
  const n = tasks.create(projectId, { sentence: 'Mac two files', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  const r = await mac(['task', 'built', projectId, String(n), 'both', '--file', path.join(OUT, 'report.md'), '--file', path.join(OUT, 'data.csv')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(r.code, 0, r.out);
  const real = fs.realpathSync(OUT);
  assert.deepEqual(stored(n).builtFiles.map((e) => [e.name, e.fingerprint, e.path]),
    [['report.md', sha('the report\n'), path.join(real, 'report.md')], ['data.csv', sha('a,b\n'), path.join(real, 'data.csv')]]);
  assert.equal(stored(n).builtNote, 'both');
  assert.ok(r.out.includes('Fingerprint sent: ' + sha('the report\n') + ' for ' + path.join(OUT, 'report.md')), r.out);
  assert.ok(r.out.includes('Fingerprint sent: ' + sha('a,b\n') + ' for ' + path.join(OUT, 'data.csv')), r.out);
  assert.doesNotMatch(r.out, /kept only the first file/, 'a board that keeps both was called older');
});

test('#9105 Mac: --check checks only the file named', macOnly, async () => {
  const n = tasks.create(projectId, { sentence: 'Mac check one', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: two() });
  const r = await mac(['task', 'built', projectId, String(n), 'read the data', '--check', 'data.csv'], { KOSMOS_AGENT_TOKEN: sendertoken.mint('zed').token });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(stored(n).builtFiles.map((e) => e.checkedBy), [[], ['zed']]);
  const bad = await mac(['task', 'built', projectId, String(n), 'x', '--check', 'nope.txt'], { KOSMOS_AGENT_TOKEN: sendertoken.mint('zed').token });
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /no file named 'nope.txt' is delivered on this task/, 'the Mac CLI cut the board\'s sentence: ' + bad.out);
});

test('#9105 Mac: two files of one name, --check with --file, and a bare --check are refused before the board', macOnly, async () => {
  const n = tasks.create(projectId, { sentence: 'Mac refusals', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  const dup = await mac(['task', 'built', projectId, String(n), '--file', path.join(OUT, 'report.md'), '--file', path.join(OUT, 'other', 'report.md')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(dup.code, 2, dup.out);
  assert.match(dup.out, /Two files named report\.md/);
  const mixed = await mac(['task', 'built', projectId, String(n), '--file', path.join(OUT, 'report.md'), '--check', 'report.md'], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(mixed.code, 2, mixed.out);
  assert.match(mixed.out, /takes no --file/);
  const bare = await mac(['task', 'built', projectId, String(n), '--check'], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(bare.code, 2, bare.out);
  assert.match(bare.out, /--check needs the name of a file/);
  assert.equal(stored(n).builtAt, undefined, 'a refused command marked the task');
});

test('#9105 Mac: a board that answers without builtFiles is said to have kept only the first file', macOnly, async () => {
  // A board from before #9105 answers with the task as it stored it, which has no builtFiles; stand in for it here.
  const orig = tasks.setBuilt;
  tasks.setBuilt = (...a) => { const r = orig(...a); if (r && r.task) { const { builtFiles: _f, ...t } = r.task; r.task = t; } return r; };   // eslint-disable-line no-unused-vars
  try {
    const n = tasks.create(projectId, { sentence: 'Mac older board', who: 'mona' }).number;
    const r = await mac(['task', 'built', projectId, String(n), 'both', '--file', path.join(OUT, 'report.md'), '--file', path.join(OUT, 'data.csv')], { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /This Kosmos kept only the first file, .*report\.md: it may be older/);
    // CONTROL: one file to the same board says nothing of the kind.
    const one = await mac(['task', 'built', projectId, String(n), 'one', '--file', path.join(OUT, 'report.md')], { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token });
    assert.equal(one.code, 0, one.out);
    assert.doesNotMatch(one.out, /kept only the first file/);
  } finally {
    tasks.setBuilt = orig;
  }
});

test('#9105 Mac: task show lists each file, its checks and what it replaced; task files checks every file', macOnly, async () => {
  const n = tasks.create(projectId, { sentence: 'Mac reads', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  const r = await mac(['task', 'built', projectId, String(n), 'both', '--file', path.join(OUT, 'report.md'), '--file', path.join(OUT, 'data.csv')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(r.code, 0, r.out);
  assert.equal((await mark(n, asAgent('zed'), { check: ['report.md'], note: 'read it' })).status, 200);
  const show = await mac(['task', 'show', projectId, String(n)], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(show.code, 0, show.out);
  assert.match(show.out, /Delivered files: +2 \(check them again: kosmos task files/);
  assert.match(show.out, new RegExp('File "?report\\.md"?: +' + sha('the report\n') + ', sent by "?mona'));
  assert.match(show.out, new RegExp('File "?data\\.csv"?: +' + sha('a,b\n')));
  assert.match(show.out, /Checked: +by "?zed"? \(marked built after it was sent\)/);
  assert.equal((show.out.match(/Checked:/g) || []).length, 1, 'a check was shown on the file nobody checked: ' + show.out);
  // One file changed on disk since the mark: task files says so for that file and matches the other.
  fs.writeFileSync(path.join(OUT, 'data.csv'), 'a,b,c\n');
  try {
    const files = await mac(['task', 'files', projectId], { KOSMOS_AGENT_TOKEN: tok });
    const mine = files.out.split('\n');
    const at = mine.findIndex((l) => l.includes('#' + n + ' '));
    assert.ok(at >= 0, files.out);
    const block = mine.slice(at + 1, at + 3).join('\n');
    assert.match(block, /matches +.*report\.md/, files.out);
    assert.match(block, /CHANGED since it was marked +.*data\.csv/, files.out);
  } finally {
    fs.writeFileSync(path.join(OUT, 'data.csv'), 'a,b\n');
  }
});

test('#9105 review 1: the line names only the files this mark sent, a second sender\'s one file included', async () => {
  const n = tasks.create(projectId, { sentence: 'Two senders', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Read it', who: 'zed' });
  await mark(n, asAgent('mona'), { files: two() });
  const { r, typed } = await capture(() => mark(n, asAgent('ivy'), { files: [{ name: 'c.md', fingerprint: C }], note: 'mine' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(typed.length >= 1, JSON.stringify(typed));
  for (const line of typed) {
    assert.match(line, new RegExp(" - file 'c\\.md', fingerprint " + C + ' \\(check your copy'), 'the second sender\'s file was not named: ' + line);
    assert.doesNotMatch(line, new RegExp(A + '|' + B), 'a file this mark did not send was named');
  }
  // mona re-sends one of her two: the line names that one alone.
  const again = await capture(() => mark(n, asAgent('mona'), { files: [{ name: 'data.csv', fingerprint: D }], note: 'new data' }));
  for (const line of again.typed) {
    assert.match(line, new RegExp(" - file 'data\\.csv', fingerprint " + D));
    assert.doesNotMatch(line, new RegExp(' - files |' + A), 'files sent earlier were named as sent now: ' + line);
  }
});

test('#9105 review 1 Mac: a quote in a name reaches the board whole; a backslash name goes the older way alone and is refused among several', macOnly, async () => {
  const tok = sendertoken.mint('mona').token;
  const quoted = path.join(OUT, 'say "hi".md');
  fs.writeFileSync(quoted, 'quoted\n');
  const n = tasks.create(projectId, { sentence: 'Mac odd names', who: 'mona' }).number;
  const r = await mac(['task', 'built', projectId, String(n), 'odd', '--file', quoted, '--file', path.join(OUT, 'data.csv')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(stored(n).builtFiles.map((e) => e.name), ['say "hi".md', 'data.csv']);
  const chk = await mac(['task', 'built', projectId, String(n), 'read it', '--check', 'say "hi".md'], { KOSMOS_AGENT_TOKEN: sendertoken.mint('zed').token });
  assert.equal(chk.code, 0, chk.out);
  assert.deepEqual(stored(n).builtFiles[0].checkedBy, ['zed']);
  const slash = path.join(OUT, 'back\\slash.md');
  fs.writeFileSync(slash, 'slash\n');
  const m = tasks.create(projectId, { sentence: 'Mac backslash', who: 'mona' }).number;
  const alone = await mac(['task', 'built', projectId, String(m), 'one', '--file', slash], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(alone.code, 0, alone.out);
  assert.equal(stored(m).builtFingerprint, sha('slash\n'), 'the one backslash file was not kept the older way');
  const among = await mac(['task', 'built', projectId, String(m), 'two', '--file', slash, '--file', path.join(OUT, 'data.csv')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(among.code, 2, among.out);
  assert.match(among.out, /backslash or a control character in it among several files/);
});

test('#9105 review 1 Mac: --check to a board that does not know it is said', macOnly, async () => {
  const orig = tasks.setBuilt;
  tasks.setBuilt = (...a) => { const r = orig(...a); if (r && r.task) { const { builtFiles: _f, ...t } = r.task; r.task = t; } return r; };   // eslint-disable-line no-unused-vars
  try {
    const n = tasks.create(projectId, { sentence: 'Mac older check', who: 'mona' }).number;
    await mark(n, asAgent('mona'), { files: two() });
    const r = await mac(['task', 'built', projectId, String(n), 'read', '--check', 'data.csv'], { KOSMOS_AGENT_TOKEN: sendertoken.mint('zed').token });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /does not know --check, so it counted this as a check of the file it keeps/);
  } finally {
    tasks.setBuilt = orig;
  }
});

test('#9105 review 2 Mac: task list says a multi-file mark has more files; task files counts files; a bad --check names the files', macOnly, async () => {
  const tok = sendertoken.mint('mona').token;
  const n = tasks.create(projectId, { sentence: 'Mac list several', who: 'mona' }).number;
  assert.equal((await mac(['task', 'built', projectId, String(n), 'both', '--file', path.join(OUT, 'report.md'), '--file', path.join(OUT, 'data.csv')], { KOSMOS_AGENT_TOKEN: tok })).code, 0);
  const list = await mac(['task', 'list', projectId], { KOSMOS_AGENT_TOKEN: tok });
  assert.match(list.out, new RegExp('fingerprint ' + sha('the report\n') + ', sent by "?mona"? \\(1 of 2 files: kosmos task show lists them\\)'), list.out);
  const one = tasks.create(projectId, { sentence: 'Mac list one', who: 'mona' }).number;
  assert.equal((await mac(['task', 'built', projectId, String(one), 'one', '--file', path.join(OUT, 'report.md')], { KOSMOS_AGENT_TOKEN: tok })).code, 0);
  const list2 = await mac(['task', 'list', projectId], { KOSMOS_AGENT_TOKEN: tok });
  const rows = list2.out.split('\n');
  const at = rows.findIndex((l) => l.includes('Mac list one'));
  const oneLine = rows.slice(at + 1).find((l) => l.includes('fingerprint ')) || '';
  assert.ok(at >= 0 && oneLine.includes(sha('the report\n')), 'CONTROL: the one-file task\'s own line was not found: ' + list2.out);
  assert.doesNotMatch(oneLine, /of \d+ files/, 'CONTROL: a one-file mark said it had more: ' + oneLine);
  const files = await mac(['task', 'files', projectId], { KOSMOS_AGENT_TOKEN: tok });
  assert.match(files.out, /built tasks? with a delivered file in .* \(\d+ files\): /, files.out);
  const bad = await mac(['task', 'built', projectId, String(one), 'x', '--check', 'nope.md'], { KOSMOS_AGENT_TOKEN: sendertoken.mint('zed').token });
  assert.match(bad.out, /its files: 'report\.md'\)/, bad.out);
});

test('#9105 review 3: the line names at most 5 files, quoted, cut to 80 characters, with no direction override', async () => {
  const n = tasks.create(projectId, { sentence: 'Many files', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Read them', who: 'zed' });
  const files = Array.from({ length: 7 }, (_, i) => ({ name: (i === 0 ? 'x‮' + 'y'.repeat(200) : 'f' + i) + '.md', fingerprint: 'sha256:' + String(i).repeat(64) }));
  const { r, typed } = await capture(() => mark(n, asAgent('mona'), { files, note: 'seven' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const line = typed[0];
  assert.match(line, / and 2 more \(kosmos task show /);
  assert.equal(/‮/.test(line), false, 'a direction override was typed into a pane');
  assert.ok(line.includes("'x" + 'y'.repeat(79) + "'"), 'a long name was not cut to 80: ' + line.slice(0, 300));
  assert.equal((line.match(/sha256:/g) || []).length, 5);
});

test('#9105 review 5: one withdrawal of several files is named; show says none current; an unnamed old file says it may be superseded', async () => {
  const n = tasks.create(projectId, { sentence: 'Withdraw one of several', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: [{ name: 'a.md', fingerprint: A }] });
  await mark(n, asAgent('ivy'), { files: [{ name: 'b.md', fingerprint: B }] });
  const r = await mark(n, asAgent('mona'), { note: 'mine is not ready' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.summary, /This mark sent no file, so 'a\.md', which you sent, is withdrawn; the other files stay\./);
  const tok = sendertoken.mint('mona').token;
  await mark(n, asAgent('ivy'), { note: 'mine too' });
  if (process.platform !== 'win32') {   // kosmos#8378: the Mac CLI (install/kosmos, bash) reads it back; the route checks above run everywhere
    const show = await mac(['task', 'show', projectId, String(n)], { KOSMOS_AGENT_TOKEN: tok });
    assert.match(show.out, /Delivered files: +none current: every file sent was withdrawn/, show.out);
    assert.doesNotMatch(show.out, /check them again/);
  }
  const m = tasks.create(projectId, { sentence: 'Unnamed then named', who: 'mona' }).number;
  tasks.setBuilt(projectId, m, { by: 'mona', fingerprint: A });
  await mark(m, asAgent('mona'), { files: two() });
  if (process.platform !== 'win32') {   // kosmos#8378: the Mac CLI again
    const show2 = await mac(['task', 'show', projectId, String(m)], { KOSMOS_AGENT_TOKEN: tok });
    assert.match(show2.out, /File sent without a name, by an older Kosmos command or with a path Kosmos does not keep \(it may be one of the others, sent again\)/, show2.out);
  }
});

test('#9105 review 5 Mac: a name typed in another case is the name the folder lists', macOnly, async () => {
  const upper = path.join(OUT, 'REPORT.md');
  if (!fs.existsSync(upper)) return;   // a disk that tells case apart: REPORT.md is another file there
  const n = tasks.create(projectId, { sentence: 'Mac case', who: 'mona' }).number;
  const r = await mac(['task', 'built', projectId, String(n), 'case', '--file', upper], { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token });
  assert.equal(r.code, 0, r.out);
  assert.equal(stored(n).builtFiles[0].name, 'report.md');
});

test('#9105 review 6: the line names only the unnamed file this mark sent, not another sender\'s', async () => {
  const n = tasks.create(projectId, { sentence: 'Two unnamed', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Read', who: 'zed' });
  tasks.setBuilt(projectId, n, { by: 'mona', fingerprint: A });
  await mark(n, asAgent('ivy'), { files: [{ name: 'g.md', fingerprint: B }] });
  // A third sender, on an older CLI with no path: its file is a new one without a name, beside mona's.
  const { typed } = await capture(() => mark(n, asAgent('zed'), { fingerprint: C, note: 'old cli' }));
  assert.ok(typed.length >= 1, JSON.stringify(typed));
  for (const line of typed) {
    assert.match(line, / - file without a name, fingerprint /, line);
    assert.doesNotMatch(line, new RegExp(A), 'another file without a name was named as sent now: ' + line);
    assert.match(line, new RegExp(C));
  }
});

test('#9105 review 6 Mac: task files counts a stale list as built without --file, and a withdrawn file as withdrawn', macOnly, async () => {
  const tok = sendertoken.mint('mona').token;
  const p = projects.create({ name: 'Counts' });
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  projects.addAgent(p.id, 'mona', roster);
  const a = tasks.create(p.id, { sentence: 'Stale', who: 'mona' }).number;
  tasks.setBuilt(p.id, a, { by: 'mona', files: [{ name: 'x.md', fingerprint: A }] });
  // An older board's new mark with no file: a new builtAt, the list left behind.
  projects.mutate(p.id, (q) => ({ ...q, tasks: q.tasks.map((t) => { if (t.number !== a) return t; const y = { ...t, builtAt: new Date(Date.now() + 5).toISOString() }; delete y.builtFingerprint; delete y.builtFingerprintBy; delete y.builtCheckedBy; delete y.builtFingerprintAt; return y; }) }));
  const b = tasks.create(p.id, { sentence: 'Withdrawn', who: 'mona' }).number;
  tasks.setBuilt(p.id, b, { by: 'mona', files: [{ name: 'y.md', fingerprint: B }] });
  tasks.setBuilt(p.id, b, { by: 'mona', note: 'not ready' });
  const files = await mac(['task', 'files', p.id], { KOSMOS_AGENT_TOKEN: tok });
  assert.match(files.out, /\(1 built without --file\)\. 1 built with files since withdrawn\./, files.out);
});
