'use strict';

/**
 * #3055: the multi-world board-token primitives, pinned as PURE functions.
 *
 * The active-world gate is pinned in engine.boardauth-1946.test.js. This pins the
 * two functions A adds so a post-switch browser is not locked out of switching
 * back:
 *   - tokenOkAny(): accept a presented token matching ANY of a list (the account's
 *     world tokens), not only the active world's.
 *   - readTokenFrom(): read a specific world's board.token by its own store root.
 *
 * The load-bearing controls are the DANGEROUS answers: nothing presented is NOT ok,
 * and a token matching NONE of the list is NOT ok (that is the logic-layer half of
 * cross-account isolation -- a token that is no listed world's token is refused).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const boardauth = require('./engine/boardauth');

function req({ cookie, header, url = '/api/status' } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (header) headers[boardauth.HEADER_NAME] = header;
  return { url, headers };
}
const B = 'http://localhost';

test('tokenOkAny(): the DANGEROUS answer -- nothing presented is NOT ok', () => {
  assert.equal(boardauth.tokenOkAny({ tokens: ['A', 'B'], req: req(), routingBase: B }), false);
});

test('tokenOkAny(): a presented token matching ANY list member is ok (header + cookie + query)', () => {
  // matches the SECOND member (the "other world" case: not the first/active token)
  assert.equal(boardauth.tokenOkAny({ tokens: ['ACTIVE', 'OTHER'], req: req({ header: 'OTHER' }), routingBase: B }), true);
  assert.equal(boardauth.tokenOkAny({ tokens: ['ACTIVE', 'OTHER'], req: req({ cookie: 'kosmos_board=OTHER' }), routingBase: B }), true);
  assert.equal(boardauth.tokenOkAny({ tokens: ['ACTIVE', 'OTHER'], req: { url: '/api/x?token=OTHER', headers: {} }, routingBase: B }), true);
  // matches the FIRST member too
  assert.equal(boardauth.tokenOkAny({ tokens: ['ACTIVE', 'OTHER'], req: req({ header: 'ACTIVE' }), routingBase: B }), true);
});

test('tokenOkAny(): a token matching NONE of the list is NOT ok (the cross-account logic boundary)', () => {
  // FOREIGN is a perfectly valid-looking token, just not one of THIS account's
  // world tokens -> refused. This is the logic half of #1946: the accepted set is
  // exactly the tokens handed in, nothing wider.
  assert.equal(boardauth.tokenOkAny({ tokens: ['ACTIVE', 'OTHER'], req: req({ header: 'FOREIGN' }), routingBase: B }), false);
});

test('tokenOkAny(): empty/absent candidates are skipped, never a throw or a spurious accept', () => {
  // An absent world token (readTokenFrom -> null) lands in the list as a falsy
  // value; it must not match anything and must not throw.
  assert.equal(boardauth.tokenOkAny({ tokens: [null, '', undefined], req: req({ header: 'X' }), routingBase: B }), false);
  // an EMPTY presented token against a list that (wrongly) contains '' must still be
  // false -- presentedToken returns null for an empty cookie, so nothing is presented
  assert.equal(boardauth.tokenOkAny({ tokens: [''], req: req({ header: 'X' }), routingBase: B }), false);
  // a non-array tokens arg is refused, not thrown
  assert.equal(boardauth.tokenOkAny({ tokens: null, req: req({ header: 'X' }), routingBase: B }), false);
  assert.equal(boardauth.tokenOkAny({ tokens: undefined, req: req({ header: 'X' }), routingBase: B }), false);
});

test('tokenOkAny(): an empty list is NOT ok even with a token presented', () => {
  assert.equal(boardauth.tokenOkAny({ tokens: [], req: req({ header: 'X' }), routingBase: B }), false);
});

test('readTokenFrom(): reads board.token at an explicit root; null on absent/empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldtoken-'));
  try {
    // absent -> null
    assert.equal(boardauth.readTokenFrom(dir), null, 'no board.token -> null');
    // present -> the trimmed value
    fs.writeFileSync(path.join(dir, 'board.token'), '  TOKENVALUE\n');
    assert.equal(boardauth.readTokenFrom(dir), 'TOKENVALUE', 'reads + trims the token');
    // empty file -> null (not the empty string)
    fs.writeFileSync(path.join(dir, 'board.token'), '   \n');
    assert.equal(boardauth.readTokenFrom(dir), null, 'empty/whitespace token -> null');
    // a non-string / falsy root -> null, never a throw
    assert.equal(boardauth.readTokenFrom(null), null);
    assert.equal(boardauth.readTokenFrom(''), null);
    assert.equal(boardauth.readTokenFrom(undefined), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
