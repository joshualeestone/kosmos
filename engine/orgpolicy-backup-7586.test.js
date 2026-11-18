'use strict';
/**
 * kosmos#7586: backup required on the member's own board. backupRequired reads the policy by the same rule as
 * reportingRequired (#6367); backupLate reads the coordinator's record of this member's last backup (the status
 * answer's backupOn and backupAt, kept on the enrollment record) against the policy's max_age_hours.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Never the real data root: the policy is passed explicitly below, but the module must not reach live data either way.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bk7586-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const op = require('./orgpolicy');

test('#7586: backup is required only by backup.required exactly true', () => {
  assert.equal(op.backupRequired({ backup: { required: true } }), true);
  for (const p of [null, {}, { backup: null }, { backup: {} }, { backup: { required: false } }, { backup: { required: 'true' } },
    { backup: { required: 1 } }, { telemetry: { required: true } }]) {
    assert.equal(op.backupRequired(p), false, JSON.stringify(p));
  }
});

test('#7586: late means older than max_age_hours at the last answer; never means no backup on record; with no age, any backup meets it', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  const s = now / 1000;
  const seen = (backupAt) => ({ backupOn: true, backupAt, backupSeenAt: now });
  const pol = { backup: { required: true, max_age_hours: 24 } };
  assert.equal(op.backupLate(seen(s - 3600), pol, now), null, 'an hour ago');
  assert.equal(op.backupLate(seen(s - 24 * 3600), pol, now), null, 'exactly the limit meets it');
  assert.equal(op.backupLate(seen(s - 25 * 3600), pol, now), 'late');
  for (const at of [null, undefined, 'x', NaN]) assert.equal(op.backupLate(seen(at), pol, now), 'never', String(at));
  const anyAge = { backup: { required: true } };
  assert.equal(op.backupLate(seen(s - 400 * 86400), anyAge, now), null);
  assert.equal(op.backupLate(seen(null), anyAge, now), 'never');
});

test('#7586: judged at the last answer, not now: a backup that was in time when last seen is not called late an hour on', () => {
  const seenAt = Date.UTC(2026, 10, 18, 12);
  const pol = { backup: { required: true, max_age_hours: 24 } };
  // 23.5 hours old when the answer came; the page reads it 1 hour later, when it would be 24.5 hours old.
  const rec = { backupOn: true, backupAt: seenAt / 1000 - 23.5 * 3600, backupSeenAt: seenAt };
  assert.equal(op.backupLate(rec, pol, seenAt + 3600 * 1000), null);
  // CONTROL: 25 hours old when the answer came is late, read at the same later moment.
  assert.equal(op.backupLate(Object.assign({}, rec, { backupAt: seenAt / 1000 - 25 * 3600 }), pol, seenAt + 3600 * 1000), 'late');
});

test('#7586: an answer older than the stale limit, or with no time, says nothing (refreshes failing leave no current fact)', () => {
  const seenAt = Date.UTC(2026, 10, 18, 12);
  const pol = { backup: { required: true, max_age_hours: 24 } };
  const rec = { backupOn: true, backupAt: null, backupSeenAt: seenAt };
  assert.equal(op.backupLate(rec, pol, seenAt + op.BACKUP_SEEN_STALE_MS), 'never', 'CONTROL: at the limit it still speaks');
  assert.equal(op.backupLate(rec, pol, seenAt + op.BACKUP_SEEN_STALE_MS + 1), null, 'past the limit');
  assert.equal(op.backupLate({ backupOn: true, backupAt: null }, pol, seenAt), null, 'no backupSeenAt');
});

test('#7586: nothing is said when backup is not required, company backup is off, or the coordinator sent nothing', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  const pol = { backup: { required: true, max_age_hours: 24 } };
  assert.equal(op.backupLate({ backupOn: true, backupAt: null, backupSeenAt: now }, { backup: { required: false } }, now), null, 'not required');
  assert.equal(op.backupLate({ backupOn: false, backupAt: null, backupSeenAt: now }, pol, now), null, 'company backup off');
  assert.equal(op.backupLate({}, pol, now), null, 'an older coordinator sent no backupOn');
  assert.equal(op.backupLate(null, pol, now), null);
  // CONTROL: the same inputs with backup on do speak, so each null above is the condition, not a dead function.
  assert.equal(op.backupLate({ backupOn: true, backupAt: null, backupSeenAt: now }, pol, now), 'never');
});
