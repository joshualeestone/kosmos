'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MONITOR = path.join(__dirname, 'selfreport-silence-monitor.js');
const MIN = 60 * 1000;
const NOW = Date.parse('2026-09-09T02:00:00.000Z');

// A gh stub that records every invocation's argv to $GH_RECORD, so a test can
// assert what (if anything) the monitor posted -- without touching a real issue.
// (This is the seam coordinator-monitor.sh's lesson exists for: its alert branch
// was never tested because testing meant posting to the real tracking issue.)
function withHarness(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-mon-'));
  try {
    const record = path.join(dir, 'gh-calls.log');
    const ghStub = path.join(dir, 'gh-stub.sh');
    fs.writeFileSync(ghStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${record}"\n`, { mode: 0o755 });
    const storeDir = path.join(dir, 'selfreports');
    fs.mkdirSync(storeDir);
    fn({ dir, record, ghStub, storeDir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runMonitor({ ghStub, storeDir, agents, nowMs, heartbeatState, args = [] }) {
  const env = {
    ...process.env,
    MONITOR_GH_CMD: ghStub,
    MONITOR_STORE_DIR: storeDir,
    MONITOR_AGENT_COUNT: String(agents),
    MONITOR_NOW_MS: String(nowMs),
    MONITOR_HEARTBEAT_STATE: heartbeatState,
    SELFREPORT_STALE_MINUTES: '45',
  };
  try {
    const stdout = execFileSync('node', [MONITOR, ...args], { env, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

function writeReport(storeDir, agent, atMs) {
  fs.writeFileSync(path.join(storeDir, agent + '.jsonl'),
    JSON.stringify({ state: 'working', at: new Date(atMs).toISOString() }) + '\n');
}
function ghCalls(record) {
  try { return fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean); }
  catch { return []; }
}

test('STALE + agents running -> posts an alert to the issue, exits 1', () => {
  withHarness(({ record, ghStub, storeDir, dir }) => {
    writeReport(storeDir, 'angel', NOW - 5 * 24 * 60 * MIN); // 5 days old (the #2509 shape)
    const hb = path.join(dir, 'hb.txt'); fs.writeFileSync(hb, String(NOW)); // heartbeat not due, to isolate the alert
    const r = runMonitor({ ghStub, storeDir, agents: 18, nowMs: NOW, heartbeatState: hb });
    assert.equal(r.code, 1, 'a real alarm exits non-zero');
    const calls = ghCalls(record);
    assert.equal(calls.length, 1, 'exactly one gh post');
    assert.match(calls[0], /issue comment 2522/);
    assert.match(calls[0], /SILENT/);
  });
});

test('FRESH + agents running, heartbeat NOT due -> SILENT (no gh call), exits 0', () => {
  withHarness(({ record, ghStub, storeDir, dir }) => {
    writeReport(storeDir, 'angel', NOW - 2 * MIN);
    const hb = path.join(dir, 'hb.txt'); fs.writeFileSync(hb, String(NOW - MIN)); // fresh heartbeat
    const r = runMonitor({ ghStub, storeDir, agents: 18, nowMs: NOW, heartbeatState: hb });
    assert.equal(r.code, 0);
    assert.equal(ghCalls(record).length, 0, 'healthy path is silent');
  });
});

test('FRESH + agents running, heartbeat DUE (no state) -> posts "still watching" and records the heartbeat, exits 0', () => {
  withHarness(({ record, ghStub, storeDir, dir }) => {
    writeReport(storeDir, 'angel', NOW - 2 * MIN);
    const hb = path.join(dir, 'hb.txt'); // absent -> due
    const r = runMonitor({ ghStub, storeDir, agents: 18, nowMs: NOW, heartbeatState: hb });
    assert.equal(r.code, 0);
    const calls = ghCalls(record);
    assert.equal(calls.length, 1, 'the heartbeat proves the channel');
    assert.match(calls[0], /still watching/);
    assert.ok(fs.existsSync(hb), 'the heartbeat clock advanced (post succeeded)');
  });
});

test('THE FALSE-ALARM CONTROL: old report but ZERO agents -> no alert, exits 0', () => {
  withHarness(({ record, ghStub, storeDir, dir }) => {
    writeReport(storeDir, 'angel', NOW - 5 * 24 * 60 * MIN);
    const hb = path.join(dir, 'hb.txt'); fs.writeFileSync(hb, String(NOW)); // heartbeat not due
    const r = runMonitor({ ghStub, storeDir, agents: 0, nowMs: NOW, heartbeatState: hb });
    assert.equal(r.code, 0, 'a stopped fleet is not an outage');
    assert.equal(ghCalls(record).length, 0);
  });
});

test('--check prints the verdict JSON and exits by staleness WITHOUT posting', () => {
  withHarness(({ record, ghStub, storeDir, dir }) => {
    writeReport(storeDir, 'angel', NOW - 5 * 24 * 60 * MIN);
    const hb = path.join(dir, 'hb.txt');
    const r = runMonitor({ ghStub, storeDir, agents: 3, nowMs: NOW, heartbeatState: hb, args: ['--check'] });
    assert.equal(r.code, 1, 'stale -> exit 1');
    const v = JSON.parse(r.stdout.trim());
    assert.equal(v.stale, true);
    assert.equal(v.reason, 'stale');
    assert.equal(ghCalls(record).length, 0, '--check never posts');
  });
});
