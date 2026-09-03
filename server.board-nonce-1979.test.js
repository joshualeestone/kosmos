'use strict';

/**
 * #1979: the browser-open nonce, wired into the real dispatch.
 *
 * The pure mint/redeem is pinned in engine.boardauth-nonce-1979.test.js. This
 * proves the SERVER mints one at POST /api/board-nonce (loopback-only, board-token
 * gated) and redeems `?boot=<nonce>` in the bootstrap the same way `?token=` is,
 * so the durable token never has to ride the browser-open argv.
 *
 * Same posture as server.board-auth-1946.test.js: boot fully-sandboxed, then flip
 * enforcement on in memory.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-boardnonce-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const boardauth = require('./engine/boardauth'); // #2030: same singleton the server uses, so reauthMarkerPath() resolves to the sandbox store.ROOT.

const TOK = 'BOARDNONCE_test_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});

async function mint(headers = {}) {
  const res = await fetch(base + '/api/board-nonce', { method: 'POST', headers, redirect: 'manual' });
  let json = {};
  try { json = JSON.parse(await res.text()); } catch { /* leave {} */ }
  return { code: res.status, nonce: json.nonce };
}
async function nav(p, headers = {}) {
  const res = await fetch(base + p, { headers, redirect: 'manual' });
  await res.text().catch(() => {});
  return { code: res.status, loc: res.headers.get('location'), setCookie: res.headers.get('set-cookie') };
}

test('POST /api/board-nonce with the board token mints a 64-hex nonce', async () => {
  const r = await mint({ 'x-kosmos-board-token': TOK });
  assert.equal(r.code, 200, 'a board-token-holder must be able to mint');
  assert.match(String(r.nonce), /^[0-9a-f]{64}$/, 'the nonce is a 256-bit hex value');
});

test('POST /api/board-nonce WITHOUT the board token is refused (the sensitive gate)', async () => {
  const r = await mint();
  assert.equal(r.code, 403, 'minting a nonce needs the board token, off argv (the whole point)');
  assert.equal(r.nonce, undefined);
});

test('a minted nonce redeems: GET /?boot=<nonce> is a 302 that sets the cookie and strips boot', async () => {
  const m = await mint({ 'x-kosmos-board-token': TOK });
  const r = await nav(`/?first-run=1&boot=${m.nonce}`);
  assert.equal(r.code, 302, 'a valid boot nonce must bootstrap');
  assert.equal(r.loc, '/?first-run=1', 'the redirect drops boot and keeps other params');
  assert.match(r.setCookie || '', /kosmos_board=/);
  assert.match(r.setCookie || '', /HttpOnly/);
});

test('a nonce is SINGLE-USE: the same ?boot= a second time does not bootstrap', async () => {
  const m = await mint({ 'x-kosmos-board-token': TOK });
  const first = await nav(`/?boot=${m.nonce}`);
  assert.equal(first.code, 302, 'precondition: the first redeem bootstraps');
  const second = await nav(`/?boot=${m.nonce}`);
  // The nonce is burned, so this is not a bootstrap. The static shell is exempt
  // from the board token, so a bare GET / with no cookie is the shell (200), not
  // a 302 -- the important assertion is simply that it did NOT bootstrap again.
  assert.notEqual(second.code, 302, 'a burned nonce must never bootstrap a second time (replay)');
});

test('a garbage ?boot= does not bootstrap (and does not leak whether a nonce existed)', async () => {
  const r = await nav('/?boot=not-a-real-nonce');
  assert.notEqual(r.code, 302, 'an unknown nonce is not a bootstrap');
});

test('#2030: a ?boot= REDEMPTION seeds the reauth marker; a ?token= bootstrap and a garbage boot do NOT', async () => {
  const marker = boardauth.reauthMarkerPath();
  const clean = () => { try { fs.rmSync(marker, { force: true }); } catch { /* best effort */ } };

  // The whole point: the #2023 repair marker is written server-side the moment a
  // nonce is truly REDEEMED, not by setup.sh when an open is merely dispatched.
  clean();
  assert.equal(fs.existsSync(marker), false, 'precondition: no marker before redemption');
  const m = await mint({ 'x-kosmos-board-token': TOK });
  const r = await nav(`/?first-run=1&boot=${m.nonce}`);
  assert.equal(r.code, 302, 'precondition: the boot nonce redeemed');
  assert.equal(fs.existsSync(marker), true, 'a ?boot= redemption must seed the reauth marker (the #2023 repair signal, moved here from setup.sh dispatch)');

  // A ?token= bootstrap sets the SAME cookie but is not a redemption -> must NOT
  // seed, or a durable-token bookmark would mark a machine done without proving its
  // browser navigated (the exact false-done #2030 removes).
  clean();
  const t = await nav(`/?token=${TOK}`);
  assert.equal(t.code, 302, 'precondition: the ?token= bootstrapped');
  assert.equal(fs.existsSync(marker), false, 'a ?token= bootstrap must NOT seed the marker -- only a real redemption does');

  // A failed/garbage boot never navigated, so it must not seed (the self-healing
  // property: an un-redeemed machine stays unseeded and retries next update).
  clean();
  await nav('/?boot=not-a-real-nonce');
  assert.equal(fs.existsSync(marker), false, 'a garbage boot must not seed the marker');
  clean();
});

test('the durable ?token= path still works (back-compat for a bookmarked/manual URL)', async () => {
  const r = await nav(`/?token=${TOK}`);
  assert.equal(r.code, 302, 'a valid ?token= must still bootstrap');
  assert.match(r.setCookie || '', /kosmos_board=/);
});

test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
