'use strict';
/* kosmos#6602: engine/cert-watch.js, reading the tunnel's certificate check report and its switch. */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { certWatchFrom, setCertWatchIn, ackLostIn, REPORT_FILE, OFF_FILE, LOST_ACK_FILE, STALE_MS } = require('./cert-watch');

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
  assert.deepEqual(certWatchFrom(dir(), NOW), { on: true, state: 'none', foreign: 0, earlier: 0, beforeRecord: 0, lost: false, lostAt: null, key: null, checkedAt: null, failing: false });
});

/* A report shaped as the tunnel writes one (kosmos-relay#459, crates/tunnel/src/ctwatch.rs check_with, read on relay main
   16b8c2c9): its keys, with the JSON types serde_json gives them. The keys it writes only sometimes (after a failure:
   error, error_at; after a lost report: damaged_report_at; after a rename: address_since; during a weekly re-read:
   recount_below) are in TUNNEL_SOMETIMES below. If the tunnel renames a key or changes a type, change these too. */
const TUNNEL_SAMPLE = (checkedAt) => ({
  address: 'mine.kosmosplus.com', earlier_foreign: [], earlier_overflow: 0, full_at: checkedAt,
  foreign_overflow: 0, bad_ids: 0, unmatched: 0, cursor: '17000000000', before_record: 2,
  before_record_sample: [{ id: '16000000000', cert_sha256: 'ab', pubkey_sha256: 'cd', not_before: '2026-09-01T00:00:00Z' }],
  record_since: checkedAt - 86400, state: 'clear', foreign: [], checked_at: checkedAt,
});

const TUNNEL_SOMETIMES = (at) => ({ error: 'the log search answered 429', error_at: at, damaged_report_at: at - 600, address_since: at - 86400, recount_below: 16000000000 });

test('the keys the tunnel writes only sometimes carry the meaning the board reads', () => {
  const d = dir();
  put(d, { ...TUNNEL_SAMPLE(S - 3600), ...TUNNEL_SOMETIMES(S - 60) });
  const w = certWatchFrom(d, NOW);
  assert.equal(w.failing, true, 'error_at after checked_at is a failing check');
  assert.equal(w.lost, true, 'damaged_report_at is a lost report');
  assert.equal(w.state, 'unknown', 'a lost report is never clear');
});

test('a report shaped as the tunnel writes it reads as the tunnel meant', () => {
  const d = dir();
  put(d, TUNNEL_SAMPLE(S - 60));
  const w = certWatchFrom(d, NOW);
  assert.equal(w.state, 'clear');
  assert.equal(w.checkedAt, S - 60);
  assert.equal(w.beforeRecord, 2);
  const f = TUNNEL_SAMPLE(S - 60);
  f.state = 'foreign';
  f.foreign = [{ id: '17000000001', cert_sha256: 'ef', pubkey_sha256: '11', dns_names: ['mine.kosmosplus.com'], not_before: '2026-10-19T01:00:00Z', not_after: '2027-01-17T00:00:00Z', revoked: false, found_at: S - 60 }];
  put(d, f);
  assert.equal(certWatchFrom(d, NOW).state, 'foreign');
  assert.equal(certWatchFrom(d, NOW).foreign, 1);
  const failing = TUNNEL_SAMPLE(S - 3600);
  failing.error = 'the log search answered 429';
  failing.error_at = S - 60;
  put(d, failing);
  assert.equal(certWatchFrom(d, NOW).failing, true);
  put(d, { state: 'clear', checked_at: S - 60.5 });
  assert.equal(certWatchFrom(d, NOW).checkedAt, S - 61, 'a fraction is floored, not refused');
  put(d, { state: 'clear', checked_at: String(S) });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown', 'a string is not a time');
});

test('a recent clear is clear; the control: the same report, old, is unknown', () => {
  const d = dir();
  put(d, { state: 'clear', checked_at: S - 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'clear');
  put(d, { state: 'clear', checked_at: S - 41 * 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown');
  put(d, { state: 'clear', checked_at: S - 40 * 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown', 'exactly two spacings is not current (the tunnel\'s rule)');
  put(d, { state: 'clear', checked_at: S + 41 * 3600, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).state, 'unknown', 'a clear dated far ahead (a skewed clock) is not current either');
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

/* kosmos#6613: the finding key and the lost-report acknowledgement. */
test('the finding key is the same for the same findings, new for a new one, and only hex', () => {
  const d = dir();
  const one = { id: '17', cert_sha256: 'aa', pubkey_sha256: '11', not_before: '2026-10-19T01:00:00Z' };
  const two = { id: '18', cert_sha256: 'bb', pubkey_sha256: '22', not_before: '2026-10-19T02:00:00Z' };
  put(d, { state: 'foreign', checked_at: S, foreign: [one] });
  const k1 = certWatchFrom(d, NOW).key;
  assert.match(k1, /^[0-9a-f]{16}$/);
  put(d, { state: 'foreign', checked_at: S - 60, foreign: [one], before_record: 9 });
  assert.equal(certWatchFrom(d, NOW).key, k1, 'other fields do not change the key');
  put(d, { state: 'foreign', checked_at: S, foreign: [one, two] });
  assert.notEqual(certWatchFrom(d, NOW).key, k1, 'a new finding is a new key');
  put(d, { state: 'clear', checked_at: S, foreign: [], earlier_foreign: [one] });
  assert.match(certWatchFrom(d, NOW).key, /^[0-9a-f]{16}$/, 'an earlier-address finding has a key too');
  put(d, { state: 'clear', checked_at: S, foreign: [] });
  assert.equal(certWatchFrom(d, NOW).key, null, 'no finding, no key');
});

test('acknowledging a lost report quiets it for that marker only', () => {
  const d = dir();
  put(d, { state: 'clear', checked_at: S, damaged_report_at: S - 600 });
  const w = certWatchFrom(d, NOW);
  assert.equal(w.lost, true);
  assert.equal(w.lostAt, S - 600);
  assert.equal(ackLostIn(d, S - 1).ok, false, 'a marker that is not the report\'s is refused');
  assert.ok(!fs.existsSync(path.join(d, LOST_ACK_FILE)));
  assert.deepEqual(ackLostIn(d, S - 600), { ok: true });
  assert.equal(certWatchFrom(d, NOW).lost, false);
  assert.equal(certWatchFrom(d, NOW).state, 'clear', 'acknowledged, a recent clear is clear again');
  put(d, { state: 'clear', checked_at: S, damaged_report_at: S - 5 });
  assert.equal(certWatchFrom(d, NOW).lost, true, 'a later loss is said again');
  assert.equal(ackLostIn(d, 'x').ok, false);
});
