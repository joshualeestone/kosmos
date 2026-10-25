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
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';   // a registration that goes through starts nothing real
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

/* A fake connector: `setup start` succeeds; a registration fails with `c.refusal` on stderr. `c.shipped` is the
   shipped list the board would hand over. Records each run's args and environment. */
function connector({ refusal = 'that name is taken', shipped = null } = {}) {
  const c = { runs: [], refusal, shipped };
  const real = check.expectedCoordinatorKeys;
  check.expectedCoordinatorKeys = () => c.shipped;
  remote.setSetupSpawnForTests((bin, args, opts) => {
    c.runs.push({ args, env: opts.env });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    const register = args[0] === 'setup' && args[1] === 'complete';
    const end = () => {
      if (register && c.refusal) child.stderr.emit('data', Buffer.from('Error: ' + c.refusal + '\n'));
      const code = register && c.refusal ? 1 : 0;
      child.emit('exit', code); child.emit('close', code);
    };
    // `c.gate` (a promise) holds a registration open until it settles.
    if (register && c.gate) c.gate.then(() => setImmediate(end)); else setImmediate(end);
    return child;
  });
  c.registrations = () => c.runs.filter((r) => r.args[1] === 'complete');
  c.done = () => { check.expectedCoordinatorKeys = real; remote.resetForTests(); fs.rmSync(PIN, { force: true }); };
  return c;
}
const expectOf = (run) => (run.env ? run.env.KOSMOS_EXPECT_COORDINATOR_KEYS : undefined);
async function signIn() {
  const s = await remote.setupStart('a@example.com');
  assert.equal(s.ok, true, 'CONTROL: the email step ran');
  return remote.setupComplete('123456', 'my-mac');
}
const STORE = path.join(STATE, trustkeys.STORE_FILE);
const PIN = path.join(STATE, 'coordinator_pubkey');
/* A refused sign-in naming `k`, then the connector refuses for another reason (so the next run is a fresh one). */
async function offered(c, k) {
  c.refusal = REFUSAL(k);
  const r = await signIn();
  assert.deepEqual(r.keyChanged, { offered: k }, 'CONTROL: the refusal named the key');
  c.refusal = 'that name is taken';
}

test('a refused sign-in that names a key says the key changed; another failure does not', async () => {
  const c = connector({ refusal: REFUSAL(K) });
  try {
    const r = await signIn();
    assert.equal(r.ok, false);
    assert.deepEqual(r.keyChanged, { offered: K });
    c.refusal = 'that name is taken';
    const other = await signIn();
    assert.equal(other.ok, false, 'CONTROL: it failed');
    assert.equal('keyChanged' in other, false);
  } finally { c.done(); }
});

test('a text naming two keys across lines is not read as naming the one on its last line', async () => {
  const c = connector({ refusal: REFUSAL(OTHER) + '\n' + REFUSAL(K) });
  try {
    const r = await signIn();
    assert.equal(remote.offeredKeyIn(r.because), K, 'CONTROL: the last line alone names one key');
    assert.equal('keyChanged' in r, false);
  } finally { c.done(); }
});

test('while a service key set is held no key is offered for acceptance, even when a message names one', async () => {
  fs.writeFileSync(STORE, '{}');
  const c = connector({ refusal: REFUSAL(K) });
  try {
    assert.equal('keyChanged' in await signIn(), false);
  } finally { c.done(); fs.rmSync(STORE, { force: true }); }
  // A set that arrives between the refusal and the Accept: the Accept itself is refused, for that reason.
  const s2 = connector();
  try {
    await offered(s2, K);
    fs.writeFileSync(STORE, '{}');
    const a = remote.acceptOfferedKey(K);
    assert.equal(a.ok, false);
    assert.match(a.because, /holds a signed list of Kosmos\+ keys/, 'refused because of the set, not as never offered');
  } finally { s2.done(); fs.rmSync(STORE, { force: true }); }
  const d = connector({ refusal: REFUSAL(K) });
  try {
    assert.deepEqual((await signIn()).keyChanged, { offered: K }, 'CONTROL: the same refusal with no set held');
  } finally { d.done(); }
});

test('only the key the last refusal named can be accepted', async () => {
  const c = connector();
  try {
    assert.equal(remote.acceptOfferedKey(K).ok, false, 'nothing offered yet');
    await offered(c, K);
    assert.equal(remote.acceptOfferedKey(OTHER).ok, false, 'a key that was not offered');
    assert.equal(remote.acceptOfferedKey('not a key').ok, false);
    assert.equal(remote.acceptOfferedKey(K).ok, true, 'CONTROL: the offered key');
    assert.equal(remote.acceptOfferedKey(K).ok, false, 'accepted once: a second Accept needs a second refusal');
  } finally { c.done(); }
});

test('a registration that goes through ends the offer', async () => {
  const c = connector();
  try {
    await offered(c, K);
    c.refusal = null;
    const r = await remote.setupComplete('123456', 'my-mac');
    assert.equal(r.ok, true, 'CONTROL: the registration went through: ' + r.because);
    assert.equal(remote.acceptOfferedKey(K).ok, false);
  } finally { c.done(); }
});

test('an accepted key goes to the next registration only, once, beside the pin held', async () => {
  const c = connector();
  try {
    await offered(c, K);
    assert.equal(remote.acceptOfferedKey(K).ok, true);
    const before = c.runs.length;
    await remote.setupStart('a@example.com');
    assert.equal(c.runs[before].args[1], 'start', 'CONTROL: the email step');
    assert.equal(c.runs[before].env, undefined, 'a run that is not a registration does not take it');
    fs.writeFileSync(PIN, OTHER + '\n');
    await remote.setupComplete('123456', 'my-mac');
    const reg = c.registrations();
    assert.equal(expectOf(reg[reg.length - 1]), OTHER + ',' + K, 'the registration names it, beside the pin held');
    await remote.setupComplete('123456', 'my-mac');
    assert.equal(c.registrations().length, reg.length + 1, 'CONTROL: a second registration ran');
    assert.equal(c.registrations()[reg.length].env, undefined, 'and does not name it again');
  } finally { c.done(); }
});

test('with no pin held the accepted key is named alone', async () => {
  const c = connector();
  try {
    await offered(c, K);
    remote.acceptOfferedKey(K);
    await remote.setupComplete('123456', 'my-mac');
    const reg = c.registrations();
    assert.equal(expectOf(reg[reg.length - 1]), K);
  } finally { c.done(); }
});

test('under a shipped list no key is accepted, and an accepted one never widens the list', async () => {
  const c = connector();
  try {
    await offered(c, K);
    c.shipped = 'MCowBQYDK2VwAyEAkey1';
    assert.equal(remote.acceptOfferedKey(K).ok, false, 'refused under the list');
    c.shipped = null;
    assert.equal(remote.acceptOfferedKey(K).ok, true, 'CONTROL: accepted with no list');
    c.shipped = 'MCowBQYDK2VwAyEAkey1';
    await remote.setupComplete('123456', 'my-mac');
    const reg = c.registrations();
    assert.equal(expectOf(reg[reg.length - 1]), 'MCowBQYDK2VwAyEAkey1', 'the list alone, never widened');
  } finally { c.done(); }
});

test('an offer or an acceptance older than an hour is not used', async () => {
  const c = connector();
  const realNow = Date.now;
  try {
    const t = realNow();
    Date.now = () => t;
    await offered(c, K);
    Date.now = () => t + 60 * 60 * 1000 + 1;
    assert.equal(remote.acceptOfferedKey(K).ok, false, 'a stale offer');
    Date.now = () => t;
    assert.equal(remote.acceptOfferedKey(K).ok, true, 'CONTROL: inside the hour');
    Date.now = () => t + 60 * 60 * 1000 + 1;
    await remote.setupComplete('123456', 'my-mac');
    let reg = c.registrations();
    assert.equal(reg[reg.length - 1].env, undefined, 'a stale acceptance is not named');
    Date.now = () => t;
    await offered(c, K);
    assert.equal(remote.acceptOfferedKey(K).ok, true, 'CONTROL: offered again and accepted');
    Date.now = () => t + 60 * 60 * 1000 - 1;
    await remote.setupComplete('123456', 'my-mac');
    reg = c.registrations();
    assert.equal(expectOf(reg[reg.length - 1]), K, 'CONTROL: inside the hour it is named');
  } finally { Date.now = realNow; c.done(); }
});

test('Forget voids an offer and an acceptance; Start over (signinCancel) does not', async () => {
  const c = connector();
  try {
    await offered(c, K);
    remote.acceptOfferedKey(K);
    remote.signinCancel();
    await remote.setupComplete('123456', 'my-mac');
    let reg = c.registrations();
    assert.equal(expectOf(reg[reg.length - 1]), K, 'Start over keeps it: it is how the new code is got');
    // An offer, then a Forget: it can no longer be accepted.
    await offered(c, K);
    await remote.forget({ anyway: true });
    assert.equal(remote.acceptOfferedKey(K).ok, false, 'the offer is gone after a Forget');
    // An acceptance, then a Forget: the next registration does not name it.
    await offered(c, K);
    assert.equal(remote.acceptOfferedKey(K).ok, true, 'CONTROL: accepted before the Forget');
    await remote.forget({ anyway: true });
    await signIn();
    reg = c.registrations();
    assert.equal(reg[reg.length - 1].env, undefined, 'the acceptance is gone after a Forget');
  } finally { c.done(); }
});

test('a set that arrives after the Accept voids it: the next registration names no key', async () => {
  const c = connector();
  try {
    await offered(c, K);
    assert.equal(remote.acceptOfferedKey(K).ok, true);
    fs.writeFileSync(STORE, '{}');
    await remote.setupComplete('123456', 'my-mac');
    const reg = c.registrations();
    assert.equal(reg[reg.length - 1].env, undefined);
  } finally { c.done(); fs.rmSync(STORE, { force: true }); }
});

test('an Accept made while a registration is out ends if that registration goes through', async () => {
  const c = connector();
  try {
    await offered(c, K);
    c.refusal = null;
    let release;
    c.gate = new Promise((ok) => { release = ok; });
    const before = c.registrations().length;
    const out = remote.setupComplete('123456', 'my-mac');
    for (let i = 0; i < 200 && c.registrations().length === before; i++) await new Promise((ok) => setImmediate(ok));
    assert.equal(c.registrations().length, before + 1, 'CONTROL: the registration is out');
    assert.equal(c.registrations()[before].env, undefined, 'CONTROL: it started before the Accept, without the key');
    assert.equal(remote.acceptOfferedKey(K).ok, true, 'accepted while it was out');
    release();
    assert.equal((await out).ok, true, 'CONTROL: it went through');
    c.gate = null;
    c.refusal = 'that name is taken';
    await remote.setupComplete('123456', 'my-mac');
    const reg = c.registrations();
    assert.equal(reg[reg.length - 1].env, undefined, 'the acceptance ended with the registration that went through');
  } finally { c.done(); }
});

test('the connector names a key refused for not being on the list; under the shipped list it is not offered', async () => {
  // kosmos#6596 follow-up: the connector's own words for a key not on the list it was handed (kosmos-relay setup.rs
  // expected_coordinator_key), with the key named after the same label.
  const notListed = (k) => 'the Kosmos+ service offered a key that is not on the list of keys this computer expects, so '
    + 'nothing was registered (the key it offered: ' + k + ')';
  const c = connector({ refusal: notListed(K) });
  try {
    assert.deepEqual((await signIn()).keyChanged, { offered: K }, 'CONTROL: with no shipped list it is offered');
    c.shipped = 'MCowBQYDK2VwAyEAkey1';
    const r = await signIn();
    assert.equal(r.ok, false);
    assert.equal('keyChanged' in r, false, 'under the shipped list nothing is offered');
    assert.match(r.because, /not on the signed list that came with this version of Kosmos/, 'its meaning under the shipped list');
    assert.equal(r.because.includes(K), false, 'and never the raw key');
  } finally { c.done(); }
});

test('the shipped list is the one in force when the registration starts, not when it ends', async () => {
  const notListed = (k) => 'the Kosmos+ service offered a key that is not on the list of keys this computer expects, so '
    + 'nothing was registered (the key it offered: ' + k + ')';
  const c = connector({ refusal: notListed(K), shipped: 'MCowBQYDK2VwAyEAkey1' });
  try {
    await remote.setupStart('a@example.com');
    let release;
    c.gate = new Promise((ok) => { release = ok; });
    const before = c.registrations().length;
    const out = remote.setupComplete('123456', 'my-mac');
    for (let i = 0; i < 200 && c.registrations().length === before; i++) await new Promise((ok) => setImmediate(ok));
    assert.equal(expectOf(c.registrations()[before]), 'MCowBQYDK2VwAyEAkey1', 'CONTROL: it started under the shipped list');
    c.shipped = null;   // the setting changes while the registration is out
    release();
    const r = await out;
    assert.equal('keyChanged' in r, false, 'a key refused against the shipped list is not offered afterwards');
    assert.match(r.because, /not on the signed list that came with this version of Kosmos/, 'and it says what it meant when the run started');
  } finally { c.done(); }
});

test('under the shipped list with a signed set held, the refusal (naming no key) still says what it means', async () => {
  // Review 2: the usual state beside a shipped list is a held set, and then the connector names no key.
  const words = 'the Kosmos+ service offered a key that is not on the list of keys this computer expects, so nothing was registered';
  fs.writeFileSync(STORE, '{}');
  const c = connector({ refusal: words, shipped: 'MCowBQYDK2VwAyEAkey1' });
  try {
    const r = await signIn();
    assert.equal('keyChanged' in r, false);
    assert.match(r.because, /not on the signed list that came with this version of Kosmos/);
    c.shipped = null;
    const plain = await signIn();
    assert.equal(plain.because.includes('not on the signed list that came with'), false, 'CONTROL: not replaced without the shipped list');
  } finally { c.done(); fs.rmSync(STORE, { force: true }); }
});

test('under the shipped list a key named in any other refusal is not offered either', async () => {
  // Review 3: the later guard, reached by a named key in words other than the not-on-the-list refusal.
  const c = connector({ refusal: REFUSAL(K), shipped: 'MCowBQYDK2VwAyEAkey1' });
  try {
    const r = await signIn();
    assert.equal('keyChanged' in r, false);
    c.shipped = null;
    assert.deepEqual((await signIn()).keyChanged, { offered: K }, 'CONTROL: offered without the shipped list');
  } finally { c.done(); }
});
