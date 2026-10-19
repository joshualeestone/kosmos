'use strict';
/* kosmos#6602: engine/cert-watch.js, reading the tunnel's certificate check report and its switch. */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { certWatchFrom, setCertWatchIn, REPORT_FILE, OFF_FILE, STALE_MS } = require('./cert-watch');

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const S = Math.floor(NOW / 1000);
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cert-watch-'));
const put = (d, v) => fs.writeFileSync(path.join(d, REPORT_FILE), typeof v === 'string' ? v : JSON.stringify(v));

test('the file names are the tunnel\'s (crates/tunnel/src/ctwatch.rs): change both together', () => {
  assert.equal(REPORT_FILE, 'ct-watch.json');
  assert.equal(OFF_FILE, 'ct-watch-off');
  assert.equal(STALE_MS, 40 * 3600 * 1000);
});

test('no report yet is none, and on', () => {
  assert.deepEqual(certWatchFrom(dir(), NOW), { on: true, state: 'none', foreign: 0, earlier: 0, beforeRecord: 0, checkedAt: null, failing: false, lost: false });
});

test('a recent clear is clear; the control: the same report, old, is unknown', () => {
  const d = dir();
  put(d, { state: 'clear', checked_at: S - 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'clear');
  put(d, { state: 'clear', checked_at: S - 41 * 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown');
  put(d, { state: 'clear', checked_at: S - 40 * 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown', 'exactly two spacings is not current (the tunnel\'s rule)');
});

test('foreign entries, overflow and earlier findings are counted, and any of them is foreign', () => {
  const d = dir();
  put(d, { state: 'clear', checked_at: S, foreign: [{}, {}], foreign_overflow: 3, earlier_foreign: [{}], earlier_overflow: 1, before_record: 4 });
  const w = certWatchFrom(d, NOW);
  assert.equal(w.state, 'foreign');
  assert.equal(w.foreign, 5);
  assert.equal(w.earlier, 2);
  assert.equal(w.beforeRecord, 4);
  put(d, { state: 'clear', checked_at: S, earlier_foreign: [{ address: 'old' }] });
  assert.equal(certWatchFrom(d, NOW).state, 'foreign', 'a finding for an earlier address still counts');
});

test('a damaged earlier report, a report that does not parse, or an unknown state is never clear', () => {
  const d = dir();
  put(d, { state: 'clear', checked_at: S, damaged_report_at: S - 10 });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown');
  assert.equal(certWatchFrom(d, NOW).lost, true);
  put(d, { state: 'clear', checked_at: S, damaged_report_at: null });
  assert.equal(certWatchFrom(d, NOW).lost, false, 'a null marker is no marker');
  assert.equal(certWatchFrom(d, NOW).state, 'clear');
  put(d, '{"state": "cle');
  assert.equal(certWatchFrom(d, NOW).state, 'unknown');
  put(d, { state: 'fine', checked_at: S });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown');
});

test('failing means the last try failed after the last success', () => {
  const d = dir();
  put(d, { state: 'clear', checked_at: S - 100, error_at: S - 50 });
  assert.equal(certWatchFrom(d, NOW).failing, true);
  put(d, { state: 'clear', checked_at: S - 50, error_at: S - 100 });
  assert.equal(certWatchFrom(d, NOW).failing, false);
});

test('no string from the report reaches the answer', () => {
  const d = dir();
  put(d, { state: 'foreign', checked_at: S, foreign: [{ dns_names: ['<img src=x onerror=alert(1)>'] }], error: '<b>x</b>' });
  const text = JSON.stringify(certWatchFrom(d, NOW));
  assert.ok(!text.includes('<'), text);
});

test('the switch writes and removes the off file, and is read back', () => {
  const d = dir();
  assert.deepEqual(setCertWatchIn(d, false), { ok: true });
  assert.ok(fs.existsSync(path.join(d, OFF_FILE)));
  assert.equal(certWatchFrom(d, NOW).on, false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(d, OFF_FILE)).mode & 0o777, 0o600);
  assert.deepEqual(setCertWatchIn(d, true), { ok: true });
  assert.equal(certWatchFrom(d, NOW).on, true);
  assert.deepEqual(setCertWatchIn(d, true), { ok: true }, 'on twice is fine');
});

test('the switch refuses a non-boolean and a computer that is not set up', () => {
  assert.equal(setCertWatchIn(dir(), 'off').ok, false);
  assert.equal(setCertWatchIn(path.join(dir(), 'missing'), false).ok, false);
});
