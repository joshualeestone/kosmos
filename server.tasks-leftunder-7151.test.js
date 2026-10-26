'use strict';

/**
 * kosmos#7151 (feedback: tasks left behind by finished cycles pile up): `GET /api/tasks?state=open&quietDays=N` (the
 * list `kosmos task list --stale` prints) marks a quiet task with `leftUnder`, the closed parent it was left under, by
 * tasks.retireOffers: an agent filed it, its parent closed after it was made and every task above that is closed, its whole history is an
 * agent's own rows, and its agent is not waiting on the person. Nothing is retired: the field only offers it.
 *
 * Same harness as server.tasks-across-7057.test.js: the board boots fully sandboxed, then enforces a board token.
 *
 *   node --test server.tasks-leftunder-7151.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-leftunder-7151-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const projectsEngine = require('./engine/projects');
const taskchat = require('./engine/taskchat');

const BOARD = 'BOARDTOKEN_test_7151_leftunder_0123456789abcd';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(p) {
  // Review 5: a deadline, so a request that hangs fails in seconds rather than at fetch's own five minutes.
  const res = await fetch(base + p, { headers: { 'x-kosmos-board-token': BOARD }, signal: AbortSignal.timeout(5000) });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

/* One project: a cycle (#1) that closed 20 days ago, and under it the tasks the rule has to tell apart. Every open one
   is quiet for at least 10 days: each test writes the transcripts it needs, all dated 15 days ago or older. */
function withProjects(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'cyc7151', name: 'Cycle', agents: ['kit-7151'], tasks: [
      { number: 1, sentence: 'the cycle', createdAt: ago(60), closedAt: ago(20), addedVia: 'screen' },
      /* A second finished cycle for the person's own and the held task: under #1 they would (rightly) keep #2 from
         being offered, review 8's sibling rule, which is tested in the engine suite. */
      { number: 9, sentence: 'another cycle', createdAt: ago(60), closedAt: ago(20), addedVia: 'screen' },
      { number: 2, sentence: 'diagnostic left behind', parent: 1, createdAt: ago(40), addedVia: 'process', addedBy: 'kit-7151', parts: [{ who: 'kit-7151' }] },
      { number: 3, sentence: 'follow-up filed after', parent: 1, createdAt: ago(15), addedVia: 'process', addedBy: 'kit-7151' },
      { number: 4, sentence: 'the persons own', parent: 9, createdAt: ago(40), addedVia: 'screen' },
      { number: 5, sentence: 'one the person set a done-when on', parent: 1, createdAt: ago(40), addedVia: 'process', addedBy: 'kit-7151' },
      { number: 6, sentence: 'top level, no parent', createdAt: ago(40), addedVia: 'process', addedBy: 'kit-7151' },
      { number: 7, sentence: 'left behind but on hold', parent: 9, createdAt: ago(40), addedVia: 'process', addedBy: 'kit-7151', onHold: true },
      { number: 8, sentence: 'no date of its own', parent: 1, addedVia: 'process', addedBy: 'kit-7151' },
    ] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
}
const byNumber = (r) => new Map((r.json && Array.isArray(r.json.tasks) ? r.json.tasks : []).map((x) => [x.number, x]));

test('a quiet task an agent filed before its parent closed is offered with that parent; the rest are not', async (t) => {
  withProjects(t);
  /* Histories as the board writes them, with old dates so each task stays quiet: #2 was made by its agent and left
     alone (offered); the person acted on #5 (never offered). */
  const write = (n, rows) => {
    const f = taskchat.taskChatFile('cyc7151', n);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    t.after(() => { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } });
  };
  const createdBy = (n, sentence, via = 'process') => ({ at: ago(40), kind: 'created', sentence, addedVia: via, addedBy: via === 'process' ? 'kit-7151' : 'operator' });
  write(2, [{ ...createdBy(2, 'diagnostic left behind'), who: 'kit-7151' }]);
  /* Review 3: every other task gets the history it would really have, so each is ruled out only by the rule its
     assertion names, never by a missing history. */
  write(3, [{ ...createdBy(3, 'follow-up filed after'), at: ago(15) }]);
  write(4, [createdBy(4, 'the persons own', 'screen')]);
  write(6, [createdBy(6, 'top level, no parent')]);
  write(8, [createdBy(8, 'no date of its own')]);
  const file = taskchat.taskChatFile('cyc7151', 5);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [{ at: ago(40), kind: 'created', sentence: 'one the person set a done-when on', addedVia: 'process', addedBy: 'kit-7151' },
    { at: ago(30), kind: 'done-when-set', doneWhen: 'it ships', person: true }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  t.after(() => { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } });
  assert.equal(taskchat.read('cyc7151', 5).length, 2, 'premise: #5 has its creation and the person\'s entry, 30 days old');
  const r = await call('/api/tasks?project=cyc7151&state=open&quietDays=7');
  assert.equal(r.code, 200, r.text.slice(0, 200));
  const rows = byNumber(r);
  assert.ok(rows.has(2) && rows.has(3) && rows.has(4) && rows.has(5) && rows.has(6) && rows.has(8), 'premise: the quiet open tasks are listed: ' + [...rows.keys()]);
  assert.equal(rows.get(2).leftUnder, 1, 'an agent\'s task made before its parent closed is offered under it');
  assert.equal(rows.get(3).leftUnder, undefined, 'a follow-up filed after the parent closed is new work, never offered');
  assert.equal(rows.get(4).leftUnder, undefined, 'a task the person added is never offered');
  assert.equal(rows.get(6).leftUnder, undefined, 'a task with no parent is never offered');
  assert.equal(rows.get(8).leftUnder, undefined, 'a task with no date of its own is never offered (and it is listed: an unknown is shown)');
  assert.ok(rows.has(5), 'premise: #5 is quiet (its newest entry is 30 days old), so it is listed');
  assert.equal(rows.get(5).leftUnder, undefined, 'the person acted on it: never offered');
  assert.ok(!rows.has(7), 'premise: a task on hold is not in the open list at all');
});

test('the plain open list never carries leftUnder; only the stale list offers', async (t) => {
  withProjects(t);
  /* Review 4: #2 has the history that makes the stale list offer it, so this can fail if the plain list offered too. */
  const f = taskchat.taskChatFile('cyc7151', 2);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ at: ago(40), kind: 'created', sentence: 'diagnostic left behind', addedVia: 'process', addedBy: 'kit-7151' }) + '\n');
  t.after(() => { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } });
  const stale = await call('/api/tasks?project=cyc7151&state=open&quietDays=7');
  assert.equal(byNumber(stale).get(2).leftUnder, 1, 'premise: the stale list offers #2');
  const plain = await call('/api/tasks?project=cyc7151&state=open');
  assert.equal(plain.code, 200, plain.text.slice(0, 200));
  assert.ok((plain.json.tasks || []).length > 0 && plain.json.tasks.every((x) => x.leftUnder === undefined), 'the plain open list offers nothing');
});

test('review 4: if the offer throws, the stale list still answers, with no offers', async (t) => {
  withProjects(t);
  const tasksEngine = require('./engine/tasks');
  const real = tasksEngine.retireOffers;
  t.after(() => { tasksEngine.retireOffers = real; });
  tasksEngine.retireOffers = () => { throw new Error('a roster card the rule did not expect'); };
  const r = await call('/api/tasks?project=cyc7151&state=open&quietDays=7');
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.ok(r.json.tasks.length > 0 && r.json.tasks.every((x) => x.leftUnder === undefined), 'the list, and no offers');
});
