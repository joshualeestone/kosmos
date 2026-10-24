'use strict';
// kosmos#4658: the own-seat compare code, which an owner's computer that arrives after a
// guest shows beside the allowing computer's "Waiting for an Allow" row.
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedseal-compare-4658-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const seal = require('./fedseal');

const ROOM = 'room-abc';
const MAC = 'mac-1';
// RFC 7748 section 6.1, Alice's public key: a fixed, valid X25519 key for the pinned vector.
const RFC_PUB = Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex').toString('base64url');

test('#4658: the code is ten symbols from the safe alphabet, grouped five and five', () => {
  const c = seal.compareCode(ROOM, MAC, seal.newKeyPair().pub);
  assert.match(c, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
});

test('#4658: the code matches a vector computed outside this module (pins the encoding both screens rely on)', () => {
  // Computed with Python's hashlib over the same JSON array, not with this code.
  assert.strictEqual(seal.compareCode(ROOM, MAC, RFC_PUB), 'RBMKZ-XU4UW');
});

test('#4658: the code is a fixed function of its inputs, so the two screens agree without talking', () => {
  const pub = seal.newKeyPair().pub;
  assert.strictEqual(seal.compareCode(ROOM, MAC, pub), seal.compareCode(ROOM, MAC, pub));
});

test('#4658: changing the room, the computer or its key changes the code', () => {
  const pub = seal.newKeyPair().pub;
  const base = seal.compareCode(ROOM, MAC, pub);
  assert.notStrictEqual(seal.compareCode('room-abd', MAC, pub), base, 'the room is bound');
  assert.notStrictEqual(seal.compareCode(ROOM, 'mac-2', pub), base, 'the waiting computer is bound');
  // The attack this code exists for: a coordinator swaps in its own key.
  assert.notStrictEqual(seal.compareCode(ROOM, MAC, seal.newKeyPair().pub), base, 'the seal key is bound');
});

test('#4658: the code spreads over the alphabet (no stuck position)', () => {
  const seen = Array.from({ length: 10 }, () => new Set());
  const codes = new Set();
  for (let i = 0; i < 400; i++) {
    const c = seal.compareCode(ROOM, MAC, seal.newKeyPair().pub).replace('-', '');
    codes.add(c);
    for (let j = 0; j < 10; j++) seen[j].add(c[j]);
  }
  assert.strictEqual(codes.size, 400, 'no two keys gave the same code');
  // 400 draws over 31 symbols leave a given symbol unseen with chance about 2e-6 per position.
  for (let j = 0; j < 10; j++) assert.strictEqual(seen[j].size, 31, `position ${j} saw ${seen[j].size} of 31 symbols`);
});

test('#4658: a missing or malformed input gives no code, so no Allow can be offered on it', () => {
  const pub = seal.newKeyPair().pub;
  assert.strictEqual(seal.compareCode('', MAC, pub), null);
  assert.strictEqual(seal.compareCode(ROOM, '', pub), null);
  assert.strictEqual(seal.compareCode(ROOM, 7, pub), null);
  assert.strictEqual(seal.compareCode(null, MAC, pub), null);
  assert.strictEqual(seal.compareCode(ROOM, MAC, undefined), null);
  assert.strictEqual(seal.compareCode(ROOM, MAC, 'not-a-key'), null);
  assert.strictEqual(seal.compareCode(ROOM, MAC, pub.slice(0, -2)), null, 'a truncated key');
});
