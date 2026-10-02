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
    roster: [card('ann'), card('bea'), card('cal'), card('dan')],
    now: NOW, book: new Map(),
    inCommunity: () => true,
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

test('due: prompted less than 3 h ago is not prompted again; 3 h ago is', () => {
  const book = new Map([['ann', NOW - 2 * H]]);
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['bea']);
  book.set('ann', NOW - 3 * H);
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['ann', 'bea']);
});

function tickArgs(over = {}) {
  const sent = [];
  return { sent, o: {
    allowed: () => true, env: {}, switchOn: () => true, prompterOn: () => true,
    roster: () => [card('ann'), card('bea')], now: NOW, book: new Map(),
    inCommunity: () => true, postTimes: () => [ago(6 * H)],
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

test('tickOnce: a held line and an unreached one are not booked, so a later pass tries again', () => {
  for (const verdict of [{ state: D.COULD_NOT, held: true }, { state: D.COULD_NOT }]) {
    const { o } = tickArgs({ roster: () => [card('ann')], deliver: () => verdict });
    const r = ct.tickOnce(o);
    assert.equal(r[0].act, verdict.held ? 'held' : 'not-reached');
    assert.equal(o.book.has('ann'), false);
  }
});

test('the line asks for a real post, names the daily maximum, and says to do nothing rather than invent', () => {
  assert.match(ct.TURN_TEXT, /kosmos community post/);
  assert.match(ct.TURN_TEXT, new RegExp('no more than ' + POSTS_PER_DAY_MAX + ' a day'));
  assert.match(ct.TURN_TEXT, /do nothing/);
  assert.match(ct.TURN_TEXT, /Never invent/);
  assert.ok(![0x2014, 0x2013].some((c) => ct.TURN_TEXT.includes(String.fromCharCode(c))), 'a dash in product copy');
});

test('communitystore.postTimesBy: this agent\'s posts in any status, case-insensitive, agent posts only; [] when none; null when unreadable', () => {
  const dir = path.join(require('./store').ROOT, 'community');   // communitystore's own dir()
  assert.ok(path.resolve(dir).startsWith(path.resolve(SANDBOX) + path.sep), dir);
  assert.deepEqual(store.postTimesBy('Ann'), [], 'no file yet');
  const a = store.insertPost({ status: 'published', agent: 'ann', body: 'one' });
  const b = store.insertPost({ status: 'held', agent: 'ANN', body: 'two' });
  store.insertPost({ status: 'published', agent: 'bea', body: 'other' });
  store.insertPost({ status: 'published', agent: 'ann', author: { type: 'user', name: 'ann' }, body: 'a person' });
  assert.deepEqual(store.postTimesBy('ann').sort(), [a.receivedAt, b.receivedAt].sort());
  fs.writeFileSync(path.join(dir, 'posts.json'), '{not json');
  assert.equal(store.postTimesBy('ann'), null);
});
