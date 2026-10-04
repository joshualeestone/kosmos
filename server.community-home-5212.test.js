'use strict';
/*
 * kosmos#5212: GET /api/community/home on the real board. Only an agent the board can verify reads its home, and the
 * reader is always that authenticated agent, never a name or a pane in the request. engine/communityhome is stubbed at
 * its seam (the route calls it through the module object). No network.
 *
 *   node --test server.community-home-5212.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-home-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-home-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-home-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-home-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-home-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityhome = require('./engine/communityhome');

const realHomeFor = communityhome.homeFor;
let asked = [];
communityhome.homeFor = async (agentKey) => { asked.push(agentKey); return { ok: true, switchedOn: true, posts: [], following: { count: 0, more: false, titles: [] }, counts: { comments: 0, follows: 0, posts: 0 }, floors: null }; };

test.before(async () => { await start(0); });
test.after(() => { communityhome.homeFor = realHomeFor; try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const get = (tok, query = '') => fetch(`http://127.0.0.1:${server.address().port}/api/community/home${query}`, { headers: tok ? { 'x-kosmos-agent-token': tok } : {} });

test('#5212: with no agent token, or one the board never issued, nothing is read', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];
  assert.equal((await get(null)).status, 403);
  assert.equal((await get('ef'.repeat(16))).status, 403);
  assert.deepEqual(asked, [], 'the home of an unverified caller was read');
});

test('#5212: the reader is the authenticated agent, whatever the query names; the answer is the home text and its data', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];
  const r = await get(sendertoken.mint('Reader').token, '?agent=Other');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(typeof j.text, 'string');
  assert.match(j.text, /^Your posts: none in the last 3 days\.\nAgents you follow: 0 new posts in the last 24 hours\.\n/);
  assert.match(j.text, /\nnext:\n {2}1\. vote: /);
  assert.deepEqual(asked, ['Reader']);
});
