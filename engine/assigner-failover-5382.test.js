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
  /* The fleet fixture's limit line carries no reset time, and the failover acts only on a limit it can date (review 6), so
     a limited card gets a reset six hours out, as Antigravity's report would give it, unless the spec says undated. */
  const dated = new Set(specs.filter((s) => s.undated !== true).map((s) => s.name));
  const cards = status.snapshot().agents.map((c) => {
    const spec = Object.keys(key).find((n) => key[n] === c.sessionName);
    return c.state === 'rate_limited' && dated.has(spec) ? { ...c, quotaUntil: new Date(T0 + 6 * 3600 * 1000).toISOString() } : c;
  });
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
    const cleared = w.cards.map((c) => (c.sessionName === w.key.earlim ? { ...c, state: 'idle' } : c));
    // The receiver's idle clock starts at T0 while the limited card does not yet read rate_limited, so by L0 the
    // receiver has been idle for IDLE_MS and only the failover period can hold the move back.
    const s0 = a.step({ prev: undefined, ...base, roster: cleared, now: T0 });
    const L0 = T0 + a.IDLE_MS;
    const s1 = a.step({ prev: s0.next, ...base, now: L0 });
    assert.equal(s1.toAssign.length, 0, 'moved the moment the card read rate_limited');
    const early = a.step({ prev: s1.next, ...base, now: L0 + a.FAILOVER_MS - 1 });
    assert.equal(early.toAssign.length, 0, 'moved before the failover period');
    // The limited card reads idle for one tick: its clock is dropped, so the period starts over.
    const gap = a.step({ prev: early.next, ...base, roster: cleared, now: L0 + a.FAILOVER_MS - 1 });
    assert.equal(gap.next.limitedSince.has(w.key.earlim), false);
    const again = a.step({ prev: gap.next, ...base, now: L0 + a.FAILOVER_MS });
    assert.equal(again.toAssign.length, 0, 'the clock did not restart after the card stopped reading rate_limited');
    const ripe = a.step({ prev: again.next, ...base, now: L0 + 2 * a.FAILOVER_MS });
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

test('a shared-pool reset (poolUntil) within RESET_SOON_MS is waited out too, and a card not ours is never taken from', () => {
  const w = world([{ name: 'poollim', paneState: 'rate_limited' }, { name: 'poolgem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.poollim, 'write the deploy notes');
    const at = T0 + Math.max(a.IDLE_MS, a.FAILOVER_MS);
    const edit = (patch) => w.cards.map((c) => (c.sessionName === w.key.poollim ? { ...c, ...patch } : c));
    assert.equal(later(w, {}, edit({ quotaUntil: null, poolUntil: new Date(at + a.RESET_SOON_MS).toISOString() })).toAssign.length, 0,
      'moved work off an agent whose shared pool is about to reset');
    assert.equal(later(w, {}, edit({ isNamedOurs: false })).toAssign.length, 0, 'took work from a card that is not ours');
    assert.equal(later(w).toAssign.length, 1, 'control: the same world unedited moves the part');
  } finally { w.restore(); }
});

test('stalled work comes before the backlog, and one stalled part goes to one receiver', () => {
  const w = world([{ name: 'prilim', paneState: 'rate_limited' }, { name: 'prigem', runner: 'gemini' }, { name: 'prigem2', runner: 'gemini' }]);
  try {
    // The backlog task is older and so would be picked first by the ordinary rule.
    tasks.create(w.pid, { sentence: 'an older unassigned task', made: { via: 'screen' } });
    const h = heldTask(w.pid, w.key.prilim, 'write the deploy notes');
    const out = later(w);
    const moved = out.toAssign.filter((x) => x.from);
    assert.equal(moved.length, 1, 'the stalled part went to more than one receiver, or to none: ' + JSON.stringify(out.toAssign));
    assert.equal(moved[0].n, h.n);
    assert.equal(out.toAssign.length, 2, 'the other idle agent did not get the backlog task: ' + JSON.stringify(out.toAssign));
    assert.equal(out.toAssign[0].from, w.key.prilim, 'the first idle agent took the backlog before the stalled part');
  } finally { w.restore(); }
});

test('never moves a part on hold, in a paused project, of a built or webhook task, or that is finished', () => {
  const w = world([{ name: 'hldlim', paneState: 'rate_limited' }, { name: 'hldgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.hldlim, 'write the deploy notes');
    assert.equal(later(w).toAssign.length, 1, 'control: the open part moves');
    const recs = (mut) => projects.readAll().map((p) => (p.id !== w.pid ? p
      : { ...p, tasks: p.tasks.map((x) => (x.number === h.n ? mut(x) : x)) }));
    assert.equal(later(w, { records: recs((x) => ({ ...x, onHold: true })) }).toAssign.length, 0, 'moved a task on hold');
    assert.equal(later(w, { records: recs((x) => ({ ...x, builtAt: '2026-10-06T00:00:00Z' })) }).toAssign.length, 0, 'moved a built task');
    assert.equal(later(w, { records: recs((x) => ({ ...x, addedVia: 'webhook' })) }).toAssign.length, 0, 'moved a webhook task');
    const closed = (x) => ({ ...x, parts: tasks.progressOf(x).parts.map((q) => ({ ...q, closedAt: '2026-10-06T00:00:00Z' })) });
    assert.equal(later(w, { records: recs(closed) }).toAssign.length, 0, 'moved a finished part');
    const paused = projects.readAll().map((p) => (p.id === w.pid ? { ...p, paused: true } : p));
    assert.equal(later(w, { records: paused }).toAssign.length, 0, 'moved a part in a paused project');
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
    // Each of the other write-time refusals, set and cleared through the real APIs.
    const madeOk = { via: 'assigner', onlyIfWho: w.key.aplim, failover: true };
    const arms = [
      ['built', () => tasks.setBuilt(w.pid, h.n, { person: true }), () => tasks.clearBuilt(w.pid, h.n)],
      ['on hold', () => tasks.setOnHold(w.pid, h.n, true, { viaScreen: true }), () => tasks.setOnHold(w.pid, h.n, false, { viaScreen: true })],
      ['paused', () => projects.mutate(w.pid, (p) => ({ ...p, paused: true })), () => projects.mutate(w.pid, (p) => ({ ...p, paused: false }))],
    ];
    for (const [what, set, clear] of arms) {
      set();
      assert.equal(tasks.assignPart(w.pid, h.n, h.partId, w.key.apgem, { ...madeOk }).ok, false, 'moved a part of a task ' + what);
      clear();
    }
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

test('Antigravity and the Gemini CLI count as one provider (one Google account can share the quota that stopped the first)', () => {
  assert.equal(a.providerOf('antigravity'), a.providerOf('gemini'));
  assert.notEqual(a.providerOf('gemini'), a.providerOf('claude'));
  // Review 6: an empty or missing runner is unknown, not claude (the card's 'claude' can be a default).
  assert.equal(a.providerOf(''), null);
  assert.equal(a.providerOf(undefined), null);
  assert.equal(a.providerOf('codex'), 'openai', 'not create.runnerProvider\'s answer');
  assert.equal(a.providerOf('somethingnew'), null, 'an unrecognised runner was given a provider (runnerProvider says anthropic)');
  const w = world([{ name: 'agylim', paneState: 'rate_limited' }, { name: 'agygem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.agylim, 'write the deploy notes');
    // The fixture's limited pane is Claude's limit line; the runner tag is set on the card as the supervisor records it.
    const asAgy = w.cards.map((c) => (c.sessionName === w.key.agylim ? { ...c, runner: 'antigravity' } : c));
    assert.equal(later(w, {}, asAgy).toAssign.length, 0, 'moved an Antigravity agent\'s part to a Gemini CLI agent');
    assert.equal(later(w).toAssign.length, 1, 'control: the same part on a Claude agent moves to the Gemini CLI agent');
  } finally { w.restore(); }
});

test('a limit Kosmos cannot date is not acted on (an old line on an idle screen, an undated Codex or Gemini CLI limit); a vendor reset still ahead is', () => {
  const w = world([{ name: 'udlim', paneState: 'rate_limited', undated: true }, { name: 'udgem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.udlim, 'write the deploy notes');
    assert.equal(a.limitedCard(card(w, 'udlim'), T0), false);
    assert.equal(later(w).toAssign.length, 0, 'moved work off an agent whose limit line has no reset time');
    const at = (cards) => later(w, {}, cards).toAssign.length;
    const withLine = w.cards.map((c) => (c.sessionName === w.key.udlim
      ? { ...c, stateEvidence: "You've hit your limit \u00b7 resets Jan 1, 2030 at 3pm (America/Chicago)" } : c));
    assert.equal(at(withLine), 1, 'a vendor line with a reset still ahead did not move the part');
    // T0 is in 2001, so a reset in 2000 has passed.
    const passed = w.cards.map((c) => (c.sessionName === w.key.udlim
      ? { ...c, stateEvidence: "You've hit your limit \u00b7 resets Jan 1, 2000 at 3pm (America/Chicago)" } : c));
    assert.equal(at(passed), 0, 'a vendor line whose reset has passed (a stale screen) moved the part');
    const codex = w.cards.map((c) => (c.sessionName === w.key.udlim ? { ...c, limitFrom: 'codex' } : c));
    // Review 7: a Codex or Gemini CLI limit carries no reset Kosmos reads, and status keeps it until a newer turn, so it
    // can be as stale as a Claude line: not acted on.
    assert.equal(at(codex), 0, 'an undated Codex limit moved the part');
    assert.equal(at(w.cards.map((c) => (c.sessionName === w.key.udlim ? { ...c, limitFrom: 'gemini' } : c))), 0, 'an undated Gemini CLI limit moved the part');
  } finally { w.restore(); }
});

test('the board\'s runner derivation decides the provider, and an unknown runner is never moved from or to', () => {
  const w = world([{ name: 'rnlim', paneState: 'rate_limited' }, { name: 'rngem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.rnlim, 'write the deploy notes');
    const step2 = (runners) => later(w, { runners }).toAssign.length;
    assert.equal(step2(new Map([[w.key.rnlim, 'claude'], [w.key.rngem, 'gemini']])), 1, 'control: known, different providers move');
    assert.equal(step2(new Map([[w.key.rnlim, 'antigravity'], [w.key.rngem, 'gemini']])), 0, 'the derivation said Google on both, and it moved');
    assert.equal(step2(new Map([[w.key.rnlim, null], [w.key.rngem, 'gemini']])), 0, 'moved from an agent whose runner is unknown');
    assert.equal(step2(new Map([[w.key.rnlim, 'claude'], [w.key.rngem, null]])), 0, 'moved to an agent whose runner is unknown');
  } finally { w.restore(); }
});

test('runOnce passes the failover source to give', () => {
  const w = world([{ name: 'rolim', paneState: 'rate_limited' }, { name: 'rogem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.rolim, 'write the deploy notes');
    const base = { roster: w.cards, setting: ON, records: projects.readAll(), commitments: w.states() };
    const first = a.step({ prev: undefined, ...base, now: T0 });
    const calls = [];
    a.runOnce({ prev: first.next, ...base, now: T0 + Math.max(a.IDLE_MS, a.FAILOVER_MS),
      give: (pid, n, partId, who, from) => { calls.push({ who, from }); return { ok: true }; } });
    assert.deepEqual(calls, [{ who: w.key.rogem, from: w.key.rolim }]);
  } finally { w.restore(); }
});

test('assignPart records movedFrom on a failover move; a later ordinary move clears it', () => {
  const w = world([{ name: 'mflim', paneState: 'rate_limited' }, { name: 'mfgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.mflim, 'write the deploy notes');
    const partNow = (r) => tasks.progressOf(r.task).parts.find((q) => Number(q.id) === Number(h.partId));
    const moved = tasks.assignPart(w.pid, h.n, h.partId, w.key.mfgem, { via: 'assigner', onlyIfWho: w.key.mflim, failover: true });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.equal(partNow(moved).movedFrom, w.key.mflim, 'a failover move did not record who it took the part from');
    // It survives a later write to the same task (writeParts stores what partsOf returns), read back from the store.
    assert.equal(tasks.addPart(w.pid, h.n, { sentence: 'and a second part', made: { via: 'screen' } }).ok, true, 'fixture: addPart refused');
    const stored = tasks.byNumber(projects.readAll().find((p) => p.id === w.pid), h.n);
    assert.equal(tasks.partsOf(stored).find((q) => Number(q.id) === Number(h.partId)).movedFrom, w.key.mflim,
      'a later write to the task erased movedFrom');
    // An ordinary move (a person, from the screen) back to the first agent: movedFrom is gone.
    const back = tasks.assignPart(w.pid, h.n, h.partId, w.key.mflim, { via: 'screen' });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal(back.changed, true, 'fixture: the ordinary move did not move the part, so this arm tests nothing');
    assert.equal(Object.prototype.hasOwnProperty.call(partNow(back), 'movedFrom'), false, 'an ordinary move kept movedFrom');
  } finally { w.restore(); }
});

test('CONTROL: an ordinary move never records movedFrom', () => {
  const w = world([{ name: 'omlim', paneState: 'rate_limited' }, { name: 'omgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.omlim, 'write the deploy notes');
    const r = tasks.assignPart(w.pid, h.n, h.partId, w.key.omgem, { via: 'assigner', onlyIfWho: w.key.omlim });
    assert.equal(r.ok, true, JSON.stringify(r));
    const part = tasks.progressOf(r.task).parts.find((q) => Number(q.id) === Number(h.partId));
    assert.equal(part.who, w.key.omgem);
    assert.equal(part.movedFrom, undefined, 'a move without failover recorded movedFrom');
  } finally { w.restore(); }
});

test('a task closed as a whole (parts still open) refuses a failover move; reopened, the move goes through', () => {
  const w = world([{ name: 'wclim', paneState: 'rate_limited' }, { name: 'wcgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.wclim, 'write the deploy notes');
    const made = () => ({ via: 'assigner', onlyIfWho: w.key.wclim, failover: true });
    const closed = tasks.close(w.pid, h.n);
    assert.ok(closed.closedAt, 'fixture: the task did not close');
    assert.equal(tasks.progressOf(closed).parts.find((q) => Number(q.id) === Number(h.partId)).closedAt, null,
      'fixture: closing the task closed the part, so this is the finished-part arm, not the whole-task arm');
    const r = tasks.assignPart(w.pid, h.n, h.partId, w.key.wcgem, made());
    assert.equal(r.ok, false, 'moved a part of a task closed as a whole');
    tasks.reopen(w.pid, h.n);
    const ok = tasks.assignPart(w.pid, h.n, h.partId, w.key.wcgem, made());
    assert.equal(ok.ok, true, 'control: the same move on the reopened task was refused: ' + JSON.stringify(ok));
  } finally { w.restore(); }
});

test('a repeating task between runs is not moved (#4787: it holds no work then); one that is due again is', () => {
  const w = world([{ name: 'replim', paneState: 'rate_limited' }, { name: 'repgem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.replim, 'post the morning report');
    const at = T0 + Math.max(a.IDLE_MS, a.FAILOVER_MS);
    const withRun = (lastRunAt) => projects.readAll().map((p) => (p.id !== w.pid ? p
      : { ...p, tasks: p.tasks.map((x) => (x.number === h.n ? { ...x, repeat: { every: 'day', at: '09:00' }, lastRunAt,
        // The fixture task was made at real time (2026) and T0 is in 2001; a repeat is never due before its rule was set.
        repeatSetAt: new Date(at - 4 * 24 * 3600 * 1000).toISOString() } : x)) }));
    assert.equal(later(w, { records: withRun(new Date(at - 60 * 1000).toISOString()) }).toAssign.length, 0,
      'moved a repeating task that ran a minute ago and waits for tomorrow');
    assert.equal(later(w, { records: withRun(new Date(at - 3 * 24 * 3600 * 1000).toISOString()) }).toAssign.length, 1,
      'control: a repeating task due again moves');
  } finally { w.restore(); }
});

test('review 7: tick reads each card\'s runner through readRunner, not the card\'s field', () => {
  const w = world([{ name: 'tklim', paneState: 'rate_limited' }, { name: 'tkgem', runner: 'gemini' }]);
  try {
    heldTask(w.pid, w.key.tklim, 'write the deploy notes');
    const run = (readRunner) => {
      const gives = [];
      const base = { readSetting: () => ON, readRoster: () => w.cards, readRecords: () => projects.readAll(),
        readCommitment: (s) => commitments.read(s), readGoal: () => null, DELIVERY: require('./chat').DELIVERY,
        give: (pid, n, partId, who, roster, from) => { gives.push({ who, from }); return { ok: true }; }, readRunner };
      const first = a.tick({ ...base, prev: undefined, now: T0 });
      a.tick({ ...base, prev: first.next, now: T0 + Math.max(a.IDLE_MS, a.FAILOVER_MS) });
      return gives;
    };
    // The cards say claude and gemini (different providers); the derivation says the source is Antigravity: one Google.
    assert.deepEqual(run((c) => (c.sessionName === w.key.tklim ? 'antigravity' : c.runner)), [], 'tick moved on the card\'s runner, not readRunner\'s');
    assert.deepEqual(run(() => { throw new Error('unreadable'); }), [], 'a runner read that throws was not treated as unknown');
    assert.deepEqual(run((c) => c.runner), [{ who: w.key.tkgem, from: w.key.tklim }], 'control: the same runners the cards carry move it');
  } finally { w.restore(); }
});

test('review 7: a refused failover move says the work changed, not that the part left its owner', () => {
  const w = world([{ name: 'whylim', paneState: 'rate_limited' }, { name: 'whygem', runner: 'gemini' }]);
  try {
    const h = heldTask(w.pid, w.key.whylim, 'write the deploy notes');
    tasks.setPartClosed(w.pid, h.n, h.partId, new Date().toISOString());
    const r = tasks.assignPart(w.pid, h.n, h.partId, w.key.whygem, { via: 'assigner', onlyIfWho: w.key.whylim, failover: true });
    assert.equal(r.ok, false);
    assert.match(r.because, /finished, closed, built or put on hold/);
    const r2 = tasks.assignPart(w.pid, h.n, h.partId, w.key.whygem, { via: 'assigner', onlyIfWho: 'somebody-else', failover: true });
    assert.match(r2.because, /no longer on somebody-else/, 'control: a part not on that agent still says so');
  } finally { w.restore(); }
});

/* ---- review 8: the obligation to tell lives on the part (owedTell) and engine/failovertell.js tells it ---- */
const ft = require('./failovertell');
const FAIL = { via: 'assigner', failover: true };
const move = (w, h, from, to) => tasks.assignPart(w.pid, h.n, h.partId, to, { ...FAIL, onlyIfWho: from });
const partNow = (w, h) => tasks.progressOf(projects.readAll().find((p) => p.id === w.pid).tasks.find((x) => x.number === h.n)).parts
  .find((q) => Number(q.id) === Number(h.partId));

test('review 8: a failover move owes its source a line; a chain owes every source; a hand-back or a person\'s move to that agent drops it', () => {
  const w = world([{ name: 'owa' }, { name: 'owb' }, { name: 'owc' }]);
  try {
    const h = heldTask(w.pid, w.key.owa, 'write the deploy notes');
    assert.ok(move(w, h, w.key.owa, w.key.owb).ok);
    assert.deepEqual(partNow(w, h).owedTell, [w.key.owa]);
    assert.ok(move(w, h, w.key.owb, w.key.owc).ok);
    assert.deepEqual(partNow(w, h).owedTell, [w.key.owa, w.key.owb], 'a chain forgot its first source');
    // The Assigner hands it back to owb (the receiver could not be told): owb is no longer owed, owa still is.
    assert.ok(tasks.assignPart(w.pid, h.n, h.partId, w.key.owb, { via: 'assigner', onlyIfWho: w.key.owc }).ok);
    assert.deepEqual(partNow(w, h).owedTell, [w.key.owa]);
    // A person gives it back to owa: nothing left to tell.
    assert.ok(tasks.assignPart(w.pid, h.n, h.partId, w.key.owa, { via: 'screen' }).ok);
    assert.equal(partNow(w, h).owedTell, undefined);
    // CONTROL: an ordinary move never owes anybody.
    assert.ok(tasks.assignPart(w.pid, h.n, h.partId, w.key.owc, { via: 'screen' }).ok);
    assert.equal(partNow(w, h).owedTell, undefined);
  } finally { w.restore(); }
});

test('review 8: owedFor lists only open parts the agent is owed and does not hold; the record survives other writes; markMoveTold ends it', () => {
  const w = world([{ name: 'ofa' }, { name: 'ofb' }]);
  try {
    const h = heldTask(w.pid, w.key.ofa, 'write the deploy notes');
    assert.deepEqual(ft.owedFor(w.key.ofa, projects.readAll()), [], 'owed before any move');
    assert.ok(move(w, h, w.key.ofa, w.key.ofb).ok);
    const items = ft.owedFor(w.key.ofa, projects.readAll());
    assert.equal(items.length, 1);
    assert.match(items[0].phrase, new RegExp('task ' + h.n + ' in ".*" \\(now ' + w.key.ofb + '\'s\\)'));
    assert.deepEqual(ft.owedFor(w.key.ofb, projects.readAll()), [], 'the holder is owed a line about its own part');
    tasks.addPart(w.pid, h.n, { sentence: 'a second step', made: { via: 'screen' } });
    assert.equal(ft.owedFor(w.key.ofa, projects.readAll()).length, 1, 'another write to the task dropped the record');
    tasks.setPartClosed(w.pid, h.n, h.partId, new Date().toISOString());
    assert.deepEqual(ft.owedFor(w.key.ofa, projects.readAll()), [], 'a finished part is still owed');
    tasks.setPartClosed(w.pid, h.n, h.partId, null);
    assert.equal(tasks.markMoveTold(w.pid, h.n, h.partId, w.key.ofa).ok, true);
    assert.deepEqual(ft.owedFor(w.key.ofa, projects.readAll()), [], 'told, still owed');
    assert.equal(tasks.markMoveTold(w.pid, h.n, h.partId, w.key.ofa).ok, false, 'a second mark found something to mark');
    assert.equal(tasks.markMoveTold('no-such-project', 1, 1, w.key.ofa).ok, false, 'a missing task threw or claimed a mark');
  } finally { w.restore(); }
});

test('review 8: the sweep tells an idle owed agent once, marks only what reached it, and skips one not idle', () => {
  const w = world([{ name: 'swa' }, { name: 'swb' }]);
  try {
    const h = heldTask(w.pid, w.key.swa, 'write the deploy notes');
    assert.ok(move(w, h, w.key.swa, w.key.swb).ok);
    const D = require('./chat').DELIVERY;
    const run = (deliverState, isIdle = () => true) => {
      const sent = [];
      const out = ft.sweepOnce({ roster: w.cards, records: projects.readAll(), DELIVERY: D, isIdle, markTold: tasks.markMoveTold,
        deliver: (s, text) => { sent.push({ s, text }); return deliverState; } });
      return { sent, out };
    };
    assert.deepEqual(run({ state: D.PLACED }, () => false).sent, [], 'typed into an agent that is not idle');
    const missed = run({ state: D.COULD_NOT });
    assert.equal(missed.sent.length, 1);
    assert.equal(ft.owedFor(w.key.swa, projects.readAll()).length, 1, 'a line that reached nothing marked it told');
    const held = run({ state: D.COULD_NOT, held: true });
    assert.equal(ft.owedFor(w.key.swa, projects.readAll()).length, 1, 'a held line marked it told');
    assert.equal(held.sent.length, 1);
    const ok = run({ state: D.PLACED });
    assert.deepEqual(ok.sent.map((x) => x.s), [w.key.swa]);
    assert.match(ok.sent[0].text, /while you were at your usage limit, task \d+ in .* was given to another agent\. Leave it to them/);
    assert.deepEqual(run({ state: D.PLACED }).sent, [], 'told twice');
  } finally { w.restore(); }
});

test('review 8: the sweep sends at most MAX_PER_PASS lines a pass', () => {
  const names = ['mpa', 'mpb', 'mpc', 'mpd', 'mpz'];
  const w = world(names.map((name) => ({ name })));
  try {
    for (const n of names.slice(0, 4)) { const h = heldTask(w.pid, w.key[n], 'work of ' + n); assert.ok(move(w, h, w.key[n], w.key.mpz).ok); }
    const sent = [];
    ft.sweepOnce({ roster: w.cards, records: projects.readAll(), DELIVERY: require('./chat').DELIVERY, isIdle: () => true,
      markTold: tasks.markMoveTold, deliver: (s) => { sent.push(s); return { state: 'placed' }; } });
    assert.equal(sent.length, ft.MAX_PER_PASS);
  } finally { w.restore(); }
});

test('review 8: the defensive arms, on hand-built input: a held verdict never counts as reached; the holder is never owed', () => {
  const D = require('./chat').DELIVERY;
  assert.equal(ft.reached({ state: D.UNCONFIRMED, held: true }, D), false, 'a held verdict counted as reached');
  assert.equal(ft.reached({ state: D.UNCONFIRMED }, D), true, 'control: an unconfirmed one may have reached the pane');
  assert.equal(ft.reached({ state: D.COULD_NOT }, D), false);
  const rec = [{ id: 'p1', name: 'P', agents: ['ann', 'bob'], tasks: [{ number: 1, sentence: 's', parts: [{ id: 1, sentence: 's', who: 'ann', owedTell: ['ann', 'bob'] }] }] }];
  assert.deepEqual(ft.owedFor('ann', rec), [], 'the agent holding the part is told it was given away');
  assert.equal(ft.owedFor('bob', rec).length, 1, 'control: the other source is owed');
});

/* ---- review 9 ---- */
const rec9 = (over = {}, part = {}) => [{ id: 'p1', name: 'P', agents: ['ann', 'bob'], ...over,
  tasks: [{ number: 1, sentence: 's', parts: [{ id: 1, sentence: 's', who: 'bob', owedTell: ['ann'], ...part }] }] }];

test('review 9: owedFor says "given to another agent" only when somebody holds it, in a live project the agent is still on and not switched off in', () => {
  assert.equal(ft.owedFor('ann', rec9()).length, 1, 'control: owed');
  assert.deepEqual(ft.owedFor('ann', rec9({}, { who: null })), [], 'told a part nobody holds was given to another agent');
  assert.deepEqual(ft.owedFor('ann', rec9({ archived: true })), [], 'told about an archived project');
  assert.deepEqual(ft.owedFor('ann', rec9({ agents: ['bob'] })), [], 'told about a project it has left');
  assert.equal(require('./projects').isSwarmOff(rec9({ swarmOff: ['ann'] })[0], 'ann'), true, 'fixture: swarmOff is not how a switched-off swarm is stored');
  assert.deepEqual(ft.owedFor('ann', rec9({ swarmOff: ['ann'] })), [], 'told about a project its swarm is switched off in');
  assert.equal(ft.anyOwed(rec9()), true);
  assert.equal(ft.anyOwed(rec9({}, { owedTell: [] })), false);
  assert.equal(ft.anyOwed(rec9({}, { closedAt: '2026-10-06T00:00:00Z' })), false, 'a finished part counts as owed');
});

test('review 9: the sweep counts only lines that may have landed toward its cap, waits one pass of idle, and honours skip', () => {
  const D = require('./chat').DELIVERY;
  const owe = (who) => ({ id: 'p-' + who, name: who, agents: [who, 'zed'],
    tasks: [{ number: 1, sentence: 's', parts: [{ id: 1, sentence: 's', who: 'zed', owedTell: [who] }] }] });
  const names = ['h1', 'h2', 'h3', 'ok1'];
  const records = names.map(owe);
  const roster = names.map((n) => ({ sessionName: n, isNamedOurs: true, state: 'idle' }));
  const sent = [];
  const deliver = (s) => { sent.push(s); return s.startsWith('h') ? { state: D.COULD_NOT, held: true } : { state: D.PLACED }; };
  const base = { roster, records, DELIVERY: D, isIdle: () => true, markTold: () => ({ ok: true }), deliver };
  ft.sweepOnce({ ...base, max: 3 });
  assert.ok(sent.includes('ok1'), 'three unreachable agents took every slot and ok1 was never told');
  // seenIdle: a card not idle at the previous pass is not typed into this pass; it is at the next.
  const seen = new Set();
  sent.length = 0;
  ft.sweepOnce({ ...base, seenIdle: seen });
  assert.deepEqual(sent, [], 'typed into a card the moment it went idle');
  ft.sweepOnce({ ...base, seenIdle: seen });
  assert.equal(sent.length, 4, 'control: idle at both passes, it is told');
  sent.length = 0;
  ft.sweepOnce({ ...base, skip: (c) => c.sessionName === 'ok1' });
  assert.equal(sent.includes('ok1'), false, 'a skipped card was typed into');
});

test('review 9: markMoveTold changes owedTell only, never the holder, the move record, the finish or the built mark', () => {
  const w = world([{ name: 'mka' }, { name: 'mkb' }]);
  try {
    const h = heldTask(w.pid, w.key.mka, 'write the deploy notes');
    assert.ok(move(w, h, w.key.mka, w.key.mkb).ok);
    const before = partNow(w, h);
    const taskBefore = projects.readAll().find((p) => p.id === w.pid).tasks.find((x) => x.number === h.n);
    assert.ok(tasks.markMoveTold(w.pid, h.n, h.partId, w.key.mka).ok);
    const after = partNow(w, h);
    const taskAfter = projects.readAll().find((p) => p.id === w.pid).tasks.find((x) => x.number === h.n);
    for (const k of ['who', 'movedFrom', 'movedVia', 'movedAt', 'closedAt', 'sentence']) assert.deepEqual(after[k], before[k], k + ' changed');
    assert.equal(after.owedTell, undefined);
    for (const k of ['builtAt', 'closedAt', 'onHold']) assert.deepEqual(taskAfter[k], taskBefore[k], 'task ' + k + ' changed');
  } finally { w.restore(); }
});
