'use strict';
/**
 * #2321 (sibling, same class as cmd_post): `kosmos agents` must NARRATE a tmux
 * that cannot list, not abort silently.
 *
 * cmd_agents read `_ls="$(tmux list-sessions 2>&1)"; _rc=$?` -- the bare form. Under
 * /bin/bash 3.2 + `set -euo pipefail`, a failing command substitution in a bare
 * assignment aborts the whole process at that line. `tmux list-sessions` exits
 * NON-ZERO exactly when there is no server, which is the case the #728 "None"/
 * "Could not see" branches exist to narrate -- so on a machine with no agents,
 * `kosmos agents` aborted silently (empty output, exit 1) at the exact moment a
 * person is trying to find their agents. Fixed with `local _ls _rc=0; ... || _rc=$?`.
 *
 * These drive the real CLI with a FAKE tmux (an executable that exits with a chosen
 * code + message), so the failing list-sessions path is genuinely exercised.
 *
 * NOTE on what discriminates: cmd_agents prints its "Sessions on this computer..."
 * HEADER (say, line ~514) BEFORE the list-sessions call, so the unfixed abort still
 * leaves that header on stdout -- a bare "stdout is non-empty" check would pass on
 * the bug. The load-bearing assertions are the ANSWER lines ("None..." / "Could not
 * see..."), which the abort kills. Verified against the unfixed tree: the header
 * printed, the answer did not, so these matches red on the bug and pass on the fix.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

// A fake tmux: a tiny shell script that, for `list-sessions`, prints `msg` (to the
// stream the real tmux uses -- errors go to stderr, which the CLI folds in via 2>&1)
// and exits with `code`.
function fakeTmux(msg, code, stream) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2321-tmux-'));
  const bin = path.join(dir, 'tmux');
  const to = stream === 'out' ? '1' : '2';
  fs.writeFileSync(bin, `#!/bin/bash\nif [ "$1" = "list-sessions" ]; then printf '%s\\n' ${JSON.stringify(msg)} >&${to}; exit ${code}; fi\nexit 0\n`);
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

function runAgents(tmuxBin) {
  return new Promise((resolve) => {
    const env = { ...process.env, AGENT_WORKFORCE_TMUX_BIN: tmuxBin };
    execFile(CLI, ['agents'], { env, timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

test('#2321: no tmux server -> "None", not a silent abort (set -e guard)', async () => {
  const { dir, bin } = fakeTmux('no server running on /private/tmp/tmux-501/default', 1, 'err');
  try {
    const out = await runAgents(bin);
    // The ANSWER, not just the header: the unfixed abort leaves the header but never
    // reaches this line, so a match here reds on the bug (verified against origin).
    assert.match(out.stdout, /None\. No tmux server is running/, 'a genuinely absent server must say None (the abort killed this line)');
    assert.notEqual(out.code, 0, 'the None case still exits non-zero');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#2321: a tmux that cannot READ the server -> "Could not see", not None and not silent', async () => {
  const { dir, bin } = fakeTmux('server exited unexpectedly', 1, 'err');
  try {
    const out = await runAgents(bin);
    assert.match(out.stdout, /Could not see/, 'a readable-refusal must be narrated as blindness, not None (the abort killed this line)');
    assert.doesNotMatch(out.stdout, /None\. No tmux server/, 'a non-absent refusal must not claim None');
    assert.equal(out.code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#2321 CONTROL: a server that lists sessions is printed and exits 0 (the fix does not break success)', async () => {
  const { dir, bin } = fakeTmux('worker-1: 1 windows (created ...)', 0, 'out');
  try {
    const out = await runAgents(bin);
    assert.match(out.stdout, /worker-1: 1 windows/, 'a successful list must print the sessions');
    assert.equal(out.code, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
