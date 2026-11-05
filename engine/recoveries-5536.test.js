'use strict';
/* kosmos#5536 (#5529: every recovery is shown to the affected employee unless offboarded): the member's Kosmos keeps
   the recoveries of its own backup that the company's full status answer lists (kosmos-relay #781, `recoveries`), so
   Settings can show them. [] means none; the field absent means the coordinator could not read its log, and the list
   last confirmed is kept. Every world is its own temp data root and the coordinator is a fake.
     node --test engine/recoveries-5536.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const org = require('./orgenroll');

const CONSENT = { reports: ['project names'], backsUp: ['transcripts'], readers: ['you'], never: ['keys and passwords'] };
const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
const T = 1_790_000_000;

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
        if (state.recoveries !== undefined) d.recoveries = state.recoveries;
        if (state.more !== undefined) d.recoveriesMore = state.more;
        return { ok: true, data: d };
      }
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}
async function enrolled(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recoveries-5536-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = {};
  const remote = fakeRemote(state);
  const e = await org.enroll('ACME-JOIN-1234', true, { root, remote });
  assert.equal(e.ok, true, JSON.stringify(e));
  return { root, state, remote };
}
function setRecord(root, edit) {
  const file = path.join(root, 'org-enrollment.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(rec);
  fs.writeFileSync(file, JSON.stringify(rec) + '\n');
}

test('#5536: the refresh keeps the answer\'s recoveries, cleaned, with when they were confirmed', async (t) => {
  const { root, state, remote } = await enrolled(t);
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).recoveries, undefined, 'CONTROL: no field, no list');
  state.recoveries = [
    { what: 'files_opened', who: 'rev', at: T + 10, epoch: 3, count: 7 },
    { what: 'key_released', who: 'rev', at: T, epoch: 3, count: null },
  ];
  await org.refresh({ root, remote });
  const rec = org.readEnrollment({ root });
  assert.deepStrictEqual(rec.recoveries, [
    { what: 'files_opened', at: T + 10, who: 'rev', epoch: 3, count: 7 },
    { what: 'key_released', at: T, who: 'rev', epoch: 3 },
  ]);
  assert.ok(Number.isFinite(rec.recoveriesAt));
});

test('#5536: an answer without the field keeps the confirmed list, and [] clears it', async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.recoveries = [{ what: 'key_released', who: 'rev', at: T, epoch: 3 }];
  await org.refresh({ root, remote });
  const confirmedAt = Date.now() - 5 * 86400000;
  setRecord(root, (r) => { r.recoveriesAt = confirmedAt; });
  delete state.recoveries;
  await org.refresh({ root, remote });
  let rec = org.readEnrollment({ root });
  assert.equal(rec.recoveries.length, 1, 'could not read: the confirmed list stays');
  assert.equal(rec.recoveriesAt, confirmedAt, 'and its time is not moved');
  // A kept list with no confirmed time (from before "absent" meant "unread") is not kept again.
  setRecord(root, (r) => { delete r.recoveriesAt; });
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).recoveries, undefined);
  state.recoveries = [{ what: 'key_released', who: 'rev', at: T }];
  await org.refresh({ root, remote });
  state.recoveries = [];
  await org.refresh({ root, remote });
  rec = org.readEnrollment({ root });
  assert.equal(rec.recoveries, undefined, '[] means none');
  assert.ok(Number.isFinite(rec.recoveriesAt), 'and is still a confirmation');
});

test('#5536: cleanRecoveries keeps only the two words and whole numbers, and strips a name to text', () => {
  const got = org.cleanRecoveries([
    { what: 'files_opened', who: 'r\u202eev\u0007', at: T, epoch: 3, count: 7 },
    { what: 'something_else', who: 'x', at: T },
    { what: 'key_released', who: 'x', at: 0 },
    { what: 'key_released', who: 'x', at: 1.5 },
    { what: 'key_released', who: null, at: T, epoch: -1, count: 9 },
    { what: 'files_opened', at: T, count: '7' },
    null, 'row',
  ]);
  assert.deepStrictEqual(got, [
    { what: 'files_opened', at: T, who: 'rev', epoch: 3, count: 7 },
    { what: 'key_released', at: T },
    { what: 'files_opened', at: T },
  ]);
  const many = Array.from({ length: org.MAX_RECOVERIES + 5 }, (_, i) => ({ what: 'key_released', at: T - i }));
  assert.equal(org.cleanRecoveries(many).length, org.MAX_RECOVERIES);
  assert.equal(org.cleanRecoveries(many)[0].at, T, 'the newest first, as sent');
  assert.deepStrictEqual(org.cleanRecoveries('nope'), []);
});

test('#5536: a list is kept only for the same company; another company on the answer starts with none', async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.recoveries = [{ what: 'key_released', who: 'rev', at: T }];
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).recoveries.length, 1, 'CONTROL: the list is there');
  delete state.recoveries;
  state.org = { id: 'org_2', name: 'Other', slug: 'other' };
  await org.refresh({ root, remote });
  const rec = org.readEnrollment({ root });
  assert.equal(rec.org.id, 'org_2', 'CONTROL: the record moved to the other company');
  assert.equal(rec.recoveries, undefined, "another company's record carried the first company's recoveries");
});

test("#5536: a review's Accept keeps the list, its time and recoveriesMore", async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.recoveries = [{ what: 'key_released', who: 'rev', at: T }];
  state.more = true;
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).recoveriesMore, true, 'recoveriesMore is kept from the answer');
  const at = Date.now() - 2 * 86400000;
  setRecord(root, (r) => { r.recoveriesAt = at; });
  const r = await org.enroll(null, true, { root, remote, review: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rec = org.readEnrollment({ root });
  assert.equal(rec.recoveries.length, 1, "a review's Accept dropped the list");
  assert.equal(rec.recoveriesAt, at);
  assert.equal(rec.recoveriesMore, true);
  delete state.more;
  state.recoveries = [{ what: 'key_released', who: 'rev', at: T }];
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).recoveriesMore, undefined, 'an answer without more clears it');
});
