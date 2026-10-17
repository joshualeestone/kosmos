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
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const a of ['mona', 'zed']) projects.addAgent(p.id, a, roster);
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
  for (const bad of ['sha256:' + 'A'.repeat(64), 'md5:' + 'a'.repeat(32), 'sha256:' + 'a'.repeat(63), A + ' ', [A], 123]) {
    const r = tasks.setBuilt(projectId, n, { by: 'mona', note: 'again', fingerprint: bad });
    assert.equal(r.ok, false, 'a bad shape was stored: ' + bad);
  }
  assert.equal(stored(n).builtFingerprint, A, 'a refused mark changed the stored fingerprint');
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
    const r = await mark(n, asAgent('mona'), { note: 'chart ready', fingerprint: A });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const n2 = tasks.create(projectId, { sentence: 'Build the table', who: 'mona' }).number;
    tasks.addPart(projectId, n2, { sentence: 'Check the table', who: 'zed' });
    await mark(n2, asAgent('mona'), { note: 'table ready' });
    const typed = pastedMessages(sends);
    const withPrint = typed.find((t) => t.includes('marked task ' + n + ' built'));
    const without = typed.find((t) => t.includes('marked task ' + n2 + ' built'));
    assert.ok(withPrint && withPrint.includes(' - fingerprint ' + A + ' - reply in the task'), JSON.stringify(typed));
    assert.ok(without && !without.includes('fingerprint'), JSON.stringify(typed));
  } finally {
    chat.resetForTests();
  }
});

const { execFile } = require('node:child_process');
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '', ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
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
  const r = await mac(['task', 'built', projectId, String(n), 'delivered', '--file', file], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(r.code, 0, r.out);
  assert.equal(stored(n).builtFingerprint, want, 'the CLI sent another fingerprint: ' + r.out);
  assert.equal(stored(n).builtNote, 'delivered', 'the file path leaked into the note');
  const list = await mac(['task', 'list', projectId], { KOSMOS_AGENT_TOKEN: tok });
  assert.match(list.out, new RegExp('    fingerprint ' + want), list.out);
});

test('Mac: a missing file, --file with no path, and --file with --clear are refused before the board', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver nothing', who: 'mona' }).number;
  const tok = sendertoken.mint('mona').token;
  const missing = await mac(['task', 'built', projectId, String(n), '--file', path.join(SANDBOX, 'no-such-file')], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /cannot read that file/);
  const blank = await mac(['task', 'built', projectId, String(n), 'note', '--file', ''], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(blank.code, 2, 'an empty --file marked the task with no fingerprint: ' + blank.out);
  const empty = await mac(['task', 'built', projectId, String(n), '--file'], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(empty.code, 2, empty.out);
  assert.match(empty.out, /--file needs the path of the delivered file/);   // not the old unknown-option refusal
  const both = await mac(['task', 'built', projectId, String(n), '--clear', '--file', __filename], { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(both.code, 2, both.out);
  assert.match(both.out, /takes no file/);
  assert.equal(stored(n).builtAt, undefined, 'a refused command marked the task');
});
