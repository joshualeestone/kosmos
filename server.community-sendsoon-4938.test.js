'use strict';
/*
 * #4938: an agent's post or comment that PUBLISHES starts a send pass at once (communitysend.sendSoon), instead of
 * waiting for the 5-minute timer; one that is held does not (nothing to send). The send layer's own test proves
 * sendSoon sends; this pins that the ROUTES call it, so dropping a call fails here.
 */
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
const communitysend = require('./engine/communitysend');
let soon = 0;
const realSendSoon = communitysend.sendSoon;
communitysend.sendSoon = () => { soon += 1; return Promise.resolve({ ok: true }); };   // counted, nothing sent
test.after(() => { communitysend.sendSoon = realSendSoon; });
const settled = () => new Promise((r) => setImmediate(() => setImmediate(r)));   // the route calls it on setImmediate

test('#4938 a published post starts a send at once; a held one does not', async (t) => {
  board(t);
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

/* #4938 review 1: the first post after Community is ON, before any sweep, must fall inside the send window. The
   route records the window's start before storing the post, so its time is not earlier than the start. */
test('#4938 a post made before any sweep opens the send window first, so it is due', async (t) => {
  board(t);
  const tok = sendertoken.mint('RouteAgent').token;
  const stateFile = communitysend._paths.stateFile();
  fs.rmSync(stateFile, { force: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, '{}');   // a state with no window yet: Community just turned ON
  assert.equal(communitysend.switchOn(), true, 'premise: the switch reads ON in this sandbox');
  const j = await (await post('/api/community/post', cleanPost(), tok)).json();
  await settled();
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const stored = cs.publicFeed().find((p) => p.id === j.id);
  assert.equal(typeof st.since, 'string', 'the post route did not open the send window');
  assert.ok(stored && String(stored.releasedAt || stored.receivedAt) >= st.since, JSON.stringify({ since: st.since, at: stored && (stored.releasedAt || stored.receivedAt) }));
});

test('#4938 a published comment starts a send at once', async (t) => {
  board(t);
  cs.grantTrust('RouteAgent');
  const tok = sendertoken.mint('RouteAgent').token;
  const parent = await (await post('/api/community/post', cleanPost(), tok)).json();
  await settled();
  soon = 0;
  const j = await (await post('/api/community/comment', { kind: 'community_post', agent: 'RouteAgent', at: '2026-09-23T01:00:00Z', body: 'good point', postId: parent.id }, tok)).json();
  await settled();
  assert.equal(j.status, 'published');
  assert.equal(soon, 1, 'a published comment did not start a send');
});
