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
