'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8548: at a real startup the Mac report hook runs `kosmos away --hook` BEFORE `report started` (the window starts
 * at the agent's latest report, which `started` replaces), and prints what it says only when it is the hook's JSON and
 * the started report was recorded. When the report fails, the reporting-off systemMessage is the one thing printed.
 * The real hook, a stand-in for the CLI.
 *   node --test report-hook-away-8548.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'rhaway-'));
const LOG = path.join(SB, 'calls.log');
const ANSWER = path.join(SB, 'answer.txt');
const RC = path.join(SB, 'report.rc');
const CLI = path.join(SB, 'kosmos');
/* Speaks `report` (the six words, as the hook's probe expects), records every call in order, answers `away` with the
   contents of ANSWER, and `report started` with the exit code in RC. */
fs.writeFileSync(CLI, '#!/bin/bash\nL=$(printf "%s|" "$@")\nprintf "%s\\n" "$L" >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && { echo "started working idle needs_you blocked stopped"; exit 0; }\n'
  + 'if [ "$1" = away ]; then cat "' + ANSWER + '"; exit 0; fi\n'
  + 'if [ "$1" = report ] && [ "$2" = started ]; then echo "the board is not running"; exit "$(cat "' + RC + '" 2>/dev/null || echo 0)"; fi\nexit 0\n');
fs.chmodSync(CLI, 0o755);

const JSONLINE = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Kosmos: while this agent was not running x' } });
let paneN = 0;
function run(event, answer, rc = 0, pane = '%aw' + (paneN++)) {
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(ANSWER, answer);
  fs.writeFileSync(RC, String(rc));
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(event), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', TMUX_PANE: pane, KOSMOS_AGENT_TOKEN: '' } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  const calls = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('away|') || l.startsWith('report|started|'));
  return { out: r.stdout, calls };
}
const startup = { hook_event_name: 'SessionStart', source: 'startup', session_id: 's', cwd: '/w' };

test('a startup asks `away --hook` before `report started`, and prints its JSON', () => {
  const r = run(startup, JSONLINE + '\n');
  assert.deepEqual(r.calls, ['away|--hook|', 'report|started|--auto|']);
  assert.equal(r.out, JSONLINE + '\n');
});

test('an older Claude Code with no source is a startup too', () => {
  const { source, ...bare } = startup;
  void source;
  assert.equal(run(bare, JSONLINE + '\n').out, JSONLINE + '\n');
});

test('a failed started report prints only the reporting-off message, never the digest too', () => {
  const r = run(startup, JSONLINE + '\n', 1);
  assert.deepEqual(r.calls, ['away|--hook|', 'report|started|--auto|']);
  assert.doesNotMatch(r.out, /hookSpecificOutput/);
  const lines = r.out.trim().split('\n');
  assert.equal(lines.length, 1, 'one JSON object: ' + r.out);
  assert.match(JSON.parse(lines[0]).systemMessage, /^Kosmos reporting is OFF for this session: the report could not be recorded\. the board is not running/);
});

test('anything that is not the hook JSON is dropped', () => {
  assert.equal(run(startup, '').out, '');
  assert.equal(run(startup, 'Kosmos is not running here\n').out, '');
});

test('a compaction or a resume asks nothing and prints nothing', () => {
  for (const source of ['compact', 'resume', 'clear']) {
    const r = run({ ...startup, source }, JSONLINE + '\n');
    assert.deepEqual(r.calls, [], source);
    assert.equal(r.out, '', source);
  }
});

test('the person\'s own session (no agent token, no pane) is not asked, and its started report still goes', () => {
  const r = run(startup, JSONLINE + '\n', 0, '');
  assert.deepEqual(r.calls, ['report|started|--auto|']);
  assert.equal(r.out, '');
});
