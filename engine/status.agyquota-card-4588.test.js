'use strict';
/* #4588: the board CARD carries quotaUntil, so the page can say when Kosmos resumes a quota-paused agy agent.
   status.agyquota-4588.test.js pins the reconcile rule; this pins the copy onto the card, the seam between them. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Sandbox FIRST, before any engine module resolves its data root: a self-report written here must never reach the
// live Kosmos data.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agyquota-card-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert');
const store = require('./store');
const selfreport = require('./selfreport');
const status = require('./status');
const fleet = require('../test-support/fleet');

test('#4588: the card of a quota-paused agy agent carries the reset, and a card without one carries null', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(SANDBOX)), 'the store must be inside the sandbox before anything is written: ' + store.ROOT);
  const until = new Date(Date.now() + 25 * 60 * 1000).toISOString();
  // Installed with no report, where an agy card honestly reads unknown (its screen cannot be read); the reports below
  // are what the cards are then built from.
  const board = fleet.install([
    fleet.agent('agyq', { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' }),
    fleet.agent('agyfree', { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' }),
  ]);
  try {
    assert.equal(selfreport.record('agyq', { state: 'idle', because: "Paused: this Google account's shared Antigravity quota ran out.", until, auto: true }).recorded, true);
    assert.equal(selfreport.record('agyfree', { state: 'idle', because: 'finished', auto: true }).recorded, true);
    const cards = status.snapshot().agents;
    const paused = cards.find((a) => a.sessionName === 'agyq');
    assert.equal(paused.state, 'rate_limited', JSON.stringify({ state: paused.state, because: paused.because }));
    assert.equal(paused.quotaUntil, until);
    const free = cards.find((a) => a.sessionName === 'agyfree');
    assert.equal(free.quotaUntil, null, 'CONTROL: an ordinary idle agy card carries no reset');
    assert.notEqual(free.state, 'rate_limited');
  } finally {
    board.restore();
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
});
