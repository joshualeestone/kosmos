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
const NO_COMPANY = (s) => !/company/i.test(s) && !s.includes('this Mac') && !s.includes('—');

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
