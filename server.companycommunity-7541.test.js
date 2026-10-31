'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7541 (slice 3 of #7538), through the REAL post route: on a computer joined to a company whose policy turns its
 * own community on, an agent's post is stored for the company's space; `public: true` (kosmos community post --public)
 * stores it for the public community, and is refused with the policy's sentence when the company says the public one is
 * off. Everywhere else a post is stored as before, with no space. The policy is applied as the board applies one (a
 * signed bundle, orgpolicy.refresh).
 *
 *   node --test server.companycommunity-7541.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-companycommunity-7541-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.HOME = mk('home');
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = mk('tunnel');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const orgpolicy = require('./engine/orgpolicy');
const orgenroll = require('./engine/orgenroll');
const remote = require('./engine/remote');
const sendertoken = require('./engine/sendertoken');
const communitystore = require('./engine/communitystore');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT, orgpolicy.BUNDLE()]);
remote.macRequest = async (method, route) => ({ ok: false, because: 'stubbed ' + route });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
let version = 0;
/* Joined to a company (or to nobody, kind null), with `policy` applied as the board applies one (null: none). */
function setup(kind, policy) {
  orgpolicy.clear();
  for (const f of [orgpolicy.APPLIED(), orgpolicy.BUNDLE()]) fs.rmSync(f, { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  if (kind === null) fs.rmSync(file, { force: true });
  else {
    fs.mkdirSync(store.ROOT, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ org: { id: 'org-1', name: 'Acme', slug: 'acme', kind }, world: 'a'.repeat(32) }) + '\n');
  }
  if (policy) {
    const now = Math.floor(Date.now() / 1000);
    version += 1;
    const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
    fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
    fs.writeFileSync(orgpolicy.PINNED(), PINNED);
    const r = orgpolicy.refresh({ now, pinned: PINNED });
    assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
  }
}

let n = 0;
/* Post as a fresh agent (each its own, so no test spends another's hourly cap); answers the route's reply and the
   stored row (or null). */
async function postAs(body, t) {
  const name = 'Poster' + (++n);
  const b = fleet.install([fleet.agent(name, { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint(name).token;
  const res = await fetch(base + '/api/community/post', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'community_post', at: new Date().toISOString(), body: 'Notes from today: the build went out.', ...body }),
  });
  const json = await res.json().catch(() => null);
  const row = communitystore.publishedPosts()
    .find((p) => p.author && String(JSON.stringify(p.author)).includes(name)) || null;
  return { status: res.status, json, row };
}

test('#7541: a company that turned its community on stores its agents\' posts for the company space', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await postAs({}, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row, 'the post was not stored');
  assert.equal(r.row.space, 'company');
  assert.equal(r.row.org, 'org-1', 'review 5: a company post does not say which company it was written for');
});

test('#7541: --public stores it for the public community while the company allows that', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await postAs({ public: true }, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row && !('space' in r.row), 'a --public post was stored for the company space');
});

test('#7541: --public is refused with the policy\'s sentence when the company says the public community is off', async (t) => {
  setup('company', { company_community: { enabled: true }, public_community: 'off' });
  const r = await postAs({ public: true }, t);
  assert.equal(r.status, 403);
  assert.equal(r.json && r.json.error, orgpolicy.PUBLIC_COMMUNITY_STOPS);
  assert.equal(r.row, null, 'a refused post was stored');
});

test('#7541: CONTROL, with no company community a post is stored as before (no space), and public: anything but true is refused', async (t) => {
  setup(null, null);
  const r = await postAs({}, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row && !('space' in r.row), 'a post on a board with no company community carried a space');
  setup('company', { company_community: { enabled: false } });
  const off = await postAs({}, t);
  assert.ok(off.row && !('space' in off.row), 'a company with it off stored a company post');
  const bad = await postAs({ public: 'yes' }, t);
  assert.equal(bad.status, 400);
});

test('#7541 review 1: a Kosmos bug report goes to the public community (the Kosmos team), and is refused when the company says off', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await postAs({ kosmos_bug: true }, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row && !('space' in r.row), 'a Kosmos bug report was stored for the company space');
  setup('company', { company_community: { enabled: true }, public_community: 'off' });
  const off = await postAs({ kosmos_bug: true }, t);
  assert.equal(off.status, 403);
  assert.equal(off.json && off.json.error, orgpolicy.PUBLIC_COMMUNITY_STOPS);
});

test('#7541 review 1: an enrollment record that cannot be read refuses the post, rather than storing a company post as public', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  fs.writeFileSync(file, '{not json');
  try {
    const r = await postAs({}, t);
    assert.equal(r.status, 503, JSON.stringify(r.json));
    assert.equal(r.row, null, 'a post was stored while the enrollment could not be read');
  } finally { setup(null, null); }
  const ok = await postAs({}, t);   // CONTROL: readable again, the post is stored
  assert.ok(ok.status < 300 && ok.row, 'CONTROL: a post on a readable board was not stored');
});

test('#7541 review 1: the route answers space: company for a company post, so the CLIs say where it goes', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await postAs({}, t);
  assert.equal(r.json && r.json.space, 'company');
  const pub = await postAs({ public: true }, t);
  assert.ok(pub.json && !('space' in pub.json), 'a public post was answered as a company one');
});

test('#7541 review 3: a policy the tunnel delivered but nothing applied yet decides the post (the route applies it first)', async (t) => {
  setup('company', null);   // joined to a company, no policy applied yet
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy: { company_community: { enabled: true } } })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
  fs.writeFileSync(orgpolicy.PINNED(), PINNED);
  // Not refreshed here: only the route can apply it.
  const r = await postAs({}, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.equal(r.row && r.row.space, 'company', 'a post made just after the company turned its community on was stored as public');
});
