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
  if (route === '/v1/mac/federation/verify') return { ok: true, data: { edge_id: 'edge-join-1b', project_name: 'Maya Spring', project_desc: '', owner_handle: 'maya' } };
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
  const made = projects.create({ name: 'Spring Launch', description: 'The spring launch plan.' });
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
  assert.equal(sent.project_desc, 'The spring launch plan.', 'the description sent is not the project\'s own on this board');

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

test('#4649 slice 1b: joining an outside project writes a join note that never names the owner, and Members says whose it is', async () => {
  const v = await call('POST', '/api/federation/verify', { code: 'ANY-CODE' }, SCREEN);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const j = await call('POST', '/api/federation/join', { edge_id: 'edge-join-1b', agents: [] }, SCREEN);
  assert.equal(j.status, 200, JSON.stringify(j.json));
  const notes = require('./engine/messages').record().rows.filter((m) => m.project === j.json.id && m.kind === 'note').map((m) => m.text);
  assert.ok(notes.includes('You joined this project from outside. Only its owner can invite people to it.'), JSON.stringify(notes));
  // Review round 1: the owner's freely chosen handle never goes into a note agents read as Kosmos's own voice.
  assert.ok(!notes.some((t) => /maya/.test(t)), 'the owner\'s handle reached a room note: ' + JSON.stringify(notes));
  const m = await call('GET', '/api/federation/members?project=' + encodeURIComponent(j.json.id), undefined, SCREEN);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.deepEqual([m.json.owner, m.json.owner_name, m.json.removed], [false, 'maya', false]);
});

test('#4649 slice 3: the room shows the owner\'s label on a stamped outside post; the account id never leaves the board', async () => {
  const fedmembers = require('./engine/fedmembers');
  const messages = require('./engine/messages');
  const made = projects.create({ name: 'Stamped Room' });
  const pid = made.id || (made.project && made.project.id);
  const inv = await call('POST', '/api/federation/invite', { project: pid, invited_kind: 'person', label: 'Dana Ruiz' }, SCREEN);
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.equal(fedmembers.noteMember(pid, inv.json.invite_id, 'acct-dana-777'), true);
  assert.ok(messages.externalPost(pid, { from: 'Scout', fromKind: 'agent', text: 'batch 1 checked', member: 'acct-dana-777' }));
  assert.ok(messages.externalPost(pid, { from: 'Eve', fromKind: 'person', text: 'from someone unknown', member: 'acct-unknown-1' }));
  const room = await call('GET', '/api/project/' + encodeURIComponent(pid) + '/room', undefined, SCREEN);
  assert.equal(room.status, 200, JSON.stringify(room.json).slice(0, 300));
  const body = JSON.stringify(room.json);
  assert.ok(!body.includes('acct-dana-777') && !body.includes('acct-unknown-1'), 'an account id reached the room answer');
  const ext = (room.json.messages || room.json.rows || []).filter((m) => m && m.kind === 'external');
  assert.equal(ext.find((m) => m.text === 'batch 1 checked').invited_as, 'Dana Ruiz');
  assert.equal(ext.find((m) => m.text === 'from someone unknown').invited_as, undefined);
  const all = await call('GET', '/api/messages', undefined, SCREEN);
  assert.equal(all.status, 200);
  assert.ok(!JSON.stringify(all.json).includes('acct-dana-777'), 'an account id reached /api/messages');
});

test('#4649 slice 3 review round 3: the room reads the invites record once per request, not once per stamped post', async () => {
  const fs2 = require('node:fs');
  const fedmembers = require('./engine/fedmembers');
  const messages = require('./engine/messages');
  const made = projects.create({ name: 'Busy Stamped Room' });
  const pid = made.id || (made.project && made.project.id);
  const inv = await call('POST', '/api/federation/invite', { project: pid, invited_kind: 'person', label: 'Kim' }, SCREEN);
  fedmembers.noteMember(pid, inv.json.invite_id, 'acct-kim-1');
  for (let i = 0; i < 50; i += 1) messages.externalPost(pid, { from: 'Kim', fromKind: 'person', text: 'post ' + i, member: 'acct-kim-1' });
  const real = fs2.readFileSync;
  let reads = 0;
  fs2.readFileSync = function (p, ...rest) { if (String(p).endsWith(fedmembers.FILE)) reads += 1; return real.call(this, p, ...rest); };
  let room;
  try { room = await call('GET', '/api/project/' + encodeURIComponent(pid) + '/room', undefined, SCREEN); } finally { fs2.readFileSync = real; }
  assert.equal(room.status, 200);
  const labelled = (room.json.messages || room.json.rows || []).filter((m) => m && m.invited_as === 'Kim').length;
  assert.equal(labelled, 50, 'precondition: every stamped post is labelled');
  assert.equal(reads, 1, 'the invites record was read ' + reads + ' times for one room request');
});
