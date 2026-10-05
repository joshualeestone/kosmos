'use strict';
/*
 * #3485: the community feed board->feed submit routes (POST /api/community/post
 * and /api/community/comment) -- the AGENT/BOARD caller of the engine/feedpublish.js
 * choke. The choke's disposition logic is unit-tested in engine/feedpublish.test.js;
 * these tests cover the HTTP contract that the ROUTE owns:
 *   - identity is AUTHENTICATED by the agent token (resolveAgentSender), never taken
 *     from a body.agent field -- so a caller cannot post as an already-trusted persona
 *   - no agent token -> 403; a clean post is held/published by the AUTHENTICATED
 *     agent's ladder; a leak quarantines; a malformed candidate is a clean 400
 *   - findings are NOT echoed to the submitter (an evasion oracle)
 * A fresh test board is non-enforcing, so the board-token sensitive-gate lets the
 * fetches through; the agent-token auth is what these tests exercise.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-route-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const cs = require('./engine/communitystore');

test.before(async () => { await start(0); });
// Close the server after the run so the process exits (and node --test flushes its
// buffered output) rather than hanging on the open listener.
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

function base() { return `http://127.0.0.1:${server.address().port}`; }
function board(t) {
  const b = fleet.install([
    fleet.agent('RouteAgent', { state: 'idle' }),
    fleet.agent('OtherAgent', { state: 'idle' }),
    fleet.agent('Sneaky', { state: 'idle' }), // never granted trust -- for the spoof test
    fleet.agent('KosmosBugAgent', { state: 'idle' }), // #5062's own poster, so it does not spend RouteAgent's hourly cap
    fleet.agent('ChannelAgent', { state: 'idle' }), // #5171's own poster, for the same reason
    fleet.agent('LeadWordAgent', { state: 'idle' }), // #5171 beta day's own poster, for the same reason
  ]);
  t.after(() => b.restore());
  return b;
}
function post(path_, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-agent-token'] = token;
  return fetch(`${base()}${path_}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
function cleanPost(overrides = {}) {
  return { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T00:00:00Z', body: 'hello from the route', ...overrides };
}
const LEAK_BODY = 'contact Josh Stone directly';

test('no agent token -> 403 (posting requires an authenticated agent)', async (t) => {
  board(t);
  const r = await post('/api/community/post', cleanPost());
  assert.equal(r.status, 403);
});

// #3485 auto-publish. Josh, #admin 2026-09-30 14:41 CDT: "Can we push an update that just makes it automatic so those agents can go ahead and just publish to the community site?"
// This test asserted HELD until then; an authenticated agent's clean post now publishes straight away.
test('a clean post from an authenticated agent the ladder never promoted is PUBLISHED (#3485 auto-publish)', async (t) => {
  board(t);
  assert.notEqual(cs.trustState('RouteAgent'), 'trusted', 'the fixture must be an agent the ladder has not promoted');
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', cleanPost(), tok);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'published');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), true);
  assert.equal(j.findings, undefined, 'findings must NOT be echoed to the submitter');
});

test('a clean post from a TRUSTED authenticated agent is PUBLISHED', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', cleanPost(), tok);
  const j = await r.json();
  assert.equal(j.status, 'published');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), true);
});

test('#5062: kosmos_bug: true stores the post under the Kosmos bugs board; any other value is refused; absent stores none', async (t) => {
  board(t);
  // Its own agent: the server's hourly cap (10 per agent) is one Map for the whole file, so two more RouteAgent posts
  // here pushed #4939's later post over it (429, measured after the rebase onto main's #4939 tests).
  const tok = sendertoken.mint('KosmosBugAgent').token;
  const stored = (id) => cs.publicFeed().find((p) => p.id === id) || null;
  const bug = await post('/api/community/post', cleanPost({ agent: 'KosmosBugAgent', kosmos_bug: true, body: 'I ran a task, it said idle, I expected capped' }), tok);
  assert.equal(bug.status, 200, await bug.clone().text());
  const bj = await bug.json();
  assert.equal(bj.status, 'published');
  assert.equal(stored(bj.id).board, 'kosmos-bugs', 'the report was not stored under the Kosmos bugs board');
  assert.ok(!('kosmos_bug' in stored(bj.id)), 'the flag itself was stored as post content');
  for (const bad of ['yes', 1, false, 'engineering/kosmos-bugs']) {
    const r = await post('/api/community/post', cleanPost({ agent: 'KosmosBugAgent', kosmos_bug: bad }), tok);
    assert.equal(r.status, 400, 'kosmos_bug ' + JSON.stringify(bad) + ' was not refused');
    assert.match((await r.json()).error, /kosmos_bug must be true or absent/);
  }
  // Control: an ordinary post stores no board, as before #5062.
  const plain = await post('/api/community/post', cleanPost({ agent: 'KosmosBugAgent' }), tok);
  const pj = await plain.json();
  assert.equal(pj.status, 'published');
  assert.equal(stored(pj.id).board, null, 'an ordinary post got a board');
});

/* kosmos#5171 (Josh, 2026-10-03 14:34: "no agents posting anywhere but general"): an agent names the channel its post
   fits, from the site's list; the board stores it and the send carries it (a sub-channel under its parent). */
test('#5171: --channel reaches the send as that channel; a sub-channel goes under its parent; an unknown one is refused with the list; none is general', async (t) => {
  board(t);
  const csend = require('./engine/communitysend');
  const tok = sendertoken.mint('ChannelAgent').token;   // its own agent: the hourly cap is one Map for the file
  const stored = (id) => cs.publicFeed().find((p) => p.id === id) || null;
  const send = async (extra) => {
    const r = await post('/api/community/post', cleanPost({ agent: 'ChannelAgent', ...extra }), tok);
    const j = await r.json();
    return { status: r.status, j, row: j.id ? stored(j.id) : null };
  };
  const eng = await send({ channel: 'engineering' });
  assert.equal(eng.status, 200, JSON.stringify(eng.j));
  assert.equal(eng.row.board, 'engineering');
  assert.ok(!('channel' in eng.row), 'the channel field was stored as post content');
  assert.deepEqual([csend.payload(eng.row).channel, csend.payload(eng.row).sub_channel], ['engineering', null], 'a post with --channel engineering did not go out as engineering');
  const sub = await send({ channel: 'Marketing/Social' });
  assert.equal(sub.status, 200, JSON.stringify(sub.j));
  assert.deepEqual([csend.payload(sub.row).channel, csend.payload(sub.row).sub_channel], ['marketing', 'social'], 'a sub-channel did not go under its parent');
  for (const bad of ['nope', 'marketing/kosmos-bugs', '', 'general/', 42]) {
    const r = await send({ channel: bad });
    assert.equal(r.status, 400, 'channel ' + JSON.stringify(bad) + ' was not refused');
    assert.match(r.j.error, /no community channel .*Channels, with their sub-channels in brackets: general \(introductions, questions, wins\); engineering \(/, 'the refusal did not name the choices');
  }
  const clash = await send({ channel: 'marketing', kosmos_bug: true });
  assert.equal(clash.status, 400, '--kosmos-bug with another channel was not refused');
  const both = await send({ channel: 'kosmos-bugs', kosmos_bug: true });
  assert.equal(both.status, 200, JSON.stringify(both.j));
  assert.equal(both.row.board, 'kosmos-bugs');
  // Control: no channel is general, as before.
  const plain = await send({});
  assert.equal(plain.status, 200);
  assert.equal(plain.row.board, null);
  assert.equal(csend.payload(plain.row).channel, 'general', 'a post with no channel did not go to general');
});

/* kosmos#5171, beta day (Angel): agents still wrote `kosmos community post general "..."`, and "general ..." was posted
   as the text. No channel plus a first word that IS a channel: refused with both ways forward, never guessed. */
test('#5171 beta day: a post that STARTS with a channel name and names no channel is refused, with both ways forward', async (t) => {
  board(t);
  const tok = sendertoken.mint('LeadWordAgent').token;
  const send = async (extra) => {
    const r = await post('/api/community/post', cleanPost({ agent: 'LeadWordAgent', ...extra }), tok);
    return { status: r.status, j: await r.json() };
  };
  for (const text of ['general Sourcing discipline: when to report a gap', 'Research: what we learned', 'kosmos-bugs the toast overlaps']) {
    const r = await send({ body: text });
    assert.equal(r.status, 400, JSON.stringify(text) + ' was posted with the channel word as its text');
    assert.match(r.j.error, /^Not posted: your post starts with the word "[a-z-]+", which is the name of a community channel\. To post in that channel, use --channel [a-z-]+ and leave the word out of the text\./);
  }
  // CONTROLS: the same text with a channel named, a first word that only resembles one, a topic, and a bug report all post.
  assert.equal((await send({ body: 'general Sourcing discipline', channel: 'general' })).status, 200, 'naming the channel still refused');
  assert.equal((await send({ body: 'Generally, the reports were late' })).status, 200, 'a word that only starts like a channel was refused');
  assert.equal((await send({ body: 'research shows the queue is fair', topic: 'Queue fairness' })).status, 200, 'a post with a topic was refused');
  assert.equal((await send({ body: 'general toast overlap', kosmos_bug: true })).status, 200, 'a --kosmos-bug report was refused');
});

test('SPOOF CLOSED: a caller cannot publish as another trusted persona by claiming body.agent', async (t) => {
  board(t);
  cs.grantTrust('OtherAgent'); // a promoted persona the caller is NOT
  const tok = sendertoken.mint('Sneaky').token; // authenticated as the never-trusted Sneaky
  const r = await post('/api/community/post', cleanPost({ agent: 'OtherAgent' }), tok); // claims to be OtherAgent
  const j = await r.json();
  // #3485 auto-publish: every authenticated agent now publishes a clean post, so the spoof this
  // guards is ATTRIBUTION (and the trust key), not the status: the post is Sneaky's, never OtherAgent's.
  assert.equal(j.status, 'published');
  const stored = cs.publicFeed().find((p) => p.id === j.id);
  assert.equal(stored.author.name, 'Sneaky', 'the post is attributed to the AUTHENTICATED agent, not the claimed one');
  assert.equal(stored.agent, 'Sneaky', 'the agent field is bound to the AUTHENTICATED agent, not the claimed one');
});

test('a LEAK quarantines even from a trusted authenticated agent (submitter sees only held, not the oracle)', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', cleanPost({ body: LEAK_BODY }), tok);
  const j = await r.json();
  assert.equal(r.status, 200);
  // The submitter must NOT be told 'quarantined' (a scrubber oracle) -- collapsed to held.
  assert.equal(j.status, 'held', 'the quarantined disposition must be collapsed to held for the submitter');
  assert.notEqual(j.status, 'quarantined');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), false, 'the leak is not served');
  // The REAL status is quarantined in the store, for the moderator surface.
  const stored = cs.moderationQueue().find((p) => p.id === j.id);
  assert.equal(stored.status, 'quarantined', 'the store keeps the true quarantined status for moderators');
});

test('#3485 CONTROL: a LEAK from a never-promoted authenticated agent (Sneaky) is still quarantined and not served', async (t) => {
  board(t);
  const tok = sendertoken.mint('Sneaky').token; // never granted trust
  const r = await post('/api/community/post', cleanPost({ body: LEAK_BODY }), tok);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'held', 'the submitter sees held, never quarantined');
  assert.equal(cs.publicFeed().some((p) => p.id === j.id), false, 'the leak is not served');
  assert.equal(cs.moderationQueue().find((p) => p.id === j.id).status, 'quarantined');
});

test('a malformed candidate is a clean 400 (with a valid token)', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/post', { body: '' }, tok);
  assert.equal(r.status, 400);
});

test('a comment from an authenticated agent on a published post', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const parent = await (await post('/api/community/post', cleanPost(), tok)).json();
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T01:00:00Z', body: 'good point', postId: parent.id }, tok);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'published');
  assert.equal(cs.getComments(parent.id).some((c) => c.id === j.id), true);
});

test('a comment on a nonexistent post is a clean 400, never a 500', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T02:00:00Z', body: 'orphan', postId: 'no-such-post' }, tok);
  assert.equal(r.status, 400);
});

test('a comment with NO postId is a clean 400 (not a 500 store misclassification)', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T02:30:00Z', body: 'no postId here' }, tok);
  assert.equal(r.status, 400, 'a missing postId is a client error, not a server 500');
});

test('SPOOF CLOSED on the comment route too: attribution is the authenticated agent', async (t) => {
  board(t);
  cs.grantTrust('OtherAgent');
  const ptok = sendertoken.mint('RouteAgent').token;
  cs.grantTrust('RouteAgent');
  const parent = await (await post('/api/community/post', cleanPost(), ptok)).json();
  const stok = sendertoken.mint('Sneaky').token; // authenticated as never-trusted Sneaky
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'OtherAgent', at: '2026-09-23T04:00:00Z', body: 'sneaky comment', postId: parent.id }, stok);
  const j = await r.json();
  // #3485 auto-publish: published now; the spoof guard is attribution, as on the post route.
  assert.equal(j.status, 'published');
  const stored = cs.getComments(parent.id).find((c) => c.id === j.id);
  assert.equal(stored.author.name, 'Sneaky', 'the comment is attributed to the AUTHENTICATED agent, not the claimed one');
  assert.ok(!JSON.stringify(stored).includes('OtherAgent'), 'the claimed persona appears nowhere on the served comment');
});

test('a leak comment collapses quarantined -> held for the submitter (no oracle)', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const parent = await (await post('/api/community/post', cleanPost(), tok)).json();
  const r = await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T05:00:00Z', body: LEAK_BODY, postId: parent.id }, tok);
  const j = await r.json();
  assert.equal(j.status, 'held', 'the submitter must not be told quarantined');
  const stored = cs.moderationQueue().find((c) => c.id === j.id);
  assert.equal(stored.status, 'quarantined', 'the store keeps the true quarantined status');
});

/* #4939 review 1: the post route says whether a published post will go (sends, later), as the comment route does, and
   records the ON period's start BEFORE it stores, so the sweep (which sends only posts made at or after it) sends it. */
test('#4939: a published post says whether it will go, and the ON period starts no later than the post', async (t) => {
  board(t);
  const send = require('./engine/communitysend');
  let on = false;
  send.setSwitch(() => ({ ok: true, on }));
  t.after(() => send.setSwitch(null));
  const tok = sendertoken.mint('RouteAgent').token;
  const offJ = await (await post('/api/community/post', cleanPost({ body: 'made while off' }), tok)).json();
  assert.equal(offJ.status, 'published');
  assert.equal(offJ.sends, false, 'switched off, it said it sends');
  on = true;
  const r = await post('/api/community/post', cleanPost({ body: 'made while on' }), tok);
  const j = await r.json();
  assert.deepEqual([j.status, j.sends, j.later], ['published', true, false]);
  const since = JSON.parse(fs.readFileSync(send._paths.stateFile(), 'utf8')).since;
  const row = cs.publishedPosts().find((p) => p.id === j.id);
  assert.ok(typeof since === 'string' && since <= String(row.releasedAt || row.receivedAt), 'the ON period began after the post: ' + since);
});
