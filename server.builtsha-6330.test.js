'use strict';

/**
 * #6330 slice 2: a built mark can carry the deliverable's fingerprint (sha256), so the next agent can check its copy
 * is the exact thing delivered. The CLI hashes the file; the board checks the shape, stores it with the mark (a clear
 * drops it), types it in the line slice 1 sends, and the CLIs' task list show it. The person's screen mark sends none.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builtsha-6330.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtsha-'));
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
  const roster = fleet.install(['mona', 'zed', 'ivy'].map((a) => fleet.agent(a, { state: 'idle' }))).agents;
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
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const sha = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
const A = sha('version one'), B = sha('version two');

test('engine: a fingerprint is stored with the mark, a clear drops it, and a bad shape is refused', () => {
  const n = tasks.create(projectId, { sentence: 'Build the export', who: 'mona' }).number;
  const ok = tasks.setBuilt(projectId, n, { by: 'mona', note: 'exported', fingerprint: A });
  assert.equal(ok.ok, true, ok.because);
  assert.equal(stored(n).builtFingerprint, A);
  for (const bad of ['sha256:' + 'A'.repeat(64), 'md5:' + 'a'.repeat(32), 'sha256:' + 'a'.repeat(63), A + ' ', [A], 123, '']) {
    const r = tasks.setBuilt(projectId, n, { by: 'mona', note: 'again', fingerprint: bad });
    assert.equal(r.ok, false, 'a bad shape was stored: ' + bad);
  }
  assert.equal(stored(n).builtFingerprint, A, 'a refused mark changed the stored fingerprint');
  // #7213: a PDF's fingerprint names its kind, and the board keeps it as sent (never relabelled as a plain sha256).
  const P = 'pdf-normalized:' + 'b'.repeat(64);
  for (const bad of ['pdf-normalized:' + 'b'.repeat(63), 'pdf:' + 'b'.repeat(64), 'PDF-normalized:' + 'b'.repeat(64)]) {
    assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'pdf', fingerprint: bad }).ok, false, 'a bad shape was stored: ' + bad);
  }
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'pdf', fingerprint: P }).ok, true);
  assert.equal(stored(n).builtFingerprint, P);
  tasks.setBuilt(projectId, n, { by: 'mona', note: 'exported', fingerprint: A });
  tasks.clearBuilt(projectId, n, { by: 'mona' });
  assert.equal(stored(n).builtFingerprint, undefined, 'a clear left the fingerprint behind');
});

test('engine: a new fingerprint is a new mark; the same one is the same mark (CONTROL)', () => {
  const n = tasks.create(projectId, { sentence: 'Build the import', who: 'mona' }).number;
  tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', fingerprint: A });
  const same = tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', fingerprint: A });
  assert.equal(same.changed, false, 'the same mark again counted as a change');
  const moved = tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', fingerprint: B });
  assert.equal(moved.changed, true, 'a different deliverable was taken as the same mark');
  assert.equal(stored(n).builtFingerprint, B);
  assert.equal(stored(n).builtFingerprintBy, 'mona');
  // The checker's mark carries none and keeps the deliverable's, still credited to its sender (review 3, 5).
  const checked = tasks.setBuilt(projectId, n, { by: 'zed', note: '1 met.' });
  assert.equal(checked.ok, true, checked.because);
  assert.equal(stored(n).builtFingerprint, B, 'the checker\'s mark dropped the deliverable\'s fingerprint');
  assert.equal(stored(n).builtFingerprintBy, 'mona', 'the kept fingerprint was credited to the checker');
  const again = tasks.setBuilt(projectId, n, { by: 'zed', note: '1 met.' });
  assert.equal(again.changed, false, 'the same mark again, with the kept fingerprint, counted as a change');
  // The sender re-marking without one sent a new version without its fingerprint: the old one is dropped (review 5).
  const fixed = tasks.setBuilt(projectId, n, { by: 'mona', note: 'fixed' });
  assert.equal(fixed.ok, true, fixed.because);
  assert.equal(stored(n).builtFingerprint, undefined, 'the sender\'s new mark kept a stale fingerprint');
  assert.equal(stored(n).builtFingerprintBy, undefined);
  // An identical mark sent by another agent is a change: they hashed and sent it (review 6).
  tasks.setBuilt(projectId, n, { by: 'mona', note: 'ok', fingerprint: A });
  tasks.setBuilt(projectId, n, { by: 'zed', note: 'ok' });
  const resent = tasks.setBuilt(projectId, n, { by: 'zed', note: 'ok', fingerprint: A });
  assert.equal(resent.changed, true);
  assert.equal(stored(n).builtFingerprintBy, 'zed');
  const n2 = tasks.create(projectId, { sentence: 'Build the other import', who: 'mona' }).number;
  tasks.setBuilt(projectId, n2, { by: 'mona', note: 'done' });
  assert.equal(stored(n2).builtFingerprint, undefined);
});

test('engine: the person\'s mark keeps an agent\'s fingerprint; an unnamed agent\'s mark drops it, whoever sent it (review 6)', () => {
  const n = tasks.create(projectId, { sentence: 'Build the map', who: 'mona' }).number;
  tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', fingerprint: A });
  tasks.setBuilt(projectId, n, { person: true, note: 'looks right' });
  assert.equal(stored(n).builtFingerprint, A, 'the person\'s mark dropped the agent\'s fingerprint');
  assert.equal(stored(n).builtFingerprintBy, 'mona');
  const n2 = tasks.create(projectId, { sentence: 'Build the key', who: 'mona' }).number;
  tasks.setBuilt(projectId, n2, { by: null, note: 'done', fingerprint: A });
  assert.equal(stored(n2).builtFingerprintBy, null, 'an unnamed sender was credited to someone');
  tasks.setBuilt(projectId, n2, { person: true, note: 'seen' });
  assert.equal(stored(n2).builtFingerprint, A, 'the person\'s mark kept or dropped by whether the sender had a name');
  tasks.setBuilt(projectId, n2, { by: 'zed', note: '1 met.' });
  assert.equal(stored(n2).builtFingerprint, A, 'CONTROL: a named checker keeps an unnamed sender\'s fingerprint');
  tasks.setBuilt(projectId, n2, { by: null, note: 'again' });
  assert.equal(stored(n2).builtFingerprint, undefined, 'an unnamed agent\'s mark kept a fingerprint it may have replaced');
});

test('route: an agent\'s fingerprint is stored; a bad shape is 400 and stores nothing; the screen sends none', async () => {
  const n = tasks.create(projectId, { sentence: 'Ship the report', who: 'mona' }).number;
  const bad = await mark(n, asAgent('mona'), { note: 'shipped', fingerprint: 'sha256:nothex' });
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
  for (const odd of [[A], { a: A }, 7]) {
    const r = await mark(n, asAgent('mona'), { note: 'shipped', fingerprint: odd });
    assert.equal(r.status, 400, 'a fingerprint that is not a string was let through: ' + JSON.stringify(odd));
  }
  assert.equal(stored(n).builtAt, undefined, 'a refused fingerprint still marked the task');
  const ok = await mark(n, asAgent('mona'), { note: 'shipped', fingerprint: A });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(stored(n).builtFingerprint, A);
  const n2 = tasks.create(projectId, { sentence: 'Ship the summary' }).number;
  const screen = await mark(n2, { 'sec-fetch-site': 'same-origin' }, { note: 'by hand', fingerprint: A });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(stored(n2).builtFingerprint, undefined, 'the screen mark stored a fingerprint');
  assert.ok(stored(n2).builtAt, 'CONTROL: the screen mark itself went through');
});

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

test('the line typed to the next agent carries the fingerprint, and a mark without one carries none (CONTROL)', async () => {
  const chat = require('./engine/chat');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const n = tasks.create(projectId, { sentence: 'Build the chart', who: 'mona' }).number;
    tasks.addPart(projectId, n, { sentence: 'Check the chart', who: 'zed' });
    tasks.addPart(projectId, n, { sentence: 'Read the chart', who: 'ivy' });   // someone for the checker's mark to tell
    const r = await mark(n, asAgent('mona'), { note: 'chart ready', fingerprint: A });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const n2 = tasks.create(projectId, { sentence: 'Build the table', who: 'mona' }).number;
    tasks.addPart(projectId, n2, { sentence: 'Check the table', who: 'zed' });
    await mark(n2, asAgent('mona'), { note: 'table ready' });
    // The checker's own mark keeps the fingerprint but does not type it under the checker's name (review 5).
    await mark(n, asAgent('zed'), { note: '1 met.' });
    const typed = pastedMessages(sends);
    const byChecker = typed.find((t) => t.includes('zed marked task ' + n + ' built'));
    assert.ok(byChecker && !byChecker.includes('fingerprint'), 'the checker\'s line typed a fingerprint it did not send: ' + JSON.stringify(typed));
    assert.equal(stored(n).builtFingerprint, A, 'CONTROL: the fingerprint was kept');
    const withPrint = typed.find((t) => t.includes('mona marked task ' + n + ' built'));
    const without = typed.find((t) => t.includes('marked task ' + n2 + ' built'));
    assert.ok(withPrint && withPrint.includes(' - fingerprint ' + A + ' (check your copy with: kosmos fingerprint <file> <this fingerprint>) - reply in the task'), JSON.stringify(typed));
    assert.ok(without && !without.includes('fingerprint'), JSON.stringify(typed));
  } finally {
    chat.resetForTests();
  }
});

const { execFile } = require('node:child_process');
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
// kosmos#6849: --file works the fingerprint out with engine/fileprint.js, so the home carries the engine as an install does.
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, extra = {}, cwd = undefined, home = MAC_HOME) {
  const env = { ...process.env, KOSMOS_HOME: home, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '', ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000, cwd }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `kosmos task built --file` sends the file\'s sha256, and task list shows it', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  // A backslash and a leading dash in the name: shasum escapes the one and reads the other as an option (review 1).
  const dir = path.join(SANDBOX, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '-deliver\\able.txt');
  fs.writeFileSync(file, 'the delivered thing\n');
  const want = sha('the delivered thing\n');
  const n = tasks.create(projectId, { sentence: 'Deliver the file', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  // Named relative to the folder it runs in, so the leading dash reaches the hasher as written (review 5).
  const r = await mac(['task', 'built', projectId, String(n), 'delivered', '--file', path.basename(file)], { KOSMOS_AGENT_TOKEN: tok }, dir);
  assert.equal(r.code, 0, r.out);
  assert.equal(stored(n).builtFingerprint, want, 'the CLI sent another fingerprint: ' + r.out);
  assert.equal(stored(n).builtNote, 'delivered', 'the file path leaked into the note');
  // #6761: the fingerprint sent is printed, whole, with the file named as given.
  assert.ok(r.out.includes('Fingerprint sent: ' + want + ' for ' + path.basename(file)), r.out);
  const list = await mac(['task', 'list', projectId], { KOSMOS_AGENT_TOKEN: tok });
  assert.match(list.out, new RegExp('    fingerprint ' + want + ', sent by mona'), list.out);
});

test('Mac: a missing file, --file with no path, and --file with --clear are refused before the board', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver nothing', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  const missing = await mac(['task', 'built', projectId, String(n), '--file', path.join(SANDBOX, 'no-such-file')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /cannot read that file/);
  const blank = await mac(['task', 'built', projectId, String(n), 'note', '--file', ''], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(blank.code, 2, 'an empty --file marked the task with no fingerprint: ' + blank.out);
  assert.match(blank.out, /cannot read that file/);
  // A file that passes the read check but fails while it is fingerprinted (privacy controls, a disk error) is refused
  // with words, not ended silently by set -e (review 7). Since #6849 the fingerprint is the engine's, so a home whose
  // runtime fails stands in for it.
  const failHome = path.join(SANDBOX, 'failing-home');
  fs.mkdirSync(path.join(failHome, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(failHome, 'runtime', 'bin', 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(failHome, 'engine'));
  const failed = await mac(['task', 'built', projectId, String(n), 'note', '--file', __filename], { KOSMOS_AGENT_TOKEN: tok }, undefined, failHome);
  assert.equal(failed.code, 2, failed.out);
  assert.match(failed.out, /cannot read that file/);
  const empty = await mac(['task', 'built', projectId, String(n), '--file'], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(empty.code, 2, empty.out);
  assert.match(empty.out, /--file needs the path of the delivered file/);   // not the old unknown-option refusal
  const both = await mac(['task', 'built', projectId, String(n), '--clear', '--file', __filename], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(both.code, 2, both.out);
  assert.match(both.out, /takes no file/);
  assert.equal(stored(n).builtAt, undefined, 'a refused command marked the task');
});

test('#6849 Mac: task built --file and kosmos fingerprint give a PDF the fingerprint without its own dates', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const fileprint = require('./engine/fileprint');
  const fix = path.join(__dirname, 'test-support', 'fileprint-6849');
  const a = path.join(fix, 'chrome-a.pdf'), b = path.join(fix, 'chrome-b.pdf');
  const want = fileprint.fingerprint(a);
  const plainA = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
  const plainB = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex');
  assert.ok(want !== plainA && plainA !== plainB, 'CONTROL: the fixtures no longer drift, so this test cannot tell the two fingerprints apart');
  const n = tasks.create(projectId, { sentence: 'Deliver the PDF', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  const r = await mac(['task', 'built', projectId, String(n), 'delivered', '--file', b], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(r.code, 0, r.out);
  assert.equal(stored(n).builtFingerprint, want, 'the second render was sent another fingerprint than the first: ' + r.out);
  const printed = await mac(['fingerprint', a]);
  assert.equal(printed.code, 0, printed.out);
  assert.equal(printed.out.trim(), want);
  const bare = await mac(['fingerprint']);
  assert.equal(bare.code, 2, bare.out);
  assert.match(bare.out, /Usage: kosmos fingerprint <file>/);
  const missing = await mac(['fingerprint', path.join(fix, 'nope.pdf')]);
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /missing \(no such file\)/);
  // #7213: given an approval's plain sha256 it compares the plain bytes and says so; a re-render differs (exit 1).
  assert.match(want, /^pdf-normalized:/, 'a PDF fingerprint must not be labelled sha256:');
  const same = await mac(['fingerprint', a, plainA.slice('sha256:'.length)]);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /matches the plain sha256/);
  const diff = await mac(['fingerprint', b, plainA]);
  assert.equal(diff.code, 1, diff.out);
  assert.match(diff.out, /differs from the plain sha256/);
  const kind = await mac(['fingerprint', b, want]);
  assert.equal(kind.code, 0, kind.out);
  assert.match(kind.out, /matches the PDF fingerprint/);
  assert.equal((await mac(['fingerprint', a, plainA, 'extra'])).code, 2);
});
