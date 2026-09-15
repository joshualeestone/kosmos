'use strict';
/**
 * kosmos#2509: board.token must be resolvable across the #2439 store-leaf rename
 * (AgentWorkforce -> Kosmos). A `kosmos` CLI bundle predating #2439 resolves the OLD
 * leaf; the migration moved board.token out from under it, so it presented no token
 * and #1976's enforcing report route refused it -> self-report + liveness froze.
 *
 * #2511: the WRITE-back mirror (mirrorTokenToLegacy) is now REMOVED -- the durable fix
 * shipped (installed bundles resolve the post-#2439 store natively) and the fleet is
 * confirmed all post-#2439. What STAYS, and is guarded here: readToken FALLS BACK to
 * the legacy leaf, ensureToken BACKFILLS a legacy-only token to the current leaf, and
 * neither ever CREATES or WRITES the deprecated leaf.
 *
 * 🛑 RED-CAPABLE against a mirror regression: the no-write-mirror and no-write-back
 * tests below assert the legacy leaf is never written; if mirrorTokenToLegacy is ever
 * re-added, a live token would appear/change on the legacy leaf and they fail. (The
 * report-route token-less refusal is unchanged and is proven end-to-end by
 * server.report-reply-loopback-1968.test.js.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Disable the auto-migration so each test controls the two leaves independently
// (otherwise the first store.ROOT access would rename legacy -> new).
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';

const store = require('./engine/store');
const boardauth = require('./engine/boardauth');

const ROOTS = [];
function freshData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-2509-'));
  ROOTS.push(dir);
  process.env.AGENT_WORKFORCE_DATA = path.join(dir, 'data');
  return {
    data: process.env.AGENT_WORKFORCE_DATA,
    kosmos: path.join(process.env.AGENT_WORKFORCE_DATA, store.APP),          // current leaf
    legacy: path.join(process.env.AGENT_WORKFORCE_DATA, store.LEGACY_APP),   // AgentWorkforce
  };
}
test.after(() => {
  delete process.env.AGENT_WORKFORCE_DATA;
  for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

test('#2511 no-write-mirror: with the legacy dir present, ensureToken writes the primary but does NOT write board.token into the legacy leaf', () => {
  const p = freshData();
  fs.mkdirSync(p.legacy, { recursive: true, mode: 0o700 });   // a box with a pre-#2439 CLI bundle
  const token = boardauth.ensureToken();
  assert.ok(token && /^[0-9a-f]+$/.test(token), 'ensureToken should return a hex token');
  assert.ok(fs.existsSync(path.join(p.kosmos, 'board.token')), 'the primary board.token (Kosmos leaf) was not written');
  // #2511: the WRITE-back mirror is removed. Even with the legacy dir present,
  // ensureToken must NOT write a live token into the deprecated leaf. RED-CAPABLE:
  // re-adding mirrorTokenToLegacy makes this file appear and this fails.
  assert.equal(fs.existsSync(path.join(p.legacy, 'board.token')), false,
    'a live token was written into the deprecated legacy leaf (the #2511-removed WRITE mirror is back)');
});

test('#2509 no-resurrect: with NO legacy dir, ensureToken does not create the deprecated leaf', () => {
  const p = freshData();
  // Only the current leaf will be created by ensureToken; the legacy dir must stay absent.
  const token = boardauth.ensureToken();
  assert.ok(token, 'ensureToken should still produce a token');
  assert.ok(fs.existsSync(path.join(p.kosmos, 'board.token')), 'the primary token was not written');
  assert.equal(fs.existsSync(p.legacy), false, 'the deprecated AgentWorkforce leaf was resurrected on a clean install');
});

test('#2509 read fallback: readToken returns the token when it lives ONLY on the legacy leaf', () => {
  const p = freshData();
  // A caller whose only copy is on the old leaf (the migration window): no primary, a legacy token.
  fs.mkdirSync(p.legacy, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(p.legacy, 'board.token'), 'deadbeefcafe0001', { mode: 0o600 });
  assert.equal(fs.existsSync(path.join(p.kosmos, 'board.token')), false, 'the primary leaf should have no token for this arm');
  assert.equal(boardauth.readToken(), 'deadbeefcafe0001', 'readToken did not fall back to the legacy leaf');
});

test('#2509 backfill: a legacy-only token is written to the authoritative current leaf, so it survives the legacy leaf being removed', () => {
  const p = freshData();
  // The token exists ONLY on the legacy leaf (primary absent) -- the migration
  // window / a pre-#2439 board. ensureToken must adopt it AND backfill the current leaf.
  fs.mkdirSync(p.legacy, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(p.legacy, 'board.token'), 'legacyonly0007', { mode: 0o600 });
  assert.equal(fs.existsSync(path.join(p.kosmos, 'board.token')), false, 'the current leaf should start empty for this arm');
  const token = boardauth.ensureToken();
  assert.equal(token, 'legacyonly0007', 'ensureToken should adopt the legacy-only token, not mint a new one');
  const primary = path.join(p.kosmos, 'board.token');
  assert.ok(fs.existsSync(primary), 'the legacy-only token was not backfilled to the authoritative current leaf');
  assert.equal(fs.readFileSync(primary, 'utf8').trim(), 'legacyonly0007', 'the backfilled current-leaf token does not match');
  assert.equal(fs.statSync(primary).mode & 0o777, 0o600, 'the backfilled token is not mode 0600');
});

test('#2511 primary wins, no write-back: with both leaves set, readToken prefers the current leaf and ensureToken leaves the stale legacy copy UNTOUCHED', () => {
  const p = freshData();
  fs.mkdirSync(p.kosmos, { recursive: true, mode: 0o700 });
  fs.mkdirSync(p.legacy, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(p.kosmos, 'board.token'), 'aaaa1111', { mode: 0o600 });
  fs.writeFileSync(path.join(p.legacy, 'board.token'), 'bbbb2222', { mode: 0o600 });   // a STALE legacy copy
  assert.equal(boardauth.readToken(), 'aaaa1111', 'readToken must prefer the current leaf when both exist');
  const token = boardauth.ensureToken();
  assert.equal(token, 'aaaa1111', 'ensureToken should adopt the existing current-leaf token');
  // #2511 RED-CAPABLE: the WRITE mirror is gone, so ensureToken must NOT re-sync the
  // legacy leaf to the current token. The stale legacy copy stays exactly as it was.
  assert.equal(fs.readFileSync(path.join(p.legacy, 'board.token'), 'utf8').trim(), 'bbbb2222',
    'the legacy leaf was written back to (the #2511-removed WRITE mirror is still firing)');
});
