'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7543 (slice 3b of #7538), through the REAL comment route: on a computer joined to a company whose policy turns
 * its own community on, an agent's comment is stored for the company's space (which company it is for, too); `public:
 * true` (kosmos community comment --public) stores it for the public community, and is refused with the policy's
 * sentence when the company says the public one is off. Everywhere else a comment is stored as before, with no space.
 *
 *   node --test server.companycomment-7543.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-companycomment-7543-')));
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

let n = 0;
/* Comment as a fresh agent; answers the route's reply and the stored row (or null). */
async function commentAs(body, t) {
  const name = 'Commenter' + (++n);
  const b = fleet.install([fleet.agent(name, { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint(name).token;
  const res = await fetch(base + '/api/community/service-comment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'community_post', at: new Date().toISOString(), servicePostId: crypto.randomUUID(), body: 'A useful note on this.', ...body }),
  });
  const json = await res.json().catch(() => null);
  const row = communitystore.publishedServiceComments().find((c) => c.agent === name) || null;
  return { status: res.status, json, row };
}

test('#7543: a company that turned its community on stores its agents\' comments for the company space', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await commentAs({}, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row, 'the comment was not stored');
  assert.equal(r.row.space, 'company');
  assert.equal(r.row.org, 'org-1', 'a company comment does not say which company it was written for');
  assert.equal(r.json.space, 'company', 'the route does not say where it goes');
});

test('#7543: --public stores the comment for the public community while the company allows that', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await commentAs({ public: true }, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row && !('space' in r.row), 'a --public comment was stored for the company space');
});

test('#7543: --public is refused with the policy\'s sentence when the company says the public community is off', async (t) => {
  setup('company', { company_community: { enabled: true }, public_community: 'off' });
  const r = await commentAs({ public: true }, t);
  assert.equal(r.status, 403);
  assert.equal(r.json && r.json.error, orgpolicy.PUBLIC_COMMUNITY_STOPS);
  assert.equal(r.row, null, 'a refused comment was stored');
});

test('#7543: CONTROL, with no company community a comment is stored as before (no space), and public: anything but true is refused', async (t) => {
  setup(null, null);
  const r = await commentAs({}, t);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.ok(r.row && !('space' in r.row), 'a comment on a board with no company community carried a space');
  const bad = await commentAs({ public: 'yes' }, t);
  assert.equal(bad.status, 400);
  assert.equal(bad.row, null);
});

test('#7543: an enrollment record that cannot be read refuses the comment, rather than storing a company comment as public', async (t) => {
  setup('company', { company_community: { enabled: true } });
  fs.writeFileSync(path.join(store.ROOT, orgenroll.ENROLLMENT_FILE), '{ not json');
  orgpolicy.clear();
  const r = await commentAs({}, t);
  assert.equal(r.status, 503, JSON.stringify(r.json));
  assert.equal(r.row, null);
});

test('#7543 review 3: a reply in the company space is refused at the route and nothing is stored', async (t) => {
  setup('company', { company_community: { enabled: true } });
  const r = await commentAs({ serviceParentId: crypto.randomUUID() }, t);
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /not replies to a comment/);
  assert.match(r.json.error, /add --public/, 'the refusal does not say how to answer a public thread');
  assert.equal(r.row, null, 'a refused reply was stored');
  setup(null, null);
  const pub = await commentAs({ serviceParentId: crypto.randomUUID() }, t);
  assert.ok(pub.status < 300, 'CONTROL: a reply on a board with no company was refused: ' + JSON.stringify(pub.json));
});
