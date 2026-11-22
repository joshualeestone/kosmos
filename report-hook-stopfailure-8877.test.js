'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8877: the shell report hook reads the stop's kind from the field Claude Code really sends (`error`, measured in
   the 2.1.330 program: hook_event_name:"StopFailure",error,error_details,last_assistant_message). Before this it read
   only `matcher` and `error_type`, so every real stop was recorded as "provider api (an api error)" (36 of 36 on
   Agent1s) and #5805's usage-limit handling never fired. Driven through the real hook, with jq and without it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'rhsf-'));
const LOG = path.join(SB, 'calls.log');
const CLI = path.join(SB, 'kosmos');
fs.writeFileSync(CLI, '#!/bin/bash\nIN=$(cat)\n{ printf "%s|" "$@"; printf "STDIN=%s\\n" "$IN"; } >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && echo "started working idle needs_you blocked stopped"\nexit 0\n');
fs.chmodSync(CLI, 0o755);

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function blockedOn(event, env = {}) {
  fs.writeFileSync(LOG, '');
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(event), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', ...env } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  const lines = () => fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('report|blocked|'));
  for (let i = 0; i < 100 && !lines().length; i++) sleepMs(50);
  const l = lines()[0];
  if (!l) return null;
  const parts = l.split('|');
  const i = parts.indexOf('--on');
  return i >= 0 ? parts[i + 1] : null;
}

/* The input Claude Code 2.1.330 builds for a stop on a usage limit (the transcript row of the measured stop says error
   "rate_limit", apiError "usage_limit_reached"). The message has an escaped "error" in it on purpose: the no-jq reader
   must not take that for the field. */
const REAL = { hook_event_name: 'StopFailure', session_id: 'sess-1', cwd: '/w/agent', error: 'rate_limit', error_details: 'usage_limit_reached',
  last_assistant_message: 'You\'ve hit your Fable limit · resets 4pm (America/Chicago). {"error":"not this one"}' };

for (const [label, env] of [['with jq', {}], ['without jq', { KOSMOS_REPORT_HOOK_NO_JQ: '1' }]]) {
  test(`kosmos#8877 (${label}): a real usage-limit stop is recorded as provider api (rate_limit)`, () => {
    assert.equal(blockedOn(REAL, env), 'provider api (rate_limit)', 'a real usage-limit stop was recorded as an api error, so #5805 never sees it');
  });
  test(`kosmos#8877 review 1 (${label}): an "error" inside error_details, or a value that is not a kind, is not taken`, () => {
    const nested = { hook_event_name: 'StopFailure', session_id: 's', error: 'rate_limit', error_details: { type: 'error', error: 'usage_limit_reached' } };
    assert.equal(blockedOn(nested, env), 'provider api (rate_limit)', 'the nested error_details "error" won (the no-jq sed takes the LAST match)');
    assert.equal(blockedOn({ hook_event_name: 'StopFailure', error: 429, matcher: 'rate_limit' }, env), 'provider api (rate_limit)', 'a number in error was taken for a kind');
    assert.equal(blockedOn({ hook_event_name: 'StopFailure', error: 'Something went wrong: try again' }, env), 'provider api (an api error)', 'a whole message was taken for a kind');
  });
  test(`kosmos#8877 (${label}): the older shape still reads, and a stop with no kind is an api error`, () => {
    assert.equal(blockedOn({ hook_event_name: 'StopFailure', matcher: 'rate_limit' }, env), 'provider api (rate_limit)', 'the older matcher shape stopped reading');
    assert.equal(blockedOn({ hook_event_name: 'StopFailure', session_id: 's' }, env), 'provider api (an api error)', 'CONTROL: no kind at all reads as an api error');
  });
}
