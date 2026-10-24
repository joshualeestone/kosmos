'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits
/*
 * kosmos#6596 step 8, slice 2 (board half): a sign-in the connector refused because the Kosmos+ key changed names
 * the key it was offered (kosmos-relay PinMismatch); the board reads it, the person may accept it, and the NEXT
 * registration run names it in KOSMOS_EXPECT_COORDINATOR_KEYS, once. Every arm has a control giving the other answer.
 *   node --test engine/acceptkey-6596.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ak-'));
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ak-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ak-home-'));
delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
for (const k of Object.keys(process.env)) if (k.toUpperCase() === 'KOSMOS_EXPECT_COORDINATOR_KEYS') delete process.env[k];
const check = require('./servicekeys-check');
const remote = require('./remote');
const trustkeys = require('./trustkeys');

const keyOf = (byte) => crypto.createPublicKey(crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, byte)]), format: 'der', type: 'pkcs8',
})).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
const K = keyOf(0x31);
const OTHER = keyOf(0x32);
// The connector's own words (kosmos-relay setup.rs PinMismatch's Display), copied here on purpose: if either side
// changes them, this file is where it shows.
const REFUSAL = (k) => 'the Kosmos+ service offered a different key from the one this computer trusts, and nothing vouches for '
  + 'it, so this computer kept its key and did not take the new registration (the key it offered: ' + k + ')';

test('the label is the connector\'s, letter for letter', () => {
  assert.equal(remote.OFFERED_KEY_LABEL, 'the key it offered: ');
});

test('the offered key is read wherever the refusal sits, and only a well-formed key', () => {
  assert.equal(K.length, 43, 'CONTROL: the pin spelling');
  assert.equal(remote.offeredKeyIn(REFUSAL(K)), K, 'at the end');
  assert.equal(remote.offeredKeyIn('Error: registration failed: ' + REFUSAL(K) + '\n\nCaused by:\n    0: x'), K, 'wrapped in context, mid-text');
  assert.equal(remote.offeredKeyIn('the key it offered: ' + K + ') and more'), K, 'not at the end of a line');
  assert.equal(remote.offeredKeyIn(REFUSAL(K.slice(0, 42))), null, 'one character short');
  assert.equal(remote.offeredKeyIn(REFUSAL(K + 'A')), null, 'one character long');
  assert.equal(remote.offeredKeyIn(REFUSAL(K.slice(0, 42) + '=')), null, 'padding');
  assert.equal(remote.offeredKeyIn(REFUSAL(K.replace(/./, '+'))), null, 'standard base64, not url-safe');
  // The last character carries two spare bits; a canonical key has them zero ('A','Q','g','w' and so on).
  const spare = K.slice(0, 42) + (K[42] === 'B' ? 'C' : 'B');
  assert.equal(Buffer.from(spare, 'base64url').length, 32, 'CONTROL: a lax decoder reads the same 32 bytes');
  assert.equal(remote.offeredKeyIn(REFUSAL(spare)), null, 'spare bits set: not the spelling the connector writes');
  assert.equal(remote.offeredKeyIn('the key it offered: ' + K), null, 'no closing parenthesis');
  assert.equal(remote.offeredKeyIn(REFUSAL(K) + ' ' + REFUSAL(OTHER)), null, 'two keys named: neither is trusted');
  assert.equal(remote.offeredKeyIn(REFUSAL(K).replace('the key it offered: ', 'the key: ')), null, 'another label');
  assert.equal(remote.offeredKeyIn(undefined), null);
});

/* A fake connector: `setup start` succeeds; a registration fails with `refusal` on stderr (or succeeds when null).
   Records each run's args and environment. */
function connector({ refusal = null, shipped = null } = {}) {
  const runs = [];
  const real = check.expectedCoordinatorKeys;
  check.expectedCoordinatorKeys = () => shipped;
  remote.setSetupSpawnForTests((bin, args, opts) => {
    runs.push({ args, env: opts.env });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    const register = args[0] === 'setup' && args[1] === 'complete';
    const code = register && refusal ? 1 : register ? 1 : 0;
    setImmediate(() => {
      if (register) child.stderr.emit('data', Buffer.from('Error: ' + (refusal || 'some other failure') + '\n'));
      child.emit('exit', code); child.emit('close', code);
    });
    return child;
  });
  return { runs, done: () => { check.expectedCoordinatorKeys = real; remote.resetForTests(); } };
}
const expectOf = (run) => (run.env ? run.env.KOSMOS_EXPECT_COORDINATOR_KEYS : undefined);
async function signIn() {
  const s = await remote.setupStart('a@example.com');
  assert.equal(s.ok, true, 'CONTROL: the email step ran');
  return remote.setupComplete('123456', 'my-mac');
}
const STORE = path.join(STATE, trustkeys.STORE_FILE);

test('a refused sign-in that names a key says the key changed; another failure does not', async () => {
  let c = connector({ refusal: REFUSAL(K) });
  try {
    const r = await signIn();
    assert.equal(r.ok, false);
    assert.deepEqual(r.keyChanged, { offered: K });
  } finally { c.done(); }
  c = connector({ refusal: 'that name is taken' });
  try {
    const r = await signIn();
    assert.equal(r.ok, false, 'CONTROL: it failed');
    assert.equal('keyChanged' in r, false);
  } finally { c.done(); }
});

test('while a service key set is held no key is offered for acceptance, even when a message names one', async () => {
  fs.writeFileSync(STORE, '{}');
  const c = connector({ refusal: REFUSAL(K) });
  try {
    assert.equal('keyChanged' in await signIn(), false);
    assert.equal(remote.acceptOfferedKey(K).ok, false, 'nor accepted');
  } finally { c.done(); fs.rmSync(STORE, { force: true }); }
  const d = connector({ refusal: REFUSAL(K) });
  try {
    assert.deepEqual((await signIn()).keyChanged, { offered: K }, 'CONTROL: the same refusal with no set held');
  } finally { d.done(); }
});

test('an accepted key goes to the next registration only, once', async () => {
  const c = connector({ refusal: 'that name is taken' });
  try {
    assert.equal(remote.acceptOfferedKey(K).ok, true);
    await remote.setupStart('a@example.com');
    assert.equal(c.runs[0].args[1], 'start', 'CONTROL: the email step');
    assert.equal(c.runs[0].env, undefined, 'a run that is not a registration does not take it');
    await remote.setupComplete('123456', 'my-mac');
    const reg = c.runs.filter((r) => r.args[1] === 'complete');
    assert.equal(reg.length, 1, 'CONTROL: one registration ran');
    assert.equal(expectOf(reg[0]), K, 'the registration names it');
    await remote.setupComplete('123456', 'my-mac');
    const again = c.runs.filter((r) => r.args[1] === 'complete');
    assert.equal(again.length, 2, 'CONTROL: a second registration ran');
    assert.equal(again[1].env, undefined, 'and does not name it again');
  } finally { c.done(); }
});

test('with the shipped keys, the accepted key is added to them', async () => {
  const c = connector({ refusal: 'that name is taken', shipped: 'MCowBQYDK2VwAyEAkey1' });
  try {
    remote.acceptOfferedKey(K);
    await signIn();
    assert.equal(expectOf(c.runs.find((r) => r.args[1] === 'complete')), 'MCowBQYDK2VwAyEAkey1,' + K);
  } finally { c.done(); }
});

test('an acceptance older than an hour, or a key that does not parse, is not used', async () => {
  const c = connector({ refusal: 'that name is taken' });
  const realNow = Date.now;
  try {
    assert.equal(remote.acceptOfferedKey('not a key').ok, false);
    assert.equal(remote.acceptOfferedKey(K.slice(0, 42)).ok, false);
    const t = realNow();
    Date.now = () => t;
    assert.equal(remote.acceptOfferedKey(K).ok, true);
    Date.now = () => t + 60 * 60 * 1000 + 1;
    await signIn();
    assert.equal(c.runs.find((r) => r.args[1] === 'complete').env, undefined, 'stale: not named');
    Date.now = () => t;
    remote.acceptOfferedKey(K);
    Date.now = () => t + 60 * 60 * 1000 - 1;
    await remote.setupComplete('123456', 'my-mac');
    assert.equal(expectOf(c.runs.filter((r) => r.args[1] === 'complete')[1]), K, 'CONTROL: inside the hour it is named');
  } finally { Date.now = realNow; c.done(); }
});

test('Forget voids an acceptance; Start over (signinCancel) does not', async () => {
  const c = connector({ refusal: 'that name is taken' });
  try {
    remote.acceptOfferedKey(K);
    remote.signinCancel();
    await signIn();
    assert.equal(expectOf(c.runs.find((r) => r.args[1] === 'complete')), K, 'Start over keeps it: it is how the new code is got');
    remote.acceptOfferedKey(K);
    await remote.forget({ anyway: true });
    await signIn();
    assert.equal(c.runs.filter((r) => r.args[1] === 'complete')[1].env, undefined, 'after a Forget it is gone');
  } finally { c.done(); }
});
