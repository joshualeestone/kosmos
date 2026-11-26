'use strict';

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
  assert.match(typed[0], new RegExp(' - files report\\.md ' + A + ', data\\.csv ' + B + ' \\(check your copy with'));
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
  const toZed = typed.find((t) => /you checked report\.md$|you checked report\.md /.test(t));
  const toIvy = typed.find((t) => /you checked data\.csv/.test(t));
  assert.ok(toZed && toIvy, JSON.stringify(typed));
  assert.doesNotMatch(toZed, /you checked [^-]*data\.csv/, 'zed was told it checked a file it never did');
  for (const line of typed) assert.match(line, new RegExp('it replaces 2 files sent earlier \\(report\\.md ' + A + ', data\\.csv ' + B + '\\)'));
});

test('#9105: re-sending one file tells only that file\'s checker', async () => {
  const n = tasks.create(projectId, { sentence: 'Deliver two, change one', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: two() });
  await mark(n, asAgent('zed'), { check: ['report.md'], note: 'read the report' });
  await mark(n, asAgent('ivy'), { check: ['data.csv'], note: 'read the data' });
  const { r, typed } = await capture(() => mark(n, asAgent('mona'), { files: [{ name: 'data.csv', fingerprint: D }], note: 'new data' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(told(r), ['ivy'], 'a checker of the unchanged file was told: ' + JSON.stringify(r.json));
  assert.match(typed[0], new RegExp('it replaces the file sent earlier \\(' + B + '\\).*you checked that one'));
  assert.deepEqual(stored(n).builtFiles.find((e) => e.name === 'report.md').checkedBy, ['zed'], 'the unchanged file lost its check');
});

test('#9105: a bad check or bad files is a 400 with the reason, and nothing is stored', async () => {
  const n = tasks.create(projectId, { sentence: 'Refusals', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { files: two() });
  const before = JSON.stringify(stored(n));
  const a = await mark(n, asAgent('zed'), { check: ['nope.txt'] });
  assert.equal(a.status, 400);
  assert.match(a.json.error, /no file named "nope.txt"/);
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
  assert.match(r.json.summary, /the 2 files you sent are withdrawn \(report\.md, data\.csv\)\. To keep them, mark it again with --file and each path\./);
  assert.doesNotMatch(r.json.summary, /["\\]/, 'the CLI sed cannot read a quote or backslash');
});

