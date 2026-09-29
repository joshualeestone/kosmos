'use strict';
/**
 * #4581: GET /api/projects/overview and GET /api/project/<id>/overview, which `kosmos project list` and
 * `kosmos project show` print. Pins: each member's model family, the brief's goal and "done" as written,
 * each member's summary freshness (current / older than the rhythm / none), the task counts, an exact id
 * lookup, and that an agent reaches both with ONLY its own token (#4491) while the page's /api/projects
 * stays board-token only (CONTROL: this change opened the two new reads and nothing else).
 *
 * Harness: server.agent-token-gate-4491.test.js's (a fully sandboxed board, enforcement flipped on in memory).
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-projectview-4581-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const create = require('./engine/create');

const BOARD = 'BOARDTOKEN_test_4581_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
const CODEX_IDLE = '› Ask Codex to do anything\n  gpt-5.6-sol default · ~/projects/ff';
const FOLDER = path.join(SANDBOX, 'five-families');
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const minted = sendertoken.mint('mark');
  assert.ok(minted.ok, 'could not mint an agent token: ' + minted.because);
  agentToken = minted.token;
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(path.join(FOLDER, 'BRIEF.md'), projectsEngine.briefStubContent({ name: 'Five Families', description: 'Ask one agent per model family how to make Kosmos better.' })
    .replace('_How will everyone know this is finished? Replace this line._', 'A combined ranking Josh has read.'));
  /* mark wrote a summary 30 minutes ago; sam's newest is 6 hours old; nobody else has one. */
  const now = Date.now();
  for (const [who, ageMin, name] of [['mark', 30, '2026-09-29-11.md'], ['sam', 360, '2026-09-29-05.md']]) {
    const dir = path.join(create.workerDir(who), 'summaries');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, 'what moved\n');
    const t = new Date(now - ageMin * 60000);
    fs.utimesSync(f, t, t);
  }
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(p, headers) {
  const res = await fetch(base + p, { headers: { ...(headers || {}) }, redirect: 'manual' });
  const text = await res.text().catch(() => '');
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, text, json };
}
const asAgent = () => ({ 'x-kosmos-agent-token': agentToken });
const asBoard = () => ({ 'x-kosmos-board-token': BOARD });

function withProject(t) {
  const board = fleet.install([
    fleet.agent('mark', { state: 'idle' }),
    fleet.agent('sam', { state: 'idle', runner: 'codex', command: 'node', screen: CODEX_IDLE }),
    fleet.agent('stranger', { state: 'idle' }),
  ]);
  /* A real record in the sandboxed store: projects.list reads the store directly, so a stubbed export
     would never reach the route. Restored after each test. */
  const before = projectsEngine.readAll();
  projectsEngine.writeAll([
    { id: 'ff', name: 'Five Families', folder: FOLDER, agents: ['mark', 'sam', 'ghost'],
      tasks: [{ number: 1, sentence: 'rank', state: 'open' }, { number: 2, sentence: 'draft', state: 'closed', closedAt: '2026-09-29T15:00:00Z' }] },
    { id: 'quiet', name: 'Quiet one', folder: path.join(SANDBOX, 'nowhere'), agents: [], tasks: [] },
  ]);
  t.after(() => { projectsEngine.writeAll(before); board.restore(); });
}

test('CONTROL: with no credential, both new reads are refused at the gate', async () => {
  for (const p of ['/api/projects/overview', '/api/project/ff/overview']) {
    const r = await call(p);
    assert.ok(r.code === 403 && GATE_REFUSAL.test(r.text), p + ' was not refused: ' + r.code);
  }
});

test('CONTROL: the agent token did not open the page\'s own /api/projects (only the two new reads)', async () => {
  const r = await call('/api/projects', asAgent());
  assert.ok(r.code === 403 && GATE_REFUSAL.test(r.text), 'an agent token now reads /api/projects: ' + r.code);
});

test('#4581 list: every project, members, families, tasks, with only the agent\'s own token', async (t) => {
  withProject(t);
  const r = await call('/api/projects/overview', asAgent());
  assert.equal(r.code, 200, r.text);
  const ff = r.json.projects.find((p) => p.id === 'ff');
  assert.ok(ff, r.text);
  assert.equal(ff.members, 3);
  assert.deepEqual(ff.families.slice().sort(), ['Claude', 'OpenAI']);
  assert.equal(ff.tasks.total, 2);
  assert.ok(r.json.projects.find((p) => p.id === 'quiet'), 'a project with nobody on it is listed too');
  assert.equal((await call('/api/projects/overview', asBoard())).code, 200, 'the board token reads it too');
});

test('#4581 show: folder, goal and done as written, tasks, and each member\'s family and summary', async (t) => {
  withProject(t);
  const r = await call('/api/project/ff/overview', asAgent());
  assert.equal(r.code, 200, r.text);
  const p = r.json.project;
  assert.equal(p.folder, FOLDER);
  assert.equal(p.goal, 'Ask one agent per model family how to make Kosmos better.');
  assert.equal(p.done, 'A combined ranking Josh has read.');
  assert.equal(p.briefFound, true);
  assert.deepEqual({ open: p.tasks.open, total: p.tasks.total }, { open: 1, total: 2 });
  const by = Object.fromEntries(p.members.map((m) => [m.sessionName, m]));
  assert.equal(by.mark.family, 'Claude');
  assert.equal(by.sam.family, 'OpenAI');
  assert.equal(by.mark.summary.state, 'current', JSON.stringify(by.mark.summary));
  assert.equal(by.mark.summary.file, 'summaries/2026-09-29-11.md');
  assert.equal(by.sam.summary.state, 'stale', JSON.stringify(by.sam.summary));
  assert.ok(by.sam.summary.ageMinutes >= 359, JSON.stringify(by.sam.summary));
  assert.equal(by.ghost.present, false, 'a member that is not running is said so');
  assert.equal(by.ghost.family, null);
  assert.equal(by.ghost.summary.state, 'none');
});

test('#4581 show: an id is looked up exactly; a garbled or unknown one names no project', async (t) => {
  withProject(t);
  for (const id of ['nope', 'ff!!!', 'FF', encodeURIComponent('ff/x')]) {
    const r = await call('/api/project/' + id + '/overview', asAgent());
    assert.equal(r.code, 404, id + ': ' + r.code + ' ' + r.text);
    assert.match(r.text, /there is no project by that name/);
  }
});

test('#4581 show: a folder with no brief says so, rather than "not filled in"', async (t) => {
  withProject(t);
  const r = await call('/api/project/quiet/overview', asAgent());
  assert.equal(r.code, 200, r.text);
  assert.equal(r.json.project.briefFound, false);
  assert.equal(r.json.project.goal, null);
  assert.deepEqual(r.json.project.members, []);
});

test('round 1: the reads are GET only, so a HEAD cannot answer differently from the gate', async (t) => {
  withProject(t);
  const res = await fetch(base + '/api/projects/overview', { method: 'HEAD', headers: asBoard() });
  assert.notEqual(res.status, 200, 'HEAD is no longer served by the overview handler');
});
