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
  printf '%s %s %s %s %s\n' "$cookie" "$$" "$exp" "$host" "release ${V:-cut}" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
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
  echo "the machine is reserved for a release (${label:-a cut}, pid $pid on ${host:-this Mac}) until $(_kosmos_epoch_hhmm "$exp"); $what would share the box and could corrupt both results (a gate that passes alone fails under a concurrent one). Wait for it to finish (kosmos_machine_claim_status, or tools/who-has-the-box.sh, says when), or KOSMOS_IGNORE_MACHINE_CLAIM=1 to run anyway." >&2
  return 1
}

# kosmos_machine_claim_status  -- the "who has the box?" answer, one line to
# stdout. Prints the holder + until for an active claim, else the all-clear.
kosmos_machine_claim_status() {
  local active pid exp host label
  active="$(_kosmos_machine_claim_active)"
  if [ -z "$active" ]; then
    echo "no release holds the machine right now."
    return 0
  fi
  pid="$(printf '%s'   "$active" | awk '{print $2}')"
  exp="$(printf '%s'   "$active" | awk '{print $3}')"
  host="$(printf '%s'  "$active" | awk '{print $4}')"
  label="$(printf '%s' "$active" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
  echo "the machine is reserved for a release (${label:-a cut}, pid $pid on ${host:-this Mac}) until $(_kosmos_epoch_hhmm "$exp")."
  return 0
}
