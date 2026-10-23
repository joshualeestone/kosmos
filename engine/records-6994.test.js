'use strict';

/**
 * #6994: a project's records (engine/records.js). The routes and the two CLIs are covered in
 * server.records-6994.test.js and cli.records-6994.test.js.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-records6994-'));
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
  return projects.create({ name: 'Accounts ' + seq, folder: dir, description: 'Track the accounts' });
}
// A fixed "now" (local noon on 2026-10-23), so ages do not depend on when the test runs.
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();

test('#6994: a set adds a row with today as its confirmed date; a second set with the same name (any case, spacing) updates it', () => {
  const p = project();
  const a = records.set(p.id, 'Acme Inc', { status: 'active', source: 'https://crm.example/acme' }, { by: 'ana', now: NOW });
  assert.equal(a.created, true);
  assert.deepEqual([a.row.name, a.row.status, a.row.confirmed, a.row.source, a.row.by], ['Acme Inc', 'active', '2026-10-23', 'https://crm.example/acme', 'ana']);
  const b = records.set(p.id, '  acme   INC ', { status: 'churned' }, { by: 'bo', now: NOW });
  assert.equal(b.created, false, 'the same entity, spelled differently, is the same row');
  const l = records.list(p.id, { now: NOW });
  assert.equal(l.rows.length, 1);
  assert.equal(l.rows[0].status, 'churned');
  assert.equal(l.rows[0].source, 'https://crm.example/acme', 'a write leaves a field it does not name alone');
  assert.equal(l.rows[0].by, 'bo');
});

test('#6994: two agents writing different rows one after the other both survive (no lost update)', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'ana', now: NOW });
  records.set(p.id, 'Globex', { status: 'lead' }, { by: 'bo', now: NOW });
  records.set(p.id, 'Acme', { source: 'notes/acme.md' }, { by: 'bo', now: NOW });
  const rows = records.list(p.id, { now: NOW }).rows;
  assert.deepEqual(rows.map((r) => [r.name, r.status, r.source, r.by]),
    [['Acme', 'active', 'notes/acme.md', 'bo'], ['Globex', 'lead', '', 'bo']]);
});

test('#6994: a row whose evidence is more than 30 days old is stale; 30 days is not yet', () => {
  const p = project();
  records.set(p.id, 'Fresh', {}, { now: NOW });
  records.set(p.id, 'Edge', { confirmed: '2026-09-23' }, { now: NOW });
  records.set(p.id, 'Old', { confirmed: '2026-09-22' }, { now: NOW });
  const l = records.list(p.id, { now: NOW });
  const by = Object.fromEntries(l.rows.map((r) => [r.name, r]));
  assert.deepEqual([by.Fresh.ageDays, by.Fresh.stale], [0, false]);
  assert.deepEqual([by.Edge.ageDays, by.Edge.stale], [30, false]);
  assert.deepEqual([by.Old.ageDays, by.Old.stale], [31, true]);
  assert.equal(l.stale, 1);
  assert.equal(l.staleDays, records.STALE_DAYS);
});

test('#6994: a write confirms the row again: an update with no date moves an old row to today', () => {
  const p = project();
  records.set(p.id, 'Acme', { confirmed: '2026-01-02' }, { now: NOW });
  assert.equal(records.list(p.id, { now: NOW }).rows[0].stale, true);
  records.set(p.id, 'Acme', { status: 'renewed' }, { now: NOW });
  const r = records.list(p.id, { now: NOW }).rows[0];
  assert.deepEqual([r.confirmed, r.stale], ['2026-10-23', false]);
});

test('#6994: refusals: no name, a multi-line field, a bad or future date, an over-long status, an unknown project', () => {
  const p = project();
  assert.throws(() => records.set(p.id, '  ', {}, { now: NOW }), /needs a name/);
  assert.throws(() => records.set(p.id, 'A\nB', {}, { now: NOW }), /one line/);
  assert.throws(() => records.set(p.id, 'A', { status: 'x\ty' }, { now: NOW }), /one line/);
  assert.throws(() => records.set(p.id, 'A', { confirmed: '23/10/2026' }, { now: NOW }), /YYYY-MM-DD/);
  assert.throws(() => records.set(p.id, 'A', { confirmed: '2026-02-30' }, { now: NOW }), /not a real date/);
  assert.throws(() => records.set(p.id, 'A', { confirmed: '2026-10-24' }, { now: NOW }), /after today/);
  assert.throws(() => records.set(p.id, 'A', { status: 'x'.repeat(records.STATUS_MAX + 1) }, { now: NOW }), /at most/);
  assert.throws(() => records.set('no-such-project', 'A', {}, { now: NOW }), (e) => e.status === 404);
  assert.equal(records.list(p.id, { now: NOW }).rows.length, 0, 'a refused write stores nothing');
});

test('#6994: an empty status or source clears it; remove takes a row by any spelling; removing a missing row is a 404', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active', source: 'x' }, { now: NOW });
  records.set(p.id, 'Acme', { status: '', source: null }, { now: NOW });
  const r = records.list(p.id, { now: NOW }).rows[0];
  assert.deepEqual([r.status, r.source], ['', '']);
  assert.deepEqual(records.remove(p.id, 'ACME'), { name: 'Acme' });
  assert.equal(records.list(p.id, { now: NOW }).rows.length, 0);
  assert.throws(() => records.remove(p.id, 'Acme'), (e) => e.status === 404 && /no record called Acme/.test(e.message));
});

test('#6994: the label names what the rows are, and clearing it goes back to "records"', () => {
  const p = project();
  assert.equal(records.list(p.id).label, 'records');
  records.setLabel(p.id, 'accounts');
  assert.equal(records.list(p.id).label, 'accounts');
  records.setLabel(p.id, '');
  assert.equal(records.list(p.id).label, 'records');
});

test('#6994: the rows survive the project\'s other writes (an edit, an agent joining)', () => {
  const p = project();
  records.set(p.id, 'Acme', { status: 'active' }, { now: NOW });
  projects.edit(p.id, { name: 'Renamed ' + p.id });
  projects.addAgent(p.id, 'some-agent', [{ sessionName: 'some-agent' }]);
  const rows = records.list(p.id, { now: NOW }).rows;
  assert.deepEqual(rows.map((r) => [r.name, r.status]), [['Acme', 'active']]);
});
