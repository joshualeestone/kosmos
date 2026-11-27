'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9177: an agent's own task list (`kosmos task list --mine`, GET /api/tasks?all=1&mine=1, and GET /api/tasks/mine)
 * reads "built" for the asking agent: a shared task ANOTHER holder marked built stays open for a holder whose part is
 * still open, as the Assigner already counts it (tasks.builtFor, one rule for both). A task the person marked, or one the
 * asking agent marked itself, is built for it. Harness as server.tasks-mine-6506.test.js.
 *
 *   node --test server.tasks-mine-built-9177.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksmine-built-9177-'));
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
const tasks = require('./engine/tasks');
const tasklist = require('./engine/tasklist');

const BOARD = 'BOARDTOKEN_test_9177_tasksmine_0123456789';
let base;
let readerToken;
let otherToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const r = sendertoken.mint('reader-agent');
  const o = sendertoken.mint('other-agent');
  assert.ok(r.ok && o.ok, 'could not mint the agent tokens for the test');
  readerToken = r.token;
  otherToken = o.token;
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function get(p, token) {
  const res = await fetch(base + p, { headers: { 'x-kosmos-agent-token': token } });
  return { code: res.status, text: await res.text() };
}
const AT = '2026-11-26T12:00:00.000Z';
const both = () => [{ id: 1, who: 'reader-agent' }, { id: 2, who: 'other-agent' }];
/* One project both agents are on. Each task has an open part for each agent:
   1 marked built by other-agent only; 2 marked by the person (builtFreesAll); 3 marked by reader-agent only; 4 unmarked.
   5 is marked by other-agent and reader-agent's part is CLOSED: no open part of its own, so built for reader too.
   6 is marked with no builtWho list (older than marks that name their marker): it covers nobody, as for the Assigner.
   7 and 8 are ON HOLD, marked by other-agent and by reader-agent. 9 is in a PAUSED project, marked by other-agent. */
function withProjects(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'projS', name: 'projS', agents: ['reader-agent', 'other-agent'], tasks: [
      { number: 1, sentence: 'shared other-marked', parts: both(), builtAt: AT, builtBy: 'other-agent', builtWho: ['other-agent'] },
      { number: 2, sentence: 'shared person-marked', parts: both(), builtAt: AT, builtByPerson: true, builtWho: [], builtFreesAll: true },
      { number: 3, sentence: 'shared reader-marked', parts: both(), builtAt: AT, builtBy: 'reader-agent', builtWho: ['reader-agent'] },
      { number: 4, sentence: 'shared unmarked', parts: both() },
      { number: 5, sentence: 'shared reader-finished', parts: [{ id: 1, who: 'reader-agent', closedAt: AT }, { id: 2, who: 'other-agent' }],
        builtAt: AT, builtBy: 'other-agent', builtWho: ['other-agent'] },
      { number: 6, sentence: 'shared old mark', parts: both(), builtAt: AT, builtBy: 'other-agent' },
      { number: 7, sentence: 'held other-marked', parts: both(), onHold: true, builtAt: AT, builtBy: 'other-agent', builtWho: ['other-agent'] },
      { number: 8, sentence: 'held reader-marked', parts: both(), onHold: true, builtAt: AT, builtBy: 'reader-agent', builtWho: ['reader-agent'] },
    ] },
    { id: 'projP', name: 'projP', agents: ['reader-agent', 'other-agent'], paused: true, tasks: [
      { number: 1, sentence: 'paused other-marked', parts: both(), builtAt: AT, builtBy: 'other-agent', builtWho: ['other-agent'] },
    ] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
}
const sentences = (text) => (JSON.parse(text).tasks || []).map((x) => x.sentence || x.title).sort();

test('builtFor: one agent\'s mark covers that agent only; the person\'s covers everyone; a function matches names', () => {
  const other = { builtAt: AT, builtWho: ['other-agent'] };
  assert.equal(tasks.builtFor(other, 'other-agent'), true);
  assert.equal(tasks.builtFor(other, 'reader-agent'), false);
  assert.equal(tasks.builtFor({ builtAt: AT, builtWho: [], builtFreesAll: true }, 'reader-agent'), true);
  assert.equal(tasks.builtFor({ builtWho: ['reader-agent'] }, 'reader-agent'), false, 'no mark at all is not built');
  assert.equal(tasks.builtFor(other, (n) => n.toUpperCase() === 'OTHER-AGENT'), true);
  assert.equal(tasks.builtFor(null, 'x'), false);
  // listGroup: without a reader, any mark is built (the board's task-level view, unchanged); with one, the reader's rule.
  assert.equal(tasks.listGroup(other), 'built');
  const otherOn = { ...other, parts: both() };   // reader-agent holds an open part of it
  assert.equal(tasks.listGroup(otherOn, 'reader-agent'), 'open');
  assert.equal(tasks.listGroup({ ...otherOn, projectPaused: true }, 'reader-agent'), 'held');
  // Another holder's mark, and the reader's own part closed: nothing of the reader's is open, so built for it (hasOpenWork's reading).
  assert.equal(tasks.listGroup({ ...other, parts: [{ id: 1, who: 'reader-agent', closedAt: AT }, { id: 2, who: 'other-agent' }] }, 'reader-agent'), 'built');
  assert.equal(tasks.listGroup({ ...other, parts: [{ id: 1, who: 'reader-agent' }, { id: 2, who: 'other-agent' }] }, 'reader-agent'), 'open');
  // A mark with no builtWho list covers nobody, as builtFor (and so the Assigner) reads it; with no part of its own, built.
  assert.equal(tasks.listGroup({ builtAt: AT, parts: both() }, 'reader-agent'), 'open');
  assert.equal(tasks.listGroup({ builtAt: AT }, 'reader-agent'), 'built', 'not on it at all: nothing of its own is open');
  assert.equal(tasks.listGroup({ builtAt: AT, builtWho: [], parts: both() }, 'reader-agent'), 'open', 'an unnamed caller\'s mark frees nobody');
});

test('#9177: --mine open keeps a shared task another holder marked built; --mine built keeps only the asker\'s', async (t) => {
  withProjects(t);
  const open = await get('/api/tasks?all=1&order=state&state=open&mine=1', readerToken);
  assert.equal(open.code, 200, open.text.slice(0, 300));
  assert.deepEqual(sentences(open.text), ['shared old mark', 'shared other-marked', 'shared unmarked'], open.text.slice(0, 400));
  const built = await get('/api/tasks?all=1&order=state&state=built&mine=1', readerToken);
  assert.equal(built.code, 200, built.text.slice(0, 300));
  assert.deepEqual(sentences(built.text), ['shared person-marked', 'shared reader-finished', 'shared reader-marked'], built.text.slice(0, 400));
  // The other holder sees the mirror image: its own mark is built for it, the reader's is still open.
  const otherOpen = await get('/api/tasks?all=1&order=state&state=open&mine=1', otherToken);
  assert.deepEqual(sentences(otherOpen.text), ['shared old mark', 'shared reader-marked', 'shared unmarked'], otherOpen.text.slice(0, 400));
});

test('#9177: one project with --mine reads the same rule', async (t) => {
  withProjects(t);
  const open = await get('/api/tasks?project=projS&order=state&state=open&mine=1', readerToken);
  assert.equal(open.code, 200, open.text.slice(0, 300));
  assert.deepEqual(sentences(open.text), ['shared old mark', 'shared other-marked', 'shared unmarked'], open.text.slice(0, 400));
});

test('#9177: GET /api/tasks/mine keeps a shared task another holder marked built', async (t) => {
  withProjects(t);
  const r = await get('/api/tasks/mine', readerToken);
  assert.equal(r.code, 200, r.text.slice(0, 300));
  assert.deepEqual(sentences(r.text), ['shared old mark', 'shared other-marked', 'shared unmarked'], r.text.slice(0, 400));
});

test('CONTROL: without mine=1 the list is the task-level view, so any mark is built', async (t) => {
  withProjects(t);
  const built = await get('/api/tasks?project=projS&order=state&state=built', readerToken);
  assert.equal(built.code, 200, built.text.slice(0, 300));
  assert.deepEqual(sentences(built.text), ['shared old mark', 'shared other-marked', 'shared person-marked', 'shared reader-finished', 'shared reader-marked'], built.text.slice(0, 400));
});

test('#9177: the open row carrying another holder\'s mark says so, and the CLI does not print it as waiting on a review', async (t) => {
  withProjects(t);
  const r = await get('/api/tasks?all=1&order=state&state=open&mine=1', readerToken);
  assert.equal(r.code, 200, r.text.slice(0, 300));
  const body = JSON.parse(r.text);
  const row = (words) => body.tasks.find((x) => x.sentence === words);
  assert.equal(row('shared other-marked').builtForCaller, false, r.text.slice(0, 400));
  assert.equal('builtForCaller' in row('shared unmarked'), false, 'an unmarked row was flagged');
  const { lines } = tasklist.acrossLines(body, 'open', { mine: true });
  const printed = lines.find((l) => l.includes('shared other-marked'));
  assert.ok(printed, 'CONTROL: the row is not printed: ' + lines.join('\n'));
  assert.match(printed, /a mark that does not name you; your part is still open/, printed);
  assert.doesNotMatch(printed, /waits on a review/, printed);
  // The task-level list (no mine=1) still says a marked task waits on its review.
  const all = JSON.parse((await get('/api/tasks?all=1&order=state&state=built', readerToken)).text);
  assert.ok(all.tasks.every((x) => !('builtForCaller' in x)), 'a row of the task-level list was flagged');
});

test('#9177: --mine --stale (quietDays) keeps the same rows open, flagged the same way', async (t) => {
  withProjects(t);
  const r = await get('/api/tasks?all=1&order=state&state=open&quietDays=1&mine=1', readerToken);
  assert.equal(r.code, 200, r.text.slice(0, 300));
  assert.deepEqual(sentences(r.text), ['shared old mark', 'shared other-marked', 'shared unmarked'], r.text.slice(0, 400));
  assert.equal(JSON.parse(r.text).tasks.find((x) => x.sentence === 'shared other-marked').builtForCaller, false);
});

test('#9177: held rows stay held for both holders, and only one carrying another holder\'s mark is flagged', async (t) => {
  withProjects(t);
  const held = await get('/api/tasks?all=1&order=state&state=held&mine=1', readerToken);
  assert.equal(held.code, 200, held.text.slice(0, 300));
  assert.deepEqual(sentences(held.text), ['held other-marked', 'held reader-marked', 'paused other-marked'], held.text.slice(0, 400));
  const rows = JSON.parse(held.text).tasks;
  assert.equal(rows.find((x) => x.sentence === 'held other-marked').builtForCaller, false, held.text.slice(0, 400));
  assert.equal('builtForCaller' in rows.find((x) => x.sentence === 'held reader-marked'), false, 'the reader\'s own mark was flagged');
  // The mark with no builtWho list covers nobody, so it is open and flagged, as another holder's mark is.
  const open = JSON.parse((await get('/api/tasks?all=1&order=state&state=open&mine=1', readerToken)).text).tasks;
  assert.equal(open.find((x) => x.sentence === 'shared old mark').builtForCaller, false);
});

test('#9177: in a paused project, another holder\'s mark leaves the task held for the reader, and the words say both', async (t) => {
  withProjects(t);
  const held = await get('/api/tasks?all=1&order=state&state=held&mine=1', readerToken);
  assert.equal(held.code, 200, held.text.slice(0, 300));
  const body = JSON.parse(held.text);
  const row = body.tasks.find((x) => x.sentence === 'paused other-marked');
  assert.ok(row, 'CONTROL: the paused project\'s task is not on the held list: ' + held.text.slice(0, 400));
  assert.equal(row.projectPaused, true, 'CONTROL: the row does not say its project is paused');
  assert.equal(row.builtForCaller, false);
  const printed = tasklist.acrossLines(body, 'blocked', { mine: true }).lines.find((l) => l.includes('paused other-marked'));
  assert.ok(printed, 'CONTROL: not printed');
  assert.match(printed, /your part is still open; its project is paused/, printed);
});
