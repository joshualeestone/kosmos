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

// #3485 auto-publish (Josh, #admin 2026-09-30 14:41 CDT): an authenticated agent's clean post now publishes straight
// away, and a comment goes through the same choke, so this asserted HELD until then. The spoof it guards is ATTRIBUTION.
test('#4373 B: a verified agent\'s clean comment is published, attributed to it (not to the body\'s name), on the service post', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  const r = await commentAs(sendertoken.mint('Writer').token, good({ agent: 'Somebody Else' }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['id', 'later', 'ok', 'sends', 'status']);
  assert.equal(typeof j.sends, 'boolean');
  assert.equal(j.status, 'published', '#3485: an authenticated agent\'s clean comment publishes straight away');
  const row = rows().find((x) => x.id === j.id);
  assert.equal(row.agent, 'Writer');
  assert.equal(row.author.name, 'Writer');
  assert.equal(row.remotePostId, SERVICE_POST);
  assert.equal(row.postId, null, 'a service comment must not name a local post');
});

test('#3485 CONTROL: a LEAK in a verified agent\'s comment is still quarantined, and reads as held to the agent', async (t) => {
  const b = fleet.install([fleet.agent('Leaky', { state: 'idle' })]);
  t.after(() => b.restore());
  const j = await (await commentAs(sendertoken.mint('Leaky').token, good({ body: 'mail me at leaky@example.com' }))).json();
  assert.equal(j.status, 'held', 'the submitter sees held, never quarantined');
  assert.equal(rows().find((x) => x.id === j.id).status, 'quarantined');
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

test('#4373 B review 1: GET /api/community/sent serves the comments\' outcomes beside the posts\'', async () => {
  const communitysend = require('./engine/communitysend');
  const f = communitysend._paths.commentsSentFile();
  assert.ok(f.startsWith(SANDBOX + path.sep));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ c1: { state: 'refused', agent: 'Writer', reasons: ['post_gone'] } }));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/community/sent`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.posts && typeof j.posts === 'object');
  assert.deepEqual(j.comments.c1, { state: 'refused', agent: 'Writer', post: null, agentRefused: false, reasons: ['post_gone'] });
});

test('#4373 B review 4: `sends` is what the send layer will do: false with Community off, true with it on', async (t) => {
  const b = fleet.install([fleet.agent('Writer', { state: 'idle' })]);
  t.after(() => b.restore());
  const communityswitch = require('./engine/communityswitch');
  assert.ok(communityswitch.FILE.startsWith(SANDBOX + path.sep));
  const tok = sendertoken.mint('Writer').token;
  communityswitch.setOn(false);
  const off = await (await commentAs(tok, good({ body: 'while off' }))).json();
  assert.equal(off.sends, false, 'told it sends while Community is off');
  communityswitch.setOn(true);
  const on = await (await commentAs(tok, good({ body: 'while on' }))).json();
  assert.equal(on.sends, true, 'told it does not send while Community is on');
  assert.equal(on.later, false);
});

test('#4373 B review 5: a published comment told "will not go" is recorded never to go', async (t) => {
  const b = fleet.install([fleet.agent('Trusted', { state: 'idle' })]);
  t.after(() => b.restore());
  const communityswitch = require('./engine/communityswitch');
  const communitysend = require('./engine/communitysend');
  communitystore.grantTrust('Trusted');
  communityswitch.setOn(false);
  try {
    const j = await (await commentAs(sendertoken.mint('Trusted').token, good({ body: 'published while off' }))).json();
    assert.equal(j.status, 'published', 'control: a trusted agent\'s comment is published');
    assert.equal(j.sends, false);
    assert.equal(communitysend.commentStatuses()[j.id].state, 'not_sent', 'told it will not go, but nothing stops it going');
  } finally {
    communityswitch.setOn(true);
  }
});

test('review (merge): turning Community OFF through the route ends the ON period at once (not at the next sweep)', async () => {
  const communitysend = require('./engine/communitysend');
  const communityswitch = require('./engine/communityswitch');
  communityswitch.setOn(true);
  const st = communitysend._paths.stateFile();
  fs.rmSync(st, { force: true });
  communitysend.recordPeriodStart();
  assert.equal(typeof JSON.parse(fs.readFileSync(st, 'utf8')).since, 'string', 'CONTROL: an ON period is recorded');
  const put = (on) => fetch(`http://127.0.0.1:${server.address().port}/api/community-setting`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
  try {
    assert.equal((await put(true)).status, 200);
    assert.equal(typeof JSON.parse(fs.readFileSync(st, 'utf8')).since, 'string', 'CONTROL: turning it ON keeps the period');
    assert.equal((await put(false)).status, 200);
    assert.equal(JSON.parse(fs.readFileSync(st, 'utf8')).since, undefined, 'OFF left the old window open');
  } finally { communityswitch.setOn(true); }
});

test('#4373 B review 7: POST /api/community/release records the ON period\'s start before it releases', async (t) => {
  const b = fleet.install([fleet.agent('Newbie', { state: 'idle' })]);
  t.after(() => b.restore());
  const communitysend = require('./engine/communitysend');
  const communityswitch = require('./engine/communityswitch');
  communityswitch.setOn(true);
  const st = communitysend._paths.stateFile();
  fs.rmSync(st, { force: true });                       // no sweep has recorded a start
  /* #3485 auto-publish: an authenticated agent's clean comment no longer holds, so the held row this release needs is
     made at the choke with the hold asked for explicitly, standing for a comment held before that update. */
  const feedpublish = require('./engine/feedpublish');
  const j = feedpublish.publishServiceComment({ kind: 'community_post', agent: 'Newbie', at: new Date().toISOString(), body: 'held, to release', servicePostId: SERVICE_POST }, { trusted: false, author: { name: 'Newbie' } });
  fs.rmSync(st, { force: true });                       // nothing may have recorded a start before the release
  assert.equal(j.status, 'held');
  // A release refused at the screen check (no browser headers) records nothing: the refusal comes first (merge of #4525).
  const refused = await fetch(`http://127.0.0.1:${server.address().port}/api/community/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: j.id }) });
  assert.equal(refused.status, 403);
  assert.equal(fs.existsSync(st), false, 'a refused release recorded an ON-period start');
  // #4525: release is a person-only write from the screen, so this sends what the screen sends (a browser's
  // sec-fetch-site), as server.community-gate.test.js does.
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/community/release`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ id: j.id }) });
  assert.equal(r.status, 200);
  const since = JSON.parse(fs.readFileSync(st, 'utf8')).since;
  const row = rows().find((x) => x.id === j.id);
  assert.ok(since && row.releasedAt && since <= row.releasedAt, JSON.stringify({ since, releasedAt: row.releasedAt }));
});
