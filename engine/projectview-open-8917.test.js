'use strict';
/* kosmos#8917 (feedback, 2026-11-22): `kosmos project show` printed "N open (M built)", counting built and held tasks as
   open, while `kosmos task list <id> --state open` excludes both, so "no open tasks" from one meant nearly the opposite
   of the other. The summary now counts the task list's own groups (open, built, held, done) by the list's own rule
   (tasks.listGroup) and says each in the list's words, so every number it prints is what `--state <group>` lists. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'projectview-8917-'));
process.env.AGENT_WORKFORCE_DATA = path.join(DIR, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(DIR, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(DIR, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./projectview');
const projects = require('./projects');
const tasks = require('./tasks');
const fleet = require('../test-support/fleet');

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const NOW = Date.parse('2026-11-22T17:00:00Z');
/* Real rows: fleet's cards through projects.describe, never a hand-built row (fixture-discipline). */
const BOARD = fleet.install([fleet.agent('mark', { state: 'idle', role: 'Project Manager' })]);
test.after(() => BOARD.restore());
const TASKS = [
  { number: 1, sentence: 'not started', state: 'open' },
  { number: 2, sentence: 'built, waiting for review', state: 'open', builtAt: '2026-11-22T16:00:00Z' },
  { number: 3, sentence: 'held by its own hold', state: 'open', onHold: true },
  { number: 4, sentence: 'built and then held', state: 'open', builtAt: '2026-11-22T15:00:00Z', onHold: true },
  { number: 5, sentence: 'closed', state: 'closed', closedAt: '2026-11-22T14:00:00Z' },
];
const overview = (raw) => v.overviewOf(projects.describe(raw, BOARD.agents, [raw]), BOARD.agents,
  { now: NOW, folderOf: (n) => path.join(DIR, 'none-' + n), readBrief: () => ({ goal: null, done: null, found: false }) });
// What `kosmos task list --state <group>` holds, by the list's own rule.
const listCounts = (rows, paused) => {
  const c = { open: 0, built: 0, held: 0, done: 0 };
  for (const t of rows) c[tasks.listGroup(paused ? { ...t, projectPaused: true } : t)] += 1;
  return c;
};

test('#8917: the summary counts the task list\'s own groups, so built and held tasks are not counted as open', () => {
  const raw = { id: 'cat', name: 'Catalogue', folder: '/p/cat', agents: ['mark'], tasks: TASKS };
  const o = overview(raw);
  const want = listCounts(projects.describe(raw, BOARD.agents, [raw]).tasks, false);
  assert.deepEqual(want, { open: 1, built: 1, held: 2, done: 1 }, 'CONTROL: the fixture does not hold one task of each kind');
  assert.deepEqual(o.tasks.groups, want, 'the summary\'s groups are not the task list\'s');
  // `open` (every task not closed) is kept for older readers; it is no longer what is printed as open.
  assert.equal(o.tasks.open, 4);
  const text = v.renderShow({ project: o }).join('\n');
  assert.match(text, /^Tasks: 1 open, 1 built, 2 on hold, 1 done\. List them: kosmos task list cat$/m);
  assert.doesNotMatch(text, /4 open/, 'built and held tasks were counted as open again');
});

test('#8917: in a paused project, open work counts as on hold and built work as built, as the task list groups it', () => {
  const raw = { id: 'pz', name: 'Paused', folder: '/p/pz', agents: ['mark'], paused: true, tasks: TASKS.slice(0, 2).concat(TASKS[4]) };
  const o = overview(raw);
  assert.deepEqual(o.tasks.groups, listCounts(projects.describe(raw, BOARD.agents, [raw]).tasks, true));
  assert.deepEqual(o.tasks.groups, { open: 0, built: 1, held: 1, done: 1 });
  assert.match(v.renderShow({ project: o }).join('\n'), /^Tasks: 0 open, 1 built, 1 on hold, 1 done\. /m);
});

test('#8917: an older board sends no groups, and its line keeps the old words', () => {
  const line = v.renderList({ projects: [{ id: 'old', name: 'Old', members: 1, families: ['Claude'], tasks: { total: 3, open: 2, built: 1 } }] })[0];
  assert.match(line, /tasks: 2 open \(1 built\), 1 done/);
});
