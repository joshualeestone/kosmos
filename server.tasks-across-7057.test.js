'use strict';

/**
 * kosmos#7057 (feedback): `GET /api/tasks` on its cheap list arm gains two params, for `kosmos task list --all` and
 * `--stale`:
 *   all=1        every project at once (archived ones left out, as the Tasks view leaves them); on an agent token
 *                ALONE, only the projects that agent is on (each by the per-project rule), never the global set.
 *   quietDays=N  the OPEN tasks whose last activity (tasks.lastActivityOf) is N days old or more, quietest first,
 *                each with lastActivityAt; the answer echoes quietDays so a CLI can tell an older board.
 *
 * Same harness as server.agent-reads-4491.test.js: the board boots fully sandboxed, then enforces a board token.
 *
 *   node --test server.tasks-across-7057.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksacross-7057-'));
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
const projectsEngine = require('./engine/projects');
const taskchat = require('./engine/taskchat');

const BOARD = 'BOARDTOKEN_test_7057_across_0123456789abcdef';
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const a = sendertoken.mint('reader-7057');
  assert.ok(a.ok, 'could not mint the agent token for the test');
  agentToken = a.token;
  assert.ok(taskchat.record('mine7057', 6, { kind: 'message', text: 'a word on it just now' }), 'could not write #6\'s transcript');
  assert.ok(taskchat.record('mine7057', 7, { kind: 'missed', text: 'a run was missed' }), 'could not write #7\'s transcript');
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(p, headers) {
  const res = await fetch(base + p, { headers });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}
const asBoard = { 'x-kosmos-board-token': BOARD };
const asAgent = () => ({ 'x-kosmos-agent-token': agentToken });

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

/* Three live projects and an archived one, without touching a real registry. reader-7057 is on mine7057 and
   also7057, not on theirs7057. Each task's age is its createdAt (no transcript exists for these, so that is its last
   activity, as lastActivityOf reads it). */
function withProjects(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'mine7057', name: 'Mine', agents: ['reader-7057'], tasks: [
      { number: 1, sentence: 'old open', state: 'open', createdAt: ago(30) },
      { number: 2, sentence: 'fresh open', state: 'open', createdAt: ago(1) },
      { number: 3, sentence: 'old but built', state: 'open', createdAt: ago(40), builtAt: ago(39), builtBy: 'reader-7057' },
      { number: 4, sentence: 'old but done', state: 'closed', isClosed: true, createdAt: ago(50), closedAt: ago(45) },
      { number: 5, sentence: 'exactly seven', state: 'open', createdAt: ago(7) },
      /* Review 1 (warning 1): last activity is the transcript, not createdAt. #6 was made long ago but talked about now
         (its transcript, written in test.before); #7 only has Kosmos's own note that a run was missed, which is not
         activity (#4787), so it stays quiet. */
      { number: 6, sentence: 'old but talked about now', state: 'open', createdAt: ago(40) },
      { number: 7, sentence: 'old with only a missed note', state: 'open', createdAt: ago(31) },
    ] },
    { id: 'also7057', name: 'Also', agents: ['reader-7057'], tasks: [
      { number: 1, sentence: 'quietest of all', state: 'open', createdAt: ago(90) },
      { number: 2, sentence: 'no date at all', state: 'open' },
    ] },
    { id: 'theirs7057', name: 'Theirs', agents: ['someone-else'], tasks: [
      { number: 1, sentence: 'not yours', state: 'open', createdAt: ago(60) },
    ] },
    /* Review 1 (warning 2): one id held by two records, the agent on only one. The per-project read refuses it (every
       record must list the agent); all=1 on a token must leave BOTH records' tasks out, never the one it is not on. */
    { id: 'dup7057', name: 'Dup', agents: ['reader-7057'], tasks: [{ number: 1, sentence: 'dup listing me', state: 'open', createdAt: ago(1) }] },
    { id: 'dup7057', name: 'Dup', agents: ['someone-else'], tasks: [{ number: 2, sentence: 'dup not listing me', state: 'open', createdAt: ago(1) }] },
    { id: 'gone7057', name: 'Gone', agents: ['reader-7057'], archived: true, tasks: [
      { number: 1, sentence: 'archived away', state: 'open', createdAt: ago(60) },
    ] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
}
const said = (r) => (r.json && Array.isArray(r.json.tasks) ? r.json.tasks.map((x) => x.sentence) : null);

test('all=1 with the board token: open tasks of every live project, archived left out, marked all', async (t) => {
  withProjects(t);
  const r = await call('/api/tasks?all=1&order=state&state=open', asBoard);
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.equal(r.json.all, true);
  assert.equal(r.json.listState, 'open');
  const s = said(r);
  for (const want of ['old open', 'fresh open', 'exactly seven', 'quietest of all', 'no date at all', 'not yours']) assert.ok(s.includes(want), want + ' missing: ' + s);
  assert.ok(!s.includes('archived away'), 'an archived project was listed');
  assert.ok(!s.includes('old but built') && !s.includes('old but done'), 'state=open kept another group');
  assert.ok(r.json.tasks.every((x) => typeof x.projectId === 'string'), 'a row had no project id to print');
  /* CONTROL: without all=1 the board-token global read is unchanged (archived kept, no all mark). */
  const plain = await call('/api/tasks', asBoard);
  assert.equal(plain.code, 200);
  assert.equal(plain.json.all, undefined);
  assert.ok(said(plain).includes('archived away'), 'CONTROL: the plain global read lost the archived project, so the test above proves nothing');
});

test('all=1 on an agent token alone: only the projects that agent is on, never another\'s or the global set', async (t) => {
  withProjects(t);
  const r = await call('/api/tasks?all=1&order=state&state=open', asAgent());
  assert.equal(r.code, 200, r.text.slice(0, 200));
  const s = said(r);
  assert.ok(s.includes('old open') && s.includes('quietest of all'), 'its own projects were not listed: ' + s);
  assert.ok(!s.includes('not yours'), 'another project\'s task was read on an agent token');
  assert.ok(!s.includes('archived away'), 'an archived project was listed');
  assert.ok(!s.includes('dup not listing me'), 'a record the agent is not on was read through an id it shares with one it is on');
  assert.ok(!s.includes('dup listing me'), 'an id held twice was listed though one record does not list the agent (the per-project read refuses it)');
  /* CONTROL: the board token sees both records, so the absence above is the token rule, not a fixture that lists nothing. */
  const both = said(await call('/api/tasks?all=1&order=state&state=open', asBoard));
  assert.ok(both.includes('dup listing me') && both.includes('dup not listing me'), 'CONTROL: the board token did not see the duplicate id');
  /* A token that names nobody (an old key-only token whose key another name also holds) is refused, as on one project. */
  const realResolveName = sendertoken.resolveName;
  sendertoken.resolveName = (tok) => (tok === agentToken ? { ok: true, key: 'reader-7057', name: null, twins: true, instance: null } : realResolveName(tok));
  try {
    const nobody = await call('/api/tasks?all=1&order=state&state=open', asAgent());
    assert.equal(nobody.code, 403, nobody.text.slice(0, 160));
    assert.match(nobody.json.error, /could not tell which agent this token belongs to/);
  } finally { sendertoken.resolveName = realResolveName; }
  /* CONTROL: the existing rule still holds without all=1. */
  const bare = await call('/api/tasks', asAgent());
  assert.equal(bare.code, 403, 'the global set was read on an agent token alone');
  assert.match(bare.text, /say which project/);
});

test('all=1 and project= together are refused', async (t) => {
  withProjects(t);
  const r = await call('/api/tasks?all=1&project=mine7057', asBoard);
  assert.equal(r.code, 400);
  assert.match(r.json.error, /not both/);
});

test('quietDays: open tasks quiet that long or longer, quietest first, the unknown first of all, with lastActivityAt', async (t) => {
  withProjects(t);
  const r = await call('/api/tasks?all=1&order=state&state=open&quietDays=7', asBoard);
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.equal(r.json.quietDays, 7);
  assert.equal(r.json.listState, 'open');
  assert.deepEqual(said(r), ['no date at all', 'quietest of all', 'not yours', 'old with only a missed note', 'old open', 'exactly seven']);
  assert.ok(!said(r).includes('old but talked about now'), 'a task talked about just now was listed as quiet: activity was read from createdAt, not the transcript');
  assert.ok(!said(r).includes('fresh open'), 'a task active yesterday was listed as quiet for a week');
  assert.ok(!said(r).includes('old but built') && !said(r).includes('old but done'), 'a built or done task was listed as stale');
  assert.equal(r.json.tasks[0].lastActivityAt, null, 'the dateless task claimed a date');
  assert.ok(r.json.tasks.slice(1).every((x) => typeof x.lastActivityAt === 'string'), 'a dated row had no lastActivityAt');
  /* One project, and a threshold that moves the edge. */
  const one = await call('/api/tasks?project=mine7057&order=state&state=open&quietDays=20', asBoard);
  assert.deepEqual(said(one), ['old with only a missed note', 'old open'], 'the 20-day edge, one project; #6 (talked about now) stays out');
  assert.equal(one.json.all, undefined, 'a one-project answer was marked all');
});

test('quietDays refuses what is not 1 to 3650 whole days, and any group but open', async (t) => {
  withProjects(t);
  for (const bad of ['0', '-1', '3651', '7.5', 'x', '', '00000']) {
    const r = await call('/api/tasks?all=1&order=state&state=open&quietDays=' + encodeURIComponent(bad), asBoard);
    assert.equal(r.code, 400, 'quietDays=' + JSON.stringify(bad) + ' was taken: ' + r.text.slice(0, 120));
  }
  const built = await call('/api/tasks?all=1&order=state&state=built&quietDays=7', asBoard);
  assert.equal(built.code, 400);
  assert.match(built.json.error, /only open tasks/);
  /* Review 1 (nit 2): never silently ignored on the Tasks view's arm. */
  for (const q of ['view=tasks&all=1', 'view=tasks&quietDays=7']) {
    const v = await call('/api/tasks?' + q, asBoard);
    assert.equal(v.code, 400, q + ': ' + v.text.slice(0, 120));
    assert.match(v.json.error, /not the Tasks view/);
  }
  /* CONTROL: the edges themselves are taken. */
  for (const ok of ['1', '3650']) assert.equal((await call('/api/tasks?all=1&state=open&quietDays=' + ok, asBoard)).code, 200, ok);
});
