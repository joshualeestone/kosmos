'use strict';
/**
 * #6072: /api/projects carries each project's `goalAskGaveUp`, read from the running Assigner's memory: when Kosmos
 * tried MAX_ASK_FAILS times today to ask an agent to plan work toward the project's goal and reached nobody.
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gaveup-6072-'));
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
const { start, server, ASSIGNER_VIEW } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const assigner = require('./engine/assigner');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const listed = async () => (await (await fetch(`${base}/api/projects`)).json()).projects;

test('a project the Assigner gave up on today carries who it could not reach; another carries null', async () => {
  const stalled = projects.create({ name: 'Stalled6072' });
  const fine = projects.create({ name: 'Fine6072' });
  const mem = assigner.restoredMemory({ v: 1 }, Date.now());
  const at = Date.now() - 60 * 1000;
  mem.askGaveUp.set(stalled.id, { at, tries: assigner.MAX_ASK_FAILS, agent: 'Echo', because: 'could_not' });
  const before = ASSIGNER_VIEW.mem;
  ASSIGNER_VIEW.mem = mem;
  try {
    const rows = await listed();
    const s = rows.find((p) => p.id === stalled.id);
    const f = rows.find((p) => p.id === fine.id);
    assert.ok(s && f, 'fixture: a project is missing from the list');
    assert.deepEqual(s.goalAskGaveUp, { at, tries: assigner.MAX_ASK_FAILS, agent: 'Echo', because: 'could_not' });
    assert.equal(f.goalAskGaveUp, null, 'a project nothing gave up on carries a give-up');
    tasks.create(stalled.id, { sentence: 'Plan the next step', made: { via: 'screen' } });
    assert.equal((await listed()).find((p) => p.id === stalled.id).goalAskGaveUp, null, 'open work, yet the goal reads as stalled');
  } finally { ASSIGNER_VIEW.mem = before; }
});

test('with no Assigner memory (it never ran) every project carries null, never a 500', async () => {
  const p = projects.create({ name: 'NoMem6072' });
  const before = ASSIGNER_VIEW.mem;
  ASSIGNER_VIEW.mem = null;
  try {
    const res = await fetch(`${base}/api/projects`);
    assert.equal(res.status, 200);
    const row = (await res.json()).projects.find((x) => x.id === p.id);
    assert.ok(row, 'fixture: the project is missing');
    assert.equal(row.goalAskGaveUp, null);
  } finally { ASSIGNER_VIEW.mem = before; }
});
