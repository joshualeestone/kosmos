'use strict';
/**
 * kosmos#7543 (slice 3b of #7538): `kosmos community read` reads the company's own community when the company has
 * turned it on, through the reading agent's membership of the space (GET /spaces/{org}/feed and /posts/{id}), and says
 * so in the frame; `--public` reads the public community, refused when the company has turned that off. A board with no
 * company reads the public community as before, and a policy that cannot be read reads nothing.
 *
 * Sandboxed data root before the require.
 *   node --test engine/communityread-company-7543.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-communityread-company-7543-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });
const store = require('./store');
const orgpolicy = require('./orgpolicy');
const orgenroll = require('./orgenroll');
const cs = require('./communitysend');
const cr = require('./communityread');
const companycommunity = require('./companycommunity');

const ORG = '0123456789abcdef0123456789abcdef';   // a space id is the org id, 32 lowercase hex (Renet, 10-29)
const POST_ID = '1b2c3d4e-0000-4000-8000-000000000001';
const post = (title) => ({ id: POST_ID, agent: { name: 'cleo' }, channel: 'general', title, body: 'words', created_at: '2026-10-29T07:00:00Z' });

const coordinatorKey = crypto.generateKeyPairSync('ed25519');
let version = 0;
function company(policy, org = ORG) {
  orgpolicy.clear();
  for (const f of [orgpolicy.APPLIED(), orgpolicy.BUNDLE()]) fs.rmSync(f, { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  if (policy === null) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: org, name: 'Acme', slug: 'acme', kind: 'company' }, world: 'a'.repeat(32) }) + '\n');
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const pinned = coordinatorKey.publicKey.export({ format: 'jwk' }).x;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org, version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinatorKey.privateKey).toString('base64url'));
  fs.writeFileSync(orgpolicy.PINNED(), pinned);
  const r = orgpolicy.refresh({ now, pinned });
  assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
}
const companyOn = (extra = {}) => company({ company_community: { enabled: true }, ...extra });

// The two read paths, seen apart: the public one (anonymous getJson) and the company one (as the agent, in the space).
const publicSeen = [];
const spaceSeen = [];
function seams({ publicPosts = [post('public post')], spacePosts = [post('company post')] } = {}) {
  publicSeen.length = 0;
  spaceSeen.length = 0;
  cr.setFetcher(async (url) => {
    const u = new URL(url);
    publicSeen.push(u.pathname + u.search);
    if (u.pathname === '/posts/feed') return { status: 200, json: { posts: publicPosts } };
    if (u.pathname === '/posts/' + POST_ID) return { status: 200, json: publicPosts[0] };
    if (u.pathname === '/posts/' + POST_ID + '/comments') return { status: 200, json: { comments: [] } };
    return { status: 404, json: null };
  });
  cr.setSpaceFetcher(async (reader, org, sub) => {
    spaceSeen.push({ reader, org, sub });
    const p = sub.split('?')[0];
    if (p === '/feed') return { status: 200, json: { posts: spacePosts } };
    if (p === '/posts/' + POST_ID) return { status: 200, json: spacePosts[0] };
    if (p === '/posts/' + POST_ID + '/comments') return { status: 200, json: { comments: [] } };
    return { status: 404, json: null };
  });
}

test.beforeEach(() => { cs.setSwitch(() => ({ on: true, ok: true })); cs.resetPauses(); seams(); });
test.afterEach(() => { cr.setFetcher(null); cr.setSpaceFetcher(null); cs.setSwitch(null); company(null); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#7543: with the company community on, a feed read goes to the space as the reading agent, never the public feed', async () => {
  companyOn();
  const r = await cr.read({ reader: 'dana' });
  assert.equal(r.ok, true, r.because);
  assert.equal(publicSeen.length, 0, 'a company read went to the PUBLIC community');
  assert.equal(spaceSeen.length, 1);
  assert.equal(spaceSeen[0].reader, 'dana', 'the space was not read as the reading agent');
  assert.equal(spaceSeen[0].org, ORG, 'the space read was not for this company');
  assert.match(spaceSeen[0].sub, /^\/feed\?limit=/, 'the space feed is /spaces/{org}/feed');
  assert.match(r.text, /company post/);
  assert.ok(r.text.includes(cr.COMPANY_RULE), 'the frame does not say it is the company’s own community');
  assert.ok(!r.text.includes(cr.FRAME_RULE), 'the frame calls company posts public');
  assert.match(r.text, /kosmos community read --public/, 'the read does not say how to read the public community');
});

test('#7543: CONTROL, a board with no company reads the public feed, with the public frame, and never a space', async () => {
  company(null);
  const r = await cr.read({ reader: 'dana' });
  assert.equal(r.ok, true, r.because);
  assert.equal(spaceSeen.length, 0, 'a board with no company read a space');
  assert.deepEqual(publicSeen.map((s) => s.split('?')[0]), ['/posts/feed']);
  assert.ok(r.text.includes(cr.FRAME_RULE));
  assert.ok(!r.text.includes(cr.COMPANY_RULE), 'a public read said it was the company community');
});

test('#7543: --public reads the public community on a company whose own is on, and its next page keeps --public', async () => {
  companyOn();
  const cursor = 'x'.repeat(24);
  seams();
  cr.setFetcher(async (url) => { publicSeen.push(url); return { status: 200, json: { posts: [post('public post')], next_cursor: cursor } }; });
  const r = await cr.read({ reader: 'dana', public: true });
  assert.equal(r.ok, true, r.because);
  assert.equal(spaceSeen.length, 0, '--public read the company space');
  assert.equal(publicSeen.length, 1);
  assert.ok(r.text.includes(cr.FRAME_RULE));
  if (cr.CURSOR_RE.test(cursor)) assert.match(r.text, /kosmos community read --public --older /, 'the next page would read the company community');
});

test('#7543: one post and its comments are read in the space when the company community is on', async () => {
  companyOn();
  const r = await cr.read({ reader: 'dana', post: POST_ID });
  assert.equal(r.ok, true, r.because);
  assert.equal(publicSeen.length, 0, 'a company post was looked up in the PUBLIC community');
  assert.deepEqual(spaceSeen.map((s) => s.sub.split('?')[0]), ['/posts/' + POST_ID, '/posts/' + POST_ID + '/comments']);
  assert.ok(r.text.includes(cr.COMPANY_RULE));
});

test('#7543: --public is refused when the company has turned the public community off, and nothing is fetched', async () => {
  companyOn({ public_community: 'off' });
  const r = await cr.read({ reader: 'dana', public: true });
  assert.equal(r.ok, false);
  assert.match(r.because, /public community off/);
  assert.equal(publicSeen.length + spaceSeen.length, 0, 'a refused read still fetched');
  const own = await cr.read({ reader: 'dana' });
  assert.equal(own.ok, true, 'CONTROL: the company community itself is still read: ' + own.because);
  assert.equal(spaceSeen.length, 1);
});

test('#7543: a company community read needs an agent: with no reader nothing is fetched', async () => {
  companyOn();
  const r = await cr.read({});
  assert.equal(r.ok, false);
  assert.match(r.because, /only an agent/);
  assert.equal(publicSeen.length + spaceSeen.length, 0);
});

test('#7543: a policy that cannot be read reads nothing, from either community', async () => {
  companyOn();
  fs.writeFileSync(path.join(store.ROOT, orgenroll.ENROLLMENT_FILE), '{ not json');
  orgpolicy.clear();
  const r = await cr.read({ reader: 'dana' });
  assert.equal(r.ok, false, 'a damaged enrollment read a community');
  assert.match(r.because, /nothing was read/);   // the switch's own policy check answers first, as it does for a post
  assert.equal(publicSeen.length + spaceSeen.length, 0, 'a read went out while the policy could not be read');
});

// The real path (no seam): agentCall's `space` option joins with a fresh pass and reads /spaces/{org}/feed as the agent.
function backend() {
  const st = { seen: [], members: new Map(), n: 0, agents: new Map() };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = crypto.randomUUID();
        const a = { id, name: body.name, token: 'tok_' + id };
        st.agents.set(a.token, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: 'kc_key_' + id, token: a.token });
      }
      if (req.method === 'GET' && req.url.startsWith('/agents/by-name/')) return send(404, { detail: 'agent not found' });
      const a = st.agents.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!a) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'POST' && req.url === '/spaces/join') {
        st.members.set(a.id, ORG);
        return send(200, { space: ORG, until: new Date(Date.now() + 3600e3).toISOString() });
      }
      if (req.method === 'GET' && req.url.startsWith('/spaces/' + ORG + '/feed')) {
        if (st.members.get(a.id) !== ORG) return send(403, { detail: 'space_join_needed' });
        return send(200, { posts: [post('from the space')] });
      }
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${server.address().port}/`;
    resolve({ st, server });
  }));
}

test('#7543: the real path joins the space with a pass for the reading agent and reads its feed there', async () => {
  const be = await backend();
  const passBodies = [];
  try {
    cr.setSpaceFetcher(null);
    cs.setSender((url, init) => fetch(url, init));
    cs.setTimeoutMs(1000);
    companycommunity.setRemote({ macRequest: async (m, route, body) => { passBodies.push(body); return { ok: true, data: { token: 'KST1.pass.sig' } }; } });
    companyOn();
    fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'dana'), { recursive: true });
    const r = await cr.read({ reader: 'dana' });
    assert.equal(r.ok, true, r.because);
    assert.match(r.text, /from the space/);
    assert.ok(be.st.seen.some((s) => s.url === '/spaces/join'), 'the agent did not join the space');
    assert.ok(be.st.seen.some((s) => s.url.startsWith('/spaces/' + ORG + '/feed?limit=')), 'the space feed was not read');
    assert.ok(!be.st.seen.some((s) => s.url.startsWith('/posts/feed')), 'the public feed was read on a company board');
    assert.equal(passBodies.length, 1, 'the pass was not asked for once');
  } finally {
    be.server.closeAllConnections(); be.server.close();
    cs.setSender(null); companycommunity.setRemote(null);
  }
});

test('#7543: a space answers in its own shape (author, comments with no state) and reads as the public one does', async () => {
  companyOn();
  const spacePost = { id: POST_ID, space: ORG, title: 'company post', body: 'words', created_at: '2026-10-29T07:00:00Z', pinned: false, held: false, comment_count: 1,
    author: { id: '2b2c3d4e-0000-4000-8000-000000000002', name: 'cleo', handle: 'cleo' } };
  const spaceComment = { id: '3b2c3d4e-0000-4000-8000-000000000003', post_id: POST_ID, body: 'a reply in the space', created_at: '2026-10-29T07:05:00Z',
    author: { id: '4b2c3d4e-0000-4000-8000-000000000004', name: 'ravi', handle: 'ravi' } };
  cr.setSpaceFetcher(async (reader, org, sub) => {
    const p = sub.split('?')[0];
    if (p === '/feed') return { status: 200, json: { space: ORG, posts: [spacePost] } };
    if (p === '/posts/' + POST_ID) return { status: 200, json: spacePost };
    if (p === '/posts/' + POST_ID + '/comments') return { status: 200, json: { comments: [spaceComment] } };
    return { status: 404, json: null };
  });
  const feed = await cr.read({ reader: 'dana' });
  assert.equal(feed.ok, true, feed.because);
  assert.match(feed.text, /\] by cleo/, 'a space post read as written by nobody');
  const one = await cr.read({ reader: 'dana', post: POST_ID });
  assert.equal(one.ok, true, one.because);
  assert.match(one.text, /by cleo/);
  assert.match(one.text, /a reply in the space/, 'a space comment (no state) read as removed');
  assert.match(one.text, /ravi/);
});

test('#7543: the company community has no channels and one page: --channel and --older are refused there, not ignored', async () => {
  companyOn();
  const ch = await cr.read({ reader: 'dana', channel: 'engineering' });
  assert.equal(ch.ok, false);
  assert.match(ch.because, /no channels/);
  const old = await cr.read({ reader: 'dana', older: 'x'.repeat(24) });
  assert.equal(old.ok, false);
  assert.match(old.because, /no --older/);
  assert.equal(spaceSeen.length + publicSeen.length, 0);
  const pub = await cr.read({ reader: 'dana', public: true, channel: 'engineering' });
  assert.equal(pub.ok, true, 'CONTROL: --public with a channel reads the public channel: ' + pub.because);
});

test('#7543 review 3: a company read with no company named is refused, never sent to the public feed', async () => {
  companyOn();
  const was = cs.communityScope;
  try {
    cs.communityScope = () => ({ publicAllowed: true, company: true, org: null });
    const r = await cr.read({ reader: 'dana' });
    assert.equal(r.ok, false);
    assert.match(r.because, /cannot tell which company/);
  } finally { cs.communityScope = was; }
  assert.equal(publicSeen.length + spaceSeen.length, 0, 'a read went out with no company named');
});
