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
/* A coordinator that confirms this world on this computer when asked for status (as a real one does for the work
   Kosmos), and answers everything else as `other` does. `isUp` lets a test make status fail along with the rest. */
function here(root, other, isUp = () => true) {
  return {
    macRequest: async (m, route, body) => (route === org.ROUTES.status && isUp()
      ? { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root }), thisComputer: true } } }
      : other.macRequest(m, route, body)),
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
  const last = await org.leave({ root: a, remote: here(a, said('409 org_last_admin')) });
  assert.match(last.because, /last admin/);
});

test('#5531 (review 15): already in that company at Join, the code is refused and nothing moves on first-join words', async (t) => {
  const { a } = sandbox(t);
  const sent = [];
  const remote = { macRequest: async (m, route, body) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    if (body.code) return { ok: false, because: '409 {"because":"org_already_member"}' };
    return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
  } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.code, 'org_already_member');
  assert.match(r.because, /Press Connect Account again/);   // #5791: no words to read; connect again
  assert.equal(sent.length, 1, 'the enrollment was moved on a first-join consent: ' + JSON.stringify(sent));
  assert.equal(org.isEnrolledHere({ root: a }), false);
  // The member's own path still moves, with no code, once the page has shown the move wording.
  const mv = await org.enroll(null, true, { root: a, remote });
  assert.equal(mv.ok, true, JSON.stringify(mv));
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
  const r1 = await org.leave({ root: a, remote: here(a, lastAdmin) });
  assert.equal(r1.still, true); assert.match(r1.because, /last admin/);
  assert.equal(org.isEnrolledHere({ root: a }), true, 'the last admin was silently un-enrolled');
  assert.equal(org.leavePending({ root: a }), false);
  const sent = [];
  let up = false;
  const flaky = { macRequest: async (m, route) => { sent.push(route); return up ? { ok: true, data: { ok: true } } : { ok: false, because: 'offline' }; } };
  const r2 = await org.leave({ root: a, remote: here(a, flaky, () => up) });
  assert.equal(r2.pending, true);
  assert.equal(org.isEnrolledHere({ root: a }), false, 'still reporting while a leave is pending');
  assert.equal(org.leavePending({ root: a }), true);
  up = true;
  const r3 = await org.refresh({ root: a, remote: here(a, flaky, () => up) });
  assert.equal(r3.ok, true); assert.equal(sent.at(-1), org.ROUTES.leave, 'the pending leave was not sent again');
  assert.equal(org.leavePending({ root: a }), false, 'the confirmed leave stayed pending');
  const { b } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: b, remote: fakeRemote({}) });
  const gone = await org.leave({ root: b, remote: here(b, { macRequest: async () => ({ ok: false, because: '404 org_not_member' }) }) });
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
  const r2 = await org.refresh({ root: a, remote: here(a, { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) }) });
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
  }
  assert.match(p.because, /Nothing was joined/);
  // Review 19: an enroll with no answer and no status says it is not known, never "nothing was joined".
  assert.match(e.because, /not known yet/, e.because); assert.equal(e.unknown, true);
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

test('#5531 review 7: a confirmed leave retires this world id, so the old id is never sent again', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const first = org.worldId({ root: a });
  assert.equal((await org.leave({ root: a, remote: fakeRemote({}) })).ok, true);
  const state = {};
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote(state) });
  assert.notEqual(state.world, first, 'the same world id was sent again after a confirmed leave');
  const r = await org.leave({ root: a, remote: here(a, { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) }) });
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

test('#5531 review 9: an unreadable local world id is an unclear answer, and a code is kept out of the log in any case', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const idFile = path.join(a, org.WORLD_ID_FILE);
  fs.chmodSync(idFile, 0o000);   // there, but unreadable (review 14 made a MISSING file mean stale; this one is not)
  t.after(() => { try { fs.chmodSync(idFile, 0o600); } catch { /* removed with the sandbox */ } });
  await org.refresh({ root: a, remote: { macRequest: async () => ({ ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: 'e'.repeat(32), thisComputer: true } } }) } });
  assert.ok(fs.existsSync(path.join(a, org.ENROLLMENT_FILE)), 'an unreadable local id was read as the company moving on');
  fs.chmodSync(idFile, 0o600);
  assert.equal(org.stoppedFor({ root: a }), null);
  const errs = []; const orig = console.error; console.error = (m) => errs.push(String(m)); t.after(() => { console.error = orig; });
  await org.preview('Secret-Code-7777', { root: a, remote: { macRequest: async () => ({ ok: false, because: 'HTTP 502 for SECRET-CODE-7777' }) } });
  assert.ok(errs.length >= 1);
  assert.equal(errs.some((m) => /secret-code-7777/i.test(m)), false, 'the code reached the log in another case: ' + errs.join(' | '));
});

test('#5531 review 10: leave from a copied data folder asks first and sends nothing when the company says it is another computer', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const world = org.worldId({ root: a });
  const sent = [];
  const copy = { macRequest: async (m, route) => {
    sent.push(route);
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c-real', world, thisComputer: false } } };
    return { ok: true, data: { ok: true } };
  } };
  const r = await org.leave({ root: a, remote: copy });
  assert.equal(r.ok, true); assert.equal(r.localOnly, true, JSON.stringify(r));
  assert.deepEqual(sent, [org.ROUTES.status], 'a copy ended the real work Kosmos\'s membership: ' + JSON.stringify(sent));
  assert.equal(org.isEnrolledHere({ root: a }), false);
  assert.equal(org.leavePending({ root: a }), false);
  const state = {};
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote(state) });
  assert.notEqual(state.world, world, 'the copy kept the real work Kosmos\'s id and sent it again (review 11)');
});

test('#5531 review 10: the enrollment keeps a hash of the consent words that were shown', async (t) => {
  const { a } = sandbox(t);
  const h = org.consentHash(CONSENT);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(org.consentHash({ ...CONSENT, readers: ['someone else'] }), h, 'different words, same hash');
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}), consentHash: h });
  assert.equal(org.readEnrollment({ root: a }).consentHash, h);
  await org.refresh({ root: a, remote: here(a, fakeRemote({ member: true })) });
  assert.equal(org.readEnrollment({ root: a }).consentHash, h, 'a refresh dropped the consent hash');
});

test('#5531 review 12: a join the company accepted but this Kosmos cannot record is undone; ids stay out of the log', async (t) => {
  const { a } = sandbox(t);
  const state = {};
  const remote = fakeRemote(state);
  fs.mkdirSync(path.join(a, org.ENROLLMENT_FILE));   // a directory where the record goes: the write fails, the world id file still works
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote });
  assert.equal(r.ok, false);
  assert.match(r.because, /Joining was undone, so nothing was joined/);
  assert.deepEqual(remote.sent.map((x) => x.route), [org.ROUTES.enroll, org.ROUTES.leave], 'the join the company holds was not undone');
  assert.equal(state.member, false);
  const errs = []; const orig = console.error; console.error = (m) => errs.push(String(m)); t.after(() => { console.error = orig; });
  const id = 'ab'.repeat(16);
  await org.preview('ACME-JOIN-1234', { root: a, remote: { macRequest: async () => ({ ok: false, because: 'HTTP 502 world ' + id }) } });
  assert.ok(errs.length >= 1);
  assert.equal(errs.some((m) => m.includes(id)), false, 'an id reached the log: ' + errs.join(' | '));
});

test('#5531 review 13: an unrecordable MOVE is never undone with a leave, and a failed undo says so', async (t) => {
  const { a, b } = sandbox(t);
  const st = {};
  const remote = fakeRemote(st);
  fs.mkdirSync(path.join(a, org.ENROLLMENT_FILE));   // the record cannot be written here
  const mv = await org.enroll(null, true, { root: a, remote });   // a member moving the enrollment here: no code
  assert.equal(mv.ok, false);
  assert.match(mv.because, /now names this Kosmos/);
  assert.equal(remote.sent.some((x) => x.route === org.ROUTES.leave), false, 'a move was undone with a leave, ending the membership');

  fs.mkdirSync(path.join(b, org.ENROLLMENT_FILE));
  const stuck = { macRequest: async (m, route, body) => (route === org.ROUTES.enroll
    ? { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }
    : { ok: false, because: 'offline' }) };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: b, remote: stuck });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be undone yet/, 'a failed undo was reported as undone: ' + r.because);
  assert.equal(/Joining was undone/.test(r.because), false);
});

test('#5531 review 17: an unrecorded join whose undo failed, then refused as the last admin, is joined here again and never forgotten', async (t) => {
  const { b } = sandbox(t);
  const block = path.join(b, org.ENROLLMENT_FILE);
  fs.mkdirSync(block);   // the record cannot be written
  const stuck = { macRequest: async (m, route, body) => (route === org.ROUTES.enroll
    ? { ok: true, data: { ok: true, org: ORG, role: 'admin', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }
    : { ok: false, because: 'offline' }) };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: b, remote: stuck });
  assert.match(r.because, /could not be undone yet/);
  assert.equal(org.leavePending({ root: b }), true, 'CONTROL: the failed undo left no pending leave, so this test drives nothing');
  const lastAdmin = { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) };
  // Still unwritable: the leave stays pending, so the next pass asks again (nothing is forgotten).
  const r1 = await org.refresh({ root: b, remote: here(b, lastAdmin) });
  assert.equal(r1.still, true, JSON.stringify(r1));
  assert.equal(org.leavePending({ root: b }), true, 'with no record and no pending leave, this Kosmos would never ask again');
  // The folder is fixed: the record is rebuilt from the confirmed status, and this world is the work Kosmos again.
  fs.rmdirSync(block);
  const r2 = await org.refresh({ root: b, remote: here(b, lastAdmin) });
  assert.equal(r2.still, true, JSON.stringify(r2));
  assert.equal(org.isEnrolledHere({ root: b }), true, 'the company\'s last admin is enrolled here and this Kosmos says not joined');
  assert.equal(org.leavePending({ root: b }), false);
  assert.equal(org.readEnrollment({ root: b }).org.name, 'Acme');
});

test('#5531 review 18: a local-only leave retires the world id, so the next pass cannot quietly take the enrollment back', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const id = org.worldId({ root: a });
  fs.rmSync(path.join(a, org.ENROLLMENT_FILE));   // the record is gone (by hand, or lost); the id survives
  assert.equal(fs.existsSync(path.join(a, org.WORLD_ID_FILE)), true, 'CONTROL: the id was already gone, so this test reaches nothing');
  const sent = [];
  const r = await org.leave({ root: a, remote: { macRequest: async (m, route) => { sent.push(route); return { ok: true, data: { ok: true } }; } } });
  assert.equal(r.localOnly, true, JSON.stringify(r));
  assert.deepEqual(sent, []);
  // The company still names this world: a pass that could ask would write the record back with no consent shown here.
  const asked = [];
  const naming = { macRequest: async (m, route) => { asked.push(route); return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: id, thisComputer: true } } }; } };
  await org.refresh({ root: a, remote: naming });
  assert.equal(org.isEnrolledHere({ root: a }), false, 'a local-only leave was quietly taken back by the next pass, with no consent shown');
  assert.deepEqual(asked, [], 'a world that left still asked the company about itself');
});

test('#5531 review 19: an enroll with no answer asks status once: bound here is a join, not bound is nothing joined', async (t) => {
  const { a, b } = sandbox(t);
  const timeout = (statusData) => ({ sent: [], macRequest: async function (m, route) { this.sent.push(route);
    if (route === org.ROUTES.enroll) return { ok: false, because: 'the tunnel program did not answer in time' };
    if (route === org.ROUTES.status) return { ok: true, data: statusData(m) };
    return { ok: false, because: 'unexpected ' + route }; } });
  // The company bound this world before the answer was lost: the person accepted, so it is recorded.
  const boundHere = timeout(() => ({ member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root: a }), thisComputer: true } }));
  const r1 = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: boundHere });
  assert.equal(r1.ok, true, 'a join the company made was reported as not joined: ' + JSON.stringify(r1));
  assert.equal(org.isEnrolledHere({ root: a }), true);
  assert.deepEqual(boundHere.sent, [org.ROUTES.enroll, org.ROUTES.status]);
  // Not bound YET, read straight after a timeout: unknown, kept for the follow-up, never "nothing was joined" (review 27).
  const none = timeout(() => ({ member: false }));
  const r2 = await org.enroll('ACME-JOIN-1234', true, { root: b, remote: none });
  assert.equal(r2.code, 'org_join_unknown', JSON.stringify(r2));
  assert.equal(/Nothing was joined/.test(r2.because), false, 'a status read too early was taken as "nothing joined"');
  assert.ok(org.joinUnknown({ root: b }), 'the timeout left nothing for the follow-up');
  assert.equal(org.isEnrolledHere({ root: b }), false);
  // Refused on this computer before sending: certainly nothing joined, no marker, no status asked.
  const asked = [];
  const local = { macRequest: async (m, route) => { asked.push(route); return { ok: false, notSent: true, because: 'this computer is not connected to Kosmos+' }; } };
  const { a: c } = sandbox(t);
  const r3 = await org.enroll('ACME-JOIN-1234', true, { root: c, remote: local });
  assert.match(r3.because, /Nothing was sent, so nothing was joined/, r3.because);
  assert.equal(org.joinUnknown({ root: c }), null, 'a join never sent was kept as unknown');
  assert.deepEqual(asked, [org.ROUTES.enroll], 'status was asked about a join that was never sent');
});

test('#5531 review 19: a first join the company did not confirm for this Kosmos is undone; a move is not', async (t) => {
  const { a, b } = sandbox(t);
  const other = (sent) => ({ macRequest: async (m, route, body) => { sent.push(route);
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    if (route === org.ROUTES.leave) return { ok: true, data: { ok: true } };
    return { ok: false, because: 'unexpected ' + route }; } });
  const sent = [];
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: other(sent) });
  assert.equal(r.ok, false); assert.match(r.because, /Joining was undone/, r.because);
  assert.deepEqual(sent, [org.ROUTES.enroll, org.ROUTES.leave], 'a code spent on a join this Kosmos will not keep was left bound');
  const moved = [];
  const m = await org.enroll(null, true, { root: b, remote: other(moved) });
  assert.equal(m.ok, false);
  assert.equal(moved.includes(org.ROUTES.leave), false, 'a move was undone with a leave, ending the membership');
});

test('#5531 review 21: an undo that could not be sent is sent on the next pass even though the company does not name this world here', async (t) => {
  const { a } = sandbox(t);
  let leaveUp = false;
  const sent = [];
  const notThis = { macRequest: async (m, route, body) => { sent.push(route);
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    if (route === org.ROUTES.leave) return leaveUp ? { ok: true, data: { ok: true } } : { ok: false, because: 'offline' };
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: org.worldId({ root: a }), thisComputer: false } } };
    return { ok: false, because: 'unexpected ' + route }; } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: notThis });
  assert.match(r.because, /could not be undone yet/, r.because);
  assert.equal(org.leavePending({ root: a }), true);
  leaveUp = true;
  sent.length = 0;
  await org.refresh({ root: a, remote: notThis });
  assert.deepEqual(sent, [org.ROUTES.status, org.ROUTES.leave], 'the undo of a join this Kosmos could not keep was never sent: ' + JSON.stringify(sent));
  assert.equal(org.leavePending({ root: a }), false);
});

test('#5531 review 21: a person\'s pending leave later refused as the last admin is said once; their own refused leave is not', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  const lastAdmin = { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) };
  // CONTROL: refused while the person waits: they are told at once, so no note is left for later.
  const now = await org.leave({ root: a, remote: here(a, lastAdmin) });
  assert.equal(now.still, true);
  assert.equal(org.leaveRefusedFor({ root: a }), null, 'a refusal the person already read was left as a note too');
  const p = await org.leave({ root: a, remote: { macRequest: async () => ({ ok: false, because: 'offline' }) } });
  assert.equal(p.pending, true);
  await org.refresh({ root: a, remote: here(a, lastAdmin) });
  assert.equal(org.isEnrolledHere({ root: a }), true);
  assert.equal(org.leaveRefusedFor({ root: a }), 'Acme', 'the person was told this Kosmos stopped, it reports again, and nothing says so');
});

test('#5531 review 23: a pending undo never ends a membership the person since moved to another Kosmos', async (t) => {
  const { a } = sandbox(t);
  let statusWorld = null;
  const sent = [];
  let leaveUp = false;
  const co = { macRequest: async (m, route, body) => { sent.push(route);
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    if (route === org.ROUTES.leave) return leaveUp ? { ok: true, data: { ok: true } } : { ok: false, because: 'offline' };
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c9', world: statusWorld, thisComputer: false } } };
    return { ok: false, because: 'unexpected ' + route }; } };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co });
  assert.equal(org.leavePending({ root: a }), true, 'CONTROL: no pending undo, so this test drives nothing');
  // The person then moved the enrollment to another Kosmos: the company names a DIFFERENT world.
  statusWorld = 'f'.repeat(32); leaveUp = true; sent.length = 0;
  await org.refresh({ root: a, remote: co });
  assert.deepEqual(sent, [org.ROUTES.status], 'a pending undo ended the membership the person set up from another Kosmos: ' + JSON.stringify(sent));
  assert.equal(org.leavePending({ root: a }), false);
});

test('#5531 review 23: an undo refused as the last admin writes no record here; a timed-out first join bound elsewhere is undone', async (t) => {
  const { a, b } = sandbox(t);
  let mode = 'offline';
  const co = (root) => ({ macRequest: async (m, route, body) => {
    if (route === org.ROUTES.enroll) return mode === 'timeout' ? { ok: false, because: 'the tunnel program did not answer in time' } : { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    if (route === org.ROUTES.leave) return mode === 'offline' ? { ok: false, because: 'offline' } : mode === 'admin' ? { ok: false, because: '409 {"because":"org_last_admin"}' } : { ok: true, data: { ok: true } };
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: org.worldId({ root }), thisComputer: false } } };
    return { ok: false, because: 'unexpected ' + route }; } });
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co(a) });
  mode = 'admin';
  const r = await org.refresh({ root: a, remote: co(a) });
  assert.equal(r.still, true, JSON.stringify(r));
  assert.equal(org.isEnrolledHere({ root: a }), false, 'an undo refused as the last admin made this world the work Kosmos the company says it is not');
  assert.equal(org.leaveRefusedFor({ root: a }), null, 'the screen would say "reports again" for a world that does not');
  assert.equal(org.leavePending({ root: a }), true, 'the undo was dropped, so nothing asks again');
  // A first join whose answer was lost, bound by the company to this world on another computer: undone, not "nothing".
  mode = 'timeout';
  const sentB = [];
  const coB = co(b);
  const wrap = { macRequest: async (m, route, body) => { sentB.push(route); if (route === org.ROUTES.leave) return { ok: true, data: { ok: true } }; return coB.macRequest(m, route, body); } };
  const e = await org.enroll('ACME-JOIN-1234', true, { root: b, remote: wrap });
  assert.match(e.because, /Joining was undone/, e.because);
  assert.equal(e.code, 'org_code_used', 'the spent code\'s ticket would be put back');
  assert.deepEqual(sentB, [org.ROUTES.enroll, org.ROUTES.status, org.ROUTES.leave]);
});

test('#5531 review 25: a join whose outcome is unknown is kept, and the next pass records it, clears it, or keeps asking', async (t) => {
  const { a, b } = sandbox(t);
  const HASH = 'c'.repeat(64);
  let status = () => ({ ok: false, because: 'offline' });
  const co = (root) => ({ macRequest: async (m, route) => {
    if (route === org.ROUTES.enroll) return { ok: false, because: 'the tunnel program did not answer in time' };
    if (route === org.ROUTES.status) return status(root);
    return { ok: false, because: 'unexpected ' + route }; } });
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co(a), consentHash: HASH });
  assert.equal(r.code, 'org_join_unknown', JSON.stringify(r));
  assert.ok(org.joinUnknown({ root: a }), 'an unknown join left nothing for the next pass to follow up');
  // Still unclear: kept.
  await org.refresh({ root: a, remote: co(a) });
  assert.ok(org.joinUnknown({ root: a }), 'an unclear answer dropped the unknown join');
  // The company bound it here: recorded, with the consent the person was shown, and the marker goes.
  status = (root) => ({ ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root }), thisComputer: true } } });
  const r2 = await org.refresh({ root: a, remote: co(a) });
  assert.equal(r2.enrolled, true, JSON.stringify(r2));
  assert.equal(org.isEnrolledHere({ root: a }), true, 'a join the company made was never recorded here');
  assert.equal(org.readEnrollment({ root: a }).consentHash, HASH, 'the recorded join lost the consent the person accepted');
  assert.equal(org.joinUnknown({ root: a }), null);
  // Not bound: the marker goes and nothing is recorded.
  status = () => ({ ok: false, because: 'offline' });
  await org.enroll('ACME-JOIN-1234', true, { root: b, remote: co(b) });
  assert.ok(org.joinUnknown({ root: b }), 'CONTROL: the second world has a marker');
  status = () => ({ ok: true, data: { member: false } });
  // Review 29: too soon after the timeout, "not bound" is not final: the marker stays.
  await org.refresh({ root: b, remote: co(b) });
  assert.ok(org.joinUnknown({ root: b }), 'a status read straight after the timeout settled the join as never made');
  // Old enough: settled as not made.
  const mk = path.join(b, 'org-join-unknown.json');
  fs.writeFileSync(mk, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(mk, 'utf8')), { at: new Date(Date.now() - org.SETTLE_AFTER_MS - 1000).toISOString() })));
  await org.refresh({ root: b, remote: co(b) });
  assert.equal(org.joinUnknown({ root: b }), null, 'a join the company never made kept being asked about');
  assert.equal(org.isEnrolledHere({ root: b }), false);
});

test('#5531 review 25: an undo still to send says so with a code, so the page goes back to the code field', async (t) => {
  const { a } = sandbox(t);
  const co = { macRequest: async (m, route, body) => {
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    return { ok: false, because: 'offline' }; } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co });
  assert.equal(r.code, 'org_undo_pending', JSON.stringify(r));
  assert.match(r.because, /could not be undone yet/);
});

test('#5531 review 14: a record whose world id file is gone is stale: cleared, and nothing is asked', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  fs.rmSync(path.join(a, org.WORLD_ID_FILE));
  const sent = [];
  const r = await org.refresh({ root: a, remote: { macRequest: async (m, route) => { sent.push(route); return { ok: true, data: { member: true } }; } } });
  assert.equal(r.enrolled, false);
  assert.deepEqual(sent, [], 'a world with no id of its own still contacted the company');
  assert.equal(fs.existsSync(path.join(a, org.ENROLLMENT_FILE)), false, 'the stale record was kept, so every pass would ask again');
  assert.equal(org.stoppedFor({ root: a }), 'Acme', 'this Kosmos stopped reporting and the screen was never told (review 22)');
});

test('#5531 review 27: mayReport needs the consent recorded here; a record without it is enrolled but may not send', async (t) => {
  const { a, b } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}), consentHash: 'd'.repeat(64) });
  assert.equal(org.isEnrolledHere({ root: a }), true);
  assert.equal(org.mayReport({ root: a }), true, 'CONTROL: a join with its consent recorded may report');
  // A record re-adopted by refresh (no consent shown here): the company names this world, but nothing may be sent.
  org.worldId({ root: b });
  await org.refresh({ root: b, remote: here(b, { macRequest: async () => ({ ok: false, because: 'unexpected' }) }) });
  fs.writeFileSync(path.join(b, org.ENROLLMENT_FILE), JSON.stringify({ org: ORG, role: 'member', world: org.worldId({ root: b }), enrolledAt: '2026-10-07T00:00:00.000Z' }));
  assert.equal(org.isEnrolledHere({ root: b }), true, 'CONTROL: the re-adopted record is enrolled here');
  assert.equal(org.mayReport({ root: b }), false, 'a record with no consent recorded here may report');
});

test('#5531 review 31: an undo refused as the last admin keeps the consent the person accepted, and says so once in undo words', async (t) => {
  const { a } = sandbox(t);
  const HASH = 'a1'.repeat(32);
  const co = { macRequest: async (m, route, body) => {
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'admin', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    if (route === org.ROUTES.leave) return { ok: false, because: 'offline' };
    return { ok: false, because: 'unexpected ' + route }; } };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co, consentHash: HASH });
  assert.equal(org.leavePending({ root: a }), true, 'CONTROL: a pending undo');
  // The company now names this world HERE and refuses the undo as the last admin: the record is rebuilt.
  await org.refresh({ root: a, remote: here(a, { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) }) });
  assert.equal(org.isEnrolledHere({ root: a }), true, 'CONTROL: the record was rebuilt');
  assert.equal(org.readEnrollment({ root: a }).consentHash, HASH, 'the consent the person accepted was dropped, so this Kosmos can never report');
  assert.equal(org.mayReport({ root: a }), true);
  assert.equal(org.leaveRefusedFor({ root: a }), 'Acme', 'the person was told "not reporting", it reports again, and nothing says so');
  assert.equal(org.leaveRefusedKind({ root: a }), 'undo', 'the note would say "your leave was refused" for a leave the person never asked for');
});

test('#5531 review 28: a consent hash is never carried onto a record for another world; "no world enrolled" is not undone', async (t) => {
  const { a, b } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}), consentHash: 'e'.repeat(64) });
  // A stale record naming another world (a copied or restored folder): the company names THIS world here.
  const rec = org.readEnrollment({ root: a });
  fs.writeFileSync(path.join(a, org.ENROLLMENT_FILE), JSON.stringify(Object.assign({}, rec, { world: 'f'.repeat(32) })));
  await org.refresh({ root: a, remote: here(a, { macRequest: async () => ({ ok: false, because: 'unexpected' }) }) });
  assert.equal(org.isEnrolledHere({ root: a }), true, 'CONTROL: refresh wrote the record for this world');
  assert.equal(org.readEnrollment({ root: a }).consentHash, undefined, 'another world\'s consent was carried onto this one');
  assert.equal(org.mayReport({ root: a }), false, 'this world may report on consent shown for another');
  // A first join whose answer was lost, while the company shows the account a member with NO world enrolled (another
  // computer's join landing): unknown, never undone.
  const sent = [];
  const co = { macRequest: async (m, route) => { sent.push(route);
    if (route === org.ROUTES.enroll) return { ok: false, because: 'the tunnel program did not answer in time' };
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: null } };
    return { ok: true, data: { ok: true } }; } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: b, remote: co });
  assert.equal(r.code, 'org_join_unknown', JSON.stringify(r));
  assert.equal(sent.includes(org.ROUTES.leave), false, 'an undo was sent while another computer\'s join may be landing');
});

test('#5531 review 30: a marker whose time cannot be read is settled on the first clear answer, not kept forever', async (t) => {
  const { a } = sandbox(t);
  const co = { macRequest: async (m, route) => (route === org.ROUTES.enroll ? { ok: false, because: 'the tunnel program did not answer in time' } : { ok: true, data: { member: false } }) };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co });
  const mk = path.join(a, 'org-join-unknown.json');
  fs.writeFileSync(mk, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(mk, 'utf8')), { at: 'not a time' })));
  assert.equal(org.joinUnknownAge({ root: a }), null, 'CONTROL: the marker\'s time is unreadable');
  await org.refresh({ root: a, remote: co });
  assert.equal(org.joinUnknown({ root: a }), null, 'a marker with an unreadable time was kept forever');
});

test('#5531 review 32: the pending leave is on disk before the record goes, so a restart mid-leave never leaves neither', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  let seen = null;
  const co = { macRequest: async (m, route) => {
    // The moment the company is asked: what would a restart right now find on disk?
    if (route === org.ROUTES.status) { seen = { pending: org.leavePending({ root: a }), record: !!org.readEnrollment({ root: a }) }; return { ok: false, because: 'offline' }; }
    return { ok: false, because: 'unexpected ' + route }; } };
  const r = await org.leave({ root: a, remote: co });
  assert.equal(r.pending, true, JSON.stringify(r));
  assert.deepEqual(seen, { pending: true, record: false }, 'a restart while the company was asked would find no record and no pending leave');
});

test('#5531 review 33: an unanswered retry between the undo and the last-admin refusal keeps the accepted consent', async (t) => {
  const { a } = sandbox(t);
  const HASH = 'b2'.repeat(32);
  const co = { macRequest: async (m, route, body) => {
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'admin', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    return { ok: false, because: 'offline' }; } };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co, consentHash: HASH });
  // One daily pass that gets no clear answer (the step review 31's test did not cover).
  await org.refresh({ root: a, remote: { macRequest: async () => ({ ok: false, because: 'offline' }) } });
  assert.equal(org.leavePending({ root: a }), true, 'CONTROL: the undo is still pending');
  await org.refresh({ root: a, remote: here(a, { macRequest: async () => ({ ok: false, because: '409 {"because":"org_last_admin"}' }) }) });
  assert.equal(org.readEnrollment({ root: a }).consentHash, HASH, 'an unanswered retry dropped the consent the person accepted');
  assert.equal(org.mayReport({ root: a }), true);
});

test('#5531 review 33: a join marker whose time is in the future (a clock set back) counts as old', async (t) => {
  const { a } = sandbox(t);
  const co = { macRequest: async (m, route) => (route === org.ROUTES.enroll ? { ok: false, because: 'the tunnel program did not answer in time' } : { ok: true, data: { member: false } }) };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co });
  const mk = path.join(a, 'org-join-unknown.json');
  fs.writeFileSync(mk, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(mk, 'utf8')), { at: new Date(Date.now() + 86400e3).toISOString() })));
  assert.equal(org.joinUnknownAge({ root: a }), null, 'a future time read as a fresh age, so the fast follow-up would run until the clock caught up');
  await org.refresh({ root: a, remote: co });
  assert.equal(org.joinUnknown({ root: a }), null, 'a marker with a future time was kept');
});

test('#5531 review 35: a pending leave never ends a join the person made after it, whose outcome was unknown', async (t) => {
  const { a } = sandbox(t);
  const state = {};
  const fr = fakeRemote(state);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fr });
  // The person leaves; the company does not answer: a pending leave.
  const p = await org.leave({ root: a, remote: { macRequest: async () => ({ ok: false, because: 'offline' }) } });
  assert.equal(p.pending, true, 'CONTROL: a pending leave');
  await new Promise((res) => setTimeout(res, 5));
  // The person joins again; the company binds it, but the answer and the status read are both lost: unknown.
  const lost = { macRequest: async (m, route, body) => {
    if (route === org.ROUTES.enroll) { await fr.macRequest(m, route, body); return { ok: false, because: 'the tunnel program did not answer in time' }; }
    return { ok: false, because: 'offline' }; } };
  const j = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: lost });
  assert.equal(j.code, 'org_join_unknown', JSON.stringify(j));
  assert.equal(org.leavePending({ root: a }), true, 'CONTROL: the old leave is still pending beside the unknown join');
  // The next pass: the company names this world here. The join is recorded; the old leave is never sent.
  const sent = [];
  const watch = { macRequest: async (m, route, body) => { sent.push(route); return fr.macRequest(m, route, body); } };
  await org.refresh({ root: a, remote: watch });
  assert.equal(sent.includes(org.ROUTES.leave), false, 'the old pending leave ended the membership the person just accepted: ' + JSON.stringify(sent));
  assert.equal(org.isEnrolledHere({ root: a }), true);
  assert.equal(org.leavePending({ root: a }), false, 'the old leave was kept, to be sent later');
});

test('#5531 review 36: every ending that retires the world id also drops a join marker, so nothing keeps asking', async (t) => {
  const { a } = sandbox(t);
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fakeRemote({}) });
  // An older join marker beside the enrollment (left by an earlier unknown join).
  fs.writeFileSync(path.join(a, 'org-join-unknown.json'), JSON.stringify({ at: new Date(Date.now() - 600e3).toISOString(), consentHash: null, move: false }));
  assert.ok(org.joinUnknown({ root: a }), 'CONTROL: the marker is there');
  const r = await org.leave({ root: a, remote: here(a, { macRequest: async () => ({ ok: true, data: { ok: true } }) }) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.existsSync(path.join(a, org.WORLD_ID_FILE)), false, 'CONTROL: the leave retired the world id');
  assert.equal(org.joinUnknown({ root: a }), null, 'a join marker outlived its world id and would keep asking the company');
});

test('#5531 review 37: a lost answer for company B, seen through a pending leave from company A, never records A on B\'s words', async (t) => {
  const { a, b } = sandbox(t);
  const ALPHA = { id: 'org_alpha', name: 'Alpha', slug: 'alpha' };
  const BETA_HASH = 'be'.repeat(32);
  for (const [root, lostStatus] of [[a, false], [b, true]]) {
    await org.enroll('ACME-JOIN-1234', true, { root, remote: { macRequest: async (m, route, body) => (route === org.ROUTES.enroll
      ? { ok: true, data: { ok: true, org: ALPHA, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } } : { ok: false, because: 'x' }) } });
    // The person leaves Alpha; no answer: pending, and the world id is kept.
    await org.leave({ root, remote: { macRequest: async () => ({ ok: false, because: 'offline' }) } });
    assert.equal(org.leavePending({ root }), true, 'CONTROL: the Alpha leave is pending');
    // The company still names this world HERE, through the old Alpha membership.
    const alphaHere = { ok: true, data: { member: true, org: ALPHA, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root }), thisComputer: true } } };
    const sent = [];
    const co = { macRequest: async (m, route) => { sent.push(route);
      if (route === org.ROUTES.enroll) return { ok: false, because: 'the tunnel program did not answer in time' };
      if (route === org.ROUTES.status) return lostStatus && sent.filter((x) => x === route).length === 1 ? { ok: false, because: 'offline' } : alphaHere;
      if (route === org.ROUTES.leave) return { ok: true, data: { ok: true } };
      return { ok: false, because: 'unexpected ' + route }; } };
    // The person accepts BETA's consent; the answer is lost.
    const r = await org.enroll('BETA-JOIN-5678', true, { root, remote: co, consentHash: BETA_HASH, orgId: 'org_beta' });
    assert.notEqual(r.ok, true, 'Alpha (seen through the pending leave) was taken as the Beta join landing: ' + JSON.stringify(r));
    assert.equal(org.isEnrolledHere({ root }), false, 'Alpha was recorded on Beta\'s consent');
    // Review 38: too soon, the old company named here does not settle it, and the older leave waits.
    await org.refresh({ root, remote: co });
    assert.equal(org.isEnrolledHere({ root }), false, 'Alpha was recorded on Beta\'s consent after the follow-up');
    assert.equal(sent.includes(org.ROUTES.leave), false, 'the old leave went out while the newer join could still be landing');
    // Old enough: settled as not this join, and the person's Alpha leave goes out.
    const mk = path.join(root, 'org-join-unknown.json');
    fs.writeFileSync(mk, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(mk, 'utf8')), { at: new Date(Date.now() - org.SETTLE_AFTER_MS - 1000).toISOString() })));
    await org.refresh({ root, remote: co });
    assert.equal(org.isEnrolledHere({ root }), false);
    assert.ok(sent.includes(org.ROUTES.leave), 'the leave the person asked for was dropped: ' + JSON.stringify(sent));
    assert.equal(org.leavePending({ root }), false);
  }
});

test('#5531 review 39: a yes that names another company than the one whose consent was accepted is not this join', async (t) => {
  const { a, b } = sandbox(t);
  const ALPHA = { id: 'org_alpha', name: 'Alpha', slug: 'alpha' };
  const co = (sent) => ({ macRequest: async (m, route, body) => { sent.push(route);
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ALPHA, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    return { ok: true, data: { ok: true } }; } });
  const sent = [];
  const r = await org.enroll('BETA-JOIN-5678', true, { root: a, remote: co(sent), consentHash: 'cd'.repeat(32), orgId: 'org_beta' });
  assert.notEqual(r.ok, true, 'Alpha was recorded on Beta\'s consent: ' + JSON.stringify(r));
  assert.equal(org.isEnrolledHere({ root: a }), false);
  assert.ok(sent.includes(org.ROUTES.leave), 'a first join for the wrong company was left bound');
  // A move is refused, never undone (a leave would end the existing membership).
  const moved = [];
  const m = await org.enroll(null, true, { root: b, remote: co(moved), orgId: 'org_beta' });
  assert.notEqual(m.ok, true);
  assert.equal(moved.includes(org.ROUTES.leave), false, 'a move was undone with a leave');
  // CONTROL: the same yes for the previewed company is a join.
  const { a: c } = sandbox(t);
  const ok = await org.enroll('ALPHA-JOIN-0001', true, { root: c, remote: co([]), orgId: 'org_alpha' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('#5531 follow-up b: a member moving here gets the hash the company served with the move consent', async (t) => {
  const { a } = sandbox(t);
  const SERVED = '6f'.repeat(32);
  const co = { macRequest: async (m, route) => (route === org.ROUTES.redeem
    ? { ok: false, because: '409 org_already_member' }
    : { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: null, consent: CONSENT, consentHash: SERVED } }) };
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote: co });
  assert.equal(p.move, true, JSON.stringify(p));
  assert.equal(p.served, SERVED, 'the move consent lost the hash the company served with it');
});

test('#5531 follow-up b review 1: an enroll refused because the words changed says so plainly; nothing is kept as unknown', async (t) => {
  const { a } = sandbox(t);
  const asked = [];
  const co = { macRequest: async (m, route) => { asked.push(route); return route === org.ROUTES.enroll ? { ok: false, because: '409 {"because":"org_consent_changed"}' } : { ok: true, data: { member: false } }; } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co, consentHash: 'ab'.repeat(32) });
  assert.equal(r.code, 'org_consent_changed', JSON.stringify(r));
  assert.match(r.because, /Nothing was joined/);
  assert.equal(org.joinUnknown({ root: a }), null, 'a plain refusal was kept as an unknown join');
  assert.deepEqual(asked, [org.ROUTES.enroll], 'status was asked about a join the company refused outright');
});

test('#5531 follow-up b review 2: a MOVE refused because the words changed says to connect again (#5791: no words to read)', async (t) => {
  const { a } = sandbox(t);
  const co = { macRequest: async (m, route) => (route === org.ROUTES.enroll ? { ok: false, because: '409 {"because":"org_consent_changed"}' } : { ok: true, data: { member: false } }) };
  const r = await org.enroll(null, true, { root: a, remote: co, consentHash: 'ab'.repeat(32) });
  assert.equal(r.code, 'org_consent_changed', JSON.stringify(r));
  assert.match(r.because, /Nothing moved\. Press Connect Account again/, r.because);
});

test('#5531 follow-up b review 3: what the enrollment records is exactly the hash the enroll sent', async (t) => {
  const { a } = sandbox(t);
  const H = '3c'.repeat(32);
  let sentBody = null;
  const co = { macRequest: async (m, route, body) => { if (route === org.ROUTES.enroll) { sentBody = body; return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }; } return { ok: false, because: 'x' }; } };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: co, consentHash: H });
  assert.equal(sentBody.consentHash, H, 'the served hash was not sent');
  assert.equal(org.readEnrollment({ root: a }).consentHash, sentBody.consentHash, 'the record holds a hash the enroll did not send');
});

test('#5531 follow-up b review 4: the served hash is echoed only when the person was shown exactly the served words', async (t) => {
  const { a } = sandbox(t);
  const H = '4d'.repeat(32);
  const serve = (consent) => ({ macRequest: async () => ({ ok: true, data: { org: ORG, role: 'member', consent, consentHash: H } }) });
  const ok = await org.preview('ACME-JOIN-1234', { root: a, remote: serve(CONSENT) });
  assert.equal(ok.served, H, 'CONTROL: words cleaning leaves as they are keep the served hash');
  // A line cleaning would cut (past LINE_MAX), and a line cleaning would alter (a zero-width character).
  const long = Object.assign({}, CONSENT, { reports: CONSENT.reports.concat(['x'.repeat(400)]) });
  assert.equal((await org.preview('ACME-JOIN-1234', { root: a, remote: serve(long) })).served, null, 'a hash was echoed for a line the person saw cut');
  const odd = Object.assign({}, CONSENT, { never: ['keys\u200b'] });
  assert.equal((await org.preview('ACME-JOIN-1234', { root: a, remote: serve(odd) })).served, null, 'a hash was echoed for a line the person saw altered');
  // Review 5: a list that is not a list cleans to [] on both sides; the hash must not be echoed for it.
  const notList = Object.assign({}, CONSENT, { backsUp: 'everything' });
  assert.equal((await org.preview('ACME-JOIN-1234', { root: a, remote: serve(notList) })).served, null, 'a hash was echoed for a list the person saw as empty');
});

test('#5531 follow-up: backsUpNone is set only when the company SENT an empty backed-up list', () => {
  const base = { reports: ['agent names'], readers: ['you'], never: [] };
  assert.equal(org.cleanConsent(Object.assign({}, base, { backsUp: [] })).backsUpNone, true, 'a stated empty list was not recorded as stated');
  // Not a statement: the page must not say "nothing is backed up" for the company on any of these.
  assert.equal(org.cleanConsent(base).backsUpNone, false, 'a missing field read as "backs up nothing"');
  assert.equal(org.cleanConsent(Object.assign({}, base, { backsUp: 'files' })).backsUpNone, false, 'a non-list read as "backs up nothing"');
  const cleaned = org.cleanConsent(Object.assign({}, base, { backsUp: ['\u200b\u200b'] }));   // two zero-width spaces
  assert.deepEqual(cleaned.backsUp, [], 'CONTROL: the line did clean away to nothing');
  assert.equal(cleaned.backsUpNone, false, 'lines cleaned to nothing read as "backs up nothing"');
  // Review 3: "Nothing is backed up." is shown words, so a stated empty list hashes apart from an unstated one.
  const stated = org.cleanConsent(Object.assign({}, base, { backsUp: [] }));
  assert.notEqual(org.consentHash(stated), org.consentHash(org.cleanConsent(base)), 'two different screens recorded as the same words');
  // CONTROL: a consent with a list keeps the hash it had before the flag existed (the four lists only).
  const listed = org.cleanConsent(Object.assign({}, base, { backsUp: ['agent folders'] }));
  assert.equal(org.consentHash(listed), require('node:crypto').createHash('sha256').update(JSON.stringify([['reports', listed.reports], ['backsUp', listed.backsUp], ['readers', listed.readers], ['never', listed.never]])).digest('hex'));
});

test('#5531 follow-up: reviewHere shows this record\'s company\'s words, and accepting them with no code lets it report', async (t) => {
  const { a, b } = sandbox(t);
  const state = {};
  const fr = fakeRemote(state);
  const SERVED = 'ab'.repeat(32);   // the company's own hash of its words (contract v1.4)
  // Status with the consent, as the coordinator serves it to a member.
  const withConsent = (over) => ({ macRequest: async (m, route, body) => {
    const r = await fr.macRequest(m, route, body);
    return route === org.ROUTES.status && r.ok && r.data.member ? { ok: true, data: Object.assign({}, r.data, { consent: CONSENT, consentHash: SERVED }, over || {}) } : r; } });
  // A review's Accept on a Kosmos with no record here (it went while the words were open) is refused BEFORE sending,
  // whatever the company would answer: never a move on review words, never a new world id (reviews 4 and 5).
  for (const answer of [{ ok: false, because: 'the tunnel program did not answer in time' },
    { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: 'x', thisComputer: true } } }]) {
    const asked = [];
    const bare = await org.enroll(null, true, { root: b, review: true, consentHash: SERVED, orgId: ORG.id, remote: { macRequest: async (m, route) => { asked.push(route); return answer; } } });
    assert.equal(bare.ok, false, 'a review with no record here went through: ' + JSON.stringify(bare));
    assert.equal(bare.code, 'org_not_here');
    assert.deepEqual(asked, [], 'a review with no record here sent ' + JSON.stringify(asked));
    assert.equal(fs.existsSync(path.join(b, org.WORLD_ID_FILE)), false, 'a review with no record here made a world id');
    assert.equal(org.isEnrolledHere({ root: b }), false);
  }
  // Not enrolled here: nothing to review, and the company is not asked.
  const before = fr.sent.length;
  const none = await org.reviewHere({ root: b, remote: withConsent() });
  assert.equal(none.ok, false, JSON.stringify(none));
  assert.equal(fr.sent.length, before, 'a Kosmos with no record asked the company');
  // A record with no consent recorded here (as refresh re-adopts one): enrolled, may not report.
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fr });
  assert.equal(org.mayReport({ root: a }), false, 'CONTROL: no consent recorded, so it may not report');
  const joinedAt = '2026-10-01T00:00:00.000Z';
  fs.writeFileSync(path.join(a, org.ENROLLMENT_FILE), JSON.stringify(Object.assign(org.readEnrollment({ root: a }), { enrolledAt: joinedAt })));
  const r = await org.reviewHere({ root: a, remote: withConsent() });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.review, true); assert.equal(r.move, true);
  assert.deepEqual(r.org, ORG);
  assert.deepEqual(r.consent.reports, org.cleanConsent(CONSENT).reports);
  // Another company's words are never shown as this record's (the account moved companies since).
  const other = await org.reviewHere({ root: a, remote: withConsent({ org: { id: 'org_2', name: 'Other', slug: 'other' } }) });
  assert.equal(other.ok, false, 'another company\'s consent was offered for this record: ' + JSON.stringify(other));
  // Named elsewhere: not this world's words to accept.
  const elsewhere = await org.reviewHere({ root: a, remote: withConsent({ enrolled: { computer: 'c9', world: 'f'.repeat(32), thisComputer: false } }) });
  assert.equal(elsewhere.ok, false, 'a world the company does not name here was offered a review');
  assert.equal(r.served, SERVED, 'the review does not carry the company\'s hash, so accepting could not record the words there');
  // No hash the board can echo: accepting could not make it report, so it is not offered (review 1).
  const noHash = await org.reviewHere({ root: a, remote: withConsent({ consentHash: undefined }) });
  assert.equal(noHash.ok, false, 'a review with no served hash was offered: ' + JSON.stringify(noHash));
  // A lost answer to Accept: "here" was already true, so it proves nothing; nothing is recorded, and status is not asked.
  const lost = [];
  const lostAnswer = await org.enroll(null, true, { root: a, review: true, consentHash: SERVED, orgId: r.org.id, remote: { macRequest: async (m, route) => { lost.push(route);
    return route === org.ROUTES.enroll ? { ok: false, because: 'the tunnel program did not answer in time' } : withConsent().macRequest(m, route); } } });
  assert.equal(lostAnswer.ok, false, 'a lost Accept was taken as accepted: ' + JSON.stringify(lostAnswer));
  assert.match(lostAnswer.because, /press Accept again/);
  assert.equal(org.mayReport({ root: a }), false, 'a lost Accept let this Kosmos report');
  assert.deepEqual(lost, [org.ROUTES.enroll], 'a lost Accept asked the company and trusted a "here" that was true before');
  // Every refusal of a review's Accept is said in review words: never a code to type, never "Nothing was joined" (review 2).
  for (const [ans, want] of [
    [{ ok: false, because: '409 {"because":"org_consent_changed"}' }, /changed what it asks.*Press Review what your company sees/],
    [{ ok: false, because: '403 {"because":"org_not_member"}' }, /no longer in it\. Nothing changed/],
    [{ ok: false, because: '400 {"because":"org_bad_world"}' }, /did not take the acceptance.*Press Review what your company sees/],
    [{ ok: false, notSent: true, because: 'not connected' }, /Nothing was sent; press Accept again/]]) {
    const refused = await org.enroll(null, true, { root: a, review: true, consentHash: SERVED, orgId: r.org.id, remote: { macRequest: async (m, route) => (route === org.ROUTES.enroll ? ans : withConsent().macRequest(m, route)) } });
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.match(refused.because, want, JSON.stringify(ans));
    assert.doesNotMatch(refused.because, /join code|Nothing was joined|Join again/, 'a review was told about a code or a join: ' + refused.because);
    assert.equal(org.mayReport({ root: a }), false, 'a refused Accept let this Kosmos report');
  }
  // Accepting: enroll with NO code and the company's hash. It records them, so it may report.
  const sent = fr.sent.length;
  // With the words shown, as the server's ticket passes them (#5532), so they are kept here by their hash.
  const ok = await org.enroll(null, true, { root: a, remote: fr, consentHash: r.served, consent: r.consent, orgId: r.org.id, review: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const body = fr.sent.slice(sent).find((x) => x.route === org.ROUTES.enroll).body;
  assert.equal(body.code, undefined, 'accepting sent a code');
  assert.equal(body.consentHash, SERVED, 'accepting did not send the company\'s hash, so the company records no accepted words');
  assert.equal(org.readEnrollment({ root: a }).enrolledAt, joinedAt, 'accepting the words reset the date this Kosmos joined');
  assert.equal(org.mayReport({ root: a }), true, 'accepting the words did not let this Kosmos report');
  assert.equal(org.isEnrolledHere({ root: a }), true);
  // Now it reports: a review is refused by the engine itself, not only hidden by the page (review 3).
  const again = await org.reviewHere({ root: a, remote: withConsent() });
  assert.equal(again.ok, false, 'a Kosmos that reports was offered a review: ' + JSON.stringify(again));
});

test('#5532 with #5531 a0: a review carries the salt the company serves, so its Accept pins a computer print as a join does', async (t) => {
  const { a } = sandbox(t);
  const fr = fakeRemote({});
  const SALT = 'cd'.repeat(16);
  const withSalt = (salt) => ({ macRequest: async (m, route, body) => {
    const r = await fr.macRequest(m, route, body);
    return route === org.ROUTES.status && r.ok && r.data.member ? { ok: true, data: Object.assign({}, r.data, { consent: CONSENT, consentHash: 'ab'.repeat(32) }, salt ? { computerSalt: salt } : {}) } : r;
  } });
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fr });
  const r = await org.reviewHere({ root: a, remote: withSalt(SALT) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.salt, SALT, 'the review did not carry the served salt, so its Accept would pin no print');
  // CONTROL: a company that serves no salt gives none.
  assert.equal((await org.reviewHere({ root: a, remote: withSalt(null) })).salt, null);
});

test('#5532 review 31: a Kosmos with a consent hash but no words kept here (joined before them) can still Review', async (t) => {
  const { a } = sandbox(t);
  const fr = fakeRemote({});
  const remote = { macRequest: async (m, route, body) => {
    const r = await fr.macRequest(m, route, body);
    return route === org.ROUTES.status && r.ok && r.data.member ? { ok: true, data: Object.assign({}, r.data, { consent: CONSENT, consentHash: 'ab'.repeat(32) }) } : r;
  } };
  await org.enroll('ACME-JOIN-1234', true, { root: a, remote: fr });
  // As main's #5531 left it: the hash on the record, no words kept by it here.
  const f = path.join(a, org.ENROLLMENT_FILE);
  fs.writeFileSync(f, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(f, 'utf8')), { consentHash: 'ef'.repeat(32) })));
  assert.equal(org.mayReport({ root: a }), true, 'CONTROL: the hash alone reads as "may report"');
  assert.equal(org.acceptedConsent({ root: a }), null, 'CONTROL: no words are kept for it');
  const r = await org.reviewHere({ root: a, remote });
  assert.equal(r.ok, true, 'a Kosmos with no words kept here was refused Review as "already reports": ' + JSON.stringify(r));
});

test('#5685: a reviewer invite is offered with its role, and a role the coordinator does not define is still refused', async (t) => {
  const { a } = sandbox(t);
  const as = (role) => ({ macRequest: async () => ({ ok: true, data: { org: ORG, role, consent: CONSENT } }) });
  const r = await org.preview('ACME-JOIN-1234', { root: a, remote: as('reviewer') });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.role, 'reviewer');
  const bad = await org.preview('ACME-JOIN-1234', { root: a, remote: as('auditor') });
  assert.equal(bad.ok, false, 'an unknown role was offered');
});

test('#5791: when the company changes its words, the board takes the new ones on itself (no screen) and binds their hash', async (t) => {
  const { a } = sandbox(t);
  const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
  const NEW = Object.assign({}, CONSENT, { reports: CONSENT.reports.concat(['the day you were last active']) });
  const sent = [];
  let served = H2;
  const remote = { macRequest: async (m, route, body) => {
    sent.push({ route, body: body == null ? null : JSON.parse(JSON.stringify(body)) });
    if (route === org.ROUTES.redeem) return { ok: true, data: { org: ORG, role: 'member', consent: CONSENT, consentHash: H1 } };
    if (route === org.ROUTES.enroll) return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root: a }), thisComputer: true }, consent: NEW, ...(served ? { consentHash: served } : {}) } };
    return { ok: false, because: 'unexpected ' + route };
  } };
  const opts = { root: a, remote };
  const j = await org.enroll('ACME-JOIN-1234', true, Object.assign({}, opts, { consentHash: H1, consent: CONSENT, orgId: ORG.id }));
  assert.equal(j.ok, true, JSON.stringify(j));
  assert.equal(org.readEnrollment(opts).consentHash, H1);
  assert.equal(await org.consentWithdrawn(opts, H1), true, 'precondition: the old words are withdrawn');
  const before = sent.length;
  const r = await org.reacceptWords(opts);
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = sent.slice(before).find((x) => x.route === org.ROUTES.enroll);
  assert.ok(e, 'no enroll was sent');
  assert.equal(e.body.consentHash, H2, 'the enroll did not carry the hash the company serves now');
  assert.ok(!('code' in e.body), 'a re-acceptance must send no code');
  assert.equal(org.readEnrollment(opts).consentHash, H2, 'the new words are not on record');
  // CONTROL: a company that serves no hash gets no blind re-acceptance; nothing is sent.
  assert.equal(await org.consentWithdrawn(opts, H2), true);
  served = null;
  const n = sent.length;
  const r2 = await org.reacceptWords(opts);
  assert.equal(r2.ok, false, JSON.stringify(r2));
  assert.equal(sent.slice(n).filter((x) => x.route === org.ROUTES.enroll).length, 0, 'an enroll was sent with no hash to echo');
});
