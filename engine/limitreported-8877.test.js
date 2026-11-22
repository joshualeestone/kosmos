'use strict';
/* kosmos#8877: a card blocked by Claude Code's own usage-limit report says so as a field (limitReported), and the usage
   mover's at-limit rescue acts on it, through the decision's own risk rules. The card is the real one: the report through
   selfreport.record (as kosmos-report-hook.js now records a real stop), the screen through the real snapshot, using the
   screen captured on Agent1s 11-21 when a Fable agent hit its Fable limit. */
const os = require('node:os');
const path = require('node:path');
const SANDBOX = path.join(os.tmpdir(), 'kosmos-limitreported-8877-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fleet = require('../test-support/fleet');
const selfreport = require('./selfreport');
const ab = require('./autobalance');

const RULE = '─'.repeat(80);
/* The screen as captured (11-21 19:3x CST), at its prompt after the limit lines. */
const SCREEN = '❯ Live check for kosmos#8862: reply with the single word ready and nothing else.\n'
  + '  ⎿  You\'ve hit your Fable limit · resets 4pm (America/Chicago)\n\n'
  + '⏺ Usage limit reached · set to continue automatically at 4pm\n\n'
  + '  ⚠ Usage limit reached · limit resets 4pm\n\n'
  + RULE + '\n❯ \n' + RULE + '\n  zz · Fable 5.2\n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n';

test.beforeEach(() => { try { fs.rmSync(selfreport.DIR, { recursive: true, force: true }); } catch { /* fresh */ } });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function cardWith(report) {
  const b0 = fleet.install([fleet.agent('zed', { state: null, runner: 'claude', command: 'claude', screen: SCREEN })]);
  const name = b0.agents.find((c) => c.sessionName === 'zed').name;
  b0.restore();
  if (report) assert.equal(selfreport.record(name, report).recorded, true);
  const b = fleet.install([fleet.agent('zed', { state: null, runner: 'claude', command: 'claude', screen: SCREEN })]);
  try { return { ...b.card('zed') }; } finally { b.restore(); }
}
const LIMIT = { state: 'blocked', auto: true, on: 'provider api (rate_limit)', owner: 'provider', because: '' };
const OTHER = { state: 'blocked', auto: true, on: 'provider api (an api error)', owner: 'provider', because: '' };

test('kosmos#8877: a card blocked by the usage-limit report says so as a field; another provider error does not', () => {
  const limited = cardWith(LIMIT);
  assert.equal(limited.state, 'blocked', 'CONTROL: the limit report blocks the card');
  assert.equal(limited.limitReported, true, 'the card does not say it is blocked by a usage limit');
  const other = cardWith(OTHER);
  assert.equal(other.state, 'blocked', 'CONTROL: an api error blocks the card too');
  assert.equal(other.limitReported, false, 'an api error was taken for a usage limit');
  assert.equal(cardWith(null).limitReported, false, 'CONTROL: with no report the card is not limit-reported');
});

test('kosmos#8877: the rescue sees a reported usage limit, and the decision moves it only off an account at risk', () => {
  const limited = { ...cardWith(LIMIT), modelName: 'Claude Fable 5.2' };
  const NOW = Date.now();
  assert.equal(ab.stoppedAtLimit(limited, NOW, undefined, { limitFull: true }), true, 'the at-limit rescue does not see a reported usage limit (the agent waits it out)');
  assert.equal(ab.stoppedAtLimit(limited, NOW), false, 'review 1: a reported limit counted with nothing saying the limit is full now (it can be hours stale)');
  assert.equal(ab.stoppedAtLimit(cardWith(OTHER), NOW), false, 'CONTROL: an api error is not a stop at a limit');
  const H = 3600000;
  const row = (dir, o) => ({ provider: 'anthropic', dir, email: dir + '@example.test', memoryShared: true, apiKey: false, connection: { badge: 'working' },
    weekly: { usedPct: 20, resetsAt: NOW + 72 * H }, fiveHour: null, agentsHere: { names: [], complete: true }, scoped: [], ...o });
  const movable = ab.movableFor({ cards: [limited], records: [], readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, nowMs: NOW });
  const modelOf = ab.modelOfFrom([limited], NOW);
  const rows = (scopedPct) => [
    row('/c', { weekly: { usedPct: 55, resetsAt: NOW + 41 * H }, scoped: [{ model: 'Fable', usedPct: scopedPct, resetsAt: NOW + 20 * H }], agentsHere: { names: ['zed'], complete: true } }),
    row('/d', { weekly: { usedPct: 20, resetsAt: NOW + 90 * H } }),
  ];
  assert.deepEqual(ab.decide({ rows: rows(100), movable, nowMs: NOW, modelOf }).moves.map((m) => [m.agent, m.to]), [['zed', '/d']],
    'an agent stopped by a reported Fable limit, on an account whose Fable limit is full, was not moved');
  assert.deepEqual(ab.decide({ rows: rows(10), movable, nowMs: NOW, modelOf }).moves, [],
    'CONTROL: with no limit at risk there (say a five-hour limit that resets soon), the reported stop moved it');
});

test('kosmos#8877 review 1: a reported limit that has passed (the agent recovered and works on) does not count', () => {
  const recovered = { ...cardWith(LIMIT), modelName: 'Claude Fable 5.2' };   // the report stands for hours after the reset
  const NOW = Date.now(); const H = 3600000;
  const row = (dir, o) => ({ provider: 'anthropic', dir, email: dir + '@example.test', memoryShared: true, apiKey: false, connection: { badge: 'working' },
    weekly: { usedPct: 20, resetsAt: NOW + 72 * H }, fiveHour: null, agentsHere: { names: [], complete: true }, scoped: [], ...o });
  const movable = ab.movableFor({ cards: [recovered], records: [{ id: 'p', tasks: [{ id: 't', parts: [{ who: 'zed', title: 'open work' }] }] }],
    readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, nowMs: NOW });
  const modelOf = ab.modelOfFrom([recovered], NOW);
  /* The account is at risk overall (85% weekly), but nothing it draws on is FULL: the reset passed, or it was a
     five-hour stop. It holds open work. It must not be taken for an agent stuck at its limit and restarted. */
  const rows = [row('/c', { weekly: { usedPct: 85, resetsAt: NOW + 40 * H }, scoped: [{ model: 'Fable', usedPct: 30, resetsAt: NOW + 40 * H }], agentsHere: { names: ['zed'], complete: true } }),
    row('/d', { weekly: { usedPct: 10, resetsAt: NOW + 90 * H } })];
  assert.deepEqual(ab.decide({ rows, movable, nowMs: NOW, modelOf }).moves, [], 'a recovered agent with open work was restarted as if stuck at its limit (review 1 blocker)');
  /* CONTROL: the same agent while its week IS full is stuck, and moves despite its open work (#8048's rescue). */
  const full = [{ ...rows[0], weekly: { usedPct: 100, resetsAt: NOW + 40 * H } }, rows[1]];
  assert.deepEqual(ab.decide({ rows: full, movable, nowMs: NOW, modelOf }).moves.map((m) => [m.agent, m.limitFull]), [['zed', true]], 'CONTROL: stuck on a full week, it was not moved');
});

test('kosmos#8877 review 2: an agent whose model is unknown, stopped by the report on a full model limit, is moved', () => {
  const NOW = Date.now(); const H = 3600000;
  const unknown = { ...cardWith(LIMIT), modelName: null, model: null, earlierModelName: null };
  const row = (dir, o) => ({ provider: 'anthropic', dir, email: dir + '@example.test', memoryShared: true, apiKey: false, connection: { badge: 'working' },
    weekly: { usedPct: 20, resetsAt: NOW + 72 * H }, fiveHour: null, agentsHere: { names: [], complete: true }, scoped: [], ...o });
  const movable = ab.movableFor({ cards: [unknown], records: [], readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, nowMs: NOW });
  const modelOf = ab.modelOfFrom([unknown], NOW);
  const rows = [row('/c', { weekly: { usedPct: 55, resetsAt: NOW + 41 * H }, scoped: [{ model: 'Fable', usedPct: 100, resetsAt: NOW + 20 * H }], agentsHere: { names: ['zed'], complete: true } }),
    row('/d', { weekly: { usedPct: 20, resetsAt: NOW + 90 * H } })];
  assert.deepEqual(ab.decide({ rows, movable, nowMs: NOW, modelOf }).moves.map((m) => m.agent), ['zed'], 'an unknown-model agent stopped by the report on a full Fable limit was left there');
});
