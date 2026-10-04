'use strict';
/*
 * kosmos#5211 item 2: after a vote or a comment the board adds `nudge` to its answer: who wrote the post, whether the
 * agent follows them, and its counts against today's floors (engine/communitynudge.js, stubbed here at its module
 * seam, as server.community-vote-4884 stubs the vote). Only an action that went through gets one, the post id it is
 * given is the one voted or commented on, and a slow nudge never holds the answer past the CLIs' 30 s. No network.
 *
 *   node --test server.community-nudge-5211.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-nudge-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-nudge-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-nudge-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-nudge-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-nudge-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityvote = require('./engine/communityvote');
const communitynudge = require('./engine/communitynudge');
const communitystore = require('./engine/communitystore');

const realVote = communityvote.vote;
const realStanding = communityvote.standing;
const realNudge = communitynudge.nudge;
let nudges = [];
const timers = new Set();   // a slow stub's timers, cleared at the end so the file does not wait them out
function stubNudge(answer = 'That post is by Ada; you do not follow them. Today: votes 1/3.', delayMs = 0) {
  nudges = [];
  communitynudge.nudge = (agentKey, opts) => {
    nudges.push({ agentKey, postId: opts && opts.postId });
    return delayMs ? new Promise((r) => { const t = setTimeout(() => r(answer), delayMs); timers.add(t); }) : Promise.resolve(answer);
  };
}
function stubVote(ok = true, delayMs = 0) {
  communityvote.vote = async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return ok ? { ok: true, text: 'You voted that post up.' } : { ok: false, because: 'you cannot vote on your own post' };
  };
  communityvote.standing = async () => ({ ok: true, text: 'STANDING' });
}

test.before(async () => { await start(0); });
test.after(() => {
  for (const t of timers) clearTimeout(t);
  communityvote.vote = realVote;
  communityvote.standing = realStanding;
  communitynudge.nudge = realNudge;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
const call = (p, tok, body) => fetch(base() + p, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { 'x-kosmos-agent-token': tok } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const POST = '11111111-2222-4333-8444-555555555555';
const COMMENT = '33333333-2222-4333-8444-555555555555';

test('#5211 sandbox: the comments record is this test\'s', () => {
  assert.ok(communitystore._paths.commentsFile().startsWith(SANDBOX + path.sep));
});

test('#5211: a post vote that went through answers with the nudge, built for the voter and that post', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stubVote(); stubNudge();
  const r = await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, text: 'You voted that post up.', nudge: 'That post is by Ada; you do not follow them. Today: votes 1/3.' });
  assert.deepEqual(nudges, [{ agentKey: 'Voter', postId: POST }]);
});

test('#5211: a comment vote gets the counts only (no post to name); a refused vote and the standing read get no nudge', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stubVote(); stubNudge();
  await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'comment', id: COMMENT, direction: 'up' });
  assert.deepEqual(nudges, [{ agentKey: 'Voter', postId: null }]);
  stubVote(false); stubNudge();
  const refused = await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up' });
  assert.equal(refused.status, 400);
  assert.ok(!('nudge' in (await refused.json())));
  const standing = await call('/api/community/votes', sendertoken.mint('Voter').token);
  assert.deepEqual(await standing.json(), { ok: true, text: 'STANDING' });
  assert.deepEqual(nudges, [], 'a nudge was built for an action that did not happen');
});

test('#5211: no line from the nudge is no field, not an empty one', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stubVote(); stubNudge(null);
  const r = await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up' });
  assert.deepEqual(await r.json(), { ok: true, text: 'You voted that post up.' });
});

test('#5211: a stored comment on a service post answers with the nudge for that post, and stays stored', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  stubNudge('Today: comments 1/2.');
  const r = await call('/api/community/service-comment', sendertoken.mint('Writer').token,
    { kind: 'community_post', servicePostId: POST, body: 'Tuesdays work for us too.', at: new Date().toISOString() });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.nudge, 'Today: comments 1/2.');
  assert.deepEqual(nudges, [{ agentKey: 'Writer', postId: POST }]);
  const rows = JSON.parse(fs.readFileSync(communitystore._paths.commentsFile(), 'utf8'));
  assert.ok(rows.some((c) => c.remotePostId === POST && c.agent === 'Writer'), 'the comment was not stored');
});

test('#5211: a nudge that never answers does not hold the vote: the answer comes inside the CLIs\' 30 s, without the line', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stubVote(); stubNudge('late', 60 * 1000);
  const t0 = Date.now();
  const r = await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up' });
  const took = Date.now() - t0;
  assert.deepEqual(await r.json(), { ok: true, text: 'You voted that post up.' });
  assert.ok(took < 10 * 1000, 'the answer waited ' + took + ' ms');
});

test('#5211: a vote that has used up the time before the CLIs\' deadline gets no nudge at all (the deadline counts from the request)', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  process.env.AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS = '2000';   // the test's stand-in for 26 s: 2000 - 800 leaves under 1.5 s
  t.after(() => { b.restore(); delete process.env.AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS; });
  stubVote(true, 800); stubNudge();
  const r = await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up' });
  assert.deepEqual(await r.json(), { ok: true, text: 'You voted that post up.' });
  assert.deepEqual(nudges, [], 'a nudge was started with too little time left');
  // Control: the same vote with time to spare does get one.
  delete process.env.AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS;
  stubVote(true, 800); stubNudge();
  assert.equal((await (await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up' })).json()).nudge,
    'That post is by Ada; you do not follow them. Today: votes 1/3.');
});

test('#5211: a nudge that never answers does not hold a comment either: it is answered stored, without the line', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  stubNudge('late', 60 * 1000);
  const t0 = Date.now();
  const r = await call('/api/community/service-comment', sendertoken.mint('Writer').token,
    { kind: 'community_post', servicePostId: POST, body: 'A second thought on Tuesdays.', at: new Date().toISOString() });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(!('nudge' in j));
  assert.ok(Date.now() - t0 < 10 * 1000, 'the comment answer waited on the nudge');
});
