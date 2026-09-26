'use strict';

/**
 * #3559, the Tasks view's supply side: GET /api/tasks carries each task's
 * derived `state`, its `claim` and `lastActivityAt`; POST /api/tasks/close
 * closes many tasks with one note, each standing alone.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.tasks-tab-3559.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskstab-'));
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
const commitments = require('./engine/commitments');
const taskchat = require('./engine/taskchat');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const all = async (q) => (await fetch(`${base}/api/tasks${q || ''}`)).json();
const view = async (q) => all(q ? q + '&view=tasks' : '?view=tasks');
const bulk = async (body, headers) => {
  const res = await fetch(`${base}/api/tasks/close`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, headers || {}),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('GET /api/tasks: every row carries state, claim and lastActivityAt, derived by the engine', async () => {
  const p = projects.create({ name: 'Groups' });
  projects.addAgent(p.id, 'grpagent', null);
  tasks.create(p.id, { sentence: 'Nobody on it' });
  tasks.create(p.id, { sentence: 'Given, not named', who: 'grpagent' });
  tasks.create(p.id, { sentence: 'Given and named', who: 'grpagent' });
  tasks.create(p.id, { sentence: 'Finished', who: 'grpagent' });
  tasks.close(p.id, 4);
  commitments.report('grpagent', [{ what: 'on task 3 of Groups' }]);
  const body = await view(`?project=${encodeURIComponent(p.id)}`);
  const by = Object.fromEntries(body.tasks.map((t) => [t.sentence, t]));
  assert.equal(by['Nobody on it'].state, 'nobody');
  assert.equal(by['Given, not named'].state, 'assigned');
  assert.equal(by['Given, not named'].claim.claimed, false);
  assert.equal(by['Given and named'].state, 'working');
  assert.equal(by['Given and named'].claim.claimed, true);
  assert.equal(by['Finished'].state, 'closed');
  for (const t of body.tasks) {
    assert.ok(Number.isFinite(Date.parse(t.lastActivityAt)), `no last activity on ${t.sentence}`);
  }
  // The pre-existing fields are untouched (the project View-all door reads them).
  assert.equal(body.count, body.tasks.length);
  assert.ok(body.tasks.every((t) => t.projectId === p.id && typeof t.isClosed === 'boolean'));
  // #3949 review round 9: the roster was read, so the page may trust a false waitingOnPerson.
  assert.equal(body.rosterUnreadable, false);
});

test('GET /api/tasks: without ?view=tasks the rows carry none of the Tasks view\'s costly fields', async () => {
  const body = await all();
  assert.ok(body.tasks.length >= 4);
  assert.ok(body.tasks.every((t) => !('state' in t) && !('claim' in t) && !('lastActivityAt' in t)), 'the View-all door and the CLI now pay for the Tasks view\'s fields');
});

test('GET /api/tasks?view=tasks: the global list carries the fields across projects', async () => {
  const body = await view();
  assert.ok(body.tasks.length >= 4);
  assert.ok(body.tasks.every((t) => ['nobody', 'assigned', 'working', 'closed', 'decision'].includes(t.state)), 'a state outside the provable five');
});

test('POST /api/tasks/close: closes each task, then writes the note to its history', async () => {
  const p = projects.create({ name: 'Bulk' });
  projects.addAgent(p.id, 'bulkagent', null);
  tasks.create(p.id, { sentence: 'One', who: 'bulkagent' });
  tasks.create(p.id, { sentence: 'Two' });
  const r = await bulk({ tasks: [{ projectId: p.id, number: 1 }, { projectId: p.id, number: 2 }], note: 'no longer needed' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.closed, 2);
  const stored = projects.readAll().find((x) => x.id === p.id);
  assert.ok(stored.tasks.every((t) => t.closedAt), 'a task was left open');
  for (const n of [1, 2]) {
    const events = taskchat.read(p.id, n);
    const said = events.filter((e) => e.kind === 'said').map((e) => e.text);
    assert.deepEqual(said, ['no longer needed'], `the note is not on task ${n}'s history`);
    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.lastIndexOf('closed') !== -1 && kinds.lastIndexOf('said') > kinds.lastIndexOf('closed'), `on task ${n} the note is not written after the close: ${kinds}`);
  }
  // Sent again (a stale page): already closed, left alone, and the note is NOT written twice.
  const again = await bulk({ tasks: [{ projectId: p.id, number: 1 }], note: 'no longer needed' });
  assert.equal(again.status, 200);
  assert.equal(again.json.results[0].already, true);
  assert.equal(again.json.closed, 0, 'an already-closed task was credited as closed by this request');
  assert.equal(again.json.already, 1);
  assert.equal(taskchat.read(p.id, 1).filter((e) => e.kind === 'said').length, 1, 'a second close wrote the note again');
});

test('POST /api/tasks/close: one store read, not a claim join per item; a task sent twice in ONE request gets one note', async () => {
  const p = projects.create({ name: 'Once' });
  tasks.create(p.id, { sentence: 'Only once' });
  const realGet = projects.get;
  let gets = 0;
  projects.get = (...a) => { gets += 1; return realGet(...a); };
  let r;
  try {
    r = await bulk({ tasks: [{ projectId: p.id, number: 1 }, { projectId: p.id, number: 1 }], note: 'done twice?' });
  } finally { projects.get = realGet; }
  assert.equal(gets, 0, 'bulk close ran the claim join (projects.get) per item');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.results.map((x) => !!x.already), [false, true]);
  assert.equal(taskchat.read(p.id, 1).filter((e) => e.kind === 'said').length, 1, 'the note was written twice');
});

test('POST /api/tasks/close: one bad item does not stop the others, and the answer says which failed', async () => {
  const p = projects.create({ name: 'Partial' });
  tasks.create(p.id, { sentence: 'Real' });
  const r = await bulk({ tasks: [{ projectId: p.id, number: 1 }, { projectId: p.id, number: 99 }, { projectId: 7, number: 'x' }] });
  assert.equal(r.status, 207);
  assert.equal(r.json.closed, 1);
  assert.equal(r.json.failed, 2);
  const bad = r.json.results.filter((x) => !x.ok);
  assert.ok(bad.every((x) => typeof x.error === 'string' && x.error.length), 'a failure without a reason');
  assert.ok(projects.readAll().find((x) => x.id === p.id).tasks[0].closedAt, 'the good task was not closed');
});

test('POST /api/tasks/close: an agent token, or no screen at all, is refused; nothing closes', async () => {
  const p = projects.create({ name: 'Refused' });
  tasks.create(p.id, { sentence: 'Stays open' });
  // Both ways an agent presents its token (presentedAgentToken): the body and the header.
  const bodyToken = await bulk({ tasks: [{ projectId: p.id, number: 1 }], token: 'kt_anything' });
  assert.equal(bodyToken.status, 403, 'an agent token in the body closed tasks in bulk');
  const headerToken = await bulk({ tasks: [{ projectId: p.id, number: 1 }] }, { 'x-kosmos-agent-token': 'kt_anything' });
  assert.equal(headerToken.status, 403, 'an agent token in the header closed tasks in bulk');
  const noScreen = await fetch(`${base}/api/tasks/close`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tasks: [{ projectId: p.id, number: 1 }] }),
  });
  assert.equal(noScreen.status, 403, 'a caller with no screen headers closed tasks in bulk');
  assert.equal(projects.readAll().find((x) => x.id === p.id).tasks[0].closedAt, null);
});

test('POST /api/tasks/close: empty, too many, an over-long note and junk are refused before anything closes', async () => {
  assert.equal((await bulk({ tasks: [] })).status, 400);
  assert.equal((await bulk({ nope: true })).status, 400);
  const p = projects.create({ name: 'Caps' });
  tasks.create(p.id, { sentence: 'Must stay open' });
  /* 201 copies of ONE REAL task: without the cap the first would close and the rest read as
     already closed (a 200), so only the cap can make this a 400. */
  const many = await bulk({ tasks: Array.from({ length: 201 }, () => ({ projectId: p.id, number: 1 })) });
  assert.equal(many.status, 400);
  assert.match(many.json.error, /up to 200/);
  /* A real task and an over-long note: the route refuses the NOTE itself, before any close. */
  const long = await bulk({ tasks: [{ projectId: p.id, number: 1 }], note: 'n'.repeat(tasks.MESSAGE_MAX + 1) });
  assert.equal(long.status, 400);
  assert.match(long.json.error, /note/);
  assert.equal(long.json.results, undefined, 'the route tried the tasks instead of refusing the note');
  assert.equal(projects.readAll().find((x) => x.id === p.id).tasks[0].closedAt, null);
});

test('GET /api/tasks?view=tasks: a project whose claims cannot be read says so on its assigned rows, never "not started" as a fact', async () => {
  const p = projects.create({ name: 'Unreadable' });
  projects.addAgent(p.id, 'unreadagent', null);
  tasks.create(p.id, { sentence: 'Given to someone', who: 'unreadagent' });
  tasks.create(p.id, { sentence: 'Nobody has it' });
  const real = projects.joinTaskClaims;
  projects.joinTaskClaims = () => { throw new Error('planted'); };
  const quiet = console.error;
  console.error = () => {};
  let body;
  try { body = await all(`?view=tasks&project=${encodeURIComponent(p.id)}`); } finally {
    projects.joinTaskClaims = real;
    console.error = quiet;
  }
  const by = Object.fromEntries(body.tasks.map((t) => [t.sentence, t]));
  assert.equal(by['Given to someone'].state, 'assigned');
  assert.equal(by['Given to someone'].claim.claimed, null);
  assert.match(by['Given to someone'].claim.because, /could not read/);
  assert.equal(by['Nobody has it'].claim, null, 'a task nobody is on has no claim to be unsure about');
  // Control: with the join working, the same row carries the join's own answer, not the planted-failure one.
  commitments.report('unreadagent', [{ what: 'nothing about that task' }]);
  const fine = await all(`?view=tasks&project=${encodeURIComponent(p.id)}`);
  const fineClaim = fine.tasks.find((t) => t.sentence === 'Given to someone').claim;
  assert.equal(fineClaim.claimed, false, JSON.stringify(fineClaim));
});

test('GET /api/tasks?view=tasks leaves out archived projects (and pays nothing for them); the plain list keeps them', async () => {
  const p = projects.create({ name: 'Set aside' });
  tasks.create(p.id, { sentence: 'In an archived project' });
  projects.setArchived(p.id, true);
  assert.equal(projects.readAll().find((x) => x.id === p.id).archived, true, 'the fixture did not archive the project; update this test');
  const real = projects.joinTaskClaims;
  const seen = [];
  projects.joinTaskClaims = (...a) => { seen.push(a[4] && a[4].id); return real(...a); };
  let view;
  try { view = await all('?view=tasks'); } finally { projects.joinTaskClaims = real; }
  assert.ok(!view.tasks.some((t) => t.projectId === p.id), 'an archived project\'s task is in the Tasks view');
  assert.ok(!seen.includes(p.id), 'claims were read for an archived project');
  assert.ok(seen.length > 0, 'the spy saw no project at all (control)');
  const plain = await all();
  assert.ok(plain.tasks.some((t) => t.projectId === p.id && t.projectArchived === true), 'the plain list lost the archived task');
});

test('#3949 GET /api/tasks?view=tasks: a task whose agent asks about ITS project is Needs Your Decision, from the real roster', async () => {
  const fleet = require('./test-support/fleet');
  const selfreport = require('./engine/selfreport');
  const p = projects.create({ name: 'Decisions' });
  const other = projects.create({ name: 'Other decisions' });
  for (const a of ['askhere', 'askthere']) projects.addAgent(p.id, a, null);
  tasks.create(p.id, { sentence: 'Waiting on the person', who: 'askhere' });
  tasks.create(p.id, { sentence: 'Asked about another project', who: 'askthere' });
  /* Real agents asking real questions (selfreport + a needs_you pane), one about this project, one about another. */
  assert.equal(selfreport.record('askhere', { state: 'needs_you', project: p.id, because: 'which cover?' }).recorded, true);
  assert.equal(selfreport.record('askthere', { state: 'needs_you', project: other.id, because: 'a question elsewhere' }).recorded, true);
  const board = fleet.install([fleet.agent('askhere', { state: 'needs_you' }), fleet.agent('askthere', { state: 'needs_you' })]);
  let body;
  try { body = await all(`?view=tasks&project=${encodeURIComponent(p.id)}`); } finally { board.restore(); }
  const by = Object.fromEntries(body.tasks.map((t) => [t.sentence, t]));
  assert.equal(by['Waiting on the person'].state, 'decision', JSON.stringify(by['Waiting on the person']));
  assert.equal(by['Waiting on the person'].waitingOnPerson, true);
  assert.equal(by['Asked about another project'].state, 'assigned', 'control: a question about another project does not count here');
  /* And once the questions are answered (each agent reports working again), no task is a decision. */
  for (const a of ['askhere', 'askthere']) assert.equal(selfreport.record(a, { state: 'working' }).recorded, true);
  const quiet = fleet.install([fleet.agent('askhere', { state: 'working' }), fleet.agent('askthere', { state: 'working' })]);
  let plain;
  try { plain = await all(`?view=tasks&project=${encodeURIComponent(p.id)}`); } finally { quiet.restore(); }
  assert.ok(plain.tasks.every((t) => t.state !== 'decision' && t.waitingOnPerson === false), JSON.stringify(plain.tasks.map((t) => t.state)));
});

test('GET /api/tasks?view=tasks: an unreadable roster is reported (rosterUnreadable), so the page can say it cannot tell (review round 11)', async () => {
  const status = require('./engine/status');
  // Force safeRoster() -> null by making snapshot()'s pane source throw (as server.team-agent-token-1279 does).
  status.setPaneSource(() => { throw new Error('roster unreadable (test)'); });
  try {
    const body = await view();
    assert.equal(body.rosterUnreadable, true);
    assert.ok(body.tasks.every((t) => t.state !== 'decision'), 'a decision derived from a roster nobody read');
  } finally { status.setPaneSource(null); }
  assert.equal((await view()).rosterUnreadable, false, 'CONTROL: a good read reports a readable roster');
});
