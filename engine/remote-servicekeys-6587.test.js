'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits
/*
 * kosmos#6587 (S-7a slice 2a): remote.serviceKeys() asks engine/servicekeys-check.js about the tunnel's OWN state dir,
 * and tells it whether this board is set to Kosmos+'s own coordinator. Each arm can fail: the off answer as shipped
 * would hide a wrong folder, so the check is observed directly.
 *   node --test engine/remote-servicekeys-6587.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sk-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sk-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
const check = require('./servicekeys-check');
const remote = require('./remote');

function observed(fn) {
  const real = check.serviceKeyCheck;
  const calls = [];
  check.serviceKeyCheck = (dir, opts) => { calls.push({ dir, opts }); return { state: 'listed' }; };
  try { return { answer: fn(), calls }; } finally { check.serviceKeyCheck = real; }
}

test('it reads the tunnel state dir, on the production coordinator, and passes the answer through', () => {
  const { answer, calls } = observed(() => remote.serviceKeys());
  assert.deepEqual(answer, { state: 'listed' }, 'the answer is the check\'s');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dir, STATE, 'the tunnel state dir, not the data dir');
  assert.equal(calls[0].opts.production, true, 'no coordinator setting is the production one');
});

test('a board set to another coordinator says so (no false alarm for self-host or staging)', () => {
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test';
  try {
    assert.equal(observed(() => remote.serviceKeys()).calls[0].opts.production, false);
  } finally { delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR; }
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = remote.DEFAULT_COORDINATOR;
  try {
    assert.equal(observed(() => remote.serviceKeys()).calls[0].opts.production, true, 'CONTROL: the production address set by hand');
  } finally { delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR; }
});

test('as shipped (no recovery key pinned) the real answer is off', () => {
  fs.writeFileSync(path.join(STATE, 'coordinator_pubkey'), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n');
  assert.deepEqual(remote.serviceKeys(), { state: 'off' });
});

/* kosmos#6587 (S-7a slice 3): a setup or sign-in run hands the connector the verified keys, or inherits as before. */
function spawnOpts(answer) {
  const { EventEmitter } = require('node:events');
  const real = check.expectedCoordinatorKeys;
  const seen = [];
  check.expectedCoordinatorKeys = (opts) => { seen.push(opts); return answer; };
  remote.setSetupSpawnForTests((bin, args, opts) => {
    seen.push({ spawned: opts });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    setImmediate(() => { child.emit('exit', 0); child.emit('close', 0); });
    return child;
  });
  return { seen, done: () => { check.expectedCoordinatorKeys = real; remote.resetForTests(); } };
}

test('with verified keys, the connector run gets KOSMOS_EXPECT_COORDINATOR_KEYS (and the rest of the environment)', async () => {
  const w = spawnOpts('MCowBQYDK2VwAyEAkey1,MCowBQYDK2VwAyEAkey2');
  try {
    await remote.setupStart('a@example.com');
    const opts = w.seen.find((s) => s.spawned).spawned;
    assert.equal(opts.env.KOSMOS_EXPECT_COORDINATOR_KEYS, 'MCowBQYDK2VwAyEAkey1,MCowBQYDK2VwAyEAkey2');
    assert.equal(opts.env.PATH, process.env.PATH, 'the rest of the environment is kept');
    assert.equal(w.seen[0].production, true, 'asked for the production coordinator');
  } finally { w.done(); }
});

test('without them (off, as shipped), the run inherits exactly as before: no env passed at all', async () => {
  const w = spawnOpts(null);
  try {
    await remote.setupStart('a@example.com');
    const opts = w.seen.find((s) => s.spawned).spawned;
    assert.equal('env' in opts, false, 'no env key: the child inherits this process environment');
  } finally { w.done(); }
});

test('a board on another coordinator asks with production false (review 1)', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test';
  const w = spawnOpts(null);
  try {
    await remote.setupStart('a@example.com');
    assert.equal(w.seen[0].production, false, 'asked for another coordinator, so the engine hands nothing');
    assert.equal('env' in w.seen.find((s) => s.spawned).spawned, false);
  } finally { w.done(); delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR; }
  // And the engine itself answers no keys for production false (servicekeys-check-6587.test.js pins that with a real set).
});

test('a KOSMOS_EXPECT_COORDINATOR_KEYS inherited from the launcher is removed when the board decides no check (review 1)', async () => {
  process.env.Kosmos_Expect_Coordinator_Keys = 'stale-from-a-developer';
  const w = spawnOpts(null);
  try {
    await remote.setupStart('a@example.com');
    const opts = w.seen.find((s) => s.spawned).spawned;
    assert.ok(opts.env, 'a copy of the environment is passed so the stale one can be left out');
    assert.equal(Object.keys(opts.env).some((k) => k.toUpperCase() === 'KOSMOS_EXPECT_COORDINATOR_KEYS'), false, 'in any spelling');
    assert.equal(opts.env.PATH, process.env.PATH, 'the rest is kept');
  } finally { w.done(); delete process.env.Kosmos_Expect_Coordinator_Keys; }
});

test('with keys and an inherited spelling, the child gets ONE key with the board\'s value (review 1, #5386)', async () => {
  process.env.kosmos_expect_coordinator_keys = 'stale';
  const w = spawnOpts('MCowBQYDK2VwAyEAkey1');
  try {
    await remote.setupStart('a@example.com');
    const env = w.seen.find((s) => s.spawned).spawned.env;
    const names = Object.keys(env).filter((k) => k.toUpperCase() === 'KOSMOS_EXPECT_COORDINATOR_KEYS');
    assert.deepEqual(names, ['KOSMOS_EXPECT_COORDINATOR_KEYS']);
    assert.equal(env.KOSMOS_EXPECT_COORDINATOR_KEYS, 'MCowBQYDK2VwAyEAkey1');
  } finally { w.done(); delete process.env.kosmos_expect_coordinator_keys; }
});
