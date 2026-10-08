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
  assert.deepEqual(none.json, { enrolled: false, stoppedFor: null, leaveRefused: null, org: null, role: null, enrolledAt: null });
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
  assert.equal(JSON.parse(fs.readFileSync(enrollmentFile(), 'utf8')).consentHash, oe.consentHash(CONSENT), 'the consent shown was not kept with the enrollment');
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
  assert.match(start.slice(0, 4000), /if \(oe\.joinUnknown\(\) && \(age === null \|\| age < 24 \* 60 \* 60 \* 1000\)\) orgEnrollRefresh\(\);/, 'start() does not run the short follow-up only while the marker exists (and only for a day)');
});
