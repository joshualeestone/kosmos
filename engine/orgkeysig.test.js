'use strict';

// kosmos#5686 (b1-mac): the Mac's check of escrowd's org-key signature, pinned to the SAME known vector as kosmos-relay
// coordinator/src/orgkeysig.rs a_known_signature_is_pinned_for_the_macs_verifier: escrow key [5; 32] (so verification
// key 787bfb4f...), org "o1", epoch 1, public key [9; 32].

const test = require('node:test');
const assert = require('node:assert');
const { encode, verify } = require('./orgkeysig');

const VK = Buffer.from('787bfb4fa5a0f3030d0bbfb3eb580215d1fd1207761857997d98c8c3dc6cd008', 'hex');
const PUBLIC = Buffer.alloc(32, 9);
const MSG = '000000186b6f736d6f732d657363726f77642d6f72676b6579207631000000026f31000000080000000000000001000000200909090909090909090909090909090909090909090909090909090909090909';
const SIG = Buffer.from('122bea4f6ab00c667153852785f77bad192f86428e04616c71a3ee725078b23aad574b2c63fabf93a04dc255469dc00c2ce32c071974ca52e089e145193f2608', 'hex');

test('the signed bytes are the relay\'s encoding, byte for byte', () => {
  assert.strictEqual(encode('o1', 1, PUBLIC).toString('hex'), MSG);
});

test('escrowd\'s signature over (org, epoch, public) verifies under the shipped key', () => {
  assert.strictEqual(verify(VK, 'o1', 1, PUBLIC, SIG), true);
});

test('it vouches for nothing else: another org, epoch or key, a changed signature, another verification key', () => {
  assert.strictEqual(verify(VK, 'o2', 1, PUBLIC, SIG), false, 'another org');
  assert.strictEqual(verify(VK, 'o1', 2, PUBLIC, SIG), false, 'another epoch');
  assert.strictEqual(verify(VK, 'o1', 1, Buffer.alloc(32, 8), SIG), false, 'another public key');
  const flipped = Buffer.from(SIG); flipped[10] ^= 1;
  assert.strictEqual(verify(VK, 'o1', 1, PUBLIC, flipped), false, 'a changed signature');
  const otherVk = Buffer.from(VK); otherVk[0] ^= 1;
  assert.strictEqual(verify(otherVk, 'o1', 1, PUBLIC, SIG), false, 'another verification key');
});

test('malformed inputs are false, never a throw', () => {
  for (const [vk, org, epoch, pub, sig] of [
    [null, 'o1', 1, PUBLIC, SIG],
    [VK.subarray(0, 31), 'o1', 1, PUBLIC, SIG],
    [VK, 7, 1, PUBLIC, SIG],
    [VK, 'o1', 1.5, PUBLIC, SIG],
    [VK, 'o1', 1, PUBLIC.subarray(0, 31), SIG],
    [VK, 'o1', 1, PUBLIC, SIG.subarray(0, 63)],
    [VK, 'o1', 1, PUBLIC, 'not a buffer'],
  ]) {
    assert.strictEqual(verify(vk, org, epoch, pub, sig), false);
  }
});
