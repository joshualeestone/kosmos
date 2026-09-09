'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MONITOR = path.join(__dirname, 'tools', 'selfreport-silence-monitor.js');
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

// ---- isAgentCommand: the agent-count matcher (the #2509-blind-spot BLOCKER) ----
// The native installer (2.1.x+) names the process by the VERSION STRING, not
// `claude`, so a bare `claude` match reads 0 on the native fleet and suppresses
// the alarm forever. This pins the canonical rule (legacy names OR semver shape).
test('isAgentCommand: accepts legacy names AND native version-string names, rejects node/other', () => {
  const { isAgentCommand } = require('./tools/selfreport-silence-monitor');
  assert.equal(isAgentCommand('claude'), true);
  assert.equal(isAgentCommand('claude.exe'), true);
  assert.equal(isAgentCommand('2.1.212'), true, 'native version-string name MUST count (the #2509 blind spot)');
  assert.equal(isAgentCommand('2.1.263'), true);
  assert.equal(isAgentCommand('/Users/x/.local/share/claude/versions/2.1.5'), true, 'a path leaking through is matched by basename');
  assert.equal(isAgentCommand('node'), false, 'bare node is the board/tooling, not an agent -> must not inflate the gate');
  assert.equal(isAgentCommand('bash'), false);
  assert.equal(isAgentCommand('2.1'), false, 'not a 3-segment semver');
  assert.equal(isAgentCommand(''), false);
  assert.equal(isAgentCommand(undefined), false);
});

// ---- the monitor must NOT trigger the store migration (report-never-act) ----
// A future edit to `require('../engine/selfreport').DIR` would reintroduce the
// migration-on-read hazard (that module's load reads store.ROOT -> root() ->
// maybeMigrateLegacyStore). This proves the monitor leaves a legacy store put,
// EVEN WITH migration enabled (run-tests sets KOSMOS_NO_LEGACY_MIGRATION=1, which
// would otherwise mask it -- so we delete it for this child).
test('the monitor does NOT migrate the legacy store (dataRootFor is pure)', () => {
  const store = require('./engine/store');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-home-'));
  try {
    const legacyRoot = store.dataRootFor(process.platform, home, {}, store.LEGACY_APP);
    const newRoot = store.dataRootFor(process.platform, home, {}, store.APP);
    // seed a legacy store with a report; do NOT create the new root
    fs.mkdirSync(path.join(legacyRoot, 'selfreports'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'selfreports', 'angel.jsonl'),
      JSON.stringify({ at: new Date(NOW - 2 * MIN).toISOString() }) + '\n');

    const env = { ...process.env };
    delete env.KOSMOS_NO_LEGACY_MIGRATION;   // ALLOW migration, so a trigger would actually fire
    delete env.MONITOR_STORE_DIR;            // exercise the REAL defaultStoreDir path derivation
    env.AGENT_WORKFORCE_HOME = home;
    env.MONITOR_AGENT_COUNT = '0';           // not stale -> no post attempt
    const hb = path.join(home, 'hb.txt'); fs.writeFileSync(hb, String(NOW)); // heartbeat not due
    env.MONITOR_HEARTBEAT_STATE = hb;
    env.MONITOR_NOW_MS = String(NOW);
    env.MONITOR_GH_CMD = path.join(home, 'gh-stub.sh');
    fs.writeFileSync(env.MONITOR_GH_CMD, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    try { execFileSync('node', [MONITOR], { env, encoding: 'utf8' }); } catch { /* exit code irrelevant here */ }

    assert.ok(fs.existsSync(path.join(legacyRoot, 'selfreports', 'angel.jsonl')),
      'the legacy store must be UNTOUCHED -- the monitor read via dataRootFor and did not migrate');
    assert.equal(fs.existsSync(newRoot), false,
      'the monitor must not have created (migrated into) the new root');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
