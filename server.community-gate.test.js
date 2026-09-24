'use strict';
/**
 * #3485: the Kosmos Community feed's PUBLIC-vs-GATED split, wired into the real
 * request dispatch.
 *
 * The pure read/moderation logic is pinned in engine/communitysite.test.js. This
 * file proves the SERVER actually exempts the public community READ routes from
 * the board-token gate (browse with no account, per #3485) while keeping the
 * moderation + release routes gated — the security boundary that matters. It
 * mirrors server.board-auth-1946.test.js: boot fully sandboxed (so requiring
 * server.js writes nothing real), flip enforcement on in memory via the exported
 * boardAuthState, and drive real HTTP over a real socket, with negative CONTROLs.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-gate-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server, boardAuthState } = require('./server');

const TOK = 'BOARDTOKEN_test_community_0123456789';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // Booted fully-sandboxed, so enforcement is OFF. Confirm (the zero-churn
  // property), then flip it on for the rest of this file.
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
});

async function hit(p, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(base + p, { method, headers, redirect: 'manual' });
  await res.text().catch(() => {});
  return res.status;
}

// ── Positive: the public READ routes are served on an enforcing board WITHOUT a token.
test('#3485: GET /api/community/feed is PUBLIC (served without a board token)', async () => {
  assert.notEqual(await hit('/api/community/feed'), 403,
    'the community feed must be browsable with no account (open/public per #3485)');
});

test('#3485: GET /api/community/comments is PUBLIC (served without a board token)', async () => {
  assert.notEqual(await hit('/api/community/comments?postId=none'), 403,
    'reading a post comment thread must not require an account');
});

// ── Negative CONTROLs: the moderation surface STAYS gated (it exposes
//    held/quarantined content + findings), so a tokenless request is refused.
test('#3485 CONTROL: GET /api/community/moderation STAYS gated (403 without a token)', async () => {
  assert.equal(await hit('/api/community/moderation'), 403,
    'the moderation queue exposes held/quarantined content + findings; it must require the board token');
});

test('#3485 CONTROL: POST /api/community/release STAYS gated (403 without a token)', async () => {
  assert.equal(await hit('/api/community/release', { method: 'POST' }), 403,
    'releasing a held row is a moderator action; it must require the board token');
});

// ── With the token, the gated moderation route is reachable (not 403).
test('#3485: the moderation route is reachable WITH the board token', async () => {
  assert.notEqual(await hit('/api/community/moderation', { headers: { 'x-kosmos-board-token': TOK } }), 403,
    'a valid board token reaches the moderation surface');
});
