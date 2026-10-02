'use strict';
/* #4947 slice 2: the community turn. Real cards from the real producer (fleet + status.snapshot()), never hand-built
 * (fixture-discipline.test.js); every read is injected, and communitystore.postTimesBy runs against a sandboxed data
 * root.
 *
 *   node --test engine/communityturn.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-communityturn-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const ct = require('./communityturn');
const store = require('./communitystore');
const { POSTS_PER_DAY_MAX } = require('./communityblock');
const fleet = require('../test-support/fleet');
const status = require('./status');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const CARDS = (() => {
  const board = fleet.install([fleet.agent('ann', { state: 'idle' }), fleet.agent('bea', { state: 'idle' }), fleet.agent('cal', { state: 'idle' }), fleet.agent('dan', { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
const card = (s, over = {}) => { const c = CARDS.find((x) => x.sessionName === s); assert.ok(c, 'fixture: no real card for ' + s); return { ...c, ...over }; };
const NOW = Date.parse('2026-10-02T19:30:00Z');
const H = 3600e3;
const ago = (ms) => new Date(NOW - ms).toISOString();
const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };

function args(over = {}) {
  return {
    roster: [card('ann'), card('bea'), card('cal'), card('dan')], projects: [],
    now: NOW, book: new Map(),
    inCommunity: () => true, idleSince: () => NOW - H, seenIdle: new Set(['ann', 'bea', 'cal', 'dan']),
    postTimes: (s) => ({ ann: [ago(8 * H)], bea: [ago(4 * H)], cal: [ago(1 * H)], dan: [] }[s] || []),
    ...over,
  };
}

test('fixture: real cards, ours and idle', () => {
  assert.ok(CARDS.length >= 4);
  for (const s of ['ann', 'bea', 'cal', 'dan']) assert.equal(card(s).isNamedOurs, true, s);
});

test('due: last post 3 h or more ago is due (longest silent first); 1 h ago is not; never posted is left to the introduction', () => {
  assert.deepEqual(ct.due(args()).map((d) => d.session), ['ann', 'bea']);
});

test('due: at most MAX_PER_PASS a pass', () => {
  const r = ct.due(args({ postTimes: () => [ago(5 * H)] }));
  assert.equal(r.length, ct.MAX_PER_PASS);
});

test('due: the daily maximum in the last 24 h stops it; one fewer does not', () => {
  const full = Array.from({ length: POSTS_PER_DAY_MAX }, (_, i) => ago((4 + i) * H));
  const fewer = full.slice(1);
  assert.deepEqual(ct.due(args({ postTimes: (s) => (s === 'ann' ? full : []) })).map((d) => d.session), [], 'an agent at the daily maximum was prompted');
  assert.deepEqual(ct.due(args({ postTimes: (s) => (s === 'ann' ? fewer : []) })).map((d) => d.session), ['ann'], 'CONTROL: one under the maximum is due');
});

test('due: a working agent, one not ours, and one whose instructions lack the block are not prompted', () => {
  const only = (s) => (s === 'ann' ? [ago(8 * H)] : []);
  assert.deepEqual(ct.due(args({ postTimes: only, roster: [card('ann', { state: 'working' })] })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, roster: [card('ann', { isNamedOurs: false })] })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, inCommunity: () => false })), []);
  assert.deepEqual(ct.due(args({ postTimes: only })).map((d) => d.session), ['ann'], 'CONTROL: the same agent idle, ours and in the community is due');
});

test('due: an unreadable post store (null) or a throwing read prompts nobody', () => {
  assert.deepEqual(ct.due(args({ postTimes: () => null })), []);
  assert.deepEqual(ct.due(args({ postTimes: () => { throw new Error('boom'); } })), []);
  assert.deepEqual(ct.due(args({ inCommunity: () => { throw new Error('boom'); } })), []);
});

test('due: tried less than 3 h ago is not tried again; 3 h ago is; PROMPTS_PER_DAY tries in 24 h stop it', () => {
  const book = new Map([['ann', [NOW - 2 * H]]]);
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['bea']);
  book.set('ann', [NOW - 3 * H]);
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['ann', 'bea']);
  book.set('ann', Array.from({ length: ct.PROMPTS_PER_DAY }, (_, i) => NOW - (4 + 4 * i) * H));
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['bea'], 'tried past the daily limit');
});

test('due: just idle (under replynudge.IDLE_FIRST_MS by its own idle report) is not due; idle long enough is', () => {
  const { IDLE_FIRST_MS } = require('./replynudge');
  assert.deepEqual(ct.due(args({ idleSince: (s) => (s === 'ann' ? NOW - 60e3 : NOW - IDLE_FIRST_MS) })).map((d) => d.session), ['bea']);
});

test('review 2: no idle report (null or not idle) is not due; CONTROL: the same agent with an old idle report is', () => {
  assert.deepEqual(ct.due(args({ idleSince: () => null })), []);
  assert.deepEqual(ct.due(args({ idleSince: () => NaN })), []);
  assert.deepEqual(ct.due(args()).map((d) => d.session), ['ann', 'bea']);
});

test('review 2: the agent-nudge brake (AGENT_WORKFORCE_AGENT_NUDGE_OFF=1) stops the turn too', () => {
  const { sent, o } = tickArgs({ env: { AGENT_WORKFORCE_AGENT_NUDGE_OFF: '1' } });
  assert.deepEqual(ct.tickOnce(o), []);
  assert.deepEqual(sent, []);
  const ctl = tickArgs();
  assert.equal(ct.tickOnce(ctl.o).length, 2, 'CONTROL: without the brake it prompts');
});

test('the line names the same gap the gate uses', () => {
  assert.match(ct.TURN_TEXT, new RegExp((ct.TURN_GAP_MS / 3600e3) + ' hours ago or more'));
});

test('due: a stood-down agent (every project paused for it) is not due', () => {
  const projects = [{ id: 'p', agents: ['ann'], paused: true, status: 'paused' }];
  const P = require('./projects');
  assert.equal(P.isPaused(projects[0]), true, 'fixture: the project does not read as paused');
  assert.deepEqual(ct.due(args({ projects })).map((d) => d.session), ['bea']);
});

test('review 1 (a blocker): agents held on the quota are skipped BEFORE the per-pass cut, so they cannot take every pass', () => {
  const held = new Set(['ann', 'bea']);
  const r = ct.due(args({ postTimes: (s) => ({ ann: [ago(9 * H)], bea: [ago(8 * H)], cal: [ago(5 * H)], dan: [ago(4 * H)] }[s]), quotaHeld: (s) => held.has(s) }));
  assert.deepEqual(r.map((d) => d.session), ['cal', 'dan']);
});

function tickArgs(over = {}) {
  const sent = [];
  return { sent, o: {
    allowed: () => true, env: {}, switchOn: () => true, prompterOn: () => true,
    roster: () => [card('ann'), card('bea')], readProjects: () => [], now: NOW, book: new Map(), sent: [],
    readLimit: () => ({ on: true, perHour: 20 }),
    inCommunity: () => true, postTimes: () => [ago(6 * H)], idleSince: () => NOW - H, idleSeen: new Set(['ann', 'bea']),
    deliver: (s, text) => { sent.push([s, text]); return { state: D.PLACED }; }, DELIVERY: D,
    ...over,
  } };
}

test('tickOnce: prompts the due agents with the line and books them; a second pass at once sends nothing', () => {
  const { sent, o } = tickArgs();
  const r = ct.tickOnce(o);
  assert.deepEqual(r.map((x) => [x.session, x.act]), [['ann', 'prompted'], ['bea', 'prompted']]);
  assert.equal(sent[0][1], ct.TURN_TEXT);
  assert.deepEqual(ct.tickOnce(o), [], 'prompted twice within the gap');
});

test('tickOnce gates: live execution off, the brake, the community switch off, the Prompter off: nothing is sent', () => {
  for (const over of [{ allowed: () => false }, { env: { AGENT_WORKFORCE_COMMUNITY_TURN_OFF: '1' } }, { switchOn: () => false }, { prompterOn: () => false }]) {
    const { sent, o } = tickArgs(over);
    assert.deepEqual(ct.tickOnce(o), [], JSON.stringify(Object.keys(over)));
    assert.deepEqual(sent, []);
  }
});

test('tickOnce: a held line is not booked (tried again later); an unreached one IS booked, so it backs off rather than take every pass', () => {
  const heldRun = tickArgs({ roster: () => [card('ann')], deliver: () => ({ state: D.COULD_NOT, held: true }) });
  assert.equal(ct.tickOnce(heldRun.o)[0].act, 'held');
  assert.equal(heldRun.o.book.has('ann'), false);
  const lost = tickArgs({ roster: () => [card('ann')], deliver: () => ({ state: D.COULD_NOT }) });
  assert.equal(ct.tickOnce(lost.o)[0].act, 'not-reached');
  assert.deepEqual(lost.o.book.get('ann'), [NOW]);
  assert.deepEqual(lost.o.sent, [], 'an unreached line was counted in the hour log');
});

test('tickOnce: Agent Communication\'s per-hour limit, counted in the shared hour log, stops the pass; a reached line is logged', () => {
  const full = tickArgs({ sent: Array.from({ length: 20 }, () => NOW - 60e3) });
  const r = ct.tickOnce(full.o);
  assert.deepEqual(r.map((x) => x.act), ['limit']);
  assert.deepEqual(full.sent, [], 'a line went past the hour\'s limit');
  const ok = tickArgs();
  ct.tickOnce(ok.o);
  assert.deepEqual(ok.o.sent, [NOW, NOW], 'reached lines are counted in the shared hour log');
  const off = tickArgs({ sent: Array.from({ length: 20 }, () => NOW - 60e3), readLimit: () => ({ on: false, perHour: 20 }) });
  assert.equal(ct.tickOnce(off.o).filter((x) => x.act === 'prompted').length, 2, 'CONTROL: with the limit off, nothing stops it');
});

test('tickOnce: no projects read (cannot tell a stood-down agent) prompts nobody', () => {
  const { sent, o } = tickArgs({ readProjects: () => null });
  assert.deepEqual(ct.tickOnce(o), []);
  assert.deepEqual(sent, []);
});

test('the line asks for a real post, names the daily maximum, and says to do nothing rather than invent', () => {
  assert.match(ct.TURN_TEXT, /kosmos community post/);
  assert.match(ct.TURN_TEXT, new RegExp('no more than ' + POSTS_PER_DAY_MAX + ' a day'));
  assert.match(ct.TURN_TEXT, /do nothing/);
  assert.match(ct.TURN_TEXT, /Never invent/);
  assert.ok(![0x2014, 0x2013].some((c) => ct.TURN_TEXT.includes(String.fromCharCode(c))), 'a dash in product copy');
});

test('communitystore.postTimesAll: each agent\'s posts in any status, keyed lower-case, agent posts only; empty when none; null when unreadable', () => {
  const dir = path.join(require('./store').ROOT, 'community');   // communitystore's own dir()
  assert.ok(path.resolve(dir).startsWith(path.resolve(SANDBOX) + path.sep), dir);
  assert.equal(store.postTimesAll().size, 0, 'no file yet');
  const a = store.insertPost({ status: 'published', agent: 'ann', body: 'one' });
  const b = store.insertPost({ status: 'held', agent: 'ANN', body: 'two' });
  store.insertPost({ status: 'published', agent: 'bea', body: 'other' });
  store.insertPost({ status: 'published', agent: 'ann', author: { type: 'user', name: 'ann' }, body: 'a person' });
  assert.deepEqual(store.postTimesAll().get('ann').sort(), [a.receivedAt, b.receivedAt].sort());
  // postedBy's guard: a corrupt-* sidecar means earlier posts are elsewhere, so no count is given.
  fs.writeFileSync(path.join(dir, 'posts.json.corrupt-1'), '[]');
  assert.equal(store.postTimesAll(), null, 'a count from the fresh file alone was given beside a corrupt sidecar');
  fs.rmSync(path.join(dir, 'posts.json.corrupt-1'));
  assert.equal(store.postTimesAll().get('bea').length, 1, 'CONTROL: without the sidecar the store reads');
  fs.writeFileSync(path.join(dir, 'posts.json'), '{not json');
  assert.equal(store.postTimesAll(), null);
});

test('review 3: a busy pane is not booked (no try spent); a throw counts as unconfirmed, booked and in the hour log', () => {
  const busy = tickArgs({ roster: () => [card('ann')], deliver: () => ({ state: D.COULD_NOT, busy: true }) });
  assert.equal(ct.tickOnce(busy.o)[0].act, 'pane-busy');
  assert.equal(busy.o.book.has('ann'), false, 'a collision with another nudge spent a try');
  const threw = tickArgs({ roster: () => [card('ann')], deliver: () => { throw new Error('after the paste'); } });
  assert.equal(ct.tickOnce(threw.o)[0].act, 'prompted');
  assert.deepEqual(threw.o.book.get('ann'), [NOW]);
  assert.deepEqual(threw.o.sent, [NOW]);
});

test('review 4: an agent is due only if it was idle at the previous pass too; the tick keeps this pass\'s idle cards for the next', () => {
  assert.deepEqual(ct.due(args({ seenIdle: new Set(['bea']) })).map((d) => d.session), ['bea']);
  const first = tickArgs({ idleSeen: new Set() });
  assert.deepEqual(ct.tickOnce(first.o), [], 'an agent seen idle for the first time was prompted');
  assert.deepEqual([...first.o.idleSeen].sort(), ['ann', 'bea'], 'this pass\'s idle cards were not kept for the next');
  assert.equal(ct.tickOnce(first.o).length, 2, 'CONTROL: idle at the previous pass too, they are prompted');
});
