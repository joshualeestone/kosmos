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
# #4392: agents named with the RESERVED live-check prefix are skipped. A post-promote live check
# (the live-check harness, kosmos#4392) makes real agents on the operator's board, so
# their plists land here; on 2026-09-28 three such runs reddened every full suite running at the same time
# (Angel's and Kitty's), for a leak that was not theirs. The live check names its agents zz-livecheck-*, and no
# TEST may use that prefix (tools/test-launchagent-leak-guard-3011.sh counts it), so a test that leaks is
# still caught. Only the exact prefix is skipped: com.kosmos.agent.zz-test-* and every other name still count.
LAUNCHAGENT_LIVECHECK_PREFIX='zz-livecheck-'
launchagent_snapshot() {
  local dir="$1" f
  [ -n "$dir" ] || return 0
  find "$dir" -maxdepth 1 -type f -name 'com.kosmos.agent.*.plist' ! -name "com.kosmos.agent.${LAUNCHAGENT_LIVECHECK_PREFIX}*.plist" 2>/dev/null \
    | while IFS= read -r f; do printf '%s\t%s\n' "$(_la_mtime "$f")" "$f"; done \
    | LC_ALL=C sort
}

# launchagent_leak_check <dir> <before_snapshot_file> : re-snapshot <dir> and compare
# against the pre-suite snapshot in <before_snapshot_file>. Prints each leaked plist
# PATH to stderr and returns 1 if any com.kosmos.agent.* was created or modified during
# the run; returns 0 (clean) otherwise. Fail-soft: if the args are unusable it returns
# 0 rather than reddening the suite on its own bookkeeping.
#
# #5092: the machine's LIVE Kosmos restarting one of its OWN agents during the run is not a leak. On Mortals
# (2026-10-02 22:11) Josh switched Liu Kang mid-suite; the live board rewrote com.kosmos.agent.liukang.plist
# (born Sep 11) and the full run of an unrelated branch went red. So a changed plist is skipped when BOTH hold:
#   - it was already in the pre-suite snapshot (MODIFIED, never NEW: a new plist is the #3011 leak shape and
#     always reds, whatever it points at), and
#   - its WorkingDirectory is directly under the live install's workers root (<live_root>/<name>). Tests are
#     expected to sandbox AGENT_WORKFORCE_WORKERS into a temp dir; that is a per-test convention, not enforced
#     here (run-tests.sh exports none), so the real backstop is #3605, below.
# <live_root> is the optional 4th argument, default $HOME/work/workers (the product's default,
# store.workersRootFor); an empty 4th argument also means the default (${4:-...}), and "/" turns the skip off
# (it trims to an empty root, which launchagent_live_owned refuses). Each skip is written to the optional 3rd
# argument (a file) so the runner can say so. The WorkingDirectory is read by launchagent_leak_origin, which
# takes the one-line form create.js writes; a multi-line plist from another writer reads empty and is not
# skipped (it reds, the safe direction).
# Weakest premise: a writer that rewrites a REAL pre-existing plist AND keeps its real WorkingDirectory now
# passes. #3605 refuses in-process fs writes into the real LaunchAgents under node --test (launch-guard.js) and
# create.js refuses under NODE_TEST_CONTEXT; NOT covered: a child spawned with a scrubbed env and no preload, or
# a shell tool (cp, plutil, touch) run by a test. That is the residual hole.
# Known false red, accepted (#5092 review 1): only the DEFAULT world's root is trusted. An agent in a named world
# (engine/worlds.js: <world>/workers) or a connected-folder agent (create.js workerDir -> its recorded dir)
# restarted mid-suite still reds. It fails safe (a red, never a hidden leak); widening means reading the worlds
# registry and recorded dirs from the shell.
launchagent_live_owned() {   # <plist> <live_root> -> 0 when its WorkingDirectory is <live_root>/<one name>
  local wd root="${2%/}"
  [ -n "$root" ] || return 1
  wd="$(launchagent_leak_origin "$1")"
  case "$wd" in
    "$root"/*) ;;
    *) return 1 ;;
  esac
  local rest="${wd#"$root"/}"
  case "$rest" in ''|*/*|.|..) return 1 ;; esac
  return 0
}
launchagent_leak_check() {
  local dir="$1" before="$2" notes="${3:-}" live_root="${4:-${HOME:-}/work/workers}" after leaked kept="" f
  [ -n "$dir" ] && [ -f "$before" ] || return 0
  after="$(mktemp "${TMPDIR:-/tmp}/la-leak-after.XXXXXXXXXX")" || return 0
  launchagent_snapshot "$dir" > "$after"
  # comm -13: lines only in <after> (a new path, or a same path with a new mtime).
  # Both inputs are LC_ALL=C-sorted by launchagent_snapshot. cut drops the mtime column.
  leaked="$(LC_ALL=C comm -13 "$before" "$after" | cut -f2-)"
  rm -f "$after"
  # #5092: drop a MODIFIED plist the live install owns (see above); keep everything else.
  if [ -n "$leaked" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if cut -f2- "$before" | grep -qxF -- "$f" && launchagent_live_owned "$f" "$live_root"; then
        [ -n "$notes" ] && printf '%s\n' "$f" >> "$notes"
        continue
      fi
      kept="${kept}${f}
"
    done <<EOF_LEAKED
$leaked
EOF_LEAKED
    leaked="$(printf '%s' "$kept" | sed '/^$/d')"
  fi
  if [ -n "$leaked" ]; then
    printf '%s\n' "$leaked" >&2
    return 1
  fi
  return 0
}

# launchagent_leak_origin <plist> -> the plist's WorkingDirectory, i.e. the sandbox the
# writing test was using. #3605: the leak check above cannot say WHOSE run wrote a plist,
# only that one appeared while this suite ran. On 2026-09-24 a checkout that predated
# #3011 leaked five while another branch's suite was running, and that branch was blamed.
# The sandbox path is the one clue the file carries, so the report prints it. Empty when
# the plist has no WorkingDirectory or cannot be read.
launchagent_leak_origin() {
  [ -r "$1" ] || return 0
  sed -n '/<key>WorkingDirectory<\/key>/{s:.*<key>WorkingDirectory</key><string>\(.*\)</string>.*:\1:p;q;}' "$1" 2>/dev/null
}
