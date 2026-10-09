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
  assert.deepEqual(none.json, { enrolled: false, reporting: false, stoppedFor: null, leaveRefused: null, leaveRefusedUndo: false, org: null, role: null, enrolledAt: null });
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
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: CONSENT, consentHash: '7a'.repeat(32) } };
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    if (route === oe.ROUTES.status) { const w = oe.worldId(); return { ok: true, data: { member: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: w, thisComputer: true } } }; }
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
  assert.equal(JSON.parse(fs.readFileSync(enrollmentFile(), 'utf8')).consentHash, '7a'.repeat(32), 'the consent shown (the hash the company served with it) was not kept with the enrollment');
  assert.equal('consentHash' in ok.json, false, 'a field outside the page list reached the page (review 12): ' + JSON.stringify(ok.json));
  const again = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv2.json.ticket }, headers: SCREEN });
  assert.match(again.json.because || '', REFUSED, 'a ticket was used twice');
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5531 review 6 and 12: an agent reading /api/org learns only whether this Kosmos is enrolled', async (t) => {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(enrollmentFile(), { force: true }); });
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'admin', world: oe.worldId(), enrolledAt: '2026-10-07T00:00:00.000Z' }));
  const asLeo = await call('/api/org', { method: 'GET', headers: { 'x-kosmos-agent-token': sendertoken.mint('leo').token } });
  assert.equal(asLeo.json.enrolled, true);
  assert.equal(asLeo.json.org, null, 'an agent learned which company (review 12): ' + JSON.stringify(asLeo.json));
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
  let bound = null;
  remote.macRequest = async (method, route, body) => {
    sent.push(route);
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: CONSENT } };
    // Not sent (refused on this computer, review 27): certainly nothing bound, so the ticket is kept for a retry.
    if (route === oe.ROUTES.enroll) { if (up === 'timeout') return { ok: false, because: 'the tunnel program did not answer in time' }; if (up) bound = body.world; return up ? { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } } : { ok: false, notSent: true, because: 'this computer is not connected to Kosmos+' }; }
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    // A real coordinator names this world only once an enroll went through (#5531 review 19 asks status after a timeout).
    if (route === oe.ROUTES.status) return { ok: true, data: bound ? { member: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: bound, thisComputer: true } } : { member: false } };
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
  // Review 27: a timeout may have spent the code, so it is an unknown outcome with a code, and its ticket is NOT kept.
  bound = null; up = 'timeout';
  t.after(() => { try { fs.rmSync(path.join(store.ROOT, 'org-join-unknown.json'), { force: true }); } catch { /* none */ } });
  const pv2 = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  const lost = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv2.json.ticket }, headers: SCREEN });
  assert.equal(lost.json.code, 'org_join_unknown', JSON.stringify(lost.json));
  const again = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv2.json.ticket }, headers: SCREEN });
  assert.equal(again.json.code, 'org_ticket', 'a ticket for a code that may be spent was kept: ' + JSON.stringify(again.json));
});

test('#5531 review 9: the stopped note is shown to the screen once; org_bad_world keeps the ticket', async (t) => {
  fs.writeFileSync(path.join(store.ROOT, 'org-stopped.json'), JSON.stringify({ at: '2026-10-07T00:00:00.000Z', name: 'Acme' }));
  const first = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(first.json.stoppedFor, 'Acme');
  const second = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(second.json.stoppedFor, null, 'the stopped note came back on every visit');

  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  const CONSENT = { reports: ['agent names'], backsUp: ['agent folders'], readers: ['you'], never: ['keys'] };
  let bad = true;
  remote.macRequest = async (method, route, body) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: CONSENT } };
    if (route === oe.ROUTES.enroll) return bad ? { ok: false, because: '400 {"because":"org_bad_world"}' } : { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    if (route === oe.ROUTES.status) { const w = oe.worldId(); return { ok: true, data: { member: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: w, thisComputer: true } } }; }
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  const r1 = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(r1.json.code, 'org_bad_world');
  bad = false;
  const r2 = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(r2.json.ok, true, '"Try again" after org_bad_world could never work: ' + JSON.stringify(r2.json));
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5531 review 11: a failed join does not put its old ticket back over a newer screen\'s', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  const CONSENT = { reports: ['agent names'], backsUp: ['agent folders'], readers: ['you'], never: ['keys'] };
  let release; const held = new Promise((r) => { release = r; });
  let enrolls = 0;
  let bound = null;
  remote.macRequest = async (method, route, body) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: CONSENT } };
    if (route === oe.ROUTES.enroll) {
      enrolls += 1;
      if (enrolls === 1) { await held; return { ok: false, because: 'the tunnel program did not answer in time' }; }
      bound = body.world;
      return { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    }
    if (route === oe.ROUTES.status) return { ok: true, data: bound ? { member: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: bound, thisComputer: true } } : { member: false } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  const first = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  const out = call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: first.json.ticket }, headers: SCREEN });
  await new Promise((r) => setTimeout(r, 50));   // the first join is out, held at the coordinator
  const second = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });   // a second screen
  release();
  assert.equal((await out).json.ok, false);
  const r = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: second.json.ticket }, headers: SCREEN });
  assert.equal(r.json.ok, true, 'the newer screen\'s ticket was replaced by the failed join\'s: ' + JSON.stringify(r.json));
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5531 review 21: a retried leave refused as the last admin is shown to the screen once', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  let mode = 'ok';
  remote.macRequest = async (method, route, body) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: { reports: ['agent names'], backsUp: ['agent folders'], readers: ['you'], never: ['keys'] } } };
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: oe.worldId(), thisComputer: true } } };
    if (route === oe.ROUTES.leave) return mode === 'offline' ? { ok: false, because: 'offline' } : { ok: false, because: '409 {"because":"org_last_admin"}' };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); oe.clearLeaveRefused(); });
  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  mode = 'offline';
  const left = await call('/api/org/leave', { body: {}, headers: SCREEN });
  assert.equal(left.json.pending, true, JSON.stringify(left.json));
  mode = 'admin';
  await oe.refresh();
  const first = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(first.json.enrolled, true); assert.equal(first.json.leaveRefused, 'Acme', JSON.stringify(first.json));
  const second = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(second.json.leaveRefused, null, 'the note was shown more than once');
});

test('#5531 review 13: a HEAD from the screen does not use up the stopped note', async () => {
  fs.writeFileSync(path.join(store.ROOT, 'org-stopped.json'), JSON.stringify({ at: '2026-10-07T00:00:00.000Z', name: 'Acme' }));
  await call('/api/org', { method: 'HEAD', headers: SCREEN });
  const shown = await call('/api/org', { method: 'GET', headers: SCREEN });
  assert.equal(shown.json.stoppedFor, 'Acme', 'a HEAD cleared the note before any screen showed it');
});

test('#5531 review 14: a page on another website cannot leave, join or preview (the board-wide cross-site write guard)', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  const sent = [];
  remote.macRequest = async (m, route) => { sent.push(route); return { ok: true, data: { ok: true } }; };
  t.after(() => { remote.macRequest = orig; });
  for (const p of ['/api/org/leave', '/api/org/enroll', '/api/org/preview']) {
    const r = await call(p, { body: { code: 'ACME-JOIN-1234', accepted: true }, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', 'content-type': 'text/plain' } });
    assert.equal(r.status, 403, p + ' answered another website: ' + JSON.stringify(r));
  }
  assert.deepEqual(sent, [], 'a cross-site request reached the company');
});

test('#5531 review 26: an unknown join is asked about every few minutes while its marker exists, not only daily (start() source pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const ms = src.match(/const ORG_UNSURE_MS = ([0-9* ]+);/);
  assert.ok(ms, 'no short follow-up interval for an unknown join');
  const val = Function('return ' + ms[1])();
  assert.ok(val > 0 && val <= 5 * 60 * 1000, 'the follow-up is slower than the few minutes the person is told: ' + val);
  const start = src.slice(src.indexOf('function start(port = PORT)'));
  assert.match(start.slice(0, 4000), /if \(oe\.joinUnknown\(\) && age !== null && age < 24 \* 60 \* 60 \* 1000\) orgEnrollRefresh\(\);/, 'start() does not run the short follow-up only while the marker exists (and only for a day)');
});

test('#5531 review 32: a code that is not text is refused before the screen\'s ticket is touched', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  remote.macRequest = async (method, route, body) => (route === oe.ROUTES.redeem
    ? { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: { reports: ['agent names'], backsUp: [], readers: ['you'], never: [] } } }
    : route === oe.ROUTES.enroll ? { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }
    : { ok: true, data: { ok: true } });
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  const pv = await call('/api/org/preview', { body: { code: '1234-5678' }, headers: SCREEN });
  const bad = await call('/api/org/enroll', { body: { code: 12345678, accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(bad.json.ok, false); assert.match(bad.json.because, /not a join code/);
  // CONTROL: the screen's own ticket still works for the code it previewed.
  const good = await call('/api/org/enroll', { body: { code: '1234-5678', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(good.json.ok, true, 'the malformed request used up the screen\'s ticket: ' + JSON.stringify(good.json));
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5531 review 37: the screen\'s ticket carries the previewed company to the join, so another company named here is not this join', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  remote.macRequest = async (method, route) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_beta', name: 'Beta', slug: 'beta' }, role: 'member', consent: { reports: ['agent names'], backsUp: [], readers: ['you'], never: [] } } };
    if (route === oe.ROUTES.enroll) return { ok: false, because: 'the tunnel program did not answer in time' };
    if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'org_alpha', name: 'Alpha', slug: 'alpha' }, role: 'member', enrolled: { computer: 'c1', world: oe.worldId(), thisComputer: true } } };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); try { fs.rmSync(path.join(store.ROOT, 'org-join-unknown.json'), { force: true }); } catch { /* none */ } });
  const pv = await call('/api/org/preview', { body: { code: 'BETA-JOIN-5678' }, headers: SCREEN });
  const r = await call('/api/org/enroll', { body: { code: 'BETA-JOIN-5678', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.notEqual(r.json.ok, true, 'Alpha (named here) was taken as the Beta join landing: ' + JSON.stringify(r.json));
  assert.equal(oe.isEnrolledHere(), false, 'Alpha was recorded on Beta\'s consent');
});

test('#5531 follow-up b: the company\'s served consent hash goes back on enroll and is the one recorded; the page never sees it', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  const SERVED = '5e'.repeat(32);
  let enrollBody = null;
  let served = SERVED;
  remote.macRequest = async (method, route, body) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: { reports: ['agent names'], backsUp: [], readers: ['you'], never: [] }, consentHash: served } };
    if (route === oe.ROUTES.enroll) { enrollBody = body; return { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }; }
    return { ok: true, data: { ok: true } };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  assert.equal(JSON.stringify(pv.json).includes(SERVED), false, 'the served hash reached the page');
  const r = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(enrollBody.consentHash, SERVED, 'the enroll did not carry the hash the company served');
  assert.equal(oe.readEnrollment().consentHash, SERVED, 'the record kept a hash computed here, not the served one');
  await call('/api/org/leave', { body: {}, headers: SCREEN });
  // A company that serves none: nothing is sent and nothing is recorded, so mayReport fails closed.
  served = undefined; enrollBody = null;
  const pv2 = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  const r2 = await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv2.json.ticket }, headers: SCREEN });
  assert.equal(r2.json.ok, true, JSON.stringify(r2.json));
  assert.equal('consentHash' in enrollBody, false, 'a hash computed here was sent to a company that serves none');
  // consenthash review 2: no hash served, none recorded: mayReport fails closed (the company could never match one).
  assert.equal(oe.readEnrollment().consentHash, undefined, 'a hash the company never served was recorded');
  assert.equal(oe.mayReport(), false, 'a join with no served hash may report, though every rollup would be refused');
  assert.equal(oe.isEnrolledHere(), true, 'CONTROL: it is still the work Kosmos');
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5531 follow-up b review 1: a malformed served hash is never echoed or recorded (mayReport fails closed)', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  let enrollBody = null;
  remote.macRequest = async (method, route, body) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: { reports: ['agent names'], backsUp: [], readers: ['you'], never: [] }, consentHash: 'AB'.repeat(32) } };
    if (route === oe.ROUTES.enroll) { enrollBody = body; return { ok: true, data: { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }; }
    return { ok: true, data: { ok: true } };
  };
  t.after(() => { remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  const pv = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  await call('/api/org/enroll', { body: { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.json.ticket }, headers: SCREEN });
  assert.equal('consentHash' in enrollBody, false, 'a malformed served hash was echoed');
  assert.notEqual(oe.readEnrollment().consentHash, 'AB'.repeat(32));
  assert.equal(oe.mayReport(), false, 'a malformed served hash left a join that may report');
  await call('/api/org/leave', { body: {}, headers: SCREEN });
});

test('#5532 rollup review 10: the joined view says "reports" only when the rollup has accepted words to send under', async (t) => {
  const ACME = { id: 'org_1', name: 'Acme', slug: 'acme' };
  t.after(() => { fs.rmSync(enrollmentFile(), { force: true }); fs.rmSync(path.join(store.ROOT, oe.CONSENT_FILE), { force: true }); });
  const H = 'ab'.repeat(32);
  // An enrollment with a consent hash but no remembered words (one written before the words were kept, say).
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: ACME, role: 'member', world: oe.worldId(), enrolledAt: '2026-10-08T00:00:00.000Z', consentHash: H }));
  const st = async () => {
    const remote = require('./engine/remote'); const orig = remote.macRequest;
    remote.macRequest = async () => ({ ok: true, data: { member: true, org: ACME, role: 'member', enrolled: { computer: 'c1', world: oe.worldId(), thisComputer: true } } });
    try { return (await call('/api/org', { method: 'GET', headers: SCREEN })).json; } finally { remote.macRequest = orig; }
  };
  const before = await st();
  assert.equal(before.enrolled, true, JSON.stringify(before));
  assert.equal(before.reporting, false, 'the view said it reports, but the rollup has no accepted words and sends nothing');
  fs.writeFileSync(path.join(store.ROOT, oe.CONSENT_FILE), JSON.stringify({ order: [H], byHash: { [H]: { reports: ['agent names'], usageConsented: false } } }));
  assert.equal((await st()).reporting, true, 'CONTROL: with the words remembered, it reports');
});

test('#5532 rollup review 24: start() arms the rollup tick, and the joined view says it waits when the rollup waits for a print', async (t) => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = src.slice(src.indexOf('function start(port = PORT)'));
  const body = start.slice(0, start.indexOf('\n}\n'));
  assert.match(body, /setTimeout\(orgRollupTick, /, 'start() never runs the first rollup');
  assert.match(body, /setInterval\(orgRollupTick, ORG_ROLLUP_TICK_MS\)/, 'start() never runs the rollup on its tick');
  // Review 28: the tick sends only under live execution, checked before anything is read or sent.
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const fn = serverSrc.slice(serverSrc.indexOf('function orgRollupTick()'), serverSrc.indexOf('\n}\n', serverSrc.indexOf('function orgRollupTick()')));
  const gate = fn.indexOf('if (!liveExecution.liveExecutionAllowed()) return;');
  assert.ok(gate > 0 && gate < fn.indexOf("require('./engine/orgrollup').tick()"), 'the rollup tick is not gated on live execution before it sends');
  // The route: words remembered, but the rollup's own state says it waits for a print: not "reports".
  const rollup = require('./engine/orgrollup');
  const ACME = { id: 'org_1', name: 'Acme', slug: 'acme' };
  const H = 'ab'.repeat(32);
  const stateFile = path.join(store.ROOT, rollup.STATE_FILE);
  t.after(() => { for (const f of [enrollmentFile(), path.join(store.ROOT, oe.CONSENT_FILE), stateFile]) fs.rmSync(f, { force: true }); });
  const rec = { org: ACME, role: 'member', world: oe.worldId(), enrolledAt: '2026-10-08T00:00:00.000Z', consentHash: H };
  fs.writeFileSync(enrollmentFile(), JSON.stringify(rec));
  fs.writeFileSync(path.join(store.ROOT, oe.CONSENT_FILE), JSON.stringify({ order: [H], byHash: { [H]: { reports: ['agent names'], usageConsented: false } } }));
  const enrolledAs = rec.world + '|' + ACME.id + '|' + rec.enrolledAt;
  const remote = require('./engine/remote'); const orig = remote.macRequest;
  remote.macRequest = async () => ({ ok: true, data: { member: true, org: ACME, role: 'member', enrolled: { computer: 'c1', world: oe.worldId(), thisComputer: true } } });
  t.after(() => { remote.macRequest = orig; });
  fs.writeFileSync(stateFile, JSON.stringify({ enrolledAs }));
  assert.equal((await call('/api/org', { method: 'GET', headers: SCREEN })).json.reporting, true, 'CONTROL: with the words and no wait, it reports');
  fs.writeFileSync(stateFile, JSON.stringify({ enrolledAs, printWaitAt: Date.now() - 1000 }));
  assert.equal((await call('/api/org', { method: 'GET', headers: SCREEN })).json.reporting, false, 'the view said it reports while the rollup waited for a print');
});

test('#5531 follow-up: a company\'s stated empty backed-up list reaches the screen through the real preview route', async (t) => {
  const remote = require('./engine/remote');
  const orig = remote.macRequest;
  let backsUp = [];
  remote.macRequest = async (method, route) => (route === oe.ROUTES.redeem
    ? { ok: true, data: { org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: { reports: ['agent names'], backsUp, readers: ['you'], never: [] } } }
    : { ok: false, because: 'unexpected ' + route });
  t.after(() => { remote.macRequest = orig; });
  const said = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  assert.equal(said.json.ok, true, JSON.stringify(said.json));
  assert.equal(said.json.consent.backsUpNone, true, 'the stated empty list did not reach the screen: ' + JSON.stringify(said.json.consent));
  // CONTROL: a company that sends a list is not told "nothing is backed up".
  backsUp = ['agent folders'];
  const listed = await call('/api/org/preview', { body: { code: 'ACME-JOIN-1234' }, headers: SCREEN });
  assert.equal(listed.json.consent.backsUpNone, false);
});
