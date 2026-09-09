'use strict';
/**
 * kosmos#2509: board.token must be resolvable across the #2439 store-leaf rename
 * (AgentWorkforce -> Kosmos). A `kosmos` CLI bundle predating #2439 resolves the OLD
 * leaf; the migration moved board.token out from under it, so it presented no token
 * and #1976's enforcing report route refused it -> self-report + liveness froze.
 *
 * boardauth now mirrors the token to the legacy leaf (when that dir exists) and
 * readToken falls back to it, so a caller on EITHER leaf finds the SAME token.
 *
 * 🛑 RED-CAPABLE, #1968 stays closed: the mirror MUST be mode 0o600 (owner-only), or
 * a second account could read it -- which would reopen exactly the cross-account
 * boundary #1968 protects. The mode assertion below fails if the mirror is written
 * world/group-readable. (The report-route token-less refusal itself is unchanged by
 * this fix and is proven end-to-end by server.report-reply-loopback-1968.test.js.)
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

test('#2509 mirror: with the legacy dir present, ensureToken writes board.token to BOTH leaves, same value, mode 0600', () => {
  const p = freshData();
  fs.mkdirSync(p.legacy, { recursive: true, mode: 0o700 });   // a box with a pre-#2439 CLI bundle
  const token = boardauth.ensureToken();
  assert.ok(token && /^[0-9a-f]+$/.test(token), 'ensureToken should return a hex token');
  const primary = path.join(p.kosmos, 'board.token');
  const mirror = path.join(p.legacy, 'board.token');
  assert.ok(fs.existsSync(primary), 'the primary board.token (Kosmos leaf) was not written');
  assert.ok(fs.existsSync(mirror), 'board.token was not mirrored to the legacy (AgentWorkforce) leaf');
  assert.equal(fs.readFileSync(mirror, 'utf8').trim(), token, 'the mirror does not match the primary token');
  // RED-CAPABLE: owner-only, or #1968's cross-account boundary is reopened on the copy.
  assert.equal(fs.statSync(mirror).mode & 0o777, 0o600, 'the mirrored board.token is not mode 0600 (a second account could read it)');
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

test('#2509 primary wins: when both leaves have a token, readToken prefers the current leaf and ensureToken re-syncs the mirror', () => {
  const p = freshData();
  fs.mkdirSync(p.kosmos, { recursive: true, mode: 0o700 });
  fs.mkdirSync(p.legacy, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(p.kosmos, 'board.token'), 'aaaa1111', { mode: 0o600 });
  fs.writeFileSync(path.join(p.legacy, 'board.token'), 'bbbb2222', { mode: 0o600 });   // a STALE legacy copy
  assert.equal(boardauth.readToken(), 'aaaa1111', 'readToken must prefer the current leaf when both exist');
  const token = boardauth.ensureToken();
  assert.equal(token, 'aaaa1111', 'ensureToken should adopt the existing current-leaf token');
  assert.equal(fs.readFileSync(path.join(p.legacy, 'board.token'), 'utf8').trim(), 'aaaa1111',
    'the mirror was not re-synced to the authoritative current-leaf token');
});
