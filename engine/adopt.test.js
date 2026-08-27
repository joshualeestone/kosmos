'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Sandboxed: AGENT_WORKFORCE_DATA is honoured by store.js and sendertoken
   writes in-process, so this cannot touch the real store. That distinction
   matters and is not universal -- the report hook's CLI posts to the SERVER,
   so the same env var does NOT contain it. Measured 2026-08-27. */
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'renet-adopt-'));
process.env.AGENT_WORKFORCE_DATA = SB;
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch {} });

const adopt = require('./adopt');
const store = require('./store');
const sendertoken = require('./sendertoken');

const ours = (n) => ({ sessionName: n, isNamedOurs: true });

test('an agent with no provenance is eligible', () => {
  const p = adopt.plan([ours('alpha')]);
  assert.equal(p.eligible.length, 1);
  assert.equal(p.eligible[0].name, 'alpha');
});

test('a row that is NOT ours is skipped, not adopted', () => {
  const p = adopt.plan([{ sessionName: 'stranger', isNamedOurs: false }]);
  assert.equal(p.eligible.length, 0);
  assert.equal(p.skipped[0].because, 'not one of ours');
});

test('plan() writes NOTHING -- dry run is actually dry', () => {
  adopt.plan([ours('untouched')]);
  assert.equal(sendertoken.live('untouched').length, 0, 'plan minted a token');
  const p = store.readProfile('untouched');
  assert.ok(!p || !p.origin, 'plan wrote provenance');
});

test('apply() mints a token AND records the basis of the vouch', () => {
  const done = adopt.apply([ours('bravo')], 'renet');
  assert.equal(done[0].ok, true);
  assert.equal(sendertoken.live('bravo').length, 1, 'no token minted');
  const p = store.readProfile('bravo');
  assert.equal(p.origin, 'adopted');
  assert.equal(p.adoptedBy, 'renet');
  assert.ok(p.adoptedAt, 'no adoptedAt');
  assert.equal(p.vouchedOn.isNamedOurs, true, 'the basis was not recorded');
});

test('apply() returns the INSTANCE and it is live -- never the token', () => {
  const done = adopt.apply([ours('charlie')], 'renet');
  const held = sendertoken.live('charlie');
  assert.equal(held.length, 1, 'adoption did not produce exactly one live credential');
  assert.equal(held[0], done[0].instance, 'the returned instance is not the live one');
  /* 🛑 AND apply() MUST NOT RETURN THE TOKEN. `live()` lists instance ids, not
     secrets, and apply follows it. A function that hands the credential back
     puts it in every caller's log and return value, which is the opposite of
     what issuing one is for. My first version of this test asserted
     `held[0].token` and failed BECAUSE the design is right. */
  assert.equal(done[0].token, undefined, 'apply leaked the token');
});

test('adoption is ONE TIME: a second run skips an already-adopted agent', () => {
  adopt.apply([ours('delta')], 'renet');
  const before = sendertoken.live('delta').length;
  const second = adopt.plan([ours('delta')]);
  assert.equal(second.eligible.length, 0, 'delta was eligible twice');
  assert.match(second.skipped[0].because, /already has provenance/);
  assert.equal(sendertoken.live('delta').length, before, 'a second run minted again');
});

test('CONTROL: the eligibility check can return the other answer', () => {
  /* An always-eligible or always-skip plan() would pass the tests above
     without distinguishing anything. This asserts both outcomes from one
     call, so the check is shown to discriminate. */
  const p = adopt.plan([ours('echo'), { sessionName: 'foxtrot', isNamedOurs: false }]);
  assert.equal(p.eligible.length, 1);
  assert.equal(p.skipped.length, 1);
});
