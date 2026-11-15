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

test('#8261: a write that names no status confirms the current one', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', { source: 'crm export' }, { by: 'bo', now: NOW });
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
  records.set(p.id, 'Acme', {}, { by: 'bo', now: NOW });
  records.set(p.id, 'Acme', { status: 'churned' }, { by: 'cy', now: NOW });
  assert.deepEqual(names(only(p)), ['cy']);
  records.set(p.id, 'Acme', { status: '' }, { by: 'di', now: NOW });
  assert.deepEqual(names(only(p)), ['di'], 'clearing the status is a change too');
});

test('#8261: the person counts as a confirmer, and three names read "a, b and c"', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', {}, { person: true, now: NOW });
  records.set(p.id, 'Acme', {}, { by: 'bo', now: NOW });
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
  records.set(p.id, 'Acme', {}, { by: 'bo', now: NOW });
  assert.deepEqual(names(only(p)), ['old', 'bo']);
});

test('#8261: a write from nobody named adds nobody', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Acme', {}, { now: NOW });
  assert.deepEqual(names(only(p)), ['ana']);
});
