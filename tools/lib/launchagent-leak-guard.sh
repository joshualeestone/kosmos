#!/usr/bin/env bash
# tools/lib/launchagent-leak-guard.sh
#
# #3011: a suite-level guard against a test leaking a real com.kosmos.agent.* plist
# into the operator's ~/Library/LaunchAgents.
#
# A test that creates agents without setting AGENT_WORKFORCE_LAUNCH into its own
# sandbox makes create.js's agentsDir() fall back to the real ~/Library/LaunchAgents
# (create.js: `AGENT_WORKFORCE_LAUNCH || path.join(homeDir(),'Library','LaunchAgents')`),
# so fleet.install writes each fixture agent's plist into the real launchd dir. launchd
# then shows those fixtures as phantom agents on the board. That is exactly what
# status.codex-observed-2413.test.js did (five codex* phantoms, kosmos#3011).
#
# The guard: snapshot the real com.kosmos.agent.*.plist set BEFORE the suite runs;
# after the suite, refuse if any was CREATED or MODIFIED during the run. A machine's
# genuine, pre-existing fleet plists sit in the baseline and never trip it -- only a
# NEW file, or one whose mtime changed during the run, is a leak.
#
# Parameterized by <dir> so the control test can exercise it against a temp dir
# WITHOUT touching the operator's real home. That matters: the naive control (run the
# unfixed suite and watch the guard fire) re-leaks onto the real box, which is the very
# harm this guards. run-tests.sh passes the real "$HOME/Library/LaunchAgents".

# _la_mtime <file> -> the file's mtime in epoch seconds, portable across BSD/macOS
# (stat -f %m) and GNU/Linux (stat -c %Y). 0 if it cannot be read.
_la_mtime() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0
}

# launchagent_snapshot <dir> -> prints one "<mtime>\t<path>" line per
# com.kosmos.agent.*.plist directly in <dir>, sorted (LC_ALL=C) so comm can diff it.
# Empty output when <dir> has none or does not exist. A changed mtime yields a
# different line, so a MODIFIED plist is caught as well as a new one.
launchagent_snapshot() {
  local dir="$1" f
  [ -n "$dir" ] || return 0
  find "$dir" -maxdepth 1 -type f -name 'com.kosmos.agent.*.plist' 2>/dev/null \
    | while IFS= read -r f; do printf '%s\t%s\n' "$(_la_mtime "$f")" "$f"; done \
    | LC_ALL=C sort
}

# launchagent_leak_check <dir> <before_snapshot_file> : re-snapshot <dir> and compare
# against the pre-suite snapshot in <before_snapshot_file>. Prints each leaked plist
# PATH to stderr and returns 1 if any com.kosmos.agent.* was created or modified during
# the run; returns 0 (clean) otherwise. Fail-soft: if the args are unusable it returns
# 0 rather than reddening the suite on its own bookkeeping.
launchagent_leak_check() {
  local dir="$1" before="$2" after leaked
  [ -n "$dir" ] && [ -f "$before" ] || return 0
  after="$(mktemp "${TMPDIR:-/tmp}/la-leak-after.XXXXXXXXXX")" || return 0
  launchagent_snapshot "$dir" > "$after"
  # comm -13: lines only in <after> (a new path, or a same path with a new mtime).
  # Both inputs are LC_ALL=C-sorted by launchagent_snapshot. cut drops the mtime column.
  leaked="$(LC_ALL=C comm -13 "$before" "$after" | cut -f2-)"
  rm -f "$after"
  if [ -n "$leaked" ]; then
    printf '%s\n' "$leaked" >&2
    return 1
  fi
  return 0
}
