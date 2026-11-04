'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#7977: the turn-end report (Stop -> `report idle --auto`) is tried again once when the board did not answer,
 * never when it answered "not recorded", never after a newer event of the same pane, and a second lost send leaves
 * one line in the throttle folder's turn-end-failures.log. The hook itself never waits on the send.
 * The real hook, a stand-in CLI driven by a mode file, recording every call.
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
const MODE = path.join(SB, 'mode');      // "<fails-left> <unreached|refused> <sleep-seconds>"
const CLI = path.join(SB, 'kosmos');   // indents its lines by two spaces, as install/kosmos's say() does
const NOTE = path.join(SB, 'kosmos-report-throttle', 'turn-end-failures.log');
fs.writeFileSync(CLI, '#!/bin/bash\n'
  + '{ printf "%s|" "$@"; printf "\\n"; } >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && { echo "started working idle needs_you blocked stopped"; exit 0; }\n'
  + 'if [ "$1" = report ] && [ "$2" = idle ]; then read n kind wait < "' + MODE + '"; sleep "${wait:-0}";\n'
  + '  if [ "$n" -gt 0 ]; then echo "$((n-1)) $kind 0" > "' + MODE + '";\n'
  + '    case "$kind" in waiting) echo "  That was not recorded: it is waiting on a person (needs_you), so an automatic idle did not overwrite that." ;;\n'
  + '      unsaved) echo "  That was not recorded: we could not save that report." ;; down) echo "  Kosmos is not running, so this could not be recorded. Start it with: kosmos start" ;; *) echo "  Kosmos is not reachable right now." ;; esac; exit 1; fi; fi\n'
  + 'exit 0\n');
fs.chmodSync(CLI, 0o755);

const ENV = { KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', KOSMOS_REPORT_RETRY_S: '1.5', TMUX_PANE: '%7' };
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function hook(event, extra = {}) {
  const t0 = Date.now();
  const env = { ...process.env, ...ENV, ...extra };
  if (extra.TMUX_PANE === null) delete env.TMUX_PANE;
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify({ hook_event_name: event, session_id: 's', cwd: '/w/a' }),
    encoding: 'utf8', timeout: 20000, env });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  return Date.now() - t0;
}
function setup(mode) { fs.writeFileSync(LOG, ''); fs.writeFileSync(MODE, mode); fs.rmSync(NOTE, { force: true }); }
const idle = () => fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('report|idle|'));
const note = () => (fs.existsSync(NOTE) ? fs.readFileSync(NOTE, 'utf8') : null);
/* Waits for n idle calls (at most 8 s), then 2.5 s more: past the 1.5 s retry delay with room for a loaded machine, so a
   retry that should not happen has had time to. */
function settle(n) { for (let i = 0; i < 160 && idle().length < n; i++) sleepMs(50); sleepMs(2500); }

test('CONTROL: a turn end that goes through is sent once, and leaves no note', () => {
  setup('0 unreached 0'); hook('Stop'); settle(1);
  assert.deepEqual(idle(), ['report|idle|--auto|finished|responding|']);
  assert.equal(note(), null);
});

test('the hook does not wait on the send: it returns at once while the board takes 2 s', () => {
  setup('0 unreached 2');
  const ms = hook('Stop');
  assert.ok(ms < 1500, 'the hook returned after ' + ms + ' ms; a send holding its output would take over 2000');
  settle(1);
});

test('a first send the board never answered is tried again, and a retry that lands leaves no note', () => {
  setup('1 unreached 0'); hook('Stop'); settle(2);
  assert.equal(idle().length, 2, JSON.stringify(idle()));
  assert.equal(note(), null);
});

test('a board that kept a deliberate wait ("did not overwrite") gets no retry and no note', () => {
  setup('2 waiting 0'); hook('Stop'); settle(1);
  assert.equal(idle().length, 1, 'one send only: ' + JSON.stringify(idle()));
  assert.equal(note(), null);
});

test('a newer event of the same pane cancels the retry, so an old idle never lands after it', () => {
  setup('2 unreached 0'); hook('Stop'); hook('UserPromptSubmit'); settle(1);
  assert.equal(idle().length, 1, 'the retry was cancelled: ' + JSON.stringify(idle()));
  assert.equal(note(), null);
});

test('two lost sends leave one line: the time, the pane, the exit code and the CLI\'s own words', () => {
  setup('2 unreached 0'); hook('Stop'); settle(2);
  assert.equal(idle().length, 2);
  const lines = (note() || '').split('\n').filter(Boolean);
  assert.equal(lines.length, 1, String(note()));
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ pane _7: idle not delivered after a retry \(exit 1\): Kosmos is not reachable right now\.$/);
});

test('a "not recorded" for another reason (a save that failed) is retried, and noted when it fails again', () => {
  setup('2 unsaved 0'); hook('Stop'); settle(2);
  assert.equal(idle().length, 2, JSON.stringify(idle()));
  assert.match(String(note()), /idle not delivered after a retry \(exit 1\): That was not recorded: we could not save that report\.$/m);
});

test('the hook keys on the board\'s own words for a deliberate wait, so rewording them cannot quietly stop retries', () => {
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'selfreport.js'), 'utf8');
  const waits = src.split("skipped: 'waiting'").length - 1;
  const words = src.split('did not overwrite').length - 1;
  assert.ok(waits >= 3 && words >= waits, 'every skipped:waiting answer says "did not overwrite" (' + words + ' of ' + waits + ')');
  assert.match(fs.readFileSync(HOOK, 'utf8'), /grep -qE 'did not overwrite\|/, 'and the hook matches that phrase');
});

test('a session with no tmux pane (the person\'s own Claude) sends once, as before: no retry, no note', () => {
  setup('2 unreached 0'); hook('Stop', { TMUX_PANE: null }); settle(1);
  assert.equal(idle().length, 1, JSON.stringify(idle()));
  assert.equal(note(), null);
});

test('Kosmos not running at all is neither retried nor noted', () => {
  setup('2 down 0'); hook('Stop'); settle(1);
  assert.equal(idle().length, 1, JSON.stringify(idle()));
  assert.equal(note(), null);
});
