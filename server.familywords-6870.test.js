'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#6870, through the REAL routes: on a computer joined to a family with no policy saying off (none saved, or one
 * that does not set outside contact), #6859's default closes projects shared with other computers. Every sentence
 * that says so names the family default, never "the policy set for this Kosmos": the refused invite or join, the
 * shared room's first line, and the note on a post that stayed here. A policy saying off keeps its own words.
 *
 *   node --test server.familywords-6870.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familywords-6870-')));
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
const chat = require('./engine/chat');
const orgpolicy = require('./engine/orgpolicy');
const orgenroll = require('./engine/orgenroll');
const agentevents = require('./engine/agentevents');
const remote = require('./engine/remote');
const projects = require('./engine/projects');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT, orgpolicy.BUNDLE()]);

const signed = [];
remote.macRequest = async (method, route, body) => { signed.push(route); return { ok: false, because: 'stubbed ' + route }; };
remote.kosmosPlus = () => true;

const reported = [];
const realRecord = agentevents.recordRefusal;
agentevents.recordRefusal = (ev) => { reported.push(ev); return { queued: true }; };

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { agentevents.recordRefusal = realRecord; try { server.close(); } catch { /* best effort */ } });

const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
let version = 0;
function apply(policy) {
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
  // The pinned key the board reads without being handed one (orgpolicy.inForce).
  fs.writeFileSync(orgpolicy.PINNED(), PINNED);
  const r = orgpolicy.refresh({ now, pinned: PINNED });
  assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
}
const SCREEN = { 'sec-fetch-site': 'same-origin' };
async function call(method, route, body, headers) {
  const res = await fetch(base + route, {
    method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
/* Joined to an org of `kind`, or to nobody (null), with no policy applied. */
function joined(kind) {
  orgpolicy.clear();
  for (const f of [orgpolicy.APPLIED(), orgpolicy.BUNDLE()]) fs.rmSync(f, { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  fs.rmSync(path.join(store.ROOT, 'org-join-unknown.json'), { force: true });
  fs.rmSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), { force: true });
  if (kind === null) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: 'org-1', name: 'The Smiths', slug: 'smiths', kind }, world: 'a'.repeat(32) }) + '\n');
  assert.equal(orgenroll.kindHere(), kind, 'CONTROL: the board reads the kind this test wrote');
}
const FAMILY = /on a family's Kosmos, agents stay out of projects shared with other computers until a parent allows outside contact in the family's policy/;
const POLICY = /the policy set for this Kosmos/i;

test('#6870: a family with no policy is refused a shared project in the family default\'s words', async () => {
  const before = signed.length;
  try {
    for (const setup of [() => joined('family'), () => { joined('family'); apply({ quiet_hours: null }); }]) {
      setup();
      const r = await call('POST', '/api/federation/verify', { code: 'X' }, SCREEN);
      assert.equal(r.status, 403, JSON.stringify(r.json));
      assert.match(r.json.error, /^On a family's Kosmos, agents stay out of projects shared with other computers until a parent allows outside contact in the family's policy, so a project cannot be shared or joined here\.$/);
      assert.doesNotMatch(r.json.error, POLICY);
    }
    assert.equal(signed.length, before, 'nothing was signed');
    // Review 2: on a family, a policy that says off keeps the policy's own words (it was saved; the default is not why).
    joined('family');
    apply({ outside_contact: { enabled: false } });
    const famOff = await call('POST', '/api/federation/verify', { code: 'X' }, SCREEN);
    assert.match(famOff.json.error, /^The policy set for this Kosmos keeps agents out of the Kosmos\+ community and out of projects shared with other computers, so a project cannot be shared or joined here\.$/);
    assert.equal(orgpolicy.contactAllows().family, undefined, 'a policy saying off is not the family default');
    joined('company');
    apply({ outside_contact: { enabled: false } });
    const off = await call('POST', '/api/federation/verify', { code: 'X' }, SCREEN);
    assert.match(off.json.error, /^The policy set for this Kosmos keeps agents out of the Kosmos\+ community and out of projects shared with other computers, so a project cannot be shared or joined here\.$/, 'CONTROL: a policy saying off keeps its words');
  } finally { joined(null); }
});

test('#6870: a family with no policy: the shared room and a post that stayed here say the family default', async () => {
  const federation = require('./engine/federation');
  const made = projects.create({ name: 'Book club', agents: [], roster: [], made: { via: 'screen', by: null } });
  const pid = made && made.project ? made.project.id : made && made.id;
  const born = (projects.readAll().find((p) => p.id === pid) || {}).createdAt;
  federation.recordLink(pid, { role: 'member', edge_id: 'edge-6870', project_name: 'Book club', project_created: born });
  const roomText = async () => (await fetch(base + '/api/project/' + encodeURIComponent(pid) + '/room?as=text', { headers: SCREEN })).text();
  try {
    joined('family');
    const closed = await roomText();
    assert.match(closed, /This room is shared with another computer, but it is closed: nothing posted here leaves this computer\. On a family's Kosmos, agents stay out of projects shared with other computers until a parent allows outside contact in the family's policy\./);
    assert.doesNotMatch(closed, /every post here is sent to them/);
    assert.doesNotMatch(closed, /policy set for this Kosmos keeps it closed/);
    const r = await call('POST', '/api/project/' + encodeURIComponent(pid) + '/room', { text: 'Who has chapter three?' }, SCREEN);
    assert.ok(r.status < 300, JSON.stringify(r.json));
    const after = await roomText();
    assert.match(after, /That post stayed on this computer: on a family's Kosmos, agents stay out of projects shared with other computers until a parent allows outside contact in the family's policy\./);
    assert.doesNotMatch(after, /That post stayed on this computer: the policy/);
    joined('family');
    apply({ outside_contact: { enabled: false } });
    assert.match(await roomText(), /but the policy set for this Kosmos keeps it closed: nothing posted here leaves this computer\./, 'a family whose policy says off keeps the policy\'s words');
    joined('company');
    apply({ outside_contact: { enabled: false } });
    assert.match(await roomText(), /but the policy set for this Kosmos keeps it closed: nothing posted here leaves this computer\./, 'CONTROL: a policy saying off keeps its words');
  } finally { joined(null); }
});
