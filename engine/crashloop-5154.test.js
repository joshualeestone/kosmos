'use strict';
/*
 * #5154 slice A: a crash loop (an agent Kosmos keeps restarting and that keeps stopping within minutes) is told,
 * not hidden. Pins the rule (engine/crashloop.js), the supervisor's run file (bin/agent-supervisor.sh record_run),
 * and that the board's two "needs the person" rules (engine/status.js needsPerson, web agentNeedsAttention) count it.
 *
 *   node --test engine/crashloop-5154.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-crashloop-5154-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const cl = require('./crashloop');
const store = require('./store');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('sandbox: the store root is the temp dir', () => {
  assert.equal(path.resolve(store.ROOT), path.resolve(SANDBOX, 'Kosmos'));
});

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 9, 3, 16, 0, 0);
/* A run that started `ago` ms before NOW and lasted `len` ms (null: still running). */
const run = (ago, len) => ({ start: NOW - ago, end: len === null ? null : NOW - ago + len });

test('#5154: three runs that each ended within two minutes, inside half an hour, is a loop', () => {
  const r = cl.assess([run(10 * MIN, 30e3), run(9 * MIN, 30e3), run(8 * MIN, 30e3)], NOW, null);
  assert.equal(r.looping, true);
  assert.equal(r.count, 3);
  assert.equal(r.firstAt, NOW - 10 * MIN);
  // A new start right after the third (the next try, still under two minutes old) keeps it looping.
  assert.equal(cl.assess([run(10 * MIN, 30e3), run(9 * MIN, 30e3), run(8 * MIN, 30e3), run(1 * MIN, null)], NOW, null).looping, true);
});

test('#5154: what is NOT a loop (each a false alarm the rule must not raise)', () => {
  // Two short runs: under the threshold.
  assert.equal(cl.assess([run(10 * MIN, 30e3), run(9 * MIN, 30e3)], NOW, null).looping, false, 'two short runs');
  // The newest run has lived past two minutes (still running): it recovered.
  assert.equal(cl.assess([run(20 * MIN, 30e3), run(19 * MIN, 30e3), run(18 * MIN, 30e3), run(10 * MIN, null)], NOW, null).looping, false, 'recovered, still running');
  // The newest run lived long and ended (a person stopping a working agent).
  assert.equal(cl.assess([run(20 * MIN, 30e3), run(19 * MIN, 30e3), run(18 * MIN, 30e3), run(10 * MIN, 5 * MIN)], NOW, null).looping, false, 'a long run ended');
  // Short runs older than the window.
  assert.equal(cl.assess([run(50 * MIN, 30e3), run(45 * MIN, 30e3), run(40 * MIN, 30e3)], NOW, null).looping, false, 'outside the window');
  // Runs that lasted over two minutes each.
  assert.equal(cl.assess([run(20 * MIN, 3 * MIN), run(15 * MIN, 3 * MIN), run(10 * MIN, 3 * MIN)], NOW, null).looping, false, 'long runs');
  assert.equal(cl.assess([], NOW, null).looping, false);
  assert.equal(cl.assess(null, NOW, null).looping, false);
});

test('#5154: a run ended by a deliberate Kosmos restart does not count toward a loop', () => {
  const runs = [run(10 * MIN, 30e3), run(9 * MIN, 30e3), run(8 * MIN, 30e3)];
  // CONTROL: without a disruption, a loop.
  assert.equal(cl.assess(runs, NOW, null).looping, true);
  // A restart that began during the third run removes it, leaving two.
  const during = NOW - 8 * MIN + 10e3;
  assert.equal(cl.assess(runs, NOW, during).looping, false, 'a deliberate restart was counted as a crash');
});

test('#5154: parse reads the supervisor lines and ignores anything else', () => {
  const s = (ms) => Math.floor(ms / 1000);
  const text = [
    'start ' + s(NOW - 10 * MIN), 'end ' + s(NOW - 10 * MIN + 30e3),
    'garbage', 'end 1',                                 // an end with no open start
    'start ' + s(NOW - 9 * MIN),                        // its end was never seen: dropped by the next start
    'start ' + s(NOW - 8 * MIN), 'end ' + s(NOW - 8 * MIN + 20e3),
    'start ' + s(NOW - 1 * MIN),                        // the newest, still running: kept
  ].join('\n');
  const runs = cl.parse(text);
  assert.equal(runs.length, 3);
  assert.equal(runs[2].end, null);
  assert.equal(runs[0].end - runs[0].start, 30e3);
});

test('#5154: read() takes the run file and the disruption record from the store, and never throws', () => {
  const s = (ms) => Math.floor(ms / 1000);
  fs.mkdirSync(cl.dir(), { recursive: true });
  const lines = [];
  for (const ago of [10, 9, 8]) lines.push('start ' + s(NOW - ago * MIN), 'end ' + s(NOW - ago * MIN + 30e3));
  fs.writeFileSync(cl.fileFor('Leo'), lines.join('\n') + '\n');
  assert.equal(cl.read('Leo', NOW).looping, true, 'the file lives at runs/<safeKey>.log');
  assert.equal(path.basename(cl.fileFor('Leo')), 'leo.log');
  assert.equal(cl.read('nobody', NOW).looping, false, 'no file is not a loop');
  assert.equal(cl.read('', NOW).looping, false, 'an unreadable name is not a loop and does not throw');
});

/* The supervisor's writer, lifted from the real script and run by bash. */
function supervisorRecordRun() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const m = /\nrecord_run\(\) \{\n[\s\S]*?\n\}\n/.exec(src);
  assert.ok(m, 'record_run is gone from bin/agent-supervisor.sh');
  return { src, fn: m[0] };
}

test('#5154: the supervisor writes start/end lines under <data>/runs/<safeKey>.log and keeps the last 40', () => {
  const { fn } = supervisorRecordRun();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-crashloop-sup-'));
  try {
    const script = 'set -u\n' + fn + '\nSESSION="Leo-2"\nrecord_run start\nrecord_run end\nfor i in $(seq 1 50); do record_run start; done\n';
    const r = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, AGENT_WORKFORCE_DATA: data }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const f = path.join(data, 'Kosmos', 'runs', 'leo-2.log');   // the same root store.ROOT is under this env
    assert.equal(path.basename(f), store.safeKey('Leo-2') + '.log', 'the shell key rule matches store.safeKey');
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    assert.equal(lines.length, 40, 'kept to the last 40 lines');
    assert.match(lines[lines.length - 1], /^start \d{9,11}$/);
    assert.ok(cl.parse(lines.join('\n')).length > 0, 'the engine reads what the supervisor writes');
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});

test('#5154: END TO END, what the real supervisor writes is where the engine reads (same root, same key)', () => {
  const { fn } = supervisorRecordRun();
  const script = 'set -u\n' + fn + '\nSESSION="Pippa"\nfor i in 1 2 3; do record_run start; record_run end; done\n';
  const r = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, AGENT_WORKFORCE_DATA: SANDBOX }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(cl.read('Pippa').looping, true, 'the engine did not find the loop the supervisor wrote (a root or key mismatch)');
});

test('#5154: the supervisor records a start only for a session it launched, and the end once it is gone', () => {
  const { src } = supervisorRecordRun();
  // The WATCH loop is the last one (an earlier loop waits for a session that is not ours).
  const loop = src.lastIndexOf('while "$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; do');
  const start = src.indexOf('[ -z "${adopt:-}" ] && record_run start');
  assert.ok(start > 0 && start < loop, 'the start line must be written just before the watch loop, and only when not adopting');
  const gone = src.indexOf('if [ "$_gone" = 1 ]; then', loop);
  const end = src.indexOf('[ -z "${adopt:-}" ] && record_run end', loop);
  assert.ok(gone > 0 && end > gone && end < src.indexOf('retire_run_token', gone), 'the end line must be written in the confirmed-gone branch');
});

test('#5154: both "needs the person" rules count a crash loop, and agree with each other', () => {
  const { needsPerson } = require('./status');
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const agentNeedsAttention = new Function(page.lift(SCRIPT, 'agentNeedsAttention') + '\nreturn agentNeedsAttention;')();
  const rows = [
    { state: 'working', crashLoop: { looping: true, count: 3 } },
    { state: 'idle', crashLoop: { looping: false, count: 2 } },
    { state: 'working', crashLoop: null },
    { state: 'needs_you' },
    { state: 'connection_lost', reconnect: { phase: 'gave_up' } },
    { state: 'connection_lost', reconnect: { phase: 'waiting' } },
  ];
  const want = [true, false, false, true, true, false];
  rows.forEach((r, i) => {
    assert.equal(needsPerson(r), want[i], 'needsPerson row ' + i);
    assert.equal(agentNeedsAttention(r), want[i], 'agentNeedsAttention row ' + i);
  });
});

test('#5154: the card says what Kosmos saw, before any state sentence', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const fn = page.lift(SCRIPT, 'stateReason');
  const first = fn.indexOf('a.crashLoop && a.crashLoop.looping === true');
  assert.ok(first > 0, 'stateReason does not say the crash loop');
  assert.ok(first < fn.indexOf("a.state === 'restarting'"), 'the crash-loop sentence must come before the state rules');
  assert.match(fn, /Kosmos has restarted it ' \+ n \+ ' times in the last half hour, and each time it stopped within a couple of minutes\./);
});
