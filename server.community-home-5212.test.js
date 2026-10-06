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
let owedSeen = [];
require('./engine/communitynudge').nudge = async (agentKey, opts) => { owedSeen.push(opts && opts.owed); return null; };   // records what the line was given

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

test('#5212 review 1: a second read within the reuse window reuses the first; the agent\'s own comment makes the next read fresh', async (t) => {
  const b = fleet.install([fleet.agent('Fresh', { state: 'idle' })]);
  t.after(() => b.restore());
  asked = [];   // its own agent: the earlier tests' reads of Reader are inside the reuse window
  const tok = sendertoken.mint('Fresh').token;
  await (await get(tok)).json();
  await (await get(tok)).json();
  assert.deepEqual(asked, ['Fresh'], 'a second read inside the reuse window read the service again');
  const c = await fetch(`http://127.0.0.1:${server.address().port}/api/community/service-comment`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'community_post', servicePostId: '1b2c3d4e-0000-4000-8000-000000000001', body: 'An answer to that comment.', at: new Date().toISOString() }),
  });
  assert.equal(c.status, 200);
  // The comment also starts a read-ahead refresh (the same stubbed reader): count only what the next route read adds.
  await new Promise((r) => setTimeout(r, 50));
  const before = asked.length;
  await (await get(tok)).json();
  assert.equal(asked.length, before + 1, 'after its own comment the agent was shown the read from before it');
});

test('#5372: reading the Following feed drops the cached home read (its count of new posts is now wrong); a failed read does not', async (t) => {
  const b = fleet.install([fleet.agent('Follower', { state: 'idle' })]);
  const communityfollow = require('./engine/communityfollow');
  const realRead = communityfollow.readFollowing;
  let readOk = false;
  communityfollow.readFollowing = async () => (readOk ? { ok: true, count: 1, text: 'framed' } : { ok: false, upstream: true, because: 'down' });
  t.after(() => { communityfollow.readFollowing = realRead; b.restore(); });
  asked = [];
  const tok = sendertoken.mint('Follower').token;
  const following = () => fetch(`http://127.0.0.1:${server.address().port}/api/community/read?following=1`, { headers: { 'x-kosmos-agent-token': tok } });
  await (await get(tok)).json();
  assert.equal((await following()).status, 502);
  await (await get(tok)).json();
  assert.deepEqual(asked, ['Follower'], 'CONTROL: a failed Following read dropped the cached home read');
  readOk = true;
  assert.equal((await following()).status, 200);
  await (await get(tok)).json();
  assert.deepEqual(asked, ['Follower', 'Follower'], 'after reading its Following feed the agent was shown the home read from before it');
});

test('#5212 review 1 (BLOCKER): the agent\'s own comment drops its cached home read, so "replies owed" is not carried from before it', async (t) => {
  const b = fleet.install([fleet.agent('Owes', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Owes').token;
  const comment = () => fetch(`http://127.0.0.1:${server.address().port}/api/community/service-comment`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'community_post', servicePostId: '1b2c3d4e-0000-4000-8000-000000000001', body: 'A reply, ' + Math.random(), at: new Date().toISOString() }),
  });
  const communityvote = require('./engine/communityvote');
  const realVote = communityvote.vote;
  communityvote.vote = async () => ({ ok: true, text: 'You voted that post up.' });
  t.after(() => { communityvote.vote = realVote; });
  owedSeen = [];
  await (await comment()).json();                       // stale: no owed, and a read-ahead starts
  await new Promise((r) => setTimeout(r, 100));          // the read-ahead lands (owed 0 from the stub's empty posts)
  const vote = await fetch(`http://127.0.0.1:${server.address().port}/api/community/vote`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'post', id: '1b2c3d4e-0000-4000-8000-000000000001', direction: 'up' }) });
  await vote.text();
  await (await comment()).json();
  assert.deepEqual(owedSeen.slice(0, 1), [null], 'a first comment with no read carried a count');
  assert.equal(owedSeen.length, 3, 'a line was not built for each action: ' + JSON.stringify(owedSeen));
  assert.equal(owedSeen[1], 0, 'CONTROL: a fresh read was not passed to the vote\'s line (so the test could not see a stale one)');
  assert.equal(owedSeen[owedSeen.length - 1], null, 'after its own comment the line still carried the read from before it');
});

test('#5212 review 2: a home read already in flight when the agent comments is thrown away when it lands', async (t) => {
  const b = fleet.install([fleet.agent('Racer', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Racer').token;
  const communityvote = require('./engine/communityvote');
  const realVote = communityvote.vote;
  communityvote.vote = async () => ({ ok: true, text: 'You voted that post up.' });
  let release;
  const slow = new Promise((r) => { release = r; });
  const stale = { ok: true, switchedOn: true, posts: [{ id: 'p', title: 't', score: 0, comments: 1, unanswered: [{ id: 'c', by: 'x' }] }], following: null, counts: {}, floors: null };
  communityhome.homeFor = async (agentKey) => { asked.push(agentKey); await slow; return stale; };
  t.after(() => { communityvote.vote = realVote; communityhome.homeFor = async (agentKey) => { asked.push(agentKey); return { ok: true, switchedOn: true, posts: [], following: { count: 0, more: false, titles: [] }, counts: { comments: 0, follows: 0, posts: 0 }, floors: null }; }; });
  const base = `http://127.0.0.1:${server.address().port}`;
  const vote = () => fetch(base + '/api/community/vote', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'post', id: '1b2c3d4e-0000-4000-8000-000000000001', direction: 'up' }) }).then((r) => r.text());
  owedSeen = [];
  await vote();                                          // stale cache: a read-ahead starts and waits on `slow`
  await (await fetch(base + '/api/community/service-comment', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'community_post', servicePostId: '1b2c3d4e-0000-4000-8000-000000000001', body: 'The answer.', at: new Date().toISOString() }) })).json();
  release();                                             // the old read lands, listing the comment as owed
  await new Promise((r) => setTimeout(r, 50));
  await vote();
  assert.equal(owedSeen[owedSeen.length - 1], null, 'a read from before the agent\'s comment was kept and said "replies owed"');
});
