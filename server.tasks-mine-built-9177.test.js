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
   1 marked built by other-agent only; 2 marked by the person (builtFreesAll); 3 marked by reader-agent only; 4 unmarked. */
function withProjects(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'projS', name: 'projS', agents: ['reader-agent', 'other-agent'], tasks: [
      { number: 1, sentence: 'shared other-marked', parts: both(), builtAt: AT, builtBy: 'other-agent', builtWho: ['other-agent'] },
      { number: 2, sentence: 'shared person-marked', parts: both(), builtAt: AT, builtByPerson: true, builtWho: [], builtFreesAll: true },
      { number: 3, sentence: 'shared reader-marked', parts: both(), builtAt: AT, builtBy: 'reader-agent', builtWho: ['reader-agent'] },
      { number: 4, sentence: 'shared unmarked', parts: both() },
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
  assert.equal(tasks.listGroup(other, 'reader-agent'), 'open');
  assert.equal(tasks.listGroup({ ...other, projectPaused: true }, 'reader-agent'), 'held');
  // A mark with no builtWho list (older than per-agent marks) cannot say whose it is, so it reads built for everyone.
  assert.equal(tasks.listGroup({ builtAt: AT }, 'reader-agent'), 'built');
  assert.equal(tasks.listGroup({ builtAt: AT, builtWho: [] }, 'reader-agent'), 'open', 'an unnamed caller\'s mark frees nobody');
});

test('#9177: --mine open keeps a shared task another holder marked built; --mine built keeps only the asker\'s', async (t) => {
  withProjects(t);
  const open = await get('/api/tasks?all=1&order=state&state=open&mine=1', readerToken);
  assert.equal(open.code, 200, open.text.slice(0, 300));
  assert.deepEqual(sentences(open.text), ['shared other-marked', 'shared unmarked'], open.text.slice(0, 400));
  const built = await get('/api/tasks?all=1&order=state&state=built&mine=1', readerToken);
  assert.equal(built.code, 200, built.text.slice(0, 300));
  assert.deepEqual(sentences(built.text), ['shared person-marked', 'shared reader-marked'], built.text.slice(0, 400));
  // The other holder sees the mirror image: its own mark is built for it, the reader's is still open.
  const otherOpen = await get('/api/tasks?all=1&order=state&state=open&mine=1', otherToken);
  assert.deepEqual(sentences(otherOpen.text), ['shared reader-marked', 'shared unmarked'], otherOpen.text.slice(0, 400));
});

test('#9177: one project with --mine reads the same rule', async (t) => {
  withProjects(t);
  const open = await get('/api/tasks?project=projS&order=state&state=open&mine=1', readerToken);
  assert.equal(open.code, 200, open.text.slice(0, 300));
  assert.deepEqual(sentences(open.text), ['shared other-marked', 'shared unmarked'], open.text.slice(0, 400));
});

test('#9177: GET /api/tasks/mine keeps a shared task another holder marked built', async (t) => {
  withProjects(t);
  const r = await get('/api/tasks/mine', readerToken);
  assert.equal(r.code, 200, r.text.slice(0, 300));
  assert.deepEqual(sentences(r.text), ['shared other-marked', 'shared unmarked'], r.text.slice(0, 400));
});

test('CONTROL: without mine=1 the list is the task-level view, so any mark is built', async (t) => {
  withProjects(t);
  const built = await get('/api/tasks?project=projS&order=state&state=built', readerToken);
  assert.equal(built.code, 200, built.text.slice(0, 300));
  assert.deepEqual(sentences(built.text), ['shared other-marked', 'shared person-marked', 'shared reader-marked'], built.text.slice(0, 400));
});
