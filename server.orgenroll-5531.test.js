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
  const none = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.deepEqual(none.json, { enrolled: false, stoppedFor: null, org: null, role: null, enrolledAt: null });
  const world = oe.worldId();
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', world, enrolledAt: '2026-10-07T00:00:00.000Z' }));
  const yes = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(yes.json.enrolled, true);
  assert.equal(yes.json.org.name, 'Acme');
  assert.equal(JSON.stringify(yes.json).includes(world), false, 'the world id was handed to the page');
  assert.equal(JSON.stringify(yes.json).includes('org_1'), false, 'the org id was handed to the page');
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', world: 'f'.repeat(32), enrolledAt: '2026-10-07T00:00:00.000Z' }));
  const other = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(other.json.enrolled, false, 'a record naming another world read as enrolled here');
  assert.equal(other.json.org, null, "another world's company was shown here");
  fs.rmSync(enrollmentFile(), { force: true });
});

test('#5531 review 3: an accepted join needs the ticket a screen got from a preview; without it nothing is sent', async () => {
  const r = await call('/api/org/enroll', { body: { accepted: true }, headers: SCREEN });
  assert.equal(r.json.ok, false);
  assert.match(r.json.because, /Check the code again first/, 'an accepted join without a preview ticket was let through: ' + JSON.stringify(r.json));
  const forged = await call('/api/org/enroll', { body: { accepted: true, ticket: 'f'.repeat(32) }, headers: SCREEN });
  assert.match(forged.json.because, /Check the code again first/, 'a made-up ticket was accepted');
  assert.equal(fs.existsSync(enrollmentFile()), false);
});

test('#5531 review 5: a ticket from a preview IS accepted once, for the code that was previewed, and for no other', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  const CONSENT = { reports: ['agent names'], backsUp: ['agent folders'], readers: ['you'], never: ['keys'] };
  const sent = [];
  remote.macRequest = async (method, route, body) => {
    sent.push(route);
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: CONSENT } };
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  const REFUSED = /Check the code again first/;

  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  assert.equal(pv.json.ok, true, JSON.stringify(pv.json));
  assert.equal(typeof pv.json.ticket, 'string');
  assert.equal(JSON.stringify(pv.json).includes('org_1'), false, 'the preview handed the org id to the page');
  const other = await call('/api/org/enroll', { body: { code: 'OTHER-CODE-9999', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.match(other.json.because || '', REFUSED, 'a ticket for one code joined with another: ' + JSON.stringify(other.json));
  assert.equal(sent.includes(oe.ROUTES.enroll), false, 'an enroll was sent on a mismatched ticket');

  const pv2 = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  const ok = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv2.json.ticket }, headers: SCREEN });
  assert.equal(ok.json.ok, true, 'a real ticket for the previewed code was refused: ' + JSON.stringify(ok.json));
  assert.equal(JSON.stringify(ok.json).includes('org_1') || 'world' in ok.json, false, 'an engine id reached the page: ' + JSON.stringify(ok.json));
  const again = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv2.json.ticket }, headers: SCREEN });
  assert.match(again.json.because || '', REFUSED, 'a ticket was used twice');
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5531 review 6: an agent reading /api/org learns which company, and not the role or when', async (t) => {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(enrollmentFile(), { force: true }); });
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'admin', world: oe.worldId(), enrolledAt: '2026-10-07T00:00:00.000Z' }));
  const asLeo = await call('/api/org', { method: 'GET', headers: { 'x-kosmos-agent-token': sendertoken.mint('leo').token } });
  assert.equal(asLeo.json.enrolled, true);
  assert.equal(asLeo.json.org.name, 'Acme');
  assert.equal(asLeo.json.role, null, 'an agent read the role: ' + JSON.stringify(asLeo.json));
  assert.equal(asLeo.json.enrolledAt, null, 'an agent read the enrollment date');
  const screen = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(screen.json.role, 'admin', 'the screen lost the role');
});

test('#5531 review 7: a join that fails for a passing reason keeps its ticket; a refused ticket says so with a code; leave only from the work Kosmos', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  const CONSENT = { reports: ['agent names'], backsUp: ['agent folders'], readers: ['you'], never: ['keys'] };
  const sent = [];
  let up = false;
  remote.macRequest = async (method, route, body) => {
    sent.push(route);
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: CONSENT } };
    if (route === oe.ROUTES.enroll) return up ? { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } } : { ok: false, because: 'the tunnel program did not answer in time' };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });

  const notHere = await call('/api/org/leave', { body: {}, headers: SCREEN });
  assert.equal(notHere.json.ok, false);
  assert.equal(sent.includes(oe.ROUTES.leave), false, 'a Kosmos that is not the work Kosmos sent a leave');

  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  const fail = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(fail.json.ok, false);
  up = true;
  const retry = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(retry.json.ok, true, 'a retry after a passing failure was refused: ' + JSON.stringify(retry.json));
  const used = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(used.json.code, 'org_ticket', 'a refused ticket carried no code, so the page cannot go back: ' + JSON.stringify(used.json));
  const left = await call('/api/org/leave', { body: {}, headers: SCREEN });
  assert.equal(left.json.ok, true, 'the work Kosmos could not leave: ' + JSON.stringify(left.json));
});
