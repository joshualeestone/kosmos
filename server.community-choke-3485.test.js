'use strict';
/*
 * #3485: the community feed board->feed submit routes (POST /api/community/post
 * and /api/community/comment) -- the AGENT/BOARD caller of the engine/feedpublish.js
 * choke. The choke's disposition logic is unit-tested in engine/feedpublish.test.js;
 * these tests cover the HTTP contract that the ROUTE owns:
 *   - identity is AUTHENTICATED by the agent token (resolveAgentSender), never taken
 *     from a body.agent field -- so a caller cannot post as an already-trusted persona
 *   - no agent token -> 403; a clean post is held/published by the AUTHENTICATED
 *     agent's ladder; a leak quarantines; a malformed candidate is a clean 400
 *   - findings are NOT echoed to the submitter (an evasion oracle)
 * A fresh test board is non-enforcing, so the board-token sensitive-gate lets the
 * fetches through; the agent-token auth is what these tests exercise.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const cs = require('./engine/communitystore');

test.before(async () => { await start(0); });
// Close the server after the run so the process exits (and node --test flushes its
// buffered output) rather than hanging on the open listener.
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

function base() { return `http://127.0.0.1:${server.address().port}`; }
function board(t) {
  const b = fleet.install([
    fleet.agent('RouteAgent', { state: 'idle' }),
    fleet.agent('OtherAgent', { state: 'idle' }),
    fleet.agent('Sneaky', { state: 'idle' }), // never granted trust -- for the spoof test
  ]);
  t.after(() => b.restore());
  return b;
}
function post(path_, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-agent-token'] = token;
  return fetch(`${base()}${path_}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
function cleanPost(overrides = {}) {
  return { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T00:00:00Z', body: 'hello from the route', ...overrides };
}
const LEAK_BODY = 'contact Josh Stone directly';

test('no agent token -> 403 (posting requires an authenticated agent)', async (t) => {
  board(t);
  const r = await post('/api/community/post', cleanPost());
  assert.equal(r.status, 403);
});

test('a clean post from an UNTRUSTED authenticated agent is HELD (not served)', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', cleanPost(), tok);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'held');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), false);
  assert.equal(j.findings, undefined, 'findings must NOT be echoed to the submitter');
});

test('a clean post from a TRUSTED authenticated agent is PUBLISHED', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', cleanPost(), tok);
  const j = await r.json();
  assert.equal(j.status, 'published');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), true);
});

test('SPOOF CLOSED: a caller cannot publish as another trusted persona by claiming body.agent', async (t) => {
  board(t);
  cs.grantTrust('OtherAgent'); // a promoted persona the caller is NOT
  const tok = sendertoken.mint('Sneaky').token; // authenticated as the never-trusted Sneaky
  const r = await post('/api/community/post', cleanPost({ agent: 'OtherAgent' }), tok); // claims to be OtherAgent
  const j = await r.json();
  assert.equal(j.status, 'held', 'a claimed trusted persona must not publish; trust is the authenticated agent\'s');
  const stored = cs.moderationQueue().find((p) => p.id === j.id);
  assert.equal(stored.author.name, 'Sneaky', 'the post is attributed to the AUTHENTICATED agent, not the claimed one');
});

test('a LEAK quarantines even from a trusted authenticated agent (submitter sees only held, not the oracle)', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', cleanPost({ body: LEAK_BODY }), tok);
  const j = await r.json();
  assert.equal(r.status, 200);
  // The submitter must NOT be told 'quarantined' (a scrubber oracle) -- collapsed to held.
  assert.equal(j.status, 'held', 'the quarantined disposition must be collapsed to held for the submitter');
  assert.notEqual(j.status, 'quarantined');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), false, 'the leak is not served');
  // The REAL status is quarantined in the store, for the moderator surface.
  const stored = cs.moderationQueue().find((p) => p.id === j.id);
  assert.equal(stored.status, 'quarantined', 'the store keeps the true quarantined status for moderators');
});

test('a malformed candidate is a clean 400 (with a valid token)', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', { body: '' }, tok);
  assert.equal(r.status, 400);
});

test('a comment from an authenticated agent on a published post', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const parent = await (await post('/api/community/post', cleanPost(), tok)).json();
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T01:00:00Z', body: 'good point', postId: parent.id }, tok);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'published');
  assert.equal(cs.getComments(parent.id).some((c) => c.id === j.id), true);
});

test('a comment on a nonexistent post is a clean 400, never a 500', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T02:00:00Z', body: 'orphan', postId: 'no-such-post' }, tok);
  assert.equal(r.status, 400);
});

test('SPOOF CLOSED on the comment route too: attribution is the authenticated agent', async (t) => {
  board(t);
  cs.grantTrust('OtherAgent');
  const ptok = sendertoken.mint('RouteAgent').token;
  cs.grantTrust('RouteAgent');
  const parent = await (await post('/api/community/post', cleanPost(), ptok)).json();
  const stok = sendertoken.mint('Sneaky').token; // authenticated as never-trusted Sneaky
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'OtherAgent', at: '2026-09-23T04:00:00Z', body: 'sneaky comment', postId: parent.id }, stok);
  const j = await r.json();
  assert.equal(j.status, 'held', 'an untrusted authenticated commenter claiming a trusted persona must be held');
  const stored = cs.moderationQueue().find((c) => c.id === j.id);
  assert.equal(stored.author.name, 'Sneaky', 'the comment is attributed to the AUTHENTICATED agent, not the claimed one');
});

test('a leak comment collapses quarantined -> held for the submitter (no oracle)', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const parent = await (await post('/api/community/post', cleanPost(), tok)).json();
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T05:00:00Z', body: LEAK_BODY, postId: parent.id }, tok);
  const j = await r.json();
  assert.equal(j.status, 'held', 'the submitter must not be told quarantined');
  const stored = cs.moderationQueue().find((c) => c.id === j.id);
  assert.equal(stored.status, 'quarantined', 'the store keeps the true quarantined status');
});
