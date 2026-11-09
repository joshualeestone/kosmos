'use strict';

/**
 * kosmos#8307: a built mark whose file replaces the one kept says so in the line it types (which file it replaces, and
 * that a check of that file no longer counts), and reaches whoever checked the old file. A withdrawal is said to the
 * marker alone, so a withdrawn file sent back says nothing to anyone. The CLI's task list carries what it replaced, never its path; the Tasks view leaves the current path
 * out. A task the person marked built refuses an agent's new file. engine/tasks.filereplace-8307.test.js has the store's
 * side.
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

test('#8307: the CLI\'s task list carries what it replaced, never its path; the Tasks view leaves the current path out', async () => {
  const n = tasks.create(projectId, { sentence: 'Make the handout', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A });
  await mark(n, asAgent('zed'));
  await mark(n, asAgent('mona'), { fingerprint: B, file_path: FILE_B });
  const cli = await (await fetch(base + `/api/tasks?project=${projectId}`, { headers: asAgent('mona') })).json();
  const row = cli.tasks.find((t) => t.number === n);
  assert.equal(row.builtFilePath, FILE_B, 'CONTROL: the CLI read still has the current path');
  assert.deepEqual(row.builtReplaces.checkedBy, ['zed']);
  assert.equal('filePath' in row.builtReplaces, false, 'the CLI\'s list carried the replaced file\'s path (review 4: never stored)');
  const view = await (await fetch(base + `/api/tasks?view=tasks&project=${projectId}`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
  const vrow = (view.tasks || []).find((t) => t.number === n);
  assert.ok(vrow, 'CONTROL: the Tasks view lists it: ' + JSON.stringify(Object.keys(view)));
  assert.equal('builtFilePath' in vrow, false);
  assert.equal(vrow.builtReplaces.fingerprint, A, 'CONTROL: the view still says what it replaced');
  assert.equal('filePath' in vrow.builtReplaces, false, 'the Tasks view sent the replaced file\'s path');
});

test('#8307: withdrawing the file tells only the marker; the next different file tells the checkers, one who left said as not told', async () => {
  const chat = require('./engine/chat');
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
    fleet.agent('gone8307', { state: 'idle' }),
  ]).agents;
  projects.addAgent(projectId, 'gone8307', roster);
  const n = tasks.create(projectId, { sentence: 'Make the one-pager', who: 'mona' }).number;
  await mark(n, asAgent('zed'), { fingerprint: A, file_path: FILE_A });   // zed sends it ...
  await mark(n, asAgent('ivy'));   // ... ivy and gone8307 check it
  await mark(n, asAgent('gone8307'));
  projects.removeAgent(projectId, 'gone8307');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const r = await mark(n, asAgent('zed'), { note: 'pulled it, wrong figures' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), ['mona'], 'a withdrawal reached the checkers: ' + JSON.stringify(r.json));
    assert.match(String(r.json.summary), /This mark sent no file, so the file the task named before is withdrawn\. To keep it, mark it again with --file and its path\./, 'the marker was not told it withdrew the file: ' + r.json.summary);
    assert.doesNotMatch(String(r.json.summary), /["\\]/, 'the summary carries a character the CLI cannot read');
    assert.equal(Object.keys(r.json).pop(), 'summary', 'summary is not the last key, which the CLI reads it as');
    const typed = pastedMessages(sends);
    assert.equal(typed.length, 1, JSON.stringify(typed));
    assert.doesNotMatch(typed[0], /withdrawn|replaces|no longer counts/, 'the assignee\'s line spoke of the file: ' + typed[0]);
    // The next different file reaches the old file's checkers: ivy typed to, gone8307 said as not told.
    sends.length = 0;
    const next = await mark(n, asAgent('zed'), { fingerprint: B, file_path: FILE_B });
    assert.equal(next.status, 200, JSON.stringify(next.json));
    assert.deepEqual(told(next), ['gone8307', 'ivy', 'mona'], JSON.stringify(next.json));
    const gone = next.json.delivered.find((d) => d.agent === 'gone8307');
    assert.match(String(gone.because), /not on this project any more/, 'a checker who left was not said as not told: ' + JSON.stringify(gone));
    const toIvy = pastedMessages(sends).find((t) => /you checked that one/.test(t));
    assert.ok(toIvy, JSON.stringify(pastedMessages(sends)));
    assert.match(toIvy, new RegExp('it replaces the file sent earlier \\(' + A + '\\), so a check of that file no longer counts: you checked that one'));
    // The marker who checked the old file hears nothing about its own mark.
    const self = await mark(n, asAgent('ivy'), { fingerprint: 'sha256:' + 'e'.repeat(64), file_path: FILE_A });
    assert.equal(self.status, 200, JSON.stringify(self.json));
    assert.equal((self.json.delivered || []).some((d) => d.agent === 'ivy'), false, 'the marker was told about its own mark');
    assert.doesNotMatch(String(self.json.summary || ''), /withdrawn/, 'CONTROL: a mark that sent a file was told it withdrew one');
  } finally {
    chat.resetForTests();
  }
});

test('#8307: the page\'s own mark gets the task back without either file path; an agent\'s mark keeps them', async () => {
  const n = tasks.create(projectId, { sentence: 'Make the flyer', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A });
  const agent = await mark(n, asAgent('mona'), { fingerprint: B, file_path: FILE_B });
  assert.equal(agent.json.task.builtFilePath, FILE_B, 'CONTROL: the agent\'s answer keeps the path');
  assert.equal('filePath' in agent.json.task.builtReplaces, false, 'the replaced path reached an answer');
  const screen = await mark(n, { 'sec-fetch-site': 'same-origin' });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(screen.json.changed, true, 'CONTROL: the screen mark changed the task');
  assert.equal('builtFilePath' in screen.json.task, false, 'the page was sent the delivered file\'s path');
  assert.equal(screen.json.task.builtReplaces.fingerprint, A, 'CONTROL: the page still hears what it replaced');
  assert.equal('filePath' in screen.json.task.builtReplaces, false, 'the page was sent the replaced file\'s path');
});

test('#8307: a withdrawn file sent back says nothing to its checker (it was never told it went)', async () => {
  const chat = require('./engine/chat');
  const n = tasks.create(projectId, { sentence: 'Make the agenda', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A });
  await mark(n, asAgent('ivy'));
  await mark(n, asAgent('mona'), { note: 'forgot the file' });
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const r = await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A, note: 'file back' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), [], 'the file sent back reached someone: ' + JSON.stringify(r.json));
    assert.equal(pastedMessages(sends).length, 0);
    const stored = tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
    assert.deepEqual(stored.builtCheckedBy, ['ivy'], 'CONTROL: the check came back with the file');
  } finally {
    chat.resetForTests();
  }
});

test('#8307: once the person marks the task built, an agent cannot replace or withdraw its file (the route refuses)', async () => {
  const n = tasks.create(projectId, { sentence: 'Make the poster', who: 'mona' }).number;
  await mark(n, asAgent('mona'), { fingerprint: A, file_path: FILE_A });
  const screen = await mark(n, { 'sec-fetch-site': 'same-origin' });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  const replace = await mark(n, asAgent('mona'), { fingerprint: B, file_path: FILE_B });
  assert.equal(replace.status, 403, 'an agent replaced a file the person had marked: ' + JSON.stringify(replace.json));
  const withdraw = await mark(n, asAgent('mona'), { note: 'no file' });
  assert.equal(withdraw.status, 403, JSON.stringify(withdraw.json));
  const stored = tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
  assert.equal(stored.builtFingerprint, A, 'the person\'s checked file changed');
  assert.equal(stored.builtCheckedByPerson, true, 'CONTROL: the person\'s mark is recorded as a check of this file');
});
