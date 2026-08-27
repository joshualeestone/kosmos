'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Sandboxed: store.js honours AGENT_WORKFORCE_DATA and sendertoken writes
   in-process, so this cannot reach the real store. That is NOT universal --
   the report hook's CLI posts to the SERVER, so the same variable does not
   contain it. Measured 2026-08-27, and worth stating because the technique
   looks identical in both cases. */
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'renet-adopt-'));
process.env.AGENT_WORKFORCE_DATA = SB;
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch {} });

const fleet = require('../test-support/fleet');
const adopt = require('./adopt');
const store = require('./store');
const sendertoken = require('./sendertoken');

/* 🛑 ROWS COME FROM test-support/fleet, NEVER HAND-BUILT. The first version of
   this file used `{ sessionName, isNamedOurs: true }` literals and the
   fixture-discipline gate refused it, correctly: a hand-built row cannot
   drift when paneRoster's shape changes, so it passes forever while the real
   thing breaks. I had already recorded that lesson this morning and walked
   into it anyway. */
function withBoard(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}

test('an agent with no provenance is eligible', () => {
  withBoard([fleet.agent('alpha')], (b) => {
    const p = adopt.plan([b.row('alpha')]);
    assert.equal(p.eligible.length, 1);
    assert.equal(p.eligible[0].name, b.row('alpha').sessionName);
  });
});

test('a row that is NOT ours is skipped, not adopted', () => {
  withBoard([fleet.stranger('outsider')], (b) => {
    const p = adopt.plan([b.row('outsider')]);
    assert.equal(p.eligible.length, 0, 'a stranger was adopted');
    assert.equal(p.skipped[0].because, 'not one of ours');
  });
});

test('plan() writes NOTHING -- the dry run is actually dry', () => {
  withBoard([fleet.agent('untouched')], (b) => {
    const row = b.row('untouched');
    adopt.plan([row]);
    assert.equal(sendertoken.live(row.sessionName).length, 0, 'plan minted a token');
    const p = store.readProfile(row.sessionName);
    assert.ok(!p || !p.origin, 'plan wrote provenance');
  });
});

test('apply() mints a credential AND records the basis of the vouch', () => {
  withBoard([fleet.agent('bravo')], (b) => {
    const row = b.row('bravo');
    const done = adopt.apply([row], 'renet');
    assert.equal(done[0].ok, true, done[0].because);
    assert.equal(sendertoken.live(row.sessionName).length, 1, 'no credential minted');
    const p = store.readProfile(row.sessionName);
    assert.equal(p.origin, 'adopted');
    assert.equal(p.adoptedBy, 'renet');
    assert.ok(p.adoptedAt, 'no adoptedAt');
    assert.equal(p.vouchedOn.isNamedOurs, true, 'the basis of the vouch was not recorded');
  });
});

test('apply() returns the INSTANCE and never the token', () => {
  withBoard([fleet.agent('charlie')], (b) => {
    const row = b.row('charlie');
    const done = adopt.apply([row], 'renet');
    const held = sendertoken.live(row.sessionName);
    assert.equal(held.length, 1);
    assert.equal(held[0], done[0].instance);
    /* live() lists instance ids, not secrets, and apply follows it. A function
       that hands the credential back puts it in every caller's log. My first
       version asserted `held[0].token` and failed BECAUSE the design is right. */
    assert.equal(done[0].token, undefined, 'apply leaked the token');
  });
});

test('adoption is ONE TIME: a second pass skips an already-adopted agent', () => {
  withBoard([fleet.agent('delta')], (b) => {
    const row = b.row('delta');
    adopt.apply([row], 'renet');
    const before = sendertoken.live(row.sessionName).length;
    const second = adopt.plan([row]);
    assert.equal(second.eligible.length, 0, 'it was eligible twice');
    assert.match(second.skipped[0].because, /already has provenance/);
    assert.equal(sendertoken.live(row.sessionName).length, before, 'a second pass minted again');
  });
});

test('CONTROL: eligibility can return BOTH answers from one call', () => {
  /* An always-eligible or always-skip plan() would satisfy every test above
     without discriminating anything. This asserts both outcomes together, so
     the check is shown to be capable of the answer we do not want. */
  withBoard([fleet.agent('echo'), fleet.stranger('foxtrot')], (b) => {
    const p = adopt.plan([b.row('echo'), b.row('foxtrot')]);
    assert.equal(p.eligible.length, 1);
    assert.equal(p.skipped.length, 1);
  });
});
