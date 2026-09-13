'use strict';

/**
 * The task-message valve (#768): a PROCESS (an agent running `kosmos task message`)
 * is rate-limited so a looping agent cannot spam a task's people; the OPERATOR (the
 * board, which sends the `sec-fetch-site` header) is never limited. Isolated in its
 * own file with a low cap (AGENT_WORKFORCE_TASK_MSG_CAP=2), so the counter and cap do
 * not couple to the other message tests.
 *
 *   node --test server.task-msg-valve-768.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskmsgvalve-'));
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
process.env.AGENT_WORKFORCE_TASK_MSG_CAP = '2';   // read at require time

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const win32job = require('./engine/win32job');

let base;
let projectId;
let taskNum;
test.before(async () => {
  /* On Windows the board asks Task Scheduler whether each agent has a task. This
     fleet is a stub, and a real one may share the account, so the question never
     leaves the process (win32-cli-verbs review round 1: the suite's schtasks guard
     caught `Kosmos\agent-mona` from this file). */
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const a = projects.create({ name: 'Alpha' });
  projects.addAgent(a.id, 'mona', roster);
  const made = tasks.create(a.id, { sentence: 'A task', who: 'mona' }, roster);
  projectId = a.id;
  taskNum = made.number;
});

// A PROCESS post (no sec-fetch-site header, no allowed Origin) is what an agent's CLI
// curl looks like; a SCREEN post carries sec-fetch-site, as a browser does.
const post = async (headers) =>
  fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${taskNum}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ text: 'ping' }),
  });

test('a process is valved after the cap; the operator (screen) never is', async () => {
  // Cap is 2. Two process posts pass, the third is refused 429.
  assert.equal((await post()).status, 200, 'first process message should pass');
  assert.equal((await post()).status, 200, 'second process message should pass');
  assert.equal((await post()).status, 429, 'the third process message should be valved');
  // The operator (a screen post) is exempt even though the process cap is spent.
  assert.equal((await post({ 'sec-fetch-site': 'same-origin' })).status, 200,
    'the operator must never be valved, even after the process cap is spent');
});

test('win32-cli-verbs: a request presenting a VALID agent token is valved even when it also sends Sec-Fetch-Site', async () => {
  /* The cap is spent by the test above. An agent's own token plus a browser header
     must not read as the operator's screen (isViaScreen), or a looping agent could
     skip the valve by adding one header. */
  const minted = sendertoken.mint('mona');
  assert.equal(minted.ok, true, minted.because);
  const r = await post({ 'x-kosmos-agent-token': minted.token, 'sec-fetch-site': 'same-origin', origin: base });
  assert.equal(r.status, 429, 'an agent token with a browser header skipped the task-message valve');
  assert.match((await r.json()).error, /pausing agent task messages/);
});

test.after(() => { win32job.setRunner(null); try { server.close(); } catch { /* already down */ } });
