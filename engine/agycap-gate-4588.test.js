'use strict';
/* #4588 ask 3: agyquota.heldForCap / heldForAgy, the cap on how many of our Antigravity agents work at once. Real cards
 * from the real producer (fleet + status.snapshot()), never hand-built (fixture-discipline.test.js); the setting is
 * injected so no file is read. */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agycap-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('./agyquota');
const fleet = require('../test-support/fleet');
const status = require('./status');
test.beforeEach(() => { q.POOL_MEMO.bySession.clear(); q.POOL_MEMO.seen.clear(); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const AGY = { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' };
const CARDS = (() => {
  const board = fleet.install([fleet.agent('agy-a', AGY), fleet.agent('agy-b', AGY), fleet.agent('agy-c', AGY), fleet.agent('claude-x', { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
function world(states, extra = {}) {
  return Object.keys(states).map((s) => {
    const card = CARDS.find((c) => c.sessionName === s);
    assert.ok(card, 'fixture: no real card for ' + s);
    return { ...card, state: states[s], quotaUntil: null, ...(extra[s] || {}) };
  });
}
const cap = (n) => () => ({ maxWorking: n, ok: true });
const NOW = Date.parse('2026-10-02T17:00:00Z');
const NOENV = {};

test('fixture: real cards, the agy ones ours', () => {
  const r = world({ 'agy-a': 'idle', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.deepEqual(r.map((c) => [c.sessionName, c.runner]), [['agy-a', 'antigravity'], ['agy-b', 'antigravity'], ['agy-c', 'antigravity'], ['claude-x', 'claude']]);
  assert.ok(r.filter((c) => c.runner === 'antigravity').every((c) => c.isNamedOurs !== false));
});

test('at the cap: another idle agy agent is held, until one minute ahead', () => {
  const r = world({ 'agy-a': 'working', 'agy-b': 'working', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForCap('agy-c', r, NOW, cap(2), NOENV), NOW + q.CAP_RECHECK_MS);
  assert.equal(q.heldForAgy('agy-c', r, NOW, q.POOL_MEMO, NOENV, cap(2)), NOW + q.CAP_RECHECK_MS);
});

test('CONTROL: under the cap, or no limit (0), nothing is held', () => {
  const r = world({ 'agy-a': 'working', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForCap('agy-c', r, NOW, cap(2), NOENV), null, 'one working, cap two');
  const full = world({ 'agy-a': 'working', 'agy-b': 'working', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForCap('agy-c', full, NOW, cap(0), NOENV), null, 'no limit');
});

test('an agent that is already working is not held (a line to it starts no new work)', () => {
  const r = world({ 'agy-a': 'working', 'agy-b': 'working', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForCap('agy-a', r, NOW, cap(1), NOENV), null);
});

test('a Claude agent is never held by the Gemini cap, and a working Claude agent does not count', () => {
  const r = world({ 'agy-a': 'working', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'working' });
  assert.equal(q.heldForCap('claude-x', world({ 'agy-a': 'working', 'agy-b': 'working', 'agy-c': 'idle', 'claude-x': 'idle' }), NOW, cap(1), NOENV), null);
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(2), NOENV), null, 'claude-x working must not count toward the Gemini cap');
});

test('an agy pane that is not ours does not count toward the cap', () => {
  const r = world({ 'agy-a': 'working', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' }, { 'agy-a': { isNamedOurs: false } });
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), null);
});

test('the quota-hold brake lifts the cap too, and an unreadable setting holds nothing', () => {
  const r = world({ 'agy-a': 'working', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), { AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF: '1' }), null);
  assert.equal(q.heldForCap('agy-b', r, NOW, () => { throw new Error('unreadable'); }, NOENV), null);
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), NOW + q.CAP_RECHECK_MS, 'CONTROL: the same world holds without the brake');
});

test('heldForAgy: the quota hold wins when both apply, and the cap applies when the pool is not paused', () => {
  const until = new Date(NOW + 30 * 60e3).toISOString();
  const paused = world({ 'agy-a': 'working', 'agy-b': 'rate_limited', 'agy-c': 'idle', 'claude-x': 'idle' }, { 'agy-b': { quotaUntil: until } });
  assert.equal(q.heldForAgy('agy-c', paused, NOW, q.POOL_MEMO, NOENV, cap(1)), Date.parse(until));
  q.POOL_MEMO.bySession.clear(); q.POOL_MEMO.seen.clear();
  const open = world({ 'agy-a': 'working', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForAgy('agy-c', open, NOW, q.POOL_MEMO, NOENV, cap(1)), NOW + q.CAP_RECHECK_MS);
  assert.equal(q.heldForAgy('agy-c', open, NOW, q.POOL_MEMO, NOENV, cap(0)), null);
});

test('review 1: a reservation counts as working until it is released or its window passes', () => {
  q.CAP_STARTS.clear();
  const r = world({ 'agy-a': 'idle', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), null, 'CONTROL: nobody working, nobody reserved');
  const tok = q.noteCapStart('agy-a', r, NOW, cap(1));
  assert.deepEqual(tok, { name: 'agy-a', at: NOW });
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), NOW + q.CAP_RECHECK_MS, 'agy-a reserved fills the one slot');
  assert.equal(q.heldForCap('agy-a', r, NOW, cap(1), NOENV), null, 'the reserved agent itself is not held (it counts as working)');
  assert.equal(q.heldForCap('agy-b', r, NOW + q.CAP_START_MS, cap(1), NOENV), null, 'the reservation lapses after its window');
  q.noteCapStart('agy-a', r, NOW, cap(1));
  q.releaseCapStart({ name: 'agy-a', at: NOW });
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), null, 'a released reservation frees the slot');
  assert.equal(q.noteCapStart('claude-x', r, NOW, cap(1)), null, 'a Claude agent is never reserved');
  assert.equal(q.noteCapStart('agy-a', r, NOW, cap(0)), null, 'nothing is reserved while the cap is off');
  assert.equal(q.CAP_STARTS.has('agy-a'), false);
  q.CAP_STARTS.clear();
});

test('review 1: the resume sweep is capped too, and spends no try while it waits', () => {
  q.CAP_STARTS.clear();
  const until = new Date(NOW - 10 * 60e3).toISOString();
  const r = world({ 'agy-a': 'working', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  const report = { found: true, state: 'idle', by: 'auto', until, because: status.QUOTA_REPORT_PREFIX + ' Google said: ...', at: new Date(NOW - 30 * 60e3).toISOString() };
  const book = new Map();
  const sent = [];
  const deliver = (s) => { sent.push(s); return { state: 'placed' }; };
  const common = { roster: r, book, now: NOW, readReport: (s) => (s === 'agy-b' ? report : null), deliver, DELIVERY: { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' }, env: NOENV, memo: q.newPoolMemo() };
  const held = q.sweepOnce({ ...common, readCap: cap(1) });
  assert.match(held.skipped || '', /limit set for working at once/);
  assert.deepEqual(sent, [], 'nothing typed at the cap');
  assert.equal(book.has('agy-b'), false, 'no try spent');
  const free = q.sweepOnce({ ...common, readCap: cap(2) });
  assert.deepEqual(sent, ['agy-b'], 'CONTROL: under the cap the same sweep resumes it');
  assert.equal(free.results.length, 1);
  assert.equal(q.CAP_STARTS.has('agy-b'), true, 'a resume that reached the pane reserves its slot');
  q.CAP_STARTS.clear();
});

test('review 3: an active reservation is not refreshed, so a later failed line cannot release it and the window runs from the first start', () => {
  q.CAP_STARTS.clear();
  const r = world({ 'agy-a': 'idle', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  const first = q.noteCapStart('agy-a', r, NOW, cap(1));
  assert.deepEqual(first, { name: 'agy-a', at: NOW });
  const second = q.noteCapStart('agy-a', r, NOW + 2 * 60e3, cap(1));
  assert.equal(second, null, 'a second line to a reserved agent takes no new reservation');
  q.releaseCapStart(second);   // the second line reached nothing
  assert.equal(q.heldForCap('agy-b', r, NOW + 2 * 60e3, cap(1), NOENV), NOW + 2 * 60e3 + q.CAP_RECHECK_MS, 'the first reservation still holds the slot');
  assert.equal(q.heldForCap('agy-b', r, NOW + q.CAP_START_MS, cap(1), NOENV), null, 'the window ran from the FIRST start, not the second line');
  q.CAP_STARTS.clear();
});

test('review 3: nothing is reserved under the quota-hold brake', () => {
  q.CAP_STARTS.clear();
  const r = world({ 'agy-a': 'idle', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  assert.equal(q.noteCapStart('agy-a', r, NOW, cap(1), { AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF: '1' }), null);
  assert.equal(q.CAP_STARTS.size, 0);
  assert.deepEqual(q.noteCapStart('agy-a', r, NOW, cap(1), NOENV), { name: 'agy-a', at: NOW }, 'CONTROL: without the brake it reserves');
  q.CAP_STARTS.clear();
});

test('review 7: a reservation made AFTER the caller\'s now (a sweep that read its clock once) still holds the next agent', () => {
  q.CAP_STARTS.clear();
  const r = world({ 'agy-a': 'idle', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  // The tick read NOW; the first agent's delivery reserved two seconds later.
  assert.deepEqual(q.noteCapStart('agy-a', r, NOW + 2000, cap(1), NOENV), { name: 'agy-a', at: NOW + 2000 });
  assert.equal(q.heldForAgy('agy-b', r, NOW, q.newPoolMemo(), NOENV, cap(1)), NOW + q.CAP_RECHECK_MS, 'the second agent got through on the tick\'s stale clock');
  assert.equal(q.CAP_STARTS.has('agy-a'), true, 'the stale-clock check deleted the first agent\'s fresh reservation');
  assert.equal(q.heldForCap('agy-b', r, NOW + 2500, cap(1), NOENV), NOW + 2500 + q.CAP_RECHECK_MS, 'the fresh-clock gate no longer sees it');
  // CONTROL: one dated past a whole window ahead is implausible and dropped; one a window old has lapsed.
  q.CAP_STARTS.set('agy-a', NOW + q.CAP_START_MS + 1);
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), null);
  q.CAP_STARTS.set('agy-a', NOW - q.CAP_START_MS);
  assert.equal(q.heldForCap('agy-b', r, NOW, cap(1), NOENV), null);
  q.CAP_STARTS.clear();
});

test('review 7: autoretell\'s re-check through the REAL heldForAgy, with the tick\'s one clock, holds the second member at cap 1', () => {
  q.CAP_STARTS.clear();
  const autoretell = require('./autoretell');
  const r = world({ 'agy-a': 'idle', 'agy-b': 'idle', 'agy-c': 'idle', 'claude-x': 'idle' });
  const T0 = NOW;
  const couldNot = { state: autoretell.COULD_NOT, because: 'no instructions file yet', at: new Date(T0).toISOString() };
  const tickNow = T0 + 1000 + autoretell.SETTLE_MS;   // read ONCE, as server.js's autoretellTick does
  let clock = tickNow;
  const memo = q.newPoolMemo();
  const ready = (name) => q.heldForAgy(name, r, tickNow, memo, NOENV, cap(1)) === null;
  const sent = [];
  const retell = (name) => { clock += 2000; sent.push(name); q.noteCapStart(name, r, clock, cap(1), NOENV); return { told: { state: 'told' } }; };
  const w = { projects: [{ id: 'p1', agents: ['agy-a', 'agy-b'], told: { 'agy-a': couldNot, 'agy-b': couldNot } }], mtimeOf: () => T0 + 1000, now: tickNow, acted: new Map() };
  autoretell.sweepOnce({ ...w, ready, retell });
  assert.deepEqual(sent, ['agy-a'], 'the second member was retold although the first one\'s reservation fills the cap');
  assert.equal(w.acted.has('agy-b'), false, 'the held member\'s retell was spent');
  q.CAP_STARTS.clear();
});
