'use strict';
/* kosmos#4737: engine/enrolment.js, the one rule for "this computer's Kosmos+ folder is set up". */
const test = require('node:test');
const assert = require('node:assert/strict');
const { missingFor, enrolledBy, HELD_FILE } = require('./enrolment');

const having = (...names) => (f) => names.includes(f);

test('the identity and the certificate is set up', () => {
  assert.equal(enrolledBy(having('mac_id', 'address', 'tls.crt', 'tls.key')), true);
});

test('the identity and the held mark is set up: the mark stands in for the certificate files', () => {
  assert.equal(HELD_FILE, 'held', 'the file name is kosmos-relay\'s (crates/tunnel/src/setup.rs): change both together');
  assert.deepEqual(missingFor(having('mac_id', 'address', 'held')), []);
  assert.equal(enrolledBy(having('mac_id', 'address', 'held')), true);
});

test('control: the identity with no certificate and no mark is not set up, and names both certificate files', () => {
  assert.deepEqual(missingFor(having('mac_id', 'address')), ['tls.crt', 'tls.key']);
  assert.equal(enrolledBy(having('mac_id', 'address')), false);
});

test('the mark never stands in for the identity', () => {
  assert.deepEqual(missingFor(having('held', 'tls.crt', 'tls.key')), ['mac_id', 'address']);
  assert.deepEqual(missingFor(having('mac_id', 'held')), ['address']);
  assert.equal(enrolledBy(having('held')), false);
});
