'use strict';

/**
 * #4649: the owner's outside-invite routes, end to end through server.js, with the connector stubbed
 * (remote.macRequest) so nothing reaches a coordinator.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included), as server.federation-3311.test.js does.
 *
 *   node --test server.fedmembers-4649.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fedmembers-4649-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');
const projects = require('./engine/projects');
const federation = require('./engine/federation');
const fedseats = require('./engine/fedseats');

let edgeList = [];
const signedCalls = [];
remote.macRequest = async (method, route, body) => {
  signedCalls.push({ method, route, body });
  if (route === '/v1/mac/federation/invite') return { ok: true, data: { code: 'CODE-' + signedCalls.length, expires_at: Math.floor(Date.now() / 1000) + 86400, invite_id: 'inv-' + signedCalls.length } };
  if (route === '/v1/mac/federation/edges') return { ok: true, data: { as_owner: edgeList, as_member: [] } };
  if (route === '/v1/mac/federation/revoke') return { ok: true, data: { ok: true } };
  if (route === '/v1/mac/federation/invite/withdraw') return { ok: true, data: { ok: true } };
  return { ok: false, because: 'unexpected route ' + route };
};

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const SCREEN = { 'sec-fetch-site': 'same-origin' };
async function call(method, route, body, headers) {
  const res = await fetch(base + route, {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('#4649: a process caller is refused on Members, Remove and Withdraw before anything is signed', async () => {
  const before = signedCalls.length;
  const m = await call('GET', '/api/federation/members?project=x');
  assert.equal(m.status, 403, JSON.stringify(m.json));
  for (const route of ['/api/federation/remove', '/api/federation/withdraw']) {
    const r = await call('POST', route, { project: 'x', edge_id: 'e', invite_id: 'i' });
    assert.equal(r.status, 403, route + ': ' + JSON.stringify(r.json));
    assert.match(r.json.error, /person at the Kosmos screen/);
  }
  assert.equal(signedCalls.length, before, 'something was signed for a process caller');
});

test('#4649: from the screen: invite from an existing project, see it in Members, then joined, remove it, withdraw another', async () => {
  const made = projects.create({ name: 'Spring Launch' });
  const pid = made.id || (made.project && made.project.id);
  assert.ok(pid, 'no project was made, so nothing below proves anything');
  const inv = await call('POST', '/api/federation/invite', { project: pid, invited_kind: 'person', label: 'Dana Ruiz' }, SCREEN);
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.ok(inv.json.invite_id, 'no invite id came back');
  const link = federation.linkFor(pid);
  assert.equal(link && link.role, 'owner', 'the existing project was not recorded as shared');
  // Review round 1: the seat check (fedseats.stampOf) must take the new link as THIS project's, or it forgets it.
  assert.ok(fedseats.linkFor(pid), 'the seat check reads the new owner link as an earlier project\'s: the room would never be sat in');
  const sent = signedCalls.filter((c) => c.route === '/v1/mac/federation/invite').at(-1).body;
  assert.equal(sent.project_ref, link.ref);
  assert.equal(sent.project_name, 'Spring Launch', 'the coordinator got a name other than the project\'s own');
  assert.equal(sent.label, undefined, 'the owner\'s label left this computer');

  let m = await call('GET', '/api/federation/members?project=' + encodeURIComponent(pid), undefined, SCREEN);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.deepEqual(m.json.invites.map((r) => [r.label, r.state]), [['Dana Ruiz', 'pending']]);

  edgeList = [{ id: 'e-dana', invite_id: inv.json.invite_id, project_ref: link.ref, status: 'active', created_at: 1700000000, member_kind: 'person' }];
  m = await call('GET', '/api/federation/members?project=' + encodeURIComponent(pid), undefined, SCREEN);
  assert.deepEqual(m.json.invites.map((r) => [r.state, r.edge_id]), [['joined', 'e-dana']]);

  const rm = await call('POST', '/api/federation/remove', { project: pid, edge_id: 'e-dana' }, SCREEN);
  assert.equal(rm.status, 200, JSON.stringify(rm.json));
  assert.deepEqual(signedCalls.filter((c) => c.route === '/v1/mac/federation/revoke').at(-1).body, { edge_id: 'e-dana' });

  const second = await call('POST', '/api/federation/invite', { project: pid, invited_kind: 'agent', label: 'Scout' }, SCREEN);
  const wd = await call('POST', '/api/federation/withdraw', { project: pid, invite_id: second.json.invite_id }, SCREEN);
  assert.equal(wd.status, 200, JSON.stringify(wd.json));
  m = await call('GET', '/api/federation/members?project=' + encodeURIComponent(pid), undefined, SCREEN);
  assert.equal(m.json.invites.find((r) => r.label === 'Scout').state, 'withdrawn');
});

test('#4649 review round 1: a link left by an earlier project of the same id is replaced, never reused', async () => {
  const made = projects.create({ name: 'Reused Name' });
  const pid = made.id || (made.project && made.project.id);
  federation.recordLink(pid, { role: 'owner', ref: 'ref-of-the-old-project', project_created: '2001-01-01T00:00:00.000Z' });
  assert.equal(fedseats.linkFor(pid), null, 'precondition: the seat check must already read this link as stale');
  const inv = await call('POST', '/api/federation/invite', { project: pid, invited_kind: 'person', label: 'Lee' }, SCREEN);
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const sent = signedCalls.filter((c) => c.route === '/v1/mac/federation/invite').at(-1).body;
  assert.notEqual(sent.project_ref, 'ref-of-the-old-project', 'a new guest was invited into the old project\'s room');
  assert.ok(fedseats.linkFor(pid), 'the replacement link is not this project\'s either');
});

test('#4649 review round 1: removing a project forgets its outside invites, so a new project of the same name lists none', async () => {
  const made = projects.create({ name: 'Short Lived' });
  const pid = made.id || (made.project && made.project.id);
  await call('POST', '/api/federation/invite', { project: pid, invited_kind: 'person', label: 'Private Label' }, SCREEN);
  let m = await call('GET', '/api/federation/members?project=' + encodeURIComponent(pid), undefined, SCREEN);
  assert.equal(m.json.invites.length, 1, 'precondition: the invite is listed');
  const del = await call('DELETE', '/api/project/' + encodeURIComponent(pid), undefined, SCREEN);
  assert.ok(del.status < 300, 'the project was not removed: ' + del.status + ' ' + JSON.stringify(del.json));
  const again = projects.create({ name: 'Short Lived' });
  const pid2 = again.id || (again.project && again.project.id);
  assert.equal(pid2, pid, 'precondition: the freed id is reused, which is the case this guards');
  m = await call('GET', '/api/federation/members?project=' + encodeURIComponent(pid2), undefined, SCREEN);
  assert.deepEqual(m.json.invites, [], 'a new project listed the removed project\'s invites and labels');
});
