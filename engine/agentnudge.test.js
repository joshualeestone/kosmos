'use strict';
/* #4544: the Prompter's nudge to the AGENT. Real inputs throughout: board cards from
 * test-support/fleet + status.snapshot(), projects and tasks made by engine/projects + engine/tasks,
 * and toAsk produced by the real heartbeat.step. deliver is injected, so no real agent is typed into.
 * Every rule is tested with the arm that must fire AND the arm that must not.
 *
 *   node --test engine/agentnudge.test.js
 */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/projects (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agentnudge-'));
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
const heartbeat = require('./heartbeat');
const nudge = require('./agentnudge');
const { DELIVERY } = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const INTERVAL = 15 * 60 * 1000;
let seq = 0;

/* A board of agents (idle unless paneState says otherwise) and a fresh project they all belong to. */
function world(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle' })));
  const key = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.sessionName === s.name) || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
  }
  const p = projects.create({ name: 'Nudge Test ' + (++seq) });
  for (const s of specs) projects.addAgent(p.id, key[s.name], board.agents);
  const cards = status.snapshot().agents;
  return { cards, key, pid: p.id, restore: board.restore };
}

/* A task in the project with its one part on `who`. */
function taskOn(w, who, sentence) {
  const t = tasks.create(w.pid, { sentence, made: { via: 'screen' } });
  const r = tasks.assignPart(w.pid, t.number, 1, who, { via: 'screen' });
  assert.ok(r && r.ok, 'fixture: assignPart refused: ' + JSON.stringify(r));
  return t.number;
}

/* The Prompter's own record after enough ticks for a never-worked idle agent to open a stall. */
function stalled(cards) {
  let prev = new Map();
  let out;
  for (let i = 0; i < heartbeat.STARTUP_STALL_TICKS; i += 1) { out = heartbeat.step(prev, cards, true); prev = out.next; }
  return out;
}

/* One pass with a delivery spy. Past the interval by default, so a part given at fixture time is not fresh. */
function pass(w, o = {}) {
  const calls = [];
  const hb = o.hb || stalled(w.cards);
  const res = nudge.sweepOnce({
    toAsk: hb.toAsk, next: hb.next, roster: w.cards, projects: projects.readAll(),
    book: o.book || new Map(), sent: o.sent || [], now: o.now || (Date.now() + INTERVAL + 1000), intervalMs: INTERVAL,
    limit: o.limit || { on: false },
    deliver: (session, text) => { calls.push({ session, text }); return { state: o.state || DELIVERY.PLACED }; },
    DELIVERY,
  });
  return { calls, res, hb };
}

test('fixture control: the real Prompter opens a stall for an idle agent (toAsk names it)', () => {
  const w = world([{ name: 'fxidle' }]);
  try {
    assert.deepEqual(stalled(w.cards).toAsk.map((x) => x.session), [w.key.fxidle]);
    assert.ok(nudge.nudgeableCard(w.cards.find((c) => c.sessionName === w.key.fxidle)), 'fixture: the card does not read idle and ours');
  } finally { w.restore(); }
});

test('an idle agent with an open task gets exactly one nudge naming it; one with nothing gets none', () => {
  const w = world([{ name: 'hastask' }, { name: 'notask' }]);
  try {
    const n = taskOn(w, w.key.hastask, 'write the release notes');
    const book = new Map();
    const first = pass(w, { book });
    assert.deepEqual(first.calls.map((c) => c.session), [w.key.hastask]);
    assert.deepEqual(first.res.results.map((r) => r.session + ':' + r.act), [w.key.hastask + ':nudge'], 'the agent with nothing must leave no result at all');
    assert.match(first.calls[0].text, new RegExp('task #' + n + ' "write the release notes"'));
    assert.match(first.calls[0].text, /on another agent, a deploy or a review, kosmos report blocked --on <what> --owner <who>/);
    // #5318: a person-blocker is offered needs_you, the only state Kosmos escalates.
    assert.match(first.calls[0].text, /on a person \(a decision, a meeting, an answer\), kosmos report needs_you <your question>, which Kosmos follows up/,
      '#5318: the nudge offers needs_you for a person');
    // The same stall, the next interval (a real next Prompter step): no second nudge.
    const nextHb = heartbeat.step(first.hb.next, w.cards, true);
    assert.equal(nextHb.next.get(w.key.hastask).open, true, 'fixture: the Prompter must keep the stall open');
    const again = pass(w, { book, hb: nextHb });
    assert.equal(again.calls.length, 0, 'nudged twice in one stall');
  } finally { w.restore(); }
});

/* prompterTick with every dependency injected; returns what was written and delivered. */
function tickWith(w, o = {}) {
  const calls = [];
  const writes = [];
  const out = nudge.prompterTick({
    setting: o.setting || { on: true, intervalMinutes: 15 },
    roster: o.roster === undefined ? w.cards : o.roster,
    outcome: o.outcome || stalled(w.cards),
    readProjects: o.readProjects || (() => projects.readAll()),
    shouldWrite: require('./prompternudge').shouldWrite,
    write: (list) => { writes.push(list.map((x) => x.session)); },
    allowed: o.allowed || (() => true), env: o.env || {},
    readLimit: o.readLimit || (() => ({ on: false, perHour: 20 })), limitDefaults: { on: true, perHour: 20 },
    book: new Map(), sent: [], now: Date.now() + INTERVAL + 1000,
    deliver: (session) => { calls.push(session); return { state: DELIVERY.PLACED }; }, DELIVERY,
  });
  return { calls, writes, out };
}

test('prompterTick: the Prompter on, live execution allowed: the list shows the real stall and the agent is nudged', () => {
  const w = world([{ name: 'tkwork' }, { name: 'tkidle' }]);
  try {
    taskOn(w, w.key.tkwork, 'a task');
    const r = tickWith(w);
    assert.deepEqual(r.writes, [[w.key.tkwork]], 'the person\'s list must hold only the stall with open work');
    assert.deepEqual(r.calls, [w.key.tkwork]);
  } finally { w.restore(); }
});

test('prompterTick gates: nothing is typed when off, unreadable, before live execution, or under the brake', () => {
  const w = world([{ name: 'gate' }]);
  try {
    taskOn(w, w.key.gate, 'a task');
    const cases = {
      'Prompter off': { setting: { on: false, intervalMinutes: 15 } },
      'roster read failure': { roster: null },
      'live execution not allowed': { allowed: () => false },
      'live execution check throws': { allowed: () => { throw new Error('x'); } },
      'the brake': { env: { AGENT_WORKFORCE_AGENT_NUDGE_OFF: '1' } },
      'projects unreadable': { readProjects: () => { throw Object.assign(new Error('damaged'), { code: 'UNREADABLE' }); } },
    };
    for (const [label, o] of Object.entries(cases)) assert.deepEqual(tickWith(w, o).calls, [], label + ' typed into an agent');
    // The person's list on those paths: the roster failure writes nothing (keeps the last list), and
    // unreadable projects write the WHOLE list rather than hide a real stall.
    assert.deepEqual(tickWith(w, cases['roster read failure']).writes, []);
    assert.deepEqual(tickWith(w, cases['projects unreadable']).writes, [[w.key.gate]]);
    // Control: with none of those, the same world IS nudged, so each refusal above is the gate's doing.
    assert.deepEqual(tickWith(w).calls, [w.key.gate]);
  } finally { w.restore(); }
});

test('prompterTick: an unreadable Agent Communication setting keeps the cap on (the default)', () => {
  const w = world([{ name: 'lima' }, { name: 'limb' }]);
  try {
    for (const k of Object.values(w.key)) taskOn(w, k, 'a task');
    const capped = tickWith(w, { readLimit: () => { throw new Error('unreadable'); } });
    assert.equal(capped.calls.length, 2, 'fixture: the default cap is 20, so both go');
    const r = nudge.prompterTick({
      setting: { on: true, intervalMinutes: 15 }, roster: w.cards, outcome: stalled(w.cards),
      readProjects: () => projects.readAll(), shouldWrite: () => false, write: () => {}, allowed: () => true, env: {},
      readLimit: () => { throw new Error('unreadable'); }, limitDefaults: { on: true, perHour: 1 },
      book: new Map(), sent: [], now: Date.now() + INTERVAL + 1000, deliver: () => ({ state: DELIVERY.PLACED }), DELIVERY,
    });
    assert.equal(r.nudged.length, 1, 'a failed limit read must fall back to the default, which caps');
  } finally { w.restore(); }
});

test('a new stall after the agent worked again gets a new nudge (the episode ends on work)', () => {
  const w = world([{ name: 'backagain' }]);
  try {
    taskOn(w, w.key.backagain, 'a task');
    const book = new Map();
    const first = pass(w, { book });
    assert.equal(first.calls.length, 1);
    // It worked: the Prompter's record closes the episode, and the book lets it go.
    const worked = heartbeat.step(first.hb.next, w.cards.map((c) => c.sessionName === w.key.backagain ? { ...c, state: 'working', stateConfidence: 'high' } : c), true);
    nudge.sweepOnce({ toAsk: worked.toAsk, next: worked.next, roster: w.cards, projects: projects.readAll(), book, sent: [], now: Date.now() + INTERVAL + 1000, intervalMs: INTERVAL, limit: { on: false }, deliver: () => ({ state: DELIVERY.PLACED }), DELIVERY });
    assert.equal(book.has(w.key.backagain), false, 'the book kept a closed episode');
    // It stopped again (working -> idle is the Prompter's edge): not on that tick, which is the moment
    // it finished a turn, but at the next one.
    const stoppedAgain = heartbeat.step(worked.next, w.cards, true);
    assert.equal(stoppedAgain.toAsk.find((x) => x.session === w.key.backagain).from, 'working', 'fixture: this must be the edge');
    assert.equal(pass(w, { book, hb: stoppedAgain }).calls.length, 0, 'nudged on the tick it went idle');
    const nextTick = heartbeat.step(stoppedAgain.next, w.cards, true);
    assert.equal(pass(w, { book, hb: nextTick }).calls.length, 1, 'a fresh stall after work was not nudged an interval later');
  } finally { w.restore(); }
});

test('a part given within the last interval is not nudged; past the interval it is (control)', () => {
  const w = world([{ name: 'justgiven' }]);
  try {
    taskOn(w, w.key.justgiven, 'fresh work');
    assert.equal(pass(w, { now: Date.now() }).calls.length, 0, 'nudged an agent just given its work');
    assert.equal(pass(w).calls.length, 1, 'control: past the interval it must be nudged');
  } finally { w.restore(); }
});

test('a card that is not idle is never typed into (every other state the classifier gives)', () => {
  for (const paneState of ['needs_you', 'working', 'stopped', 'unknown', 'rate_limited', 'auth_failed', 'connection_lost']) {
    const w = world([{ name: 'st' + paneState.replace('_', ''), paneState }]);
    try {
      const k = Object.values(w.key)[0];
      assert.equal(w.cards.find((c) => c.sessionName === k).state, paneState, 'fixture: the card must read ' + paneState);
      taskOn(w, k, 'a task');
      // Force it into toAsk regardless of the Prompter, so the card rule alone is what refuses.
      // Forced as the Prompter reading it idle (from and to 'idle'), so the edge rule and the Prompter-reading
      // rule do not refuse it first and the card is what refuses.
      const hb = { toAsk: [{ session: k, from: 'idle', to: 'idle' }], next: new Map([[k, { open: true }]]) };
      assert.equal(pass(w, { hb }).calls.length, 0, paneState + ' card was typed into');
    } finally { w.restore(); }
  }
});

test('a delivery that reached nothing is retried, at most MAX_TRIES times per stall', () => {
  const w = world([{ name: 'refuses' }]);
  try {
    taskOn(w, w.key.refuses, 'a task');
    const book = new Map();
    const hb = stalled(w.cards);
    let total = 0;
    for (let i = 0; i < nudge.MAX_TRIES + 2; i += 1) total += pass(w, { book, hb, state: DELIVERY.COULD_NOT }).calls.length;
    assert.equal(total, nudge.MAX_TRIES);
  } finally { w.restore(); }
});

test('Agent Communication\'s limit caps nudges across the board in an hour; off, it does not', () => {
  const w = world([{ name: 'capa' }, { name: 'capb' }, { name: 'capc' }]);
  try {
    for (const k of Object.values(w.key)) taskOn(w, k, 'a task');
    const now = Date.now() + INTERVAL + 1000;
    assert.equal(pass(w, { now, limit: { on: true, perHour: 2 } }).calls.length, 2, 'the cap did not hold');
    assert.equal(pass(w, { now, limit: { on: false, perHour: 2 } }).calls.length, 3, 'control: off, all three are nudged');
    // A nudge an hour old no longer counts.
    // Exactly an hour old is out (the window is the last hour, not including its start).
    const sent = [now - nudge.HOUR_MS, now - nudge.HOUR_MS];
    assert.equal(pass(w, { now, sent, limit: { on: true, perHour: 2 } }).calls.length, 2, 'an hour-old nudge still counted');
  } finally { w.restore(); }
});

test('a task that is closed does not count as open work', () => {
  const w = world([{ name: 'closedwork' }]);
  try {
    const n = taskOn(w, w.key.closedwork, 'finished');
    const r = tasks.close(w.pid, n);
    assert.ok(r && r.ok !== false, 'fixture: close refused: ' + JSON.stringify(r));
    assert.equal(pass(w).calls.length, 0);
  } finally { w.restore(); }
});

test('control for the closed-task arm: the same task left open is nudged', () => {
  const w = world([{ name: 'openwork' }]);
  try {
    taskOn(w, w.key.openwork, 'not finished');
    assert.equal(pass(w).calls.length, 1);
  } finally { w.restore(); }
});

test('openParts agrees with the Assigner\'s hasOpenWork: open, closed, built, and another agent\'s part', () => {
  const assigner = require('./assigner');
  const w = world([{ name: 'agrmine' }, { name: 'agrother' }, { name: 'agrbuilt' }, { name: 'agrclosed' }, { name: 'agrnone' }]);
  try {
    taskOn(w, w.key.agrmine, 'mine');
    taskOn(w, w.key.agrother, 'theirs');
    const b = taskOn(w, w.key.agrbuilt, 'built');
    const c = taskOn(w, w.key.agrclosed, 'closed');
    assert.ok(tasks.close(w.pid, c), 'fixture: close refused');
    const mb = tasks.setBuilt(w.pid, b, { by: w.key.agrbuilt });
    assert.ok(mb && mb.ok !== false, 'fixture: setBuilt refused: ' + JSON.stringify(mb));
    const recs = projects.readAll();
    const seen = {};
    for (const k of Object.values(w.key)) {
      seen[k] = [nudge.openParts(k, recs).length > 0, assigner.hasOpenWork(k, recs)];
      assert.equal(seen[k][0], seen[k][1], 'openParts and hasOpenWork disagree for ' + k + ': ' + JSON.stringify(seen[k]));
    }
    // Controls: both answers occur, so agreement is not two functions that always say the same thing.
    assert.equal(seen[w.key.agrmine][0], true);
    assert.equal(seen[w.key.agrnone][0], false);
    assert.equal(seen[w.key.agrclosed][0], false);
    assert.equal(seen[w.key.agrbuilt][0], false, 'a task this agent marked built still counted');
  } finally { w.restore(); }
});

test('the person\'s check-in keeps only stalls holding an open task (realStalls); control: both arms occur', () => {
  const w = world([{ name: 'listtask' }, { name: 'listidle' }]);
  try {
    taskOn(w, w.key.listtask, 'a task');
    const hb = stalled(w.cards);
    assert.deepEqual(hb.toAsk.map((x) => x.session).sort(), [w.key.listidle, w.key.listtask].sort(), 'fixture: both agents must be in the Prompter\'s toAsk');
    const shown = nudge.realStalls(hb.toAsk, projects.readAll());
    assert.deepEqual(shown.map((x) => x.session), [w.key.listtask]);
    // Each entry keeps the shape prompternudge.write takes ({ session, from, to }).
    assert.deepEqual(Object.keys(shown[0]).sort(), ['from', 'session', 'to']);
  } finally { w.restore(); }
});

test('work created on the agent (a task made with who) within the interval is not nudged; control past it', () => {
  const w = world([{ name: 'madewith' }]);
  try {
    const t = tasks.create(w.pid, { sentence: 'made with an owner', who: w.key.madewith, made: { via: 'screen' } });
    assert.ok(t && t.number, 'fixture: create refused');
    assert.equal(nudge.openParts(w.key.madewith, projects.readAll())[0].givenAt != null, true, 'fixture: the part must carry a time it was given');
    assert.equal(pass(w, { now: Date.now() }).calls.length, 0, 'nudged an agent whose task was just created on it');
    assert.equal(pass(w).calls.length, 1, 'control: past the interval it is nudged');
  } finally { w.restore(); }
});

test('a task in a project where the agent is switched off is not nudged; control switched on', () => {
  const w = world([{ name: 'swoff' }]);
  try {
    taskOn(w, w.key.swoff, 'a task');
    assert.equal(pass(w).calls.length, 1, 'control: switched on, it is nudged');
    projects.setSwarmOn(w.pid, w.key.swoff, false);
    assert.equal(projects.isSwarmOff(projects.readAll().find((p) => p.id === w.pid), w.key.swoff), true, 'fixture: the switch did not take');
    assert.equal(pass(w).calls.length, 0, 'nudged about a project it is switched off in');
  } finally { w.restore(); }
});

test('the words are one safe line: control characters and quotes out, cut on a character boundary', () => {
  const text = nudge.nudgeText({ n: 7, project: 'Proj\u0007ect', sentence: 'line one\nline "two"\u0000' + '\u{1F600}'.repeat(200) });
  assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]/, 'a control character reached the typed line');
  assert.equal((text.match(/"/g) || []).length, 2, 'only the two quotes around the sentence');
  assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, 'a surrogate pair was split');
  assert.match(text, /^Kosmos here, from the Prompter: /);
});

test('#4771 review 2: the nudge names the pause verb with the project id, so a running agent learns it when it matters', () => {
  const text = nudge.nudgeText({ n: 3, projectId: 'kosmosgrowth', project: 'Kosmos Growth', sentence: 'grow' });
  assert.match(text, /Only if your person asked in the room to pause this project: kosmos project pause kosmosgrowth \(the room is told you paused it\)$/);
  assert.equal((text.match(/"/g) || []).length, 2, 'the hint added a quote');
  // CONTROL: a part with no project id (an older caller) gets the old text, with no half-written hint.
  assert.doesNotMatch(nudge.nudgeText({ n: 3, project: 'Kosmos Growth', sentence: 'grow' }), /project pause/);
  // Review 3: an id the CLIs would not take as it is gets no hint, never a rewritten one.
  assert.doesNotMatch(nudge.nudgeText({ n: 3, projectId: 'bad id!', project: 'X', sentence: 'grow' }), /project pause/);
  assert.doesNotMatch(nudge.nudgeText({ n: 3, projectId: '..', project: 'X', sentence: 'grow' }), /project pause/);
});

test('the Prompter must read the agent as idle too: a card that says idle but a low-confidence reading (toAsk to unknown) is not nudged', () => {
  const w = world([{ name: 'lowconf' }]);
  try {
    taskOn(w, w.key.lowconf, 'a task');
    const k = w.key.lowconf;
    const next = new Map([[k, { open: true }]]);
    assert.equal(pass(w, { hb: { toAsk: [{ session: k, from: 'idle', to: 'unknown' }], next } }).calls.length, 0, 'typed into a pane the Prompter could not read');
    assert.equal(pass(w, { hb: { toAsk: [{ session: k, from: 'idle', to: 'idle' }], next } }).calls.length, 1, 'control: read as idle, it is nudged');
  } finally { w.restore(); }
});

test('server.js: the Prompter tick hands everything after heartbeat.step to prompterTick, and types nowhere else', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = src.indexOf('const heartbeatTick = () => {');
  const j = src.indexOf('const t = setTimeout(heartbeatTick', i);
  assert.ok(i > 0 && j > i, 'the Prompter tick was not found in server.js');
  // Comments out first: a comment that names a call is not a call.
  const body = src.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal((body.match(/agentnudge\.prompterTick\(/g) || []).length, 1, 'the tick must call prompterTick once');
  assert.equal((body.match(/heartbeat\.step\(/g) || []).length, 1, 'fixture: the slice is the Prompter tick');
  // The one delivery is the one prompterTick is given; a second would type outside its gates.
  // #4588 PR B: the timer delivers through chat.deliverAutomatic, which is the same one delivery. This count cannot
  // tell the two apart; server.agyhold-4588.test.js pins that it is deliverAutomatic.
  assert.equal((body.match(/\bdeliver(?:Automatic)?\(/g) || []).length, 1, 'a delivery outside prompterTick');
  assert.equal((body.match(/prompternudge\.write\(/g) || []).length, 1, 'the person\'s list must be written only through prompterTick\'s write');
});

test('the card rule\'s other two conditions: a switched-off swarm and a card that is not ours are not typed into; control', () => {
  const w = world([{ name: 'cardrule' }]);
  try {
    const k = w.key.cardrule;
    taskOn(w, k, 'a task');
    const hb = { toAsk: [{ session: k, from: 'idle', to: 'idle' }], next: new Map([[k, { open: true }]]) };
    const card = w.cards.find((c) => c.sessionName === k);
    const withCard = (c) => ({ ...w, cards: w.cards.map((x) => (x.sessionName === k ? c : x)) });
    assert.equal(pass(withCard({ ...card, swarm: { active: false } }), { hb }).calls.length, 0, 'typed into a switched-off swarm');
    assert.equal(pass(withCard({ ...card, isNamedOurs: false }), { hb }).calls.length, 0, 'typed into a card that is not ours');
    assert.equal(pass(w, { hb }).calls.length, 1, 'control: the real card is nudged');
  } finally { w.restore(); }
});

test('sweepOnce on an unreadable roster types nothing and says why', () => {
  let typed = 0;
  const r = nudge.sweepOnce({ toAsk: [{ session: 'x', from: 'idle', to: 'idle' }], next: new Map(), roster: null, projects: [], deliver: () => { typed += 1; return { state: DELIVERY.PLACED }; }, DELIVERY });
  assert.equal(typed, 0);
  assert.equal(r.skipped, 'roster unreadable');
});

test('prompterTick reads the projects only when there is a stall to filter or nudge', () => {
  let reads = 0;
  const out = nudge.prompterTick({
    setting: { on: true, intervalMinutes: 15 }, roster: [], outcome: { toAsk: [], next: new Map() },
    readProjects: () => { reads += 1; return []; }, shouldWrite: () => true, write: () => {}, allowed: () => true, env: {},
    readLimit: () => ({ on: false }), limitDefaults: { on: true, perHour: 20 }, book: new Map(), sent: [], deliver: () => ({}), DELIVERY,
  });
  assert.equal(reads, 0);
  assert.deepEqual(out.written, [], 'the empty list is still written, which clears the panel');
});

test('the person\'s list keeps a signed-out or disconnected agent with no task (no other path to the person); control: an idle one with no task is dropped', () => {
  const toAsk = [
    { session: 'a-signedout', from: 'working', to: 'auth_failed' },
    { session: 'a-lost', from: 'working', to: 'connection_lost' },
    { session: 'a-quiet', from: 'working', to: 'idle' },
    { session: 'a-stopped', from: 'working', to: 'stopped' },
  ];
  assert.deepEqual(nudge.realStalls(toAsk, []).map((x) => x.session), ['a-signedout', 'a-lost']);
});

test('a stall that closed while the nudge was off still frees its agent, so the next stall is nudged', () => {
  const w = world([{ name: 'gatedgap' }]);
  try {
    const k = w.key.gatedgap;
    taskOn(w, k, 'a task');
    const book = new Map([[k, { nudgedAt: 1, tries: 1 }]]);
    const base = {
      setting: { on: true, intervalMinutes: 15 }, roster: w.cards, readProjects: () => projects.readAll(),
      shouldWrite: () => false, write: () => {}, env: {}, readLimit: () => ({ on: false }), limitDefaults: { on: true, perHour: 20 },
      book, sent: [], now: Date.now() + INTERVAL + 1000, deliver: () => ({ state: DELIVERY.PLACED }), DELIVERY,
    };
    // The nudge is off (live execution not allowed) on the tick the old stall closes.
    nudge.prompterTick({ ...base, allowed: () => false, outcome: { toAsk: [], next: new Map([[k, { open: false }]]) } });
    assert.equal(book.has(k), false, 'the closed stall kept its entry while the nudge was off');
  } finally { w.restore(); }
});

test('a delivery that may have reached the pane (UNCONFIRMED) is never typed again in the same stall', () => {
  const w = world([{ name: 'unconf' }]);
  try {
    taskOn(w, w.key.unconf, 'a task');
    const book = new Map();
    const hb = stalled(w.cards);
    let total = 0;
    for (let i = 0; i < nudge.MAX_TRIES + 2; i += 1) total += pass(w, { book, hb, state: DELIVERY.UNCONFIRMED }).calls.length;
    assert.equal(total, 1, 'an UNCONFIRMED nudge was typed again');
  } finally { w.restore(); }
});

test('a delivery that throws is retried like COULD_NOT, capped at MAX_TRIES, and the pass goes on to the next agent', () => {
  const w = world([{ name: 'throwsa' }, { name: 'throwsb' }]);
  try {
    for (const k of Object.values(w.key)) taskOn(w, k, 'a task');
    const book = new Map();
    const hb = stalled(w.cards);
    const tries = { [w.key.throwsa]: 0, [w.key.throwsb]: 0 };
    for (let i = 0; i < nudge.MAX_TRIES + 2; i += 1) {
      nudge.sweepOnce({
        toAsk: hb.toAsk, next: hb.next, roster: w.cards, projects: projects.readAll(), book, sent: [],
        now: Date.now() + INTERVAL + 1000, intervalMs: INTERVAL, limit: { on: false },
        deliver: (session) => { tries[session] += 1; if (session === w.key.throwsa) throw new Error('pane gone'); return { state: DELIVERY.PLACED }; },
        DELIVERY,
      });
    }
    assert.equal(tries[w.key.throwsa], nudge.MAX_TRIES, 'a throwing delivery was not capped at MAX_TRIES');
    assert.equal(tries[w.key.throwsb], 1, 'the other agent was not nudged exactly once despite the throw');
  } finally { w.restore(); }
});

test('back off when the agent reports it is waiting (blocked): not nudged while blocked, nudged at its next idle stall', () => {
  const w = world([{ name: 'waiting' }]);
  try {
    const k = w.key.waiting;
    taskOn(w, k, 'a task');
    const book = new Map();
    const first = pass(w, { book });
    assert.equal(first.calls.length, 1, 'fixture: the first stall is nudged');
    // It reports blocked: the Prompter closes the stall, so it is not asked and the book lets it go.
    const blockedCards = w.cards.map((c) => (c.sessionName === k ? { ...c, state: 'blocked' } : c));
    const blocked = heartbeat.step(first.hb.next, blockedCards, true);
    assert.equal(blocked.toAsk.some((x) => x.session === k), false, 'fixture: the Prompter must not ask about a blocked agent');
    assert.equal(pass({ ...w, cards: blockedCards }, { book, hb: blocked }).calls.length, 0, 'nudged while blocked');
    assert.equal(book.has(k), false, 'the book kept the stall the agent closed by reporting blocked');
    // Back to idle: a new stall opens after the Prompter's persistent-stall wait, and it is nudged once.
    let hb = blocked;
    for (let i = 0; i < heartbeat.STARTUP_STALL_TICKS; i += 1) hb = heartbeat.step(hb.next, w.cards, true);
    assert.equal(pass(w, { book, hb }).calls.length, 1, 'the next idle stall after blocked was not nudged');
  } finally { w.restore(); }
});
