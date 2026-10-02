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
    roster: [card('kim')], projects: [], book: new Map(), sent: [], limit: { on: false }, betweenAgentsMs: 0, typeGapMs: 0, busyWaitMs: 0,
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
  assert.equal(require('./projects').isPaused(paused), true, 'fixture: the paused project does not read as paused');
  const { o, typed } = rig({ projects: [paused] });
  await rn.sweepOnce(o);
  assert.equal(typed.length, 0, 'a stood-down agent was nudged');
  o.projects = [paused, live];
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'an agent with a live project was not nudged');
  assert.equal(rn.stoodDown('kim', []), false, 'an agent in no project read as stood down');
});

test('#4951 Agent Communication\'s hour cap holds a nudge (shared log), and a busy board is tried next pass', async () => {
  const now = Date.now();
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
    return { typed, o: Object.assign(o, { allowed: () => true, env: {}, prompterOn: () => true, switchOn: () => true, roster: () => [card('kim')], readProjects: () => [], readLimit: () => ({ on: false }) }) };
  };
  for (const [what, change] of [['not allowed', { allowed: () => false }], ['the Prompter off', { prompterOn: () => false }], ['the brake', { env: { AGENT_WORKFORCE_AGENT_NUDGE_OFF: '1' } }],
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
    ['the switch', /switchOn: \(\) => communitysend\.switchOn\(\)/], ['the board root store', /replynudge\.readNudged\(store\.ROOT, session\)/],
    ['the rotation kept across passes (review 8)', /rotation: REPLY_NUDGE_ROTATION/]]) {
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

test('#4951 review 1: every count is read before anything is typed (the read lock is free when a told agent reads)', async () => {
  const order = [];
  const { o } = rig({ roster: [card('kim'), card('ann')],
    fresh: async (s) => { order.push('read ' + s); return { ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }; },
    deliver: (s) => { order.push('type ' + s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);
  assert.deepEqual(order, ['read kim', 'read ann', 'type kim', 'type ann'], 'a nudge was typed while counts were still being read');
});

test('#4951 review 2: the gap follows every read that ran (agents with nothing new included), and the hour log stays in time order', async () => {
  const gaps = [];
  const realSetTimeout = global.setTimeout;
  const { o } = rig({ roster: [card('kim'), card('ann'), card('bo')], betweenAgentsMs: 7, fresh: async () => ({ ok: true, posts: [] }) });
  global.setTimeout = (fn, ms, ...a) => { if (ms === 7) gaps.push(ms); return realSetTimeout(fn, 0, ...a); };
  try { await rn.sweepOnce(o); } finally { global.setTimeout = realSetTimeout; }
  assert.equal(gaps.length, 2, 'the gap was skipped after agents with nothing new');
  const later = Date.now() + 60000;
  const s = rig({ sent: [later] });   // agentnudge pushed a later pass-start time already
  await rn.sweepOnce(s.o);
  assert.ok(s.o.sent.length === 2 && s.o.sent[0] <= s.o.sent[1], 'the shared hour log is out of time order: ' + JSON.stringify(s.o.sent));
});

test('#4951 review 2: replies an agent was already told about take no cap slot; a later agent is still read and told', async () => {
  const typed = [];
  const store = new Map([['kim', ['r-kim']], ['ann', ['r-ann']]]);
  const { o } = rig({ roster: [card('kim'), card('ann'), card('bo')], limit: { on: true, perHour: 1 },
    fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }),
    readNudged: (s) => new Set(store.get(s) || []), writeNudged: (s, set) => { store.set(s, [...set]); return true; },
    deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);
  assert.deepEqual(typed, ['bo'], 'agents already told used up the cap before the one with a new reply');
});

test('#4951 review 2: if the told store cannot be written, the next pass still does not repeat the nudge', async () => {
  const typed = [];
  const { o } = rig({ writeNudged: () => false, readNudged: () => new Set(), deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'a reply was nudged again because its record could not be written');
});

test('#4951 review 3: a failed delivery keeps the told ids held in memory (store unwritable), so an earlier reply is not told again', async () => {
  const typed = [];
  let ids = ['a'];
  let ok = true;
  const { o } = rig({ writeNudged: () => false, readNudged: () => new Set(),
    fresh: async () => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids }] }),
    deliver: (s, text) => { typed.push(text); return { state: ok ? D.PLACED : D.COULD_NOT }; } });
  await rn.sweepOnce(o);            // told about a; the store cannot be written, so a is held in memory
  ids = ['a', 'b']; ok = false;
  await rn.sweepOnce(o);            // b fails to deliver
  ok = true;
  await rn.sweepOnce(o);            // b again: the line must count only b
  assert.match(typed[typed.length - 1], /you have 1 new reply/, 'a was told again after a failed delivery: ' + typed[typed.length - 1]);
});

test('#4951 review 3 (Opus): the gates are asked again before each line; switched off mid-pass, the next agent is not told', async () => {
  const typed = [];
  let open = true;
  const { o } = rig({ roster: [card('kim'), card('ann')], fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }),
    deliver: (s) => { typed.push(s); open = false; return { state: D.PLACED }; } });
  o.gatesOpen = () => open;
  await rn.sweepOnce(o);
  assert.deepEqual(typed, ['kim'], 'a line was typed after the community (or the Prompter) was switched off');
});

test('#4951 review 3 (Opus): a batch given up on takes no cap slot; a later agent is still told', async () => {
  const typed = [];
  const { o } = rig({ roster: [card('kim'), card('ann')], limit: { on: true, perHour: 1 },
    fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }),
    deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  o.book.set('kim', { key: 'r-kim', tries: rn.MAX_TRIES });
  await rn.sweepOnce(o);
  assert.deepEqual(typed, ['ann'], 'a given-up batch held the only cap slot');
});

test('#4951 review 3 (Opus): only a missing told record is "told nothing"; an unreadable one skips the agent', async () => {
  const root = path.join(SANDBOX, 'unreadable');
  assert.deepEqual([...rn.readNudged(root, 'none')], [], 'a missing record did not read as empty');
  fs.mkdirSync(path.dirname(rn.nudgedFile(root, 'torn')), { recursive: true });
  fs.writeFileSync(rn.nudgedFile(root, 'torn'), '{not json');
  assert.equal(rn.readNudged(root, 'torn'), null, 'a torn record read as told nothing');
  fs.writeFileSync(rn.nudgedFile(root, 'locked'), JSON.stringify({ ids: ['a'] }));
  fs.chmodSync(rn.nudgedFile(root, 'locked'), 0o000);   // EACCES: a read ERROR, not a missing file
  try { assert.equal(rn.readNudged(root, 'locked'), null, 'an unreadable record (EACCES) read as told nothing'); }
  finally { fs.chmodSync(rn.nudgedFile(root, 'locked'), 0o600); }
  const typed = [];
  const { o } = rig({ readNudged: () => null, deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);
  assert.equal(typed.length, 0, 'an agent whose told record could not be read was told again');
});

test('#4951 review 3 (Opus): the defaults the timing relies on: a waiting read gives up well under the CLI\'s 30 s; lines are spaced', () => {
  const cr = require('./communityread');
  assert.ok(cr.FRESH_WAIT_MS > 0 && cr.FRESH_WAIT_MS <= 20000, 'FRESH_WAIT_MS ' + cr.FRESH_WAIT_MS);
  assert.ok(rn.TYPE_GAP_MS >= 15000, 'TYPE_GAP_MS ' + rn.TYPE_GAP_MS);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /prompterOn: \(\) => heartbeatSetting\.read\(\)\.on === true/, 'server.js does not pass the Prompter gate');
});

test('#4951 review 4 (Opus): an agent held on its Google quota is not read and takes no cap slot; a later agent is told', async () => {
  const typed = [];
  const read = [];
  const { o } = rig({ roster: [card('kim'), card('ann'), card('bo')], limit: { on: true, perHour: 1 },
    fresh: async (s) => { read.push(s); return { ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }; },
    deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  let rosterSeen = null;
  o.quotaHeld = (s, roster) => { rosterSeen = roster; return s !== 'bo'; };
  const r = await rn.sweepOnce(o);
  assert.deepEqual(read, ['bo'], 'a quota-held agent was read');
  assert.deepEqual(typed, ['bo'], 'quota-held agents held the only cap slot');
  assert.deepEqual(r.results.filter((x) => x.act === 'quota-held').map((x) => x.session), ['kim', 'ann']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.equal(rosterSeen, o.roster, 'review 6: the quota check was not given the pass\'s roster');
  assert.match(src, /quotaHeld: \(session, roster\) => require\('\.\/engine\/agyquota'\)\.heldForQuota\(session, roster, /, 'server.js does not pass the quota gate with the pass\'s roster (no new snapshot per agent)');
});

test('#4951 review 4 (Opus): an unreadable told record costs no service read, and the skip is said once, not every pass', async () => {
  const read = [];
  const said = [];
  const { o } = rig({ readNudged: () => null, fresh: async (s) => { read.push(s); return { ok: true, posts: [] }; }, log: (x) => said.push(x.act) });
  await rn.sweepOnce(o);
  await rn.sweepOnce(o);
  assert.deepEqual(read, [], 'the service was asked for an agent that is always skipped');
  assert.deepEqual(said, ['skipped'], 'the skip was not said exactly once across two passes');
});

test('#4951 review 4 (Opus): the hour\'s limit is re-read before each line; turned on mid-pass, it holds the next line', async () => {
  const typed = [];
  let limit = { on: false };
  const { o } = rig({ roster: [card('kim'), card('ann')], fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }),
    deliver: (s) => { typed.push(s); limit = { on: true, perHour: 1 }; return { state: D.PLACED }; } });
  o.limitNow = () => limit;
  await rn.sweepOnce(o);
  assert.deepEqual(typed, ['kim'], 'a limit turned on mid-pass was not obeyed');
});

test('#4951 review 5 (Sonnet): an agent that read its replies after they were counted is not told; an unchanged one is', async () => {
  const typed = [];
  const marks = { kim: 'm0', ann: 'm0' };
  const { o } = rig({ roster: [card('kim'), card('ann')],
    fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }], marksAt: marks[s] }),
    deliver: (s) => { typed.push(s); marks.ann = 'm1'; return { state: D.PLACED }; } });
  o.marksNow = (s) => marks[s];
  const r = await rn.sweepOnce(o);
  assert.deepEqual(typed, ['kim'], 'a count made stale by the agent\'s own read was still typed');
  assert.deepEqual(r.results.filter((x) => x.act === 'read-meanwhile').map((x) => x.session), ['ann']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /marksNow: \(session\) => communityread\.marksStamp\(session\)/, 'server.js does not pass the marks stamp');
});

test('#4951 review 6 (Opus): a delivery held for quota is no failed try; after the reset the reply is told once', async () => {
  const { o, typed } = rig({});
  let held = 3;
  o.deliver = (s, text) => { if (held > 0) { held -= 1; return { state: D.COULD_NOT, held: true }; } typed.push({ s, text }); return { state: D.PLACED }; };
  for (let i = 0; i < 5; i += 1) await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'a reply held for quota three passes (past MAX_TRIES) was never told, or told twice: ' + typed.length);
});

test('#4951 review 6 (Opus): a busy count waits for the read and asks again, so later agents are counted; a refusing service ends the pass', async () => {
  const typed = [];
  const asked = [];
  let busyLeft = 2;
  const { o } = rig({ roster: [card('kim'), card('ann')], busyWaitMs: 0,
    fresh: async (s) => { asked.push(s); if (busyLeft > 0) { busyLeft -= 1; return { ok: false, busy: true, because: 'a read is waiting' }; } return { ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }; },
    deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);
  assert.deepEqual(typed, ['kim', 'ann'], 'a busy count left agents untold this pass');
  assert.ok(rn.BUSY_RETRIES * rn.BUSY_WAIT_MS >= 16000, 'the retries do not outlast an agent\'s own read');
  const stopped = [];
  const { o: o2 } = rig({ roster: [card('kim'), card('ann')], busyWaitMs: 0,
    fresh: async (s) => { stopped.push(s); return { ok: false, busy: true, stop: true, because: 'the community service is limiting requests' }; } });
  await rn.sweepOnce(o2);
  assert.deepEqual(stopped, ['kim'], 'a refusing service was asked again, or asked about a later agent');
});

test('#4951 review 7 (Sonnet): a pane still placing another message is busy, not a failed try; the reply is told once after', async () => {
  const { o, typed } = rig({});
  let busy = 4;
  o.deliver = (s, text) => { if (busy > 0) { busy -= 1; return { state: D.COULD_NOT, busy: true }; } typed.push({ s, text }); return { state: D.PLACED }; };
  for (let i = 0; i < 6; i += 1) await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'a reply whose pane was busy past MAX_TRIES passes was never told, or told twice: ' + typed.length);
  const src = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  assert.match(src, /still being placed in its window, so this one was not typed',\n[^\n]*\n\s*busy: true,/, 'chat.js no longer marks the being-placed refusal busy');
});

test('#4951 review 7 (Sonnet): nothing is read for a stood-down agent, nor once the hour cap is met', async () => {
  const asked = [];
  const paused = { id: 'p1', agents: ['kim'], tasks: [], paused: true };
  const a = rig({ projects: [paused], fresh: async (s) => { asked.push(s); return { ok: true, posts: [] }; } });
  await rn.sweepOnce(a.o);
  assert.deepEqual(asked, [], 'a stood-down agent was read');
  const now = Date.now();
  const b = rig({ limit: { on: true, perHour: 1 }, sent: [now - 1000], fresh: async (s) => { asked.push(s); return { ok: true, posts: [] }; } });
  await rn.sweepOnce(b.o);
  assert.deepEqual(asked, [], 'replies were read with the hour cap already met');
});

test('#4951 review 7 (Sonnet): a told record that turns unreadable between the count and the line types nothing', async () => {
  let reads = 0;
  const { o, typed } = rig({});
  o.readNudged = () => { reads += 1; return reads === 1 ? new Set() : null; };
  const r = await rn.sweepOnce(o);
  assert.equal(reads, 2, 'fixture: the record was not read at both points');
  assert.equal(typed.length, 0, 'a line was typed with the told record unreadable');
  assert.ok(!r.results.some((x) => x.act === 'error'), 'the unreadable record reached plan() and threw');
});

test('#4951 review 8 (Opus): each pass starts after the last agent asked, so a pass that ends early does not starve the same agents', async () => {
  const run = async (rotation) => {
    const asked = [];
    const typed = [];
    const { o } = rig({ roster: [card('kim'), card('ann'), card('bo')], rotation,
      fresh: async (s) => { asked.push(s); return s === 'ann' ? { ok: false, busy: true, stop: true, because: 'the community service did not answer' } : { ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }; },
      deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
    for (let i = 0; i < 3; i += 1) await rn.sweepOnce(o);
    return { asked, typed };
  };
  const rot = { after: null };
  const a = await run(rot);
  assert.ok(a.typed.includes('bo'), 'an agent after one whose count stops the pass was never told: ' + JSON.stringify(a));
  assert.deepEqual(a.asked.slice(0, 3), ['kim', 'ann', 'bo'], 'the second pass did not start after the last agent asked');
  const b = await run(undefined);   // CONTROL: without a rotation, roster order every pass, and bo starves
  assert.ok(!b.asked.includes('bo'), 'control: bo was reached without a rotation, so this test cannot see starvation');
});

test('#4951 review 8 (Opus): a quota hold or a busy pane at typing time is said once per change of state, not every pass', async () => {
  const said = [];
  const { o, typed } = rig({ log: (r) => said.push(r.act) });
  const answers = [{ held: true }, { held: true }, { busy: true }, { busy: true }, { held: true }];
  o.deliver = (s, text) => { const a = answers.shift(); if (a) return { state: D.COULD_NOT, ...a }; typed.push(text); return { state: D.PLACED }; };
  for (let i = 0; i < 6; i += 1) await rn.sweepOnce(o);
  assert.deepEqual(said, ['quota-held', 'pane-busy', 'quota-held', 'nudge'], 'not one line per change of state');
  assert.equal(typed.length, 1);
});

test('#4951 review 8 (Opus): the lines are spaced by typeGapMs (between two lines, not before the first)', async () => {
  const gaps = [];
  const realSetTimeout = global.setTimeout;
  const { o, typed } = rig({ roster: [card('kim'), card('ann'), card('bo')], typeGapMs: 13,
    fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }) });
  global.setTimeout = (fn, ms, ...a) => { if (ms === 13) gaps.push(ms); return realSetTimeout(fn, 0, ...a); };
  try { await rn.sweepOnce(o); } finally { global.setTimeout = realSetTimeout; }
  assert.equal(typed.length, 3);
  assert.equal(gaps.length, 2, 'the lines were not spaced: ' + gaps.length);
});

test('#4951 review 8 (Opus): ids held in memory (store unwritable) take no cap slot at count time; a later agent is still read and told', async () => {
  const typed = [];
  let annHas = [];
  const { o } = rig({ roster: [card('kim'), card('ann')], limit: { on: true, perHour: 2 }, writeNudged: () => false, readNudged: () => new Set(),
    fresh: async (s) => ({ ok: true, posts: s === 'kim' ? [{ remoteId: P1, title: 't', ids: ['r-kim'] }] : (annHas.length ? [{ remoteId: P2, title: 't', ids: annHas }] : []) }),
    deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);   // kim told; the store cannot be written, so r-kim is held in memory; one slot of two used
  annHas = ['r-ann'];
  await rn.sweepOnce(o);   // kim's r-kim is still unread: held in memory, it must take no slot, so ann is read
  assert.deepEqual(typed, ['kim', 'ann'], 'a reply held in memory took the last cap slot at count time');
});

test('#4951 review 8 (Opus): the hour log ages out during the count too, so a slot freed mid-pass is used', async () => {
  const t0 = Date.now();
  let calls = 0;
  const typed = [];
  const { o } = rig({ roster: [card('kim'), card('ann')], limit: { on: true, perHour: 2 }, sent: [t0 - 60 * 60 * 1000 + 50],
    clock: () => (calls++ === 0 ? t0 : t0 + 100),
    fresh: async (s) => ({ ok: true, posts: [{ remoteId: P1, title: 't', ids: ['r-' + s] }] }),
    deliver: (s) => { typed.push(s); return { state: D.PLACED }; } });
  await rn.sweepOnce(o);
  assert.deepEqual(typed, ['kim', 'ann'], 'an hour-log entry that aged out during the count still held a slot');
});
