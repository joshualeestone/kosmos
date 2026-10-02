'use strict';
/*
 * #4938: what an agent makes public starts a send pass at once (communitysend.sendSoon) instead of waiting for the
 * 5-minute timer, on each of the three routes that make something sendable: a post that publishes, a comment on a
 * SERVICE post that will send, and a release from Settings. Anything held, or a comment that will not send, starts
 * nothing. A comment on one of the board's OWN posts (/api/community/comment) never leaves the board, so that route
 * is not one of them. The send layer's own test proves sendSoon sends; this pins that the routes call it.
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-sendsoon-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-sendsoon-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-sendsoon-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-sendsoon-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-sendsoon-launch-'));

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const cs = require('./engine/communitystore');
const feedpublish = require('./engine/feedpublish');
const communityswitch = require('./engine/communityswitch');
const communitysend = require('./engine/communitysend');

const realSendSoon = communitysend.sendSoon;
let soon = 0;
communitysend.sendSoon = () => { soon += 1; return Promise.resolve({ ok: true }); };   // counted, nothing sent

test.before(async () => { await start(0); });
test.after(() => {
  communitysend.sendSoon = realSendSoon;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
function board(t) {
  const b = fleet.install([fleet.agent('RouteAgent', { state: 'idle' })]);
  t.after(() => b.restore());
}
function post(path_, body, token, headers = {}) {
  return fetch(`${base()}${path_}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-kosmos-agent-token': token } : {}), ...headers },
    body: JSON.stringify(body) });
}
const cleanPost = (overrides = {}) => ({ kind: 'community_post', agent: 'RouteAgent', at: new Date().toISOString(), body: 'hello from the route', ...overrides });
const LEAK_BODY = 'contact Josh Stone directly';
const SERVICE_POST = '1b2c3d4e-0000-4000-8000-000000000001';
const settled = () => new Promise((r) => setImmediate(() => setImmediate(r)));   // the routes call it on setImmediate

test('#4938 a published post starts a send at once; a held one does not', async (t) => {
  board(t);
  communityswitch.setOn(true);
  const tok = sendertoken.mint('RouteAgent').token;
  soon = 0;
  const j = await (await post('/api/community/post', cleanPost(), tok)).json();
  await settled();
  assert.equal(j.status, 'published');
  assert.equal(soon, 1, 'a published post did not start a send');
  // CONTROL: a post the scrub stops is held: nothing to send, so no pass.
  soon = 0;
  const h = await (await post('/api/community/post', cleanPost({ body: LEAK_BODY }), tok)).json();
  await settled();
  assert.equal(h.status, 'held');
  assert.equal(soon, 0, 'a held post started a send');
});

/* Review 1: the first post after Community is ON, before any sweep, must fall inside the send window. The route
   records the window's start before storing the post, so its time is not earlier than the start. */
test('#4938 a post made before any sweep opens the send window first, so it is due', async (t) => {
  board(t);
  communityswitch.setOn(true);
  const tok = sendertoken.mint('RouteAgent').token;
  const stateFile = communitysend._paths.stateFile();
  fs.rmSync(stateFile, { force: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, '{}');   // a state with no window yet: Community just turned ON
  const j = await (await post('/api/community/post', cleanPost(), tok)).json();
  await settled();
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const stored = cs.publicFeed().find((p) => p.id === j.id);
  assert.equal(typeof st.since, 'string', 'the post route did not open the send window');
  assert.ok(stored && String(stored.releasedAt || stored.receivedAt) >= st.since, JSON.stringify({ since: st.since, at: stored && (stored.releasedAt || stored.receivedAt) }));
});

test('#4938 a comment on a service post starts a send when it will send, and not while Community is off', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const comment = (body) => ({ kind: 'community_post', servicePostId: SERVICE_POST, body, at: new Date().toISOString() });
  communityswitch.setOn(true);
  soon = 0;
  const on = await (await post('/api/community/service-comment', comment('Tuesdays work for us too.'), tok)).json();
  await settled();
  assert.equal(on.status, 'published');
  assert.equal(on.sends, true, 'premise: with Community on it sends');
  assert.equal(soon, 1, 'a comment that will send did not start a send');
  // CONTROL: Community off: the comment is marked never to send, so no pass.
  communityswitch.setOn(false);
  try {
    soon = 0;
    const off = await (await post('/api/community/service-comment', comment('And Thursdays.'), tok)).json();
    await settled();
    assert.equal(off.sends, false, 'premise: with Community off it does not send');
    assert.equal(soon, 0, 'a comment that will not send started a send');
  } finally { communityswitch.setOn(true); }
});

test('#4938 a release from Settings starts a send at once', async (t) => {
  board(t);
  communityswitch.setOn(true);
  const held = feedpublish.publishServiceComment({ kind: 'community_post', agent: 'RouteAgent', at: new Date().toISOString(), body: 'held, to release', servicePostId: SERVICE_POST }, { trusted: false, author: { name: 'RouteAgent' } });
  assert.equal(held.status, 'held');
  soon = 0;
  // Release is a person-only write from the screen, so this sends what the screen sends (#4525).
  const r = await post('/api/community/release', { id: held.id }, null, { 'sec-fetch-site': 'same-origin' });
  await settled();
  assert.equal(r.status, 200);
  assert.equal(soon, 1, 'a release did not start a send');
});
