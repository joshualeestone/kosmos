'use strict';
/*
 * kosmos#8156 (the community half): through the REAL routes, a test seat (an agent named with the live-check prefix,
 * communityswitch.isTestSeat) is refused a post, a comment on a board post and a comment on a community post, before
 * anything is stored, with the switch ON. CONTROL: an ordinary agent on the same board, with the same bodies, is not.
 * The prefix is read from the engine's constant, so this file never spells it.
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-testseat-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-testseat-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-testseat-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-testseat-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-testseat-launch-'));

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const cs = require('./engine/communitystore');
const communityswitch = require('./engine/communityswitch');
const communitysend = require('./engine/communitysend');

const realSendSoon = communitysend.sendSoon;
communitysend.sendSoon = () => Promise.resolve({ ok: true });   // nothing is sent from this test

test.before(async () => { await start(0); });
test.after(() => {
  communitysend.sendSoon = realSendSoon;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const SEAT = communityswitch.TEST_SEAT_PREFIX + 'route';
const PLAIN = 'RouteAgent';
const SERVICE_POST = '1b2c3d4e-0000-4000-8000-000000000001';
const base = () => `http://127.0.0.1:${server.address().port}`;
function post(path_, body, token) {
  return fetch(`${base()}${path_}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': token }, body: JSON.stringify(body) });
}
const at = () => new Date().toISOString();

test('#8156 a test seat is refused a post, a comment and a community comment; an ordinary agent is not (CONTROL)', async (t) => {
  const b = fleet.install([fleet.agent(PLAIN, { state: 'idle' }), fleet.agent(SEAT, { state: 'idle' })]);
  t.after(() => b.restore());
  communityswitch.setOn(true);
  cs.grantTrust(PLAIN);
  cs.grantTrust(SEAT);
  const plainTok = sendertoken.mint(PLAIN).token;
  const seatTok = sendertoken.mint(SEAT).token;
  const before = cs.publicFeed().length;

  // CONTROL first: the same bodies are taken from an ordinary agent, so a refusal below is the seat's alone.
  const parent = await (await post('/api/community/post', { kind: 'community_post', agent: PLAIN, at: at(), body: 'hello from the route' }, plainTok)).json();
  assert.equal(parent.status, 'published', 'CONTROL: the ordinary agent\'s post was not taken: ' + JSON.stringify(parent));
  const plainComment = await post('/api/community/comment', { kind: 'community_post', agent: PLAIN, at: at(), body: 'good point', postId: parent.id }, plainTok);
  assert.equal(plainComment.status, 200, 'CONTROL: the ordinary agent\'s comment was not taken');
  const plainService = await post('/api/community/service-comment', { kind: 'community_post', servicePostId: SERVICE_POST, body: 'Tuesdays work.', at: at() }, plainTok);
  assert.equal(plainService.status, 200, 'CONTROL: the ordinary agent\'s community comment was not taken');
  const stored = cs.publicFeed().length;
  assert.ok(stored > before, 'CONTROL: nothing was stored for the ordinary agent');

  for (const [route, body] of [
    ['/api/community/post', { kind: 'community_post', agent: SEAT, at: at(), body: 'what I learned in this test' }],
    ['/api/community/comment', { kind: 'community_post', agent: SEAT, at: at(), body: 'good point', postId: parent.id }],
    ['/api/community/service-comment', { kind: 'community_post', servicePostId: SERVICE_POST, body: 'Tuesdays work.', at: at() }],
  ]) {
    const r = await post(route, body, seatTok);
    const j = await r.json();
    assert.equal(r.status, 403, route + ' took a test seat\'s words: ' + JSON.stringify(j));
    assert.match(j.error, /test seat/, route);
    assert.ok(j.error.includes(communityswitch.TEST_SEAT_PREFIX), route + ': the refusal does not name the prefix');
  }
  assert.equal(cs.publicFeed().length, stored, 'something the seat wrote was stored');
});
