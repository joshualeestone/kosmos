'use strict';
/*
 * kosmos#4373 part B: POST /api/community/service-comment on the real board. Only an agent the board can verify
 * comments (as only one can post); the comment is attributed to that agent, never to a name in the body; it is held
 * by default; and it names the SERVICE's post (the id `kosmos community read` shows), never a local one.
 *
 *   node --test server.community-comment-4373.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-comment-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-comment-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-comment-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-comment-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-comment-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communitystore = require('./engine/communitystore');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const SERVICE_POST = '1b2c3d4e-0000-4000-8000-000000000001';
const commentAs = (tok, body) => fetch(`http://127.0.0.1:${server.address().port}/api/community/service-comment`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { 'x-kosmos-agent-token': tok } : {}) },
  body: JSON.stringify(body),
});
const good = (extra = {}) => ({ kind: 'community_post', servicePostId: SERVICE_POST, body: 'Tuesdays work for us too.', at: new Date().toISOString(), ...extra });
const rows = () => JSON.parse(fs.readFileSync(communitystore._paths.commentsFile(), 'utf8'));

test('#4373 B: the store is this test\'s sandbox', () => {
  assert.ok(communitystore._paths.commentsFile().startsWith(SANDBOX + path.sep));
});

test('#4373 B: with no agent token, or one the board never issued, nothing is stored', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  assert.equal((await commentAs(null, good())).status, 403);
  assert.equal((await commentAs('ef'.repeat(16), good())).status, 403);
  assert.ok(!fs.existsSync(communitystore._paths.commentsFile()) || rows().length === 0, 'an unverified agent stored a comment');
});

test('#4373 B: a verified agent\'s comment is held, attributed to it (not to the body\'s name), on the service post', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  const r = await commentAs(sendertoken.mint('Writer').token, good({ agent: 'Somebody Else' }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['id', 'ok', 'status']);
  assert.equal(j.status, 'held', 'a new agent\'s comment must be held for its person');
  const row = rows().find((x) => x.id === j.id);
  assert.equal(row.agent, 'Writer');
  assert.equal(row.author.name, 'Writer');
  assert.equal(row.remotePostId, SERVICE_POST);
  assert.equal(row.postId, null, 'a service comment must not name a local post');
});

test('#4373 B: a local post id is not a service post id, and a bad id or an over-long comment is refused plainly', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Writer').token;
  for (const extra of [{ servicePostId: 'general' }, { servicePostId: undefined, postId: SERVICE_POST }, { body: 'x'.repeat(2001) }]) {
    const r = await commentAs(tok, good(extra));
    assert.equal(r.status, 400, JSON.stringify(extra));
    const j = await r.json();
    assert.equal(typeof j.error, 'string');
  }
});
