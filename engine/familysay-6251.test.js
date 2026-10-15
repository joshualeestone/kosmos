'use strict';
/* kosmos#6251 (board half): a family's computer is told about its family, never its company. The board shows its own
   sentence for each coordinator code (orgenroll SAY), so the coordinator's family words reach the person only if the
   board words them by kind too. A code refused at preview names no org to the board, so those sentences fit both kinds. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FLEET_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'familysay-6251-'));
process.env.AGENT_WORKFORCE_DATA = path.join(FLEET_SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(FLEET_SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_SANDBOX, 'workers');
test.after(() => fs.rmSync(FLEET_SANDBOX, { recursive: true, force: true }));
const oe = require('./orgenroll');

const HASH = 'cd'.repeat(32);
const WORDS = { reports: ['which agents ran on this computer'], backsUp: [], readers: ['the person who uses this computer'], never: ['keys and passwords'] };
const root = (t) => { const r = fs.mkdtempSync(path.join(os.tmpdir(), 'familysay-6251-root-')); t.after(() => fs.rmSync(r, { recursive: true, force: true })); return r; };
/* A coordinator that joins, then answers enroll and leave with the refusal named (or joins). */
function coordinator(kind, refuse) {
  const org = { id: 'o', name: 'Rivera', slug: 'rivera', kind };
  let w = null;
  return {
    refuse,
    status: null,   // set to answer status with something else
    macRequest: async function (m, route, body) {
      if (route === oe.ROUTES.redeem) return refused(route) ? { ok: false, because: '409 ' + refused(route) } : { ok: true, data: { org, role: 'admin', consent: WORDS, consentHash: HASH } };
      if (route === oe.ROUTES.enroll) {
        if (refused(route)) return { ok: false, because: '409 ' + refused(route) };
        w = body.world; return { ok: true, data: { ok: true, org, role: 'admin', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      }
      if (route === oe.ROUTES.leave && refused(route)) return { ok: false, because: '409 ' + refused(route) };
      if (route === oe.ROUTES.status && this.status) return this.status;
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org, role: 'admin', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
  function refused(route) { return refuse && refuse[route]; }   // read live, so a test can add a refusal later
}
const NO_COMPANY = (s) => !/company/i.test(s) && !s.includes('this Mac') && !s.includes('\u2014');

test('#6251: every family sentence names no company, and the codes said at preview fit a company and a family alike', () => {
  for (const [code, s] of Object.entries(oe.FAMILY_SAY)) {
    assert.ok(oe.SAY[code], code + ' is not a public code the board says');
    assert.ok(NO_COMPANY(s), code + ': ' + s);
  }
  // Refused before any org is known to this board: no kind to word them by.
  for (const code of ['org_code_unknown', 'org_code_used', 'org_code_expired', 'org_other_org', 'org_wrong_domain']) {   // board review 1: org_already_member is worded by the status read's org, tested below
    assert.ok(!/your company/i.test(oe.SAY[code]), code + ': ' + oe.SAY[code]);
  }
});

test('#6251: inKind says "your family" for a family and leaves a company\'s sentence as it is', () => {
  const s = "Your company changed its terms. It reports to your company once Kosmos has your company's current terms.";
  assert.equal(oe.inKind('company', s), s);
  assert.equal(oe.inKind(undefined, s), s, 'no kind reads as a company');
  assert.equal(oe.inKind('Family', s), s, 'only the exact kind is a family');
  assert.equal(oe.inKind('family', s), "Your family changed its terms. It reports to your family once Kosmos has your family's current terms.");
});

test('#6251: a family\'s join refused because its words changed is told in the family\'s words; a company\'s as before', async (t) => {
  for (const kind of ['family', 'company']) {
    const r = root(t);
    const c = coordinator(kind, { [oe.ROUTES.enroll]: 'org_consent_changed' });
    const pv = await oe.preview('RIVE-JOIN-1234', { root: r, remote: c });
    assert.equal(pv.ok, true, JSON.stringify(pv));
    const en = await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: pv.served, consent: pv.consent, orgId: pv.org.id, wordsShown: kind === 'family', orgKind: kind });
    assert.equal(en.code, 'org_consent_changed', JSON.stringify(en));
    assert.equal(en.because, kind === 'family' ? oe.FAMILY_SAY.org_consent_changed : oe.SAY.org_consent_changed, kind);
  }
});

test('#6251: the family\'s last admin leaving is told in the family\'s words, from the record\'s kind; a company\'s as before', async (t) => {
  for (const kind of ['family', 'company']) {
    const r = root(t);
    const c = coordinator(kind, {});
    const pv = await oe.preview('RIVE-JOIN-1234', { root: r, remote: c });
    const en = await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: pv.served, consent: pv.consent, orgId: pv.org.id, wordsShown: kind === 'family', orgKind: kind });
    assert.equal(en.ok, true, JSON.stringify(en));
    c.refuse[oe.ROUTES.leave] = 'org_last_admin';
    const lv = await oe.leave({ root: r, remote: c });
    assert.equal(lv.code, 'org_last_admin', JSON.stringify(lv));
    assert.equal(lv.because, kind === 'family' ? oe.FAMILY_SAY.org_last_admin : oe.SAY.org_last_admin, kind);
  }
});

test('#6251 board review 1: a preview refused as already a member is said in the org\'s words from the status read; a failed read reads as a company', async (t) => {
  for (const kind of ['family', 'company']) {
    const c = coordinator(kind, { [oe.ROUTES.redeem]: 'org_already_member' });
    c.status = { ok: true, data: { member: true, org: { id: 'o', name: 'Rivera', slug: 'rivera', kind } } };   // no role or words: not a move
    const pv = await oe.preview('RIVE-JOIN-1234', { root: root(t), remote: c });
    assert.equal(pv.code, 'org_already_member', JSON.stringify(pv));
    assert.equal(pv.because, kind === 'family' ? oe.FAMILY_SAY.org_already_member : oe.SAY.org_already_member, kind);
  }
  const c = coordinator('family', { [oe.ROUTES.redeem]: 'org_already_member' });
  c.status = { ok: false, because: 'no answer' };
  const pv = await oe.preview('RIVE-JOIN-1234', { root: root(t), remote: c });
  assert.equal(pv.because, oe.SAY.org_already_member, 'no org known: a company\'s, as decided');
});

test('#6251 board review 1: an unknown join keeps the kind it was for, so a company join on a board with a family record is not said as a family\'s', async (t) => {
  const r = root(t);
  const fam = coordinator('family', {});
  const pv = await oe.preview('RIVE-JOIN-1234', { root: r, remote: fam });
  assert.equal((await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: fam, consentHash: pv.served, consent: pv.consent, orgId: pv.org.id, wordsShown: true, orgKind: 'family' })).ok, true);
  // A company join whose answer is lost (no reason), and whose status read then answers nothing useful.
  const lost = { macRequest: async (m, route) => (route === oe.ROUTES.enroll ? { ok: false, because: 'timeout' } : { ok: false, because: 'no answer' }) };
  await oe.enroll('ACME-JOIN-5678', true, { root: r, remote: lost, consentHash: HASH, consent: WORDS, orgId: 'acme', orgKind: 'company' });
  const j = JSON.parse(fs.readFileSync(path.join(r, 'org-join-unknown.json'), 'utf8'));
  assert.equal(j.orgKind, 'company', JSON.stringify(j));
});


/* Board review 3: a coordinator whose answers are set per route by the test, for the paths the kind is found on. */
function scripted(kind, answers) {
  const org = { id: 'o', name: 'Rivera', slug: 'rivera', kind };
  let w = null;
  return {
    answers,
    macRequest: async function (m, route, body) {
      if (body && body.world) w = body.world;
      const a = this.answers[route];
      if (typeof a === 'function') return a(org, w);
      if (a) return a;
      if (route === oe.ROUTES.redeem) return { ok: true, data: { org, role: 'admin', consent: WORDS, consentHash: HASH } };
      if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org, role: 'admin', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org, role: 'admin', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}
async function joined(t, kind) {
  const r = root(t);
  const c = scripted(kind, {});
  const pv = await oe.preview('RIVE-JOIN-1234', { root: r, remote: c });
  const en = await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: pv.served, consent: pv.consent, orgId: pv.org.id, wordsShown: kind === 'family', orgKind: kind });
  assert.equal(en.ok, true, JSON.stringify(en));
  return { r, c };
}
const notConfirmed = (org, w) => ({ ok: true, data: { ok: true, org, role: 'admin', enrolled: { computer: 'c', world: w, thisComputer: false } } });

test('#6251 board review 3: a first join the coordinator did not confirm is undone in the org\'s words, and the used code goes back to whoever sent it', async (t) => {
  for (const kind of ['family', 'company']) {
    const c = scripted(kind, { [oe.ROUTES.enroll]: notConfirmed, [oe.ROUTES.leave]: { ok: true, data: {} } });
    const en = await oe.enroll('RIVE-JOIN-1234', true, { root: root(t), remote: c, consentHash: HASH, consent: WORDS, orgId: 'o', orgKind: kind });
    assert.equal(en.code, 'org_code_used', JSON.stringify(en));
    assert.match(en.because, kind === 'family' ? /^Your family did not confirm this Kosmos/ : /^Your company did not confirm this Kosmos/, en.because);
    assert.match(en.because, /That code is used up: ask whoever sent it for a new one\.$/, en.because);
    if (kind === 'family') assert.ok(!/company/i.test(en.because), en.because);
  }
});

test('#6251 board review 3: with no kind on the request, an undone join takes the record\'s kind, as the rest of the same call does', async (t) => {
  const { r, c } = await joined(t, 'family');
  c.answers[oe.ROUTES.enroll] = notConfirmed;
  c.answers[oe.ROUTES.leave] = { ok: true, data: {} };
  const en = await oe.enroll('RIVE-JOIN-5678', true, { root: r, remote: c, consentHash: HASH, consent: WORDS, orgId: 'o' });   // no orgKind
  assert.match(en.because, /^Your family did not confirm this Kosmos/, en.because);
});

test('#6251 board review 3: Review on a family\'s Kosmos that already reports says its family\'s words, from the record; a company\'s as before', async (t) => {
  for (const kind of ['family', 'company']) {
    const { r, c } = await joined(t, kind);
    const rv = await oe.reviewHere({ root: r, remote: c });
    assert.equal(rv.ok, false, JSON.stringify(rv));
    assert.equal(rv.because, `This Kosmos already has its ${kind}'s words accepted here.`);
  }
});

test('#6251 board review 3: a leave that could not be confirmed says it will tell the family again, and so does its retry from the pending leave', async (t) => {
  for (const kind of ['family', 'company']) {
    const { r, c } = await joined(t, kind);
    c.answers[oe.ROUTES.leave] = { ok: false, because: 'the tunnel program did not answer in time' };
    const first = await oe.leave({ root: r, remote: c });
    assert.equal(first.pending, true, JSON.stringify(first));
    assert.match(first.because, new RegExp('it will tell your ' + kind + ' again\\.$'), first.because);
    assert.equal(oe.leavePending({ root: r }), true, 'no leave is pending');
    const again = await oe.leave({ root: r, remote: c });   // the record is gone: the kind comes from the pending leave
    assert.equal(again.pending, true, JSON.stringify(again));
    assert.match(again.because, new RegExp('it will tell your ' + kind + ' again\\.$'), again.because);
  }
});

test('#6251 board review 3: a lost join settled later says the org\'s answer was not complete in the kind the join was for', async (t) => {
  for (const kind of ['family', 'company']) {
    const r = root(t);
    // The join's answer is lost and the status read straight after says nothing useful, so the join is unknown.
    const c = scripted(kind, { [oe.ROUTES.enroll]: { ok: false, because: 'timeout' }, [oe.ROUTES.status]: { ok: true, data: { member: true } } });
    const en = await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: HASH, consent: WORDS, orgId: 'o', orgKind: kind });
    assert.equal(en.code, 'org_join_unknown', JSON.stringify(en));
    assert.ok(oe.joinUnknown({ root: r }), 'no unknown join on disk');
    // Settled by the next refresh, from the marker alone (no record, no kind on the call).
    const s = await oe.refresh({ root: r, remote: c });
    assert.equal(s.because, `Your ${kind}'s answer was not complete.`, JSON.stringify(s));
  }
});

test('#6251 board review 4: a family\'s undone join that could not be confirmed is retried in the family\'s words, with no record left', async (t) => {
  for (const kind of ['family', 'company']) {
    const r = root(t);
    const c = scripted(kind, { [oe.ROUTES.enroll]: notConfirmed, [oe.ROUTES.leave]: { ok: false, because: 'the tunnel program did not answer in time' } });
    const en = await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: HASH, consent: WORDS, orgId: 'o', orgKind: kind });
    assert.equal(en.code, 'org_undo_pending', JSON.stringify(en));
    assert.equal(oe.readEnrollment({ root: r }), null, 'an undo keeps no record');
    assert.equal(oe.leavePending({ root: r }), true);
    const again = await oe.leave({ root: r, remote: c });   // the retry: no record, no kind on the call
    assert.equal(again.pending, true, JSON.stringify(again));
    assert.match(again.because, new RegExp('it will tell your ' + kind + ' again\\.$'), again.because);
  }
});
