'use strict';

/**
 * #3311: the board's federation routes, end to end through server.js, with the
 * connector stubbed (remote.macRequest) so nothing reaches a coordinator.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.federation-3311.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fed-3311-'));
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

// The connector, stubbed: record what would be signed, answer like the coordinator.
const signedCalls = [];
remote.macRequest = async (method, route, body) => {
  signedCalls.push({ method, route, body });
  if (route === '/v1/mac/federation/invite') return { ok: true, data: { code: 'CODE-ABC', expires_at: 123 } };
  if (route === '/v1/mac/federation/verify') {
    if (body.code === 'USED') return { ok: false, because: 'that code has already been used. Ask for a new one.' };
    return { ok: true, data: { edge_id: 'edge-77', project_name: 'Tuesday Book Club', project_desc: 'We read one book a month.', owner_handle: 'reader' } };
  }
  return { ok: false, because: 'unexpected route ' + route };
};

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const SCREEN = { 'sec-fetch-site': 'same-origin' };
const post = async (route, body, headers) => {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('a process caller is refused before anything is signed', async () => {
  const before = signedCalls.length;
  for (const route of ['/api/federation/invite', '/api/federation/verify', '/api/federation/join']) {
    const r = await post(route, { project_ref: 'r', project_name: 'n', invited_kind: 'person', code: 'X', edge_id: 'e' });
    assert.equal(r.status, 403, route + ': ' + JSON.stringify(r.json));
    assert.match(r.json.error, /person at the Kosmos screen/);
  }
  assert.equal(signedCalls.length, before, 'no Mac signature for a process caller');
});

test('invite from the screen signs the Mac route and returns the code', async () => {
  const r = await post('/api/federation/invite', { project_ref: 'ref-1', project_name: 'Book Club', invited_kind: 'agent' }, SCREEN);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { code: 'CODE-ABC', expires_at: 123 });
  assert.equal(signedCalls.at(-1).route, '/v1/mac/federation/invite');
});

test('verify then join makes the project from the coordinator snapshot, not the page', async () => {
  const v = await post('/api/federation/verify', { code: 'CODE-ABC' }, SCREEN);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.edge_id, 'edge-77');

  // The page sends only the edge and its agents; a stray name is ignored.
  const j = await post('/api/federation/join', { edge_id: 'edge-77', agents: [], name: 'Something Else' }, SCREEN);
  assert.equal(j.status, 200, JSON.stringify(j.json));
  const made = projects.readAll().find((p) => p.id === j.json.id);
  assert.ok(made, 'the joined project exists');
  assert.equal(made.name, 'Tuesday Book Club', 'named from the snapshot');
  const link = federation.linkFor(j.json.id);
  assert.equal(link.role, 'member');
  assert.equal(link.edge_id, 'edge-77');

  // The snapshot is spent: joining again with the same edge is refused.
  const again = await post('/api/federation/join', { edge_id: 'edge-77', agents: [] }, SCREEN);
  assert.equal(again.status, 409, JSON.stringify(again.json));
});

test('join refuses an edge this board never verified', async () => {
  const j = await post('/api/federation/join', { edge_id: 'edge-never', agents: [] }, SCREEN);
  assert.equal(j.status, 409, JSON.stringify(j.json));
});

test('a verify refusal reaches the page as its reason', async () => {
  const v = await post('/api/federation/verify', { code: 'USED' }, SCREEN);
  assert.equal(v.status, 409, JSON.stringify(v.json));
  assert.equal(v.json.reason, 'already-used');
});

test('creating a project with the ref its invites were minted with records the owner link', async () => {
  const r = await post('/api/projects', { name: 'Owned Club', federation_ref: 'ref-owner-1' }, SCREEN);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.federationLinked, true);
  assert.deepEqual(federation.linkFor(r.json.id), { role: 'owner', ref: 'ref-owner-1' });

  const plain = await post('/api/projects', { name: 'Plain Club' }, SCREEN);
  assert.equal(plain.json.federationLinked, undefined, 'no ref, no link and no claim of one');
  assert.equal(federation.linkFor(plain.json.id), null);
});
