/**
 * The uninstall finds agents through tmux itself, not only through plists
 * (#156). Rick: created by Kosmos, files wiped, session survived, back on
 * every board for a week -- because the kill pass iterated plists and the
 * wipe had removed them. These are SOURCE pins, the same posture as the
 * markup pins: the uninstall is verified by hand per its own harness note,
 * and what a unit test can hold is that neither pass loses its gates.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SH = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

test('the uninstall sweeps live sessions by @kosmos_agent, after the plist loop', () => {
  const sweep = SH.indexOf("list-sessions -F '#{session_name}'");
  assert.ok(sweep > -1, 'the tmux sweep is gone: a wipe that removed plists orphans running agents again');
  const plistLoop = SH.indexOf('for _plist in "$_agents_dir"/com.kosmos.agent.*.plist');
  assert.ok(plistLoop > -1 && plistLoop < sweep, 'the sweep must follow the plist loop, which also boots out launchd jobs');
  /* Both gates, on the sweep itself: ownership proven by the session naming
     ITSELF, and the exact-match target (this repo measured `-t sam` killing
     samantha-discord). */
  const tail = SH.slice(sweep, sweep + 900);
  assert.match(tail, /show-options -t "=\$_sname" -v @kosmos_agent/, 'the sweep kills without proving ownership');
  assert.match(tail, /\[ "\$_owner" = "\$_sname" \]/, 'the sweep does not require the session to name itself');
  assert.match(tail, /kill-session -t "=\$_sname"/, 'the sweep kill is not exact-match anchored');
  assert.doesNotMatch(tail, /kill-server/, 'the sweep must never kill the server; it is not ours on a shared machine');
});

test('the sweep survives a tmux with nothing to list, which is every clean Mac (#224 find)', () => {
  /* 🛑 EXECUTED, under the script's own `set -euo pipefail`, because this
     is the defect a source pin cannot fail toward: the unguarded pipeline
     read green in every string check while `list-sessions` exiting 1 (no
     server -- the state of any Mac that never created an agent) aborted
     the ENTIRE uninstall mid-flight, after the kosmos command was removed
     and before the app was. Found by tools/clean-machine.sh against the
     served installer. The lifted region runs with a stub tmux that fails
     exactly like a serverless one, and the sentinel after the block proves
     the script survives to keep uninstalling. */
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-')));
  fs.mkdirSync(path.join(sb, 'tmux', 'bin'), { recursive: true });
  const stub = path.join(sb, 'tmux', 'bin', 'tmux');
  fs.writeFileSync(stub, '#!/bin/sh\necho "no server running" >&2\nexit 1\n');
  fs.chmodSync(stub, 0o755);

  /* TWO blocks test the same binary (the plist loop above the sweep does
     too), so the anchor walks BACK from the sweep's own list-sessions to
     its enclosing if: the first draft anchored the first if and lifted the
     plist loop's tail, whose loop variable is unbound in isolation. */
  const ls = SH.indexOf("list-sessions -F '#{session_name}'");
  const at = SH.lastIndexOf('if [ -x "$KOSMOS_HOME/tmux/bin/tmux" ]; then', ls);
  assert.ok(ls > -1 && at > -1, 'the sweep block moved; re-anchor this test');
  const end = SH.indexOf('fi', SH.indexOf('done || true', at));
  assert.ok(end > at, 'the sweep block lost its pipeline guard, which is the abort defect itself');
  const region = SH.slice(at, end + 2);

  const script = 'set -euo pipefail\nKOSMOS_HOME=' + JSON.stringify(sb) + '\n'
    + 'info() { :; }\n_agents_stopped=no\n' + region + '\necho SURVIVED';
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  assert.match(out, /SURVIVED/,
    'a serverless tmux aborted the uninstall mid-flight again: the pipeline guard is gone');
});
