'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { freshnessVerdict, newestReportMs, newestAtInFile } = require('./selfreport-freshness');

const MIN = 60 * 1000;
const NOW = Date.parse('2026-09-09T02:00:00.000Z');
const STALE_AFTER = 45 * MIN;

// ---- freshnessVerdict: the pure decision (newestAtMs injected) ------------

test('fresh: agents running, a recent report -> NOT stale', () => {
  const v = freshnessVerdict({ nowMs: NOW, agentsRunning: 18, staleAfterMs: STALE_AFTER, newestAtMs: NOW - 5 * MIN });
  assert.equal(v.stale, false);
  assert.equal(v.reason, 'fresh');
  assert.equal(v.ageMs, 5 * MIN);
});

test('stale: agents running, the newest report is older than the threshold -> STALE (the #2509 shape)', () => {
  const v = freshnessVerdict({ nowMs: NOW, agentsRunning: 18, staleAfterMs: STALE_AFTER, newestAtMs: NOW - 5 * 24 * 60 * MIN });
  assert.equal(v.stale, true);
  assert.equal(v.reason, 'stale');
});

test('THE FAILING CONTROL: an old report but ZERO agents running -> NOT stale (empty/stopped fleet must not alarm)', () => {
  const v = freshnessVerdict({ nowMs: NOW, agentsRunning: 0, staleAfterMs: STALE_AFTER, newestAtMs: NOW - 5 * 24 * 60 * MIN });
  assert.equal(v.stale, false, 'a stopped fleet writes no reports; that is expected, not an outage');
  assert.equal(v.reason, 'no-agents-running');
});

test('no-reports-ever: agents running but the store has never held a report -> NOT stale (cannot tell fresh-launch from broken-from-install)', () => {
  const v = freshnessVerdict({ nowMs: NOW, agentsRunning: 18, staleAfterMs: STALE_AFTER, newestAtMs: null });
  assert.equal(v.stale, false);
  assert.equal(v.reason, 'no-reports-ever');
  assert.equal(v.ageMs, null);
});

test('boundary: a report exactly at the threshold is NOT stale (strict >, so a fresh 45-min sample is not flapped)', () => {
  const atThreshold = freshnessVerdict({ nowMs: NOW, agentsRunning: 1, staleAfterMs: STALE_AFTER, newestAtMs: NOW - STALE_AFTER });
  assert.equal(atThreshold.stale, false, 'age == threshold is not yet stale');
  const justPast = freshnessVerdict({ nowMs: NOW, agentsRunning: 1, staleAfterMs: STALE_AFTER, newestAtMs: NOW - STALE_AFTER - 1 });
  assert.equal(justPast.stale, true, 'one ms past the threshold is stale');
});

test('agentsRunning defaults to 0 (a missing count never alarms) and a non-finite count is treated as 0', () => {
  assert.equal(freshnessVerdict({ nowMs: NOW, staleAfterMs: STALE_AFTER, newestAtMs: NOW - 99 * MIN }).reason, 'no-agents-running');
  assert.equal(freshnessVerdict({ nowMs: NOW, agentsRunning: NaN, staleAfterMs: STALE_AFTER, newestAtMs: NOW - 99 * MIN }).reason, 'no-agents-running');
});

// ---- newestAtInFile / newestReportMs: the fs readers ----------------------

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-fresh-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('newestAtInFile: returns the newest at, and a partial/garbled final line does not decide or throw', () => {
  withTmpDir((dir) => {
    const f = path.join(dir, 'angel.jsonl');
    // a good line, then a torn write in flight (no closing brace)
    fs.writeFileSync(f, JSON.stringify({ state: 'working', at: '2026-09-09T01:50:00.000Z' }) + '\n{"state":"idle","at":"2026-09-09T0');
    assert.equal(newestAtInFile(f), Date.parse('2026-09-09T01:50:00.000Z'), 'the torn last line is skipped, the good one wins');
  });
});

test('newestAtInFile: an empty or all-unparseable file is null, never a throw', () => {
  withTmpDir((dir) => {
    const empty = path.join(dir, 'empty.jsonl'); fs.writeFileSync(empty, '');
    assert.equal(newestAtInFile(empty), null);
    const junk = path.join(dir, 'junk.jsonl'); fs.writeFileSync(junk, 'not json\nalso not\n');
    assert.equal(newestAtInFile(junk), null);
  });
});

test('newestReportMs: takes the MAX across files and ignores non-.jsonl; a missing dir is null', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'old.jsonl'), JSON.stringify({ at: '2026-09-01T00:00:00.000Z' }) + '\n');
    fs.writeFileSync(path.join(dir, 'new.jsonl'), JSON.stringify({ at: '2026-09-09T01:59:00.000Z' }) + '\n');
    fs.writeFileSync(path.join(dir, 'ignore.txt'), JSON.stringify({ at: '2030-01-01T00:00:00.000Z' }) + '\n');
    assert.equal(newestReportMs(dir), Date.parse('2026-09-09T01:59:00.000Z'), 'the newest .jsonl wins; the .txt is ignored');
  });
  assert.equal(newestReportMs(path.join(os.tmpdir(), 'sr-fresh-does-not-exist-' + Date.now())), null, 'absent dir -> null, no throw');
});

test('freshnessVerdict reads the dir when newestAtMs is not injected (producer -> consumer seam)', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'angel.jsonl'), JSON.stringify({ at: new Date(NOW - 2 * MIN).toISOString() }) + '\n');
    const v = freshnessVerdict({ dir, nowMs: NOW, agentsRunning: 3, staleAfterMs: STALE_AFTER });
    assert.equal(v.stale, false);
    assert.equal(v.reason, 'fresh');
  });
});
