'use strict';
/**
 * #3224: the daily rollup carries a counts-only "suspected cross-project
 * misroutes today" line, derived read-only at digest time. The load-bearing
 * properties: renderDay emits the line ONLY when given a non-negative integer
 * count (so the existing 3-arg callers are unchanged), the line carries the
 * number and NO identifiers, dayWindowLocal maps a day string to a local
 * [start,end) window (and refuses a non-YYYY-MM-DD string), and compileAll
 * threads a per-day count through to the written file.
 *
 *   node --test engine/dailylog.misroute-digest-3224.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dailylog-misroute-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const dl = require('./dailylog');

const timeOf = (at) => (typeof at === 'string' && at.length >= 16 ? at.slice(11, 16) : '');
const rows = [{ at: '2026-09-13T09:00:00Z', label: 'proj X', from: 'agentA', text: 'hi', attachments: [] }];

test('renderDay: emits the counts-only misroute line when given a count', () => {
  const md = dl.renderDay('2026-09-13', rows, timeOf, 3);
  assert.match(md, /Suspected cross-project misroutes today: 3 \(heuristic, see kosmos#3224\)\./);
  // No identifiers leak into the digest line - just the number.
  assert.doesNotMatch(md, /agentA.*misroute|misroute.*proj X/i);
});

test('renderDay: a zero count still shows the line (a clean zero is informative, not omitted)', () => {
  const md = dl.renderDay('2026-09-13', rows, timeOf, 0);
  assert.match(md, /Suspected cross-project misroutes today: 0 /);
});

test('renderDay: the existing 3-arg signature is unchanged (no line, no crash)', () => {
  const md = dl.renderDay('2026-09-13', rows, timeOf);
  assert.doesNotMatch(md, /Suspected cross-project misroutes/);
  assert.match(md, /# Kosmos conversations - 2026-09-13/);
});

test('renderDay: a null/undefined/negative/non-integer count omits the line (never a false zero)', () => {
  for (const bad of [null, undefined, -1, 1.5, '2', NaN]) {
    const md = dl.renderDay('2026-09-13', rows, timeOf, bad);
    assert.doesNotMatch(md, /Suspected cross-project misroutes/, 'count ' + String(bad) + ' should omit the line');
  }
});

test('dayWindowLocal: maps a day string to a local [start,end) spanning that day, and refuses a bad string', () => {
  const w = dl.dayWindowLocal('2026-09-13');
  assert.ok(w && Number.isFinite(w.start) && Number.isFinite(w.end));
  assert.ok(w.end > w.start, 'end must be after start');
  // Local midnight of the 13th, and end is local midnight of the 14th.
  assert.equal(new Date(w.start).getDate(), 13);
  assert.equal(new Date(w.end).getDate(), 14);
  assert.equal(new Date(w.start).getHours(), 0);
  // A span of 23, 24, or 25 hours (DST-safe), never zero or 48.
  const hours = (w.end - w.start) / 3600000;
  assert.ok(hours >= 23 && hours <= 25, 'span was ' + hours + 'h');
  // Non-YYYY-MM-DD refused.
  for (const bad of ['nope', '2026-9-3', '2026-09-13T00:00', '', null]) {
    assert.equal(dl.dayWindowLocal(bad), null, 'should refuse ' + String(bad));
  }
  // Shape-valid but calendar-invalid refused (Date would silently normalize these
  // into a DIFFERENT real day).
  for (const bad of ['2026-13-01', '2026-02-30', '2026-00-10', '2026-01-32']) {
    assert.equal(dl.dayWindowLocal(bad), null, 'should refuse calendar-invalid ' + bad);
  }
});

test('defaultMisrouteCountForDay: the default path reads the real record (lazy require) and counts that local day', () => {
  const messages = require('./messages');
  // Local-time timestamps (no Z), so they fall in dayWindowLocal's local window.
  const isoLocal = (h) => `2026-09-13T${String(h).padStart(2, '0')}:00:00`;
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh */ }
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const rec = [
    { kind: 'post', id: 'q', from: 'you', project: 'projB', to: ['mara'], text: '@mara ?',
      operator: true, mentioned: ['mara'], outcomes: { mara: 'placed' }, at: isoLocal(9) },
    { kind: 'post', id: 'p', from: 'mara', project: 'projA', to: [], text: 'over here', outcomes: {}, at: isoLocal(10) },
  ];
  fs.writeFileSync(messages.LOG, rec.map((r) => JSON.stringify(r)).join('\n') + '\n');
  messages.resetForTests();
  assert.equal(dl.defaultMisrouteCountForDay('2026-09-13'), 1, 'the misroute on that local day was not counted via the default path');
  assert.equal(dl.defaultMisrouteCountForDay('2026-09-14'), 0, 'a day with no posts should be 0');
  assert.equal(dl.defaultMisrouteCountForDay('not-a-day'), null, 'a bad day string yields null (line omitted)');
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* cleanup */ }
});

test('compileAll: threads a per-day count into the written day file', () => {
  const chatsDir = path.join(SANDBOX, 'chats');
  const outDir = path.join(SANDBOX, 'chats-daily');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.writeFileSync(path.join(chatsDir, 'proj1.agentB.json'), JSON.stringify({
    agent: 'agentB', messages: [{ from: 'agentB', at: '2026-09-13T10:00:00Z', text: 'working' }],
  }));
  const dayOf = (at) => (typeof at === 'string' && at.length >= 10 ? at.slice(0, 10) : null);
  // Inject a deterministic per-day count so the assertion does not depend on any
  // real message record (the default reads messages.jsonl; here we pin it).
  const summary = dl.compileAll({ chatsDir, outDir, dayOf, timeOf,
    misrouteCountForDay: (day) => (day === '2026-09-13' ? 4 : 0) });
  assert.ok(summary.written.includes('2026-09-13'));
  const md = fs.readFileSync(path.join(outDir, '2026-09-13.md'), 'utf8');
  assert.match(md, /Suspected cross-project misroutes today: 4 /);
});

test('#3224 round 3: the --new confirmations line renders beside the misroute line, counts only, and is omitted at 0 or null', () => {
  const md = dl.renderDay('2026-09-13', rows, timeOf, 3, 2);
  assert.match(md, /Posts confirmed as new after Kosmos asked which room they were for: 2\./);
  assert.match(md, /Suspected cross-project misroutes today: 3/);
  assert.doesNotMatch(dl.renderDay('2026-09-13', rows, timeOf, 3, 0), /confirmed as new/, 'zero is omitted');
  assert.doesNotMatch(dl.renderDay('2026-09-13', rows, timeOf, 3, null), /confirmed as new/, 'unavailable is omitted, never a false zero');
  assert.doesNotMatch(dl.renderDay('2026-09-13', rows, timeOf, 3), /confirmed as new/, 'the 4-arg callers are unchanged');
});

