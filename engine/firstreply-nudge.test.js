'use strict';

/* #3226: the one-time first-reply nudge. Rosters come from test-support/fleet and the REAL status
   snapshot (fixture discipline: no hand-built cards). owes and deliver are injected, so no real
   agent is ever typed into and no real message log is read. */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'firstreply-nudge-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const nudge = require('./firstreply-nudge');

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const HEARD = new Date(NOW - 90 * 1000).toISOString(); // 90 s ago: past the minute
const rosterOf = (state) => fleet.install([fleet.agent('mara', { screen: state === 'working' ? fleet.SCREEN.working : fleet.SCREEN.idle, state })]).agents;
const idleCard = () => rosterOf('idle')[0];
const owesFirst = () => ({ state: 'owes', lastHeardAt: HEARD, lastSentAt: null, because: null });

test('#3226 fixture: the idle fleet card really reads idle', () => {
  assert.equal(idleCard().state, 'idle');
  assert.equal(rosterOf('working')[0].state, 'working');
});

test('#3226 plan: every condition true nudges', () => {
  assert.equal(nudge.plan(idleCard(), owesFirst(), undefined, NOW).act, 'nudge');
});

test('#3226 plan: not idle does not nudge', () => {
  assert.notEqual(nudge.plan(rosterOf('working')[0], owesFirst(), undefined, NOW).act, 'nudge');
});

test('#3226 plan: owing nothing does not nudge (clear and unknown)', () => {
  for (const state of ['clear', 'unknown']) {
    assert.notEqual(nudge.plan(idleCard(), { ...owesFirst(), state }, undefined, NOW).act, 'nudge', state);
  }
  assert.notEqual(nudge.plan(idleCard(), null, undefined, NOW).act, 'nudge');
});

test('#3226 plan: an agent that has replied before is not nudged (first contact only)', () => {
  const owes = { ...owesFirst(), lastSentAt: new Date(NOW - 5 * 60 * 1000).toISOString() };
  assert.notEqual(nudge.plan(idleCard(), owes, undefined, NOW).act, 'nudge');
});

test('#3226 plan: an owed message under a minute old waits', () => {
  const owes = { ...owesFirst(), lastHeardAt: new Date(NOW - 30 * 1000).toISOString() };
  assert.equal(nudge.plan(idleCard(), owes, undefined, NOW).act, 'wait');
  // the boundary: exactly a minute is enough
  const edge = { ...owesFirst(), lastHeardAt: new Date(NOW - nudge.MIN_QUIET_MS).toISOString() };
  assert.equal(nudge.plan(idleCard(), edge, undefined, NOW).act, 'nudge');
});

test('#3226 plan: an unreadable heard time does not nudge', () => {
  assert.notEqual(nudge.plan(idleCard(), { ...owesFirst(), lastHeardAt: null }, undefined, NOW).act, 'nudge');
});

test('#3226 plan: a recorded nudge means none, ever', () => {
  assert.equal(nudge.plan(idleCard(), owesFirst(), { nudgedAt: NOW - 1000 }, NOW).act, 'none');
  // a try that did not reach the pane is not a spent nudge
  assert.equal(nudge.plan(idleCard(), owesFirst(), { nudgedAt: null, tries: 1 }, NOW).act, 'nudge');
});

test('#3226 nudge text names the reply verb the CLI ships and has no em dash', () => {
  assert.match(nudge.NUDGE_TEXT, /kosmos reply "<your answer>"/);
  assert.ok(!nudge.NUDGE_TEXT.includes(String.fromCharCode(0x2014)), 'no em dash in the nudge');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  assert.match(cli, /^\s*reply\)\s+shift; cmd_reply "\$@"/m, 'install/kosmos dispatches the reply verb');
});

function sweepWith(opts) {
  const sent = [];
  const logs = [];
  const o = {
    roster: opts.roster || rosterOf('idle'), book: opts.book || new Map(), now: opts.now || NOW,
    owes: opts.owes || (() => owesFirst()),
    deliver: opts.deliver || ((session, text) => { sent.push({ session, text }); return { state: DELIVERY.PLACED }; }),
    DELIVERY, log: (r) => logs.push(r),
  };
  return { o, sent, logs };
}

test('#3226 sweep: delivers once, and a second sweep sends nothing', () => {
  const book = new Map();
  const { o, sent } = sweepWith({ book });
  const r1 = nudge.sweepOnce(o);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, nudge.NUDGE_TEXT);
  assert.equal(r1.results[0].delivered, true);
  assert.equal(book.get(sent[0].session).nudgedAt, NOW);
  nudge.sweepOnce({ ...o, now: NOW + 60 * 60 * 1000 });
  assert.equal(sent.length, 1, 'one nudge per session, ever');
});

test('#3226 sweep: a could_not delivery records no nudge and is tried again', () => {
  const book = new Map();
  let calls = 0;
  const { o, logs } = sweepWith({ book, deliver: () => { calls++; return { state: DELIVERY.COULD_NOT }; } });
  nudge.sweepOnce(o);
  const session = o.roster[0].sessionName;
  assert.equal(book.get(session).nudgedAt, null);
  nudge.sweepOnce(o);
  assert.equal(calls, 2);
  assert.equal(logs.length, 1, 'a refusing pane is logged once, not every sweep');
});

test('#3226 sweep: an unconfirmed delivery counts as spent (re-sending may duplicate it)', () => {
  const book = new Map();
  let calls = 0;
  const { o } = sweepWith({ book, deliver: () => { calls++; return { state: DELIVERY.UNCONFIRMED }; } });
  nudge.sweepOnce(o);
  nudge.sweepOnce(o);
  assert.equal(calls, 1);
});

test('#3226 sweep: a throwing deliver or owes does not throw out and records no nudge', () => {
  const book = new Map();
  const { o } = sweepWith({ book, deliver: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => nudge.sweepOnce(o));
  assert.equal(book.get(o.roster[0].sessionName).nudgedAt, null);
  const b2 = new Map();
  const { o: o2, sent } = sweepWith({ book: b2, owes: () => { throw new Error('log unreadable'); } });
  assert.doesNotThrow(() => nudge.sweepOnce(o2));
  assert.equal(sent.length, 0);
  assert.doesNotThrow(() => nudge.sweepOnce({ ...o, log: () => { throw new Error('log'); } }));
  assert.doesNotThrow(() => nudge.sweepOnce(null));
  assert.deepEqual(nudge.sweepOnce({ roster: null }).results, []);
});

test('#3226 sweep: a working agent and an agent that replied before are not typed into', () => {
  const { o, sent } = sweepWith({ roster: rosterOf('working') });
  nudge.sweepOnce(o);
  const { o: o2, sent: sent2 } = sweepWith({ owes: () => ({ ...owesFirst(), lastSentAt: HEARD }) });
  nudge.sweepOnce(o2);
  assert.equal(sent.length + sent2.length, 0);
});

test('#3226 tick: inert unless live execution is allowed, and the brake stops it', () => {
  let delivered = 0;
  const deps = (allowed, env) => ({
    allowed: () => allowed, env, roster: () => rosterOf('idle'), book: new Map(), now: () => NOW,
    owes: () => owesFirst(), deliver: () => { delivered++; return { state: DELIVERY.PLACED }; }, DELIVERY,
  });
  assert.equal(nudge.makeTick(deps(false, {}))(), null);
  assert.equal(nudge.makeTick(deps(true, { AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF: '1' }))(), null);
  assert.equal(delivered, 0);
  assert.ok(nudge.makeTick(deps(true, {}))());
  assert.equal(delivered, 1);
  assert.equal(nudge.nudgeEnabled(true, { AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF: '0' }), true);
  // an unreadable roster skips the tick; a throwing roster never throws out
  assert.equal(nudge.makeTick({ ...deps(true, {}), roster: () => null })(), null);
  assert.equal(nudge.makeTick({ ...deps(true, {}), roster: () => { throw new Error('x'); } })(), null);
});
