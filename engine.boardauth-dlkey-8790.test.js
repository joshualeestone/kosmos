'use strict';
/**
 * kosmos#8790: the board's download keys (engine/boardauth.js mintDownloadKey / redeemDownloadKey). A key opens one
 * download address, once, within DL_KEY_TTL_MS. The server's use of it is in server.download-key-8790.test.js.
 *
 *   node --test engine.boardauth-dlkey-8790.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const boardauth = require('./engine/boardauth');

const T = '/api/diagnostics';
let now = 1_000_000;
test.beforeEach(() => { boardauth._setNonceClock(() => now); });
test.after(() => { boardauth._setNonceClock(null); });

test('kosmos#8790: a key is 64 hex, opens its own address once, and a second use refuses', () => {
  const k = boardauth.mintDownloadKey(T);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(boardauth.redeemDownloadKey(k, T), true);
  assert.equal(boardauth.redeemDownloadKey(k, T), false, 'single use');
});

test('kosmos#8790: another address refuses and does NOT burn the key; the right one still opens', () => {
  const k = boardauth.mintDownloadKey('/api/agent/max/files/download?name=a.txt');
  assert.equal(boardauth.redeemDownloadKey(k, '/api/agent/max/files/download?name=b.txt'), false, 'another query');
  assert.equal(boardauth.redeemDownloadKey(k, '/api/agent/max/files/download'), false, 'a prefix of the address');
  assert.equal(boardauth.redeemDownloadKey(k, '/api/agent/max/files/download?name=a.txt&x=1'), false, 'a longer query');
  assert.equal(boardauth.redeemDownloadKey(k, '/api/agent/max/files/download?name=a.txt'), true, 'a wrong try did not cost the download');
});

test('kosmos#8790: after the minute a key refuses, and at 59 s it still opens', () => {
  const a = boardauth.mintDownloadKey(T);
  const b = boardauth.mintDownloadKey(T);
  now += boardauth.DL_KEY_TTL_MS - 1000;
  assert.equal(boardauth.redeemDownloadKey(a, T), true, 'CONTROL: inside the minute');
  now += 2000;
  assert.equal(boardauth.redeemDownloadKey(b, T), false, 'past the minute');
});

test('kosmos#8790: a key is not a nonce and a nonce is not a key', () => {
  const k = boardauth.mintDownloadKey(T);
  assert.equal(boardauth.redeemNonce(k), false, 'a download key does not sign in');
  const n = boardauth.mintNonce();
  assert.equal(boardauth.redeemDownloadKey(n, T), false, 'a sign-in nonce opens no download');
  assert.equal(boardauth.redeemDownloadKey(k, T), true, 'CONTROL: the key itself still opens');
});

test('kosmos#8790: malformed keys refuse, and the store holds at most 200 live keys, oldest first out', () => {
  for (const bad of [undefined, null, '', 'abc', 'G'.repeat(64), 42]) assert.equal(boardauth.redeemDownloadKey(bad, T), false, String(bad));
  const first = boardauth.mintDownloadKey(T);
  const keys = [];
  for (let i = 0; i < 200; i++) keys.push(boardauth.mintDownloadKey(T));
  assert.equal(boardauth.redeemDownloadKey(first, T), false, 'the oldest went when the 201st was made');
  assert.equal(boardauth.redeemDownloadKey(keys[0], T), true, 'CONTROL: the next oldest is still live');
});
