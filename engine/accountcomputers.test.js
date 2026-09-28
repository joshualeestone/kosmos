'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const computers = require('./accountcomputers');

test('normalizes the signed answer with this computer first', () => {
  assert.deepEqual(computers.normalize({ computers: [
    { address: 'other.kosmosplus.com', name: 'Studio', online: false, this_computer: false },
    { address: 'mine.kosmosplus.com', name: 'Laptop', online: true, this_computer: true },
  ] }), [
    { address: 'mine.kosmosplus.com', name: 'Laptop', online: true, thisComputer: true },
    { address: 'other.kosmosplus.com', name: 'Studio', online: false, thisComputer: false },
  ]);
});

test('fails closed on malformed, duplicate, or ambiguous coordinator answers', () => {
  const row = { address: 'mine.kosmosplus.com', name: 'Laptop', online: true, this_computer: true };
  for (const data of [
    null, {}, { computers: 'no' },
    { computers: [{ ...row, online: 'yes' }] },
    { computers: [{ ...row, address: 'https://mine.kosmosplus.com/' }] },
    { computers: [row, { ...row }] },
    { computers: [{ ...row, this_computer: false }] },
    { computers: [row, { ...row, address: 'other.kosmosplus.com', this_computer: true }] },
  ]) assert.equal(computers.normalize(data), null);
});

test('the signed read returns no remote rows on refusal, throw, or a bad shape', async () => {
  assert.deepEqual(await computers.list(async () => ({ ok: false, because: 'off' })), { ok: false, computers: [] });
  assert.deepEqual(await computers.list(async () => { throw new Error('down'); }), { ok: false, computers: [] });
  assert.deepEqual(await computers.list(async () => ({ ok: true, data: { computers: [] } })), { ok: false, computers: [] });
});

test('the signed read uses only the Mac route and accepts a valid result', async () => {
  const calls = [];
  const result = await computers.list(async (...args) => {
    calls.push(args);
    return { ok: true, data: { computers: [
      { address: 'mine.kosmosplus.com', name: 'Laptop', online: true, this_computer: true },
    ] } };
  });
  assert.deepEqual(calls, [['GET', '/v1/mac/account-computers', {}]]);
  assert.equal(result.ok, true);
  assert.equal(result.computers[0].thisComputer, true);
});

test('open intent carries only the public address to HTTPS signin', () => {
  assert.equal(
    computers.openIntent('other.kosmosplus.com', 'https://login.kosmosplus.com/coordinator'),
    'https://login.kosmosplus.com/signin?open=other.kosmosplus.com',
  );
  assert.equal(computers.openIntent('https://evil.example/', 'https://login.kosmosplus.com'), null);
  assert.equal(computers.openIntent('other.kosmosplus.com', 'http://login.kosmosplus.com'), null);
});
