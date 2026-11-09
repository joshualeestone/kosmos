'use strict';

/**
 * kosmos#8307: a built mark whose file replaces the one kept says so in the line it types (which file it replaces, and
 * that a check of that file no longer counts), and reaches whoever checked the old file. The CLI's task list carries
 * what it replaced, path included; the Tasks view leaves both paths out. engine/tasks.filereplace-8307.test.js has the
 * store's side.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.filereplace-8307.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filereplace-8307-'));
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
const FILE_A = path.join(SANDBOX, 'deck-v1.pdf');
const FILE_B = path.join(SANDBOX, 'deck-v2.pdf');

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

test('#8307: a replacing mark tells whoever checked the old file, and the line says what it replaces', async () => {
  const chat = require('./engine/chat');
  const n = tasks.create(projectId, { sentence: 'Make the board deck', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Proof the numbers', who: 'zed' });
  const first = await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A, note: 'first cut' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  // ivy is not on the task: only her check of the file brings her in.
  const check = await mark(n, asAgent('ivy'), { note: 'checked the deck' });
  assert.equal(check.status, 200, JSON.stringify(check.json));
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const r = await mark(n, asAgent('mona'), { fingerprint: B, file_path: FILE_B, note: 'rebuilt with the new figures' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), ['ivy', 'zed'], 'the old file\'s checker, or the assignee, was not told: ' + JSON.stringify(r.json));
    const typed = pastedMessages(sends);
    const toIvy = typed.find((t) => /you checked that one/.test(t));
    const toZed = typed.find((t) => !/you checked that one/.test(t));
    assert.ok(toIvy && toZed, 'expected one line each: ' + JSON.stringify(typed));
    for (const line of [toIvy, toZed]) {
      assert.match(line, new RegExp('fingerprint ' + B), 'the new fingerprint is missing');
      assert.match(line, new RegExp('it replaces the file sent earlier \\(' + A + '\\), so a check of that file no longer counts'));
      assert.doesNotMatch(line, /deck-v1|deck-v2/, 'a file path was typed into a pane');
    }
    assert.equal(typed.length, 2, JSON.stringify(typed));
  } finally {
    chat.resetForTests();
  }
});

test('#8307: the same file again says nothing about a replacement and reaches no checker (control)', async () => {
  const chat = require('./engine/chat');
  const n = tasks.create(projectId, { sentence: 'Make the price sheet', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Proof it', who: 'zed' });
  await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A });
  await mark(n, asAgent('ivy'));
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const r = await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A, note: 'sent again' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), ['zed'], 'a checker of the SAME file was told it was replaced: ' + JSON.stringify(r.json));
    const typed = pastedMessages(sends);
    assert.equal(typed.length, 1);
    assert.doesNotMatch(typed[0], /replaces/, 'the same file was called a replacement: ' + typed[0]);
  } finally {
    chat.resetForTests();
  }
});

test('#8307: the CLI\'s task list carries what it replaced, path included; the Tasks view leaves both paths out', async () => {
  const n = tasks.create(projectId, { sentence: 'Make the handout', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A });
  await mark(n, asAgent('zed'));
  await mark(n, asAgent('mona'), { fingerprint: B, file_path: FILE_B });
  const cli = await (await fetch(base + `/api/tasks?project=${projectId}`, { headers: asAgent('mona') })).json();
  const row = cli.tasks.find((t) => t.number === n);
  assert.equal(row.builtFilePath, FILE_B, 'CONTROL: the CLI read still has the current path');
  assert.deepEqual(row.builtReplaces.checkedBy, ['zed']);
  assert.equal(row.builtReplaces.filePath, FILE_A, 'task show cannot name the replaced file\'s path');
  const view = await (await fetch(base + `/api/tasks?view=tasks&project=${projectId}`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
  const vrow = (view.tasks || []).find((t) => t.number === n);
  assert.ok(vrow, 'CONTROL: the Tasks view lists it: ' + JSON.stringify(Object.keys(view)));
  assert.equal('builtFilePath' in vrow, false);
  assert.equal(vrow.builtReplaces.fingerprint, A, 'CONTROL: the view still says what it replaced');
  assert.equal('filePath' in vrow.builtReplaces, false, 'the Tasks view sent the replaced file\'s path');
});
