'use strict';
/**
 * kosmos#7541 (slice 3 of #7538): the sweep sends a post stored for the company's own community to the company's space
 * on the community site, with a fresh org pass from the coordinator, and never to the public /posts. A public post is
 * unchanged. A space post whose answer never came is not looked for among the public own-posts list (which would send
 * it again): it waits.
 *
 * Sandboxed data root before the require.
 *   node --test engine/communitysend-space-7541.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-communitysend-space-7541-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });
const store = require('./store');
const orgpolicy = require('./orgpolicy');
const orgenroll = require('./orgenroll');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const companycommunity = require('./companycommunity');

const PASS = 'KST1.org_community_pass.sig';

// A fake kosmos-community with company spaces (Renet Tilley's contract on #7538). `mode` bends one behaviour per test.
function backend() {
  const st = { agents: new Map(), posts: [], spacePosts: [], seen: [], mode: {}, n: 0, members: new Map() };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const who = () => {
        const t = (req.headers.authorization || '').replace(/^Bearer /, '');
        for (const a of st.agents.values()) if (a.token === t) return a;
        return null;
      };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'GET' && req.url.startsWith('/agents/by-name/')) return send(404, { detail: 'agent not found' });
      const a = who();
      if (!a) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'POST' && req.url === '/posts') {
        st.posts.push({ agent: a.id, ...body });
        return send(201, { id: 'p' + (++st.n) });
      }
      if (req.method === 'POST' && req.url === '/spaces/join') {
        if (!body || body.pass !== PASS) return send(403, { detail: 'bad_pass' });
        st.members.set(a.id, 'acme');
        return send(200, { space: 'acme', until: new Date(Date.now() + 3600e3).toISOString() });
      }
      if (req.method === 'POST' && req.url === '/spaces/acme/posts') {
        if (st.members.get(a.id) !== 'acme') return send(403, { detail: 'space_join_needed' });
        if (st.mode.lost) return;   // never stored, and the answer never comes
        const id = crypto.randomUUID();   // as the service's ids are
        st.spacePosts.push({ id, agent: a.id, ...body });
        if (st.mode.hang) return;   // stored, but the answer never comes
        return send(201, { id });
      }
      // Renet Tilley's contract on #7538: the agent's own posts IN the space (the public /agents/me/posts never lists them).
      if (req.method === 'GET' && req.url === '/spaces/acme/agents/me/posts') {
        if (st.members.get(a.id) !== 'acme') return send(403, { detail: 'space_join_needed' });
        return send(200, st.spacePosts.filter((p) => p.agent === a.id).map((p) => ({ id: p.id, channel: p.channel, sub_channel: p.sub_channel ?? null, title: p.title, body: p.body })));
      }
      // Renet's contract (review 3): an agent withdrawing its own space post.
      if (req.method === 'DELETE' && req.url.startsWith('/spaces/acme/posts/')) {
        if (st.members.get(a.id) !== 'acme') return send(403, { detail: 'space_join_needed' });
        const id = decodeURIComponent(req.url.slice('/spaces/acme/posts/'.length));
        const i = st.spacePosts.findIndex((p) => p.id === id && p.agent === a.id);
        if (i < 0) return send(404, { detail: 'not found' });
        st.spacePosts.splice(i, 1);
        return send(204);
      }
      if (req.method === 'POST' && /^\/posts\/[^/]+\/comments$/.test(req.url)) return send(201, { id: 'c' + (++st.n) });
      if (req.method === 'GET' && req.url === '/agents/me/posts') return send(200, []);
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${server.address().port}/`;
    resolve({ st, server });
  }));
}

let be;
let coordinatorAnswer;
const passCalls = [];
const passBodies = [];
let SW = { on: false, ok: true };
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
test.beforeEach(async () => {
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(1000);
  cs.resetPauses();
  coordinatorAnswer = { ok: true, data: { token: PASS } };
  passCalls.length = 0;
  passBodies.length = 0;
  companycommunity.setRemote({ macRequest: async (m, route, body) => { passCalls.push(route); passBodies.push(body); return coordinatorAnswer; } });
  be = await backend();
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); companycommunity.setRemote(null); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentPost(agent, space) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true });
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic: 'Hi', body: 'hello there' },
    { agentId: agent, ...(space ? { space } : {}) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

test('#7541: a company post goes to the company space with a fresh pass, never to the public /posts', async () => {
  await on();
  agentPost('dana', 'company');
  await cs.sweep();
  assert.equal(be.st.posts.length, 0, 'a company post reached the PUBLIC community');
  assert.equal(be.st.spacePosts.length, 1, 'the company post did not reach its space');
  assert.deepEqual(passCalls, ['/v1/mac/org/community-pass'], 'the pass is fetched from the coordinator, once, for the join');
  assert.equal(be.st.seen.find((s) => s.url === '/spaces/join').body.pass, PASS);
  // Review 3 (Renet's contract change): the pass is asked for THIS agent, by its community id from registration.
  const registered = [...be.st.agents.values()].find((x) => x.name);
  assert.deepEqual(passBodies, [{ agent: registered.id }], 'the pass was not asked for the posting agent');
  const rec = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'));
  assert.ok(Object.values(rec).some((x) => x && x.state === 'sent' && x.remoteId), 'the record does not read as sent');
});

test('#7541: CONTROL, a post with no space still goes to the public /posts, with no pass asked for', async () => {
  await on();
  agentPost('eli');
  await cs.sweep();
  assert.equal(be.st.posts.length, 1);
  assert.equal(be.st.spacePosts.length, 0);
  assert.deepEqual(passCalls, [], 'a public post asked the coordinator for a company pass');
});

test('#7541: with no pass to be had nothing is sent anywhere, and the post goes out on a later sweep once there is one', async () => {
  await on();
  coordinatorAnswer = { ok: false, because: 'org_community_off' };
  agentPost('dana', 'company');
  await cs.sweep();
  assert.equal(be.st.posts.length + be.st.spacePosts.length, 0, 'a company post went out with no pass');
  coordinatorAnswer = { ok: true, data: { token: PASS } };
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 1, 'the post did not go out once a pass could be had');
  assert.equal(be.st.posts.length, 0);
});

const spaceSends = () => be.st.seen.filter((s) => s.method === 'POST' && s.url === '/spaces/acme/posts').length;

test('#7541: a space post stored but whose answer never came is found in the space and never sent again', async () => {
  await on();
  be.st.mode.hang = true;
  agentPost('dana', 'company');
  await cs.sweep();
  be.st.mode.hang = false;
  await cs.sweep();
  await cs.sweep();
  assert.equal(spaceSends(), 1, 'a stored space post was sent a second time');
  assert.equal(be.st.spacePosts.length, 1);
  assert.equal(be.st.posts.length, 0, 'a space post went to the public community');
  assert.ok(be.st.seen.some((s) => s.url === '/spaces/acme/agents/me/posts'), 'it was not looked for in the space');
});

test('#7541: a space post that never arrived is looked for in the space, then sent there once more, never to the public community', async () => {
  await on();
  be.st.mode.lost = true;
  agentPost('dana', 'company');
  await cs.sweep();
  be.st.mode.lost = false;
  await cs.sweep();
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 1, 'the post did not reach its space after the lost send');
  assert.equal(spaceSends(), 2, 'one lost send and one resend');
  assert.equal(be.st.posts.length, 0, 'a space post went to the public community');
});

/* Joined to a company with `policy` applied as the board applies one (a signed bundle), or to nobody (null). */
const coordinatorKey = crypto.generateKeyPairSync('ed25519');
let version = 0;
function company(policy) {
  orgpolicy.clear();
  for (const f of [orgpolicy.APPLIED(), orgpolicy.BUNDLE()]) fs.rmSync(f, { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  if (policy === null) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: 'org-1', name: 'Acme', slug: 'acme', kind: 'company' }, world: 'a'.repeat(32) }) + '\n');
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const pinned = coordinatorKey.publicKey.export({ format: 'jwk' }).x;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinatorKey.privateKey).toString('base64url'));
  fs.writeFileSync(orgpolicy.PINNED(), pinned);
  const r = orgpolicy.refresh({ now, pinned });
  assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
}

test('#7541 review 1: a public post queued before the company turned the public community off is not sent after it', async () => {
  try {
    await on();
    agentPost('eli');                                   // stored for the public community
    company({ company_community: { enabled: true }, public_community: 'off' });
    await cs.sweep();
    assert.equal(be.st.posts.length, 0, 'a post went to the PUBLIC community after the company turned it off');
    company({ company_community: { enabled: true } });   // CONTROL: allowed again, it goes
    await cs.sweep();
    assert.equal(be.st.posts.length, 1, 'CONTROL: the post did not go once the public community was allowed again');
  } finally { company(null); }
});

test('#7541 review 3: a sent company post is taken back in its space, never through the public route; an edit says it is not built yet', async () => {
  await on();
  const r = agentPost('dana', 'company');
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 1);
  const e = await cs.editFor('dana', 'post', r.id, { body: 'new words here' });
  assert.equal(e.ok, false);
  assert.match(e.because, /company's own community/);
  const w = cs.withdrawFor('dana', 'post', r.id);
  assert.equal(w.ok, true, JSON.stringify(w));
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 0, 'the company post was not taken down in its space');
  assert.ok(be.st.seen.some((x) => x.method === 'DELETE' && x.url.startsWith('/spaces/acme/posts/')), 'no space take-down was sent');
  assert.ok(!be.st.seen.some((x) => (x.method === 'DELETE' || x.method === 'PATCH') && x.url.startsWith('/posts/')), 'a company post went to a PUBLIC take-back or edit route');
});

function agentComment(agent, servicePostId) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true });
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: 'a useful note on this', servicePostId }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const publicComments = () => be.st.seen.filter((x) => x.method === 'POST' && /^\/posts\/[^/]+\/comments$/.test(x.url));

test('#7541 review 3: a public comment waits while the company says the public community is off, and goes once it is allowed', async () => {
  try {
    await on();
    company({ company_community: { enabled: true }, public_community: 'off' });
    agentComment('eli', crypto.randomUUID());
    await cs.sweep();
    assert.equal(publicComments().length, 0, 'a comment went to the PUBLIC community while the company said off');
    company({ company_community: { enabled: true } });
    await cs.sweep();
    assert.equal(publicComments().length, 1, 'CONTROL: the comment did not go once the public community was allowed');
  } finally { company(null); }
});

test('#7541 review 3: a comment on a post that went to a company space is never sent through the public comments route', async () => {
  await on();
  agentPost('dana', 'company');
  await cs.sweep();
  const remote = be.st.spacePosts[0] && be.st.spacePosts[0].id;
  assert.ok(remote, 'the company post did not reach its space');
  agentComment('eli', remote);
  await cs.sweep();
  assert.equal(publicComments().length, 0, 'a comment on a company post went to the PUBLIC route');
  agentComment('eli', crypto.randomUUID());   // CONTROL: a comment on a public post still goes
  await cs.sweep();
  assert.equal(publicComments().length, 1, 'CONTROL: a comment on a public post did not go');
});
