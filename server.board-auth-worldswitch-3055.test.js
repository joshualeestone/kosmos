'use strict';

/**
 * #3055: the SWITCH-BACK board-token fix, wired into the real request dispatch.
 *
 * The board token is PER-WORLD. On a switch the board self-restarts (#2346) into
 * the new world and enforces the NEW world's token, but the browser still holds the
 * world it LEFT in its cookie -- so the switched-to board 403s the browser on every
 * sensitive route (GET /api/worlds, POST /api/worlds/active), locking the user out
 * of switching back. A relaxes the browser dispatch gate to accept ANY of THIS
 * account's world board tokens as proof of same-account ownership (#1946), not only
 * the active world's.
 *
 * This proves the SERVER dispatch actually accepts the other-world token (positive),
 * refuses a FOREIGN-account world token and random garbage (negative), and still
 * refuses a tokenless request (the dangerous answer). It boots FULLY SANDBOXED (so
 * requiring server.js writes nothing to a real store), then flips enforcement on in
 * memory and lays down a worlds registry + per-world token files under the sandbox,
 * exactly as engine.boardauth-1946.test.js's sibling does.
 *
 * THE LOAD-BEARING CONTROL (Splinter, #3055): the FOREIGN token file physically
 * EXISTS on disk, but under a base this account's registry never lists -- so its
 * REJECTION proves the enumeration is registry-bounded (worlds.listWorlds(worldBase))
 * and not a naive recursive scan, i.e. the relaxation did not widen past the account
 * boundary. #1946's cross-account isolation holds: the code changes no file
 * permissions and reads only THIS account's worlds.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldswitch-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const worlds = require('./engine/worlds');

// The ACTIVE (booted) world's token, the world it LEFT (a second registered world),
// and a token from a DIFFERENT account's world (a file on disk this account's
// registry never lists). All distinct.
const ACTIVE_TOK = 'ACTIVE_world_token_0123456789abcdef';
const OTHER_TOK = 'OTHER_world_token_0123456789abcdef0';
const FOREIGN_TOK = 'FOREIGN_acct_token_0123456789abcdef';

let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const storeBase = worlds.baseRoot(process.env); // == worldBase() capture: SANDBOX/data/Kosmos
  const DEFAULT_W = { id: 'default', name: 'Kosmos 1', createdAt: null, base: null };
  const LEFT_W = { id: 'wleft', name: 'Left World', createdAt: new Date().toISOString(), base: null };

  // This account's registry: the ACTIVE/booted world (default) + the world it left.
  fs.mkdirSync(storeBase, { recursive: true });
  fs.writeFileSync(worlds.registryPath(storeBase),
    JSON.stringify({ version: 1, activeWorldId: DEFAULT_W.id, worlds: [DEFAULT_W, LEFT_W] }));

  // Per-world board.token files, each at that world's OWN store root -- exactly the
  // shape the real board writes.
  const activeRoot = worlds.worldStoreRoot(storeBase, DEFAULT_W); // == storeBase
  const leftRoot = worlds.worldStoreRoot(storeBase, LEFT_W);      // storeBase/worlds/wleft/Kosmos
  fs.mkdirSync(activeRoot, { recursive: true });
  fs.mkdirSync(leftRoot, { recursive: true });
  fs.writeFileSync(path.join(activeRoot, 'board.token'), ACTIVE_TOK);
  fs.writeFileSync(path.join(leftRoot, 'board.token'), OTHER_TOK);

  // A FOREIGN account's world token: a real board.token file on disk, under a base
  // this account's registry NEVER lists. A registry-bounded enumeration never reads
  // it; a naive recursive scan of SANDBOX WOULD -> its rejection is the red-capable
  // proof the enumeration stayed inside the account boundary.
  const foreignRoot = path.join(SANDBOX, 'foreign-account', 'Kosmos');
  fs.mkdirSync(foreignRoot, { recursive: true });
  fs.writeFileSync(path.join(foreignRoot, 'board.token'), FOREIGN_TOK);

  // The board booted fully-sandboxed, so enforcement is OFF. Confirm (the zero-churn
  // property) then flip it on with the ACTIVE world's token, as the real board does.
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = ACTIVE_TOK;
});

async function hit(p, { headers = {}, method = 'GET' } = {}) {
  const res = await fetch(base + p, { method, headers, redirect: 'manual' });
  await res.text().catch(() => {});
  return { code: res.status, loc: res.headers.get('location') };
}

test('DANGEROUS answer: an enforcing board still REFUSES a tokenless request', async () => {
  assert.equal((await hit('/api/status')).code, 403);
});

test('the ACTIVE world token still PROCEEDS (fast in-memory path unchanged)', async () => {
  assert.notEqual((await hit('/api/status', { headers: { 'x-kosmos-board-token': ACTIVE_TOK } })).code, 403);
});

test('#3055 POSITIVE: the world the browser LEFT (another of THIS account\'s worlds) is ACCEPTED', async () => {
  // The exact lockout shape: a header token and a cookie token, each the token of a
  // DIFFERENT (registered) world than the active one. Both must proceed -- this is
  // what lets the switch-back go through.
  assert.notEqual((await hit('/api/status', { headers: { 'x-kosmos-board-token': OTHER_TOK } })).code, 403,
    'the other-world token (header) must be accepted');
  assert.notEqual((await hit('/api/status', { headers: { cookie: `kosmos_board=${OTHER_TOK}` } })).code, 403,
    'the other-world token (cookie -- the real post-switch shape) must be accepted');
});

test('#3055 POSITIVE on a WRITE method (POST /api/worlds/active is a mutation): other-world token admitted past the gate', async () => {
  // A POST /api/* is sensitive (write method); with the other-world token it must
  // clear the board-token gate (a 404/other is fine -- anything but the 403 the
  // lockout produced).
  assert.notEqual((await hit('/api/does-not-exist', { method: 'POST', headers: { 'x-kosmos-board-token': OTHER_TOK } })).code, 403);
});

test('CROSS-ACCOUNT (#1946): a FOREIGN account\'s world token -- a real file on disk, NOT in this account\'s registry -- is REJECTED', async () => {
  // The load-bearing security arm. The token file exists under SANDBOX/foreign-account,
  // so a naive "scan every board.token" implementation would accept it; the
  // registry-bounded enumeration does not list it -> 403. This is what proves the
  // relaxation did not widen past the account boundary.
  assert.equal((await hit('/api/status', { headers: { 'x-kosmos-board-token': FOREIGN_TOK } })).code, 403,
    'a token from a world outside this account\'s registry must be refused');
  assert.equal((await hit('/api/status', { headers: { cookie: `kosmos_board=${FOREIGN_TOK}` } })).code, 403);
});

test('NEGATIVE: random garbage is REFUSED', async () => {
  assert.equal((await hit('/api/status', { headers: { 'x-kosmos-board-token': 'totally-random-nonsense' } })).code, 403);
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
