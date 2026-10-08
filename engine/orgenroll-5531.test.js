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

test('#5531: the coordinator\'s public error codes are said in plain words; an unknown error is a fixed sentence', async (t) => {
  const { a } = sandbox(t);
  const said = (because) => ({ macRequest: async () => ({ ok: false, because }) });
  const used = await org.preview('ACME-JOIN-1234', { root: a, remote: said('HTTP 400: {"because":"org_code_used"}') });
  assert.equal(used.code, 'org_code_used'); assert.equal(used.because, org.SAY.org_code_used);
  const dom = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: said('403 org_wrong_domain') });
  assert.match(dom.because, /own email address/);
  const odd = await org.preview('ACME-JOIN-1234', { root: a, remote: said('the tunnel program did not answer in time') });
  assert.equal(odd.code, null); assert.match(odd.because, /could not be checked through Kosmos\+/);   // review 4: an unknown error is a fixed sentence, the raw line goes to the log
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });   // leave is sent only from the work Kosmos
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

test('#5531 review 1: leave is reconciled: refused as the last admin you stay joined; no answer is retried later; not a member is left', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const lastAdmin = { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) };
  const r1 = await org.leave({ root: a, remote: lastAdmin });
  assert.equal(r1.still, true); assert.match(r1.because, /last admin/);
  assert.equal(org.isEnrolledHere({ root: a }), true, 'the last admin was silently un-enrolled');
  assert.equal(org.leavePending({ root: a }), false);
  const sent = [];
  let up = false;
  const flaky = { macRequest: async (m, route) => { sent.push(route); return up ? { ok: true, data: { ok: true } } : { ok: false, because: 'offline' }; } };
  const r2 = await org.leave({ root: a, remote: flaky });
  assert.equal(r2.pending, true);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'still reporting while a leave is pending');
  assert.equal(org.leavePending({ root: a }), true);
  up = true;
  const r3 = await org.refresh({ root: a, remote: flaky });
  assert.equal(r3.ok, true); assert.equal(sent.at(-1), org.ROUTES.leave, 'the pending leave was not sent again');
  assert.equal(org.leavePending({ root: a }), false, 'the confirmed leave stayed pending');
  const { b } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: b, remote: fakeRemote({}) });
  const gone = await org.leave({ root: b, remote: { macRequest: async () => ({ ok: false, because: '404 org_not_member' }) } });
  assert.equal(gone.ok, true); assert.equal(org.leavePending({ root: b }), false);
});

test('#5531 review 1: the company name and consent lines are cleaned as outside names (no bidi override, no zero-width, bounded)', async (t) => {
  const { a } = sandbox(t);
  const RLO = String.fromCharCode(0x202e), ZWSP = String.fromCharCode(0x200b);
  const sly = { macRequest: async () => ({ ok: true, data: { org: { id: 'org_1', name: 'Ac' + ZWSP + 'me' + RLO + 'evil', slug: 'acme' }, role: 'member', consent: {
    reports: ['x'.repeat(5000)].concat(Array.from({ length: 40 }, (_, i) => 'line ' + i)), backsUp: ['files'], readers: ['you'], never: ['keys'] } } }) };
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote: sly });
  assert.equal(p.ok, true);
  assert.equal(p.org.name.includes(RLO) || p.org.name.includes(ZWSP), false, 'a bidi override or zero-width character reached the page: ' + JSON.stringify(p.org.name));
  assert.ok(p.consent.reports.length <= 12, 'an unbounded list: ' + p.consent.reports.length);
  assert.ok(p.consent.reports[0].length <= 300, 'an unbounded line');
  assert.equal(org.codeOf('409 {"org_id":"org_1","because":"org_already_member"}'), 'org_already_member', 'a field named org_id was read as the error');
});

test('#5531 review 2: joining again after an unconfirmed leave clears it, so the next pass does not send the old leave', async (t) => {
  const { a } = sandbox(t);
  const state = {};
  const remote = fakeRemote(state);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  await org.leave({ root: a, remote: { macRequest: async () => ({ ok: false, because: 'offline' }) } });
  assert.equal(org.leavePending({ root: a }), true);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(org.leavePending({ root: a }), false, 'the old leave survived a new join');
  const before = remote.sent.length;
  const r = await org.refresh({ root: a, remote });
  assert.equal(r.enrolled, true, 'the next pass un-enrolled a person who had just joined');
  assert.ok(!remote.sent.slice(before).some((x) => x.route === org.ROUTES.leave), 'the old leave was sent');
});

test('#5531 review 2: the daily pass and a leave run one at a time, so a pass that read "enrolled" cannot write the record back after the leave', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  let release;
  const gate = new Promise((r) => { release = r; });
  const remote = { macRequest: async (m, route) => {
    if (route === org.ROUTES.status) {   // the pass's read is slow, and says enrolled (true when it was asked)
      await gate;
      return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root: a }), thisComputer: true } } };
    }
    if (route === org.ROUTES.leave) return { ok: true, data: { ok: true } };
    return { ok: false, because: 'unexpected' };
  } };
  const refreshing = org.refresh({ root: a, remote });   // starts first, waits on its read
  const leaving = org.leave({ root: a, remote });       // the person leaves meanwhile
  release();
  await refreshing; await leaving;
  assert.equal(org.isEnrolledHere({ root: a }), false, 'a pass that read enrolled before the leave wrote the record back after it');
});

test('#5531 review 3: a pending leave later refused as the last admin restores the enrollment it cleared, and the pending words are plain', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const r1 = await org.leave({ root: a, remote: { macRequest: async () => ({ ok: false, because: 'offline' }) } });
  assert.equal(r1.pending, true);
  assert.match(r1.because, /could not be confirmed yet/, 'the pending leave carried the raw transport text: ' + r1.because);
  assert.equal(r1.because.includes('offline'), false);
  assert.equal(org.isEnrolledHere({ root: a }), false);
  const r2 = await org.refresh({ root: a, remote: { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) } });
  assert.equal(r2.still, true, JSON.stringify(r2));
  assert.equal(org.isEnrolledHere({ root: a }), true, 'the last admin\'s enrollment was lost by a retried leave');
  assert.equal(org.leavePending({ root: a }), false);
});

test('#5531 review 4: a failure with no public code reaches the page as a fixed sentence, never the raw tunnel line', async (t) => {
  const { a } = sandbox(t);
  const raw = 'the tunnel program could not be started: spawn /Users/someone/Library/kosmos-connector ENOENT';
  const errs = []; const orig = console.error; console.error = (m) => errs.push(String(m)); t.after(() => { console.error = orig; });
  const bad = { macRequest: async () => ({ ok: false, because: raw }) };
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote: bad });
  const e = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: bad });
  for (const r of [p, e]) {
    assert.equal(r.ok, false);
    assert.equal(/Users|ENOENT|spawn/.test(r.because), false, 'raw transport text reached the page: ' + r.because);
    assert.match(r.because, /Nothing was joined/);
  }
  assert.ok(errs.some((m) => m.includes('ENOENT')), 'the raw line was not kept in the log');
  const known = await org.preview('ACME-JOIN-1234', { root: a, remote: { macRequest: async () => ({ ok: false, because: '410 {"because":"org_code_used"}' }) } });
  assert.equal(known.code, 'org_code_used'); assert.equal(known.because, org.SAY.org_code_used);
});

test('#5531 review 7: refresh stops only on a clear answer, and says why; an odd answer changes nothing', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const world = org.worldId({ root: a });
  const answer = (data) => ({ macRequest: async () => ({ ok: true, data }) });
  for (const odd of [
    { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world } },                       // thisComputer missing
    { member: true, org: ORG, role: 'member', enrolled: {} },                                              // no world
    { member: true, org: ORG, role: 'member' },                                                            // enrolled missing
    { org: ORG },                                                                                          // member missing
  ]) {
    const r = await org.refresh({ root: a, remote: answer(odd) });
    assert.equal(org.isEnrolledHere({ root: a }), true, 'an odd answer ended the enrollment: ' + JSON.stringify(odd) + ' -> ' + JSON.stringify(r));
  }
  assert.equal(org.stoppedFor({ root: a }), null);
  await org.refresh({ root: a, remote: answer({ member: true, org: ORG, role: 'member', enrolled: null }) });
  assert.equal(org.isEnrolledHere({ root: a }), false, 'a member enrolled nowhere still reported');
  assert.equal(org.stoppedFor({ root: a }), 'Acme', 'the screen was not told why it stopped');
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  assert.equal(org.stoppedFor({ root: a }), null, 'a new join kept the old stopped note');
});

test('#5531 review 7: a confirmed leave retires this world id, so a later join is not linkable to the old one', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const first = org.worldId({ root: a });
  assert.equal((await org.leave({ root: a, remote: fakeRemote({}) })).ok, true);
  const state = {};
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote(state) });
  assert.notEqual(state.world, first, 'the same world id was sent again after a confirmed leave');
  const r = await org.leave({ root: a, remote: { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) } });
  assert.equal(r.still, true);
  assert.equal(org.worldId({ root: a }), state.world, 'a refused leave retired the id of a world still enrolled');
});

test('#5531 review 8: a world the company stopped naming leaves locally and sends nothing; its id is retired too', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const first = org.worldId({ root: a });
  await org.refresh({ root: a, remote: { macRequest: async () => ({ ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: 'e'.repeat(32), thisComputer: false } } }) } });
  assert.equal(org.stoppedFor({ root: a }), 'Acme');
  const sent = [];
  const r = await org.leave({ root: a, remote: { macRequest: async (m, route) => { sent.push(route); return { ok: true, data: { ok: true } }; } } });
  assert.equal(r.ok, true); assert.equal(r.localOnly, true);
  assert.deepEqual(sent, [], 'a world the company stopped naming ended the membership: ' + JSON.stringify(sent));
  assert.equal(org.stoppedFor({ root: a }), null);
  const state = {};
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote(state) });
  assert.notEqual(state.world, first, 'the stopped world reused its old id');
});

test('#5531 review 8: a join code is never written to the log, even inside a raw failure line', async (t) => {
  const { a } = sandbox(t);
  const errs = []; const orig = console.error; console.error = (m) => errs.push(String(m)); t.after(() => { console.error = orig; });
  const echo = { macRequest: async (m, route, body) => ({ ok: false, because: 'HTTP 502 for body ' + JSON.stringify(body) }) };
  await org.preview('SECRET-CODE-7777', { root: a, remote: echo });
  await org.enroll('SECRET-CODE-7777', true, { root: a, remote: echo });
  assert.ok(errs.length >= 2, 'nothing was logged: ' + JSON.stringify(errs));
  assert.equal(errs.some((m) => m.includes('SECRET-CODE-7777')), false, 'a join code reached the log: ' + errs.join(' | '));
});
