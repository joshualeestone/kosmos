'use strict';

/* kosmos#8782: an automatic provider block written by a run that then died (a crash, a relaunch) stuck for the whole
   next session. On 11-19 three agents read "blocked on provider api (an api error)" for about 12 hours of work, because
   the fallback kind "an api error" is not one #6209 lets an automatic idle clear. A turn that ends normally in a NEW
   run (a different instance) now clears an automatic provider block of any kind. The same run keeps #6209's rule, a
   mid-turn working never clears one, and a block over a deliberate wait keeps it. */

// Sandbox the store BEFORE requiring anything (store.js resolves its root at module load).
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-selfreport-8782-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');
const sendertoken = require('./sendertoken');
const store = require('./store');

/* The token store as the board keeps it: one file per agent, its live runs' instances. A run whose instance is not in
   the file has ended (instanceState 'gone'); no file at all is 'unknown'. */
function liveRuns(who, instances) {
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  fs.writeFileSync(path.join(sendertoken.DIR, store.safeKey(who) + '.json'),
    JSON.stringify({ tokens: instances.map((instance, i) => ({ token: 'test-token-' + i, instance })) }));
}

const OLD = 'a0a0a0a0a001';
const NEW = 'b0b0b0b0b002';
const idle = (instance) => ({ state: 'idle', because: 'finished responding', auto: true, instance });
const block = (kind, instance) => ({ state: 'blocked', on: 'provider api (' + kind + ')', owner: 'provider', auto: true, instance });

test('kosmos#8782: an automatic idle from a NEW run clears the old run\'s "an api error" block (the 11-19 case)', () => {
  const who = 'crash-api-error-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, { state: 'working', because: 'answering a prompt', auto: true, instance: OLD }).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(NEW));
  assert.equal(r.recorded, true, 'a normal turn end in the new session left the dead session\'s block standing');
  assert.equal(selfreport.read(who).state, 'idle');
  assert.equal(selfreport.read(who).instance, NEW);
});

test('kosmos#8782 CONTROL: the SAME run\'s idle still keeps "an api error" (#6209\'s residual is unchanged)', () => {
  const who = 'same-run-api-error-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(OLD));
  assert.equal(r.recorded, false, 'the same run cleared a kind #6209 keeps');
  assert.equal(r.skipped, 'waiting');
  assert.equal(selfreport.read(who).state, 'blocked');
});

test('kosmos#8782: a NEW run\'s mid-turn working does not clear the block; its turn end does', () => {
  const who = 'new-run-working-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const hb = selfreport.record(who, { state: 'working', because: 'running Bash', auto: true, instance: NEW });
  assert.equal(hb.recorded, false, 'a mid-turn heartbeat cleared a provider block');
  assert.equal(selfreport.read(who).state, 'blocked');
  assert.equal(selfreport.record(who, idle(NEW)).recorded, true);
  assert.equal(selfreport.read(who).state, 'idle');
});

test('kosmos#8782: any provider kind from the old run ends at the new run\'s turn end, a run of several included', () => {
  for (const kind of ['rate_limit', 'authentication_failed', 'billing_error', 'unknown']) {
    const who = 'new-run-' + kind + '-8782';
    liveRuns(who, [NEW]);
    assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true, instance: OLD }).recorded, true);
    assert.equal(selfreport.record(who, block(kind, OLD)).recorded, true);
    assert.equal(selfreport.record(who, idle(NEW)).recorded, true, kind + ' outlived the run that wrote it');
  }
  const run = 'new-run-several-8782';
  liveRuns(run, [NEW]);
  assert.equal(selfreport.record(run, { state: 'idle', because: 'finished responding', auto: true, instance: OLD }).recorded, true);
  assert.equal(selfreport.record(run, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(run, block('server_error', OLD)).recorded, true);
  assert.equal(selfreport.record(run, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(run, idle(NEW)).recorded, true, 'a run of blocks from the old session kept its last');
  assert.equal(selfreport.read(run).state, 'idle');
});

test('kosmos#8782: a block over a DELIBERATE question keeps it, even for a new run', () => {
  const who = 'question-under-block-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'which account should this use?', instance: OLD }).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(NEW));
  assert.equal(r.recorded, false, 'a new run\'s idle cleared a block that covered a deliberate question');
  assert.equal(selfreport.read(who).state, 'blocked');
});

test('kosmos#8782: an unknown instance on either side is not a new run (the block stays)', () => {
  const noOld = 'no-old-instance-8782';
  liveRuns(noOld, [NEW]);
  assert.equal(selfreport.record(noOld, block('an api error', undefined)).recorded, true);
  assert.equal(selfreport.record(noOld, idle(NEW)).recorded, false, 'a block with no instance was taken as another run\'s');
  const noNew = 'no-new-instance-8782';
  liveRuns(noNew, [NEW]);
  assert.equal(selfreport.record(noNew, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(noNew, idle(undefined)).recorded, false, 'a report with no instance was taken as a new run');
});

test('kosmos#8782: a DELIBERATE blocked, or an automatic one not about the provider, is not ended by a new run', () => {
  const mine = 'deliberate-blocked-8782';
  liveRuns(mine, [NEW]);
  assert.equal(selfreport.record(mine, { state: 'blocked', on: 'provider api (an api error)', owner: 'provider', instance: OLD }).recorded, true);
  assert.equal(selfreport.read(mine).by, 'agent');
  assert.equal(selfreport.record(mine, idle(NEW)).recorded, false, 'a new run cleared an agent\'s own deliberate block');
  const other = 'auto-blocked-other-8782';
  liveRuns(other, [NEW]);
  assert.equal(selfreport.record(other, { state: 'blocked', on: 'the build server', owner: 'ops', auto: true, instance: OLD }).recorded, true);
  assert.equal(selfreport.record(other, idle(NEW)).recorded, false, 'a new run cleared an automatic block that is not the provider');
});

test('kosmos#8782: two LIVE runs overlap (#570): one run\'s turn end does not end the other\'s block', () => {
  const who = 'overlap-8782';
  liveRuns(who, [OLD, NEW]);
  assert.equal(selfreport.record(who, block('invalid_request', OLD)).recorded, true);
  const r = selfreport.record(who, idle(NEW));
  assert.equal(r.recorded, false, 'a live run\'s block was cleared by its sibling run');
  assert.equal(selfreport.read(who).state, 'blocked');
  // CONTROL: once the old run's token is gone, the same idle ends it.
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, idle(NEW)).recorded, true);
});

test('kosmos#8782: no token file for the agent (unknown) keeps the block', () => {
  const who = 'no-token-file-8782';
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(who, idle(NEW)).recorded, false, 'an unreadable token store was taken as the run ended');
});

test('kosmos#8782: a NEW run\'s own block over the old run\'s keeps #6209\'s same-run rule (the stated residual)', () => {
  // The standing block is the new run's own, so the same-run rule decides: a non-transient kind keeps it.
  const who = 'mixed-runs-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(who, block('rate_limit', NEW)).recorded, true);
  assert.equal(selfreport.record(who, idle(NEW)).recorded, false, 'the new run\'s own rate_limit was cleared by its own idle');
});

test('kosmos#8782: a live sibling\'s block under the gone run\'s block stops the walk, so the block stays', () => {
  const who = 'sibling-under-8782';
  const SIB = 'c0c0c0c0c003';
  liveRuns(who, [SIB, NEW]);
  assert.equal(selfreport.record(who, block('rate_limit', SIB)).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(NEW));
  assert.equal(r.recorded, false, 'the gone run\'s idle-clear also swept a live sibling\'s block');
  assert.equal(selfreport.read(who).state, 'blocked');
});

test('kosmos#8782: a transient block from a gone run is cleared as main clears it, over a live run\'s transient block', () => {
  // Main (#6209) steps over every transient block; the gone-run walk must not make this harder to clear.
  const who = 'transient-over-sibling-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, { state: 'working', because: 'running Bash', auto: true, instance: NEW }).recorded, true);
  assert.equal(selfreport.record(who, block('server_error', NEW)).recorded, true);
  assert.equal(selfreport.record(who, block('server_error', OLD)).recorded, true);
  assert.equal(selfreport.record(who, idle(NEW)).recorded, true, 'a gone run\'s transient block outlived a normal turn end');
  assert.equal(selfreport.read(who).state, 'idle');
});

test('kosmos#8782: a block from a pre-#570 token (instance "legacy") is not taken as a gone run', () => {
  const who = 'legacy-instance-8782';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, block('an api error', 'legacy')).recorded, true);
  assert.equal(selfreport.record(who, idle(NEW)).recorded, false, 'a legacy instance was read as a run whose token is gone');
});

test('kosmos#8782: two gone runs in a row (a second crash before any normal turn) are both stepped over', () => {
  const who = 'two-gone-runs-8782';
  const OLDER = 'd0d0d0d0d004';
  liveRuns(who, [NEW]);
  assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true, instance: OLDER }).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLDER)).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(who, idle(NEW)).recorded, true, 'an older gone run\'s block stopped the walk');
  assert.equal(selfreport.read(who).state, 'idle');
});
