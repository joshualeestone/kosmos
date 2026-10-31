'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#6239 (first Kosmos+Kids slice), through the REAL routes: under `outside_contact: { enabled: false }` no project
 * is shared or joined (invite, verify, join, own-code: 403 with the policy's words, nothing signed), and Settings'
 * community switch says the policy overrides it. Under `quiet_hours` the person's Restart (Start) is refused and
 * reported, and a person's message the delivery gate refused for quiet hours is reported; an automatic one is not.
 * The policy is applied as the board applies one (a signed bundle, orgpolicy.refresh).
 *
 *   node --test server.familypolicy-6239.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familypolicy-6239-')));
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
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
const quiet = (a, b) => ({ quiet_hours: { tz: 'UTC', school_nights: false, from: hhmm(Date.now() + a * 60e3), to: hhmm(Date.now() + b * 60e3) } });

const SCREEN = { 'sec-fetch-site': 'same-origin' };
async function call(method, route, body, headers) {
  const res = await fetch(base + route, {
    method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('#6239: no project is shared or joined under the policy, and nothing is signed; allowed, the route goes on', async () => {
  const p = projects.create({ name: 'Science fair', agents: [], roster: [], made: { via: 'screen', by: null } });
  const id = p && p.project ? p.project.id : p && p.id;
  apply({ outside_contact: { enabled: false } });
  const before = signed.length;
  for (const [route, body] of [
    ['/api/federation/invite', { project_ref: 'r', project_name: 'n', invited_kind: 'person' }],
    ['/api/federation/verify', { code: 'X' }],
    ['/api/federation/join', { edge_id: 'e', agents: [] }],
    ['/api/federation/own-code', { project: id }],
  ]) {
    const r = await call('POST', route, body, SCREEN);
    assert.equal(r.status, 403, route + ' ' + JSON.stringify(r.json));
    assert.match(r.json.error, /^The policy set for this Kosmos keeps agents out of the Kosmos\+ community and out of projects shared with other computers, so a project cannot be shared or joined here\.$/, route);
  }
  // kosmos#4658: the Allow that hands a sealed room's key to another computer, behind the federation switch.
  process.env.AGENT_WORKFORCE_FEDERATION_LIVE = '1';
  try {
    const r = await call('POST', '/api/federation/own-allow', { project: id, pub: 'pub-x', code: 'ABCDE-FGHJK' }, SCREEN);
    assert.equal(r.status, 403, 'own-allow ' + JSON.stringify(r.json));
    assert.match(r.json.error, /^The policy set for this Kosmos keeps agents out/, 'own-allow');
    const c = await call('POST', '/api/federation/own-confirm', { project: id, code: 'ABCDE-FGHJK' }, SCREEN);
    assert.equal(c.status, 403, 'own-confirm ' + JSON.stringify(c.json));
    assert.match(c.json.error, /^The policy set for this Kosmos keeps agents out/, 'own-confirm');
  } finally { delete process.env.AGENT_WORKFORCE_FEDERATION_LIVE; }
  assert.equal(signed.length, before, 'something was signed for the coordinator under the policy');
  apply({ outside_contact: { enabled: true } });
  const ok = await call('POST', '/api/federation/verify', { code: 'X' }, SCREEN);
  assert.doesNotMatch(String(ok.json && ok.json.error), /policy set for this Kosmos/, 'CONTROL: allowed, the route goes on: ' + JSON.stringify(ok.json));
  assert.ok(signed.length > before, 'CONTROL: allowed, verify reached the (stubbed) coordinator');
});

test('#6239: Settings\' community switch says the policy overrides it, and nothing while allowed', async () => {
  apply({ outside_contact: { enabled: false } });
  const r = await call('GET', '/api/community-setting');
  assert.equal(r.status, 200);
  assert.match(r.json.stopped, /^The policy set for this Kosmos keeps agents out of the Kosmos\+ community and out of projects shared with other computers, so they do not take part in the Kosmos\+ community whatever this switch says\.$/);
  apply({ outside_contact: { enabled: true } });
  assert.equal((await call('GET', '/api/community-setting')).json.stopped, null, 'CONTROL');
  // Round 3: a record that cannot be read is said as that (the send layer refuses on it), not as nothing. The bundle
  // is taken away first, so the route has nothing to apply over the damaged record.
  const bundle = fs.readFileSync(orgpolicy.BUNDLE()); const good = fs.readFileSync(orgpolicy.APPLIED());
  try {
    fs.rmSync(orgpolicy.BUNDLE()); fs.writeFileSync(orgpolicy.APPLIED(), '{ not json');
    assert.match((await call('GET', '/api/community-setting')).json.stopped, /^Kosmos cannot read the policy set for this Kosmos just now, so agents do not take part/);
  } finally { fs.writeFileSync(orgpolicy.BUNDLE(), bundle); fs.writeFileSync(orgpolicy.APPLIED(), good); }
});

test('#6239: the person\'s Start is refused in quiet hours and reported; outside them it is not', async () => {
  apply(quiet(-60, 60));
  reported.length = 0;
  const r = await call('POST', '/api/agent/casey/restart', {});
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.because, /^it was not started: it is quiet hours until/);
  assert.deepEqual(reported, [{ agent: 'casey', rule: 'quiet-hours' }]);
  apply(quiet(120, 180));
  reported.length = 0;
  const later = await call('POST', '/api/agent/casey/restart', {});
  assert.doesNotMatch(String(later.json && later.json.because), /quiet hours/, 'CONTROL');
  assert.deepEqual(reported, []);
});

test('#6239: a person\'s message refused for quiet hours is reported; an automatic one is not', async () => {
  const QUIET = { state: chat.DELIVERY.COULD_NOT, because: 'nothing new is sent to agents now: it is quiet hours', at: new Date().toISOString(), paneState: null, paneNote: null, quiet: true };
  const realP = chat.deliverAsync; const realA = chat.deliverAutomaticAsync;
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    chat.deliverAsync = async () => QUIET;
    chat.deliverAutomaticAsync = async () => QUIET;
    reported.length = 0;
    const r = await call('POST', '/api/agent/casey/thread', { text: 'Can you check my homework?' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.quiet, true);
    assert.deepEqual(reported, [{ agent: 'casey', rule: 'quiet-hours' }]);
    reported.length = 0;
    await call('POST', '/api/agent/casey/thread', { text: 'hello', automatic: true });
    assert.deepEqual(reported, [], 'the board\'s own hello was reported as the person');
  } finally {
    chat.deliverAsync = realP; chat.deliverAutomaticAsync = realA;
    board.restore();
  }
});

test('#6239: a shared room under the policy says it is closed, and a post there says it stayed on this computer', async () => {
  const federation = require('./engine/federation');
  const made = projects.create({ name: 'Book club', agents: [], roster: [], made: { via: 'screen', by: null } });
  const pid = made && made.project ? made.project.id : made && made.id;
  const born = (projects.readAll().find((p) => p.id === pid) || {}).createdAt;
  federation.recordLink(pid, { role: 'member', edge_id: 'edge-6239', project_name: 'Book club', project_created: born });
  const roomText = async () => {
    const res = await fetch(base + '/api/project/' + encodeURIComponent(pid) + '/room?as=text', { headers: SCREEN });
    return res.text();
  };
  apply({ outside_contact: { enabled: true } });
  assert.match(await roomText(), /This room is shared with people outside this computer: every post here is sent to them/, 'CONTROL: the shared line while allowed');
  apply({ outside_contact: { enabled: false } });
  const closed = await roomText();
  assert.match(closed, /This room is shared with another computer, but the policy set for this Kosmos keeps it closed: nothing posted here leaves this computer\./);
  assert.doesNotMatch(closed, /every post here is sent to them/);
  const r = await call('POST', '/api/project/' + encodeURIComponent(pid) + '/room', { text: 'Who has chapter three?' }, SCREEN);
  assert.ok(r.status < 300, JSON.stringify(r.json));
  assert.match(await roomText(), /That post stayed on this computer: the policy set for this Kosmos keeps agents out of the Kosmos\+ community and out of projects shared with other computers\./);
  // Round 4: a policy that cannot be read is said as that, in the room view.
  const bundle = fs.readFileSync(orgpolicy.BUNDLE()); const good = fs.readFileSync(orgpolicy.APPLIED());
  try {
    fs.rmSync(orgpolicy.BUNDLE()); fs.writeFileSync(orgpolicy.APPLIED(), '{ not json');
    const faulted = await roomText();
    assert.match(faulted, /it is closed for now: Kosmos cannot read the policy set for this Kosmos, so nothing posted here leaves this computer\./);
    assert.doesNotMatch(faulted, /but the policy set for this Kosmos keeps it closed/);
  } finally { fs.writeFileSync(orgpolicy.BUNDLE(), bundle); fs.writeFileSync(orgpolicy.APPLIED(), good); }
  apply({ outside_contact: { enabled: true } });
});

test('#6239: the community turn never treats the stopped lines as the rules (round 7, source pin)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  // #5313: the membership check moved into the shared module-scope agentInCommunity (one definition
  // for the community-turn sweep AND the task-done prompt), so the pin follows it there.
  const a = SRC.indexOf('function agentInCommunity(session) {');
  assert.notEqual(a, -1, 'CONTROL: the community turn\'s check moved; find it');
  const fn = SRC.slice(a, a + 500);
  assert.match(fn, /return Boolean\(f\) && f\.ambiguous !== true && !cb\.isStoppedSection\(cur\.text \|\| ''\);/);
});
