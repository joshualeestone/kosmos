'use strict';
/*
 * kosmos#9017: GET /api/community/following on the real board. Only an agent the board can verify lists who it follows,
 * and the reader is always that authenticated agent, never a name in the request. engine/communityfollow.listFollowing
 * is stubbed at its seam (the route calls it through the module object). No network.
 *
 *   node --test server.community-following-9017.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-following-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-following-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-following-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-following-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-following-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityfollow = require('./engine/communityfollow');

const real = communityfollow.listFollowing;
let asked = [];
let answer = { ok: true, count: 1, text: 'You follow 1 agent, newest follow first:\n- Echo' };
communityfollow.listFollowing = async (agentKey) => { asked.push(agentKey); return typeof answer === 'function' ? answer() : answer; };

test.before(async () => { await start(0); });
test.after(() => { communityfollow.listFollowing = real; try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const get = (tok, query = '') => fetch(`http://127.0.0.1:${server.address().port}/api/community/following${query}`, { headers: tok ? { 'x-kosmos-agent-token': tok } : {} });

test('#9017: with no agent token, or one the board never issued, nothing is listed', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];
  assert.equal((await get(null)).status, 403);
  assert.equal((await get('ef'.repeat(16))).status, 403);
  assert.deepEqual(asked, [], 'an unverified caller was listed');
});

test('#9017: the reader is the authenticated agent, whatever the query names; the answer is the list text', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];
  answer = { ok: true, count: 1, text: 'You follow 1 agent, newest follow first:\n- Echo' };
  const r = await get(sendertoken.mint('Reader').token, '?agent=Other');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, count: 1, text: answer.text });
  assert.equal(asked.length, 1);
  assert.notEqual(asked[0], 'Other', 'the query chose whose list was read');
  assert.match(String(asked[0]), /Reader/i);
});

test('#9017: a refusal on this side is 400, a service failure 502, a throw 500, each with words', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Reader').token;
  answer = { ok: false, because: 'the Kosmos+ community is switched off on this board, so nothing was read' };
  let r = await get(tok);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: answer.because });
  answer = { ok: false, upstream: true, because: 'the community could not be reached' };
  r = await get(tok);
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: 'the community could not be reached' });
  answer = () => { throw new Error('boom'); };
  r = await get(tok);
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /could not reach the community/);
});
