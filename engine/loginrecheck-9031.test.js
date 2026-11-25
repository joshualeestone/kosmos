'use strict';
/**
 * kosmos#9031 review 1: an old refusal left on an idle screen, on an account that works again, must not mark the account
 * refused each time the account check's answer ages out (authprobe's 30 s); and an account whose login is over must.
 * Drives the real snapshot() through test-support/fleet.
 *
 *   node --test engine/loginrecheck-9031.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-recheck-9031-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const observed = require('./observed');
const ap = require('./authprobe');
const create = require('./create');
const subscription = require('./subscription');

const DIR = '/u/.claude-recheck';
const SCREEN = '> hello\n● Login reached its time limit · Please run /login\n';
const realReadJob = create.readJob;
const realNow = Date.now;
const settle = () => new Promise((r) => setTimeout(r, 15));
const said = () => (observed.read(observed.PROVIDER.ANTHROPIC, 'rae') || {}).outcome;
const install = (state = 'auth_failed') => fleet.install([fleet.agent('rae', { state, screen: SCREEN })]).card('rae').state;

test.beforeEach(() => {
  observed._clearForTest(); ap.resetForTest();
  create.readJob = () => ({ runner: 'claude', configDir: DIR });
});
test.afterEach(() => { Date.now = realNow; create.readJob = realReadJob; fleet.restore(); observed._clearForTest(); ap.resetForTest(); });
test.after(() => fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true }));

const settleOn = async (state) => {
  ap.setChecker(async () => ({ state }));
  ap.verdict(DIR);
  await settle();
};

test('#9031: a working account is not marked refused by an old line while its check is asked again', async () => {
  await settleOn(subscription.STATE.CONNECTED);
  assert.equal(install('unknown'), 'unknown', 'CONTROL: a fresh good answer hides the old line');
  assert.equal(said(), undefined, 'CONTROL: a fresh good answer records nothing');
  Date.now = () => realNow() + ap.TTL_MS + 5000;
  assert.equal(install(), 'auth_failed', 'CONTROL: the aged answer no longer hides the line, so this is the tick in question');
  assert.equal(said(), undefined, 'a repaired account was marked refused');
});

test('#9031: a refusal is recorded when the check says the account does not work, and on an account never checked', async () => {
  await settleOn(subscription.STATE.NONE);
  assert.equal(install(), 'auth_failed');
  assert.equal(said(), observed.OUTCOME.REJECTED);
  observed._clearForTest();
  Date.now = () => realNow() + ap.TTL_MS + 5000;
  install();
  assert.equal(said(), observed.OUTCOME.REJECTED, 'a dead account being checked again stopped being recorded');
  Date.now = realNow;
  observed._clearForTest(); ap.resetForTest();
  ap.setChecker(async () => ({ state: subscription.STATE.CONNECTED }));
  install();
  assert.equal(said(), observed.OUTCOME.REJECTED, 'the first look at an account says what the screen says, as before');
  await settle();
});
