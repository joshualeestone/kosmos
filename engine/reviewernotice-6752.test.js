'use strict';
/* kosmos#6752 (the board half of #6594): every member's Kosmos keeps the reviewer grants the company's status answer
   names, so the Settings company block can list them. The coordinator (relay #516) sends `reviewerGrants` on the full
   status answer, given in the last 30 days, removed ones included; absent when there are none. Every world here is its
   own temp data root and the coordinator is a fake: nothing touches the real data root or a real coordinator. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const org = require('./orgenroll');

const CONSENT = { reports: ['project names'], backsUp: ['transcripts'], readers: ['you'], never: ['keys and passwords'] };
const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
const T = 1_790_000_000;   // a fixed Unix second for the grants

function fakeRemote(state) {
  return {
    macRequest: async (method, route, body) => {
      if (route === org.ROUTES.redeem) return { ok: true, data: { org: ORG, role: 'member', consent: CONSENT } };
      if (route === org.ROUTES.enroll) {
        state.world = body.world;
        return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
      }
      if (route === org.ROUTES.status) {
        const d = { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: state.world, thisComputer: true } };
        if (state.grants !== undefined) d.reviewerGrants = state.grants;
        return { ok: true, data: d };
      }
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}
async function enrolled(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewernotice-6752-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = {};
  const remote = fakeRemote(state);
  const e = await org.enroll('ACME-JOIN-1234', true, { root, remote });
  assert.equal(e.ok, true, JSON.stringify(e));
  return { root, state, remote };
}

test('#6752: the hourly refresh keeps the answer\'s reviewer grants on the record, without the coordinator\'s state word', async (t) => {
  const { root, state, remote } = await enrolled(t);
  // CONTROL: no grants on the answer, none on the record (an older coordinator, or none given).
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).reviewerGrants, undefined, 'a record with no grants on the answer carries some');
  state.grants = [
    { who: 'pat', grantedAt: T, effectiveAt: T + 86400, state: 'pending', removedAt: null },
    { who: 'lee', grantedAt: T - 100, effectiveAt: T - 100 + 86400, state: 'removed', removedAt: T },
  ];
  await org.refresh({ root, remote });
  assert.deepStrictEqual(org.readEnrollment({ root }).reviewerGrants, [
    { who: 'pat', grantedAt: T, effectiveAt: T + 86400 },
    { who: 'lee', grantedAt: T - 100, effectiveAt: T - 100 + 86400, removedAt: T },
  ]);
  // An answer without the field drops the old list: the coordinator stopped naming them (30 days passed).
  delete state.grants;
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).reviewerGrants, undefined, 'grants the coordinator no longer names stayed on the record');
});

test('#6752: cleanReviewerGrants keeps only well-formed grants, strips control and direction characters, and keeps the newest 20', () => {
  const c = org.cleanReviewerGrants;
  assert.deepStrictEqual(c(undefined), []);
  assert.deepStrictEqual(c({ who: 'pat' }), [], 'an object that is not a list');
  // An older coordinator's grant with no effectiveAt (rows from before the column are in effect at once).
  assert.deepStrictEqual(c([{ who: 'pat', grantedAt: T }]), [{ who: 'pat', grantedAt: T, effectiveAt: T }]);
  for (const bad of [null, 'pat', { grantedAt: T }, { who: '', grantedAt: T }, { who: 'pat' }, { who: 'pat', grantedAt: '2026-10-21' },
    { who: 'pat', grantedAt: T, effectiveAt: 'soon' }, { who: 'pat', grantedAt: T, removedAt: -1 }, { who: 'pat', grantedAt: 1.5 }]) {
    assert.deepStrictEqual(c([bad]), [], 'kept a malformed grant: ' + JSON.stringify(bad));
  }
  const RLO = String.fromCharCode(0x202e), ZW = String.fromCharCode(0x200b), NL = String.fromCharCode(10);
  assert.equal(c([{ who: 'pa' + RLO + 't' + ZW + NL, grantedAt: T }])[0].who, 'pat', 'a direction or control character was kept');
  // CONTROL: ordinary punctuation in a name before the @ stays.
  assert.equal(c([{ who: 'pat.o-neil_2', grantedAt: T }])[0].who, 'pat.o-neil_2');
  assert.equal(c([{ who: 'x'.repeat(200), grantedAt: T }])[0].who.length, 64);
  const many = Array.from({ length: 25 }, (_, i) => ({ who: 'r' + i, grantedAt: T + i }));
  const kept = c(many);
  assert.equal(kept.length, org.MAX_REVIEWER_GRANTS);
  assert.equal(kept[0].who, 'r5', 'the oldest were not the ones dropped');
  assert.equal(kept[kept.length - 1].who, 'r24');
});
