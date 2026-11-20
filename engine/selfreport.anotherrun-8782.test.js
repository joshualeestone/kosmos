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

const OLD = 'run-old-0001';
const NEW = 'run-new-0002';
const idle = (instance) => ({ state: 'idle', because: 'finished responding', auto: true, instance });
const block = (kind, instance) => ({ state: 'blocked', on: 'provider api (' + kind + ')', owner: 'provider', auto: true, instance });

test('kosmos#8782: an automatic idle from a NEW run clears the old run\'s "an api error" block (the 11-19 case)', () => {
  const who = 'crash-api-error-8782';
  assert.equal(selfreport.record(who, { state: 'working', because: 'answering a prompt', auto: true, instance: OLD }).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(NEW));
  assert.equal(r.recorded, true, 'a normal turn end in the new session left the dead session\'s block standing');
  assert.equal(selfreport.read(who).state, 'idle');
  assert.equal(selfreport.read(who).instance, NEW);
});

test('kosmos#8782 CONTROL: the SAME run\'s idle still keeps "an api error" (#6209\'s residual is unchanged)', () => {
  const who = 'same-run-api-error-8782';
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(OLD));
  assert.equal(r.recorded, false, 'the same run cleared a kind #6209 keeps');
  assert.equal(r.skipped, 'waiting');
  assert.equal(selfreport.read(who).state, 'blocked');
});

test('kosmos#8782: a NEW run\'s mid-turn working does not clear the block; its turn end does', () => {
  const who = 'new-run-working-8782';
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
    assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true, instance: OLD }).recorded, true);
    assert.equal(selfreport.record(who, block(kind, OLD)).recorded, true);
    assert.equal(selfreport.record(who, idle(NEW)).recorded, true, kind + ' outlived the run that wrote it');
  }
  const run = 'new-run-several-8782';
  assert.equal(selfreport.record(run, { state: 'idle', because: 'finished responding', auto: true, instance: OLD }).recorded, true);
  assert.equal(selfreport.record(run, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(run, block('server_error', OLD)).recorded, true);
  assert.equal(selfreport.record(run, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(run, idle(NEW)).recorded, true, 'a run of blocks from the old session kept its last');
  assert.equal(selfreport.read(run).state, 'idle');
});

test('kosmos#8782: a block over a DELIBERATE question keeps it, even for a new run', () => {
  const who = 'question-under-block-8782';
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'which account should this use?', instance: OLD }).recorded, true);
  assert.equal(selfreport.record(who, block('an api error', OLD)).recorded, true);
  const r = selfreport.record(who, idle(NEW));
  assert.equal(r.recorded, false, 'a new run\'s idle cleared a block that covered a deliberate question');
  assert.equal(selfreport.read(who).state, 'blocked');
});

test('kosmos#8782: an unknown instance on either side is not a new run (the block stays)', () => {
  const noOld = 'no-old-instance-8782';
  assert.equal(selfreport.record(noOld, block('an api error', undefined)).recorded, true);
  assert.equal(selfreport.record(noOld, idle(NEW)).recorded, false, 'a block with no instance was taken as another run\'s');
  const noNew = 'no-new-instance-8782';
  assert.equal(selfreport.record(noNew, block('an api error', OLD)).recorded, true);
  assert.equal(selfreport.record(noNew, idle(undefined)).recorded, false, 'a report with no instance was taken as a new run');
});

test('kosmos#8782: a DELIBERATE blocked, or an automatic one not about the provider, is not ended by a new run', () => {
  const mine = 'deliberate-blocked-8782';
  assert.equal(selfreport.record(mine, { state: 'blocked', on: 'provider api (an api error)', owner: 'provider', instance: OLD }).recorded, true);
  assert.equal(selfreport.read(mine).by, 'agent');
  assert.equal(selfreport.record(mine, idle(NEW)).recorded, false, 'a new run cleared an agent\'s own deliberate block');
  const other = 'auto-blocked-other-8782';
  assert.equal(selfreport.record(other, { state: 'blocked', on: 'the build server', owner: 'ops', auto: true, instance: OLD }).recorded, true);
  assert.equal(selfreport.record(other, idle(NEW)).recorded, false, 'a new run cleared an automatic block that is not the provider');
});
