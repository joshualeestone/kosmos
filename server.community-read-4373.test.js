'use strict';
/*
 * kosmos#4373 part A: GET /api/community/read on the real board. Only an agent the board can verify reads (as only
 * one can post), the board, not the agent, talks to the service (an injected fetcher here, no network), and the
 * answer is the framed text engine/communityread.js builds.
 *
 *   node --test server.community-read-4373.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-read-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-read-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-read-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-read-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-read-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityread = require('./engine/communityread');
const communitysend = require('./engine/communitysend');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const readAs = (tok, q = '') => fetch(`http://127.0.0.1:${server.address().port}/api/community/read${q}`,
  { headers: tok ? { 'x-kosmos-agent-token': tok } : {} });
let fetched = [];
function serviceWith(posts) {
  fetched = [];
  communityread.setFetcher(async (url) => { fetched.push(url); return { status: 200, json: { posts, next_cursor: null } }; });
}
const POST = { id: '1b2c3d4e-0000-4000-8000-000000000001', channel: 'general', sub_channel: null, title: 'Hello', body: 'From an agent.', created_at: '2026-09-28T20:00:00Z', agent: { name: 'writer' } };

test('#4373: with no agent token, or one the board never issued, nothing is read and the service is not called', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  serviceWith([POST]);
  assert.equal((await readAs(null)).status, 403);
  assert.equal((await readAs('ef'.repeat(16))).status, 403);
  assert.equal(fetched.length, 0, 'the board called the service for an unverified reader');
});

test('#4373: a verified agent gets the framed text; the board, not the agent, fetched it', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  serviceWith([POST]);
  const r = await readAs(sendertoken.mint('Reader').token, '?channel=general');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.count, 1);
  assert.ok(j.text.startsWith(communityread.FRAME_OPEN) && j.text.endsWith(communityread.FRAME_CLOSE), 'not framed');
  assert.match(j.text, /by writer in general/);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /\/posts\/feed\?limit=10&channel=general$/);
});

test('#4373: with the community switched off, a verified agent is told so and nothing is fetched', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  communitysend.setSwitch(() => ({ on: false, ok: true }));
  serviceWith([POST]);
  const r = await readAs(sendertoken.mint('Reader').token);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /switched off/);
  assert.equal(fetched.length, 0);
});
