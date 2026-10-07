'use strict';
/* #4588: agents paused on their Google account's shared Antigravity quota are resumed after the reset, ONE AT A TIME. */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
// Sandbox every root BEFORE requiring any engine module (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agyquota-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert');
const q = require('./agyquota');
const fleet = require('../test-support/fleet');

const RESET = '2026-09-28T22:11:54.000Z';
const AT = Date.parse(RESET);
const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const status = require('./status');
// The shape the bridge really writes (status.js keys on its first sentence).
const paused = (until) => ({ found: true, state: 'idle', by: 'auto', until: until || RESET, because: status.QUOTA_REPORT_PREFIX + ' Google said: ...' });

// Real cards from the real producer (fleet + status.snapshot()), never hand-built (fixture-discipline.test.js). Each
// test gets plain copies with only the state its scenario needs.
const AGY = { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' };
const CARDS = (() => {
  const board = fleet.install([fleet.agent('agy-a', AGY), fleet.agent('agy-b', AGY), fleet.agent('agy-c', AGY), fleet.agent('agy-free', AGY), fleet.agent('claude-x', { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
const STATES = { 'agy-a': 'rate_limited', 'agy-b': 'idle', 'agy-c': 'unknown', 'agy-free': 'idle', 'claude-x': 'idle' };
function world(reports) {
  const roster = Object.keys(STATES).map((s) => {
    const card = CARDS.find((c) => c.sessionName === s);
    assert.ok(card, 'fixture: no real card for ' + s);
    return { ...card, state: STATES[s] };
  });
  const sent = [];
  return {
    roster, sent, book: new Map(),
    readReport: (s) => reports[s] || { found: false },
    deliver: (s, text) => { sent.push({ s, text }); return { state: D.PLACED }; },
  };
}
const sweep = (w, now, deliver) => q.sweepOnce({ roster: w.roster, book: w.book, now, readReport: w.readReport, deliver: deliver || w.deliver, DELIVERY: D });

test('#4588: plan waits until the reset plus grace, then nudges, once per reset', () => {
  assert.equal(q.plan(paused(), undefined, AT).act, 'wait');
  assert.equal(q.plan(paused(), undefined, AT + q.GRACE_MS - 1).act, 'wait');
  assert.equal(q.plan(paused(), undefined, AT + q.GRACE_MS).act, 'nudge');
  assert.equal(q.plan(paused(), { until: RESET, nudgedAt: AT }, AT + 3600e3).act, 'none', 'already resumed for this reset');
  assert.equal(q.plan(paused(), { until: RESET, tries: q.MAX_TRIES }, AT + 3600e3).act, 'none', 'out of tries');
  assert.equal(q.plan(paused(), undefined, AT + q.MAX_AGE_MS + 1).act, 'none', 'a reset over six hours old is left alone: the book does not survive a board restart');
  assert.equal(q.plan(paused(), undefined, AT + q.MAX_AGE_MS).act, 'nudge', 'CONTROL: at the edge it still resumes');
  // CONTROLS: not a quota pause at all.
  assert.equal(q.plan({ found: true, state: 'idle', by: 'agent', until: RESET }, undefined, AT + 3600e3).act, 'none');
  assert.equal(q.plan({ found: true, state: 'working', by: 'auto', until: '' }, undefined, AT + 3600e3).act, 'none');
  assert.equal(q.plan({ found: false }, undefined, AT + 3600e3).act, 'none');
});

test('#4588: three agents paused on one reset are resumed one at a time, STAGGER_MS apart, and nobody else is touched', () => {
  const w = world({ 'agy-a': paused(), 'agy-b': paused(), 'agy-c': paused(), 'agy-free': { found: true, state: 'idle', by: 'auto', until: '' }, 'claude-x': paused() });
  const t0 = AT + q.GRACE_MS;
  assert.equal(sweep(w, t0).results.length, 1);
  assert.deepEqual(w.sent.map((x) => x.s), ['agy-a']);
  assert.equal(w.sent[0].text, q.NUDGE_TEXT);
  assert.equal(sweep(w, t0 + q.STAGGER_MS - 1).results.length, 0, 'the next one waits for the spacing');
  sweep(w, t0 + q.STAGGER_MS);
  sweep(w, t0 + 2 * q.STAGGER_MS);
  sweep(w, t0 + 3 * q.STAGGER_MS);
  assert.deepEqual(w.sent.map((x) => x.s), ['agy-a', 'agy-b', 'agy-c'], 'each once, in order; never the unpaused agy agent or the claude one');
});

test('#4588: a card showing a question, work or a lost connection is never typed into (review 3)', () => {
  const w = world({ 'agy-a': paused() });
  for (const state of ['needs_you', 'working', 'connection_lost']) {
    w.roster[0].state = state;
    sweep(w, AT + q.GRACE_MS);
    assert.equal(w.sent.length, 0, state);
  }
  w.roster[0].state = 'rate_limited';
  sweep(w, AT + q.GRACE_MS);
  assert.equal(w.sent.length, 1, 'CONTROL: over a paused card it resumes');
});

test('#4588: the sweep and the card share one reading and one six-hour window (review 3)', () => {
  assert.equal(q.MAX_AGE_MS, status.QUOTA_RESUME_WINDOW_MS);
  assert.equal(q.pausedUntil(paused()), status.quotaResetOf(paused()));
  assert.equal(q.pausedUntil({ found: true, state: 'idle', by: 'auto', until: RESET, because: 'finished' }), null);
});

test('#4588: the oldest reset goes first', () => {
  const early = new Date(AT - 600e3).toISOString();
  const w = world({ 'agy-a': paused(), 'agy-c': paused(early) });
  sweep(w, AT + q.GRACE_MS);
  assert.deepEqual(w.sent.map((x) => x.s), ['agy-c']);
});

test('#4588: a delivery that reaches nothing is tried again, and given up after MAX_TRIES', () => {
  const w = world({ 'agy-a': paused() });
  const refuse = (s, text) => { w.sent.push({ s, text }); return { state: D.COULD_NOT }; };
  const logged = [];
  const at = [];
  for (let s = 0; s <= 20 * 60; s += 30) {   // a sweep every 30 s for 20 minutes
    const now = AT + q.GRACE_MS + s * 1000;
    const before = w.sent.length;
    q.sweepOnce({ roster: w.roster, book: w.book, now, readReport: w.readReport, deliver: refuse, DELIVERY: D, log: (r) => logged.push(r) });
    if (w.sent.length > before) at.push(s);
  }
  assert.equal(w.sent.length, q.MAX_TRIES, 'it stops at MAX_TRIES');
  assert.ok(at[1] - at[0] >= q.STAGGER_MS / 1000 && at[2] - at[1] >= 2 * q.STAGGER_MS / 1000, 'refusals back off (review 3), tries at ' + at.join(', ') + ' s');
  assert.equal(logged[logged.length - 1].act, 'gave-up', 'giving up is logged, not silent');
  assert.match(logged[logged.length - 1].because, /left idle with its turn unfinished/);
});

test('#4588: an agent that hits the quota again after resuming is a new pause, resumed again', () => {
  const reports = { 'agy-a': paused() };
  const w = world(reports);
  sweep(w, AT + q.GRACE_MS);
  const later = new Date(AT + 5 * 3600e3).toISOString();
  reports['agy-a'] = paused(later);
  sweep(w, Date.parse(later) + q.GRACE_MS);
  assert.equal(w.sent.length, 2);
});

test('#4588: the tick runs only with live execution allowed and the brake off', () => {
  const w = world({ 'agy-a': paused() });
  const deps = (allowed, env) => ({ allowed: () => allowed, env, roster: () => w.roster, readReport: w.readReport, deliver: w.deliver, DELIVERY: D, book: w.book, now: () => AT + q.GRACE_MS });
  assert.equal(q.makeTick(deps(false, {}))(), null);
  assert.equal(q.makeTick(deps(true, { AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF: '1' }))(), null);
  assert.equal(w.sent.length, 0);
  assert.equal(q.makeTick(deps(true, {}))().results.length, 1, 'CONTROL: allowed and no brake, it runs');
});

test('#5382: nudgeText is exactly NUDGE_TEXT with nothing owed, and names an owed part with "leave it to them"', () => {
  assert.equal(q.nudgeText(), q.NUDGE_TEXT, 'no list');
  assert.equal(q.nudgeText([]), q.NUDGE_TEXT, 'an empty list');
  assert.equal(q.nudgeText([{ phrase: '' }, null]), q.NUDGE_TEXT, 'items with nothing to say');
  const one = q.nudgeText([{ projectId: 'docs', n: 3, partId: 1, phrase: 'task 3 in "Docs" (now gem-1\'s)' }]);
  assert.ok(one.startsWith(q.NUDGE_TEXT + ' '), 'the carry-on line is not first: ' + one);
  assert.ok(one.includes('task 3 in "Docs" (now gem-1\'s)'), 'the moved part is not named: ' + one);
  assert.ok(one.includes('leave it to them'), one);
  const two = q.nudgeText(['task 3 in "Docs"', 'task 4 in "Docs"']);
  assert.ok(two.includes('task 3 in "Docs", task 4 in "Docs"') && two.includes('leave those to them'), two);
});

test('#5382: sweepOnce passes o.movedAway through to the line it delivers (control: without it, the plain line)', () => {
  const t0 = AT + q.GRACE_MS;
  const w = world({ 'agy-a': paused() });
  const told = [];
  const item = { projectId: 'ops', n: 7, partId: 1, phrase: 'task 7 in "Ops" (now gem-2\'s)' };
  q.sweepOnce({ roster: w.roster, book: w.book, now: t0, readReport: w.readReport, deliver: w.deliver, DELIVERY: D,
    movedAway: (s) => (s === 'agy-a' ? [item] : []), movedTold: (s, items) => told.push([s, items]) });
  assert.equal(w.sent.length, 1, 'fixture: nothing was delivered');
  assert.ok(w.sent[0].text.includes('task 7 in "Ops"') && w.sent[0].text.includes('leave it to them'), w.sent[0].text);
  assert.deepEqual(told, [['agy-a', [item]]], 'what the line named was not marked told');
  const c = world({ 'agy-a': paused() });
  sweep(c, t0);
  assert.equal(c.sent[0].text, q.NUDGE_TEXT, 'control: without movedAway the line is the plain one');
});

test('#5382 review 8: a carry-on line that reached nothing marks nothing told (the failover sweep tells it later)', () => {
  const t0 = AT + q.GRACE_MS;
  const w = world({ 'agy-a': paused() });
  const told = [];
  q.sweepOnce({ roster: w.roster, book: w.book, now: t0, readReport: w.readReport, DELIVERY: D,
    deliver: (s, text) => { w.sent.push({ s, text }); return { state: D.COULD_NOT }; },
    movedAway: () => [{ projectId: 'ops', n: 7, partId: 1, phrase: 'task 7 in "Ops"' }], movedTold: (s, items) => told.push(s) });
  assert.equal(w.sent.length, 1, 'fixture: no delivery was tried');
  assert.deepEqual(told, [], 'marked told although the line reached nothing');
});

test('#5382 review 11: resumePending is true only while this module will still type its carry-on line for the current pause', () => {
  const read = (r) => () => r;
  const base = { allowed: true, env: {}, book: new Map(), now: AT + q.GRACE_MS, memo: q.newPoolMemo() };
  assert.equal(q.resumePending('agy-a', { ...base, readReport: read(paused()) }), true, 'a due resume read as not pending');
  assert.equal(q.resumePending('agy-a', { ...base, now: AT, readReport: read(paused()) }), true, 'a resume still waiting for its grace read as not pending');
  assert.equal(q.resumePending('agy-a', { ...base, env: { AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF: '1' }, readReport: read(paused()) }), false, 'pending with the operator brake on');
  assert.equal(q.resumePending('agy-a', { ...base, allowed: false, readReport: read(paused()) }), false, 'pending without live execution');
  assert.equal(q.resumePending('agy-a', { ...base, readReport: read({ found: true, state: 'working', by: 'self' }) }), false, 'pending for an agent not paused');
  const book = new Map([['agy-a', { until: paused().until, nudgedAt: AT + q.GRACE_MS }]]);
  assert.equal(q.resumePending('agy-a', { ...base, book, readReport: read(paused()) }), false, 'pending after the resume was sent');
  assert.equal(q.resumePending('agy-a', { ...base, now: AT + q.MAX_AGE_MS + q.GRACE_MS + 1, readReport: read(paused()) }), false, 'pending for a reset over six hours old');
  assert.equal(q.resumePending('agy-a', { ...base, readReport: () => { throw new Error('unreadable'); } }), false, 'a report read that throws read as pending');
});
