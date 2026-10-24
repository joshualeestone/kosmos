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
        const d = { member: true, org: state.org || ORG, role: 'member', enrolled: { computer: 'c1', world: state.world, thisComputer: true } };
        if (state.grants !== undefined) d.reviewerGrants = state.grants;
        return { ok: true, data: d };
      }
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}
/** Rewrites the record's reviewerGrantsAt (undefined removes it), as an older read would have left it. */
function backdate(root, at) {
  const file = path.join(root, 'org-enrollment.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (at === undefined) delete rec.reviewerGrantsAt; else rec.reviewerGrantsAt = at;
  fs.writeFileSync(file, JSON.stringify(rec) + '\n');
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
  assert.ok(Number.isFinite(org.readEnrollment({ root }).reviewerGrantsAt), 'a read with the field records when the list was confirmed');
  // Review 1: back-date the confirmation, so "kept" and "refreshed" cannot share a millisecond.
  const confirmedAt = Date.now() - 5 * 86400000;
  backdate(root, confirmedAt);
  // kosmos#6817: an answer WITHOUT the field is a coordinator that could not read them: the list and its time stay.
  delete state.grants;
  await org.refresh({ root, remote });
  const kept = org.readEnrollment({ root });
  assert.equal(kept.reviewerGrants.length, 2, 'a failed read on the coordinator dropped the list');
  assert.equal(kept.reviewerGrantsAt, confirmedAt, 'a kept list must keep the time it was last confirmed, not look fresh');
  // An empty list is the coordinator saying there are none now: the list goes.
  state.grants = [];
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).reviewerGrants, undefined, 'grants the coordinator no longer names stayed on the record');
  assert.ok(org.readEnrollment({ root }).reviewerGrantsAt > confirmedAt, 'an empty list is a fresh confirmation');
});

test('#6817 review 1: a list with no confirmed time (from before absent meant unread) is not kept', async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.grants = [{ who: 'pat', grantedAt: T, effectiveAt: T + 86400 }];
  await org.refresh({ root, remote });
  backdate(root, undefined);
  delete state.grants;
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).reviewerGrants, undefined, 'a list with no time was kept');
});

test("#6817 review 1: a review's Accept keeps the list and its time, so a failed read after it still has one", async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.grants = [{ who: 'pat', grantedAt: T, effectiveAt: T + 86400 }];
  await org.refresh({ root, remote });
  const at = Date.now() - 2 * 86400000;
  backdate(root, at);
  const r = await org.enroll(null, true, { root, remote, review: true });   // a review's Accept carries no code
  assert.equal(r.ok, true, JSON.stringify(r));
  let rec = org.readEnrollment({ root });
  assert.equal(rec.reviewerGrants.length, 1, "a review's Accept dropped the list");
  assert.equal(rec.reviewerGrantsAt, at);
  delete state.grants;
  await org.refresh({ root, remote });
  rec = org.readEnrollment({ root });
  assert.equal(rec.reviewerGrants.length, 1, 'the failed read after the Accept had no list to keep');
});

test('#6817: a list is kept only for the same company; another company on the answer starts with none', async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.grants = [{ who: 'pat', grantedAt: T, effectiveAt: T + 86400 }];
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).reviewerGrants.length, 1, 'CONTROL: the list is there');
  delete state.grants;
  state.org = { id: 'org_2', name: 'Other', slug: 'other' };
  await org.refresh({ root, remote });
  const rec = org.readEnrollment({ root });
  assert.equal(rec.org.id, 'org_2', 'CONTROL: the record moved to the other company');
  assert.equal(rec.reviewerGrants, undefined, "another company's record carried the first company's reviewers");
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
  for (const cp of [0x2028, 0x2029, 0x061c, 0xfeff, 0x2060, 0x2064, 0x180e, 0x00ad, 0x034f, 0xfff9, 0xfffb, 0xe0001, 0xe007f]) {   // reviews 1 and 3: the other invisible ones
    assert.equal(c([{ who: 'pa' + String.fromCodePoint(cp) + 't', grantedAt: T }])[0].who, 'pat', 'kept U+' + cp.toString(16));
  }
  // CONTROL: ordinary punctuation in a name before the @ stays.
  assert.equal(c([{ who: 'pat.o-neil_2', grantedAt: T }])[0].who, 'pat.o-neil_2');
  assert.equal(c([{ who: 'x'.repeat(200), grantedAt: T }])[0].who.length, 64);
  const many = Array.from({ length: 25 }, (_, i) => ({ who: 'r' + i, grantedAt: T + i }));
  const kept = c(many);
  assert.equal(kept.length, org.MAX_REVIEWER_GRANTS);
  assert.equal(kept[0].who, 'r5', 'the oldest were not the ones dropped');
  assert.equal(kept[kept.length - 1].who, 'r24');
});

test('#6955: cleanReviewerGrants keeps roleNow (reviewer, admin or member) and roleChangedAt, and drops anything else in them, not the grant', () => {
  const c = org.cleanReviewerGrants;
  const g = { who: 'pat', grantedAt: T, removedAt: T + 50 };
  assert.deepStrictEqual(c([{ ...g, roleNow: 'admin', roleChangedAt: T + 50 }]),
    [{ who: 'pat', grantedAt: T, effectiveAt: T, removedAt: T + 50, roleNow: 'admin', roleChangedAt: T + 50 }]);
  for (const r of ['reviewer', 'admin', 'member']) assert.equal(c([{ ...g, roleNow: r }])[0].roleNow, r);
  for (const bad of ['owner', 'Admin', '', 7, null, { r: 'admin' }]) {
    const kept = c([{ ...g, roleNow: bad, roleChangedAt: T + 50 }]);
    assert.equal(kept.length, 1, 'a bad roleNow dropped the grant: ' + JSON.stringify(bad));
    assert.equal('roleNow' in kept[0], false, 'kept a bad roleNow: ' + JSON.stringify(bad));
  }
  for (const bad of [-1, 0, 1.5, '2026-10-22', null]) {
    const kept = c([{ ...g, roleNow: 'admin', roleChangedAt: bad }]);
    assert.equal(kept.length, 1);
    assert.equal('roleChangedAt' in kept[0], false, 'kept a bad roleChangedAt: ' + JSON.stringify(bad));
  }
  // Review 1: leftAt is kept as sent, a time or an explicit null (still in the company); absent stays absent.
  assert.equal(c([{ ...g, roleNow: 'admin', leftAt: null }])[0].leftAt, null);
  assert.equal(c([{ ...g, roleNow: 'admin', leftAt: T + 60 }])[0].leftAt, T + 60);
  assert.equal('leftAt' in c([{ ...g, roleNow: 'admin' }])[0], false, 'an absent leftAt became a value');
  for (const bad of [-1, 0, 'never', 1.5]) assert.equal('leftAt' in c([{ ...g, leftAt: bad }])[0], false, 'kept a bad leftAt: ' + JSON.stringify(bad));
  // CONTROL: an older coordinator's grant (no roleNow) is unchanged from #6752.
  assert.deepStrictEqual(c([g]), [{ who: 'pat', grantedAt: T, effectiveAt: T, removedAt: T + 50 }]);
});
