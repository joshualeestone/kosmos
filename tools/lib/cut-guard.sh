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
  local what="${1:-this run}" probe="${KOSMOS_CUT_PROBE:-}" raw out rc self
  self="${KOSMOS_CUT_SELF_PID:-$$}"
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
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    echo "a cut is running on this Mac ($(printf '%s\n' "$out" | head -1 | cut -c1-80)); $what would share its ports, its real-folder fingerprints and its launchd domain, and either result could be the other's. Wait for the cut's 'completed' line in ~/.claude/logs/cut-suite-runs.log, or KOSMOS_HARNESS_IGNORE_CUT=1 to run anyway." >&2
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
  local what="${1:-this run}" probe="${KOSMOS_BC_PROBE:-}" raw out rc self
  self="${KOSMOS_BC_SELF_PID:-$$}"
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
    # || true for parity with the single-pid path above: _kosmos_drop_self_subtree's
    # while-loop exits non-zero on its final read EOF, which would surface under
    # `set -o pipefail` in a future caller.
    out="$(printf '%s\n' "$out" | _kosmos_drop_self_subtree "$self" || true)"
  fi
  if [ "$rc" -ge 2 ]; then
    echo "could not tell whether another browser run is live (the probe exited $rc); refusing to guess for $what. KOSMOS_HARNESS_IGNORE_CUT=1 runs anyway." >&2
    return 1
  fi
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    echo "another browser-checks run is already live on this Mac ($(printf '%s\n' "$out" | grep -c . ) live; first: $(printf '%s\n' "$out" | head -1 | cut -c1-80)); two Playwright runs starve each other of CPU and the loser fails with errors that read like missing code, so $what would produce a verdict you cannot trust. Wait for it to finish, or KOSMOS_HARNESS_IGNORE_CUT=1 to run anyway." >&2
    return 1
  fi
  return 0
}
