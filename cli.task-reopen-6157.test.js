'use strict';

/**
 * #6157: a done task can be put back from the terminal, by an agent, keeping its number and history, and the history
 * says who put it back and why. `kosmos task reopen <project> <n> ["why"]` from both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js) against a real board and the real task engine, plus the route's own rules:
 * the person from the screen, an unnamed caller, a reason that is not text or is too long.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-reopen-6157.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskreopen-cli-'));
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
const taskchat = require('./engine/taskchat');
const taskactphrase = require('./engine/taskactphrase');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Reopens' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));   // kai is NOT on it
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const taskOf = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n);
const isDone = (n) => tasks.progressOf(taskOf(n)).closed;
const reopenedRows = (n) => taskchat.read(projectId, n).filter((r) => r.kind === 'reopened');
/* A done task with some history: made, given to mara, a message, closed. */
function doneTask(sentence) {
  const n = tasks.create(projectId, { sentence, who: 'mara' }).number;
  taskchat.record(projectId, n, { kind: 'said', who: 'mara', text: 'working on it' });
  tasks.close(projectId, n);
  assert.equal(isDone(n), true, 'fixture: the task is done');
  return n;
}
const token = (name) => sendertoken.mint(name).token;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, text: out.join('\n') + err.join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '') {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];

async function post(n, body, headers = {}) {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/reopen`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { code: res.status, text };
}

test('#6157: an agent puts a done task back from either command; it keeps its number and history, and says who and why', async () => {
  for (const [label, run] of BOTH) {
    const n = doneTask('Ship the ' + label + ' build');
    const before = taskchat.read(projectId, n).length;
    const r = await run(['task', 'reopen', projectId, String(n), 'it', 'came', 'back'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('Put task ' + n + ' on ' + projectId + ' back\\. It keeps its number and its history\\.'), label);
    assert.equal(isDone(n), false, label + ': the task is still done');
    assert.equal(taskOf(n).number, n, label + ': the number changed');
    const rows = taskchat.read(projectId, n);
    assert.equal(rows.length, before + 1, label + ': the history was not kept, or more than one line was added');
    assert.ok(rows.some((x) => x.kind === 'said' && x.text === 'working on it'), label + ': the earlier history is gone');
    const last = reopenedRows(n).pop();
    assert.equal(last.by, 'mara', label + ': who put it back is not recorded');
    assert.equal(last.why, 'it came back', label + ': why is not recorded');
    assert.equal(last.person, undefined, label + ': an agent was recorded as the person');
    // And a task that is back can be given again (the refusal the feedback met is gone once it is open).
    assert.equal(tasks.assignPart(projectId, n, 1, 'otto', { via: 'process' }).ok, true, label + ': a reopened task cannot be given');
  }
});

test('#6157: with no reason, the line still names who put it back', async () => {
  for (const [label, run] of BOTH) {
    const n = doneTask('Plain ' + label);
    const r = await run(['task', 'reopen', projectId, String(n)], token('otto'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    const last = reopenedRows(n).pop();
    assert.equal(last.by, 'otto', label);
    assert.equal(last.why, undefined, label + ': an empty reason was recorded');
  }
});

test('#6157: bad forms stop before the board; -- lets a reason start with a dash', async () => {
  for (const [label, run] of BOTH) {
    const n = doneTask('Forms ' + label);
    for (const argv of [['task', 'reopen'], ['task', 'reopen', projectId], ['task', 'reopen', projectId, 'x7'], ['task', 'reopen', projectId, String(n), '--force']]) {
      const r = await run(argv, token('mara'));
      assert.equal(r.code, 2, label + ' ' + argv.join(' ') + ': ' + r.text);
    }
    assert.equal(isDone(n), true, label + ': a refused form reopened the task');
    const ok = await run(['task', 'reopen', projectId, String(n), '--', '--force was wrong'], token('mara'));
    assert.equal(ok.code, 0, label + ': ' + ok.text);
    assert.equal(reopenedRows(n).pop().why, '--force was wrong', label);
  }
});

test('#6157: an agent that is not on the project cannot put its tasks back', async () => {
  for (const [label, run] of BOTH) {
    const n = doneTask('Not yours ' + label);
    const r = await run(['task', 'reopen', projectId, String(n), 'mine now'], token('kai'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.equal(isDone(n), true, label + ': a non-member reopened the task');
    assert.equal(reopenedRows(n).length, 0, label);
  }
});

test('#6157: the route: the person from the screen, an unnamed caller, and a reason that is not text or too long', async () => {
  const screen = doneTask('From the screen');
  assert.equal((await post(screen, undefined, { 'sec-fetch-site': 'same-origin' })).code, 200);
  assert.equal(reopenedRows(screen).pop().person, true, 'the screen was not recorded as the person');
  assert.equal(reopenedRows(screen).pop().by, undefined);

  const anon = doneTask('Unnamed');
  assert.equal((await post(anon, { why: 'no token' })).code, 200);
  const row = reopenedRows(anon).pop();
  assert.equal(row.by, undefined, 'a caller nobody named was recorded as somebody');
  assert.equal(row.person, undefined, 'a caller with no screen headers was recorded as the person');
  assert.equal(row.why, 'no token');

  const notText = doneTask('Not text');
  const bad = await post(notText, { why: 42 });
  assert.equal(bad.code, 400, bad.text);
  assert.equal(isDone(notText), true, 'a refused reason reopened the task');

  const long = doneTask('Too long');
  const tooLong = await post(long, { why: 'x'.repeat(tasks.REOPEN_WHY_MAX + 1) }, { 'x-kosmos-agent-token': token('mara') });
  assert.equal(tooLong.code, 400, tooLong.text);
  assert.match(tooLong.text, /keep the reason to 300 characters or fewer/);
  assert.equal(isDone(long), true, 'a reason over the cap reopened the task');
  assert.equal((await post(long, { why: 'y'.repeat(tasks.REOPEN_WHY_MAX) }, { 'x-kosmos-agent-token': token('mara') })).code, 200, 'a reason AT the cap was refused');
});

test('#6157: putting back a task that is already open records nothing', async () => {
  const n = tasks.create(projectId, { sentence: 'Still open', who: 'mara' }).number;
  assert.equal((await post(n, { why: 'twice' }, { 'x-kosmos-agent-token': token('mara') })).code, 200);
  assert.equal(reopenedRows(n).length, 0, 'an open task got a reopened line');
});

test('#6157: the history says who put it back and why, in the page\'s words and to an agent', () => {
  const names = (sn) => ({ mara: 'Mara' })[sn] || null;
  assert.equal(taskactphrase.phrase({ kind: 'reopened', by: 'mara', why: 'it came back' }, names), 'Mara put it back: it came back');
  assert.equal(taskactphrase.phrase({ kind: 'reopened', person: true }, names), 'You put it back');
  assert.equal(taskactphrase.phrase({ kind: 'reopened', person: true }, names, { forAgent: true }), 'The person put it back');
  assert.equal(taskactphrase.phrase({ kind: 'reopened' }, names), 'Put back', 'an older line, with no one named, changed its words');
});
