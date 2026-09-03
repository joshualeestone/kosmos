'use strict';

/**
 * #1979: the pure mint/redeem of the browser-open nonce store in engine/boardauth.js.
 * The server wiring is pinned in server.board-nonce-1979.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const boardauth = require('./engine/boardauth');

// A driveable clock, restored after each test so nothing leaks into siblings.
function withClock(fn) {
  let t = 1_000_000_000;
  boardauth._setNonceClock(() => t);
  try { return fn({ set: (v) => { t = v; }, add: (ms) => { t += ms; }, get: () => t }); }
  finally { boardauth._setNonceClock(null); }
}

test('#1979: a minted nonce is a fresh 256-bit hex value each time', () => {
  const a = boardauth.mintNonce();
  const b = boardauth.mintNonce();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b, 'two mints must not collide');
});

test('#1979: a valid nonce redeems once, then never again (single-use replay guard)', () => {
  withClock(() => {
    const n = boardauth.mintNonce();
    assert.equal(boardauth.redeemNonce(n), true, 'the first redeem of a fresh nonce succeeds');
    assert.equal(boardauth.redeemNonce(n), false, 'a second redeem of the same nonce must fail (burned)');
  });
});

test('#1979: a nonce past its TTL does not redeem, AND is burned so a later replay cannot win a clock race', () => {
  withClock((clock) => {
    const n = boardauth.mintNonce();
    clock.add(120_001); // just past the 2-min TTL
    assert.equal(boardauth.redeemNonce(n), false, 'an expired nonce must not redeem');
    // Even if the clock somehow moved back, the entry is gone (redeem burns on the
    // way out), so it can never resurrect.
    clock.set(1_000_000_000);
    assert.equal(boardauth.redeemNonce(n), false, 'an expired-then-swept nonce stays dead');
  });
});

test('#1979: a nonce just inside the TTL still redeems', () => {
  withClock((clock) => {
    const n = boardauth.mintNonce();
    clock.add(119_000); // still inside 120s
    assert.equal(boardauth.redeemNonce(n), true, 'a nonce inside its TTL redeems');
  });
});

test('#1979: an unknown, empty, or non-string nonce never redeems (no throw)', () => {
  assert.equal(boardauth.redeemNonce('deadbeef'), false, 'a nonce never minted does not redeem');
  assert.equal(boardauth.redeemNonce(''), false);
  assert.equal(boardauth.redeemNonce(null), false);
  assert.equal(boardauth.redeemNonce(undefined), false);
  assert.equal(boardauth.redeemNonce(12345), false);
});

test('#1979: bootstrap redeems a valid ?boot= for the cookie, strips boot, and is single-use', () => {
  withClock(() => {
    const n = boardauth.mintNonce();
    const boot = boardauth.bootstrap({ token: 'TOK', req: { url: `/?first-run=1&boot=${n}`, headers: {} }, routingBase: 'http://localhost', method: 'GET' });
    assert.ok(boot, 'a valid ?boot= must bootstrap');
    assert.equal(boot.location, '/?first-run=1', 'boot is stripped, other params kept');
    assert.match(boot.setCookie, /^kosmos_board=TOK; HttpOnly; SameSite=Strict; Path=\//, 'the cookie carries the durable token, httpOnly');
    // Burned: a second bootstrap with the same nonce (and no ?token=) is not a bootstrap.
    const again = boardauth.bootstrap({ token: 'TOK', req: { url: `/?boot=${n}`, headers: {} }, routingBase: 'http://localhost', method: 'GET' });
    assert.equal(again, null, 'a burned nonce must not bootstrap again');
  });
});

test('#1979: a cookie already present short-circuits before the nonce is even touched', () => {
  withClock(() => {
    const n = boardauth.mintNonce();
    const b = boardauth.bootstrap({ token: 'TOK', req: { url: `/?boot=${n}`, headers: { cookie: 'kosmos_board=TOK' } }, routingBase: 'http://localhost', method: 'GET' });
    assert.equal(b, null, 'a request that already has the cookie is not a bootstrap (no redirect loop)');
    // And the nonce was NOT consumed, so it can still redeem on a real first load.
    assert.equal(boardauth.redeemNonce(n), true, 'the nonce must survive a cookie-present request unspent');
  });
});

test('#1979: a POST (non-nav) with ?boot= is not a bootstrap and does not spend the nonce', () => {
  withClock(() => {
    const n = boardauth.mintNonce();
    const b = boardauth.bootstrap({ token: 'TOK', req: { url: `/?boot=${n}`, headers: {} }, routingBase: 'http://localhost', method: 'POST' });
    assert.equal(b, null, 'only a GET/HEAD nav bootstraps');
    assert.equal(boardauth.redeemNonce(n), true, 'a non-nav must not spend the nonce');
  });
});
