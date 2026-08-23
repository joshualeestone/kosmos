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
  /* The guard is capture-then-loop: ONLY list-sessions is forgiven, so a
     future unguarded command in the loop body still fails loudly instead
     of silently truncating the sweep before the uninstall deletes the
     agents' tmux out from under them. */
  const capture = SH.indexOf('|| true)"', at);
  const heredocClose = SH.indexOf('\nKOSMOS_SWEEP_LIST', SH.indexOf('done <<KOSMOS_SWEEP_LIST', at));
  assert.ok(capture > at && capture < ls + 200, 'list-sessions lost its own || true, the abort defect itself');
  assert.ok(heredocClose > at, 'the loop is a pipeline again, which both aborts on serverless and drops the flag in a subshell');
  const end = SH.indexOf('fi', heredocClose);
  const region = SH.slice(at, end + 2);

  const script = 'set -euo pipefail\nKOSMOS_HOME=' + JSON.stringify(sb) + '\n'
    + 'info() { :; }\n_agents_stopped=no\n' + region + '\necho SURVIVED=$_agents_stopped';
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  assert.match(out, /SURVIVED=no/,
    'a serverless tmux aborted the uninstall mid-flight again: the guard is gone');
});

test('the sweep flag reaches the shell that reads it, proven with a session to stop', () => {
  /* The pipeline form assigned _agents_stopped in a subshell, so the
     closing message that branches on it was wrong for every machine whose
     only agents ran without background jobs. The heredoc loop runs in the
     parent shell; a stub tmux offering one self-owned session must flip
     the flag HERE, where the message can see it. */
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sweep2-')));
  fs.mkdirSync(path.join(sb, 'tmux', 'bin'), { recursive: true });
  const stub = path.join(sb, 'tmux', 'bin', 'tmux');
  fs.writeFileSync(stub, ['#!/bin/sh',
    'case "$1" in',
    '  list-sessions) echo aa ;;',
    '  show-options) echo aa ;;',
    '  kill-session) : ;;',
    'esac', ''].join('\n'));
  fs.chmodSync(stub, 0o755);

  const ls = SH.indexOf("list-sessions -F '#{session_name}'");
  const at = SH.lastIndexOf('if [ -x "$KOSMOS_HOME/tmux/bin/tmux" ]; then', ls);
  const end = SH.indexOf('fi', SH.indexOf('\nKOSMOS_SWEEP_LIST', SH.indexOf('done <<KOSMOS_SWEEP_LIST', at)));
  const region = SH.slice(at, end + 2);
  const script = 'set -euo pipefail\nKOSMOS_HOME=' + JSON.stringify(sb) + '\n'
    + 'info() { :; }\n_agents_stopped=no\n' + region + '\necho FLAG=$_agents_stopped';
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  assert.match(out, /FLAG=yes/,
    'the stopped-agents flag died in a subshell again, so the closing message lies about the sweep');
});

test('no launchctl call escapes a sandboxed run into the real gui domain', () => {
  /* launchd has no sandbox: AGENT_WORKFORCE_LAUNCH redirects plist FILES, but
     "gui/$uid" is always the real domain. Found live 2026-08-23: a suite run
     bootstrapped its temp-pathed board plist over the product's own label,
     and when the sandbox was deleted the real board ran unsupervised. Every
     launchctl invocation must sit inside a sandbox gate. Sliced per site so
     a new ungated call fails by line, not by vibe. */
  const lines = SH.split('\n');
  const offenders = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/launchctl (enable|bootout|bootstrap|kickstart)/.test(lines[i])) continue;
    if (/^\s*#/.test(lines[i])) continue;
    /* The gate must appear in the enclosing 12 lines: either arm of it. */
    const above = lines.slice(Math.max(0, i - 12), i).join('\n');
    const gated = /-z "\$\{AGENT_WORKFORCE_LAUNCH:-\}"/.test(above)
      || /-n "\$\{AGENT_WORKFORCE_LAUNCH:-\}"/.test(above);
    if (!gated) offenders.push((i + 1) + ': ' + lines[i].trim());
  }
  assert.deepEqual(offenders, [],
    'launchctl calls with no sandbox gate in reach; a suite run can act on the real launchd domain');
});
