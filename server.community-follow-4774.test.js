'use strict';
/*
 * kosmos#4774: POST /api/community/follow and GET /api/community/read?following=1 on the real board. Only an agent the
 * board can verify follows or reads its feed, and the FOLLOWER is always that authenticated agent, never a name or a
 * pane in the body. engine/communityfollow is stubbed at its seam (the route calls it through the module object), so
 * each test reads which agent key the board handed it. No network.
 *
 *   node --test server.community-follow-4774.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-follow-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-follow-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-follow-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-follow-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-follow-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityfollow = require('./engine/communityfollow');
const communityread = require('./engine/communityread');
const communitysend = require('./engine/communitysend');

const realFollow = communityfollow.follow;
const realReadFollowing = communityfollow.readFollowing;
let calls = [];
function stub({ follow = [200, 'You now follow quill.'], feed = 'FRAMED FEED' } = {}) {
  calls = [];
  communityfollow.follow = async (agentKey, name, opts) => {
    calls.push({ fn: 'follow', agentKey, name, opts });
    return follow[0] === 200 ? { ok: true, text: follow[1] } : { ok: false, upstream: follow[0] === 502, because: follow[1] };
  };
  communityfollow.readFollowing = async (agentKey) => { calls.push({ fn: 'readFollowing', agentKey }); return { ok: true, count: 0, text: feed }; };
}
let readCalls = 0;
const realRead = communityread.read;

test.before(async () => {
  await start(0);
  communityread.read = async (...a) => { readCalls += 1; return realRead(...a); };
});
test.after(() => {
  communityfollow.follow = realFollow;
  communityfollow.readFollowing = realReadFollowing;
  communityread.read = realRead;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
const followAs = (tok, body) => fetch(`${base()}/api/community/follow`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { 'x-kosmos-agent-token': tok } : {}) },
  body: JSON.stringify(body),
});
const readAs = (tok, q) => fetch(`${base()}/api/community/read${q}`, { headers: tok ? { 'x-kosmos-agent-token': tok } : {} });

test('#4774 sandbox: the community keys the board would act with live in this test\'s data root', () => {
  assert.ok(communitysend._paths.keysFile().startsWith(SANDBOX + path.sep), communitysend._paths.keysFile());
});

test('#4774: with no agent token, even naming a real agent\'s pane, nobody is followed', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const pane = (b.agents.find((c) => c.sessionName === 'Reader') || {}).target;
  assert.ok(pane, 'the fixture gave no pane target');
  const r = await followAs(null, { name: 'quill', from_pane: pane });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /requires an agent token/);
  assert.equal((await followAs('ef'.repeat(16), { name: 'quill' })).status, 403, 'a token the board never issued was accepted');
  assert.equal(calls.length, 0, 'the board acted for an unverified follower');
});

test('#4774: the follower is the authenticated agent even when the body names another', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const otherPane = (b.agents.find((c) => c.sessionName === 'Other') || {}).target;
  assert.ok(otherPane, 'the fixture gave no pane target');
  const r = await followAs(sendertoken.mint('Reader').token, { name: 'quill', agent: 'Other', follower: 'Other', from_pane: otherPane });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, text: 'You now follow quill.' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentKey, 'Reader', 'the follower came from the body, not the token');
  assert.equal(calls[0].name, 'quill');
  assert.deepEqual(calls[0].opts, { unfollow: false });
  const un = await followAs(sendertoken.mint('Reader').token, { name: 'quill', unfollow: true });
  assert.equal(un.status, 200);
  assert.deepEqual(calls[1].opts, { unfollow: true });
});

test('#4774: a refusal is a 400, a service failure a 502, each in the engine\'s words', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  stub({ follow: [400, 'you cannot follow yourself'] });
  const bad = await followAs(sendertoken.mint('Reader').token, { name: 'Reader' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'you cannot follow yourself' });
  stub({ follow: [502, 'the community could not be reached'] });
  assert.equal((await followAs(sendertoken.mint('Reader').token, { name: 'quill' })).status, 502);
});

test('#4774: following=1 with a channel or a post is a 400, and nothing is read', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  readCalls = 0;
  const tok = sendertoken.mint('Reader').token;
  for (const q of ['?following=1&channel=general', '?following=1&post=1b2c3d4e-0000-4000-8000-000000000001']) {
    const r = await readAs(tok, q);
    assert.equal(r.status, 400, q);
    assert.match((await r.json()).error, /not two at once/);
  }
  assert.equal(calls.length, 0, 'the Following feed was read');
  assert.equal(readCalls, 0, 'a channel or post was read');
});

test('#4774: following=1 reads the authenticated agent\'s own feed; without a token it is 403', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  stub({ feed: 'FRAMED FEED' });
  readCalls = 0;
  const r = await readAs(sendertoken.mint('Reader').token, '?following=1');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, count: 0, text: 'FRAMED FEED' });
  assert.deepEqual(calls, [{ fn: 'readFollowing', agentKey: 'Reader' }]);
  assert.equal(readCalls, 0, 'the channel read ran as well');
  assert.equal((await readAs(null, '?following=1')).status, 403);
  assert.equal(calls.length, 1, 'an unverified reader\'s feed was read');
});

test('#4774 review 1: the real engine behind the route: switched off is a 400 (a local refusal, not a 502), and past '
  + 'FOLLOW_PER_HOUR follows and unfollows in an hour it is a 429 in the board\'s words', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  communityfollow.follow = realFollow;
  communityfollow._resetRate();
  communitysend.setSwitch(() => ({ ok: true, on: false }));
  t.after(() => { b.restore(); communitysend.setSwitch(null); communityfollow._resetRate(); });
  const tok = sendertoken.mint('Reader').token;
  for (let i = 0; i < communityfollow.FOLLOW_PER_HOUR; i++) {
    const r = await followAs(tok, { name: 'quill', unfollow: i % 2 === 1 });
    assert.equal(r.status, 400, 'call ' + i);
    assert.match((await r.json()).error, /switched off/);
  }
  const over = await followAs(tok, { name: 'quill' });
  assert.equal(over.status, 429);
  assert.deepEqual(await over.json(), { error: 'you have followed or unfollowed 20 times in the last hour, so Kosmos is pausing it. Do not try again this hour' });
});

/* #4833 slice 2: replies=1 is the authenticated reader's own replies, alone, keyed on the session, never the query. */
test('#4833: replies=1 reads the authenticated agent\'s own replies; alone only; without a token 403', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  const realReplies = communityread.readReplies;
  const asked = [];
  communityread.readReplies = async (who) => { asked.push(who); return { ok: true, count: 1, text: 'FRAMED REPLIES' }; };
  t.after(() => { communityread.readReplies = realReplies; b.restore(); });
  stub();
  readCalls = 0;
  const tok = sendertoken.mint('Reader').token;
  const r = await readAs(tok, '?replies=1&agent=Other');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, count: 1, text: 'FRAMED REPLIES' });
  assert.deepEqual(asked, ['Reader'], 'the replies were not read as the authenticated agent (or a name in the query was used)');
  for (const q of ['?replies=1&channel=general', '?replies=1&post=1b2c3d4e-0000-4000-8000-000000000001', '?replies=1&following=1']) {
    const bad = await readAs(tok, q);
    assert.equal(bad.status, 400, q);
    assert.match((await bad.json()).error, /one at a time/);
  }
  assert.equal((await readAs(null, '?replies=1')).status, 403);
  assert.equal(asked.length, 1, 'a combined or unverified request read replies');
  assert.equal(readCalls, 0, 'a channel or post read ran as well');
  assert.equal(calls.length, 0, 'the Following feed was read');
});

/* #4939: status=1 is the authenticated reader's OWN posts and comments and where each stands, alone, keyed on the
   session, never the query. */
test('#4939: status=1 reads the authenticated agent\'s own status; alone only; without a token 403; unreadable 500', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  const communitystatus = require('./engine/communitystatus');
  const realStatus = communitystatus.statusText;
  const asked = [];
  let answer = { ok: true, count: 2, text: 'MY STATUS' };
  communitystatus.statusText = (who) => { asked.push(who); return answer; };
  t.after(() => { communitystatus.statusText = realStatus; b.restore(); });
  stub();
  readCalls = 0;
  const tok = sendertoken.mint('Reader').token;
  const r = await readAs(tok, '?status=1&agent=Other');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, count: 2, text: 'MY STATUS' });
  assert.deepEqual(asked, ['Reader'], 'the status was not read as the authenticated agent (or a name in the query was used)');
  for (const q of ['?status=1&channel=general', '?status=1&post=1b2c3d4e-0000-4000-8000-000000000001', '?status=1&following=1', '?status=1&replies=1']) {
    const bad = await readAs(tok, q);
    assert.equal(bad.status, 400, q);
    assert.match((await bad.json()).error, /one at a time/);
  }
  assert.equal((await readAs(null, '?status=1')).status, 403);
  assert.equal(asked.length, 1, 'a combined or unverified request read the status');
  answer = { ok: false, because: 'we could not read what Kosmos has sent' };
  const broken = await readAs(tok, '?status=1');
  assert.equal(broken.status, 500);
  assert.match((await broken.json()).error, /could not read what Kosmos has sent/);
  assert.equal(readCalls, 0, 'a channel or post read ran as well');
  assert.equal(calls.length, 0, 'the Following feed was read');
});

/* #4941: a one-post read carries the AUTHENTICATED reader (for its own comments not yet sent), never a name in the query. */
test('#4941: read?post= passes the authenticated agent as the reader', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  const wrapped = communityread.read;
  const asked = [];
  communityread.read = async (opts) => { asked.push(opts); return { ok: true, count: 1, text: 'ONE POST' }; };
  t.after(() => { communityread.read = wrapped; b.restore(); });
  const tok = sendertoken.mint('Reader').token;
  const r = await readAs(tok, '?post=1b2c3d4e-0000-4000-8000-000000000001&agent=Other&reader=Other');
  assert.equal(r.status, 200);
  assert.deepEqual(asked.map((o) => [o.post, o.reader]), [['1b2c3d4e-0000-4000-8000-000000000001', 'Reader']]);
});
