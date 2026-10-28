'use strict';
/* #7429: the Assigner hands no task to an agent whose role on the project is review only, and moves no stalled part to
 * one. Real cards, commitments and projects, as engine/assigner.test.js builds them; every rule with the arm that
 * must fire and the arm that must not.
 *
 *   node --test engine/assigner-role-7429.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/projects (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'assigner-role-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const projects = require('./projects');
const tasks = require('./tasks');
const commitments = require('./commitments');
const a = require('./assigner');

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const T0 = 1_000_000_000_000;
const ON = { on: true };
let seq = 0;

function world(names) {
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  const key = {};
  for (const n of names) {
    const card = board.agents.find((c) => c.sessionName === n) || board.agents.find((c) => (c.sessionName || '').startsWith(n));
    key[n] = card ? card.sessionName : n;
    const r = commitments.report(key[n], []);
    assert.ok(r && r.ok !== false, 'fixture: commitments report refused: ' + JSON.stringify(r));
  }
  const p = projects.create({ name: 'Assigner Role Test ' + (++seq) });
  for (const n of names) projects.addAgent(p.id, key[n], board.agents);
  const cards = status.snapshot().agents;
  const states = () => new Map(cards.filter(a.idleCard).map((c) => [c.sessionName, commitments.read(c.sessionName).state]));
  return { cards, key, pid: p.id, states, restore: board.restore };
}

const addTask = (pid, sentence) => tasks.create(pid, { sentence, made: { via: 'screen' } });

function afterIdle(w) {
  const base = { roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states() };
  const first = a.step({ prev: undefined, ...base, now: T0 });
  return a.step({ prev: first.next, ...base, now: T0 + a.IDLE_MS });
}

test('reviewOnlyHere: a review word and no making word; free text read case-blind', () => {
  const p = (role) => ({ rolesHere: { s: role } });
  for (const role of ["reviews the builders' work", 'Code reviewer', 'QA', 'REVIEW ONLY', 'reviewing PRs and designs']) {
    assert.equal(projects.reviewOnlyHere(p(role), 's'), true, role);
  }
  for (const role of ['builds and reviews', 'builder and reviewer', 'reviewer who also develops', 'builder',
    'reviews and fixes what it finds', 'writes the release notes',
    'previews the site', 'implements the API', '']) {
    assert.equal(projects.reviewOnlyHere(p(role), 's'), false, JSON.stringify(role));
  }
  assert.equal(projects.reviewOnlyHere({}, 's'), false, 'no role at all');
  assert.equal(projects.reviewOnlyHere(p('reviewer'), 'other'), false, 'another member\'s role');
});

test('an agent whose role here is review only is not handed a task; with the role cleared it is (control)', () => {
  const w = world(['rvwr', 'bldr']);
  try {
    projects.setRoleHere(w.pid, w.key.rvwr, "reviews the builders' work");
    addTask(w.pid, 'task one'); addTask(w.pid, 'task two');
    assert.deepEqual(afterIdle(w).toAssign.map((x) => x.session), [w.key.bldr], 'the reviewer was handed a task');
    projects.setRoleHere(w.pid, w.key.rvwr, '');
    assert.deepEqual(afterIdle(w).toAssign.map((x) => x.session).sort(), [w.key.rvwr, w.key.bldr].sort());
  } finally { w.restore(); }
});

test('a reviewer with every other agent busy still gets nothing, and a role that also builds does (control)', () => {
  const w = world(['solo']);
  try {
    addTask(w.pid, 'the only task');
    projects.setRoleHere(w.pid, w.key.solo, 'QA');
    assert.equal(afterIdle(w).toAssign.length, 0, 'a QA-only agent was handed the task');
    projects.setRoleHere(w.pid, w.key.solo, 'builds and reviews');
    assert.deepEqual(afterIdle(w).toAssign.map((x) => x.session), [w.key.solo]);
  } finally { w.restore(); }
});

test('failoverPick moves no stalled part to a reviewer; to a builder it does (control)', () => {
  // The shape engine/assigner.test.js's #5678 failover tests use.
  const stalled = [{ projectId: 'pf', n: 1, partId: 1, from: 'stuck', fromRunner: 'claude' }];
  const proj = (role) => [{
    id: 'pf', agents: ['stuck', 'idle'], rolesHere: role ? { idle: role } : {},
    tasks: [{ number: 1, sentence: 'Stalled', who: 'stuck' }],
  }];
  assert.equal(a.failoverPick('idle', 'codex', stalled, proj('code reviewer'), new Set()), null);
  const moved = a.failoverPick('idle', 'codex', stalled, proj(null), new Set());
  assert.ok(moved && moved.n === 1, 'control: a builder takes the stalled part: ' + JSON.stringify(moved));
});
