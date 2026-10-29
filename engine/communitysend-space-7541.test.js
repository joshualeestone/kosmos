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
  const st = { agents: new Map(), posts: [], spacePosts: [], spaceComments: [], seen: [], mode: {}, n: 0, members: new Map() };
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
        const space = st.mode.otherSpace ? 'org9' : 'org1';   // review 7: a pass for another company
        st.members.set(a.id, space);
        return send(200, { space, until: new Date(Date.now() + 3600e3).toISOString() });
      }
      if (st.mode.spacesOff && req.url.startsWith('/spaces/org1/')) return send(404, { detail: 'Not Found' });   // review 7: every space route
      if (req.method === 'POST' && req.url === '/spaces/org1/posts') {
        if (st.members.get(a.id) !== 'org1') return send(403, { detail: 'space_join_needed' });
        if (st.mode.lost) return;   // never stored, and the answer never comes
        const id = crypto.randomUUID();   // as the service's ids are
        st.spacePosts.push({ id, agent: a.id, ...body });
        if (st.mode.hang) return;   // stored, but the answer never comes
        return send(201, { id });
      }
      // Renet Tilley's contract on #7538: the agent's own posts IN the space (the public /agents/me/posts never lists them).
      if (req.method === 'GET' && req.url === '/spaces/org1/agents/me/posts') {
        if (st.members.get(a.id) !== 'org1') return send(403, { detail: 'space_join_needed' });
        return send(200, st.spacePosts.filter((p) => p.agent === a.id).map((p) => ({ id: p.id, channel: p.channel, sub_channel: p.sub_channel ?? null, title: p.title, body: p.body })));
      }
      // Renet's contract (review 3): an agent withdrawing its own space post.
      if (st.mode.deleteLies && req.method === 'DELETE' && req.url.startsWith('/spaces/org1/posts/')) return send(404, { detail: 'Not Found' });   // review 9
      if (req.method === 'DELETE' && req.url.startsWith('/spaces/org1/posts/')) {
        if (st.members.get(a.id) !== 'org1') return send(403, { detail: 'space_join_needed' });
        const id = decodeURIComponent(req.url.slice('/spaces/org1/posts/'.length));
        const i = st.spacePosts.findIndex((p) => p.id === id && p.agent === a.id);
        if (i < 0) return send(404, { detail: 'not found' });
        st.spacePosts.splice(i, 1);
        return send(204);
      }
      // kosmos#7543: a comment in the space, as the public route answers.
      if (req.method === 'POST' && /^\/spaces\/org1\/posts\/[^/]+\/comments$/.test(req.url)) {
        if (st.members.get(a.id) !== 'org1') return send(403, { detail: 'space_join_needed' });
        const id = crypto.randomUUID();
        st.spaceComments.push({ id, agent: a.id, url: req.url, ...body });
        return send(201, { id });
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
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); companycommunity.setRemote(null); company(null); });
const companyOn = () => company({ company_community: { enabled: true } });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentPost(agent, space) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true });
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic: 'Hi', body: 'hello there' },
    { agentId: agent, ...(space ? { space, org: 'org-1' } : {}) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

test('#7541: a company post goes to the company space with a fresh pass, never to the public /posts', async () => {
  await on();
  companyOn();
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
  companyOn();
  coordinatorAnswer = { ok: false, because: 'org_community_off' };
  agentPost('dana', 'company');
  await cs.sweep();
  assert.equal(be.st.posts.length + be.st.spacePosts.length, 0, 'a company post went out with no pass');
  coordinatorAnswer = { ok: true, data: { token: PASS } };
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 0, 'review 7: the agent was asked again inside its pause after a pass could not be had');
  assert.equal(passCalls.length, 1, 'review 7: the coordinator was asked again inside the pause');
  cs.resetPauses();   // stands for the pause running out
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 1, 'the post did not go out once a pass could be had');
  assert.equal(be.st.posts.length, 0);
});

const spaceSends = () => be.st.seen.filter((s) => s.method === 'POST' && s.url === '/spaces/org1/posts').length;

test('#7541: a space post stored but whose answer never came is found in the space and never sent again', async () => {
  await on();
  companyOn();
  be.st.mode.hang = true;
  agentPost('dana', 'company');
  await cs.sweep();
  be.st.mode.hang = false;
  await cs.sweep();
  await cs.sweep();
  assert.equal(spaceSends(), 1, 'a stored space post was sent a second time');
  assert.equal(be.st.spacePosts.length, 1);
  assert.equal(be.st.posts.length, 0, 'a space post went to the public community');
  assert.ok(be.st.seen.some((s) => s.url === '/spaces/org1/agents/me/posts'), 'it was not looked for in the space');
});

test('#7541: a space post that never arrived is looked for in the space, then sent there once more, never to the public community', async () => {
  await on();
  companyOn();
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
function company(policy, org = 'org-1') {
  orgpolicy.clear();
  for (const f of [orgpolicy.APPLIED(), orgpolicy.BUNDLE()]) fs.rmSync(f, { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  if (policy === null) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: org, name: 'Acme', slug: 'org1', kind: 'company' }, world: 'a'.repeat(32) }) + '\n');
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const pinned = coordinatorKey.publicKey.export({ format: 'jwk' }).x;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org, version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
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
  companyOn();
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
  assert.ok(be.st.seen.some((x) => x.method === 'DELETE' && x.url.startsWith('/spaces/org1/posts/')), 'no space take-down was sent');
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
  companyOn();
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

test('#7541 review 4: a sent company post\'s record says so itself, so a later path never depends on the board row alone', async () => {
  await on();
  companyOn();
  agentPost('dana', 'company');
  await cs.sweep();
  const recs = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'));
  const sent = Object.values(recs).find((x) => x && x.state === 'sent');
  assert.ok(sent, 'the company post was not sent');
  assert.equal(sent.space, 'company', 'the sent record does not carry the space');
  agentPost('eli');   // CONTROL: a public post's record carries none
  await cs.sweep();
  const pub = Object.values(JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'))).find((x) => x && x.state === 'sent' && x.agent === 'eli');
  assert.ok(pub && !('space' in pub), 'a public post\'s record carried a space');
});

test('#7541 review 4 (decided): a post stored for the public community before the company turned its own on still goes public while that is allowed', async () => {
  try {
    await on();
    agentPost('eli');   // written while the public community was the only one
    company({ company_community: { enabled: true } });
    await cs.sweep();
    assert.equal(be.st.posts.length, 1, 'the earlier public post did not go');
    assert.equal(be.st.spacePosts.length, 0, 'the earlier public post was moved to the company space');
  } finally { company(null); }
});

test('#7541 review 5: a company post is never sent into another company\'s space after the computer moves company', async () => {
  await on();
  companyOn();                                   // written for org-1
  agentPost('dana', 'company');
  company({ company_community: { enabled: true } }, 'org-2');   // the computer now belongs to org-2
  await cs.sweep();
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 0, 'a post written for one company went into another company\'s space');
  assert.equal(be.st.posts.length, 0, 'it went to the public community instead');
  assert.deepEqual(passCalls, [], 'a pass was asked for while the post belongs to another company');
  companyOn();                                   // CONTROL: back in org-1, it goes
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 1, 'CONTROL: the post did not go once the computer was back in its company');
});

test('#7541 review 5: a company post waits while its company\'s community is off, and is never in the board\'s public feed', async () => {
  await on();
  companyOn();
  const r = agentPost('dana', 'company');
  assert.ok(!communitystore.publicFeed({ limit: 200 }).some((p) => p.id === r.id), 'a company post was in the board\'s PUBLIC feed');
  company({ company_community: { enabled: false } });
  await cs.sweep();
  assert.equal(be.st.spacePosts.length + be.st.posts.length, 0, 'a company post went out while its company\'s community was off');
});

test('#7541 review 7: a join that lands in another company\'s space sends nothing there', async () => {
  await on();
  companyOn();
  be.st.mode.otherSpace = true;
  agentPost('dana', 'company');
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 0, 'a company post was sent into another company\'s space');
  assert.ok(!be.st.seen.some((x) => x.method === 'POST' && /^\/spaces\/org9\//.test(x.url)), 'something was posted to the other company\'s space');
  assert.equal(be.st.posts.length, 0);
});

test('#7541 review 7: a take-down answered 404 while the site has turned spaces off is not marked done', async () => {
  await on();
  companyOn();
  const r = agentPost('dana', 'company');
  await cs.sweep();
  assert.equal(be.st.spacePosts.length, 1);
  be.st.mode.spacesOff = true;
  assert.equal(cs.withdrawFor('dana', 'post', r.id).ok, true);
  await cs.sweep();
  const rec = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'))[r.id];
  assert.notEqual(rec.state, 'deleted', 'a take-down the site could not have done was recorded as done');
  be.st.mode.spacesOff = false;   // CONTROL: spaces back, the take-down goes and is recorded
  cs.resetPauses();
  await cs.sweep();
  const after = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'))[r.id];
  assert.equal(after.state, 'deleted', 'CONTROL: the take-down did not go once spaces were back');
  assert.equal(be.st.spacePosts.length, 0);
});

test('#7541 review 9: a take-down answered 404 while the post is still listed in its space is not marked done', async () => {
  await on();
  companyOn();
  const r = agentPost('dana', 'company');
  await cs.sweep();
  be.st.mode.deleteLies = true;
  assert.equal(cs.withdrawFor('dana', 'post', r.id).ok, true);
  await cs.sweep();
  const rec = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'))[r.id];
  assert.notEqual(rec.state, 'deleted', 'a post still listed in its space was recorded as taken down');
  assert.equal(be.st.spacePosts.length, 1);
});

// kosmos#7543 (slice 3b): a comment written for the company's own community goes to the company space, never public.
function companyComment(agent, servicePostId) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true });
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: 'a useful note on this', servicePostId },
    { agentId: agent, space: 'company', org: 'org-1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

test('#7543: a company comment goes to the space with the agent\'s membership, never to the public comments route', async () => {
  await on();
  companyOn();
  const postId = crypto.randomUUID();
  const r = companyComment('dana', postId);
  await cs.sweep();
  assert.equal(publicComments().length, 0, 'a company comment went to the PUBLIC community');
  assert.equal(be.st.spaceComments.length, 1, 'the company comment did not reach the space');
  assert.equal(be.st.spaceComments[0].url, '/spaces/org1/posts/' + postId + '/comments');
  const rec = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'))[r.id];
  assert.equal(rec.state, 'sent', JSON.stringify(rec));
  assert.equal(rec.remoteId, be.st.spaceComments[0].id);
});

test('#7543: CONTROL, a comment with no space still goes to the public route, with no pass asked for', async () => {
  await on();
  agentComment('eli', crypto.randomUUID());
  await cs.sweep();
  assert.equal(publicComments().length, 1);
  assert.equal(be.st.spaceComments.length, 0);
  assert.deepEqual(passCalls, []);
});

test('#7543: a company comment waits, never public, once the company community is off on this computer', async () => {
  await on();
  company({ company_community: { enabled: false } });
  companyComment('dana', crypto.randomUUID());
  await cs.sweep();
  assert.equal(publicComments().length + be.st.spaceComments.length, 0, 'a company comment went out with the company community off');
  companyOn();
  await cs.sweep();
  assert.equal(be.st.spaceComments.length, 1, 'it did not go once the company community was on again');
  assert.equal(publicComments().length, 0);
});

test('#7543: with no pass to be had a company comment is not marked as attempted, and goes once a pass can be had', async () => {
  await on();
  companyOn();
  coordinatorAnswer = { ok: false, because: 'org_community_off' };
  const r = companyComment('dana', crypto.randomUUID());
  await cs.sweep();
  assert.equal(be.st.spaceComments.length + publicComments().length, 0);
  const rec = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'))[r.id];
  assert.ok(!rec || !rec.attempted, 'a comment never sent reads as attempted, so it would never be sent: ' + JSON.stringify(rec));
  coordinatorAnswer = { ok: true, data: { token: PASS } };
  cs.resetPauses();
  await cs.sweep();
  assert.equal(be.st.spaceComments.length, 1, 'the comment did not go once a pass could be had');
});
