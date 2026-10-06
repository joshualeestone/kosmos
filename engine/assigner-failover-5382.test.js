'use strict';
/* #5382: the Assigner's failover. With the setting's `failover` on, an agent whose card has read rate_limited for
 * FAILOVER_MS has its open parts given to an idle agent on the same project that runs on another provider. Real
 * inputs, as engine/assigner.test.js: board cards from test-support/fleet + status.snapshot(), commitments from
 * engine/commitments, projects and tasks from engine/projects + engine/tasks. Each rule has the arm that must move
 * work and the arm that must not.
 *
 *   node --test engine/assigner-failover-5382.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/projects (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'assigner-failover-'));
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
const asg = require('./assigner-setting');

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const T0 = 1_000_000_000_000;
const ON = { on: true, failover: true };
let seq = 0;

/* A board of agents, each reporting clear commitments, all on one fresh project. `paneState` and `runner` go to the
   fleet fixture. Returns the real cards, the session keys, the project id and a restore. */
function world(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle', runner: s.runner })));
  const key = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.sessionName === s.name) || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
    const r = commitments.report(key[s.name], []);
    assert.ok(r && r.ok !== false, 'fixture: commitments report refused: ' + JSON.stringify(r));
  }
  const p = projects.create({ name: 'Failover Test ' + (++seq) });
  for (const s of specs) if (s.member !== false) projects.addAgent(p.id, key[s.name], board.agents);
  const cards = status.snapshot().agents;
  const states = () => new Map(cards.filter(a.idleCard).map((c) => [c.sessionName, commitments.read(c.sessionName).state]));
  return { cards, key, pid: p.id, states, restore: board.restore };
}

/* A task with one part, given to `who` (as a person would, from the screen). */
function heldTask(pid, who, sentence) {
  const t = tasks.create(pid, { sentence, made: { via: 'screen' } });
  const partId = tasks.progressOf(t).parts[0].id;
  const r = tasks.assignPart(pid, t.number, partId, who, { via: 'screen' });
  assert.ok(r.ok, 'fixture: could not give the part: ' + JSON.stringify(r));
  return { n: t.number, partId };
}

/* Step at T0 (both clocks start), then once both the idle and the failover periods have passed. */
function later(w, extra = {}, cards = w.cards) {
  const base = { roster: cards, setting: ON, records: projects.readAll(), commitments: w.states() };
  const first = a.step({ prev: undefined, ...base, now: T0, ...extra });
  return a.step({ prev: first.next, ...base, now: T0 + Math.max(a.IDLE_MS, a.FAILOVER_MS), ...extra });
}

const card = (w, name) => w.cards.find((c) => c.sessionName === w.key[name]);

test('fixture control: a limited Claude card reads rate_limited, an idle Gemini-tagged card reads idle and gemini', () => {
  const w = world([{ name: 'fxlim', paneState: 'rate_limited' }, { name: 'fxgem', runner: 'gemini' }]);
  try {
    assert.equal(card(w, 'fxlim').state, 'rate_limited');
    assert.equal(card(w, 'fxlim').runner, 'claude');
    assert.equal(card(w, 'fxgem').state, 'idle');
    assert.equal(card(w, 'fxgem').runner, 'gemini');
    assert.ok(a.limitedCard(card(w, 'fxlim'), T0), 'the limited card is not one failover may take from');
    assert.equal(a.limitedCard(card(w, 'fxgem'), T0), false);
  } finally { w.restore(); }
});

test('moves: the limited agent\'s open part goes to the idle agent on another provider, with where it came from', () => {
  const w = world([{ name: 'mvlim', paneState: 'rate_limited' }, { name: 'mvgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.mvlim, 'write the deploy notes');
    const out = later(w);
    assert.equal(out.toAssign.length, 1, JSON.stringify(out.toAssign));
    assert.deepEqual(
      { s: out.toAssign[0].session, p: out.toAssign[0].projectId, n: out.toAssign[0].n, part: out.toAssign[0].partId, from: out.toAssign[0].from },
      { s: w.key.mvgem, p: w.pid, n: h.n, part: h.partId, from: w.key.mvlim });
  } finally { w.restore(); }
});

test('does not move with the failover setting off (the default)', () => {
  const w = world([{ name: 'offlim', paneState: 'rate_limited' }, { name: 'offgem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.offlim, 'write the deploy notes');
    assert.equal(later(w, { setting: { on: true } }).toAssign.length, 0);
    assert.equal(later(w, { setting: { on: true, failover: false } }).toAssign.length, 0);
    assert.equal(later(w).toAssign.length, 1, 'control: the same world with failover on moves the part');
  } finally { w.restore(); }
});

test('does not move to an agent on the SAME provider', () => {
  const w = world([{ name: 'samelim', paneState: 'rate_limited' }, { name: 'sameclaude' }]);
  try {
    heldTask(w.pid, w.key.samelim, 'write the deploy notes');
    assert.equal(later(w).toAssign.length, 0);
  } finally { w.restore(); }
});

test('does not move before FAILOVER_MS of reading rate_limited, and a card that stops reading it starts again', () => {
  const w = world([{ name: 'earlim', paneState: 'rate_limited' }, { name: 'eargem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.earlim, 'write the deploy notes');
    const base = { roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states() };
    const s0 = a.step({ prev: undefined, ...base, now: T0 });
    const early = a.step({ prev: s0.next, ...base, now: T0 + a.FAILOVER_MS - 1 });
    assert.equal(early.toAssign.length, 0, 'moved before the failover period');
    // The limited card reads idle for one tick: its clock is dropped, so the period starts over.
    const cleared = w.cards.map((c) => (c.sessionName === w.key.earlim ? { ...c, state: 'idle' } : c));
    const gap = a.step({ prev: early.next, ...base, roster: cleared, now: T0 + a.FAILOVER_MS - 1 });
    assert.equal(gap.next.limitedSince.has(w.key.earlim), false);
    const again = a.step({ prev: gap.next, ...base, now: T0 + a.FAILOVER_MS });
    assert.equal(again.toAssign.length, 0, 'the clock did not restart after the card stopped reading rate_limited');
    const ripe = a.step({ prev: again.next, ...base, now: T0 + 2 * a.FAILOVER_MS });
    assert.equal(ripe.toAssign.length, 1, 'control: FAILOVER_MS after it started reading rate_limited again, the part moves');
  } finally { w.restore(); }
});

test('waits out a limit whose known reset is within RESET_SOON_MS, and moves when the reset is further off', () => {
  const w = world([{ name: 'soonlim', paneState: 'rate_limited' }, { name: 'soongem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.soonlim, 'write the deploy notes');
    const at = T0 + Math.max(a.IDLE_MS, a.FAILOVER_MS);
    const withReset = (ms) => w.cards.map((c) => (c.sessionName === w.key.soonlim ? { ...c, quotaUntil: new Date(ms).toISOString() } : c));
    assert.equal(later(w, {}, withReset(at + a.RESET_SOON_MS)).toAssign.length, 0, 'moved work off an agent about to reset');
    assert.equal(later(w, {}, withReset(at + a.RESET_SOON_MS + 60 * 1000)).toAssign.length, 1, 'control: a reset further off moves it');
  } finally { w.restore(); }
});

test('never moves a part on hold, of a built task, or that is finished', () => {
  const w = world([{ name: 'hldlim', paneState: 'rate_limited' }, { name: 'hldgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.hldlim, 'write the deploy notes');
    assert.equal(later(w).toAssign.length, 1, 'control: the open part moves');
    const t = projects.readAll().find((p) => p.id === w.pid).tasks.find((x) => x.number === h.n);
    const recs = (mut) => projects.readAll().map((p) => (p.id !== w.pid ? p
      : { ...p, tasks: p.tasks.map((x) => (x.number === h.n ? mut(x) : x)) }));
    assert.equal(later(w, { records: recs((x) => ({ ...x, builtAt: '2026-10-06T00:00:00Z' })) }).toAssign.length, 0, 'moved a built task');
    assert.equal(later(w, { records: recs((x) => ({ ...x, addedVia: 'webhook' })) }).toAssign.length, 0, 'moved a webhook task');
    const closed = (x) => ({ ...x, parts: tasks.progressOf(x).parts.map((q) => ({ ...q, closedAt: '2026-10-06T00:00:00Z' })) });
    assert.equal(later(w, { records: recs(closed) }).toAssign.length, 0, 'moved a finished part');
    assert.ok(t, 'fixture: task not found');
  } finally { w.restore(); }
});

test('assignPart failover move: refused unless the part is still on the limited agent and open; a real move is recorded', () => {
  const w = world([{ name: 'aplim', paneState: 'rate_limited' }, { name: 'apgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.aplim, 'write the deploy notes');
    const made = { via: 'assigner', onlyIfWho: 'somebody-else', failover: true };
    assert.equal(tasks.assignPart(w.pid, h.n, h.partId, w.key.apgem, made).ok, false, 'moved a part off an agent it is not on');
    tasks.setPartClosed(w.pid, h.n, h.partId, new Date().toISOString());
    assert.equal(tasks.assignPart(w.pid, h.n, h.partId, w.key.apgem, { via: 'assigner', onlyIfWho: w.key.aplim, failover: true }).ok, false,
      'moved a finished part');
    tasks.setPartClosed(w.pid, h.n, h.partId, null);
    const ok = tasks.assignPart(w.pid, h.n, h.partId, w.key.apgem, { via: 'assigner', onlyIfWho: w.key.aplim, failover: true });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const part = tasks.progressOf(ok.task).parts.find((q) => Number(q.id) === Number(h.partId));
    assert.equal(part.who, w.key.apgem);
    assert.equal(part.movedVia, 'assigner');
  } finally { w.restore(); }
});

test('setting: failover reads off by default and on a file without it; setFailover keeps `on`, setOn keeps `failover`', () => {
  fs.rmSync(asg.FILE, { force: true });
  assert.equal(asg.read().failover, false);
  fs.mkdirSync(path.dirname(asg.FILE), { recursive: true });
  fs.writeFileSync(asg.FILE, JSON.stringify({ on: true }));
  assert.equal(asg.read().failover, false, 'a stored file without the flag must read failover off');
  assert.deepEqual(asg.setFailover(true), { ok: true });
  assert.deepEqual([asg.read().on, asg.read().failover], [true, true]);
  assert.deepEqual(asg.setOn(false), { ok: true });
  assert.deepEqual([asg.read().on, asg.read().failover], [false, true], 'setOn dropped failover');
  assert.equal(asg.setFailover('yes').ok, false);
  assert.equal(asg.read().failover, true, 'a refused value overwrote the stored failover');
  fs.writeFileSync(asg.FILE, JSON.stringify({ on: true, failover: 'true' }));
  assert.equal(asg.read().failover, false, 'only a real true turns failover on');
  fs.rmSync(asg.FILE, { force: true });
});
