'use strict';
/*
 * #3485: the community feed board->feed submit routes (POST /api/community/post
 * and /api/community/comment). These are the agent/board caller of the
 * engine/feedpublish.js choke; the choke's disposition logic is unit-tested in
 * engine/feedpublish.test.js, so these tests cover the HTTP plumbing: a candidate
 * routes through feedpublish (never straight into the store), the disposition is
 * returned, a leak quarantines, and a malformed candidate is a clean 400.
 * A fresh test board is non-enforcing, so the sensitive-route gate lets the
 * fetches through without a board token (same as the other server route tests).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-launch-'));

const { start, server } = require('./server');
const cs = require('./engine/communitystore');

async function boot(t) {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
function post(base, path_, body) {
  return fetch(`${base}${path_}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function cleanPost(overrides = {}) {
  return { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T00:00:00Z', body: 'hello from the route', ...overrides };
}
const LEAK_BODY = 'contact Josh Stone directly';

test('POST /api/community/post routes a clean UNTRUSTED post to HELD (not served)', async (t) => {
  const base = await boot(t);
  const r = await post(base, '/api/community/post', cleanPost({ agent: 'HeldAgent' }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, 'held');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), false, 'a held post must not be served');
});

test('POST /api/community/post publishes a clean TRUSTED post', async (t) => {
  const base = await boot(t);
  cs.grantTrust('RouteAgent');
  const r = await post(base, '/api/community/post', cleanPost({ agent: 'RouteAgent' }));
  const j = await r.json();
  assert.equal(j.status, 'published');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), true);
});

test('POST /api/community/post QUARANTINES a leak even from a trusted agent', async (t) => {
  const base = await boot(t);
  cs.grantTrust('RouteAgent');
  const r = await post(base, '/api/community/post', cleanPost({ agent: 'RouteAgent', body: LEAK_BODY }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'quarantined', 'a leak must not publish through the route');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), false);
});

test('POST /api/community/post rejects a malformed candidate with a clean 400', async (t) => {
  const base = await boot(t);
  const r = await post(base, '/api/community/post', { body: '' }); // missing required kind/agent/at + empty body
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.error && typeof j.error, 'string');
});

test('POST /api/community/comment routes a clean comment on a published post', async (t) => {
  const base = await boot(t);
  cs.grantTrust('RouteAgent');
  const parent = await (await post(base, '/api/community/post', cleanPost({ agent: 'RouteAgent' }))).json();
  const r = await post(base, '/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T01:00:00Z', body: 'good point', postId: parent.id });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'published');
  assert.equal(cs.getComments(parent.id).some((c) => c.id === j.id), true);
});

test('POST /api/community/comment on a nonexistent post is a clean 400, never a 500', async (t) => {
  const base = await boot(t);
  const r = await post(base, '/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T02:00:00Z', body: 'orphan', postId: 'no-such-post' });
  assert.equal(r.status, 400);
});
