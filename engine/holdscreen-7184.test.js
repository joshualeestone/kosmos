'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#7184: the task page shows what a held task waits for, and whether it has happened, from the board's own
 * reading. projects.list serves each task's `holdUntil` (tasks.holdUntilState: { words, met }, or null), so the page
 * never works out "met" itself (engine/projects.js joinTaskClaims, withParts).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdscreen-7184.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hs-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hs-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hs-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const fleet = require('../test-support/fleet');
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(FLEET_ROOT, { recursive: true, force: true }); });
const BASE = fleet.install(['ada'].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
const ADA = (BASE.find((c) => (c.sessionName || '').startsWith('ada')) || {}).sessionName;

const HOUR = 3600000;
const served = (id, n) => (projects.list(null).find((x) => x.id === id).tasks || []).find((t) => t.number === n);

function fixture() {
  const p = projects.create({ name: 'Supplier ' + Math.random().toString(36).slice(2) });
  const a = tasks.create(p.id, { sentence: 'Order the parts' }).number;
  const b = tasks.create(p.id, { sentence: 'Get the price approved' }).number;
  projects.mutate(p.id, (x) => ({ ...x, agents: [ADA], tasks: x.tasks.map((t) => ({ ...t, who: ADA })) }));
  return { id: p.id, a, b };
}

test('#7184: a held task is served with what it waits for, and whether that has happened', () => {
  const f = fixture();
  assert.equal(served(f.id, f.a).holdUntil, null, 'CONTROL: a task not on hold waits for nothing');
  tasks.setOnHold(f.id, f.a, true);
  assert.equal(served(f.id, f.a).holdUntil, null, 'a hold with no condition waits for nothing');
  tasks.setOnHold(f.id, f.a, true, { viaScreen: true, until: { task: f.b } });
  assert.deepEqual(served(f.id, f.a).holdUntil, { words: 'task #' + f.b + ' is closed', met: false });
  projects.mutate(f.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === f.b ? { ...t, closedAt: new Date().toISOString() } : t)) }));
  assert.deepEqual(served(f.id, f.a).holdUntil, { words: 'task #' + f.b + ' is closed', met: true }, 'the awaited task closed');
});

test('#7184: a time condition is served as the stored time, met once it has passed; a task that is gone counts as met', () => {
  const f = fixture();
  const at = new Date(Date.now() + 2 * HOUR).toISOString();
  tasks.setOnHold(f.id, f.a, true, { viaScreen: true, until: { at } });
  assert.deepEqual(served(f.id, f.a).holdUntil, { words: at, met: false });
  projects.mutate(f.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === f.a ? { ...t, onHoldUntil: { at: new Date(Date.now() - HOUR).toISOString() } } : t)) }));
  assert.equal(served(f.id, f.a).holdUntil.met, true, 'a time that has passed');
  const g = fixture();
  tasks.setOnHold(g.id, g.a, true, { viaScreen: true, until: { task: g.b } });
  projects.mutate(g.id, (x) => ({ ...x, tasks: x.tasks.filter((t) => t.number !== g.b) }));
  assert.deepEqual(served(g.id, g.a).holdUntil, { words: 'task #' + g.b + ' is closed', met: true }, 'the awaited task is gone');
  tasks.setOnHold(g.id, g.a, false, { viaScreen: true });
  assert.equal(served(g.id, g.a).holdUntil, null, 'off hold: nothing is waited for');
});
