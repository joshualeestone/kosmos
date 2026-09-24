'use strict';
/* #3595 phase 2: the Assigner's pure step, on REAL inputs throughout: board cards from
 * test-support/fleet + status.snapshot(), commitments written by engine/commitments, and projects
 * and tasks made by engine/projects + engine/tasks. Every rule is tested with the arm that must
 * fire AND the arm that must not.
 *
 *   node --test engine/assigner.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/projects (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'assigner-'));
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

/* A board of agents (idle unless paneState says otherwise), each reporting `clear` commitments
   unless `commit` says otherwise, and a fresh project they all belong to. Returns the real cards,
   the session keys, the project id, and a restore. */
function world(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle' })));
  const key = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.sessionName === s.name) || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
    if (s.commit !== 'none') {
      const r = commitments.report(key[s.name], s.commit === 'holding' ? [{ what: 'finishing the export' }] : []);
      assert.ok(r && r.ok !== false, 'fixture: commitments report refused: ' + JSON.stringify(r));
    }
  }
  const p = projects.create({ name: 'Assigner Test ' + (++seq) });
  for (const s of specs) if (s.member !== false) projects.addAgent(p.id, key[s.name], board.agents);
  const cards = status.snapshot().agents;
  const states = () => new Map(cards.filter(a.idleCard).map((c) => [c.sessionName, commitments.read(c.sessionName).state]));
  return { cards, key, pid: p.id, states, restore: board.restore };
}

const addTask = (pid, sentence, extra = {}) => tasks.create(pid, { sentence, made: { via: 'screen' }, ...extra });

/* Step twice: once to be seen idle, once after the idle period. */
function afterIdle(w, extra = {}) {
  const base = { roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states() };
  const first = a.step({ prev: undefined, ...base, now: T0, ...extra });
  return a.step({ prev: first.next, ...base, now: T0 + a.IDLE_MS, ...extra });
}

test('fixture control: real cards read idle and real commitments read clear / holding / unknown', () => {
  const w = world([{ name: 'ctlclear' }, { name: 'ctlhold', commit: 'holding' }, { name: 'ctlnone', commit: 'none' }]);
  try {
    const st = w.states();
    assert.equal(st.get(w.key.ctlclear), 'clear');
    assert.equal(st.get(w.key.ctlhold), 'holding');
    assert.equal(st.get(w.key.ctlnone), 'unknown');
    assert.ok(w.cards.filter((c) => Object.values(w.key).includes(c.sessionName)).every(a.idleCard), 'fixture: not every card reads idle and ours');
  } finally { w.restore(); }
});

test('an idle, clear agent with no work gets a task after the idle period; not before', () => {
  const w = world([{ name: 'idl' }]);
  try {
    addTask(w.pid, 'write the release notes');
    const base = { roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states() };
    const early = a.step({ prev: undefined, ...base, now: T0 });
    assert.equal(early.toAssign.length, 0, 'assigned before the idle period');
    const late = afterIdle(w);
    assert.equal(late.toAssign.length, 1);
    assert.equal(late.toAssign[0].session, w.key.idl);
    assert.equal(late.toAssign[0].projectId, w.pid);
  } finally { w.restore(); }
});

test('holding or unknown commitments are never assigned; clear is (control)', () => {
  const w = world([{ name: 'cmclear' }, { name: 'cmhold', commit: 'holding' }, { name: 'cmnone', commit: 'none' }]);
  try {
    addTask(w.pid, 'task one'); addTask(w.pid, 'task two'); addTask(w.pid, 'task three');
    assert.deepEqual(afterIdle(w).toAssign.map((x) => x.session), [w.key.cmclear]);
  } finally { w.restore(); }
});

test('a working agent, or one outside the project, is not assigned', () => {
  const w = world([{ name: 'wkbusy', paneState: 'working' }, { name: 'wkout', member: false }, { name: 'wkin' }]);
  try {
    addTask(w.pid, 'task one'); addTask(w.pid, 'task two');
    assert.deepEqual(afterIdle(w).toAssign.map((x) => x.session), [w.key.wkin]);
  } finally { w.restore(); }
});

test('an agent with an open part assigned to it is not idle for assignment; a closed one does not count', () => {
  const w = world([{ name: 'hasw' }]);
  try {
    const t = addTask(w.pid, 'already mine', { who: w.key.hasw });
    addTask(w.pid, 'nobody is on this');
    assert.equal(afterIdle(w).toAssign.length, 0, 'an agent with open work was given more');
    tasks.close(w.pid, t.task ? t.task.number : t.number);
    assert.equal(afterIdle(w).toAssign.length, 1, 'a closed task still counted as work');
  } finally { w.restore(); }
});

test('only a task nobody is on is given: never an assigned one, never a closed one', () => {
  const w = world([{ name: 'pkme' }, { name: 'pkother', commit: 'holding' }]);
  try {
    addTask(w.pid, 'someone has this', { who: w.key.pkother });
    const done = addTask(w.pid, 'finished already');
    tasks.close(w.pid, done.task ? done.task.number : done.number);
    assert.equal(afterIdle(w).toAssign.length, 0, 'an assigned or closed task was handed out');
    addTask(w.pid, 'free one');
    const out = afterIdle(w);
    assert.equal(out.toAssign.length, 1);
    const n = out.toAssign[0].n;
    assert.equal(tasks.byNumber(projects.readAll().find((p) => p.id === w.pid), n).sentence, 'free one');
  } finally { w.restore(); }
});

test('order: soonest due date first, then the oldest; an undated task comes after dated ones', () => {
  const w = world([{ name: 'ord' }]);
  try {
    const n = (r) => (r.task ? r.task.number : r.number);
    const old = n(addTask(w.pid, 'oldest, no date'));
    const late = n(addTask(w.pid, 'due later'));
    const soon = n(addTask(w.pid, 'due sooner'));
    tasks.setDue(w.pid, late, '2031-06-01');
    tasks.setDue(w.pid, soon, '2031-01-01');
    assert.equal(afterIdle(w).toAssign[0].n, soon, 'the soonest due task was not first');
    tasks.setDue(w.pid, soon, null);
    tasks.setDue(w.pid, late, null);
    assert.equal(afterIdle(w).toAssign[0].n, old, 'with no dates, the oldest was not first');
  } finally { w.restore(); }
});

test('two idle agents in one project never get the same task in one step', () => {
  const w = world([{ name: 'twa' }, { name: 'twb' }]);
  try {
    addTask(w.pid, 'only task');
    const out = afterIdle(w);
    assert.equal(out.toAssign.length, 1, 'one task was handed to two agents');
    addTask(w.pid, 'second task');
    const both = afterIdle(w);
    assert.equal(new Set(both.toAssign.map((x) => x.n)).size, 2);
  } finally { w.restore(); }
});

test('an archived project is never assigned from', () => {
  const w = world([{ name: 'arch' }]);
  try {
    addTask(w.pid, 'in an archived project');
    projects.setArchived(w.pid, true);
    assert.equal(afterIdle(w).toAssign.length, 0);
  } finally { w.restore(); }
});

test('caps: one per agent per hour, and MAX_PER_HOUR overall', () => {
  const w = world([{ name: 'cap' }]);
  try {
    addTask(w.pid, 'one'); addTask(w.pid, 'two');
    const first = afterIdle(w);
    assert.equal(first.toAssign.length, 1);
    // Pretend the given task was then finished: the agent is idle with work available again.
    const again = a.step({ prev: first.next, roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states(), now: T0 + a.IDLE_MS + 60000 });
    assert.equal(again.toAssign.length, 0, 'the per-agent hourly cap did not hold');
    const hourLater = a.step({ prev: again.next, roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states(), now: T0 + a.IDLE_MS + 61 * 60 * 1000 });
    assert.equal(hourLater.toAssign.length, 1, 'the per-agent budget never came back');
  } finally { w.restore(); }
  const names = Array.from({ length: a.MAX_PER_HOUR + 2 }, (_, i) => 'capall' + i);
  const many = world(names.map((n) => ({ name: n })));
  try {
    for (const n of names) addTask(many.pid, 'task for ' + n);
    assert.equal(afterIdle(many).toAssign.length, a.MAX_PER_HOUR, 'the overall hourly cap did not hold');
  } finally { many.restore(); }
});

test('a failed roster read keeps the memory; OFF does nothing and forgets it', () => {
  const w = world([{ name: 'nullr' }]);
  try {
    addTask(w.pid, 'a task');
    const base = { setting: ON, records: projects.readAll(), commitments: w.states() };
    const seen = a.step({ prev: undefined, roster: w.cards, ...base, now: T0 });
    const failed = a.step({ prev: seen.next, roster: null, ...base, now: T0 + a.IDLE_MS });
    assert.equal(failed.toAssign.length, 0);
    assert.equal(failed.next, seen.next, 'a read failure dropped the memory');
    const off = a.step({ prev: seen.next, roster: w.cards, ...base, setting: { on: false }, now: T0 + a.IDLE_MS });
    assert.equal(off.toAssign.length, 0, 'assigned while OFF');
    assert.equal(off.next.idleSince.size, 0);
  } finally { w.restore(); }
});

test('idle must be continuous: a tick of work resets the clock', () => {
  const w = world([{ name: 'cont' }]);
  try {
    addTask(w.pid, 'a task');
    const base = { roster: w.cards, setting: ON, records: projects.readAll() };
    const seen = a.step({ prev: undefined, ...base, commitments: w.states(), now: T0 });
    const busy = a.step({ prev: seen.next, ...base, commitments: new Map([[w.key.cont, 'holding']]), now: T0 + a.IDLE_MS / 2 });
    const back = a.step({ prev: busy.next, ...base, commitments: w.states(), now: T0 + a.IDLE_MS });
    assert.equal(back.toAssign.length, 0, 'idle time carried across a busy tick');
    const later = a.step({ prev: back.next, ...base, commitments: w.states(), now: T0 + 2 * a.IDLE_MS });
    assert.equal(later.toAssign.length, 1);
  } finally { w.restore(); }
});

test('runOnce: gives through the injected path; a refusal takes its budget charge back', () => {
  const w = world([{ name: 'run' }]);
  try {
    addTask(w.pid, 'a task');
    const calls = [];
    let answer = { ok: false, because: 'the parts valve is full' };
    const give = (pid, n, part, who) => { calls.push([pid, n, part, who]); return answer; };
    const base = { roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states(), give };
    const seen = a.runOnce({ prev: undefined, ...base, now: T0 });
    const refused = a.runOnce({ prev: seen.next, ...base, now: T0 + a.IDLE_MS });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), [w.pid, 1]);
    assert.equal(calls[0][3], w.key.run);
    assert.equal(refused.acted[0].ok, false);
    assert.equal(refused.next.log.length, 0, 'a refused give spent the hourly budget');
    answer = { ok: true, heard: { state: 'placed' } };
    const given = a.runOnce({ prev: refused.next, ...base, now: T0 + a.IDLE_MS + 60000 });
    assert.equal(given.acted[0].ok, true, 'a refusal blocked the retry');
    assert.equal(given.next.log.length, 1);
    const boom = a.runOnce({ prev: seen.next, ...base, give: () => { throw new Error('x'); }, now: T0 + a.IDLE_MS });
    assert.equal(boom.acted[0].ok, false, 'a throwing give crashed or counted as given');
  } finally { w.restore(); }
});
