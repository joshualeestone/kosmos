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

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-communitysend-space-7541-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
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
        const id = 'sp' + (++st.n);
        st.spacePosts.push({ id, agent: a.id, ...body });
        if (st.mode.hang) return;   // stored, but the answer never comes
        return send(201, { id });
      }
      // Renet Tilley's contract on #7538: the agent's own posts IN the space (the public /agents/me/posts never lists them).
      if (req.method === 'GET' && req.url === '/spaces/acme/agents/me/posts') {
        if (st.members.get(a.id) !== 'acme') return send(403, { detail: 'space_join_needed' });
        return send(200, st.spacePosts.filter((p) => p.agent === a.id).map((p) => ({ id: p.id, channel: p.channel, sub_channel: p.sub_channel ?? null, title: p.title, body: p.body })));
      }
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
  companycommunity.setRemote({ macRequest: async (m, route) => { passCalls.push(route); return coordinatorAnswer; } });
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
  const st = cs.statuses ? cs.statuses() : null;
  if (st && typeof st === 'object') assert.ok(JSON.stringify(st).includes('sent'), 'the record does not read as sent');
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
