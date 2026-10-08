'use strict';
/**
 * kosmos#5531 (Enterprise E0.2): the board's routes. Joining or leaving a company is the PERSON's, from the screen
 * (isViaScreen): an agent token is refused before anything is read or sent. GET /api/org reports this world's own
 * record and sends nothing. The sandbox has no Kosmos+ identity, so a signed call is refused by engine/remote.js
 * before any tunnel runs: nothing here can reach a real coordinator.
 */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgenroll-5531-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgenroll-5531-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgenroll-5531-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgenroll-5531-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgenroll-5531-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');
const oe = require('./engine/orgenroll');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

async function call(p, { method = 'POST', body, headers } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const SCREEN = { 'sec-fetch-site': 'same-origin' };
const enrollmentFile = () => path.join(store.ROOT, oe.ENROLLMENT_FILE);

test('#5531: an agent cannot preview, join or leave a company; nothing is written', async (t) => {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => b.restore());
  assert.ok(store.ROOT.startsWith(SANDBOX), 'not sandboxed: ' + store.ROOT);
  const asLeo = { 'x-kosmos-agent-token': sendertoken.mint('leo').token };
  for (const p of ['/api/org/preview', '/api/org/enroll', '/api/org/leave']) {
    const r = await call(p, { body: { code: 'ACME-JOIN-1234', accepted: true }, headers: asLeo });
    assert.equal(r.status, 403, p + ' answered an agent: ' + JSON.stringify(r));
  }
  assert.equal(fs.existsSync(enrollmentFile()), false, 'an agent call wrote an enrollment');
});

test('#5531: from the screen, a decline sends nothing and records nothing; a preview reaches the engine', async () => {
  const no = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: false }, headers: SCREEN });
  assert.equal(no.status, 200);
  assert.equal(no.json.ok, false); assert.equal(no.json.declined, true, JSON.stringify(no.json));
  assert.equal(fs.existsSync(enrollmentFile()), false);
  // Not connected to Kosmos+ in the sandbox: the engine's signed call is refused before any tunnel, and says so.
  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  assert.equal(pv.status, 200);
  assert.equal(pv.json.ok, false);
  assert.match(pv.json.because, /Kosmos\+/, 'the preview did not reach the signed path: ' + JSON.stringify(pv.json));
  const bad = await call('/api/org/preview', { body: { code: 'not a code' }, headers: SCREEN });
  assert.match(bad.json.because, /not a join code/);
});

test('#5531: GET /api/org reports this world\'s own record, and only one that names this world', async () => {
  const none = await call('/api/org', { method: 'GET' });
  assert.deepEqual(none.json, { enrolled: false, org: null, role: null, enrolledAt: null });
  const world = oe.worldId();
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', world, enrolledAt: '2026-10-07T00:00:00.000Z' }));
  const yes = await call('/api/org', { method: 'GET' });
  assert.equal(yes.json.enrolled, true);
  assert.equal(yes.json.org.name, 'Acme');
  assert.equal(JSON.stringify(yes.json).includes(world), false, 'the world id was handed to the page');
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', world: 'f'.repeat(32), enrolledAt: '2026-10-07T00:00:00.000Z' }));
  const other = await call('/api/org', { method: 'GET' });
  assert.equal(other.json.enrolled, false, 'a record naming another world read as enrolled here');
  assert.equal(other.json.org, null, "another world's company was shown here");
  fs.rmSync(enrollmentFile(), { force: true });
});
