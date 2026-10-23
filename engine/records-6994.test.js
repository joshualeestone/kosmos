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
  assert.throws(() => records.set(p.id, 'A', { confirmed: '2026-10-25' }, { now: NOW }), /cannot be in the future \(today on this computer is 2026-10-23\)/);
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

test('#6994: renderList, what both CLIs print: a heading with the stale count, one line per row, and an empty list that says how to add one', () => {
  const p = project();
  assert.match(records.renderList(records.list(p.id, { now: NOW }), { projectId: p.id, projectName: 'Pipeline' }),
    new RegExp('^No records on Pipeline yet\\. Add one with: kosmos records set ' + p.id + ' "<name>"'));
  records.setLabel(p.id, 'accounts');
  records.set(p.id, 'Acme', { status: 'active' }, { by: 'mara', now: NOW });
  records.set(p.id, 'Globex', { confirmed: '2026-09-01', source: 'notes/globex.md' }, { person: true, now: NOW });
  records.set(p.id, 'Initech', { confirmed: '2026-10-22' }, { now: NOW });
  assert.equal(records.renderList(records.list(p.id, { now: NOW }), { projectId: p.id, projectName: 'Pipeline' }), [
    'Accounts on Pipeline: 3, 1 stale (evidence more than 30 days old)',
    '  Acme | active | confirmed 2026-10-23 (today) by mara | -',
    '  Globex | - | confirmed 2026-09-01 (52 days ago, stale) by the person | notes/globex.md',
    '  Initech | - | confirmed 2026-10-22 (yesterday) | -',
  ].join('\n'));
});

test('#6994: a date one day after this computer\'s today is accepted (an agent on UTC in the evening); two days is not', () => {
  const p = project();
  const r = records.set(p.id, 'Acme', { confirmed: '2026-10-24' }, { now: NOW }).row;
  assert.deepEqual([r.confirmed, r.ageDays, r.stale], ['2026-10-24', -1, false]);
  assert.throws(() => records.set(p.id, 'Acme', { confirmed: '2026-10-25' }, { now: NOW }), /in the future/);
});

test('#6994: a direction override, a line separator or a C1 control is refused; a name typed with a combining accent is the same row', () => {
  const p = project();
  const c = (n) => String.fromCharCode(n);   // code points, so this file holds no invisible characters
  for (const bad of ['active' + c(0x202e) + 'evil', 'two' + c(0x2028) + 'lines', 'x' + c(0x85) + 'y']) {
    assert.throws(() => records.set(p.id, 'Acme', { status: bad }, { now: NOW }), /one line/, JSON.stringify(bad));
  }
  assert.throws(() => records.set(p.id, 'Ac' + c(0x202e) + 'me', {}, { now: NOW }), /one line/);
  records.set(p.id, 'Caf' + c(0xe9), { status: 'a' }, { now: NOW });
  assert.equal(records.set(p.id, 'Cafe' + c(0x301), { status: 'b' }, { now: NOW }).created, false, 'the composed and combining spellings are one row');
  assert.equal(records.list(p.id, { now: NOW }).rows.length, 1);
});

test('#6994: the project list the page polls leaves the records out (they are read through /records)', () => {
  const p = project();
  records.set(p.id, 'Acme', {}, { now: NOW });
  const listed = projects.list([]).find((x) => x.id === p.id);
  assert.ok(listed, 'CONTROL: the project is in the list');
  assert.equal(JSON.parse(JSON.stringify(listed)).records, undefined);
  assert.equal(projects.readAll().find((x) => x.id === p.id).records.length, 1, 'the stored rows are still there');
});

test('#6994: kosmos project show names the records and the verb: a count with the stale ones, or how to start; an older board says nothing', () => {
  const pv = require('./projectview');
  const base = { id: 'p1', name: 'Pipeline', folder: null, briefFound: false, members: [], tasks: { total: 0 } };
  const lines = (records) => pv.renderShow({ project: { ...base, records } }).filter((l) => l.startsWith('Records:'));
  assert.deepEqual(lines({ total: 3, stale: 1, label: 'accounts', staleDays: 30 }),
    ['Records: 3 accounts, 1 stale (evidence more than 30 days old). Read them: kosmos records p1']);
  assert.deepEqual(lines({ total: 2, stale: 0, label: 'records', staleDays: 30 }), ['Records: 2 records. Read them: kosmos records p1']);
  assert.deepEqual(lines({ total: 0, stale: 0, label: 'records', staleDays: 30 }),
    ['Records: none yet. A list this project keeps (accounts, leads) goes there: kosmos records set p1 "<name>" --status "<status>"']);
  assert.deepEqual(lines(undefined), [], 'an older board, which sends no records, gets no line');
});

test('#6994: a zero-width character is refused, so two rows that look the same cannot both exist', () => {
  const p = project();
  const c = (n) => String.fromCharCode(n);
  for (const z of [0x200b, 0x2060, 0xfeff]) {
    // Inside the name: at either end, trim() takes a U+FEFF off before the check, so it cannot make a second row.
    assert.throws(() => records.set(p.id, 'Ac' + c(z) + 'me', {}, { now: NOW }), /one line/, z.toString(16));
  }
  assert.equal(records.set(p.id, 'Acme', {}, { now: NOW }).created, true, 'CONTROL: the plain name is taken');
});
