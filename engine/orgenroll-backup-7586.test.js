'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#7586: the member's Kosmos keeps, from the company's full status answer, whether company backup is on and this
   member's last backup (kosmos-relay backupreq-7586: backupOn, backupAt), so the page can say a backup requirement is
   not met from the same record the console reads. Read from each answer, never carried: an answer without the field
   (an older coordinator) leaves none. Every world is its own temp data root and the coordinator is a fake.
     node --test engine/orgenroll-backup-7586.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const org = require('./orgenroll');

const CONSENT = { reports: ['project names'], backsUp: ['transcripts'], readers: ['you'], never: ['keys and passwords'] };
const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

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
        if (state.backupOn !== undefined) d.backupOn = state.backupOn;
        if (state.backupAt !== undefined) d.backupAt = state.backupAt;
        return { ok: true, data: d };
      }
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}
async function enrolled(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orgenroll-backup-7586-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = {};
  const remote = fakeRemote(state);
  const e = await org.enroll('ACME-JOIN-1234', true, { root, remote });
  assert.equal(e.ok, true, JSON.stringify(e));
  return { root, state, remote };
}

test('#7586: the refresh keeps backupOn and this member\'s backupAt from the answer', async (t) => {
  const { root, state, remote } = await enrolled(t);
  await org.refresh({ root, remote });
  let rec = org.readEnrollment({ root });
  assert.equal('backupOn' in rec, false, 'CONTROL: no field, nothing kept');
  state.backupOn = true; state.backupAt = 1_790_000_000;
  await org.refresh({ root, remote });
  rec = org.readEnrollment({ root });
  assert.deepStrictEqual([rec.backupOn, rec.backupAt], [true, 1_790_000_000]);
  assert.ok(Number.isFinite(rec.backupSeenAt) && Math.abs(rec.backupSeenAt - Date.now()) < 60_000, 'when the answer came: ' + rec.backupSeenAt);
  state.backupAt = null;
  await org.refresh({ root, remote });
  assert.deepStrictEqual([org.readEnrollment({ root }).backupOn, org.readEnrollment({ root }).backupAt], [true, null], 'none on record');
});

test('#7586: never carried: an answer without the field drops the last one, and backup off keeps no time', async (t) => {
  const { root, state, remote } = await enrolled(t);
  state.backupOn = true; state.backupAt = 1_790_000_000;
  await org.refresh({ root, remote });
  assert.equal(org.readEnrollment({ root }).backupAt, 1_790_000_000);
  delete state.backupOn; delete state.backupAt;
  await org.refresh({ root, remote });
  let rec = org.readEnrollment({ root });
  assert.equal('backupOn' in rec || 'backupAt' in rec || 'backupSeenAt' in rec, false, 'a stale backup time outlived the answer');
  state.backupOn = false; state.backupAt = 1_790_000_000;
  await org.refresh({ root, remote });
  rec = org.readEnrollment({ root });
  assert.deepStrictEqual([rec.backupOn, rec.backupAt], [false, null], 'backup off reads no time even if one is sent');
});
