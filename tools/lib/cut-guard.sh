# #4206: share heavy-gate's sandbox PATH rule (a cwd or script in run-tests.sh's
# kt<digits> sandbox) through tools/lib/process-fixture.sh, beside a node --test ancestor check.
# heavy-gate keeps its own cwd read and ancestry walk, and differs on purpose: it drops a pid that
# has already exited, where these guards count it and refuse. This file
# is sourced by Bash callers, so BASH_SOURCE resolves this library even when the
# caller's cwd is elsewhere.
_kosmos_cut_guard_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! . "$_kosmos_cut_guard_lib_dir/process-fixture.sh"; then
  # Not every caller enables set -e. Keep every candidate when the classifier
  # is unavailable, so a missing library can only over-refuse, never turn a
  # live cut into an empty process list.
  _kosmos_pid_has_node_test_ancestor() { return 1; }
  _kosmos_pid_is_test_fixture() { return 1; }
fi
unset _kosmos_cut_guard_lib_dir

# --- Shared: is a matched process THIS run, or a separate one? (#1391) -------
# Both guards below match a process by its command line and must then exclude
# the caller's OWN run so it does not refuse itself. A single-pid exclusion is
# not enough, for two measured reasons (#1391, reproduced deterministically):
#   1. macOS `pgrep -f` never lists its own ANCESTOR, so the caller's process
#      (the guard runs INSIDE it) is invisible to pgrep -- the pid exclusion
#      targets a line pgrep never returns, i.e. it was dead code.
#   2. A run forks bash subshells that INHERIT its command line with fresh pids
#      (any `( a; b )`, background job or `$( )` that does not immediately exec).
#      Those are the caller's own DESCENDANTS, matched by pgrep, and a single
#      pid cannot drop them -- which made the browser gate refuse its own page
#      layer while nothing else was running.
# So the caller's run is "self + everything descended from self". This walks a
# candidate's parent chain: reaching `root` means the candidate is part of THIS
# run; only a candidate OUTSIDE the caller's subtree is a genuinely separate
# run. A pid ps cannot resolve (a probe's synthetic pid, or one that just
# exited) is treated as NOT ours and left in the list -- an unresolvable match
# is safer reported than silently dropped.
# KNOWN RESIDUAL, deliberate: the walk reads a LIVE tree, so a nested descendant
# whose intermediate ancestor exits mid-walk (reparented to pid 1) can miss
# `root` and read as a separate run -- a self-inflicted false positive, the very
# class that first disarmed this guard. It is bounded: in the real path the
# matched subshells are DIRECT children of a live caller, so the walk hits `root`
# on the first hop. A process-group test would survive reparenting but cannot
# tell a sibling in the same group from a separate run (which the tests model as
# exactly that), so the ancestry walk is kept and the residual is named, not
# hidden. The direction is the safe one: it over-reports (refuses), never misses
# a genuinely separate run.
_kosmos_pid_is_self_or_descendant() {
  local pid="$1" root="$2" hops=0
  { [ -n "$pid" ] && [ -n "$root" ]; } || return 1
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    [ "$pid" = "$root" ] && return 0
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    hops=$((hops + 1)); [ "$hops" -gt 64 ] && break
  done
  return 1
}

# Read `pid cmdline` lines on stdin; print only those whose pid is NEITHER the
# caller (`$1`) nor one of its descendants -- i.e. a genuinely separate run.
_kosmos_drop_self_subtree() {
  local self="$1" line cpid
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    cpid="${line%% *}"
    _kosmos_pid_is_self_or_descendant "$cpid" "$self" && continue
    printf '%s\n' "$line"
  done
}

# Read `pid cmdline` lines and remove only proven unit-test fixtures: a node --test ancestor, or
# a cwd or script in the run-tests.sh sandbox (the same path rule heavy-gate uses). A pid whose ancestry
# and cwd cannot be read stays in the list unless its script path is in the sandbox, which preserves
# the guard's refuse-rather-than-guess posture.
_kosmos_drop_test_fixtures() {
  # The interpreter is ([^ ]*/)?(ba)?sh, as wide as _kosmos_suite_candidates's, so a fixture started by
  # a Homebrew bash is dropped by its script path too (#4410 review 13).
  local line pid script re='^[0-9]+ +([^ ]*/)?(ba)?sh +(([^ ]*/)?tools/(release|browser-checks|test-install|run-tests)\.sh)( |$)'
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"
    script=""
    [[ "$line" =~ $re ]] && script="${BASH_REMATCH[3]}"
    _kosmos_pid_is_test_fixture "$pid" "$script" && continue
    printf '%s\n' "$line"
  done
}

# --- Harness-owned run markers (#1796) ---------------------------------------
# A guard that greps the process table for a script NAME cannot cleanly separate
# RUNNING the script from WORKING on it, and its self-exclusion has to walk the
# LIVE process tree (`_kosmos_pid_is_self_or_descendant`), which races under load:
# a nested descendant whose intermediate ancestor exits mid-walk is reparented to
# pid 1, misses `root`, and reads as a separate run. The card's fix (#1796): a real
# RUN can leave a mark a mention/edit/worktree-name never has, and the guard can
# read the mark instead of walking a tree.
#
# Shape: $DIR/<type>.<pid>, body a cookie unique to THIS run. A reader IGNORES a
# marker whose pid is dead (a crashed run cannot be holding the box) and unlinks it,
# and excludes its OWN run by COOKIE -- a string compare, no ps walk. "Working on
# the script" (an editor, `bash -n`, `git add`, a worktree named after it) writes no
# marker, so it is never a candidate: the run-vs-work split the name-grep cannot make.
#
# This is ADDITIVE. The name-based arm below is UNCHANGED and still runs, so a
# concurrent run from a build that predates markers (the transition, and any caller
# not yet wired to kosmos_mark_run) is still caught -- a guard is refused if EITHER
# arm finds a separate live run. Once every caller marks, the name arm is a backstop.
#
# 🛑 WHAT THIS DOES AND DOES NOT CLOSE. The refusal is `{ name arm } || { marker arm }`,
# so the marker arm ADDS a reliable signal; it does NOT replace the name arm. The name
# arm still walks the live tree (_kosmos_drop_self_subtree), and that walk still
# carries the reparent race for the ONE caller that genuinely self-matches
# (browser-checks.sh forks subshells inheriting its own command line). So problem 1 of
# #1796 -- the race -- is MITIGATED (removed from the primary/marker path), NOT
# ELIMINATED: an OR'd name arm can still false-refuse under load even while the marker
# arm correctly excludes this run by cookie. Fully closing it means RETIRING the name
# arm + its walk once every caller marks (a follow-up, deliberately not done here to
# keep the transition backstop). Do not read this change as "the race is closed." What
# IS closed here is the structural run-vs-work split (working writes no marker) and the
# self-exclusion race on the marker path (a cookie compare, no walk).
#
# KNOWN RESIDUAL, named as the code above names its own: a marker's pid can be
# REUSED by an unrelated process between the marking run exiting and the next reader
# cleaning the stale marker, so a reader can read a live-but-foreign pid and refuse.
# The window is small (every guard call cleans dead-pid markers first) and the
# direction is the safe one this file already chooses -- it over-refuses, never
# misses a genuinely separate run -- and the same KOSMOS_*_IGNORE_* override clears it.
# Two more residuals, both harmless on this single-user box and named for the reader:
#   - `kill -0 <pid>` returns non-zero (EPERM) for a LIVE process owned by ANOTHER
#     user, so a foreign-user run reads as stale (a miss, the unsafe direction) rather
#     than a refuse. Every agent here runs as one user, and the name arm still
#     name-matches a foreign-user run, so it is backstopped.
#   - cleanup is LAZY and per-type: a `cut` check only sweeps `cut.*`. A type whose
#     guard is never called again would leave dead-pid files until it is. Harmless
#     (every real run triggers a same-type check that sweeps it); it does not leak
#     into detection because a dead-pid marker is never counted as a live run.
# Keyed off $HOME, NOT $TMPDIR: two runs on the same Mac with divergent TMPDIR (a
# launchd-spawned run vs a terminal one) would otherwise write to different dirs and
# the marker arm could not cross-detect them. $HOME is the one path every run on this
# box shares (like the sibling ~/.cache monitors). It survives a reboot, which is
# handled the same way any stale marker is: a reboot leaves dead-pid markers the next
# reader cleans -- modulo the pid-reuse residual named above (a booted process reusing
# the old pid reads as live), which is bounded and safe-direction there.
_kosmos_marker_dir() { printf '%s' "${KOSMOS_RUN_MARKER_DIR:-${HOME:-/tmp}/.cache/kosmos-run-markers}"; }

# kosmos_mark_run <type>  — the run declares itself. <type> must be a shell-identifier
# word ([A-Za-z_]+): it is uppercased into the env-var name KOSMOS_RUN_COOKIE_<TYPE>,
# so a hyphen/dot (`page-layer`) would make the export a no-op and the reader misparse
# -- a self-refuse for that caller. The three wired types are cut / harness / browser.
# Call once, where the script
# sources this lib, BEFORE the refuse check. Exports KOSMOS_RUN_COOKIE_<TYPE> so the
# guard excludes THIS run. Best-effort: a mark it cannot write just leaves the name
# arm to cover this run. No trap (so it cannot clobber a caller's EXIT trap): a clean
# exit's marker lingers only until the next reader sees its pid is dead and unlinks
# it, so a crash can never strand a live-LOOKING marker.
kosmos_mark_run() {
  local type="${1:-}" dir cookie uc
  [ -n "$type" ] || return 0
  # Enforce the identifier invariant at runtime, not only in the header: a type with a
  # hyphen/dot would make the cookie var-name invalid and self-refuse that caller.
  case "$type" in *[!A-Za-z_]*) return 0 ;; esac
  uc="$(printf '%s' "$type" | tr '[:lower:]' '[:upper:]')"
  [ -n "$uc" ] || return 0     # a nameless cookie var would make the guard refuse THIS run
  dir="$(_kosmos_marker_dir)"
  mkdir -p "$dir" 2>/dev/null || return 0
  cookie="$$-$(date +%s 2>/dev/null || echo 0)-${RANDOM:-0}${RANDOM:-0}"
  # Export the self-cookie BEFORE writing the marker, so a reader in this process can
  # never see a marker without also seeing the cookie that excludes it -- a partial
  # success must not strand a marker that self-refuses.
  export "KOSMOS_RUN_COOKIE_$uc=$cookie"
  # #2215: record THIS process's command alongside the cookie, so the liveness
  # reader can tell a still-live marking run from a RECYCLED pid. A marker file
  # outlives the process that wrote it, and the OS reuses pids, so `kill -0 <pid>`
  # alone reports an unrelated live process (a recycled pid landing on a system
  # daemon) as the marking run -- the 6.32 cut aborted on exactly that. Line 1 is
  # the cookie (its VALUE unchanged; the read just moves to line 1) for the
  # self-exclusion compare; line 2 is the command the
  # reader re-checks the live pid against.
  printf '%s\n%s\n' "$cookie" "$(ps -ww -o command= -p "$$" 2>/dev/null)" > "$dir/$type.$$" 2>/dev/null || return 0
  return 0
}

# _kosmos_marker_other_live <type>  — echo a one-line description of a LIVE run of
# <type> that is NOT this caller's own (by cookie), or nothing. Unlinks markers it
# can prove are not a live marking run as it goes: a dead pid, a pid whose command
# no longer matches the one recorded at mark time (a recycled pid, #2215), or a
# pre-#2215 marker with no recorded command. Read-only w.r.t. a run it CAN verify
# is live (pid alive AND command matches).
# #4911: true when KOSMOS_EXCLUDE_PGID names <pid>'s process group. Set only by browser-checks.sh's pre-wait check, so
# the live side turn's OWN page layer (its command runs in its own group, published beside the side claim) does not make
# a heavy holder's page layer refuse: that one waits for the side turn instead. Unset, nothing is excluded.
_kosmos_in_excluded_pgid() {
  local want="${KOSMOS_EXCLUDE_PGID:-}" pg
  case "$want" in ''|*[!0-9]*) return 1 ;; esac
  pg="$(ps -o pgid= -p "$1" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$pg" ] && [ "$pg" = "$want" ]
}
_kosmos_marker_other_live() {
  local type="${1:-}" dir uc self f pid cookie stored_cmd live_cmd
  [ -n "$type" ] || return 0
  dir="$(_kosmos_marker_dir)"
  [ -d "$dir" ] || return 0
  uc="$(printf '%s' "$type" | tr '[:lower:]' '[:upper:]')"
  eval "self=\"\${KOSMOS_RUN_COOKIE_$uc:-}\""
  for f in "$dir/$type".*; do
    [ -e "$f" ] || continue                       # no glob match -> nothing marked
    pid="${f##*.}"
    case "$pid" in ''|*[!0-9]*) continue ;; esac   # not a <type>.<pid> file
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$f" 2>/dev/null                        # stale: the marking run is gone
      continue
    fi
    # #2215: a live pid is NOT proof the marking run is alive. The OS reuses pids,
    # so kill -0 can succeed against an unrelated process that inherited a dead
    # run's pid (a recycled pid on a system daemon aborted the 6.32 cut). Require
    # the live pid's command to still match the one the marking run recorded
    # (line 2). A mismatch (recycled pid), OR a marker with no recorded command
    # (written before #2215), is treated as stale and unlinked -- which also
    # clears the accumulation of latent false-positive markers the old kill-0-only
    # check could never remove. A genuine foreign run is still caught by the pgrep
    # NAME arm each guard OR's with this one, so unlinking an unverifiable marker
    # loses no real detection.
    stored_cmd="$(sed -n '2p' "$f" 2>/dev/null)"
    live_cmd="$(ps -ww -o command= -p "$pid" 2>/dev/null)"
    if [ -z "$stored_cmd" ] || [ "$stored_cmd" != "$live_cmd" ]; then
      rm -f "$f" 2>/dev/null
      continue
    fi
    cookie="$(sed -n '1p' "$f" 2>/dev/null)"
    { [ -n "$self" ] && [ "$cookie" = "$self" ]; } && continue   # my own run
    _kosmos_in_excluded_pgid "$pid" && continue                 # #4911: the live side turn's own run, when asked
    printf 'a marked %s run (pid %s)\n' "$type" "$pid"
    return 0
  done
  return 0
}

# The live-cut guard (#708). Two copies of the install gate on one Mac share
# the harness's port range (probed from 4460), the real ~/Applications and /Applications
# fingerprints and the gui launchd domain, and they poison each other:
# measured 2026-08-26 01:29, a local run went red on "real home Applications
# unchanged" at the second cut 0.5.54's own gate was installing. A cut has
# no lock file; it has a process (tools/release.sh) for as long as it runs,
# so that is what this asks. The probe is a seam (KOSMOS_CUT_PROBE) so the
# guard can be shown red and green without a cut. A probe that cannot
# answer is a refusal, not a pass, the same posture as the disk guard.
# ⚠️ SELF-EXCLUSION IS NOT A REFINEMENT, IT IS THE WHOLE DIFFICULTY FOR THE
# SECOND CALLER. This asks "is a `bash tools/release.sh` running", and
# release.sh IS one. Wired into release.sh without excluding the caller, the
# guard refuses EVERY cut, on a Mac with no other cut, forever -- a total
# release outage that reads exactly like the guard working. The seam is an
# env var so the tests can drive it; it defaults to the caller's own pid.
# 🛑 CALLING CONTRACT for the pgrep-probing kosmos_refuse_if_* guards below (#4410 review): call as
# `kosmos_refuse_if_x "what" || exit 1`, or inside an `if`. Each runs `raw="$(pgrep ...)"; rc=$?`,
# and pgrep exits 1 when nothing matches, which is the ordinary nothing-running case. Called as a
# bare statement under `set -e` (release.sh and test-install.sh both set it), that exit 1 would end
# the caller silently at the very moment the answer is "go ahead". The `||` or `if` suspends -e for
# the whole call, which is why every call site in this repo is written that way.
kosmos_refuse_if_cut_live() {
  local what="${1:-this run}" probe="${KOSMOS_CUT_PROBE:-}" raw out rc self marker_other
  self="${KOSMOS_CUT_SELF_PID:-$$}"
  # #1796: the reliable arm -- a marked cut that is not this caller's own run. A
  # mention/edit/worktree never marks, so it is never a candidate; self-exclusion is
  # the cookie, not a live-tree walk. Runs alongside the name arm below (either
  # refuses), so a caller not yet wired to kosmos_mark_run is still covered.
  marker_other="$(_kosmos_marker_other_live cut)"
  if [ -n "$probe" ]; then
    out="$("$probe" 2>/dev/null)"; rc=$?
  else
    # ⚠️ THE PROCESS, NOT THE WORDS: a peer's shell whose command text merely
    # mentions release.sh (a git log, a grep, an eval) matched the first
    # draft and would have refused every run on a busy Mac. Only a bash/sh
    # whose own command line starts with the script counts. pgrep's status
    # is read from its own line, never after a pipe (#632).
    raw="$(pgrep -fl 'release\.sh' 2>/dev/null)"; rc=$?
    out="$(printf '%s\n' "$raw" | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/release\.sh( |$)' || true)"
    # pgrep: 0 matched, 1 nothing matched, 2+ could not run. After the
    # filter, an empty list is a clean "no cut" whichever of 0/1 pgrep said.
    if [ "$rc" -le 1 ]; then rc=0; [ -n "$out" ] || rc=1; fi
  fi
  # Drop the caller's own line, in BOTH paths, so the probe seam exercises the
  # same exclusion the real pgrep gets. An `out` emptied by this is a clean
  # "no OTHER cut", which the rc==0 test below already reads correctly.
  # 📌 This guard shares the #1391 flaw of the browser guard below: a single-pid
  # exclusion cannot drop the caller's own argv-inheriting subshells. It has not
  # bitten here because release.sh calls this at its very TOP, before it forks any
  # such subshell -- so it is left unchanged in the #1391 PR to keep an armed,
  # load-bearing guard out of scope. A focused follow-up can adopt
  # _kosmos_drop_self_subtree here too; the helper is already shared.
  if [ -n "$out" ] && [ -n "$self" ]; then
    out="$(printf '%s\n' "$out" | grep -v -E "^${self} " || true)"
  fi
  # #4206: release gate tests execute real tools/release.sh fixtures, so their
  # command is intentionally indistinguishable from a cut. Drop a candidate that is a
  # proven unit-test fixture: a node --test ancestor, or a cwd or script in run-tests.sh's
  # kt<digits> sandbox (tools/lib/process-fixture.sh, the path rule heavy-gate uses). An
  # unreadable pid stays counted.
  if [ -n "$out" ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_test_fixtures || true)"
  fi
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether a cut is running (the probe exited $rc); refusing to guess for $what. KOSMOS_HARNESS_IGNORE_CUT=1 runs anyway." >&2
    return 1
  fi
  if { [ "$rc" -eq 0 ] && [ -n "$out" ]; } || [ -n "$marker_other" ]; then
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"; [ -n "$detail" ] || detail="$marker_other"
    echo "a cut is running on this Mac ($detail); $what would share its ports, its real-folder fingerprints and its launchd domain, and either result could be the other's. Wait for the cut's 'completed' line in ~/.claude/logs/cut-suite-runs.log, or KOSMOS_HARNESS_IGNORE_CUT=1 to run anyway." >&2
    return 1
  fi
  return 0
}

# ⚠️ A SECOND SHAPE OF THE SAME HAZARD, AND THE RULE NAMED THE WRONG ONE.
# The fleet rule reads "do not run browser checks while a CUT is running",
# and this file detects a CUT. But what actually cost cut three was not a
# cut: it was TWO CONCURRENT PLAYWRIGHT RUNS competing for CPU, and the
# losing run failed six arms with errors that read exactly like missing code.
# A cut is only the most common way to have a second run. A hand-run page
# layer -- a pre-verify, someone re-running one check -- is equally fatal and
# is INVISIBLE to `kosmos_refuse_if_cut_live`, because there is no release.sh
# in it. Measured 2026-08-27 13:17Z: a peer's `bash tools/browser-checks.sh`
# had been live for 8m29s, `pgrep release.sh` returned rc=1 CORRECTLY, and
# the cut guard said clear. Nothing on this Mac would have stopped a second
# run. So the guard has to ask about the thing that breaks, not its cause.
# Same posture as above: a probe that cannot answer is a refusal, and the
# seam exists so this can be shown red and green without a real run.
kosmos_refuse_if_browser_run_live() {
  local what="${1:-this run}" probe="${KOSMOS_BC_PROBE:-}" raw out rc self marker_other
  self="${KOSMOS_BC_SELF_PID:-$$}"
  # #1796: the reliable arm. This guard is the one whose caller (browser-checks.sh)
  # genuinely self-matches -- it forks subshells inheriting `bash tools/browser-
  # checks.sh` -- so the live-tree walk below was its real race. The cookie excludes
  # the whole run (the subshells do not mark themselves), no walk.
  marker_other="$(_kosmos_marker_other_live browser)"
  if [ -n "$probe" ]; then
    out="$("$probe" 2>/dev/null)"; rc=$?
  else
    raw="$(pgrep -fl 'browser-checks\.sh' 2>/dev/null)"; rc=$?
    out="$(printf '%s\n' "$raw" | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/browser-checks\.sh( |$)' || true)"
    if [ "$rc" -le 1 ]; then rc=0; [ -n "$out" ] || rc=1; fi
  fi
  # ⚠️ EXCLUDE THE CALLER'S OWN SUBTREE, NOT JUST ITS PID (#1391). browser-checks.sh
  # IS a `bash tools/browser-checks.sh` and forks subshells that inherit that
  # command line with fresh pids, so a single-pid exclusion left the caller's own
  # descendants in the list and the gate refused its own page layer while nothing
  # else ran. See _kosmos_drop_self_subtree above for the mechanism.
  if [ -n "$out" ] && [ -n "$self" ]; then
    # || true for parity with the single-pid `grep -v` path above. The function
    # returns 0 today (a while-loop's status is its last executed body command,
    # printf/continue here, not the read that hits EOF), so this is defensive
    # rather than load-bearing: it keeps the assignment 0 under `set -o pipefail`
    # should the function ever be changed to return non-zero, and it matches the
    # sibling path.
    out="$(printf '%s\n' "$out" | _kosmos_drop_self_subtree "$self" || true)"
  fi
  # #4206 follow-up: a unit test's browser-checks.sh fixture is not a run, by the same rule as
  # the cut guard's. An unreadable pid stays in unless its script path is in the sandbox. This
  # filters the process list only; the run-marker check is not filtered. run-tests.sh does not
  # sandbox HOME, so a fixture that runs the real script must point HOME or KOSMOS_RUN_MARKER_DIR at
  # its own directory (test-cut-parallel-region.sh does), or it writes a marker this check will see.
  if [ -n "$out" ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_test_fixtures || true)"
  fi
  # #4911: the live side turn's own page layer, when the caller asks (see _kosmos_in_excluded_pgid).
  if [ -n "$out" ] && [ -n "${KOSMOS_EXCLUDE_PGID:-}" ]; then
    out="$(printf '%s\n' "$out" | while IFS= read -r l; do [ -n "$l" ] || continue; _kosmos_in_excluded_pgid "${l%% *}" || printf '%s\n' "$l"; done)"
  fi
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether another browser run is live (the probe exited $rc); refusing to guess for $what. KOSMOS_HARNESS_IGNORE_CUT=1 runs anyway." >&2
    return 1
  fi
  if { [ "$rc" -eq 0 ] && [ -n "$out" ]; } || [ -n "$marker_other" ]; then
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"; [ -n "$detail" ] || detail="$marker_other"
    echo "another browser-checks run is already live on this Mac ($detail); two Playwright runs starve each other of CPU and the loser fails with errors that read like missing code, so $what would produce a verdict you cannot trust. Wait for it to finish, or KOSMOS_HARNESS_IGNORE_CUT=1 to run anyway." >&2
    return 1
  fi
  return 0
}

# ⚠️ THE MIRROR OF THE CUT GUARD (#1713). `kosmos_refuse_if_cut_live` above lets
# the install HARNESS (tools/test-install.sh) refuse to START during a cut. The
# reverse was missing and is not the rarer case: a cut started while a harness is
# ALREADY running was unprotected, and the harness's own start-check cannot help
# -- it already ran. Measured 2026-08-31: a harness run overlapped the 16:40
# cut's start by ~32s; nothing broke that time. The harness holds a port (probed from 4460 up
# since then, not fixed; #4410) and boots real boards on it,
# and two things wanting it is not a slow test, it is a failed release step
# blamed on whatever the cut was doing then. So the CUT asks, at its own start,
# whether a harness is already live. A harness is a process (tools/test-install.sh)
# for as long as it runs; there is no lock file, same as a cut.
# 📌 THE PROCESS, NOT THE WORDS: only a bash/sh whose own command line IS
# tools/test-install.sh counts, so a peer shell that merely MENTIONS the script (a
# grep, a git log, the pkill that cleared the box during the 0.6.20 window) does
# not match -- the same robust filter the two guards above use. Self-subtree
# exclusion as #1391, defensive here: the cut caller is release.sh, never a
# test-install.sh, so it cannot self-match today; a future caller inside a harness
# would. The seam (KOSMOS_HARNESS_PROBE) shows it red and green without a real
# harness; a probe that cannot answer is a refusal, the same posture as above.
# #4410: a proven unit-test fixture (tools/lib/process-fixture.sh, the rule heavy-gate and the
# two guards above share since #4259) is not a harness, here as in heavy-gate. (The command
# shapes still differ: heavy-gate also counts a zsh or a bare name run from tools/, which the
# regex below does not.) tools/run-tests.sh now asks this too, before a suite starts beside a
# harness; the optional second argument is the caller's own way to override it.
# KOSMOS_HARNESS_KEEP_FIXTURES=1 is a test seam that keeps fixtures in the list, so
# tools/test-cut-guard.sh can prove the real pgrep detects a stand-in that every OTHER guard on
# the Mac drops. Left set by mistake it only refuses more, never less.
kosmos_refuse_if_harness_live() {
  local what="${1:-this run}" override="${2:-KOSMOS_CUT_IGNORE_HARNESS=1 cuts anyway}" probe="${KOSMOS_HARNESS_PROBE:-}" raw out rc self marker_other
  self="${KOSMOS_HARNESS_SELF_PID:-$$}"
  # #1796: the reliable arm -- a marked harness that is not this caller's own. This
  # is the guard the card measured firing during a cut: a real test-install.sh RUN
  # correctly refuses a cut (they share the install gate's port range), but the marker
  # means only a RUN counts -- editing test-install.sh, `bash -n`ing it, `git add`ing
  # it, or a worktree named after it marks nothing, so the person hardening the
  # guarded script does not block a cut merely by working on it.
  marker_other="$(_kosmos_marker_other_live harness)"
  if [ -n "$probe" ]; then
    out="$("$probe" 2>/dev/null)"; rc=$?
  else
    raw="$(pgrep -fl 'test-install\.sh' 2>/dev/null)"; rc=$?
    out="$(printf '%s\n' "$raw" | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |$)' || true)"
    if [ "$rc" -le 1 ]; then rc=0; [ -n "$out" ] || rc=1; fi
  fi
  if [ -n "$out" ] && [ -n "$self" ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_self_subtree "$self" || true)"
  fi
  if [ -n "$out" ] && [ "${KOSMOS_HARNESS_KEEP_FIXTURES:-0}" != 1 ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_test_fixtures || true)"
  fi
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether an install harness is running (the probe exited $rc); refusing to guess for $what. $override." >&2
    return 1
  fi
  if { [ "$rc" -eq 0 ] && [ -n "$out" ]; } || [ -n "$marker_other" ]; then
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"; [ -n "$detail" ] || detail="$marker_other"
    echo "an install harness (tools/test-install.sh) is already running on this Mac ($detail); it boots real boards on test ports and checks that they let go of them, so $what would collide with it and either run's red could be the other's. Wait for the harness to finish, or $override." >&2
    return 1
  fi
  return 0
}

# --- #4410: the other direction, an install harness asking about a SUITE ------
# Measured 2026-09-28 about 20:04 UTC on Mortals: Kano's tools/test-install.sh started behind a
# clear gate, a tools/run-tests.sh started 3 minutes later behind a clear gate too, and the
# harness's board-port checks went red in unrelated sections (uninstall port release, #2073 open,
# the connect arm). run-tests.sh now asks kosmos_refuse_if_harness_live before it starts; this is
# the mirror, which test-install.sh asks before it takes a port. Same shape as the guards above:
# only a bash/sh whose own command line IS tools/run-tests.sh counts (a mention does not), the
# caller's own subtree is dropped (defensive: test-install.sh never self-matches run-tests.sh), and a
# proven unit-test fixture is dropped: a node --test ancestor (tools.shell-shard-4317.test.js runs
# run-tests.sh under node --test), or the kt<digits> sandbox, which is what keeps
# tools/test-cut-guard.sh's own run-tests.sh stand-in (8 s, in every suite) from refusing other
# agents' harnesses. And a
# probe that cannot answer is a refusal. No run marker: nothing that asks this self-matches
# run-tests.sh, which is the race markers exist for (#1796). The seam is KOSMOS_SUITE_PROBE.
# Coverage, named: a zsh, a bare `bash run-tests.sh` from tools/, and a bare `node --test` are not
# matched; `yarn test` and `bash tools/run-tests.sh` (any bash or sh, by path too), the documented
# ways, are.
# The name arm on its own, so tools/test-cut-guard.sh can prove the real pgrep and filter see a
# stand-in suite even while other agents' real suites are live (a refusal alone could not tell whose
# suite it saw). Prints the matching `pid command` lines; exits 1 for none, 2+ when pgrep failed.
# Its interpreter pattern, ([^ ]*/)?(ba)?sh, is deliberately wider than the older guards' (/bin/)?(ba)?sh:
# a suite started by a Homebrew bash is still a suite (review 11). Only more candidates, never fewer.
_kosmos_suite_candidates() {
  local raw rc
  raw="$(pgrep -fl 'run-tests\.sh' 2>/dev/null)"; rc=$?
  [ "$rc" -ge 2 ] && return "$rc"
  printf '%s\n' "$raw" | grep -E '^[0-9]+ +([^ ]*/)?(ba)?sh +([^ ]*/)?tools/run-tests\.sh( |$)' || return 1
}

kosmos_refuse_if_suite_live() {
  local what="${1:-this run}" override="${2:-KOSMOS_HARNESS_IGNORE_SUITE=1 runs anyway}" probe="${KOSMOS_SUITE_PROBE:-}" raw out rc self
  self="${KOSMOS_SUITE_SELF_PID:-$$}"
  # The source differs (the seam or the real name arm); everything after it is shared, so the
  # probe arms in tools/test-cut-guard.sh exercise the same code a live read does, and the real
  # name arm is tested on its own through _kosmos_suite_candidates (#4410 review 8).
  if [ -n "$probe" ]; then
    out="$("$probe" 2>/dev/null)"; rc=$?
  else
    out="$(_kosmos_suite_candidates)"; rc=$?
  fi
  if [ "$rc" -le 1 ]; then rc=0; [ -n "$out" ] || rc=1; fi
  if [ -n "$out" ] && [ -n "$self" ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_self_subtree "$self" || true)"
  fi
  if [ -n "$out" ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_test_fixtures || true)"
  fi
  # #4498: a suite that is only WAITING for the box (kosmos_wait_until_clear with the suite queue)
  # runs no tests yet, so it is not a live suite. Without this, two waiting suites would each wait on
  # the other until both gave up.
  if [ -n "$out" ]; then
    out="$(printf '%s\n' "$out" | _kosmos_drop_suite_waiters || true)"
  fi
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether a test suite is running (the probe exited $rc); refusing to guess for $what. $override." >&2
    return 1
  fi
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"
    echo "a test suite (tools/run-tests.sh) is already running on this Mac ($detail); $what boots real boards on test ports and checks that they let go of them, and a suite beside it can make those checks red for reasons that are not the change. Wait for the suite to finish (bash tools/heavy-gate.sh --twice --quiet-box says when the box is quiet), or $override. On a busy Mac a suite is often running, so expect to wait rather than to override." >&2
    return 1
  fi
  return 0
}

# --- #4498: wait for a quiet box instead of refusing at once ------------------
# The guards above refuse at once. On a busy Mac a suite is usually running, so a refusal sent the
# agent round by hand, or to the override. kosmos_wait_until_clear asks a caller's check again every
# KOSMOS_WAIT_EVERY_S (30) seconds for up to KOSMOS_WAIT_MAX_S (1200, 20 minutes; in the suite queue 2700 s,
# counted as the #4574 note below says), then refuses with the check's own message. KOSMOS_NO_WAIT=1 asks once, as
# before. KOSMOS_WAIT_SLEEP and KOSMOS_WAIT_NOW are test seams.
#
# 🔑 THE SUITE QUEUE, because a waiting run-tests.sh is still a run-tests.sh process. Without it:
#   1. two suites waiting on a third would each see the other as live, and both give up at the bound;
#   2. two suites freed by the same finish would start together, the overlap this exists to stop.
# So a waiting suite writes suitewait.<pid> (line 1 "<epoch> <pid>", line 2 its command, line 3 its start time in
# the writer's local form and, since #4574, line 4 the same in UTC and the C locale; the same recycled-pid check as the
# run markers), the suite check skips a waiter (and its direct subshells),
# and only the OLDEST waiter may go. When it goes it drops its marker and asks once more: a harness
# that started in the moment it was still marked (it skipped this waiter) is seen by that second ask,
# and the suite goes back to waiting in its old place. A harness process exists before it asks, so
# one of the two always sees the other.
# KNOWN RESIDUAL: a harness jumps the queue (a waiting suite yields to any test-install, even one
# that arrived later), so a suite behind a long harness can reach its bound. That is the safe side.
#
# #4574: the queue's bound. A full suite takes 14 to 26 minutes, so a bound on the TOTAL wait gave up on every waiter
# second in line or later. In the queue the bound (default 2700 s) runs from the last time a waiter AHEAD of this run
# left (the count from _kosmos_suite_waiters_ahead fell): a queue that keeps moving is waited through, and the waiter at
# the front gives up when no waiter ahead has left for the whole bound. The bound covers EVERY blocker run-tests.sh
# waits on in the queue, a release claim and an install harness as well as a suite, so a queued suite now waits up to
# 45 minutes behind those too (20 before); all three are long runs, and a claim or a harness that outlives the bound
# still ends the wait. A harness or a suite's own subshells are not waiters, so they never restart it. A rise (a waiter
# re-marked by the second ask) only arms the next fall, so each restart needs a waiter ahead to leave or to read as gone
# for one pass: one briefly unmarked by its second ask, one whose marker a failed ps removed until it writes it again
# (the loop re-marks a run whose own marker vanished), or one an OLDER copy of this lib in another zone keeps deleting
# (review 19; see _kosmos_suite_waiter_live). So the restart is a heuristic, not proof the queue moved. A
# waiter is in its second ask only when its own check had just passed (the box was clear), so that false fall needs a
# harness to take the box in that moment; the failed-ps one needs a ps to fail. A fall and such a re-mark in the same
# poll net to zero and restart nothing, which errs toward giving up. A waiter BEHIND this run never counts,
# so churn behind it cannot restart its bound. A hard ceiling (KOSMOS_WAIT_QUEUE_CEIL_S; by default four bounds plus
# one per live waiter at entry) ends a FLAPPING wait whatever the heuristic says; a healthy deep queue normally stays
# inside it (an entry count a failed ps made too low shrinks it: the safe side, it gives up sooner).
# ⚠️ THE COST, which the ceiling does NOT cap: behind a HUNG suite each waiter ahead that gives up is a fall for the ones
# behind, so the waiter k deep gives up at about (k+1) bounds (45, 90, 135 minutes...), inside its (4+k)-bound ceiling.
# Before #4574 every waiter gave up at 20 minutes. Accepted: a hung suite is rare, and the jam this card measured was
# not one (the live-count side is #4609: see _kosmos_drop_suite_waiters).
# #4609: the overrides and wait controls a caller sets for run-tests.sh's own wait (not the test probes, which tests
# pass explicitly). run-tests.sh unsets them once its wait has read them, and test-cut-guard.sh starts without them, so
# no test inherits a caller's (one list, used by both).
KOSMOS_WAIT_CONTROL_VARS="KOSMOS_TESTS_IGNORE_SUITE KOSMOS_TESTS_IGNORE_HARNESS KOSMOS_IGNORE_MACHINE_CLAIM KOSMOS_NO_WAIT KOSMOS_WAIT_MAX_S KOSMOS_WAIT_EVERY_S KOSMOS_WAIT_QUEUE_CEIL_S KOSMOS_WAIT_NOW KOSMOS_WAIT_SLEEP KOSMOS_QUEUE_CLASS"
_kosmos_suite_waiter_file() { printf '%s/suitewait.%s' "$(_kosmos_marker_dir)" "$1"; }

# _kosmos_suite_waiter_live <pid>: 0 when <pid> holds a verified waiting marker (alive, same command, and a matching
# start time: line 4 against the UTC form or line 3 against the local form; see below).
# Unlinks a marker it can prove stale, as _kosmos_marker_other_live does.
_kosmos_suite_waiter_live() {
  local pid="$1" f stored live
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  f="$(_kosmos_suite_waiter_file "$pid")"
  [ -f "$f" ] || return 1
  if ! kill -0 "$pid" 2>/dev/null; then rm -f "$f" 2>/dev/null; return 1; fi
  # Command AND start time (review 1): every suite's command is the same `bash tools/run-tests.sh`, so a command
  # match alone would let a new suite that inherited a dead waiter's pid read as "only waiting" and be skipped, the
  # unsafe side. A start time cannot repeat on a recycled pid.
  stored="$(sed -n '2p' "$f" 2>/dev/null)"; live="$(ps -ww -o command= -p "$pid" 2>/dev/null)"
  # #4574: line 4 holds the start time in UTC and the C locale, so readers in different zones or locales agree. Line 3
  # keeps the writer's local form, which is all an older copy of this lib (another worktree, side by side) compares:
  # it matches only when that older reader runs in the writer's zone and locale. A reader elsewhere deletes the marker
  # (counting the waiter as a running suite, the safe side), and since this run re-marks a vanished marker each pass,
  # the two can alternate: a third source of false falls for the waiters behind, bounded by the ceiling (the #4574
  # note).
  local began utc want loc
  began="$(sed -n '3p' "$f" 2>/dev/null)"; utc="$(sed -n '4p' "$f" 2>/dev/null)"
  want="$(_kosmos_pid_started "$pid")"; loc="$(_kosmos_pid_started_local "$pid")"
  # Live only when the command matches AND a start time matches: line 4 against the UTC form, or line 3 against the
  # local form. An empty reading (ps could not say) matches nothing, so it is stale: the safe side. An empty UTC reading
  # is stale even when the local one matches (the -z "$want" term below), so a ps that half-answers never keeps a marker.
  local same_start=0
  if [ -n "$want" ] && [ "$utc" = "$want" ]; then same_start=1
  elif [ -n "$loc" ] && [ "$began" = "$loc" ]; then same_start=1
  fi
  if [ -z "$stored" ] || [ "$stored" != "$live" ] || [ -z "$want" ] || [ "$same_start" != 1 ]; then
    rm -f "$f" 2>/dev/null; return 1
  fi
  return 0
}
# A process's start time: _kosmos_pid_started in UTC and the C locale (line 4, the same for every reader),
# _kosmos_pid_started_local as ps prints it for the caller (line 3, what an older copy compares). Both come from ps
# (the same on macOS and Linux procps) and are empty when ps cannot say, which
# then matches nothing recorded, so the marker is treated as stale (counted as a live suite: the safe side).
_kosmos_pid_started() { TZ=UTC LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'; }
_kosmos_pid_started_local() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'; }

# Drops `pid command` lines that are a waiter or descend from one: a waiter's check forks $( ) subshells several
# levels deep, each showing `bash tools/run-tests.sh` (review 1). The walk is bounded, like
# _kosmos_pid_is_self_or_descendant's.
_kosmos_descends_from_suite_waiter() {
  local pid="$1" hops=0
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    _kosmos_suite_waiter_live "$pid" && return 0
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    hops=$((hops + 1)); [ "$hops" -gt 64 ] && break
  done
  return 1
}
# _kosmos_pid_gone <pid>: 0 only when the kernel says the pid does not exist (ESRCH). A pid we may not signal (EPERM),
# or a fork that failed so nothing was read, is NOT gone: it stays counted, the safe side.
_kosmos_pid_gone() {
  local err
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  err="$(LC_ALL=C kill -0 "$1" 2>&1)" && return 1
  case "$err" in *[Nn]'o such process'*) return 0 ;; esac
  return 1
}
_kosmos_drop_suite_waiters() {
  local line pid
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"
    _kosmos_descends_from_suite_waiter "$pid" && continue
    # #4609: a candidate that is gone runs no tests. A waiter's $( ) subshell lives for milliseconds, so it can be in
    # pgrep's snapshot and exit before the walk above reads its parent; the walk then ends on an empty ppid and, without
    # this, the dead subshell counted as a live suite. With a dozen waiters polling, one was in that window at almost
    # every poll, so the front waiter never started (measured 2026-09-29: 14 waiters, 0 suites, a new pid each note).
    _kosmos_pid_gone "$pid" && continue
    printf '%s\n' "$line"
  done
}

# kosmos_mark_suite_waiting [epoch]: this run is waiting. The epoch keeps a run's place in the queue
# when it goes back to waiting. Best-effort, like kosmos_mark_run: a marker it cannot write only
# means other waiters count this one as live, which refuses more, never less.
kosmos_mark_suite_waiting() {
  local ts="${1:-$(date +%s)}" dir
  dir="$(_kosmos_marker_dir)"; mkdir -p "$dir" 2>/dev/null || return 0
  # #4609 light lane: line 5 is this run's class (KOSMOS_QUEUE_CLASS=light, anything else is heavy). An older copy of
  # this lib reads lines 1 to 4 only, so it keeps plain oldest-first order.
  # #4911: line 6 is "side" when this run asks for side turns (KOSMOS_SIDE_CAPABLE=1, queued-heavy.sh sets it), so a
  # light waiter that never will (an older queued-heavy, KOSMOS_SIDE_LANE=0) does not hold the side lane for others.
  # "aware" when it is a queued-heavy.sh that knows about side turns (KOSMOS_SIDE_AWARE=1) but does not take them.
  local l6=""; if [ "${KOSMOS_SIDE_CAPABLE:-0}" = 1 ]; then l6=side; elif [ "${KOSMOS_SIDE_AWARE:-0}" = 1 ]; then l6=aware; fi
  printf '%s %s\n%s\n%s\n%s\n%s\n%s\n' "$ts" "$$" "$(ps -ww -o command= -p "$$" 2>/dev/null)" "$(_kosmos_pid_started_local "$$")" "$(_kosmos_pid_started "$$")" "$(_kosmos_queue_class)" "$l6" > "$(_kosmos_suite_waiter_file "$$").tmp.$$" 2>/dev/null \
    && mv -f "$(_kosmos_suite_waiter_file "$$").tmp.$$" "$(_kosmos_suite_waiter_file "$$")" 2>/dev/null
  return 0
}
kosmos_unmark_suite_waiting() { rm -f "$(_kosmos_suite_waiter_file "$$")" "$(_kosmos_suite_waiter_file "$$").tmp.$$" 2>/dev/null; return 0; }

# #4609 light lane: a run declared light (KOSMOS_QUEUE_CLASS=light: one browser check, one focused test file) goes ahead
# of heavy waiters (full suites, cargo runs, pushes), still ONE run at a time: the class changes the order, never how
# many hold the box. A heavy waiter that has waited KOSMOS_QUEUE_STARVE_S (default 2700 s, the queue's bound) goes ahead
# of the light ones, so a stream of light runs cannot hold a suite back for ever. Measured before this (2026-09-30
# 10:07): 22 waiters, 19 of them one-offs that hold the box 7 to 200 s, queued behind suites that hold it 15 to 20 min.
_kosmos_queue_class() { case "${KOSMOS_QUEUE_CLASS:-}" in light) echo light ;; *) echo heavy ;; esac; }
# _kosmos_queue_rank <queue time> <class> <now>: 0 any waiter past the starve line, 1 a light one, 2 any other heavy.
# #4911: a LIGHT waiter past the starve line is rank 0 too (it ages like a heavy one). Before this a light waiter could
# never reach rank 0, so once every heavy waiter was past 45 min (most of the day on 2026-10-01) the light lane stood
# still: Baron's one test file waited 185 min behind full suites. Among rank 0 the order is queue time, as before.
_kosmos_queue_rank() {
  local starve="${KOSMOS_QUEUE_STARVE_S:-2700}"
  case "$starve" in ''|*[!0-9]*) starve=2700 ;; esac
  if [ $(( $3 - $1 )) -ge "$starve" ]; then echo 0
  elif [ "$2" = light ]; then echo 1
  else echo 2; fi
}

# The #4609 rank, for a waiter whose marker an older lib wrote (5 lines): a light waiter never ages there. Compared
# against such a waiter, BOTH ranks use it, so this run and that one read the same order: with two rules, a starving
# light waiter of an older lib and a starving heavy one of this lib each named the other as ahead and both waited
# (review 3, reproduced).
_kosmos_queue_rank_legacy() {
  local starve="${KOSMOS_QUEUE_STARVE_S:-2700}"
  case "$starve" in ''|*[!0-9]*) starve=2700 ;; esac
  if [ "$2" = light ]; then echo 1
  elif [ $(( $3 - $1 )) -ge "$starve" ]; then echo 0
  else echo 2; fi
}

# _kosmos_suite_waiters_ahead: the pids of the live waiters ahead of this run in the suite queue, one per line (all of
# them before this run holds a marker). The refusal below and the #4574 bound both read this, so they agree on "ahead".
# Ahead means first by rank (_kosmos_queue_rank), then by queue time, then by pid.
_kosmos_suite_waiters_ahead() {
  local dir f pid mine_ts mine_pid ts cls rank mine_rank mine_cls now legacy=0 seen="" lines
  dir="$(_kosmos_marker_dir)"; [ -d "$dir" ] || return 0
  # A caller that already read this run's queue time passes it (the bound, review 23), so there is no gap between a
  # check that the marker exists and this read; otherwise it is read here.
  if [ $# -ge 2 ]; then mine_ts="$1"; mine_pid="$2"
  else read -r mine_ts mine_pid 2>/dev/null < "$(_kosmos_suite_waiter_file "$$")" || { mine_ts=""; mine_pid=""; }
  fi
  # Queue times are the real clock (see kosmos_wait_until_clear), so the starve line is measured against it too.
  now="$(date +%s)"
  if [ -n "$mine_ts" ]; then
    case "$mine_ts" in *[!0-9]*) mine_ts="" ;; esac   # review: a corrupt own queue time is no queue time (behind every waiter)
  fi
  if [ -n "$mine_ts" ]; then
    cls="$(sed -n '5p' "$(_kosmos_suite_waiter_file "$$")" 2>/dev/null)" || cls=""; [ -n "$cls" ] || cls="$(_kosmos_queue_class)"
    mine_cls="$cls"
  fi
  # Pass 1: the live waiters, with their class and whether an OLDER lib wrote the marker (fewer than 6 lines).
  for f in "$dir"/suitewait.*; do
    [ -e "$f" ] || continue
    case "${f##*/}" in *.tmp.*) continue ;; esac   # a marker half-written (before its mv) is not a waiter; the NAME only, so a marker dir whose path holds ".tmp." still counts
    pid="${f##*.}"
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$pid" = "$$" ] && continue
    _kosmos_suite_waiter_live "$pid" || continue
    read -r ts _ 2>/dev/null < "$f" || continue
    case "$ts" in ''|*[!0-9]*) continue ;; esac
    cls="$(sed -n '5p' "$f" 2>/dev/null)" || cls=""   # an older lib's marker has no line 5 (or it just left): heavy
    case "$cls" in ''|*[!a-z]*) cls=heavy ;; esac
    # Review 12: a marker of 4 lines or fewer is a lib from before #4609, which orders strictly oldest-first; one of 5
    # lines is #4609's (light ahead, starving heavy first). The oldest generation live decides the rule for everyone.
    lines="$(sed -n '$=' "$f" 2>/dev/null)"   # review 15: read once (a marker can go between two reads)
    case "$lines" in
      ''|*[!0-9]*) continue ;;   # review 14: gone between its read and this count (it is leaving to start): not a waiter
      *) if [ "$lines" -le 4 ]; then legacy=2
         elif [ "$lines" -lt 6 ] && [ "$legacy" != 2 ]; then legacy=1; fi ;;
    esac
    seen="$seen$pid $ts $cls
"
  done
  # #4911 review 4: while ANY waiter of an older lib (which never ages a light run) is live, EVERY comparison in this
  # pass uses that older rule, so every reader, old lib or new, reads one order. Switching rule per pair was not
  # enough: a new light, a new heavy and an old heavy, all starving, could each name another as ahead in a circle and
  # wait on an idle box until the bound (reproduced). One rule for all is one total order: rank, queue time, pid.
  # legacy 2 (a pre-#4609 waiter is live): no single rule agrees with both older readers (review 13: oldest-first,
  # tried in round 12, made a #4609 reader and this one name each other). So another waiter is ahead of this one only
  # when it is ahead by BOTH older rules (oldest-first, and #4609's rank). Two waiters can then never each name the
  # other: an older reader that names this one has, by its own rule, this one ahead, which this reader's "both" test
  # then cannot contradict. The cost is the other direction, two waiters each reading themselves first, which the
  # claim and the live-suite checks already serialise.
  if [ -n "$mine_ts" ]; then
    if [ "$legacy" = 1 ] || [ "$legacy" = 2 ]; then mine_rank="$(_kosmos_queue_rank_legacy "$mine_ts" "$mine_cls" "$now")"
    else mine_rank="$(_kosmos_queue_rank "$mine_ts" "$mine_cls" "$now")"; fi
  fi
  printf '%s' "$seen" | while read -r pid ts cls; do
    [ -n "$pid" ] || continue
    if [ -z "$mine_ts" ]; then echo "$pid"; continue; fi
    if [ "$legacy" = 1 ] || [ "$legacy" = 2 ]; then rank="$(_kosmos_queue_rank_legacy "$ts" "$cls" "$now")"
    else rank="$(_kosmos_queue_rank "$ts" "$cls" "$now")"; fi
    older=0; { [ "$ts" -lt "$mine_ts" ] || { [ "$ts" -eq "$mine_ts" ] && [ "$pid" -lt "$mine_pid" ]; }; } && older=1
    ahead_by_rank=0; { [ "$rank" -lt "$mine_rank" ] || { [ "$rank" -eq "$mine_rank" ] && [ "$older" = 1 ]; }; } && ahead_by_rank=1
    if [ "$legacy" = 2 ]; then [ "$ahead_by_rank" = 1 ] && [ "$older" = 1 ] && echo "$pid"
    elif [ "$ahead_by_rank" = 1 ]; then echo "$pid"; fi
  done
  return 0
}

# kosmos_refuse_if_earlier_suite_waiter <what>: refuses while another waiter is ahead of this run
# (_kosmos_suite_waiters_ahead: rank, then earlier epoch, then lower pid). A caller with no marker of its own is behind every waiter. Since #4574 it walks every
# marker (the shared helper) rather than stopping at the first: a few ps calls a marker, once or twice a 30 s poll.
kosmos_refuse_if_earlier_suite_waiter() {
  local what="${1:-this run}" pid
  # A read loop, not `head -1`: closing the pipe early could print "Broken pipe" into this refusal's own message.
  pid="$(_kosmos_suite_waiters_ahead | { read -r p || true; printf '%s' "$p"; cat >/dev/null; })" || true
  [ -n "$pid" ] || return 0
  echo "another queued run (pid $pid) is ahead of $what in the queue (it has waited longer, or it is a light run, #4609); it goes first." >&2
  return 1
}

# The wait's clock. KOSMOS_WAIT_NOW (a command printing epoch seconds) is a test seam, like KOSMOS_WAIT_SLEEP. The
# fallback is per call, so a seam must answer for the whole wait (one that stops mid-wait mixes two clocks: tests only).
# A seam that prints anything but a number falls back to the real clock.
_kosmos_wait_now() {
  local t=""; [ -n "${KOSMOS_WAIT_NOW:-}" ] && { t="$("$KOSMOS_WAIT_NOW" 2>/dev/null)" || t=""; }
  case "$t" in ''|*[!0-9]*) date +%s ;; *) printf '%s\n' "$t" ;; esac
}

# kosmos_wait_until_clear <what> [--suite-queue] <check> [args...]: run <check> (a function or
# command that returns 0 for "go" and prints its refusal on stderr) until it passes or the bound runs
# out. --suite-queue joins the suite queue above (run-tests.sh). Returns 0 to go, 1 to refuse.
# #4911: --side <check> (after --suite-queue) offers a queued run a SIDE turn: on every pass once it is queued, if
# <check> <what> passes, it returns 0 at once, whatever is ahead of it. KOSMOS_WAIT_LANE says which turn it got (side,
# or main for an ordinary one), so the caller takes the matching claim. On a side turn the queue marker is LEFT in
# place: the caller asks the check again under its take lock (the check reads this run's queue place) and unmarks
# after the take, so a take that loses keeps its place. Only queued-heavy.sh passes it, for a light run
# (kosmos_light_side_clear); run-tests.sh does not.
kosmos_wait_until_clear() {
  local what="$1"; shift
  local queue=0; [ "${1:-}" = --suite-queue ] && { queue=1; shift; }
  local side=""
  if [ "$queue" = 1 ] && [ "${1:-}" = --side ]; then
    [ $# -ge 3 ] || { echo "kosmos_wait_until_clear: --side needs a side check and then the check" >&2; return 1; }
    side="$2"; shift 2
  fi
  KOSMOS_WAIT_LANE=main
  # #4574: in the suite queue the bound is 2700 s and counts from the last time a waiter ahead left (the queue note).
  local dflt=1200; [ "$queue" = 1 ] && dflt=2700
  local every="${KOSMOS_WAIT_EVERY_S:-30}" max="${KOSMOS_WAIT_MAX_S:-$dflt}" sleeper="${KOSMOS_WAIT_SLEEP:-sleep}"
  local ceil="${KOSMOS_WAIT_QUEUE_CEIL_S:-}" over=0
  local waited=0 said=0 err ts="" start next_note=300 ahead prev="" wblk=0 bstart side_err=""
  start="$(_kosmos_wait_now)"; bstart="$start"
  # A marker under this run's pid left by a dead run (a recycled pid) would make this run read as already queued, with
  # that run's old place: the liveness check removes it (its start time is not this run's).
  [ "$queue" = 1 ] && { _kosmos_suite_waiter_live "$$" || true; }
  # #4911: a marker of this run's that is still live (the check above keeps only one whose start time is this run's) is
  # this run's place, left by a side turn's take that lost (see --side below): resume it rather than join at the back.
  if [ "$queue" = 1 ] && [ -e "$(_kosmos_suite_waiter_file "$$")" ]; then
    read -r ts _ 2>/dev/null < "$(_kosmos_suite_waiter_file "$$")" || ts=""
    case "$ts" in *[!0-9]*) ts="" ;; esac
  fi
  case "$every" in ''|*[!0-9]*|0) every=30 ;; esac
  case "$max" in ''|*[!0-9]*) max="$dflt" ;; esac
  # #4574: a hard ceiling on a queued wait, so ending it never rests on the restart heuristic. By default it is four
  # bounds PLUS one per live waiter at entry (the first pass, before this run is marked, counts them all): a waiter k deep waits about k suites, well
  # inside it, so it ends a hung or flapping wait and normally leaves a healthy deep queue alone (a first count a failed
  # ps made too low shrinks it, the safe side). KOSMOS_WAIT_QUEUE_CEIL_S sets it
  # outright (0 gives up on the first pass, as KOSMOS_WAIT_MAX_S=0 does).
  local ceil_auto=0
  case "$ceil" in ''|*[!0-9]*) ceil=$((max * 4)); ceil_auto=1 ;; esac
  while :; do
    # #4574: a queued run whose own marker vanished (a failed ps reads it as stale and removes it) writes it again with its
    # old queue time. Unmarked, it would count every waiter as ahead and the others would count it as a running suite.
    if [ "$queue" = 1 ] && [ -n "$ts" ] && [ ! -e "$(_kosmos_suite_waiter_file "$$")" ]; then kosmos_mark_suite_waiting "$ts"; fi
    # #4911: the side turn. Asked only once this run holds a queue place (its place orders it among light waiters).
    if [ -n "$side" ] && [ -n "$ts" ] && side_err="$("$side" "$what" 2>&1)"; then
      KOSMOS_WAIT_LANE=side
      echo "a side turn is free beside a heavy run after waiting ${waited}s; $what starts now (#4911)." >&2
      return 0
    fi
    if err="$("$@" 2>&1)" && { [ "$queue" = 0 ] || kosmos_refuse_if_earlier_suite_waiter "$what" 2>/dev/null; }; then
      if [ "$queue" = 1 ] && [ -n "$ts" ]; then
        kosmos_unmark_suite_waiting
        # The second ask (see the queue note above): anything that started while this run was still
        # marked has been seen by now, or it saw this run unmarked and is waiting on it.
        if ! err="$("$@" 2>&1)"; then kosmos_mark_suite_waiting "$ts"; else ts=""; fi
      fi
      if [ -z "$ts" ]; then
        [ "$waited" -gt 0 ] && echo "the box is clear after waiting ${waited}s; $what starts now." >&2
        return 0
      fi
    fi
    if [ -z "$err" ]; then
      if [ "$queue" = 1 ]; then err="$(kosmos_refuse_if_earlier_suite_waiter "$what" 2>&1)"
      else err="the box is busy (the check refused without saying why)."; fi
    fi
    # #4574: in the queue, one fewer waiter ahead is the queue moving, so the bound starts again.
    if [ "$queue" = 1 ]; then
      # Before this run holds a marker (the first pass) every live waiter counts as ahead, so a waiter that marked in the
      # same second behind this one can read as a fall on the second pass: one early restart, harmless.
      # Once queued, a pass on which this run's own marker is missing (another reader's failed ps removed it during the
      # check) takes no count: without its queue time every waiter, those behind included, would count as ahead, and
      # the next pass would read the drop back as a fall.
      # Its own queue time is read ONCE, here, and handed to the helper: empty means the marker is gone this pass.
      local own_ts="" own_pid=""
      [ -n "$ts" ] && { read -r own_ts own_pid 2>/dev/null < "$(_kosmos_suite_waiter_file "$$")" || own_ts=""; }
      if [ -z "$ts" ] || [ -n "$own_ts" ]; then
        if [ -n "$ts" ]; then ahead="$(_kosmos_suite_waiters_ahead "$own_ts" "$own_pid" | grep -c .)" || true
        else ahead="$(_kosmos_suite_waiters_ahead | grep -c .)" || true; fi
        ahead="${ahead:-0}"
        [ -z "$prev" ] && [ "$ceil_auto" = 1 ] && ceil=$((max * (4 + ahead)))
        if [ -n "$prev" ] && [ "$ahead" -lt "$prev" ]; then wblk=0; bstart="$(_kosmos_wait_now)"; fi
        prev="$ahead"
      fi
    else
      wblk="$waited"
    fi
    # The bound is reached by the time slept or the wall clock, whichever gets there first, so slow checks cannot
    # stretch it (review 1).
    over=0
    if [ "$queue" = 1 ] && { [ "$waited" -ge "$ceil" ] || [ $(( $(_kosmos_wait_now) - start )) -ge "$ceil" ]; }; then over=1; fi
    if [ "${KOSMOS_NO_WAIT:-0}" = 1 ] || [ "$over" = 1 ] || [ "$wblk" -ge "$max" ] || [ $(( $(_kosmos_wait_now) - bstart )) -ge "$max" ]; then
      [ "$queue" = 1 ] && kosmos_unmark_suite_waiting
      printf '%s\n' "$err" >&2
      if [ "$waited" -gt 0 ] && [ "$over" = 1 ]; then
        if [ "$ceil_auto" = 1 ]; then
          echo "gave up after waiting ${waited}s: the queue's ceiling (${ceil}s, four bounds plus one per waiter ahead when it joined; KOSMOS_WAIT_QUEUE_CEIL_S sets it) ends any queued wait; run it again later." >&2
        else
          echo "gave up after waiting ${waited}s: the queue's ceiling (KOSMOS_WAIT_QUEUE_CEIL_S=$ceil) ends any queued wait; run it again later." >&2
        fi
      elif [ "$waited" -gt 0 ] && [ "$queue" = 1 ]; then
        local since=$(( $(_kosmos_wait_now) - bstart )); [ "$wblk" -gt "$since" ] && since="$wblk"
        echo "gave up after waiting ${waited}s in all, ${since}s since this run joined the queue or a waiter ahead last left it (the bound, KOSMOS_WAIT_MAX_S=$max); run it again later." >&2
      elif [ "$waited" -gt 0 ]; then
        echo "gave up after waiting ${waited}s (the bound is KOSMOS_WAIT_MAX_S=$max); run it again later." >&2
      fi
      return 1
    fi
    # ts is a queue position, compared with other runs' positions, so it takes the real clock, not the wait's seam.
    if [ "$queue" = 1 ] && [ -z "$ts" ]; then ts="$(date +%s)"; kosmos_mark_suite_waiting "$ts"; fi
    if [ "$said" = 0 ]; then
      printf '%s\n' "$err" >&2
      if [ "$queue" = 1 ]; then
        local how="KOSMOS_WAIT_QUEUE_CEIL_S"; [ "$ceil_auto" = 1 ] && how="four bounds plus one per waiter ahead when it joined"
        echo "waiting for it: asking again every ${every}s; the bound (${max}s) counts from when this run joined the queue or a waiter ahead last left it, and ${ceil}s (${how}) ends any queued wait (KOSMOS_NO_WAIT=1 refuses at once instead)." >&2
      else
        echo "waiting for it: asking again every ${every}s for up to ${max}s (KOSMOS_NO_WAIT=1 refuses at once instead)." >&2
      fi
      said=1
    elif [ "$waited" -ge "$next_note" ]; then
      # #4911: say the queue position too. The reason above is the FIRST check that refused, so while any run holds the
      # box it is always the claim, and a waiter fifth in line read as if it were at the front (Angel, #4921, 20:38).
      if [ "$queue" = 1 ] && [ -n "$prev" ]; then
        echo "still waiting (${waited}s so far; ${prev} queued ahead of this run): $(printf '%s' "$err" | head -1 | cut -c1-160)" >&2
      else
        echo "still waiting (${waited}s so far): $(printf '%s' "$err" | head -1 | cut -c1-160)" >&2
      fi
      [ -n "$side" ] && [ -n "$side_err" ] && echo "  no side turn either: $(printf '%s' "$side_err" | head -1 | cut -c1-160)" >&2
      next_note=$((next_note + 300))
    fi
    "$sleeper" "$every"
    waited=$((waited + every)); wblk=$((wblk + every))
  done
}

# --- Machine reservation claim (#1962) ---------------------------------------
# The guards above make a second CUT / BROWSER / HARNESS *run* refuse. They do
# NOT make an agent's ordinary `yarn test` (tools/run-tests.sh) refuse while a
# cut holds the box -- and that ordinary run is exactly the tenant the 0.6.23
# cut kept discovering after asking agents to stop one at a time. A cut needs a
# QUIET box (measured: the same file failed 8 reds under concurrent gates and
# passed 22/22 alone), and nothing made it quiet.
#
# So a release CLAIMS the machine for a bounded window; any gate script consults
# the claim and refuses -- naming the holder AND until when -- unless it is the
# holder's own run (by cookie) or the operator overrides.
#
# Shape: ONE well-known file $DIR/machine-claim (not pid-suffixed: a second cut
# is already refused by kosmos_refuse_if_cut_live, so at most one legit claim
# exists). Body is one line: "<cookie> <pid> <expires_epoch> <host> <label>".
# Machine-wide ($HOME/.cache via _kosmos_marker_dir), exactly like the run
# markers above. Written atomically (temp + mv) so a consult never reads a
# half-written line.
#
# THREE things free the box, every one in the SAFE direction (a claim that
# should be gone but is not costs a foreign gate a too-long refusal, never a
# corrupted release):
#   1. The holder RELEASES it on exit (kosmos_release_machine, from release.sh's
#      EXIT trap) -- the normal path.
#   2. The holder's PID is DEAD -- a crashed cut cannot hold the box; any
#      consult self-cleans a dead-holder claim.
#   3. The claim EXPIRES -- a hung-but-alive cut frees the fleet after the
#      window. release.sh RENEWS at each step, so a healthy long cut never
#      lapses mid-flight; a stuck step lets the window pass.
#
# FAIL-OPEN is load-bearing: a gate must NEVER refuse because the claim FILE is
# missing, empty, malformed, or half-written -- that would wedge the very fleet
# this exists to keep working. Only a well-formed, live-holder, unexpired,
# FOREIGN claim refuses. A malformed line is treated as no claim and left in
# place (a concurrent writer will overwrite it); a well-formed but dead/expired
# claim is self-cleaned, the same posture as the run markers' dead-pid unlink.
_kosmos_machine_claim_file() { printf '%s' "$(_kosmos_marker_dir)/machine-claim"; }
_kosmos_now_epoch() { date +%s 2>/dev/null || echo 0; }

# Format an epoch as a local wall-clock HH:MM (with zone), for the "until when"
# in a refusal. BSD date (this Mac) takes `-r <epoch>`; GNU date takes
# `-d @<epoch>`. Try BSD first, then GNU; on failure echo the raw epoch so the
# message still carries something checkable rather than nothing.
_kosmos_epoch_hhmm() {
  local e="${1:-}"
  case "$e" in ''|*[!0-9]*) printf '%s' "?"; return 0 ;; esac
  date -r "$e" '+%H:%M %Z' 2>/dev/null && return 0
  date -d "@$e" '+%H:%M %Z' 2>/dev/null && return 0
  printf 'epoch %s' "$e"
}

# _kosmos_machine_claim_active  -- echo "<cookie> <pid> <expires> <host> <label>"
# of the ACTIVE claim, or nothing. Self-cleans a claim whose holder pid is dead
# or whose expiry has passed. A malformed/partial line -> nothing, file left in
# place (fail-open; a writer mid-mv will publish a complete line). Read-only with
# respect to a live foreign claim.
_kosmos_machine_claim_active() {
  local f line cookie pid exp host label now
  f="$(_kosmos_machine_claim_file)"
  [ -f "$f" ] || return 0
  line="$(cat "$f" 2>/dev/null)" || return 0
  [ -n "$line" ] || return 0
  # FAIL-OPEN field-count guard (#1962): a real claim is exactly the 5-field shape
  # kosmos_claim_machine writes ("<cookie> <pid> <exp> <host> <label>", label never
  # empty, host never empty), so anything with fewer than 5 fields is a partial or
  # corrupt file and must be treated as NO claim -- never a refusal. Without this a
  # 3-field line whose 2nd field happened to be a live pid would REFUSE a gate,
  # which is the one direction this whole design forbids. mv is atomic, so our own
  # writer never produces a short line; this defends only against outside corruption.
  [ "$(printf '%s' "$line" | awk '{print NF}')" -ge 5 ] 2>/dev/null || return 0
  # Parse the five fields. Extra trailing words fold into label (spaces allowed
  # in a label).
  cookie="$(printf '%s' "$line" | awk '{print $1}')"
  pid="$(printf '%s'    "$line" | awk '{print $2}')"
  exp="$(printf '%s'    "$line" | awk '{print $3}')"
  host="$(printf '%s'   "$line" | awk '{print $4}')"
  label="$(printf '%s'  "$line" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
  # Malformed: any required field missing or non-numeric pid/expiry -> fail-open.
  [ -n "$cookie" ] || return 0
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  case "$exp" in ''|*[!0-9]*) return 0 ;; esac
  now="$(_kosmos_now_epoch)"
  # Expired, or the holder crashed: this claim no longer holds the box. Clean it
  # (same as the run markers' dead-pid unlink) so it stops being consulted.
  if [ "$exp" -le "$now" ] 2>/dev/null || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$f" 2>/dev/null
    return 0
  fi
  printf '%s %s %s %s %s\n' "$cookie" "$pid" "$exp" "$host" "$label"
  return 0
}

# kosmos_claim_machine [minutes]  -- create or refresh THIS run's claim on the
# box. Default 30 minutes (tunable via KOSMOS_MACHINE_CLAIM_MINUTES; no single
# release step approaches that, and the whole build is ~17 min). Reuses and
# exports KOSMOS_MACHINE_CLAIM_COOKIE so the holder identity is stable across
# renewals and inherited by child gate runs, which is what lets a release's own
# `yarn test` self-exclude. Best-effort: a claim it cannot write just leaves the
# box unreserved (the old, pre-#1962 behaviour), never an error.
kosmos_claim_machine() {
  local minutes="${1:-${KOSMOS_MACHINE_CLAIM_MINUTES:-30}}" dir f tmp cookie now exp host
  case "$minutes" in ''|*[!0-9]*) minutes=30 ;; esac
  dir="$(_kosmos_marker_dir)"
  mkdir -p "$dir" 2>/dev/null || return 0
  f="$(_kosmos_machine_claim_file)"
  cookie="${KOSMOS_MACHINE_CLAIM_COOKIE:-}"
  if [ -z "$cookie" ]; then
    cookie="$$-$(date +%s 2>/dev/null || echo 0)-${RANDOM:-0}${RANDOM:-0}"
    export KOSMOS_MACHINE_CLAIM_COOKIE="$cookie"
  fi
  now="$(_kosmos_now_epoch)"
  exp=$((now + minutes * 60))
  host="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"
  # Atomic publish: write the complete line to a temp in the same dir, then mv
  # over the target, so a concurrent consult reads either the old line or the
  # new one, never a partial one.
  tmp="$dir/.machine-claim.$$.tmp"
  # #4911: KOSMOS_CLAIM_LABEL names a claim that is NOT a release (queued-heavy.sh's ordinary turns: "queued run (not a
  # cut): <what>"). Before, every queued turn was labelled "release (not a cut) queued one-off", which read as a release
  # reservation jumping the queue (Splinter's 20:38 rule, withdrawn at 20:40). A cut's own claim is unchanged.
  local label="${KOSMOS_CLAIM_LABEL:-release ${V:-cut}}" cur
  # #4911 (review 11): KOSMOS_CLAIM_KEEP_LABEL=1 (a renewal) keeps the label the live claim already carries under THIS
  # cookie. A cut run through a queued turn relabels the claim "release <version>" under the turn's cookie; the turn's
  # renewer used to write its own label back every 10 minutes.
  if [ "${KOSMOS_CLAIM_KEEP_LABEL:-0}" = 1 ]; then
    cur="$(_kosmos_machine_claim_active)"
    if [ -n "$cur" ] && [ "$(printf '%s' "$cur" | awk '{print $1}')" = "$cookie" ]; then
      label="$(printf '%s' "$cur" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
    fi
  fi
  label="$(printf '%s' "$label" | tr '\n\r' '  ')"   # review 11: one line, always (a label with a newline split the file)
  printf '%s %s %s %s %s\n' "$cookie" "$$" "$exp" "$host" "$label" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  mv -f "$tmp" "$f" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  return 0
}

# kosmos_release_machine  -- drop OUR claim (cookie match) so the box is freed
# the instant the cut ends, rather than at expiry. NEVER removes a foreign
# claim: if the active claim's cookie is not ours, leave it (a second holder --
# which should not exist, but must not be clobbered if it does). Safe to call
# with no claim held.
kosmos_release_machine() {
  local f line cookie self
  self="${KOSMOS_MACHINE_CLAIM_COOKIE:-}"
  [ -n "$self" ] || return 0                     # we never claimed -> nothing ours to free
  f="$(_kosmos_machine_claim_file)"
  [ -f "$f" ] || return 0
  line="$(cat "$f" 2>/dev/null)" || return 0
  cookie="$(printf '%s' "$line" | awk '{print $1}')"
  [ "$cookie" = "$self" ] && rm -f "$f" 2>/dev/null
  return 0
}

# kosmos_refuse_if_machine_claimed <what>  -- the gate consult. Return 0 (run) if
# no active claim, if the active claim is OURS (by cookie), or if the operator
# set KOSMOS_IGNORE_MACHINE_CLAIM=1. Return 1 (refuse) only for a well-formed,
# live-holder, unexpired, FOREIGN claim, printing who holds it and until when.
kosmos_refuse_if_machine_claimed() {
  local what="${1:-this run}" active cookie pid exp host label self
  [ -n "${KOSMOS_IGNORE_MACHINE_CLAIM:-}" ] && return 0
  active="$(_kosmos_machine_claim_active)"
  [ -n "$active" ] || return 0                   # no active claim -> run
  cookie="$(printf '%s' "$active" | awk '{print $1}')"
  self="${KOSMOS_MACHINE_CLAIM_COOKIE:-}"
  { [ -n "$self" ] && [ "$cookie" = "$self" ]; } && return 0   # our own run -> run
  pid="$(printf '%s'   "$active" | awk '{print $2}')"
  exp="$(printf '%s'   "$active" | awk '{print $3}')"
  host="$(printf '%s'  "$active" | awk '{print $4}')"
  label="$(printf '%s' "$active" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
  local held="reserved for a release (${label:-a cut}"
  case "$label" in "queued run"*) held="held by an ordinary queued turn (${label}" ;; esac
  echo "the machine is ${held}, pid $pid on ${host:-this Mac}) until $(_kosmos_epoch_hhmm "$exp"); $what would share the box and could corrupt both results (a gate that passes alone fails under a concurrent one). Wait for it to finish (kosmos_machine_claim_status, or tools/who-has-the-box.sh, says when), or KOSMOS_IGNORE_MACHINE_CLAIM=1 to run anyway." >&2
  return 1
}

# #4410: true only when THIS run holds the live machine claim (a cut, or a gate run the cut
# started, which inherits KOSMOS_MACHINE_CLAIM_COOKIE). The suite and harness checks stand down for
# a cut's own runs, which never overlap (step 3's suite ends before step 4b's install gate);
# everything else, including `yarn test:install-gate` outside a cut, still asks.
# ⚠️ WHAT STANDING DOWN LEANS ON, and the one gap it leaves. A harness that starts DURING the cut is
# not caught by this stand-down's callers; it is refused by its own start-time
# kosmos_refuse_if_cut_live, which sees the cut's `cut` marker (kosmos_mark_run in release.sh) for
# the cut's whole life (test-install.sh skips that check only for the claim holder itself, not for
# KOSMOS_INSTALL_GATE=1 alone). A new suite during the cut is refused by
# kosmos_refuse_if_machine_claimed. Change either of those and this stand-down becomes a real gap.
# THE GAP, named: a suite ALREADY running when the cut starts. release.sh asks whether a cut or a
# harness is live at its start, not whether a suite is, and the claim only refuses later suites;
# so a suite that outlives steps 1 to 4 can overlap the cut's step-4b gate. That was already true
# before #4410 (nothing asked about suites), and a cut refusing on any agent's suite is a release
# policy change this card does not make; cuts wait for a quiet box by practice (heavy-gate
# --quiet-box counts suites).
kosmos_holds_machine_claim() {
  local active cookie self="${KOSMOS_MACHINE_CLAIM_COOKIE:-}"
  [ -n "$self" ] || return 1
  active="$(_kosmos_machine_claim_active)"
  [ -n "$active" ] || return 1
  cookie="$(printf '%s' "$active" | awk '{print $1}')"
  [ "$cookie" = "$self" ]
}

# kosmos_machine_claim_status  -- the "who has the box?" answer to stdout: the holder + until for an active
# claim, else the all-clear, then (#4911) one more line while a light run's side turn is live.
kosmos_machine_claim_status() {
  local active pid exp host label side
  active="$(_kosmos_machine_claim_active)"
  # #4911 (review 10): a light run's side turn is a tenant too. Said on its own line, so the status is never the bare
  # free line while one runs (heavy-gate compares the whole answer with that line, and who-has-the-box prints it).
  side=""
  if command -v _kosmos_light_side_active >/dev/null 2>&1; then
    side="$(_kosmos_light_side_active)"
    [ -n "$side" ] && side="a light run has a side turn on the box ($(printf '%s' "$side" | awk '{$1=$2=$3=""; sub(/^ +/,""); print}'), pid $(printf '%s' "$side" | awk '{print $2}')) until $(_kosmos_epoch_hhmm "$(printf '%s' "$side" | awk '{print $3}')")."
  fi
  if [ -z "$active" ]; then
    echo "no release holds the machine right now."
    [ -n "$side" ] && echo "$side"
    return 0
  fi
  pid="$(printf '%s'   "$active" | awk '{print $2}')"
  exp="$(printf '%s'   "$active" | awk '{print $3}')"
  host="$(printf '%s'  "$active" | awk '{print $4}')"
  label="$(printf '%s' "$active" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
  case "$label" in
    "queued run"*) echo "the machine is held by an ordinary queued turn (${label}, pid $pid on ${host:-this Mac}) until $(_kosmos_epoch_hhmm "$exp")." ;;
    *) echo "the machine is reserved for a release (${label:-a cut}, pid $pid on ${host:-this Mac}) until $(_kosmos_epoch_hhmm "$exp")." ;;
  esac
  [ -n "$side" ] && echo "$side"
  return 0
}

# --- #4911: a light SIDE turn beside a heavy run ------------------------------
# Measured 2026-10-01 (card #4911): every queued turn claimed the whole box, the median wait was 75 min, and the box was
# 76 to 85% idle while a held full suite ran (load about 3 on 10 cores). So ONE light run (a browser check, a focused
# test file) may run BESIDE a heavy holder when the box has room. Never beside another light run, never beside a cut,
# an install harness or another browser run, and never when the load is half the cores or more.
# The side turn has its own claim, ONE file, "<cookie> <pid> <expires> <label>", written atomically, cleaned when its
# holder is dead or it expired (the machine claim's posture). Who asks about it:
#   - queued-heavy.sh: a light MAIN turn refuses while it is live (never two light runs);
#   - browser-checks.sh: WAITS for it rather than refusing (a heavy holder's page layer must not read red because a
#     light check is running beside it);
#   - test-install.sh and release.sh: wait for it.
# A suite (run-tests.sh) does NOT ask: a suite beside one light run is the pairing this exists to allow.
# KOSMOS_SIDE_LANE=0 turns the side turn off (kosmos_light_side_clear always refuses).
_kosmos_light_side_file() { printf '%s' "$(_kosmos_marker_dir)/light-side-claim"; }

# _kosmos_light_side_active: echo the live side claim's line, or nothing. Self-cleans a dead or expired one. A malformed
# line is no claim (fail-open, as the machine claim).
_kosmos_light_side_active() {
  local f line cookie pid exp now
  f="$(_kosmos_light_side_file)"
  [ -f "$f" ] || return 0
  line="$(cat "$f" 2>/dev/null)" || return 0
  cookie="$(printf '%s' "$line" | awk '{print $1}')"
  pid="$(printf '%s' "$line" | awk '{print $2}')"
  exp="$(printf '%s' "$line" | awk '{print $3}')"
  [ -n "$cookie" ] || return 0
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  case "$exp" in ''|*[!0-9]*) return 0 ;; esac
  now="$(_kosmos_now_epoch)"
  if [ "$exp" -le "$now" ] 2>/dev/null || ! kill -0 "$pid" 2>/dev/null; then
    # Round 16 (Sonnet): only the line read is removed; a fresh claim moved in since (under the take lock) stays.
    [ "$(cat "$f" 2>/dev/null)" = "$line" ] && rm -f "$f" 2>/dev/null
    return 0
  fi
  printf '%s\n' "$line"
}

# kosmos_claim_light_side [minutes]: take or renew THIS run's side claim (cookie KOSMOS_LIGHT_SIDE_COOKIE, exported so
# the run's children are not foreign to it). Returns 1 when another live side claim holds it (so a take under a lock
# cannot overwrite a winner), 0 once written.
kosmos_claim_light_side() {
  local minutes="${1:-30}" dir f tmp cookie active
  case "$minutes" in ''|*[!0-9]*) minutes=30 ;; esac
  dir="$(_kosmos_marker_dir)"; mkdir -p "$dir" 2>/dev/null || return 1
  f="$(_kosmos_light_side_file)"
  cookie="${KOSMOS_LIGHT_SIDE_COOKIE:-}"
  if [ -z "$cookie" ]; then
    cookie="$$-$(date +%s 2>/dev/null || echo 0)-${RANDOM:-0}${RANDOM:-0}"
    export KOSMOS_LIGHT_SIDE_COOKIE="$cookie"
  fi
  active="$(_kosmos_light_side_active)"
  if [ -n "$active" ] && [ "$(printf '%s' "$active" | awk '{print $1}')" != "$cookie" ]; then return 1; fi
  tmp="$dir/.light-side-claim.$$.tmp"
  # Review 11: the label on ONE line. A <what> with a newline wrote a two-line claim, whose cookie then read back with
  # the second line glued on: the run refused its own claim and could not release it, holding the queue to expiry.
  printf '%s %s %s %s\n' "$cookie" "$$" "$(( $(_kosmos_now_epoch) + minutes * 60 ))" "$(printf '%s' "${KOSMOS_SIDE_LABEL:-a light run}" | tr '\n\r' '  ')" > "$tmp" 2>/dev/null \
    || { rm -f "$tmp" 2>/dev/null; return 1; }
  mv -f "$tmp" "$f" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
  return 0
}

# kosmos_publish_light_side_pgid <pgid>: the side command's process group, beside OUR side claim ("<cookie> <pgid>"), so
# a heavy holder's page layer can tell the side turn's own browser run from anyone else's (review 5).
kosmos_publish_light_side_pgid() {
  local f tmp; f="$(_kosmos_light_side_file).pgid"; tmp="$f.$$.tmp"
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
  [ -n "${KOSMOS_LIGHT_SIDE_COOKIE:-}" ] || return 1
  printf '%s %s\n' "$KOSMOS_LIGHT_SIDE_COOKIE" "$1" > "$tmp" 2>/dev/null && mv -f "$tmp" "$f" 2>/dev/null
}
# _kosmos_light_side_pgid: the live side turn's published process group, or nothing (no live claim, or a sidecar left by
# another claim).
_kosmos_light_side_pgid() {
  local active line
  active="$(_kosmos_light_side_active)"; [ -n "$active" ] || return 0
  line="$(cat "$(_kosmos_light_side_file).pgid" 2>/dev/null)" || return 0
  [ "$(printf '%s' "$line" | awk '{print $1}')" = "$(printf '%s' "$active" | awk '{print $1}')" ] || return 0
  printf '%s' "$line" | awk '{print $2}'
}

# kosmos_release_light_side: drop OUR side claim (cookie match); never a foreign one.
kosmos_release_light_side() {
  local self="${KOSMOS_LIGHT_SIDE_COOKIE:-}" f line
  [ -n "$self" ] || return 0
  f="$(_kosmos_light_side_file)"
  [ -f "$f" ] || return 0
  line="$(cat "$f" 2>/dev/null)" || return 0
  [ "$(printf '%s' "$line" | awk '{print $1}')" = "$self" ] && rm -f "$f" "$f.pgid" 2>/dev/null
  return 0
}

# kosmos_refuse_if_light_side_live <what>: refuses while a FOREIGN side turn is live (our own cookie is not foreign).
kosmos_refuse_if_light_side_live() {
  local what="${1:-this run}" active
  active="$(_kosmos_light_side_active)"
  [ -n "$active" ] || return 0
  [ -n "${KOSMOS_LIGHT_SIDE_COOKIE:-}" ] && [ "$(printf '%s' "$active" | awk '{print $1}')" = "$KOSMOS_LIGHT_SIDE_COOKIE" ] && return 0
  echo "a light run has a side turn beside the heavy one ($(printf '%s' "$active" | awk '{$1=$2=$3=""; sub(/^ +/,""); print}'), pid $(printf '%s' "$active" | awk '{print $2}')); $what waits for it, which is minutes (#4911)." >&2
  return 1
}

# _kosmos_load_and_cores: "<1-min load> <cores>", or what it could read. KOSMOS_LOAD_PROBE (a command printing the same)
# is the test seam.
_kosmos_load_and_cores() {
  if [ -n "${KOSMOS_LOAD_PROBE:-}" ]; then "$KOSMOS_LOAD_PROBE" 2>/dev/null; return 0; fi
  local l c
  l="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
  [ -n "$l" ] || l="$(awk '{print $1}' /proc/loadavg 2>/dev/null)"
  c="$(sysctl -n hw.ncpu 2>/dev/null)"
  [ -n "$c" ] || c="$(getconf _NPROCESSORS_ONLN 2>/dev/null)"
  printf '%s %s\n' "$l" "$c"
}

# _kosmos_playwright_browsers: "pid command" of each running Playwright BROWSER (an executable under an ms-playwright
# browser folder), rc 0 even when none; 2+ when pgrep could not run. Review 6: matching the bare folder name also caught
# any command that mentions the path (an `ls` or `du` of it). An agent's Playwright MCP browser IS one and holds side
# turns off while it runs (the safe side).
_kosmos_playwright_browsers() {
  local raw rc
  raw="$(pgrep -fl 'ms-playwright/' 2>/dev/null)"; rc=$?
  [ "$rc" -ge 2 ] && return "$rc"
  # Review 7: not WebKit's XPC helpers. launchd starts them (parent pid 1, their own process group), so they are
  # never the side command's descendants and a side WebKit check would yield to its OWN helpers on every poll. Its UI
  # process (webkit-*/Playwright.app/...) is a descendant and stays in the list. Review 10: likewise Chrome's crash
  # reporter (chrome_crashpad_handler), which double-forks to parent pid 1 (every Chrome-family handler on this box
  # does); excluding it hides no browser run, whose own browser process is always listed.
  printf '%s\n' "$raw" | grep -E '^[0-9]+ +[^ ]*ms-playwright/(chromium|chromium_headless_shell|firefox|webkit)[^/ ]*/' | grep -v -e '\.xpc/' -e 'chrome_crashpad_handler' || true
  return 0
}

# kosmos_light_side_clear <what>: 0 when THIS light run may take a side turn now. Refuses (1, the reason on stderr)
# unless every one of these holds:
#   1. this run is light, and KOSMOS_SIDE_LANE is not 0;
#   2. no side turn is live (one light run beside a heavy one, never two);
#   3. the box HAS a heavy holder: a live machine claim that is not a cut (its label says "(not a cut)") and not a light
#      turn (its label says "[light]"). A bare suite with no claim does not count (its age is not readable), and a free
#      box is the main queue's business, so the side turn never jumps a waiter for an idle box;
#   4. that claim is at least KOSMOS_SIDE_MIN_HOLD_S old (default 90 s): the load figure is a 1-minute average, so it
#      reads low for a holder that has only just started a build;
#   5. no cut, no install harness and no other browser run is live, and no Playwright browser is running (most one-off
#      checks run `node docs/browser-checks/x.js` directly, which the browser-run guard cannot see; two Playwright
#      runs competing for CPU is the hazard that guard names);
#   6. the 1-minute load is below half the cores (KOSMOS_SIDE_MAX_LOAD sets the line instead);
#   7. no SIDE-CAPABLE light waiter is ahead of this one (earlier queue time, then lower pid; marker line 6), so light
#      runs keep their order.
# 🛑 Condition 3 cannot see a light turn whose claim was taken by a queued-heavy.sh older than #4911: its label has no
# class, so it reads as heavy. Such a holder is one short run, and condition 5 still refuses beside its browser run.
kosmos_light_side_clear() {
  local what="${1:-this run}" active label cookie born now lc load cores maxl dir f pid ts cls mine_ts mine_pid minhold
  [ "${KOSMOS_SIDE_LANE:-1}" != 0 ] || { echo "the side turn is off (KOSMOS_SIDE_LANE=0)." >&2; return 1; }
  [ "$(_kosmos_queue_class)" = light ] || { echo "$what is not a light run; only a light run takes a side turn." >&2; return 1; }
  kosmos_refuse_if_light_side_live "$what" || return 1
  now="$(_kosmos_now_epoch)"
  active="$(_kosmos_machine_claim_active)"
  if [ -n "$active" ]; then
    cookie="$(printf '%s' "$active" | awk '{print $1}')"
    label="$(printf '%s' "$active" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
    case "$label" in *"(not a cut)"*) ;; *) echo "the box is held by a cut ($label); no side turn beside a cut." >&2; return 1 ;; esac
    case "$label" in *"[light]"*) echo "the box is held by a light run ($label); never two light runs at once." >&2; return 1 ;; esac
    minhold="${KOSMOS_SIDE_MIN_HOLD_S:-90}"; case "$minhold" in ''|*[!0-9]*) minhold=90 ;; esac
    born="$(printf '%s' "$cookie" | awk -F- '{print $2}')"
    case "$born" in ''|*[!0-9]*) born="$now" ;; esac   # an unreadable start is taken as just now: wait, the safe side
    if [ $(( now - born )) -lt "$minhold" ]; then echo "the heavy run started $(( now - born ))s ago; its load is not readable yet (${minhold}s)." >&2; return 1; fi
  else
    # Review 2: only a CLAIMED holder qualifies. A bare suite (validate.sh's yarn test) carries no start time a reader
    # can trust without a ps parse, and one seconds old reads as a low load: the ramp the 90 s rule is for.
    echo "no queued heavy run holds the box; $what takes an ordinary turn." >&2; return 1
  fi
  kosmos_refuse_if_cut_live "$what" || return 1
  kosmos_refuse_if_harness_live "$what" "" || return 1
  kosmos_refuse_if_browser_run_live "$what" || return 1
  local pw pwrc
  if [ -n "${KOSMOS_PW_PROBE:-}" ]; then pw="$("$KOSMOS_PW_PROBE" 2>/dev/null)"; pwrc=$?
  else pw="$(_kosmos_playwright_browsers)"; pwrc=$?; fi
  if [ "$pwrc" -ge 2 ]; then echo "could not tell whether a Playwright browser is running; no side turn for $what." >&2; return 1; fi
  [ -n "$pw" ] && pw="$(printf '%s\n' "$pw" | _kosmos_drop_test_fixtures || true)"   # review 8: a suite's stand-in is not a browser
  if [ -n "$pw" ]; then echo "a Playwright browser is running ($(printf '%s\n' "$pw" | head -1 | cut -c1-80)); no side turn beside it." >&2; return 1; fi
  lc="$(_kosmos_load_and_cores)"; load="${lc%% *}"; cores="${lc##* }"
  maxl="${KOSMOS_SIDE_MAX_LOAD:-}"
  if ! awk -v l="$load" -v c="$cores" -v m="$maxl" 'BEGIN {
      if (l !~ /^[0-9]+(\.[0-9]+)?$/ || c !~ /^[0-9]+$/ || c + 0 <= 0) exit 1
      line = (m ~ /^[0-9]+(\.[0-9]+)?$/) ? m + 0 : c / 2
      exit (l + 0 < line) ? 0 : 1 }'; then
    echo "the load is ${load:-unreadable} on ${cores:-?} cores; a side turn needs it below ${maxl:-half the cores}." >&2
    return 1
  fi
  read -r mine_ts mine_pid 2>/dev/null < "$(_kosmos_suite_waiter_file "$$")" || { echo "$what holds no queue place yet." >&2; return 1; }
  case "$mine_ts" in ''|*[!0-9]*) echo "$what has no readable queue place." >&2; return 1 ;; esac
  case "$mine_pid" in ''|*[!0-9]*) mine_pid="$$" ;; esac   # review: a one-field marker still orders by this run's pid
  dir="$(_kosmos_marker_dir)"
  local l6
  for f in "$dir"/suitewait.*; do
    [ -e "$f" ] || continue
    case "${f##*/}" in *.tmp.*) continue ;; esac
    pid="${f##*.}"
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$pid" = "$$" ] && continue
    l6="$(sed -n '6p' "$f" 2>/dev/null)" || l6=""
    # Review 3: a queued-heavy.sh from before #4911 checks no side claim when it takes a main turn, so while one waits
    # a side turn could find a main turn started beside it. No side turn until every such waiter has gone (rollout).
    # Round 16: the intruder asks the same (_kosmos_old_qh_waiter_live), for one that queues after the take.
    case "$(sed -n '2p' "$f" 2>/dev/null)" in *queued-heavy*)
      if [ "$l6" != side ] && [ "$l6" != aware ] && _kosmos_suite_waiter_live "$pid"; then
        echo "a queued run from a queued-heavy.sh older than #4911 is waiting (pid $pid); it would not wait for a side turn, so none is taken until it has gone." >&2; return 1
      fi ;;
    esac
    cls="$(sed -n '5p' "$f" 2>/dev/null)" || cls=""
    [ "$cls" = light ] || continue
    [ "$l6" = side ] || continue   # review 2: only a waiter that asks for side turns
    _kosmos_suite_waiter_live "$pid" || continue
    read -r ts _ 2>/dev/null < "$f" || continue
    case "$ts" in ''|*[!0-9]*) continue ;; esac
    if [ "$ts" -lt "$mine_ts" ] || { [ "$ts" -eq "$mine_ts" ] && [ "$pid" -lt "$mine_pid" ]; }; then
      echo "an earlier light run (pid $pid) takes the side turn first." >&2; return 1
    fi
  done
  return 0
}

# kosmos_light_side_take <what> [minutes]: the side take, for a caller that holds its take lock. Asks
# kosmos_light_side_clear again (the wait asked outside the lock), then claims the side turn; only a won take drops the
# queue marker, so a lost one keeps its place (the next wait resumes it). 0 on a win.
kosmos_light_side_take() {
  local what="${1:-this run}" minutes="${2:-15}"
  kosmos_light_side_clear "$what" >/dev/null 2>&1 || return 1
  kosmos_claim_light_side "$minutes" || { unset KOSMOS_LIGHT_SIDE_COOKIE; return 1; }   # review 15: either loss clears it
  # Review 3: a cut, an install harness and a page layer MARK themselves and then look for a side claim; this side
  # looked first and claimed second, so one could slip into the gap. Claimed now, it asks again: anything that marked
  # before the claim is seen here, and anything after it sees the claim. Either way one of the two waits.
  if ! kosmos_light_side_clear "$what" >/dev/null 2>&1; then kosmos_release_light_side; unset KOSMOS_LIGHT_SIDE_COOKIE; return 1; fi
  kosmos_unmark_suite_waiting
  # Round 17 (Opus): the holder this side turn runs beside, by its claim's cookie. The intruder yields when ANOTHER
  # claim takes the box: an older queued-heavy.sh that found the queue empty never writes a waiter marker, so the
  # marker checks cannot see it, but its claim can be seen. Kept in the run's environment (the capper inherits it).
  KOSMOS_SIDE_HOLDER_COOKIE="$(_kosmos_machine_claim_active | awk '{print $1}')"; export KOSMOS_SIDE_HOLDER_COOKIE
  return 0
}

# kosmos_holds_light_side: true only when THIS run (or a child carrying its cookie) holds the live side claim.
# run-tests.sh asks it: a side turn runs its tests directly; through run-tests.sh it would queue behind the heavy
# holder's claim while holding the side claim (review 2), so run-tests.sh refuses at once inside a side turn.
kosmos_holds_light_side() {
  local active self="${KOSMOS_LIGHT_SIDE_COOKIE:-}"
  [ -n "$self" ] || return 1
  active="$(_kosmos_light_side_active)"
  [ -n "$active" ] && [ "$(printf '%s' "$active" | awk '{print $1}')" = "$self" ]
}

# kosmos_light_side_intruder <root pid>: 0 (and why, on stdout) when a browser run or a Playwright browser is live that
# is NOT the side command's own (root pid and its descendants), so the side turn should YIELD. queued-heavy.sh asks it
# every few seconds through a side turn and stops its command when it says yes (review 5): the start gate cannot see a
# heavy holder's page layer that starts AFTER the side turn did, and a holder on a branch older than #4911 runs a
# browser-checks.sh that does not wait for a side turn. Yielding protects that holder whatever it runs; the light run
# takes the red, which is the side turn's bargain. Same probes as the start gate (KOSMOS_BC_PROBE, KOSMOS_PW_PROBE),
# plus the run markers. A probe that cannot answer is an intruder (the safe side: the light run stops).
# _kosmos_old_qh_waiter_live: 0 (echoing its pid) while a queued-heavy.sh older than #4911 (a 'suitewait' marker whose
# line 2 names queued-heavy and whose line 6 is neither side nor aware) is waiting. Such a waiter takes a main turn
# without asking about a side turn (round 16, Sonnet): the take refuses while one waits, and the intruder yields to one
# that queued after the take, before it can take a turn beside this one.
_kosmos_old_qh_waiter_live() {
  local f pid l6
  for f in "$(_kosmos_marker_dir)"/suitewait.*; do
    [ -e "$f" ] || continue
    case "${f##*/}" in *.tmp.*) continue ;; esac
    pid="${f##*.}"; case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$pid" = "$$" ] && continue
    case "$(sed -n '2p' "$f" 2>/dev/null)" in *queued-heavy*) ;; *) continue ;; esac
    l6="$(sed -n '6p' "$f" 2>/dev/null)" || l6=""
    [ "$l6" = side ] || [ "$l6" = aware ] && continue
    _kosmos_suite_waiter_live "$pid" || continue
    echo "$pid"; return 0
  done
  return 1
}

kosmos_light_side_intruder() {
  local root="${1:-}" lines rc l pid f
  case "$root" in ''|*[!0-9]*) echo "no side command to protect"; return 0 ;; esac
  if pid="$(_kosmos_old_qh_waiter_live)"; then echo "a queued-heavy.sh older than #4911 queued (pid $pid); it would take a turn beside this one"; return 0; fi
  # Round 17 (Opus): a claim that is not the holder's took the box (an older wrapper that found the queue empty, so it
  # marked nothing). The holder's renewals keep its cookie, and a cut it runs keeps it too (and is caught below).
  if [ -n "${KOSMOS_SIDE_HOLDER_COOKIE:-}" ]; then
    l="$(_kosmos_machine_claim_active | awk '{print $1}')"
    if [ -n "$l" ] && [ "$l" != "$KOSMOS_SIDE_HOLDER_COOKIE" ]; then echo "another run took the box after the heavy holder this side turn started beside"; return 0; fi
  fi
  # Review 6: a cut or an install harness that starts during the side turn is an intruder too (the start gate saw
  # neither, and one on a branch older than #4911 does not wait for a side turn).
  if ! kosmos_refuse_if_cut_live "a side turn" >/dev/null 2>&1; then echo "a cut started"; return 0; fi
  if ! kosmos_refuse_if_harness_live "a side turn" "" >/dev/null 2>&1; then echo "an install harness started"; return 0; fi
  if [ -n "${KOSMOS_BC_PROBE:-}" ]; then lines="$("$KOSMOS_BC_PROBE" 2>/dev/null)"; rc=$?
  else
    # Review 6: pgrep's own status, not the filter's (a pgrep that failed read as "nothing live").
    lines="$(pgrep -fl 'browser-checks\.sh' 2>/dev/null)"; rc=$?; [ "$rc" -le 1 ] && rc=0
    lines="$(printf '%s\n' "$lines" | grep -E '^[0-9]+ +([^ ]*/)?(ba)?sh +([^ ]*/)?tools/browser-checks\.sh( |$)' || true)"
  fi
  [ "$rc" -ge 2 ] && { echo "could not tell whether a browser run is live"; return 0; }
  [ -n "$lines" ] && lines="$(printf '%s\n' "$lines" | _kosmos_drop_test_fixtures || true)"   # a suite's fixture is not a run
  if [ -n "${KOSMOS_PW_PROBE:-}" ]; then l="$("$KOSMOS_PW_PROBE" 2>/dev/null)"; rc=$?
  else l="$(_kosmos_playwright_browsers)"; rc=$?; fi
  [ "$rc" -ge 2 ] && { echo "could not tell whether a Playwright browser is live"; return 0; }
  [ -n "$l" ] && l="$(printf '%s\n' "$l" | _kosmos_drop_test_fixtures || true)"   # review 8: a suite's stand-in is not a browser
  lines="$lines
$l"
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    pid="${l%% *}"; case "$pid" in ''|*[!0-9]*) continue ;; esac
    kill -0 "$pid" 2>/dev/null || continue
    _kosmos_pid_is_self_or_descendant "$pid" "$root" && continue
    echo "a browser run that is not this side turn's started ($(printf '%s' "$l" | cut -c1-80))"; return 0
  done <<EOL
$lines
EOL
  for f in "$(_kosmos_marker_dir)"/browser.*; do
    [ -e "$f" ] || continue
    pid="${f##*.}"; case "$pid" in ''|*[!0-9]*) continue ;; esac
    kill -0 "$pid" 2>/dev/null || continue
    _kosmos_pid_is_self_or_descendant "$pid" "$root" && continue
    [ "$(sed -n '2p' "$f" 2>/dev/null)" = "$(ps -ww -o command= -p "$pid" 2>/dev/null)" ] || continue   # a recycled pid is no run
    echo "a marked browser run that is not this side turn's started (pid $pid)"; return 0
  done
  return 1
}
