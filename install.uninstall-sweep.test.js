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
