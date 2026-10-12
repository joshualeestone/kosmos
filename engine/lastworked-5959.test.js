'use strict';

/**
 * #5959 slice 2: every card of ours carries lastWorked, when Kosmos last saw the agent work, for the health line on
 * its page. Read from observed.js's newest OK per (provider, agent), which a later rejection does not erase. A runner
 * with no observation (Antigravity, Muse) says so rather than "not seen"; a pane that is not ours carries null.
 *   node --test engine/lastworked-5959.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-lastworked-5959-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const observed = require('./observed');
const fleet = require('../test-support/fleet');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
test.beforeEach(() => observed._clearForTest());

test('#5959 slice 2: lastOk keeps the newest OK through a later rejection, and never moves backwards', () => {
  const P = observed.PROVIDER.ANTHROPIC;
  assert.equal(observed.lastOk(P, 'casey'), null, 'CONTROL: nothing seen yet');
  observed.saw(P, 'casey', observed.OUTCOME.OK, 1000);
  observed.saw(P, 'casey', observed.OUTCOME.REJECTED, 2000);
  assert.equal(observed.read(P, 'casey').outcome, observed.OUTCOME.REJECTED, 'CONTROL: the rejection is the latest reading');
  assert.equal(observed.lastOk(P, 'casey'), 1000, 'a rejection erased when it last worked');
  observed.saw(P, 'casey', observed.OUTCOME.OK, 500);   // an older completion time, read late
  assert.equal(observed.lastOk(P, 'casey'), 1000, 'an older OK moved the time backwards');
  observed.saw(P, 'casey', observed.OUTCOME.OK, 3000);
  assert.equal(observed.lastOk(P, 'casey'), 3000);
  // Keyed by provider and agent: another agent and another provider are untouched.
  assert.equal(observed.lastOk(P, 'kim'), null);
  assert.equal(observed.lastOk(observed.PROVIDER.OPENAI, 'casey'), null);
  observed._clearForTest();
  assert.equal(observed.lastOk(P, 'casey'), null, 'the test reset left it');
});

test('#5959 slice 2: the card says when it last worked, per runner, and why when it cannot', () => {
  const t = Date.now() - 4 * 60e3;
  observed.saw(observed.PROVIDER.ANTHROPIC, 'casey', observed.OUTCOME.OK, t);
  observed.saw(observed.PROVIDER.OPENAI, 'kim', observed.OUTCOME.OK, t - 60e3);
  // Recorded for the wrong provider: a gemini agent must not read a Claude observation filed under its name.
  observed.saw(observed.PROVIDER.ANTHROPIC, 'gem', observed.OUTCOME.OK, t);
  const board = fleet.install([
    fleet.agent('casey', { runner: 'claude' }),
    fleet.agent('kim', { runner: 'codex', command: 'codex', state: 'unknown' }),
    fleet.agent('gem', { runner: 'gemini', command: 'node' }),
    fleet.agent('rok', { runner: 'grok', command: 'grok' }),
    fleet.agent('agy', { runner: 'antigravity', command: 'agy', state: 'unknown' }),
    fleet.agent('muse', { runner: 'muse', command: 'node', state: 'unknown' }),
    fleet.stranger('leo'),
  ]);
  try {
    const card = (n) => {
      const c = board.agents.find((x) => x.name === n || x.sessionName === n || x.sessionName === n + '-discord');
      assert.ok(c, 'CONTROL: no card for ' + n);
      assert.ok('lastWorked' in c, n + ': the card has no lastWorked field');
      return c.lastWorked;
    };
    assert.deepEqual(card('casey'), { at: new Date(t).toISOString(), why: null });
    assert.deepEqual(card('kim'), { at: new Date(t - 60e3).toISOString(), why: null });
    assert.deepEqual(card('gem'), { at: null, why: 'not_seen' });
    assert.deepEqual(card('rok'), { at: null, why: 'not_seen' });
    assert.deepEqual(card('agy'), { at: null, why: 'no_source' });
    assert.deepEqual(card('muse'), { at: null, why: 'no_source' });
    assert.equal(card('leo'), null, 'a pane that is not ours carried a lastWorked');
  } finally { board.restore(); }
});
