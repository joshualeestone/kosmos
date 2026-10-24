'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits
/*
 * kosmos#6587 (S-7a slice 2a): engine/servicekeys-check.js says whether this computer's pinned coordinator key is on
 * the signed service key set shipped with this version. Built on the relay's published vectors (the same seeds,
 * bytes and signature as engine/servicekeys-6587.test.js).
 *   node --test engine/servicekeys-check-6587.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serviceKeyCheck, SET_FILE, SIG_FILE, PIN_FILE } = require('./servicekeys-check');

const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyFromSeed = (byte) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, byte)]), format: 'der', type: 'pkcs8' });
const rawOf = (priv) => crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12);
const ROOT_PUB = 'MCowBQYDK2VwAyEA/RckOFqgx1tk+3jNYC+h2ZH96/drE8WO1wLqyDXp9hg=';
const VECTOR = '{\n  "type": "kosmos-service-keys",\n  "service_keys": [\n    {\n      "kid": "_oEsEvOrTOY",\n      "pub": "MCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=",\n      "role": "current"\n    },\n    {\n      "kid": "XCm3jxCjWkk",\n      "pub": "MCowBQYDK2VwAyEAE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8o=",\n      "role": "next"\n    }\n  ],\n  "seq": 1,\n  "issued": "2025-08-24"\n}\n';
const VECTOR_SIG = 'Z4eSzkTKtuFexVyEhVtfSo2kWevcWC8xvaCNfxJVxInx40cOLCm6LtjLiX7fJ7oKWcDK+ydIXv+FybM4H2M3Bg==';
const PIN7 = rawOf(keyFromSeed(0x07)).toString('base64url');
const PIN_ROOT = rawOf(keyFromSeed(0x09)).toString('base64url');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), 'servicekeys-check-' + name + '-'));
/* An app folder holding the given set and signature (either may be left out). */
function app({ set = VECTOR, sig = VECTOR_SIG } = {}) {
  const d = tmp('app');
  if (set !== null) fs.writeFileSync(path.join(d, SET_FILE), set);
  if (sig !== null) fs.writeFileSync(path.join(d, SIG_FILE), sig + '\n');
  return d;
}
/* A state dir holding the given pin (null: none). */
function state(pin) {
  const d = tmp('state');
  if (pin !== null) fs.writeFileSync(path.join(d, PIN_FILE), pin);
  return d;
}
const on = (appDir) => ({ appDir, recoveryKeys: [ROOT_PUB] });

test('off as shipped: no recovery key is pinned, so a shipped set and a pin say nothing', () => {
  assert.deepEqual(serviceKeyCheck(state(PIN7), { appDir: app() }), { state: 'off' }, 'the shipped (empty) recovery keys');
  assert.deepEqual(serviceKeyCheck(state(PIN7), { appDir: app(), recoveryKeys: [] }), { state: 'off' }, 'an empty list');
  // This version ships no set beside the engine yet: off with the real app folder too. That commit turns the check on and
  // must wait for S-7a slice 3 (servicekeys-check.js header); flip this line in it.
  assert.equal(fs.existsSync(path.join(__dirname, SET_FILE)), false, 'CONTROL: no set ships in this tree yet');
  assert.deepEqual(serviceKeyCheck(state(PIN7), { recoveryKeys: [ROOT_PUB] }), { state: 'off' }, 'the real app folder, no set');
});

test('no set or no signature shipped is off; a set that does not verify is refused, not news', () => {
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(app({ set: null }))), { state: 'off' }, 'no set');
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(app({ sig: null }))), { state: 'off' }, 'no signature');
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(app({ set: VECTOR.replace('"seq": 1', '"seq": 2') }))), { state: 'refused' }, 'a changed byte');
});

test('the pin: on the set, not on it, absent, empty, and not text', () => {
  assert.deepEqual(serviceKeyCheck(state(PIN7 + '\n'), on(app())), { state: 'listed' }, 'the current key, as the tunnel writes it');
  assert.deepEqual(serviceKeyCheck(state(PIN_ROOT), on(app())), { state: 'mismatch' }, 'a key not on the set');
  assert.deepEqual(serviceKeyCheck(state(null), on(app())), { state: 'none' }, 'no pin file');
  assert.deepEqual(serviceKeyCheck(state(''), on(app())), { state: 'none' }, 'an empty pin file');
  assert.deepEqual(serviceKeyCheck(state(Buffer.from([0xff, 0xfe, 0x41])), on(app())), { state: 'unknown' }, 'a pin that is not UTF-8');
  assert.deepEqual(serviceKeyCheck(state('not a key'), on(app())), { state: 'mismatch' }, 'text that is not a key');
});

test('only the state leaves: no key, kid or reason', () => {
  const text = JSON.stringify([serviceKeyCheck(state(PIN_ROOT), on(app())), serviceKeyCheck(state(PIN7), on(app({ set: VECTOR + ' ' })))]);
  assert.deepEqual(JSON.parse(text).map((r) => Object.keys(r)), [['state'], ['state']]);
  for (const leak of [PIN7, PIN_ROOT, '_oEsEvOrTOY', 'MCowBQ', 'signed']) assert.equal(text.includes(leak), false, 'does not hold ' + leak);
});

test('never throws: a state dir or app folder that is not one is an answer', () => {
  assert.deepEqual(serviceKeyCheck('/nonexistent-' + process.pid, on('/nonexistent-' + process.pid)), { state: 'off' });
  const f = path.join(tmp('file'), 'x'); fs.writeFileSync(f, '');
  assert.deepEqual(serviceKeyCheck(f, on(app())), { state: 'none' }, 'a state "dir" that is a file');
  assert.deepEqual(serviceKeyCheck(state(PIN7), { appDir: app(), recoveryKeys: 'junk' }), { state: 'off' }, 'junk recovery keys');
});

test('a new set is read again: the cache follows the content, not the folder', () => {
  const d = app();
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(d)), { state: 'listed' });
  fs.writeFileSync(path.join(d, SET_FILE), VECTOR.replace('"seq": 1', '"seq": 2'));
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(d)), { state: 'refused' }, 'the changed set is not answered from the cache');
});

test('a board set to another coordinator is elsewhere, not a mismatch; the production answer is unchanged', () => {
  const pinned = state(PIN_ROOT);
  assert.deepEqual(serviceKeyCheck(pinned, { ...on(app()), production: false }), { state: 'elsewhere' }, 'another coordinator');
  assert.deepEqual(serviceKeyCheck(pinned, { ...on(app()), production: true }), { state: 'mismatch' }, 'CONTROL: production');
  assert.deepEqual(serviceKeyCheck(pinned, on(app())), { state: 'mismatch' }, 'not said: production');
  assert.deepEqual(serviceKeyCheck(pinned, { appDir: app(), production: false }), { state: 'off' }, 'off comes first');
});

test('the cache follows the signature too: the same set with a bad signature is not answered from the cache', () => {
  const d = app();
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(d)), { state: 'listed' });
  fs.writeFileSync(path.join(d, SIG_FILE), VECTOR_SIG.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) + '\n');
  assert.deepEqual(serviceKeyCheck(state(PIN7), on(d)), { state: 'refused' }, 'a changed signature');
});

test('slice 3: the keys handed to the connector are the verified set\'s, and only when on, verified and production', () => {
  const { expectedCoordinatorKeys } = require('./servicekeys-check');
  assert.equal(expectedCoordinatorKeys({ appDir: app() }), null, 'off as shipped');
  assert.equal(expectedCoordinatorKeys(on(app())), 'MCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=,MCowBQYDK2VwAyEAE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8o=',
    'both listed keys, in the set\'s own spelling');
  assert.equal(expectedCoordinatorKeys({ ...on(app()), production: false }), null, 'another coordinator');
  assert.equal(expectedCoordinatorKeys(on(app({ set: VECTOR.replace('"seq": 1', '"seq": 2') }))), null, 'a set that does not verify');
  assert.equal(expectedCoordinatorKeys(on(app({ set: null }))), null, 'no set shipped');
});
