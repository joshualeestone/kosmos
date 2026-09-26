'use strict';

/**
 * #3951 (review rounds 5 and 7): the built route's valve, in a file of its own so the count is exact. With a cap of
 * three, three process marks that change something go through, a repeat of the same mark goes through and is not
 * counted, the fourth changed mark is refused (429), and the screen is never valved.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.task-built-valve-3951.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-built-valve-'));
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
process.env.AGENT_WORKFORCE_BUILT_MARK_CAP = '3';   // read at require time

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
test.before(async () => {
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Valve' });
  projects.addAgent(p.id, 'mona', roster);
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
const newTask = (s) => tasks.create(projectId, { sentence: s, who: 'mona' }).number;

test('three changed process marks pass, a repeat is not counted, the fourth changed mark is 429, the screen still marks', async () => {
  const mona = sendertoken.mint('mona');
  assert.equal(mona.ok, true, mona.because);
  const as = { 'x-kosmos-agent-token': mona.token };
  const first = newTask('one');
  assert.equal((await post(`/api/project/${projectId}/task/${first}/built`, { note: 'a' }, as)).status, 200);
  /* The same mark three more times: each records nothing and is not counted. */
  for (let i = 0; i < 3; i += 1) {
    const r = await post(`/api/project/${projectId}/task/${first}/built`, { note: 'a' }, as);
    assert.equal(r.status, 200, 'a repeat was refused: ' + JSON.stringify(r.json));
    assert.equal(r.json.changed, false);
  }
  assert.equal((await post(`/api/project/${projectId}/task/${newTask('two')}/built`, {}, as)).status, 200, 'the second changed mark');
  assert.equal((await post(`/api/project/${projectId}/task/${newTask('three')}/built`, {}, as)).status, 200, 'the third changed mark');
  const fourth = newTask('four');
  const refused = await post(`/api/project/${projectId}/task/${fourth}/built`, {}, as);
  assert.equal(refused.status, 429, 'the fourth changed mark went through: ' + JSON.stringify(refused.json));
  assert.equal('builtAt' in tasks.byNumber(projects.readAll().find((x) => x.id === projectId), fourth), false);
  const screen = await post(`/api/project/${projectId}/task/${fourth}/built`, {}, { 'sec-fetch-site': 'same-origin' });
  assert.equal(screen.status, 200, 'the screen was valved');
});
