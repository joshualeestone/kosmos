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
const realFollow = communityfollow.follow;
communityfollow.follow = async () => ({ ok: true, text: 'You now follow quill.' });

const real = communityfollow.listFollowing;
let asked = [];
let answer = { ok: true, count: 1, text: 'You follow 1 agent, newest follow first:\n- Echo' };
communityfollow.listFollowing = async (agentKey) => { asked.push(agentKey); return typeof answer === 'function' ? answer() : answer; };

test.before(async () => { await start(0); });
test.after(() => { communityfollow.listFollowing = real; communityfollow.follow = realFollow; try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

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
  const b = fleet.install([fleet.agent('Refused', { state: 'idle' }), fleet.agent('Upstream', { state: 'idle' }), fleet.agent('Thrower', { state: 'idle' })]);
  t.after(() => b.restore());
  // One agent per case: a failure is kept a few seconds (FOLLOWING_ROUTE_FAIL_MS), so one agent would see the first.
  answer = { ok: false, because: 'the Kosmos+ community is switched off on this board, so nothing was read' };
  let r = await get(sendertoken.mint('Refused').token);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: answer.because });
  answer = { ok: false, upstream: true, because: 'the community could not be reached' };
  r = await get(sendertoken.mint('Upstream').token);
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: 'the community could not be reached' });
  answer = () => { throw new Error('boom'); };
  r = await get(sendertoken.mint('Thrower').token);
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /could not reach the community/);
});

test('#9017 review 1: a good answer is reused for a while, one read per agent, so a loop does not spend the community\'s limit', async (t) => {
  const b = fleet.install([fleet.agent('Looper', { state: 'idle' }), fleet.agent('Second', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];
  answer = { ok: true, count: 0, text: 'You follow no agents yet. Follow one with: kosmos community follow <name>' };
  const tok = sendertoken.mint('Looper').token;
  const [a, c] = await Promise.all([get(tok), get(tok)]);
  assert.equal(a.status, 200); assert.equal(c.status, 200);
  assert.equal((await get(tok)).status, 200);
  assert.equal(asked.length, 1, 'each call read the community again');
  // Control: another agent is its own read.
  assert.equal((await get(sendertoken.mint('Second').token)).status, 200);
  assert.equal(asked.length, 2, 'one agent\'s answer was given to another');
});

test('#9017 review 2: a follow clears the kept list, so the next read sees it; a failure is not kept for 30 s', async (t) => {
  const b = fleet.install([fleet.agent('Follower', { state: 'idle' }), fleet.agent('Failing', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];
  answer = { ok: true, count: 0, text: 'You follow no agents yet. Follow one with: kosmos community follow <name>' };
  const tok = sendertoken.mint('Follower').token;
  await get(tok); await get(tok);
  assert.equal(asked.length, 1, 'control: the second read was not reused');
  const f = await fetch(`http://127.0.0.1:${server.address().port}/api/community/follow`, { method: 'POST', headers: { 'x-kosmos-agent-token': tok, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'quill' }) });
  assert.equal(f.status, 200);
  await get(tok);
  assert.equal(asked.length, 2, 'the list after a follow was the one kept from before it');
  // A failure is kept only briefly (FOLLOWING_ROUTE_FAIL_MS): at once it is reused, so a loop does not hammer.
  asked = [];
  answer = { ok: false, upstream: true, because: 'the community could not be reached' };
  const ft = sendertoken.mint('Failing').token;
  assert.equal((await get(ft)).status, 502);
  assert.equal((await get(ft)).status, 502);
  assert.equal(asked.length, 1, 'a failure was asked again at once');
});
