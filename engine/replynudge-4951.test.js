'use strict';
/**
 * kosmos#4951: an idle agent is told, once per reply, that its community post has new replies. The planner and the pass
 * are driven through their injections (no pane, no service); communityread.test.js holds what freshReplies counts.
 *
 *   node --test engine/replynudge-4951.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-replynudge-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const rn = require('./replynudge');
const fleet = require('../test-support/fleet');
/* REAL cards from the fleet fixture (fixture-discipline: no hand-built card); an arm varies one field on a copy. */
const BOARD = fleet.install(['kim', 'ann', 'bo'].map((n) => fleet.agent(n, { state: 'idle' })).concat([fleet.agent('wok', { state: 'working' })]));
test.after(() => BOARD.restore());

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const card = (name, over) => {
  const real = BOARD.agents.find((a) => a.sessionName === name);
  assert.ok(real, 'fixture: no card for ' + name);
  return Object.assign({}, real, over || {});
};
const fresh = (posts) => async () => ({ ok: true, posts });
const P1 = 'a1000000-0000-4000-8000-000000000001';
const P2 = 'a1000000-0000-4000-8000-000000000002';

/* A pass with an in-memory nudged store and a recording deliver. */
function rig(over) {
  const store = new Map();
  const typed = [];
  const o = Object.assign({
    roster: [card('kim')], projects: [], book: new Map(), sent: [], limit: { on: false }, now: Date.parse('2026-10-01T12:00:00Z'),
    fresh: fresh([{ remoteId: P1, title: 'Shipping notes', ids: ['r1', 'r2'] }]),
    readNudged: (s) => new Set(store.get(s) || []), writeNudged: (s, set) => { store.set(s, [...set]); return true; },
    deliver: (s, text) => { typed.push({ s, text }); return { state: D.PLACED }; }, DELIVERY: D,
  }, over || {});
  return { o, store, typed };
}

test('#4951 the line names the count, the post and the command; plural, singular and several posts', () => {
  assert.equal(rn.nudgeText([{ title: 'Shipping notes', ids: ['a', 'b'] }]),
    "Kosmos here: you have 2 new replies on your community post 'Shipping notes'. Answer each once: kosmos community read --replies");
  assert.match(rn.nudgeText([{ title: '', ids: ['a'] }]), /you have 1 new reply on your community post\. Answer each once/);
  assert.match(rn.nudgeText([{ title: 'One', ids: ['a'] }, { title: 'Two', ids: ['b', 'c'] }]),
    /you have 3 new replies on 2 of your community posts, including 'One'\./);
  assert.ok(!/[\u0000-\u001f"]/.test(rn.nudgeText([{ title: 'a "quoted"\nline', ids: ['x'] }])), 'a title put a quote or a control character in the typed line');
});

test('#4951 once per reply: a second pass with the same replies types nothing; a new reply is told on its own', async () => {
  const { o, store, typed } = rig();
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1);
  assert.match(typed[0].text, /2 new replies on your community post 'Shipping notes'/);
  assert.deepEqual(store.get('kim').sort(), ['r1', 'r2']);
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'the same replies were nudged twice');
  o.fresh = fresh([{ remoteId: P1, title: 'Shipping notes', ids: ['r1', 'r2', 'r3'] }]);
  await rn.sweepOnce(o);
  assert.equal(typed.length, 2);
  assert.match(typed[1].text, /you have 1 new reply on/, 'the new reply was not told on its own');
});

test('#4951 a delivery that reached nothing is tried again, and given up on after MAX_TRIES for the same batch', async () => {
  const { o, store, typed } = rig({ deliver: (s, text) => { typed.push({ s, text }); return { state: D.COULD_NOT }; } });
  for (let i = 0; i < rn.MAX_TRIES + 2; i += 1) await rn.sweepOnce(o);
  assert.equal(typed.length, rn.MAX_TRIES, 'not tried exactly MAX_TRIES times');
  assert.equal(store.has('kim'), false, 'an undelivered nudge was recorded as told');
  // UNCONFIRMED may have reached the pane: it is recorded, so it is never repeated.
  const r2 = rig({ deliver: () => ({ state: D.UNCONFIRMED }) });
  await rn.sweepOnce(r2.o);
  assert.deepEqual(r2.store.get('kim').sort(), ['r1', 'r2']);
});

test('#4951 only an idle card of ours is read at all; a working agent is looked at again next pass', async () => {
  let reads = 0;
  assert.equal(card('wok').state, 'working', 'fixture: wok is not working');
  const { o, typed } = rig({ roster: [card('wok'), card('ann', { isNamedOurs: false }), card('bo', { swarm: { active: false } })],
    fresh: async () => { reads += 1; return { ok: true, posts: [{ remoteId: P1, title: 'x', ids: ['r1'] }] }; } });
  await rn.sweepOnce(o);
  assert.equal(reads, 0, 'a card that would not be nudged had its replies read');
  assert.equal(typed.length, 0);
  o.roster = [card('kim')];   // CONTROL: an idle card of ours
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1);
});

test('#4951 an agent stood down (every project it is in paused, or switched off for it) is left alone; one live project is enough', async () => {
  const paused = { id: 'p1', agents: ['kim'], tasks: [], paused: true };
  const live = { id: 'p2', agents: ['kim'], tasks: [] };
  assert.equal(rn.stoodDown('kim', [paused]), require('./projects').isPaused(paused), 'fixture: isPaused does not read this shape');
  const { o, typed } = rig({ projects: [paused] });
  if (require('./projects').isPaused(paused)) {
    await rn.sweepOnce(o);
    assert.equal(typed.length, 0, 'a stood-down agent was nudged');
  }
  o.projects = [paused, live];
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'an agent with a live project was not nudged');
  assert.equal(rn.stoodDown('kim', []), false, 'an agent in no project read as stood down');
});

test('#4951 Agent Communication\'s hour cap holds a nudge (shared log), and a busy board is tried next pass', async () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  const { o, typed } = rig({ limit: { on: true, perHour: 2 }, sent: [now - 1000, now - 2000] });
  const r = await rn.sweepOnce(o);
  assert.equal(typed.length, 0, 'a nudge went past the hour cap');
  assert.ok(!r.results.some((x) => x.act === 'nudge'));
  const b = rig({ fresh: async () => ({ ok: false, busy: true, because: 'another read' }) });
  const rb = await rn.sweepOnce(b.o);
  assert.equal(rb.results[0].act, 'busy');
  assert.equal(b.typed.length, 0);
});

test('#4951 tick: inert unless live execution is allowed, the brake is off, the community is on and the projects read', async () => {
  const base = () => {
    const { o, typed } = rig();
    return { typed, o: Object.assign(o, { allowed: () => true, env: {}, switchOn: () => true, roster: () => [card('kim')], readProjects: () => [], readLimit: () => ({ on: false }) }) };
  };
  for (const [what, change] of [['not allowed', { allowed: () => false }], ['the brake', { env: { AGENT_WORKFORCE_AGENT_NUDGE_OFF: '1' } }],
    ['switched off', { switchOn: () => false }], ['projects unreadable', { readProjects: () => { throw new Error('x'); } }], ['roster unreadable', { roster: () => null }]]) {
    const b = base();
    const r = await rn.tick(Object.assign(b.o, change));
    assert.equal(r, null, what + ' still ran');
    assert.equal(b.typed.length, 0, what + ' still typed');
  }
  const b = base();   // CONTROL: every gate open
  const r = await rn.tick(b.o);
  assert.ok(Array.isArray(r) && b.typed.length === 1, 'the open tick did not nudge');
});

test('#4951 the nudged store: one file per agent under the board root, kept to NUDGED_MAX, a twin name is never shared', () => {
  const root = path.join(SANDBOX, 'root');
  const many = new Set(Array.from({ length: rn.NUDGED_MAX + 50 }, (_, i) => 'id' + i));
  assert.equal(rn.writeNudged(root, 'Mara', many), true);
  const back = rn.readNudged(root, 'Mara');
  assert.equal(back.size, rn.NUDGED_MAX);
  assert.ok(back.has('id' + (rn.NUDGED_MAX + 49)) && !back.has('id0'), 'the newest ids were not the ones kept');
  assert.equal(rn.readNudged(root, 'mara').size, 0, 'a twin name read another agent\'s store');
  assert.notEqual(rn.nudgedFile(root, 'Mara'), rn.nudgedFile(root, 'mara'));
});

test('#4951 server.js runs the pass on its interval, with the agent nudge\'s shared hour log and the agent\'s own read as the source', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('replynudge.tick({');
  assert.notEqual(at, -1, 'server.js does not run the reply nudge');
  const call = src.slice(at, src.indexOf('replynudge.REPLY_NUDGE_INTERVAL_MS);', at));
  for (const [what, re] of [['the read', /fresh: \(session\) => communityread\.freshReplies\(session\)/], ['the shared hour log', /sent: AGENT_NUDGE_SENT/],
    ['the typing path', /chat\.deliverAutomatic\(session, text, r/], ['the live-execution gate', /allowed: \(\) => liveExecution\.liveExecutionAllowed\(\)/],
    ['the switch', /switchOn: \(\) => communitysend\.switchOn\(\)/], ['the board root store', /replynudge\.readNudged\(store\.ROOT, session\)/]]) {
    assert.match(call, re, 'server.js does not pass ' + what);
  }
  assert.match(src, /if \(replyNudgeRunning\) return;/, 'a pass can stack on one still running');
});

test('#4951 review 1: the card is read again after the replies are read; an agent that started working meanwhile is not typed into', async () => {
  const { o, typed } = rig();
  o.rosterNow = () => [card('kim', { state: 'working' })];   // it began a turn while its replies were being read
  await rn.sweepOnce(o);
  assert.equal(typed.length, 0, 'a nudge was typed into an agent that had started working');
  o.rosterNow = () => [card('kim')];   // CONTROL: still idle
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1);
  const s = rig();
  s.o.projectsNow = () => [{ id: 'p', agents: ['kim'], tasks: [], paused: true }];   // stood down meanwhile
  await rn.sweepOnce(s.o);
  assert.equal(s.typed.length, 0, 'an agent stood down while its replies were read was nudged');
});

test('#4951 review 1: a title\'s invisible characters (line separators, bidi, zero-width) do not reach the typed line', () => {
  const t = rn.nudgeText([{ title: 'ok\u2028next\u202eevil\u200bzw', ids: ['x'] }]);
  assert.ok(!/[\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(t), 'an invisible character reached the line');
});
