'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#7977: the turn-end report (Stop -> `report idle --auto`) gets a second try when the first send fails, and a
 * second failure leaves one line in the throttle folder's turn-end-failures.log. Measured 11-04: a Stop hook ran with
 * no error and its idle never reached the board, so the agent read "Can't tell" until its next turn.
 * The real hook, a stand-in CLI that fails its first N `report idle` calls and records every call.
 *   node --test report-hook-turnend-7977.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'rhte-'));
const LOG = path.join(SB, 'calls.log');
const COUNT = path.join(SB, 'fails-left');
const CLI = path.join(SB, 'kosmos');
const NOTE = path.join(SB, 'kosmos-report-throttle', 'turn-end-failures.log');
/* Answers the hook's bare `report` probe; records every call; a `report idle` call fails (exit 7) while fails-left > 0. */
fs.writeFileSync(CLI, '#!/bin/bash\n'
  + '{ printf "%s|" "$@"; printf "\\n"; } >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && { echo "started working idle needs_you blocked stopped"; exit 0; }\n'
  + 'if [ "$1" = report ] && [ "$2" = idle ]; then n=$(cat "' + COUNT + '" 2>/dev/null || echo 0);\n'
  + '  if [ "$n" -gt 0 ]; then echo $((n-1)) > "' + COUNT + '"; exit 7; fi; fi\nexit 0\n');
fs.chmodSync(CLI, 0o755);

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function stop(failsFirst, expectIdleCalls) {
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(COUNT, String(failsFirst));
  fs.rmSync(NOTE, { force: true });
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's', cwd: '/w/a' }),
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', KOSMOS_REPORT_RETRY_S: '0.2' } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  /* The send runs in the background: wait (at most 5 s) for the expected idle calls, then a little longer, so a call or
     a note line that should NOT appear has had time to. */
  const idle = () => fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('report|idle|'));
  for (let i = 0; i < 100 && idle().length < expectIdleCalls; i++) sleepMs(50);
  sleepMs(600);
  return { idle: idle(), note: fs.existsSync(NOTE) ? fs.readFileSync(NOTE, 'utf8') : null };
}

test('CONTROL: a turn end that goes through is sent once, and leaves no note', () => {
  const r = stop(0, 1);
  assert.equal(r.idle.length, 1, JSON.stringify(r.idle));
  assert.equal(r.idle[0], 'report|idle|--auto|finished|responding|');
  assert.equal(r.note, null);
});

test('a turn end whose first send fails is sent again, and the retry landing leaves no note', () => {
  const r = stop(1, 2);
  assert.equal(r.idle.length, 2, 'one try and one retry: ' + JSON.stringify(r.idle));
  assert.equal(r.note, null, 'the retry went through, so there is nothing to note');
});

test('a turn end that fails twice leaves one line: the time, the event and the exit code, and no third try', () => {
  const r = stop(2, 2);
  assert.equal(r.idle.length, 2, 'two tries only: ' + JSON.stringify(r.idle));
  assert.ok(r.note, 'turn-end-failures.log was written');
  const lines = r.note.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, r.note);
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ Stop idle not delivered after a retry \(exit 7\)$/);
});
