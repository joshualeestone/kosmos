'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#8634: a wait an agent reported before a restart is replaced on the board by the restart's own reports (started,
 * then the startup turn's working and idle), so the board shows it working, then idle, and nothing says it is still
 * waiting. The startup digest reminds the agent of its own last wait, by state and time only, so it can say so again.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'kosmos-away8634-'));   // the held test records reports
const away = require('./awaydigest');

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-17T15:00:00Z');
const row = (state, by, hoursAgo, extra) => ({ state, by, at: NOW - hoursAgo * H, ...(extra || {}) });

test('an agent\'s own blocked, followed only by automatic reports, is the wait', () => {
  // The real sequence: a deliberate wait refuses automatic working/idle over it (selfreport's clobber guard), so what
  // follows it in a record is the new run's automatic `started`, then that run's turns.
  const hist = [row('working', 'auto', 30), row('blocked', 'agent', 20, { because: 'SECRET-WORDS waiting on review' }),
    row('started', 'auto', 2), row('working', 'auto', 2), row('idle', 'auto', 1)];
  assert.deepEqual(away.lastWait(hist, { nowMs: NOW }), { state: 'blocked', atMs: NOW - 20 * H });
  const needs = [row('needs_you', 'agent', 3), row('idle', 'auto', 1)];
  assert.deepEqual(away.lastWait(needs, { nowMs: NOW }), { state: 'needs_you', atMs: NOW - 3 * H });
});

test('CONTROL: a wait the agent ended, or a person cleared, or never had, is not a wait', () => {
  // The agent said it was working again after the wait.
  assert.equal(away.lastWait([row('blocked', 'agent', 20), row('working', 'agent', 10), row('idle', 'auto', 1)], { nowMs: NOW }), null);
  // A person cleared it.
  assert.equal(away.lastWait([row('blocked', 'agent', 20), row('working', 'operator', 10), row('idle', 'auto', 1)], { nowMs: NOW }), null);
  // Only automatic reports, a permission prompt's needs_you among them.
  assert.equal(away.lastWait([row('needs_you', 'auto', 5), row('idle', 'auto', 1)], { nowMs: NOW }), null);
  // A legacy row with no author is not the agent's own word.
  assert.equal(away.lastWait([{ state: 'blocked', at: NOW - H }], { nowMs: NOW }), null);
  // No history at all.
  assert.equal(away.lastWait([], { nowMs: NOW }), null);
  assert.equal(away.lastWait(undefined, { nowMs: NOW }), null);
});

test('a wait older than the digest\'s 7 days is not raised again; one inside it is', () => {
  const old = NOW - away.MAX_WINDOW_MS - 1;
  assert.equal(away.lastWait([{ state: 'blocked', by: 'agent', at: old }, row('idle', 'auto', 1)], { nowMs: NOW }), null);
  const edge = NOW - away.MAX_WINDOW_MS;
  assert.deepEqual(away.lastWait([{ state: 'blocked', by: 'agent', at: edge }], { nowMs: NOW }), { state: 'blocked', atMs: edge });
});

test('the reminder names the state, the time and the command, never the report\'s words', () => {
  const digest = away.build({ name: 'leo', sinceMs: NaN, untilMs: NaN });
  const wait = { state: 'blocked', atMs: NOW - 20 * H };
  const json = away.hookJson(digest, wait);
  assert.ok(json, 'a wait alone still makes the startup context');
  const ctx = JSON.parse(json).hookSpecificOutput;
  assert.equal(ctx.hookEventName, 'SessionStart');
  assert.match(ctx.additionalContext, /last reported that it was waiting \(blocked, at 2026-11-16T19:00:00Z\)/);
  assert.match(ctx.additionalContext, /kosmos report blocked \.\.\./);
  assert.doesNotMatch(ctx.additionalContext, /SECRET-WORDS/);
  // CONTROL: no wait and nothing missed is still nothing at all.
  assert.equal(away.hookJson(digest, null), '');
  assert.equal(away.hookJson(digest), '');
  // An unknown state is never printed.
  assert.equal(away.waitText({ state: 'working', atMs: NOW }), '');
});

test('the wait sits after what could not reach the agent, as its own paragraph', () => {
  const digest = { name: 'leo', lines: ['- fleet: 1 post to you. Read it with: kosmos room fleet'], counts: { posts: 1, refused: 0, direct: 0 }, clamped: false, sinceMs: NOW - 3 * H, untilMs: NOW };
  const text = away.contextText(digest, { state: 'needs_you', atMs: NOW - 2 * H });
  const [first, second] = text.split('\n\n');
  assert.match(first, /^Kosmos: since it last heard from this agent/);
  assert.match(second, /^Kosmos: before this session, this agent last reported that it was waiting \(needs_you,/);
});

test('a provider outage after the agent\'s own wait neither ends it nor becomes it; a row dated in the future is no wait', () => {
  // The hook's automatic blocked (StopFailure, #6209) after the agent's own wait: the agent's wait still stands.
  const hist = [row('blocked', 'agent', 20), row('working', 'auto', 10), row('blocked', 'auto', 9, { on: 'provider api (rate_limit)' }), row('idle', 'auto', 1)];
  assert.deepEqual(away.lastWait(hist, { nowMs: NOW }), { state: 'blocked', atMs: NOW - 20 * H });
  // Only an automatic outage: no wait.
  assert.equal(away.lastWait([row('blocked', 'auto', 9), row('idle', 'auto', 1)], { nowMs: NOW }), null);
  // A clock that ran ahead: a wait dated after now is not trusted.
  assert.equal(away.lastWait([{ state: 'blocked', by: 'agent', at: NOW + H }], { nowMs: NOW }), null);
});

test('any report of its own that is not a wait ends the wait, whatever its state', () => {
  const STATES = require('./selfreport').STATES;
  assert.ok(Array.isArray(STATES) && STATES.includes('blocked'), 'precondition: the report states are exported');
  for (const st of STATES.filter((x) => x !== 'needs_you' && x !== 'blocked')) {
    assert.equal(away.lastWait([row('blocked', 'agent', 20), row(st, 'agent', 10), row('idle', 'auto', 1)], { nowMs: NOW }), null, st + ' by the agent did not end the wait');
  }
  // CONTROL: a later wait of its own is the wait (the newer one).
  assert.deepEqual(away.lastWait([row('blocked', 'agent', 20), row('needs_you', 'agent', 10)], { nowMs: NOW }), { state: 'needs_you', atMs: NOW - 10 * H });
});

test('a held question comes back held, and the reminder says --held so asking again buzzes nobody', () => {
  const w = away.lastWait([row('needs_you', 'agent', 5, { held: true }), row('started', 'auto', 1)], { nowMs: NOW });
  assert.deepEqual(w, { state: 'needs_you', atMs: NOW - 5 * H, held: true });
  assert.match(away.waitText(w), /kosmos report needs_you --held \.\.\., held as before, so nothing buzzes the person/);
  // CONTROL: an ordinary question is not held and its command has no --held.
  const plain = away.lastWait([row('needs_you', 'agent', 5), row('started', 'auto', 1)], { nowMs: NOW });
  assert.equal(plain.held, undefined);
  assert.doesNotMatch(away.waitText(plain), /--held/);
});

test('history() keeps a held question\'s flag, and only on a needs_you', () => {
  const fs = require('node:fs');
  const selfreport = require('./selfreport');
  selfreport.record('held-8634', { state: 'needs_you', because: 'which one?', held: true });
  fs.appendFileSync(selfreport.fileFor('held-8634'), JSON.stringify({ state: 'blocked', held: true, by: 'agent', at: new Date().toISOString() }) + '\n');
  const h = selfreport.history('held-8634');
  assert.equal(h[0].held, true, 'a held question lost its flag');
  assert.equal(h[1].held, undefined, 'a blocked row was given a held flag');
});
