'use strict';

/**
 * #8261: a record keeps every distinct writer of its current status (engine/records.js `confirmers`), so a second
 * agent confirming a row adds a name instead of replacing the first, and the list says "by ana and bo".
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-records8261-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const records = require('./records');

let seq = 0;
function project() {
  seq += 1;
  const dir = path.join(SANDBOX, 'folder-' + seq);
  fs.mkdirSync(dir, { recursive: true });
  return projects.create({ name: 'Facts ' + seq, folder: dir, description: 'Checked facts' });
}
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
const names = (row) => row.confirmedBy.map((c) => (c.person ? 'person' : c.by));
const only = (p) => records.list(p.id, { now: NOW }).rows[0];
const line = (p) => records.renderList(records.list(p.id, { now: NOW }), { projectId: p.id }).split('\n')[1];

test('#8261: a second agent confirming a row adds a name; the first is kept, and the list names both', () => {
  const p = project();
  records.set(p.id, 'Open cards', { status: '371', source: 'gh issue list --state open' }, { by: 'ana', now: NOW });
  records.set(p.id, 'open cards', { status: '371', source: 'next-card.sh 40' }, { by: 'bo', now: NOW });
  const r = only(p);
  assert.deepEqual(names(r), ['ana', 'bo']);
  assert.equal(r.by, 'bo', 'by stays the latest writer, so nothing reading it changes');
  assert.match(line(p), / by ana and bo \| next-card\.sh 40$/);
});

test('#8261: a write that leaves the status out (a source fix) confirms nothing; naming the same status does', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { source: 'crm export, fixed link' }, { by: 'bo', now: NOW });
  assert.deepEqual(names(only(p)), ['ana'], 'bo only fixed the source');
  assert.equal(only(p).by, 'bo', 'by still records the latest writer');
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'bo', now: NOW });
  assert.deepEqual(names(only(p)), ['ana', 'bo']);
});

test('#8261: the same agent writing again is one name, not two (a re-write is not independent)', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  assert.deepEqual(names(only(p)), ['ana']);
  assert.match(line(p), / by ana \| -$/);
});

test('#8261: a new status starts the list again with its writer', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'bo', now: NOW });
  records.set(p.id, 'Acme', { status: 'churned' }, { by: 'cy', now: NOW });
  assert.deepEqual(names(only(p)), ['cy']);
  records.set(p.id, 'Acme', { status: '' }, { by: 'di', now: NOW });
  assert.deepEqual(names(only(p)), ['di'], 'clearing the status is a change too');
});

test('#8261: the person counts as a confirmer, and three names read "a, b and c"', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { person: true, now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'bo', now: NOW });
  assert.deepEqual(names(only(p)), ['ana', 'person', 'bo']);
  assert.match(line(p), / by ana, the person and bo \| -$/);
});

test('#8261: at most CONFIRMERS_MAX names are kept, the newest ones', () => {
  const p = project();
  const who = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
  for (const w of who) records.set(p.id, 'Acme', { status: 'active' }, { by: w, now: NOW });
  assert.equal(records.CONFIRMERS_MAX, 5);
  assert.deepEqual(names(only(p)), who.slice(-5));
});

test('#8261: a row written before confirmers existed keeps its writer as the first confirmer', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'old', now: NOW });
  // The shape #6994 stored: no confirmers field.
  projects.mutate(p.id, (q) => ({ ...q, records: q.records.map((r) => { const { confirmers, ...rest } = r; return rest; }) }));
  assert.equal('confirmers' in projects.readAll().find((x) => x.id === p.id).records[0], false, 'the old shape is really stored');
  assert.deepEqual(names(only(p)), ['old'], 'read: the old writer shows as the confirmer');
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'bo', now: NOW });
  assert.deepEqual(names(only(p)), ['old', 'bo']);
});

test('#8261: a write from nobody named adds nobody', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { now: NOW });
  assert.deepEqual(names(only(p)), ['ana']);
});

test('#8261: renderList reads an answer from an older board (no confirmedBy) by its latest writer', () => {
  const rows = [
    { name: 'Acme', status: 'active', confirmed: '2026-11-15', source: '', by: 'ana', byPerson: false, ageDays: 0, stale: false },
    { name: 'Globex', status: '', confirmed: '2026-11-15', source: '', by: null, byPerson: true, ageDays: 0, stale: false },
  ];
  const out = records.renderList({ label: 'records', staleDays: 30, rows, stale: 0 }, { projectId: 'p1' }).split('\n');
  assert.equal(out[1], '  Acme | active | confirmed 2026-11-15 (today) by ana | -');
  assert.equal(out[2], '  Globex | - | confirmed 2026-11-15 (today) by the person | -');
});

test('#8261: a confirmer whose own evidence is stale no longer counts, on a write or a read', () => {
  const p = project();
  // ana's evidence is from 2026-09-01, 75 days before NOW; bo confirms today.
  records.set(p.id, 'Acme', { status: 'active', confirmed: '2026-09-01' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'bo', now: NOW });
  assert.deepEqual(names(only(p)), ['bo'], 'a 75-day-old check is not a second check beside a fresh one');
  const stored = projects.readAll().find((x) => x.id === p.id).records[0].confirmers.map((c) => c.by);
  assert.deepEqual(stored, ['bo'], 'the write drops it from the stored list too, so it holds no slot under the cap');
  assert.match(line(p), / by bo \| -$/);
  // Read 40 days later: bo's own check has gone stale too, so no confirmer is listed and the line names the latest writer.
  const later = records.list(p.id, { now: NOW + 40 * 86400000 }).rows[0];
  assert.deepEqual(later.confirmedBy, []);
  assert.match(records.renderList(records.list(p.id, { now: NOW + 40 * 86400000 }), { projectId: p.id }).split('\n')[1], / stale\) by bo \| -$/);
});

test('#8261: a repeat write by the same agent refreshes its date, so its check does not go stale under it', () => {
  const p = project();
  // 2026-10-25 is 21 days before NOW: still fresh, so the entry is kept and must be refreshed, not re-added.
  records.set(p.id, 'Acme', { status: 'active', confirmed: '2026-10-25' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  const r = only(p);
  assert.deepEqual(names(r), ['ana']);
  assert.equal(r.confirmedBy[0].confirmed, '2026-11-15');
});
