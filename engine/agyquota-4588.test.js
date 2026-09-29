'use strict';
/* #4588: agents paused on their Google account's shared Antigravity quota are resumed after the reset, ONE AT A TIME. */
const test = require('node:test');
const assert = require('node:assert');
const q = require('./agyquota');

const RESET = '2026-09-28T22:11:54.000Z';
const AT = Date.parse(RESET);
const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const paused = (until) => ({ found: true, state: 'idle', by: 'auto', until: until || RESET });

function world(reports) {
  const roster = [
    { sessionName: 'agy-a', name: 'A', runner: 'antigravity' },
    { sessionName: 'agy-b', name: 'B', runner: 'antigravity' },
    { sessionName: 'agy-c', name: 'C', runner: 'antigravity' },
    { sessionName: 'agy-free', name: 'Free', runner: 'antigravity' },
    { sessionName: 'claude-x', name: 'X', runner: 'claude' },
  ];
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

test('#4588: the oldest reset goes first', () => {
  const early = new Date(AT - 600e3).toISOString();
  const w = world({ 'agy-a': paused(), 'agy-c': paused(early) });
  sweep(w, AT + q.GRACE_MS);
  assert.deepEqual(w.sent.map((x) => x.s), ['agy-c']);
});

test('#4588: a delivery that reaches nothing is tried again, and given up after MAX_TRIES', () => {
  const w = world({ 'agy-a': paused() });
  const refuse = (s, text) => { w.sent.push({ s, text }); return { state: D.COULD_NOT }; };
  for (let i = 0; i < q.MAX_TRIES + 2; i++) sweep(w, AT + q.GRACE_MS + i * q.STAGGER_MS, refuse);
  assert.equal(w.sent.length, q.MAX_TRIES);
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
