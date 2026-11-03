'use strict';

/**
 * kosmos#7875 item 3 (agent feedback, 11-03): a built task gave no sign the person had looked at it, so an agent could
 * not tell whether to raise it again or wait. `GET /api/tasks` on the built list now carries, per row, when the person
 * last viewed the task (engine/taskseen.js, #6947), and engine/tasklist.js (both CLIs) prints whether that was since
 * the task was built.
 *
 * Same harness as server.tasks-across-7057.test.js: the board boots fully sandboxed, then enforces a board token.
 *
 *   node --test server.tasks-builtseen-7875.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtseen-7875-'));
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
const taskseen = require('./engine/taskseen');
const tasklist = require('./engine/tasklist');

const BOARD = 'BOARDTOKEN_test_7875_builtseen_0123456789ab';
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
  const res = await fetch(base + p, { headers: { 'x-kosmos-board-token': BOARD } });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { code: res.status, text, json };
}
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
function withProjects(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'seen7875', name: 'Seen', agents: ['dana'], createdAt: ago(60), tasks: [
      { number: 1, sentence: 'built, viewed since', state: 'open', createdAt: ago(10), builtAt: ago(2), builtBy: 'dana' },
      { number: 2, sentence: 'built, never viewed', state: 'open', createdAt: ago(10), builtAt: ago(2), builtBy: 'dana' },
      { number: 3, sentence: 'still open', state: 'open', createdAt: ago(10) },
      /* Viewed, then built AFTER the view (builtAt in the future of the view recorded in the test): not seen since. */
      { number: 4, sentence: 'viewed before it was built', state: 'open', createdAt: ago(10), builtAt: new Date(Date.now() + DAY).toISOString(), builtBy: 'dana' },
      { number: 5, sentence: 'marked built by the person', state: 'open', createdAt: ago(10), builtAt: ago(1), builtByPerson: true },
    ] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
}
const row = (r, n) => r.json.tasks.find((x) => x.number === n);

test('#7875: the built list carries when the person last viewed each task; other lists do not', async (t) => {
  withProjects(t);
  assert.ok(taskseen.markSeen('seen7875', 1), 'could not record the view of #1');
  assert.ok(taskseen.markSeen('seen7875', 4), 'could not record the view of #4');
  const r = await call('/api/tasks?project=seen7875&order=state&state=built');
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.equal(r.json.listState, 'built');
  assert.equal(typeof row(r, 1).seenByPerson, 'string');
  assert.ok(Number.isFinite(Date.parse(row(r, 1).seenByPerson)));
  assert.ok(Object.prototype.hasOwnProperty.call(row(r, 2), 'seenByPerson'), 'a never-viewed built row says so (null), not nothing');
  assert.equal(row(r, 2).seenByPerson, null);
  const lines = tasklist.compactLines(r.json, 'built', 'seen7875').lines;
  assert.ok(lines.some((l) => l.startsWith('#1  built') && l.endsWith('(seen by the person since built)')), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('#2  built') && l.endsWith('(not seen by the person since built)')), lines.join('\n'));
  // Through the real board: a view before the build reads "not seen", and the person's own mark says so.
  assert.ok(lines.some((l) => l.startsWith('#4  built') && l.endsWith('(not seen by the person since built)')), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('#5  built') && l.endsWith('(marked built by the person)')), lines.join('\n'));
  /* CONTROL: the open list is unchanged (no field, so nothing printed). */
  const open = await call('/api/tasks?project=seen7875&order=state&state=open');
  assert.equal(open.code, 200);
  assert.ok(open.json.tasks.every((x) => !Object.prototype.hasOwnProperty.call(x, 'seenByPerson')), 'the open list gained the field');
});

test('#7875: the built list across every project carries it too', async (t) => {
  withProjects(t);
  assert.ok(taskseen.markSeen('seen7875', 1), 'could not record the view of #1');   // its own view: runs alone too
  const r = await call('/api/tasks?all=1&order=state&state=built');
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.equal(r.json.all, true);
  const lines = tasklist.acrossLines(r.json, 'built', { project: '' }).lines;
  assert.ok(lines.some((l) => l.includes('#2  built') && l.endsWith('(not seen by the person since built)')), lines.join('\n'));
  // #1's view (recorded above) must reach the all-projects list too: a row keyed without its project would read "not seen".
  assert.ok(lines.some((l) => l.includes('#1  built') && l.endsWith('(seen by the person since built)')), lines.join('\n'));
});

test('#7875: seenWords: since the build, before it, never, and an older board that sends nothing', () => {
  const built = '2026-11-03T10:00:00.000Z';
  assert.equal(tasklist.seenWords({ builtAt: built, seenByPerson: '2026-11-03T11:00:00.000Z' }), '  (seen by the person since built)');
  assert.equal(tasklist.seenWords({ builtAt: built, seenByPerson: '2026-11-03T09:00:00.000Z' }), '  (not seen by the person since built)');
  assert.equal(tasklist.seenWords({ builtAt: built, seenByPerson: null }), '  (not seen by the person since built)');
  assert.equal(tasklist.seenWords({ builtAt: built }), '', 'no field (an older board): nothing said');
  assert.equal(tasklist.seenWords({ seenByPerson: '2026-11-03T11:00:00.000Z' }), '  (seen by the person since built)', 'no build time: a view counts');
  assert.equal(tasklist.seenWords({ builtAt: built, builtByPerson: true, seenByPerson: null }), '  (marked built by the person)', 'the person marked it: never "not seen"');
});
