'use strict';

/**
 * #1946: the board-auth token gate, pinned as pure functions.
 *
 * The board binds loopback, which is machine-wide not account-wide, so another
 * macOS account reaches the port. The token is the boundary. These tests pin the
 * decision directly (the same posture `server.remote-bind-1112.test.js` uses for
 * `remoteWriteGuard`), so the security logic is proven without a bind and without
 * a real store. The load-bearing control is the DANGEROUS answer: an enforcing
 * board with no token presented must REFUSE, and a perturbation (enforcement off)
 * must let the same request through -- proving the guard is what refuses.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const boardauth = require('./engine/boardauth');

const FULL_SANDBOX = {
  AGENT_WORKFORCE_DATA: '/tmp/x/data',
  AGENT_WORKFORCE_WORKERS: '/tmp/x/workers',
  AGENT_WORKFORCE_LAUNCH: '/tmp/x/launch',
  AGENT_WORKFORCE_PROJECTS: '/tmp/x/projects',
  AGENT_WORKFORCE_TMUX_BIN: '/tmp/x/fake-tmux',
};

function req({ cookie, header, url = '/api/status' } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (header) headers[boardauth.HEADER_NAME] = header;
  return { url, headers };
}

test('enforced() is TRUE for a prod-shaped env and FALSE only when fully sandboxed', () => {
  assert.equal(boardauth.enforced({}), true, 'a board with no sandbox env must enforce');
  assert.equal(boardauth.enforced(FULL_SANDBOX), false, 'a fully-sandboxed fixture board must not enforce');
  // The whole zero-churn claim: every test/browser-check sets exactly this shape.
  assert.equal(boardauth.fullySandboxed(FULL_SANDBOX), true);
  assert.equal(boardauth.fullySandboxed({}), false);
});

test('a HALF sandbox (a live surface remains) still ENFORCES -- the safe direction', () => {
  // Data/workers/launch/projects redirected but tmux NOT inert: a live read
  // surface remains, so the board is not a safe fixture and must still enforce.
  const halfNoTmux = { ...FULL_SANDBOX };
  delete halfNoTmux.AGENT_WORKFORCE_TMUX_BIN;
  assert.equal(boardauth.enforced(halfNoTmux), true, 'tmux still live => enforce');
  // Only some dirs redirected, tmux inert: still a live surface => enforce.
  assert.equal(boardauth.enforced({ AGENT_WORKFORCE_DATA: '/tmp/x', AGENT_WORKFORCE_TMUX_BIN: '/tmp/t' }), true);
});

test('#2040: ownerOnlyModeIsEnforced() is FALSE on Windows -- the file-mode boundary does not hold there', () => {
  // THE DANGEROUS ANSWER, pinned: on win32 the 0o600/0o700 chmods are silent
  // no-ops (NTFS ignores POSIX modes), so the token inherits its parent ACL and
  // another local account can read it. The module must not claim a boundary
  // there. If anyone flips this to true (or a comment to claim Windows
  // protection) WITHOUT implementing and verifying an NTFS ACL, this goes red.
  assert.equal(boardauth.ownerOnlyModeIsEnforced('win32'), false,
    'win32: owner-only mode is NOT an OS-enforced boundary (chmod is a no-op)');

  // Positive controls: on POSIX the mode is a real permission and the boundary
  // holds. A control that can only return the safe answer proves nothing, so
  // these prove the predicate discriminates rather than always answering false.
  assert.equal(boardauth.ownerOnlyModeIsEnforced('darwin'), true, 'macOS enforces the mode');
  assert.equal(boardauth.ownerOnlyModeIsEnforced('linux'), true, 'Linux enforces the mode');

  // The real-platform default tracks the branch (asserting the platform branch
  // itself, not the presence of any chmod call -- per the card's acceptance).
  assert.equal(boardauth.ownerOnlyModeIsEnforced(), process.platform !== 'win32',
    'default reads the real platform');
});

test('matches() is length-guarded and does not throw on a length mismatch', () => {
  assert.equal(boardauth.matches('abc', 'abc'), true);
  assert.equal(boardauth.matches('abc', 'abd'), false);
  assert.equal(boardauth.matches('abc', 'abcd'), false, 'different lengths -> false, not a throw');
  assert.equal(boardauth.matches('', 'abc'), false);
  assert.equal(boardauth.matches(undefined, 'abc'), false);
  assert.equal(boardauth.matches('abc', undefined), false);
});

test('presentedToken() reads cookie, then header, then ?token= query', () => {
  const base = 'http://localhost';
  assert.equal(boardauth.presentedToken(req({ cookie: 'kosmos_board=CK; other=1' }), base), 'CK');
  assert.equal(boardauth.presentedToken(req({ header: 'HD' }), base), 'HD');
  assert.equal(boardauth.presentedToken({ url: '/?token=QT', headers: {} }, base), 'QT');
  // cookie wins over header over query.
  assert.equal(boardauth.presentedToken({ url: '/?token=QT', headers: { cookie: 'kosmos_board=CK', [boardauth.HEADER_NAME]: 'HD' } }, base), 'CK');
  assert.equal(boardauth.presentedToken(req(), base), null, 'nothing presented -> null');
});

test('tokenOk(): the DANGEROUS answer -- no token presented is NOT ok (the caller then refuses)', () => {
  const base = 'http://localhost';
  assert.equal(boardauth.tokenOk({ token: 'T', req: req(), routingBase: base }), false);
});

test('tokenOk(): a valid token (header or cookie) is ok; a wrong token is not', () => {
  const base = 'http://localhost';
  assert.equal(boardauth.tokenOk({ token: 'T', req: req({ header: 'T' }), routingBase: base }), true);
  assert.equal(boardauth.tokenOk({ token: 'T', req: req({ cookie: 'kosmos_board=T' }), routingBase: base }), true);
  assert.equal(boardauth.tokenOk({ token: 'T', req: req({ header: 'WRONG' }), routingBase: base }), false);
  // a valid ?token= query also satisfies tokenOk (e.g. a CLI that appends it)
  assert.equal(boardauth.tokenOk({ token: 'T', req: { url: '/api/x?token=T', headers: {} }, routingBase: base }), true);
});

test('bootstrap(): a valid ?token= on a GET nav returns cookie + clean location (token stripped, other params kept)', () => {
  const base = 'http://localhost';
  const b = boardauth.bootstrap({ token: 'T', req: { url: '/?first-run=1&token=T', headers: {} }, routingBase: base, method: 'GET' });
  assert.ok(b, 'a valid query token on a nav bootstraps');
  assert.equal(b.location, '/?first-run=1', 'token stripped, first-run kept');
  assert.match(b.setCookie, /^kosmos_board=T; HttpOnly; SameSite=Strict; Path=\//);
  assert.match(b.setCookie, /Max-Age=\d+/, 'persistent cookie so a bookmarked bare URL survives a browser restart');
});

test('bootstrap(): a WRONG ?token= does NOT bootstrap (no cookie handed out for a bad token)', () => {
  const base = 'http://localhost';
  assert.equal(boardauth.bootstrap({ token: 'T', req: { url: '/?token=WRONG', headers: {} }, routingBase: base, method: 'GET' }), null);
});

test('bootstrap(): a non-nav method (POST) does not bootstrap even with a valid query token', () => {
  const base = 'http://localhost';
  assert.equal(boardauth.bootstrap({ token: 'T', req: { url: '/api/msg?token=T', headers: {} }, routingBase: base, method: 'POST' }), null);
});

test('bootstrap(): a request that already has the cookie does NOT re-bootstrap (no redirect loop)', () => {
  const base = 'http://localhost';
  assert.equal(boardauth.bootstrap({ token: 'T', req: { url: '/?token=T', headers: { cookie: 'kosmos_board=T' } }, routingBase: base, method: 'GET' }), null);
});

test('fail CLOSED: a null token (provisioning failed) accepts nothing and bootstraps nothing', () => {
  const base = 'http://localhost';
  // Even a request carrying a token string cannot match a null expected token,
  // so the board refuses everything rather than serving unguarded.
  assert.equal(boardauth.tokenOk({ token: null, req: req({ header: 'anything' }), routingBase: base }), false);
  assert.equal(boardauth.bootstrap({ token: null, req: { url: '/?token=anything', headers: {} }, routingBase: base, method: 'GET' }), null);
});

test('ensureToken() writes a mode-600 token in a mode-700 dir and is idempotent', () => {
  const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-token-'));
  const prev = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = SB;
  try {
    // store.ROOT is a lazy getter of AGENT_WORKFORCE_DATA, re-required fresh.
    delete require.cache[require.resolve('./engine/store')];
    delete require.cache[require.resolve('./engine/boardauth')];
    const ba = require('./engine/boardauth');
    const t1 = ba.ensureToken();
    assert.match(t1, /^[0-9a-f]{64}$/, 'a 256-bit hex token');
    const p = ba.tokenPath();
    const st = fs.statSync(p);
    assert.equal(st.mode & 0o777, 0o600, 'token file is owner-only (mode 600)');
    const dirMode = fs.statSync(path.dirname(p)).mode & 0o777;
    assert.equal(dirMode, 0o700, 'token dir is owner-only (mode 700)');
    const t2 = ba.ensureToken();
    assert.equal(t2, t1, 'idempotent: a second call returns the same token');
    assert.equal(ba.readToken(), t1);
    // An empty/corrupt existing token file must HEAL, not deadlock: readToken()
    // returns null on it, so the link() claim would EEXIST forever and the board
    // would 403 everything. ensureToken() replaces it with a fresh token instead.
    fs.writeFileSync(p, '   \n');
    const healed = ba.ensureToken();
    assert.match(healed, /^[0-9a-f]{64}$/, 'a corrupt token file heals to a fresh token');
    assert.equal(fs.readFileSync(p, 'utf8').trim(), healed, 'the healed token is persisted');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = prev;
    delete require.cache[require.resolve('./engine/store')];
    delete require.cache[require.resolve('./engine/boardauth')];
    fs.rmSync(SB, { recursive: true, force: true });
  }
});
