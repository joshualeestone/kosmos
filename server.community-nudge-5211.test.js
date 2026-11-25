'use strict';
/*
 * kosmos#5211 item 2: after a vote or a comment the board adds `nudge` to its answer: who wrote the post, whether the
 * agent follows them, and after a comment its counts against the floors over the last 24 hours (engine/communitynudge.js, stubbed here at its module
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
    nudges.push({ agentKey, postId: opts && opts.postId, ...(opts && opts.reply ? { reply: true } : {}), ...(opts && opts.vote ? { vote: true } : {}) });
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
  assert.deepEqual(nudges, [{ agentKey: 'Voter', postId: POST, vote: true }]);
});

test('#5211: a comment vote names no post; a refused vote and the standing read get no nudge', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stubVote(); stubNudge();
  await call('/api/community/vote', sendertoken.mint('Voter').token, { kind: 'comment', id: COMMENT, direction: 'up' });
  assert.deepEqual(nudges, [{ agentKey: 'Voter', postId: null, vote: true }]);
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

test('copy review: the comment route marks a --reply-to comment as a reply (so the line names the post it is on), and only that', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  stubNudge('x');
  const send = (extra) => call('/api/community/service-comment', sendertoken.mint('Writer').token,
    { kind: 'community_post', servicePostId: POST, body: 'A thought ' + Math.random(), at: new Date().toISOString(), ...extra });
  assert.equal((await send({ serviceParentId: COMMENT })).status, 200);
  assert.equal((await send({})).status, 200);
  assert.deepEqual(nudges, [{ agentKey: 'Writer', postId: POST, reply: true }, { agentKey: 'Writer', postId: POST }]);
});

/* One comment, each with its own words (the counts line goes with a comment, never a vote: kosmos#9015). */
let words = 0;
const comment = (who) => call('/api/community/service-comment', sendertoken.mint(who).token,
  { kind: 'community_post', servicePostId: POST, body: 'A thought, number ' + (++words) + '.', at: new Date().toISOString() });

/* kosmos#8340: a nudge that behaves as the real one does with the caller's memory: counts the caller says were shown
   become the short sentence; others print in full and are reported through onCounts. */
function stubCountingNudge(countsRef, delayMs = 0) {
  communitynudge.nudge = (agentKey, opts) => {
  const counts = countsRef.now;
    let line;
    if (opts && typeof opts.sameAsShown === 'function' && opts.sameAsShown(counts) === true) line = 'Ada. ' + communitynudge.COUNTS_UNCHANGED;
    else { if (opts && typeof opts.onCounts === 'function') opts.onCounts(counts); line = 'Ada. ' + counts; }
    return delayMs ? new Promise((r) => { const t = setTimeout(() => r(line), delayMs); timers.add(t); }) : Promise.resolve(line);
  };
}

test('kosmos#8340: the counts repeat only when they changed since the agent was last shown them', async (t) => {
  const b = fleet.install([fleet.agent('Repeater', { state: 'idle' })]);
  t.after(() => b.restore());
  const counts = { now: 'Last 24 hours: commented on 1 post.' };
  stubCountingNudge(counts);
  const said = async () => (await (await comment('Repeater')).json()).nudge;
  assert.equal(await said(), 'Ada. Last 24 hours: commented on 1 post.', 'the first line carries the counts');
  assert.equal(await said(), 'Ada. ' + communitynudge.COUNTS_UNCHANGED, 'the same counts again were repeated');
  counts.now = 'Last 24 hours: commented on 2 posts.';
  assert.equal(await said(), 'Ada. Last 24 hours: commented on 2 posts.', 'changed counts were not printed');
  assert.equal(await said(), 'Ada. ' + communitynudge.COUNTS_UNCHANGED);
  // Two hours on, the same counts print in full again (a rolling day moves; the agent may have lost the earlier line).
  assert.equal(require('./server')._ageCountsShownForTest('Repeater', 2 * 60 * 60 * 1000), true, 'CONTROL: no record was kept');
  assert.equal(await said(), 'Ada. Last 24 hours: commented on 2 posts.', 'counts from two hours ago were taken as just shown');
});

test('kosmos#8340: one agent being shown its counts does not hide them from another', async (t) => {
  const b = fleet.install([fleet.agent('Ann', { state: 'idle' }), fleet.agent('Bea', { state: 'idle' })]);
  t.after(() => b.restore());
  const counts = { now: 'Last 24 hours: followed 1 agent.' };
  stubCountingNudge(counts);
  const said = async (who) => (await (await comment(who)).json()).nudge;
  assert.equal(await said('Ann'), 'Ada. Last 24 hours: followed 1 agent.');
  assert.equal(await said('Bea'), 'Ada. Last 24 hours: followed 1 agent.', 'Ann\'s record hid the counts from Bea');
  assert.equal(await said('Ann'), 'Ada. ' + communitynudge.COUNTS_UNCHANGED, 'CONTROL: Ann\'s own repeat is still shortened');
});

test('kosmos#9015: through the REAL nudge, a vote carries no counts, first or repeated; CONTROL: the same agent has counts to show', async (t) => {
  const b = fleet.install([fleet.agent('Realist', { state: 'idle' })]);
  t.after(() => { b.restore(); communitynudge.nudge = realNudge; });
  communitynudge.nudge = realNudge;
  stubVote();
  // A comment vote names no post, so the real nudge reads nothing over the network: only this sandbox's records.
  const vote = async () => (await call('/api/community/vote', sendertoken.mint('Realist').token, { kind: 'comment', id: COMMENT, direction: 'up' })).json();
  communitynudge.noteFollowed('Realist', 'Someone', Date.now());
  const first = await vote();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.ok(!('nudge' in first), 'a vote carried a line: ' + first.nudge);
  assert.ok(!('nudge' in await vote()), 'a second vote carried a line');
  /* CONTROL, and what must not regress: the same agent's comments, through the route and the real nudge (less the post, so
     nothing is read over the network), show the counts in full, then short, then in full again when they change. */
  communitynudge.nudge = (agentKey, opts) => realNudge(agentKey, { ...opts, postId: null });
  const say = async () => (await (await comment('Realist')).json()).nudge;
  const full = await say();
  assert.match(full, /^Last 24 hours, not since midnight: .*followed 1 agent/, 'a comment shows no counts: ' + full);
  assert.equal(await say(), communitynudge.COUNTS_UNCHANGED, 'the same counts were repeated after a second comment');
  communitynudge.noteFollowed('Realist', 'Somebody else', Date.now());
  assert.match(await say(), /followed 2 agents/, 'a changed count was not printed in full');
  assert.ok(!('nudge' in await vote()), 'a vote after them carried the counts');
});

test('kosmos#8340: counts in a line that came too late to send are not taken as shown', async (t) => {
  const b = fleet.install([fleet.agent('Latecomer', { state: 'idle' })]);
  process.env.AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS = '3000';   // the line gets about 3 s; this one takes 3.5 s
  t.after(() => { b.restore(); delete process.env.AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS; });
  const counts = { now: 'Last 24 hours: posted once.' };
  stubCountingNudge(counts, 3500);
  const late = await (await comment('Latecomer')).json();
  assert.ok(!('nudge' in late), 'CONTROL: the slow line did not go out: ' + JSON.stringify(late));
  delete process.env.AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS;
  stubCountingNudge(counts);
  const next = await (await comment('Latecomer')).json();
  assert.equal(next.nudge, 'Ada. Last 24 hours: posted once.', 'counts the agent never saw were treated as shown');
});

/* kosmos#8895: the board keeps the comments number and the moment it was counted with the counts it showed, and hands
   them to the next nudge as lastShown, so a lower count can say why; an entry two hours old is not handed on. */
test('kosmos#8895: the next nudge gets the last shown comments count and its time, and none once it is two hours old', async (t) => {
  const b = fleet.install([fleet.agent('Dipper', { state: 'idle' })]);
  t.after(() => b.restore());
  stubVote();
  const seen = [];
  let comments = 2;
  const countedAt = Date.now() - 5000;
  communitynudge.nudge = (agentKey, opts) => {
    seen.push(opts && opts.lastShown ? { ...opts.lastShown } : null);
    const counts = 'Last 24 hours: commented on ' + comments + ' posts.';
    if (opts && typeof opts.onCounts === 'function') opts.onCounts(counts, comments, countedAt);
    return Promise.resolve('Ada. ' + counts);
  };
  const said = async () => (await (await comment('Dipper')).json()).nudge;
  await said();
  assert.equal(seen[0], null, 'a first showing was handed a last showing');
  comments = 1;
  await said();
  assert.deepEqual(seen[1], { comments: 2, at: countedAt }, 'the last shown comments count, or the moment it was counted, was not handed on');
  // CONTROL: two hours on, the record is stale, so nothing is handed on (and no aging reason can be given from it).
  assert.equal(require('./server')._ageCountsShownForTest('Dipper', 2 * 60 * 60 * 1000), true, 'CONTROL: no record was kept');
  await said();
  assert.equal(seen[2], null, 'a two-hour-old showing was handed on as the last one');
});
