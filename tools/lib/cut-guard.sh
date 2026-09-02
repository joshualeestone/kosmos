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
_kosmos_marker_dir() { printf '%s' "${KOSMOS_RUN_MARKER_DIR:-${TMPDIR:-/tmp}/kosmos-run-markers}"; }

# kosmos_mark_run <type>  — the run declares itself. Call once, where the script
# sources this lib, BEFORE the refuse check. Exports KOSMOS_RUN_COOKIE_<TYPE> so the
# guard excludes THIS run. Best-effort: a mark it cannot write just leaves the name
# arm to cover this run. No trap (so it cannot clobber a caller's EXIT trap): a clean
# exit's marker lingers only until the next reader sees its pid is dead and unlinks
# it, so a crash can never strand a live-LOOKING marker.
kosmos_mark_run() {
  local type="${1:-}" dir cookie uc
  [ -n "$type" ] || return 0
  uc="$(printf '%s' "$type" | tr '[:lower:]' '[:upper:]')"
  [ -n "$uc" ] || return 0     # a nameless cookie var would make the guard refuse THIS run
  dir="$(_kosmos_marker_dir)"
  mkdir -p "$dir" 2>/dev/null || return 0
  cookie="$$-$(date +%s 2>/dev/null || echo 0)-${RANDOM:-0}${RANDOM:-0}"
  # Export the self-cookie BEFORE writing the marker, so a reader in this process can
  # never see a marker without also seeing the cookie that excludes it -- a partial
  # success must not strand a marker that self-refuses.
  export "KOSMOS_RUN_COOKIE_$uc=$cookie"
  printf '%s\n' "$cookie" > "$dir/$type.$$" 2>/dev/null || return 0
  return 0
}

# _kosmos_marker_other_live <type>  — echo a one-line description of a LIVE run of
# <type> that is NOT this caller's own (by cookie), or nothing. Unlinks stale
# (dead-pid) markers as it goes. Read-only w.r.t. live runs; only removes markers
# whose owning pid is gone.
_kosmos_marker_other_live() {
  local type="${1:-}" dir uc self f pid cookie
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
    cookie="$(cat "$f" 2>/dev/null)"
    { [ -n "$self" ] && [ "$cookie" = "$self" ]; } && continue   # my own run
    printf 'a marked %s run (pid %s)\n' "$type" "$pid"
    return 0
  done
  return 0
}

# The live-cut guard (#708). Two copies of the install gate on one Mac share
# the fixed port range, the real ~/Applications and /Applications
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
# cut's start by ~32s; nothing broke that time. The harness holds a FIXED port,
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
kosmos_refuse_if_harness_live() {
  local what="${1:-this run}" probe="${KOSMOS_HARNESS_PROBE:-}" raw out rc self marker_other
  self="${KOSMOS_HARNESS_SELF_PID:-$$}"
  # #1796: the reliable arm -- a marked harness that is not this caller's own. This
  # is the guard the card measured firing during a cut: a real test-install.sh RUN
  # correctly refuses a cut (they share the fixed install-gate port), but the marker
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
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether an install harness is running (the probe exited $rc); refusing to guess for $what. KOSMOS_CUT_IGNORE_HARNESS=1 cuts anyway." >&2
    return 1
  fi
  if { [ "$rc" -eq 0 ] && [ -n "$out" ]; } || [ -n "$marker_other" ]; then
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"; [ -n "$detail" ] || detail="$marker_other"
    echo "an install harness (tools/test-install.sh) is already running on this Mac ($detail); it holds the install gate's fixed port, so $what would collide with it and the failed step would be blamed on the cut rather than the harness. Wait for the harness to finish, or KOSMOS_CUT_IGNORE_HARNESS=1 to cut anyway." >&2
    return 1
  fi
  return 0
}
