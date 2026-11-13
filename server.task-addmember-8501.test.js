'use strict';

/**
 * kosmos#8501: giving a task to an agent that is not on the project. Without --add-member the refusal names the one
 * step that fixes it; with it (addMember: true) the board puts the agent on the project and gives it the task in one
 * request, on both `task add --who` and `task assign`. Real task engine and store; a fleet of three: mara and otto
 * on the project, zed only on the board. Every "added" case has a control beside it in which nothing is added.
 *
 *   node --test server.task-addmember-8501.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskaddmember-8501-'));
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
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('zed', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Moves' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const asAgent = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
async function post(route, body, headers = asAgent('mara')) {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}
const project = () => projects.readAll().find((p) => p.id === projectId);
const members = () => (project().agents || []).slice();
const ownerOf = (n) => tasks.whoOf(tasks.byNumber(project(), n));
const taskCount = () => (project().tasks || []).length;
const fresh = (sentence, who = 'mara') => tasks.create(projectId, { sentence, who }).number;
// Each test starts with zed off the project, whatever the last one did.
function zedOff() { projects.mutate(projectId, (p) => ({ ...p, agents: (p.agents || []).filter((a) => a !== 'zed') })); }
const HINT = /run the same command again with --add-member$/;

test('without --add-member: task add and task assign to a non-member are refused, the refusal names the one step, and nothing changes', async () => {
  zedOff();
  const before = taskCount();
  const add = await post('/tasks', { sentence: 'Check the numbers', who: 'zed' });
  assert.equal(add.code, 400, add.text);
  assert.match(add.json.error, /^that agent is not on this project, so the task cannot be given to it\. To put zed on the project/);
  assert.match(add.json.error, HINT);
  assert.equal(add.json.error.includes('"'), false, 'the Mac CLI reads error with sed: no double quote');
  const n = fresh('Write the brief');
  const as = await post(`/task/${n}/assign`, { who: 'zed' });
  assert.equal(as.code, 400, as.text);
  assert.match(as.json.error, HINT);
  assert.equal(taskCount(), before + 1, 'only the control task (made directly) exists');
  assert.deepEqual(ownerOf(n), ['mara']);
  assert.equal(members().includes('zed'), false);
});

test('CONTROL: a name no agent on this board has gets the plain refusal, with no --add-member step offered', async () => {
  zedOff();
  const add = await post('/tasks', { sentence: 'x', who: 'nobody-here' });
  assert.equal(add.code, 400, add.text);
  assert.doesNotMatch(add.json.error, /--add-member/);
});

test('task add --add-member: zed joins the project and holds the task, in one request, recorded as a process member change', async () => {
  zedOff();
  const changes = (project().memberChanges || []).length;
  const r = await post('/tasks', { sentence: 'Check the numbers', who: 'zed', addMember: true });
  assert.equal(r.code, 200, r.text);
  assert.equal(r.json.addedMember, 'zed');
  assert.equal(members().includes('zed'), true);
  assert.deepEqual(ownerOf(r.json.task.number), ['zed']);
  const last = (project().memberChanges || []).slice(-1)[0];
  assert.equal((project().memberChanges || []).length, changes + 1);
  assert.equal(last.via, 'process');
  // CONTROL: the same request again, zed now a member, adds nobody and says nothing about adding.
  const again = await post('/tasks', { sentence: 'Check more numbers', who: 'zed', addMember: true });
  assert.equal(again.code, 200, again.text);
  assert.equal('addedMember' in again.json, false);
  assert.equal((project().memberChanges || []).length, changes + 1, 'a member already on was added again');
});

test('task assign --add-member: zed joins and the task moves to zed; the answer still names the new owner first', async () => {
  zedOff();
  const n = fresh('Write the brief');
  const r = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
  assert.equal(r.code, 200, r.text);
  assert.ok(r.text.startsWith('{"who":"zed"'), 'the Mac CLI reads the new owner from the start of the answer');
  assert.equal(r.json.addedMember, 'zed');
  assert.deepEqual(ownerOf(n), ['zed']);
  assert.equal(members().includes('zed'), true);
});

test('--add-member with a name no agent on this board has adds nobody and changes nothing', async () => {
  zedOff();
  const before = { tasks: taskCount(), members: members(), changes: (project().memberChanges || []).length };
  const r = await post('/tasks', { sentence: 'x', who: 'zedd', addMember: true });
  assert.equal(r.code, 400, r.text);
  assert.equal(r.json.error, 'there is no agent called zedd on this board, so nobody was added and nothing was changed');
  assert.equal(taskCount(), before.tasks);
  assert.deepEqual(members(), before.members);
  assert.equal((project().memberChanges || []).length, before.changes);
});

test('addMember must be true or absent', async () => {
  zedOff();
  for (const v of [false, 'yes', 1]) {
    const r = await post('/tasks', { sentence: 'x', who: 'zed', addMember: v });
    assert.equal(r.code, 400, String(v) + ': ' + r.text);
    assert.equal(r.json.error, 'addMember must be true or absent');
  }
  assert.equal(members().includes('zed'), false);
});

test('a done task is refused before anyone is added: assign --add-member leaves zed off the project', async () => {
  zedOff();
  const n = fresh('Already finished');
  tasks.close(projectId, n);
  const r = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
  assert.equal(r.code, 400, r.text);
  assert.match(r.json.error, /is done, so it is not given to anyone/);
  assert.equal(members().includes('zed'), false, 'a member was added for a task that was never moved');
});

test('a task add refused after the add takes zed off again, so the project is as it was', async () => {
  zedOff();
  const changes = (project().memberChanges || []).length;
  const r = await post('/tasks', { sentence: 'Under nothing', who: 'zed', addMember: true, parent: '999' });
  assert.equal((project().memberChanges || []).length, changes + 2, 'the add and its undo were not both made: this no longer tests the undo');
  assert.equal(r.code, 400, r.text);
  assert.doesNotMatch(r.json.error, /was put on the project/);
  assert.equal('addedMember' in r.json, false);
  assert.equal(members().includes('zed'), false, 'a member was left on the project for a task that was never added');
});

test('a task assign refused after the add (a built task, given by an agent) takes zed off again', async () => {
  zedOff();
  const n = fresh('Built already');
  tasks.setBuilt(projectId, n, { by: 'mara' });
  const changes = (project().memberChanges || []).length;
  const r = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
  assert.equal((project().memberChanges || []).length, changes + 2, 'the add and its undo were not both made: this no longer tests the undo');
  assert.notEqual(r.code, 200, r.text);
  assert.equal('addedMember' in r.json, false, r.text);
  assert.equal(members().includes('zed'), false, 'a member was left on the project for a task that was never moved');
  assert.deepEqual(ownerOf(n), ['mara']);
  // CONTROL: the same assign on a task that is not built moves it and keeps zed on.
  const m = fresh('Not built');
  const ok = await post(`/task/${m}/assign`, { who: 'zed', addMember: true });
  assert.equal(ok.code, 200, ok.text);
  assert.equal(members().includes('zed'), true);
});

test('an agent let in on its agent token alone cannot add a member (the member route needs the board token); with it, it can', async () => {
  zedOff();
  const BOARD = 'b'.repeat(64);
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  try {
    const before = taskCount();
    const only = await post('/tasks', { sentence: 'Token only', who: 'zed', addMember: true });
    assert.equal(only.code, 403, only.text);
    assert.match(only.json.error, /^only your person can put an agent on a project from here/);
    assert.equal(members().includes('zed'), false);
    assert.equal(taskCount(), before);
    const n = fresh('Token only, assign');
    const onlyAssign = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
    assert.equal(onlyAssign.code, 403, onlyAssign.text);
    assert.equal(members().includes('zed'), false);
    // CONTROL: the same request with the board token as well adds zed, as the member route would.
    const both = await post('/tasks', { sentence: 'With the board token', who: 'zed', addMember: true }, { ...asAgent('mara'), 'x-kosmos-board-token': BOARD });
    assert.equal(both.code, 200, both.text);
    assert.equal(members().includes('zed'), true);
  } finally { boardAuthState.on = false; boardAuthState.token = null; }
});

test('the membership valve counts an add made through a task: past it, 429 with retry-after and nothing changes', async () => {
  zedOff();
  const now = new Date().toISOString();
  const keep = project().memberChanges || [];
  projects.mutate(projectId, (p) => ({ ...p, memberChanges: [...keep, ...Array.from({ length: projects.MEMBERS_PER_HOUR }, () => ({ at: now, via: 'process', agent: 'filler', act: 'add' }))] }));
  try {
    const before = taskCount();
    const r = await post('/tasks', { sentence: 'x', who: 'zed', addMember: true });
    assert.equal(r.code, 429, r.text);
    assert.ok(Number(r.json.retry_after_secs) > 0);
    assert.equal(members().includes('zed'), false);
    assert.equal(taskCount(), before);
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, memberChanges: keep }));
  }
});

test('a refused assign does not take zed off when zed was given other work on the project meanwhile (two requests at once)', async () => {
  zedOff();
  const n = fresh('The one that will be refused');
  const real = tasks.assignPart;
  // While this request waits on the give, another request gives zed a task here; then this give is refused.
  tasks.assignPart = () => {
    tasks.create(projectId, { sentence: 'Given meanwhile', who: 'zed' });
    throw new Error('refused for this test');
  };
  try {
    const r = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
    assert.notEqual(r.code, 200, r.text);
    assert.match(r.json.error, /^zed stays on the project, because it holds work there now: refused for this test$/);
    assert.equal(r.json.addedMember, 'zed');
  } finally { tasks.assignPart = real; }
  assert.equal(members().includes('zed'), true, 'zed was taken off while holding work on the project');
  // CONTROL: the same refusal with no other work given takes zed off again.
  zedOff();
  const m = fresh('Refused, nothing else given');
  tasks.assignPart = () => { throw new Error('refused for this test'); };
  try {
    const r = await post(`/task/${m}/assign`, { who: 'zed', addMember: true });
    assert.notEqual(r.code, 200, r.text);
  } finally { tasks.assignPart = real; }
  assert.equal(members().includes('zed'), false);
});

test('a caller on its agent token alone is not offered the --add-member step it could not use', async () => {
  zedOff();
  const BOARD = 'c'.repeat(64);
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  try {
    const only = await post('/tasks', { sentence: 'x', who: 'zed' });
    assert.equal(only.code, 400, only.text);
    assert.doesNotMatch(only.json.error, /--add-member/);
    // CONTROL: with the board token as well, the step is offered.
    const both = await post('/tasks', { sentence: 'x', who: 'zed' }, { ...asAgent('mara'), 'x-kosmos-board-token': BOARD });
    assert.match(both.json.error, /--add-member/);
  } finally { boardAuthState.on = false; boardAuthState.token = null; }
});

test('a name typed with other case or spaces finds the agent the board runs, and that name is what joins and holds the task', async () => {
  for (const typed of ['Zed', ' zed ']) {
    zedOff();
    const r = await post('/tasks', { sentence: 'By key: ' + JSON.stringify(typed), who: typed, addMember: true });
    assert.equal(r.code, 200, typed + ': ' + r.text);
    assert.equal(r.json.addedMember, 'zed');
    assert.deepEqual(ownerOf(r.json.task.number), ['zed']);
    assert.equal(members().includes('zed'), true);
    assert.equal(members().includes(typed), false, typed + ' was stored as typed');
  }
});

test('when the store will not take zed off after a refusal, the answer says zed stayed and carries addedMember', async () => {
  zedOff();
  const real = projects.removeAgent;
  projects.removeAgent = () => { throw new Error('store says no'); };
  try {
    const r = await post('/tasks', { sentence: 'Under nothing', who: 'zed', addMember: true, parent: '999' });
    assert.equal(r.code, 400, r.text);
    assert.match(r.json.error, /^zed was put on the project and could not be taken off again, and the task was not added: /);
    assert.equal(r.json.addedMember, 'zed');
  } finally { projects.removeAgent = real; }
});

test('the joined line is typed once the task is given, and never for a refused one', async () => {
  const said = [];
  const real = projects.speakOfMembershipAsync;
  projects.speakOfMembershipAsync = async (name, project, kind) => { said.push([name, kind]); return null; };
  try {
    zedOff();
    const no = await post('/tasks', { sentence: 'Under nothing', who: 'zed', addMember: true, parent: '999' });
    assert.equal(no.code, 400, no.text);
    assert.deepEqual(said, [], 'a joined line was typed for a task that was never added');
    const yes = await post('/tasks', { sentence: 'Joined for real', who: 'zed', addMember: true });
    assert.equal(yes.code, 200, yes.text);
    assert.deepEqual(said, [['zed', 'joined']]);
    zedOff();
    const n = fresh('Assigned with a join');
    const as = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
    assert.equal(as.code, 200, as.text);
    assert.deepEqual(said, [['zed', 'joined'], ['zed', 'joined']]);
  } finally { projects.speakOfMembershipAsync = real; }
});

test('the membership valve counts an add made through task assign too: past it, 429 and nothing changes', async () => {
  zedOff();
  const n = fresh('Valved assign');
  const now = new Date().toISOString();
  const keep = project().memberChanges || [];
  projects.mutate(projectId, (p) => ({ ...p, memberChanges: [...keep, ...Array.from({ length: projects.MEMBERS_PER_HOUR }, () => ({ at: now, via: 'process', agent: 'filler', act: 'add' }))] }));
  try {
    const r = await post(`/task/${n}/assign`, { who: 'zed', addMember: true });
    assert.equal(r.code, 429, r.text);
    assert.equal(members().includes('zed'), false);
    assert.deepEqual(ownerOf(n), ['mara']);
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, memberChanges: keep }));
  }
});

test('the page is not offered a command to run: a non-member refusal from the screen has no --add-member step', async () => {
  zedOff();
  const page = await post('/tasks', { sentence: 'From the page', who: 'zed' }, { 'sec-fetch-site': 'same-origin' });
  assert.equal(page.code, 400, page.text);
  assert.doesNotMatch(page.json.error, /--add-member/);
  // CONTROL: the same request from an agent is offered the step.
  const agent = await post('/tasks', { sentence: 'From an agent', who: 'zed' });
  assert.match(agent.json.error, /--add-member/);
});

test('task assign keeps the --add-member step from the page and from a caller on its agent token alone, as task add does', async () => {
  zedOff();
  const n = fresh('Assign hint');
  const page = await post(`/task/${n}/assign`, { who: 'zed' }, { 'sec-fetch-site': 'same-origin' });
  assert.equal(page.code, 400, page.text);
  assert.doesNotMatch(page.json.error, /--add-member/);
  const BOARD = 'd'.repeat(64);
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  try {
    const only = await post(`/task/${n}/assign`, { who: 'zed' });
    assert.equal(only.code, 400, only.text);
    assert.doesNotMatch(only.json.error, /--add-member/);
    // CONTROL: an agent with the board token as well is offered the step.
    const both = await post(`/task/${n}/assign`, { who: 'zed' }, { ...asAgent('mara'), 'x-kosmos-board-token': BOARD });
    assert.match(both.json.error, /--add-member/);
  } finally { boardAuthState.on = false; boardAuthState.token = null; }
});

test('a mistyped name from a caller on its agent token alone gets the true answer (no such agent), not a step naming it', async () => {
  zedOff();
  const BOARD = 'e'.repeat(64);
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  try {
    const r = await post('/tasks', { sentence: 'x', who: 'zedd', addMember: true });
    assert.equal(r.code, 400, r.text);
    assert.equal(r.json.error, 'there is no agent called zedd on this board, so nobody was added and nothing was changed');
  } finally { boardAuthState.on = false; boardAuthState.token = null; }
});
