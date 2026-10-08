'use strict';
/* kosmos#5531 (Enterprise E0.2): enrolling ONE work Kosmos, with consent before anything binds.
   Done-when (the card): on a board with two worlds, enrolling one sends nothing about the other (every outbound
   payload is read), and declining sends nothing at all. Every world here is its own temp data root, as
   engine/worlds.js gives each world its own; the signed remote is a fake that records every request it is asked
   to sign. Nothing touches the real data root or the real coordinator. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const org = require('./orgenroll');

const CONSENT = {
  reports: ['agent names, the AI provider and model each uses', 'project names'],
  backsUp: ['agent folders and their files', 'transcripts'],
  readers: ['you', "your company's recovery role, only by restoring it"],
  never: ['your other Kosmoses on this computer', 'keys and passwords'],
};
const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/* A fake coordinator behind a fake tunnel: records every signed request, answers per route. */
function fakeRemote(state) {
  const sent = [];
  return {
    sent,
    macRequest: async (method, route, body) => {
      sent.push({ method, route, body: body == null ? null : JSON.parse(JSON.stringify(body)) });
      if (route === org.ROUTES.redeem) return { ok: true, data: { org: ORG, role: 'member', consent: CONSENT } };
      if (route === org.ROUTES.enroll) {
        state.member = true; state.world = body.world;
        return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
      }
      if (route === org.ROUTES.leave) { state.member = false; state.world = null; return { ok: true, data: { ok: true } }; }
      if (route === org.ROUTES.status) {
        return { ok: true, data: state.member ? { member: true, org: ORG, role: 'member', enrolled: state.world ? { computer: 'c1', world: state.world, thisComputer: state.thisComputer !== false } : null } : { member: false } };
      }
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgenroll-5531-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = path.join(dir, 'worldA'), b = path.join(dir, 'worldB');
  fs.mkdirSync(a); fs.mkdirSync(b);
  return { a, b };
}

test('#5531 done-when: enrolling world A sends nothing about world B, and every request is one of the four contract routes, signed as POST', async (t) => {
  const { a, b } = sandbox(t);
  const state = {};
  const remote = fakeRemote(state);
  const idB = org.worldId({ root: b });   // world B exists and has an id, so a leak of it would be visible
  assert.match(idB, /^[0-9a-f]{32}$/);
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote });
  assert.equal(p.ok, true, JSON.stringify(p));
  const e = await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(e.ok, true, JSON.stringify(e));
  await org.refresh({ root: a, remote });
  const all = JSON.stringify(remote.sent);
  assert.ok(!all.includes(idB), 'world B was named to the coordinator: ' + all);
  assert.ok(!all.includes(b), "world B's folder appeared in a payload");
  assert.ok(!all.includes('worldB') && !all.includes('worldA'), 'a world folder name appeared in a payload');
  for (const r of remote.sent) {
    assert.equal(r.method, 'POST', 'the tunnel signs only POSTs with a JSON body: ' + JSON.stringify(r));
    assert.ok(Object.values(org.ROUTES).includes(r.route), 'a request outside the contract: ' + r.route);
  }
  assert.deepEqual(remote.sent.map((r) => r.route), [org.ROUTES.redeem, org.ROUTES.enroll, org.ROUTES.status]);
  assert.deepEqual(Object.keys(remote.sent[1].body).sort(), ['accepted', 'code', 'world'], 'enroll sends more than the contract');
  assert.equal(remote.sent[1].body.world, org.worldId({ root: a }), 'enroll did not name world A by its opaque id');
  // The gate: only world A is enrolled here.
  assert.equal(org.isEnrolledHere({ root: a }), true);
  assert.equal(org.isEnrolledHere({ root: b }), false, 'world B reads as enrolled');
});

test('#5531 done-when: declining sends nothing at all (no request of any kind)', async (t) => {
  const { a } = sandbox(t);
  const remote = fakeRemote({});
  for (const answer of [false, undefined, 'true', 1, null]) {
    const r = await org.enroll('ACME-JOIN-1234', answer, { root: a, remote });
    assert.equal(r.ok, false); assert.equal(r.declined, true, 'not treated as a decline: ' + JSON.stringify(answer));
  }
  assert.equal(remote.sent.length, 0, 'declining sent: ' + JSON.stringify(remote.sent));
  assert.equal(org.isEnrolledHere({ root: a }), false);
  assert.equal(org.readEnrollment({ root: a }), null);
});

test('#5531: preview binds nothing locally, refuses a malformed code without a request, and an empty consent is no consent', async (t) => {
  const { a } = sandbox(t);
  const remote = fakeRemote({});
  for (const bad of ['', 'a b c d e f', '<script>', 'x'.repeat(200), 12345678]) {
    const r = await org.preview(bad, { root: a, remote });
    assert.equal(r.ok, false, 'accepted a malformed code: ' + JSON.stringify(bad));
  }
  assert.equal(remote.sent.length, 0, 'a malformed code was sent');
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote });
  assert.equal(p.ok, true);
  assert.equal(org.readEnrollment({ root: a }), null, 'a preview wrote an enrollment');
  assert.equal(org.cleanConsent({ reports: [], backsUp: [], readers: ['you'], never: [] }), null, 'an empty consent was offered');
  assert.equal(org.cleanConsent({ reports: ['x'], backsUp: [], readers: [], never: [] }), null, 'a consent naming no reader was offered');
  const empty = { macRequest: async () => ({ ok: true, data: { org: ORG, role: 'member', consent: { reports: [], backsUp: [], readers: [], never: [] } } }) };
  const r = await org.preview('ACME-JOIN-1234', { root: a, remote: empty });
  assert.equal(r.ok, false, 'Join was offered on an empty consent');
});

test('#5531: enroll records nothing unless the company confirms THIS world', async (t) => {
  const { a } = sandbox(t);
  const lying = { macRequest: async () => ({ ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: 'f'.repeat(32), thisComputer: true } } }) };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: lying });
  assert.equal(r.ok, false);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'enrolled although the company named another world');
});

test('#5531: refresh stops this world at once on member:false, or when the company names another world; an unreachable coordinator changes nothing', async (t) => {
  const { a } = sandbox(t);
  const state = {};
  const remote = fakeRemote(state);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(org.isEnrolledHere({ root: a }), true);
  const down = { macRequest: async () => ({ ok: false, because: 'offline' }) };
  const off = await org.refresh({ root: a, remote: down });
  assert.equal(off.ok, false);
  assert.equal(org.isEnrolledHere({ root: a }), true, 'an unreachable coordinator un-enrolled this world');
  state.world = 'e'.repeat(32);   // the person enrolled another world (or Mac) instead
  const moved = await org.refresh({ root: a, remote });
  assert.equal(moved.enrolled, false); assert.equal(moved.stopped, true);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'still reporting after the enrollment moved elsewhere');
  await org.enroll(null, true, { root: a, remote });   // an existing member re-enrolls with no code
  assert.equal(org.isEnrolledHere({ root: a }), true);
  assert.ok(!('code' in remote.sent.at(-1).body), 'a re-enroll sent a code');
  state.member = false;   // removed by an admin
  const removed = await org.refresh({ root: a, remote });
  assert.equal(removed.member, false); assert.equal(removed.stopped, true);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'still reporting after being removed');
});

test('#5531: leave clears the record first, so this world stops even when the request fails', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const down = { macRequest: async () => ({ ok: false, because: 'offline' }) };
  const r = await org.leave({ root: a, remote: down });
  assert.equal(r.ok, false);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'still enrolled after a failed leave');
});

test('#5531: the world id is minted once, kept, owner-only, and the enrollment file is owner-only', async (t) => {
  const { a } = sandbox(t);
  const id1 = org.worldId({ root: a }); const id2 = org.worldId({ root: a });
  assert.equal(id1, id2, 'the id changed between reads');
  assert.equal(fs.statSync(path.join(a, org.WORLD_ID_FILE)).mode & 0o777, 0o600);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  assert.equal(fs.statSync(path.join(a, org.ENROLLMENT_FILE)).mode & 0o777, 0o600);
});

test('#5531: the coordinator\'s public error codes are said in plain words; an unknown error keeps its own', async (t) => {
  const { a } = sandbox(t);
  const said = (because) => ({ macRequest: async () => ({ ok: false, because }) });
  const used = await org.preview('ACME-JOIN-1234', { root: a, remote: said('HTTP 400: {"because":"org_code_used"}') });
  assert.equal(used.code, 'org_code_used'); assert.equal(used.because, org.SAY.org_code_used);
  const dom = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: said('403 org_wrong_domain') });
  assert.match(dom.because, /own email address/);
  const odd = await org.preview('ACME-JOIN-1234', { root: a, remote: said('the tunnel program did not answer in time') });
  assert.equal(odd.code, null); assert.equal(odd.because, 'the tunnel program did not answer in time');
  const last = await org.leave({ root: a, remote: said('409 org_last_admin') });
  assert.match(last.because, /last admin/);
});

test('#5531: already in that company, a code is refused (org_already_member) and the enrollment moves the member way, with no code', async (t) => {
  const { a } = sandbox(t);
  const sent = [];
  const remote = { macRequest: async (m, route, body) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    if (body.code) return { ok: false, because: '409 {"because":"org_already_member"}' };
    return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
  } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sent.length, 2, 'not exactly one retry: ' + JSON.stringify(sent));
  assert.ok(!('code' in sent[1]), 'the retry sent the code again');
  assert.equal(org.isEnrolledHere({ root: a }), true);
  // CONTROL: any other refusal is not retried.
  const { b } = sandbox(t);
  let n = 0;
  const other = { macRequest: async () => { n += 1; return { ok: false, because: '400 org_code_used' }; } };
  await org.enroll('ACME-JOIN-1234', true, { root: b, remote: other });
  assert.equal(n, 1, 'a used code was retried');
});

test('#5531 (#5530 review 2): a world whose id was copied to another Mac does not report there: thisComputer must be true', async (t) => {
  const { a } = sandbox(t);
  const state = {};
  const remote = fakeRemote(state);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(org.isEnrolledHere({ root: a }), true);
  state.thisComputer = false;   // same world id, but the company says another Mac is the enrolled one
  const r = await org.refresh({ root: a, remote });
  assert.equal(r.enrolled, false); assert.equal(r.stopped, true);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'a copied world kept reporting from the second Mac');
  const { b } = sandbox(t);
  const notThis = { macRequest: async (m, route, body) => ({ ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } }) };
  const e = await org.enroll('ACME-JOIN-1234', true, { root: b, remote: notThis });
  assert.equal(e.ok, false); assert.equal(org.isEnrolledHere({ root: b }), false, 'enrolled although the company named another Mac');
});

test('#5531 (contract v1.3): a member of that company moving here sees the consent from status, then enrolls with no code', async (t) => {
  const { a } = sandbox(t);
  const sent = [];
  const remote = { macRequest: async (m, route, body) => {
    sent.push({ route, body: JSON.parse(JSON.stringify(body)) });
    if (route === org.ROUTES.redeem) return { ok: false, because: '409 org_already_member' };
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: null, consent: CONSENT } };
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    return { ok: false, because: 'unexpected' };
  } };
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote });
  assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(p.move, true);
  assert.deepEqual(p.consent.readers, CONSENT.readers, 'the move was offered without the consent');
  assert.equal(org.readEnrollment({ root: a }), null, 'the preview bound something');
  const e = await org.enroll(null, true, { root: a, remote });
  assert.equal(e.ok, true);
  assert.ok(!('code' in sent.at(-1).body), 'the move sent a code');
  // CONTROL: a status without consent offers no move.
  const { b } = sandbox(t);
  const bare = { macRequest: async (m, route) => route === org.ROUTES.redeem ? { ok: false, because: '409 org_already_member' } : { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: null } } };
  const q = await org.preview('ACME-JOIN-1234', { root: b, remote: bare });
  assert.equal(q.ok, false); assert.equal(q.because, org.SAY.org_already_member);
});
