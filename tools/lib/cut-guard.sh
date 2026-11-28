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

# --- Shared: is <script> RUNNING, as opposed to queued or merely mentioned? (#5470) -----
# `pgrep -f <script>` matches every process whose command line CONTAINS the name: a run, but also a
# tools/queued-heavy.sh waiter that carries it as an argument, the `sh -c "... bash <script>"` shell that
# started that waiter, and any command that only names it. On the 0.7.27 cut a wait written that way
# held the machine for a waiter that was waiting for the same machine (#5467). A run's command line
# STARTS with the interpreter and the script: `[path/](ba)sh [options] [path/]<script>[ args]`, where the
# options are flags like -x, +x, -e or --norc, a bare --, the value-taking -o/-O NAME (also as the end of
# a cluster like -eo NAME) and --rcfile/--init-file FILE, but never a cluster holding c (a command string,
# which only mentions the script) or n (a syntax check, which never runs it). A few shapes that are not
# runs also match (`bash -s <script>`, `bash --rcfile <script>`, a script given as an option's value): all
# fail toward busy.
# LC_ALL=C on the grep inside kosmos_running_lines as well, belt and braces (the option letters are spelled out, see _KOSMOS_SH_OPTS). A queued-heavy waiter needs no rule of its own here: its
# command starts with tools/queued-heavy.sh, not with <script>, so it never matches.
# CALL IT INSIDE `if` OR AFTER `||`: 1 is the ordinary "nothing running" answer, and as a bare statement
# under `set -e` (release.sh, test-install.sh) it would end the caller silently.
# NOT SEEN: a run started from inside tools/ (`cd tools && bash release.sh`, `bash ./browser-checks.sh`),
# because the match needs the tools/ path (tools/heavy-gate.sh counts those, by a cwd ending in /tools;
# the cut and the page layer are always started as tools/...). NOT SEEN either: a run whose script path contains a space, because pgrep prints it split at the space (the
# guards this replaced had the same gap; tools/heavy-gate.sh does count it). Every checkout this fleet
# cuts or tests from has a space-free path. This prints the
# "<pid> <command>" lines of exactly those, from _kosmos_pgrep_cmdlines, and returns 0 when there is one, 1 when
# there is none, 2 when pgrep itself failed (so a caller can tell "nothing" from "could not tell").
# <script> is a path like tools/browser-checks.sh (letters, digits, . _ / - only; anything else returns 2);
# its dots are matched literally. The lines come from _kosmos_pgrep_cmdlines (#6799), which prints the whole command
# line on macOS and on Linux alike.
# The shell options a run may carry before its script (shared with _kosmos_drop_test_fixtures so the two
# read the same command shapes). Letters are SPELLED OUT, not ranged (every letter but c, a command string,
# and n, a syntax check): ranges are collation-dependent, and `[[ =~ ]]` runs in the caller's locale.
_KOSMOS_SH_OPTS='( +([-+][ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghijklmopqrstuvwxyz]*[oO] +[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_]+|--(rcfile|init-file) +[^ ]+|[-+][ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghijklmopqrstuvwxyz]+|--[abcdefghijklmnopqrstuvwxyz][abcdefghijklmnopqrstuvwxyz-]*|--))*'
# #6799: `pid <whole command line>` for every process whose command line matches the ERE $1, with pgrep's own
# status (1 none, 2+ could not run). macOS `pgrep -fl` prints the whole command line; Linux (procps) `pgrep -fl`
# prints only the process NAME and needs `-fa`, while macOS reads -a as "include ancestors", so the flag follows
# the platform: $OSTYPE when it says darwin (no fork), else `uname -s`, because bash keeps an OSTYPE it inherits
# (measured) and a Mac sent to -a would match nothing and fail the guards open. macOS pgrep also never lists its own
# ancestors, and those include the caller and every `$( )` subshell around this call, which carry the caller's
# command line; procps pgrep lists them. So on Linux the caller's ancestor chain is dropped here, and both
# platforms answer the same (tools/test-running-anchor-5470.sh: "does not list its own ancestors").
# kosmos#9149: under LC_ALL=C, because in a UTF-8 locale pgrep exits 3 ("illegal byte sequence") whenever ANY process
# has a command line that is not valid UTF-8, and the guards read 2+ as "could not tell".
_kosmos_pgrep_cmdlines() {   # <ERE>
  case "${OSTYPE:-}" in darwin*) LC_ALL=C pgrep -fl "$1"; return ;; esac
  if [ "$(uname -s 2>/dev/null)" = Darwin ]; then LC_ALL=C pgrep -fl "$1"; return; fi
  local raw rc anc=" " p hops=0 kept
  # One simple command in the $( ): bash runs pgrep in that child itself, so no extra shell carrying the caller's
  # command line sits between them (a pipe here would add one, outside the ancestor chain below). Pinned by
  # test-running-anchor-5470's "does not list its own ancestors" arm on Linux.
  raw="$(LC_ALL=C pgrep -fa "$1")"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  # This shell's own pid, which inside a `$( )` is not $$. BASHPID is bash 4+; without it, `exec sh` makes sh a
  # direct child of this shell, so its PPID is this shell.
  p="${BASHPID:-}"
  [ -n "$p" ] || p="$(exec sh -c 'echo "$PPID"' 2>/dev/null)"
  [ -n "$p" ] || p=$$
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    anc="$anc$p "
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d '[:space:]')"
    hops=$((hops + 1)); [ "$hops" -gt 64 ] && break
  done
  kept="$(printf '%s\n' "$raw" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$anc" in (*" ${line%% *} "*) continue ;; esac   # leading ( : bash 3.2 misparses a bare pattern ) inside $( )
    printf '%s\n' "$line"
  done)"
  [ -n "$kept" ] || return 1
  printf '%s\n' "$kept"
}

kosmos_running_lines() {   # <script path>
  local script="${1:-}" raw rc re lines
  case "$script" in ''|*[!A-Za-z0-9._/-]*) return 2 ;; esac   # a path, nothing a regex would read as syntax
  re="${script//./\\.}"
  raw="$(_kosmos_pgrep_cmdlines "$re" 2>/dev/null)"; rc=$?
  [ "$rc" -ge 2 ] && return 2
  lines="$(printf '%s\n' "$raw" | LC_ALL=C grep -E "^[0-9]+ +([^ ]*/)?(ba)?sh${_KOSMOS_SH_OPTS} +([^ ]*/)?${re}( |$)" || true)"
  [ -n "$lines" ] || return 1
  printf '%s\n' "$lines"
}

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
# (#5470: it reads a fixture's script with the same _KOSMOS_SH_OPTS as kosmos_running_lines, so the two
# agree on an option-bearing command line.)
_kosmos_drop_test_fixtures() {
  # The interpreter is ([^ ]*/)?(ba)?sh, as wide as _kosmos_suite_candidates's, so a fixture started by
  # a Homebrew bash is dropped by its script path too (#4410 review 13).
  local line pid script re="^[0-9]+ +([^ ]*/)?(ba)?sh${_KOSMOS_SH_OPTS} +(([^ ]*/)?tools/(release|browser-checks|test-install|run-tests)\.sh)( |$)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"
    script=""
    [[ "$line" =~ $re ]] && script="${BASH_REMATCH[6]}"   # groups 3-5 are _KOSMOS_SH_OPTS
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
# kosmos#8870: one line per full-suite turn taken and ended, in suite-turns.log beside the markers, so whether two runs
# overlapped can be read afterwards: they did when one took its turn between the other's took and ended lines. A run
# killed outright (KILL) writes no ended line; its pid then no longer answers, until the pid is given out again. Not
# logged: an --only run, a run that skips the queue, and any run whose copy of this file did not load. Nothing rotates
# the file (two lines per full suite). Best effort: never fails the caller.
# Line: <local time> <took|ended> pid=<pid> <details>
kosmos_suite_turn_log() {
  local d; d="$(_kosmos_marker_dir)"
  { mkdir -p "$d" && printf '%s %s pid=%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" "${KOSMOS_SUITE_SELF_PID:-$$}" "${2:-}" >> "$d/suite-turns.log"; } 2>/dev/null || true
}

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
# `kosmos_refuse_if_x "what" || exit 1`, or inside an `if`. Each asks kosmos_running_lines (#5470),
# which returns 1 when nothing matches, the ordinary nothing-running case. Called as a
# bare statement under `set -e` (release.sh and test-install.sh both set it), that exit 1 would end
# the caller silently at the very moment the answer is "go ahead". The `||` or `if` suspends -e for
# the whole call, which is why every call site in this repo is written that way.
kosmos_refuse_if_cut_live() {
  local what="${1:-this run}" probe="${KOSMOS_CUT_PROBE:-}" out rc self marker_other
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
    # whose own command line starts with the script counts (kosmos_running_lines
    # reads pgrep's status from its own line, never after a pipe, #632).
    out="$(kosmos_running_lines tools/release.sh)"; rc=$?   # #5470: the shared anchored match; 0 run, 1 none, 2 could not tell
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
  local what="${1:-this run}" probe="${KOSMOS_BC_PROBE:-}" out rc self marker_other
  self="${KOSMOS_BC_SELF_PID:-$$}"
  # #1796: the reliable arm. This guard is the one whose caller (browser-checks.sh)
  # genuinely self-matches -- it forks subshells inheriting `bash tools/browser-
  # checks.sh` -- so the live-tree walk below was its real race. The cookie excludes
  # the whole run (the subshells do not mark themselves), no walk.
  marker_other="$(_kosmos_marker_other_live browser)"
  if [ -n "$probe" ]; then
    out="$("$probe" 2>/dev/null)"; rc=$?
  else
    out="$(kosmos_running_lines tools/browser-checks.sh)"; rc=$?   # #5470: the shared anchored match
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
  local what="${1:-this run}" override="${2:-KOSMOS_CUT_IGNORE_HARNESS=1 cuts anyway}" probe="${KOSMOS_HARNESS_PROBE:-}" out rc self marker_other
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
    out="$(kosmos_running_lines tools/test-install.sh)"; rc=$?   # #5470: the shared anchored match
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
# A suite started by a Homebrew bash is still a suite, so the interpreter may sit at any path
# (kosmos_running_lines, shared by every "is X running" guard here since #5470).
_kosmos_suite_candidates() {
  kosmos_running_lines tools/run-tests.sh   # #5470: the shared anchored match (0 lines, 1 none, 2 could not tell)
}

# #6334: one suite is ONE run, however many processes carry its command line (a bash subshell keeps its parent's), so
# a count of live suites keeps only the candidates with no other candidate above them. A candidate that is gone by now
# is dropped rather than counted as a root of its own (its parent can no longer be read). Reads and prints
# `pid command`. Pipes, not here-documents: bash 3.2 writes a here-document to a temp file.
_kosmos_suite_roots() {
  local lines pids line pid other is_child
  lines="$(cat)"
  pids="$(printf '%s\n' "$lines" | while IFS= read -r line; do [ -n "$line" ] && printf '%s\n' "${line%% *}"; done)"
  printf '%s\n' "$lines" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"
    _kosmos_pid_gone "$pid" && continue
    is_child=0
    for other in $pids; do
      [ "$other" != "$pid" ] || continue
      _kosmos_pid_is_self_or_descendant "$pid" "$other" && { is_child=1; break; }
    done
    [ "$is_child" = 1 ] && continue
    _kosmos_pid_gone "$pid" && continue   # exited during the walk (its parent read as empty): not a suite of its own
    printf '%s\n' "$line"
  done
}

# kosmos_refuse_if_suite_live <what> [override] [others-allowed]: refuses while a suite runs. The third argument (#6334,
# default 0) is how many OTHER live suites this run may start beside; only tools/run-tests.sh passes one (from
# KOSMOS_SUITE_MAX), so an install harness and a queued-heavy turn still wait until no suite runs. (A release cut
# does not call this at all.)
kosmos_refuse_if_suite_live() {
  local what="${1:-this run}" override="${2:-KOSMOS_HARNESS_IGNORE_SUITE=1 runs anyway}" probe="${KOSMOS_SUITE_PROBE:-}" out rc self
  local allowed="${3:-0}" n
  case "$allowed" in ''|*[!0-9]*) allowed=0 ;; esac
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
  if [ "$rc" -eq 0 ] && [ -n "$out" ] && [ "$allowed" -gt 0 ]; then
    local roots; roots="$(printf '%s\n' "$out" | _kosmos_suite_roots || true)"
    if [ -n "$roots" ]; then out="$roots"; fi   # empty roots: count the list as it was
    n="$(printf '%s\n' "$out" | grep -c . || true)"
    [ "$n" -le "$allowed" ] && return 0
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"
    echo "$n test suites (tools/run-tests.sh) are already running on this Mac ($detail), and $what starts beside at most $allowed (a limit of $((allowed + 1)); for tools/run-tests.sh it comes from KOSMOS_SUITE_MAX or the suite-max file, #6334). Wait for one to finish, or $override." >&2
    return 1
  fi
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    local detail; detail="$(printf '%s\n' "$out" | head -1 | cut -c1-80)"
    echo "a test suite (tools/run-tests.sh) is already running on this Mac ($detail); $what boots real boards on test ports and checks that they let go of them, and a suite beside it can make those checks red for reasons that are not the change. Wait for the suite to finish (bash tools/heavy-gate.sh --twice --quiet-box says when the box is quiet), or $override. On a busy Mac a suite is often running, so expect to wait rather than to override." >&2
    return 1
  fi
  return 0
}

# #7512: the release cut's quiet-box wait, ONE committed answer to "is anything still running that the cut must wait
# for?", so the per-cut wrapper (outside the repo, mortals:~/.cut-07NN.sh) sources it instead of keeping its own copy.
# Review 1: the wrapper must FAIL CLOSED around it. It sources the main checkout's copy of this file BEFORE that checkout
# is moved to the cut's target, so a checkout older than this function gives 127 (not found), and a bare
# `running() { kosmos_cut_quiet_box_busy; }` would read that as a quiet box and start the cut beside a live suite.
# Only 0 (busy) and 1 (quiet) are answers; anything else is busy:
#   running() { local r; kosmos_cut_quiet_box_busy; r=$?; [ "$r" -le 1 ] && return "$r"
#               echo "could not ask whether the box is quiet (rc $r; is the main checkout pulled?): treated as busy"; return 0; }
# Call it only as a condition (`while why=$(running)`, `if running`): under `set -e` a bare call stops the wrapper on a
# quiet box (review 2), which starts no cut but says nothing.
# The 0.7.73 cut deadlocked for about 20 minutes because the wrapper's own copy counted ANY live
# `bash tools/run-tests.sh` as busy, including a suite that was only WAITING on the cut's own machine claim (it runs no
# test, and waits for the claim to go). That is the 0.7.27 deadlock (#5467, #5470) through another door. Here a suite
# that holds a verified waiting marker (kosmos_wait_until_clear's queue writes one after its first refused check; see
# _kosmos_suite_waiter_live) is not counted, nor is anything descended from one; an unmarked suite still is.
# Prints what it waits for on stdout and returns 0 while busy; returns 1 when the box is quiet. Anything it cannot read
# counts as busy, the safe side. The same five things as the wrapper's copy, in its order: a relay pre-push build, a
# suite, stray shell-shard workers (a #7100 shard can outlive its leader), an install harness, a browser-checks run.
# (Review 5: except the pre-push check, which reads a lockf failure as no build, as kosmos_prepush_build_live says; the
# wrapper's copy did the same.)
# KNOWN RESIDUAL: a suite started with the suite check off (KOSMOS_TESTS_IGNORE_SUITE=1, or inside a test) waits
# without a marker, so it still reads as busy; its wait gives up at its own bound (KOSMOS_WAIT_MAX_S, 20 minutes).
# 🔑 SAFE ONLY WHILE THE CALLER HOLDS THE MACHINE CLAIM AND RENEWS IT (review 3). Skipping a waiting suite is safe
# because that suite's box check asks about the claim first, so it cannot leave its wait while the claim stands (review 4:
# unless it runs with KOSMOS_IGNORE_MACHINE_CLAIM, which its marker records on line 7, and then it is still counted). A
# caller that waits for quiet BEFORE claiming, or lets the claim lapse, could read a waiter as not running in the very
# moment it unmarks and starts. The wrapper claims first and renews every poll.
# Unlike kosmos_refuse_if_suite_live it keeps suites started inside a test (no _kosmos_drop_test_fixtures), as the
# wrapper's copy did: that only errs toward busy.
# Seams: KOSMOS_SUITE_PROBE and KOSMOS_SUITE_SELF_PID, as kosmos_refuse_if_suite_live reads them.
# 0 shards live, 1 none, 2 or more pgrep failed (review 2: busy too; review 6: said as "could not tell").
_kosmos_shell_shards_live() { local rc=0; LC_ALL=C pgrep -f "tools/shell-shard\.js run" >/dev/null 2>&1 || rc=$?; return "$rc"; }   # C: kosmos#9149
kosmos_cut_quiet_box_busy() {
  local probe="${KOSMOS_SUITE_PROBE:-}" self="${KOSMOS_SUITE_SELF_PID:-$$}" out rc sc
  if kosmos_prepush_build_live; then echo "relay pre-push build"; return 0; fi
  if [ -n "$probe" ]; then out="$("$probe" 2>/dev/null)"; rc=$?; else out="$(_kosmos_suite_candidates)"; rc=$?; fi
  if [ "$rc" -ge 2 ]; then echo "could not tell whether a test suite runs (rc $rc): treated as busy"; return 0; fi
  [ -n "$out" ] && out="$(printf '%s\n' "$out" | _kosmos_drop_self_subtree "$self" || true)"
  [ -n "$out" ] && out="$(printf '%s\n' "$out" | _kosmos_drop_claim_bound_suite_waiters || true)"
  if [ -n "$out" ]; then echo "suite ${out%% *}"; return 0; fi
  _kosmos_shell_shards_live; rc=$?
  if [ "$rc" -eq 0 ]; then echo "shell shards running"; return 0; fi
  if [ "$rc" -ge 2 ]; then echo "could not tell whether shell shards run (rc $rc): treated as busy"; return 0; fi
  for sc in tools/test-install.sh tools/browser-checks.sh; do
    if kosmos_running_lines "$sc" >/dev/null; then echo "running: $sc"; return 0; else rc=$?; fi
    [ "$rc" -eq 1 ] || { echo "could not tell whether $sc runs (rc $rc): treated as busy"; return 0; }
  done
  return 1
}

# --- #4498: wait for a quiet box instead of refusing at once ------------------
# The guards above refuse at once. On a busy Mac a suite is usually running, so a refusal sent the
# agent round by hand, or to the override. kosmos_wait_until_clear asks a caller's check again every
# KOSMOS_WAIT_EVERY_S (30) seconds for up to KOSMOS_WAIT_MAX_S (1200, 20 minutes; in the suite queue 6300 s,
# counted as the #4574 note below says), then refuses with the check's own message. KOSMOS_NO_WAIT=1 asks once, as
# before. KOSMOS_WAIT_SLEEP and KOSMOS_WAIT_NOW are test seams.
#
# 🔑 THE SUITE QUEUE, because a waiting run-tests.sh is still a run-tests.sh process. Without it:
#   1. two suites waiting on a third would each see the other as live, and both give up at the bound;
#   2. two suites freed by the same finish would start together, past the limit this exists to keep
#      (#6334: KOSMOS_SUITE_MAX).
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
# #4574: the queue's bound. A bound on the TOTAL wait gave up on every waiter second in line or later, so in the queue
# the bound runs from the last time a waiter AHEAD of this run left (the count from _kosmos_suite_waiters_ahead fell): a
# queue that keeps moving is waited through, and the waiter at the front gives up when no waiter ahead has left for the
# whole bound. The bound covers EVERY blocker run-tests.sh waits on in the queue, a release claim and an install harness
# as well as a suite, so a queued suite now waits up to 105 minutes behind those too (45 before #5907, 20 before #4574);
# all three are long runs, and a claim or a harness that outlives the bound still ends the wait. A harness or a suite's
# own subshells are not waiters, so they never restart it. A rise (a waiter re-marked by the second ask) only arms the
# next fall, so each restart needs a waiter ahead to leave or to read as gone for one pass: one briefly unmarked by its
# second ask, one whose marker a failed ps removed until it writes it again (the loop re-marks a run whose own marker
# vanished), or one an OLDER copy of this lib in another zone keeps deleting (review 19; see _kosmos_suite_waiter_live).
# So the restart is a heuristic, not proof the queue moved. A waiter is in its second ask only when its own check had
# just passed (the box was clear), so that false fall needs a harness to take the box in that moment; the failed-ps one
# needs a ps to fail. A fall and such a re-mark in the same poll net to zero and restart nothing, which errs toward
# giving up. A waiter BEHIND this run never counts, so churn behind it cannot restart its bound. A hard ceiling
# (KOSMOS_WAIT_QUEUE_CEIL_S; by default four bounds plus one per live waiter at entry) ends a FLAPPING wait whatever the
# heuristic says; a healthy deep queue normally stays inside it (an entry count a failed ps made too low shrinks it: the
# safe side, it gives up sooner).
# ⚠️ THE COST, which the ceiling does NOT cap: behind a HUNG suite each waiter ahead that gives up is a fall for the ones
# behind, so the waiter k deep gives up at about (k+1) bounds (105, 210, 315 min), inside its (4+k)-bound ceiling.
# Before #4574 every waiter gave up at 20 minutes. Accepted: a hung suite is rare, and the jam this card measured was
# not one (the live-count side is #4609: see _kosmos_drop_suite_waiters).
# #4609: the overrides and wait controls a caller sets for run-tests.sh's own wait (not the test probes, which tests
# pass explicitly), plus #5332's KOSMOS_WAIT_KEEP_MARK, which is queued-heavy's alone and listed so no child
# inherits it. run-tests.sh unsets them once its wait has read them, and test-cut-guard.sh starts without them, so
# no test inherits a caller's (one list, used by both).
KOSMOS_WAIT_CONTROL_VARS="KOSMOS_TESTS_IGNORE_SUITE KOSMOS_TESTS_IGNORE_HARNESS KOSMOS_IGNORE_MACHINE_CLAIM KOSMOS_NO_WAIT KOSMOS_WAIT_MAX_S KOSMOS_WAIT_EVERY_S KOSMOS_WAIT_QUEUE_CEIL_S KOSMOS_WAIT_NOW KOSMOS_WAIT_SLEEP KOSMOS_QUEUE_CLASS KOSMOS_WAIT_KEEP_MARK KOSMOS_SUITE_MAX"
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
# #7512 review 4: the waiter a pid belongs to (itself or the nearest ancestor holding a verified waiting marker), or
# nothing. The same bounded walk as _kosmos_descends_from_suite_waiter.
_kosmos_suite_waiter_of() {
  local pid="$1" hops=0
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    _kosmos_suite_waiter_live "$pid" && { printf '%s' "$pid"; return 0; }
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    hops=$((hops + 1)); [ "$hops" -gt 64 ] && break
  done
  return 1
}
# Like _kosmos_drop_suite_waiters, but a waiter whose marker says it ignores the machine claim is KEPT: it is free to
# start while a cut's claim stands, so a cut must still wait for it (kosmos_cut_quiet_box_busy).
_kosmos_drop_claim_bound_suite_waiters() {
  local line pid w
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"
    if w="$(_kosmos_suite_waiter_of "$pid")"; then
      # Review 5: one read of the whole marker. A waiter can unmark between the liveness check above and this read
      # (its wait passed); an empty or unreadable marker then keeps the line (busy), never reads as claim-bound.
      local m=""; m="$(cat "$(_kosmos_suite_waiter_file "$w")" 2>/dev/null)" || m=""
      { [ -n "$m" ] && [ "$(printf '%s\n' "$m" | sed -n '7p')" != ignores-claim ]; } && continue
    fi
    _kosmos_pid_gone "$pid" && continue
    printf '%s\n' "$line"
  done
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
  # #7512 review 4: line 7 is "ignores-claim" when this run waits with KOSMOS_IGNORE_MACHINE_CLAIM set. Such a waiter can
  # leave its wait while a cut's claim stands, so the cut's quiet-box wait (kosmos_cut_quiet_box_busy) still counts it.
  local l7=""; [ -n "${KOSMOS_IGNORE_MACHINE_CLAIM:-}" ] && l7=ignores-claim
  printf '%s %s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$ts" "$$" "$(ps -ww -o command= -p "$$" 2>/dev/null)" "$(_kosmos_pid_started_local "$$")" "$(_kosmos_pid_started "$$")" "$(_kosmos_queue_class)" "$l6" "$l7" > "$(_kosmos_suite_waiter_file "$$").tmp.$$" 2>/dev/null \
    && mv -f "$(_kosmos_suite_waiter_file "$$").tmp.$$" "$(_kosmos_suite_waiter_file "$$")" 2>/dev/null
  return 0
}
kosmos_unmark_suite_waiting() { rm -f "$(_kosmos_suite_waiter_file "$$")" "$(_kosmos_suite_waiter_file "$$").tmp.$$" 2>/dev/null; return 0; }

# #4609 light lane: a run declared light (KOSMOS_QUEUE_CLASS=light: one browser check, one focused test file) goes ahead
# of heavy waiters (full suites, cargo runs, pushes): the class changes the order, never how many hold the box
# (one turn, or since #6334 up to KOSMOS_SUITE_MAX suites started directly). A heavy waiter that has waited
# KOSMOS_QUEUE_STARVE_S (default 2700 s, 45 minutes) goes ahead of the light ones, so a stream of light runs cannot hold a suite back for ever. Measured before this (2026-09-30
# 10:07): 22 waiters, 19 of them one-offs that hold the box 7 to 200 s, queued behind suites that hold it 15 to 20 min.
# #5272: KOSMOS_QUEUE_CLASS=canary is the main canary (a full suite on origin/main's tip, the backstop for merges that
# skip a re-run). It waits first among waiters (_kosmos_queue_rank), one canary at a time (_kosmos_suite_waiters_ahead),
# and only a waiter that IS a main canary is honoured (_kosmos_canary_genuine); any other that claims it reads heavy.
_kosmos_queue_class() { case "${KOSMOS_QUEUE_CLASS:-}" in light) echo light ;; canary) echo canary ;; *) echo heavy ;; esac; }
# _kosmos_canary_genuine <marker file>: the waiter is a full suite of a commit already on origin/main, so it is a main
# canary whatever it is called. Line 2 (its command) must be `bash <tree>/tools/run-tests.sh` with an ABSOLUTE tree, and
# that tree's HEAD an ancestor of its origin/main. Defined by what the run is, not by what it says, so naming a cargo
# run, a browser run or a branch's suite "canary" gains nothing (Angel's review of #5272). A suite started as
# `bash tools/run-tests.sh` (relative) is not recognised: the canary starts it by absolute path. Fails closed (heavy).
_kosmos_canary_genuine() {
  local cmd tree
  cmd="$(sed -n '2p' "$1" 2>/dev/null)" || return 1
  case "$cmd" in "bash /"*"/tools/run-tests.sh"|"bash /"*"/tools/run-tests.sh "*) ;; *) return 1 ;; esac
  tree="${cmd#bash }"; tree="${tree%%/tools/run-tests.sh*}"
  [ -d "$tree" ] || return 1
  git -C "$tree" merge-base --is-ancestor HEAD refs/remotes/origin/main 2>/dev/null
}
# _kosmos_queue_rank <queue time> <class> <now>: 0 the canary, 1 any waiter past the starve line, 2 a light one, 3 any
# other heavy. #5272: the canary ranks ABOVE a starving waiter. Ranked equal, it waited behind every heavy job past the
# starve line, which on a busy day is most of the queue (6 h on 2026-10-04). It changes the order, never how many hold
# the box, and never pre-empts a running job. Only the oldest canary waiter gets the class (_kosmos_suite_waiters_ahead).
# #4911: a LIGHT waiter past the starve line is rank 0 too (it ages like a heavy one). Before this a light waiter could
# never reach rank 0, so once every heavy waiter was past 45 min (most of the day on 2026-10-01) the light lane stood
# still: Baron's one test file waited 185 min behind full suites. Among rank 0 the order is queue time, as before.
_kosmos_queue_rank() {
  local starve="${KOSMOS_QUEUE_STARVE_S:-2700}"
  case "$starve" in ''|*[!0-9]*) starve=2700 ;; esac
  if [ "$2" = canary ]; then echo 0
  elif [ $(( $3 - $1 )) -ge "$starve" ]; then echo 1
  elif [ "$2" = light ]; then echo 2
  else echo 3; fi
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
  local dir f pid mine_ts mine_pid ts cls rank mine_rank mine_cls now legacy=0 seen="" lines first_canary=""
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
    [ "$cls" = canary ] && ! _kosmos_canary_genuine "$(_kosmos_suite_waiter_file "$$")" && cls=heavy   # #5272
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
    [ "$cls" = canary ] && ! _kosmos_canary_genuine "$f" && cls=heavy   # #5272: only a real main canary
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
  # #5272: one canary at a time. Only the OLDEST live genuine canary waiter (queue time, then pid; this run included)
  # ranks as canary; any other ranks as heavy. Readers of this lib compute the same first canary from the same markers.
  # A reader of the #4911 lib (6-line markers too, so it cannot be told apart) reads every canary as heavy; it and the
  # canary may then each read themselves first, which the live-suite check and the machine claim serialise. No wait
  # cycle forms: the first canary names no one ahead of it. The bound is one canary waiting at a time, not one ever:
  # once the first runs, the next genuine canary is first.
  first_canary="$(printf '%s' "$seen" | awk -v mp="${mine_pid:-}" -v mt="${mine_ts:-}" -v mc="${mine_cls:-}" '
    BEGIN { if (mc == "canary" && mt != "" && mp != "") { bt = mt + 0; bp = mp + 0; got = 1 } }
    $3 == "canary" { t = $2 + 0; q = $1 + 0; if (!got || t < bt || (t == bt && q < bp)) { bt = t; bp = q; got = 1 } }
    END { if (got) print bp }')"
  [ "${mine_cls:-}" = canary ] && [ "$first_canary" != "${mine_pid:-}" ] && mine_cls=heavy
  if [ -n "$mine_ts" ]; then
    if [ "$legacy" = 1 ] || [ "$legacy" = 2 ]; then mine_rank="$(_kosmos_queue_rank_legacy "$mine_ts" "$mine_cls" "$now")"
    else mine_rank="$(_kosmos_queue_rank "$mine_ts" "$mine_cls" "$now")"; fi
  fi
  printf '%s' "$seen" | while read -r pid ts cls; do
    [ -n "$pid" ] || continue
    if [ -z "$mine_ts" ]; then echo "$pid"; continue; fi
    [ "$cls" = canary ] && [ "$pid" != "$first_canary" ] && cls=heavy   # #5272: a second canary waits as heavy
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
  # #5272: a run that asked to be the canary and still has a waiter ahead is being read as heavy. Name the reasons.
  [ "$(sed -n '5p' "$(_kosmos_suite_waiter_file "$$")" 2>/dev/null)" = canary ] \
    && echo "  (this run asked to queue as the canary, #5272, and is read as heavy here: it is not a full suite started as bash <absolute tree>/tools/run-tests.sh on a commit already on origin/main, or another canary queued before it (one at a time), or a waiter from an older lib is live, whose order has no canary.)" >&2
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
# #5332: KOSMOS_WAIT_KEEP_MARK=1 does the same for a MAIN turn: a clear pass returns 0 with the queue marker kept, and
# the caller then OWNS the unmark (after its take is won; a lost take keeps the place). Only queued-heavy.sh sets it,
# and it unsets it for its command; run-tests.sh unsets it before its own wait, since nothing there would unmark.
kosmos_wait_until_clear() {
  local what="$1"; shift
  local queue=0; [ "${1:-}" = --suite-queue ] && { queue=1; shift; }
  local side=""
  if [ "$queue" = 1 ] && [ "${1:-}" = --side ]; then
    [ $# -ge 3 ] || { echo "kosmos_wait_until_clear: --side needs a side check and then the check" >&2; return 1; }
    side="$2"; shift 2
  fi
  KOSMOS_WAIT_LANE=main
  # #4574: in the suite queue the bound counts from the last time a waiter ahead left (the queue note).
  # #5907: 6300 s (105 min). The holder the front waiter waits behind is often a full browser-check run: 74 min at
  # the median, 50 of 50 over 45 min (Agent1s 09-30 to 10-12), so at 2700 s the front waiter gave up behind every one
  # and re-queued at the back. 105 min is longer than 91 of the 93 heavy runs measured; the two longer ones took 129
  # and 151 min. The ceiling below is four bounds plus one per waiter ahead, so 7 h plus 105 min per waiter: a waiter
  # k deep in a healthy queue waits behind about k such holders, and a ceiling on the old 2700 s cut that off.
  local dflt=1200; [ "$queue" = 1 ] && dflt=6300
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
      # #5332: a caller that takes the box under its own lock (tools/queued-heavy.sh) keeps its place until the take
      # is won: dropping it here let a later waiter see nobody ahead and race this run to the lock. The caller asks
      # again under that lock and unmarks after its claim. Only queued-heavy sets this; run-tests.sh does not.
      if [ "$queue" = 1 ] && [ -n "$ts" ] && [ "${KOSMOS_WAIT_KEEP_MARK:-0}" = 1 ]; then
        [ "$waited" -gt 0 ] && echo "the box is clear after waiting ${waited}s; $what takes it now." >&2
        return 0
      fi
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

# kosmos#6756 and #7674: a relay pre-push build running here. The build publishes no claim or marker of its own, so
# before #6756 a cut or a heavy turn that started during it could not see it. What it does hold, all in one folder
# (~/.cache/prepush on Mortals, written by kosmos-relay's .githooks/pre-push):
#   - machine.lock, a kernel lock (lockf), for each long cargo step;
#   - prepush.gate.lock, the gate lock, for EVERY step, its checkout included (pruning, the target cap, git checkout);
#   - prepush.gate.turn, its gate turn, between two steps: touched at each step boundary, removed when the gate ends or
#     on any red (#7674: before this, a heavy turn could claim the box between two steps and stop the build at its next).
# A build is live while the build lock is held, or the gate lock is held while a turn is on file, or while its turn was
# touched within the window (_kosmos_prepush_turn_window).
# The locks are judged by the kernel, never by anything read from a file: a lock file left by a finished or killed
# build is simply not held. The turn IS read from a file (its mtime), so it fails toward "no build": an empty or
# unreadable turn, one dated more than 60 s ahead, or one older than the window is no build, and a turn left by a build
# that died reads as live for at most the window.
# Held means held right now: `lockf -k -s -t 0 <file> true`, where exit 75 (EX_TEMPFAIL) is held, asked twice a moment
# apart (a probe, or another push answering "wait" in its turn loop, holds a lock for an instant too). -k leaves the
# file in place for anyone waiting on it, and the `[ -f ]` check first means asking never creates it. Any other answer
# (no file, no lockf, an error) is not held.
# A cut asks AFTER it claims the machine (release.sh). A build's next step reads that claim and stops (96), which ends
# its turn, so the cut's wait for a build between steps lasts until that next step starts, not for the whole gate.
# KOSMOS_PREPUSH_MACHINE_LOCK, KOSMOS_CUT_LOCKF_BIN, KOSMOS_PREPUSH_RECHECK_S and KOSMOS_PREPUSH_TURN_LIVE_S are this
# file's own seams. The gate lock and the turn are found beside KOSMOS_PREPUSH_MACHINE_LOCK, so one seam moves all three
# (run-tests.sh's /dev/null path makes all three unreadable).
_kosmos_prepush_lock_file() { printf '%s' "${KOSMOS_PREPUSH_MACHINE_LOCK:-${HOME:-/tmp}/.cache/prepush/machine.lock}"; }
# A lock seam with no folder in it gives the gate lock and the turn a folder that can never exist (as run-tests.sh's
# /dev/null seam does), so they read as no build: never the real box's folder, and never the caller's working directory.
_kosmos_prepush_dir() { local l; l="$(_kosmos_prepush_lock_file)"; case "$l" in */*) printf '%s' "${l%/*}" ;; *) printf '%s' /dev/null/kosmos-no-prepush-dir ;; esac; }
# The hook's longest step: KOSMOS_PREPUSH_MAX_STEP when it is set here (the name the hook reads on Mortals) and a whole
# number above 0 of at most seven digits, else the hook's default 2400 s. Bounds the gate lock below.
_kosmos_prepush_max_step() {
  case "${KOSMOS_PREPUSH_MAX_STEP:-}" in ''|*[!0-9]*|0*|????????*) printf '2400' ;; *) printf '%s' "$KOSMOS_PREPUSH_MAX_STEP" ;; esac
}
_kosmos_prepush_gate_lock_file() { printf '%s/prepush.gate.lock' "$(_kosmos_prepush_dir)"; }
_kosmos_prepush_turn_file() { printf '%s/prepush.gate.turn' "$(_kosmos_prepush_dir)"; }
# _kosmos_prepush_held <lock file>: 0 while a lockf holder holds it (asked twice, a moment apart).
_kosmos_prepush_held() {
  local f="$1" rc=0
  [ -f "$f" ] || return 1   # never create the hook's file by asking
  "${KOSMOS_CUT_LOCKF_BIN:-/usr/bin/lockf}" -k -s -t 0 "$f" true 2>/dev/null || rc=$?
  [ "$rc" = 75 ] || return 1
  # Held at that instant. A probe holds it that long too, so ask once more a moment later: a build holds it for longer.
  rc=0; sleep "${KOSMOS_PREPUSH_RECHECK_S:-0.3}"
  "${KOSMOS_CUT_LOCKF_BIN:-/usr/bin/lockf}" -k -s -t 0 "$f" true 2>/dev/null || rc=$?
  [ "$rc" = 75 ]
}
# The turn's window in seconds: KOSMOS_PREPUSH_TURN_LIVE_S when it is a whole number above 0; else the hook's own turn
# grace plus 60 when KOSMOS_PREPUSH_TURN_GRACE is set here (the hook reads that name on Mortals, so a grace raised in the
# environment both share moves this with it); else 180, the hook's default grace (120 s) plus 60. A grace raised only
# where the hook alone reads it still leaves this at 180: then a build idle between steps for longer reads as none.
_kosmos_prepush_turn_window() {
  # Seven digits at most (115 days): a longer number would overflow the shell's arithmetic and read as no build.
  case "${KOSMOS_PREPUSH_TURN_LIVE_S:-}" in ''|*[!0-9]*|0*|????????*) ;; *) printf '%s' "$KOSMOS_PREPUSH_TURN_LIVE_S"; return 0 ;; esac
  case "${KOSMOS_PREPUSH_TURN_GRACE:-}" in ''|*[!0-9]*|0*|????????*) printf '180' ;; *) printf '%s' "$(( KOSMOS_PREPUSH_TURN_GRACE + 60 ))" ;; esac
}
# _kosmos_prepush_holders <file>: "pid N: program" for up to three processes holding it open (lsof), for messages only
# (liveness is the lock). The program name only, never the command line (this goes to logs).
_kosmos_prepush_holders() {
  local holder="" p
  for p in $(/usr/sbin/lsof -n -P -t -- "$1" 2>/dev/null | head -3); do   # -n -P: no name lookups, on every poll
    holder="${holder:+$holder; }pid $p: $(basename "$(ps -o comm= -p "$p" 2>/dev/null)" 2>/dev/null || true)"
    case "$holder" in *": ") holder="${holder}gone" ;; esac   # it exited between lsof and ps
  done
  printf '%s' "$holder"
}
# The gate lock counts only while a turn exists (any age). A checkout writes its turn before touching the tree, so a
# step under the gate lock has one from then on; a queued push answering "wait" in its turn loop takes the gate lock for
# an instant too, and with a busy queue two such instants can fall 0.3 s apart. With no turn on file, that is no build.
# KNOWN GAP, narrowed: the checkout reads the machine claim (under the gate lock) before it writes its turn, and again
# just after (kosmos-relay#726). A heavy run that checks in the instant before the turn is on file reads no build, and if
# it claims after that second read the checkout goes on; its first cargo step stops with 96. Bounded at one checkout, not
# a build. A light queued-heavy run never asks here, so it can claim at any point; the same step stops the push.
# The turn's age bounds this too, by the longest step the hook allows plus the window: a step under the gate lock
# touches the turn when it ends, so a turn older than that is left by a build that died, and the waiters' instant holds
# next to it are no build either. The step limit is KOSMOS_PREPUSH_MAX_STEP when it is set here (the name the hook reads
# on Mortals), else the hook's default 2400 s; as for the grace, a limit raised only in the hook's own environment is
# not seen here.
_kosmos_prepush_gate_held() {
  _kosmos_prepush_turn_fresh $(( $(_kosmos_prepush_max_step) + $(_kosmos_prepush_turn_window) )) >/dev/null && _kosmos_prepush_held "$(_kosmos_prepush_gate_lock_file)"
}
# _kosmos_prepush_turn_fresh [window]: 0, printing the turn's age in seconds, while the turn was touched within the
# window (_kosmos_prepush_turn_window when none is given).
_kosmos_prepush_turn_fresh() {
  local f m now age lim="${1:-}"
  [ -n "$lim" ] || lim="$(_kosmos_prepush_turn_window)"
  f="$(_kosmos_prepush_turn_file)"
  [ -s "$f" ] || return 1   # no turn, or an empty one: no build holds it
  # macOS stat (where the hook runs); GNU stat's -f means something else, so it is asked only off macOS.
  if [ "$(uname -s 2>/dev/null)" = Darwin ]; then m="$(stat -f %m "$f" 2>/dev/null)"; else m="$(stat -c %Y "$f" 2>/dev/null)"; fi   # gnu-ok: stat -c runs only off macOS (the Darwin branch uses stat -f)
  case "$m" in ''|*[!0-9]*) return 1 ;; esac
  now="$(date +%s)"; age=$(( now - m ))
  [ "$age" -lt "$lim" ] || return 1
  [ "$age" -ge -60 ] || return 1   # a turn dated far ahead is not trusted to be live for ever
  printf '%s' "$age"
}
_kosmos_prepush_lock_held() { _kosmos_prepush_held "$(_kosmos_prepush_lock_file)"; }
# Accepted trade-off (the plan, .claude/plans/turnlive-7674.md): pushes that hand the turn straight to one another can
# hold a waiting heavy run until its queue bound, since it now gets in only between gates, not between steps.
kosmos_prepush_build_live() {
  _kosmos_prepush_lock_held && return 0
  _kosmos_prepush_gate_held && return 0
  _kosmos_prepush_turn_fresh >/dev/null
}
# kosmos_refuse_if_prepush_build_live <what> [override]: refuses (prints why on stderr, returns 1) while a relay pre-push
# build is live (a step under either lock, or between two steps), naming the holder for the person; callers wait on it
# with kosmos_wait_until_clear.
kosmos_refuse_if_prepush_build_live() {
  local what="${1:-this run}" override="${2:-}" f holder age
  if _kosmos_prepush_lock_held; then
    f="$(_kosmos_prepush_lock_file)"; holder="$(_kosmos_prepush_holders "$f")"
    echo "a relay pre-push build is running on this machine (${holder:-holder not readable}), holding $f for one long cargo step; $what would share the box with it. It ends on its own, and once the machine is claimed the hook starts no further step.${override:+ $override.}" >&2
    return 1
  fi
  if _kosmos_prepush_gate_held; then
    f="$(_kosmos_prepush_gate_lock_file)"; holder="$(_kosmos_prepush_holders "$f")"
    echo "a relay pre-push build is running a step on this machine (${holder:-holder not readable} has $f open; a queued push waiting on it shows there too), holding it for its checkout, or a step about to take the build lock; $what would share the box with it. It ends on its own, and once the machine is claimed the hook starts no further step.${override:+ $override.}" >&2
    return 1
  fi
  age="$(_kosmos_prepush_turn_fresh)" || return 0
  local win; win="$(_kosmos_prepush_turn_window)"
  [ "$age" -ge 0 ] || age=0   # a turn dated a little ahead (within the 60 s tolerance) was just used
  echo "a relay pre-push build is between two of its steps on this machine (its gate turn, $(_kosmos_prepush_turn_file), was used ${age}s ago); $what would start in that gap. Its next step starts soon, or stops at once if the machine is claimed; if the build went away, its turn lapses in $(( win - age ))s at most (window ${win}s).${override:+ $override.}" >&2
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
#   - queued-heavy.sh: a MAIN turn of either class waits for it (_qh_clear);
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
    # Round 18 (Sonnet): moved aside FIRST, then compared, so a claim moved in between the compare and the removal is
    # put back (never over a newer one, mv -n) rather than deleted.
    local aside="$f.stale.$$"
    if [ "$(cat "$f" 2>/dev/null)" = "$line" ] && mv -f "$f" "$aside" 2>/dev/null; then
      if [ "$(cat "$aside" 2>/dev/null)" = "$line" ]; then rm -f "$aside" 2>/dev/null; else mv -n "$aside" "$f" 2>/dev/null; rm -f "$aside" 2>/dev/null; fi
    fi
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
  raw="$(_kosmos_pgrep_cmdlines 'ms-playwright/' 2>/dev/null)"; rc=$?
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
#   3. the box HAS a heavy holder of THIS wrapper generation: a live machine claim labelled "queued run (not a cut)"
#      and not "[light]" (round 17: an older wrapper's label cannot say its class, so no side turn beside it). A bare
#      suite with no claim does not count (its age is not readable), and a free box is the main queue's business, so
#      the side turn never jumps a waiter for an idle box;
#   4. that claim is at least KOSMOS_SIDE_MIN_HOLD_S old (default 90 s): the load figure is a 1-minute average, so it
#      reads low for a holder that has only just started a build;
#   5. no cut, no install harness and no other browser run is live, and no Playwright browser is running (most one-off
#      checks run `node docs/browser-checks/x.js` directly, which the browser-run guard cannot see; two Playwright
#      runs competing for CPU is the hazard that guard names);
#   6. the 1-minute load is below half the cores (KOSMOS_SIDE_MAX_LOAD sets the line instead);
#   7. no SIDE-CAPABLE light waiter is ahead of this one (earlier queue time, then lower pid; marker line 6), so light
#      runs keep their order;
#   8. no queued-heavy.sh older than #4911 is waiting (it would take a main turn without asking about a side turn).
# The take (kosmos_light_side_take) also records the holder this check validated (KOSMOS_SIDE_SEEN_HOLDER).
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
    # Round 17 (Sonnet): only a holder from THIS wrapper generation, whose label says its class. An older queued-heavy.sh
    # labels every turn "release (not a cut) queued one-off", light ones included, so its light turn read as a heavy
    # holder and a side turn joined it: two light runs at once. Unknown class, no side turn (the cost is none beside an
    # older wrapper during the rollout).
    case "$label" in "queued run (not a cut)"*) ;; *) echo "the box is held by a run whose class cannot be read ($label); no side turn beside it." >&2; return 1 ;; esac
    case "$label" in *"[light]"*) echo "the box is held by a light run ($label); never two light runs at once." >&2; return 1 ;; esac
    KOSMOS_SIDE_SEEN_HOLDER="$cookie"   # round 18: the holder THIS check validated (the take records exactly this one)
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
  KOSMOS_SIDE_SEEN_HOLDER=""
  if ! kosmos_light_side_clear "$what" >/dev/null 2>&1; then kosmos_release_light_side; unset KOSMOS_LIGHT_SIDE_COOKIE; return 1; fi
  # Round 18 (Sonnet): the holder recorded is the one the re-check validated, and it must still hold the box now. A
  # separate read could come back empty (the intruder's cookie test then never fires) or name a claim that replaced the
  # holder in between (which then never reads as an intruder). Either way, no side turn.
  local seen="${KOSMOS_SIDE_SEEN_HOLDER:-}" now_holder
  now_holder="$(_kosmos_machine_claim_active | awk '{print $1}')"
  if [ -z "$seen" ] || [ "$now_holder" != "$seen" ]; then kosmos_release_light_side; unset KOSMOS_LIGHT_SIDE_COOKIE; return 1; fi
  kosmos_unmark_suite_waiting
  # Round 17 (Opus): the holder this side turn runs beside, by its claim's cookie. The intruder yields when ANOTHER
  # claim takes the box: an older queued-heavy.sh that found the queue empty never writes a waiter marker, so the
  # marker checks cannot see it, but its claim can be seen. Kept in the run's environment (the capper inherits it).
  KOSMOS_SIDE_HOLDER_COOKIE="$seen"; export KOSMOS_SIDE_HOLDER_COOKIE
  return 0
}

# kosmos_holds_light_side: true only when THIS run (or a child carrying its cookie) holds the live side claim.
# run-tests.sh asks it: a side turn runs its tests directly; through run-tests.sh it would queue behind the heavy
# holder's claim while holding the side claim (review 2), and a --only run (#4929) would be refused by that claim, so
# run-tests.sh refuses at once inside a side turn, --only included.
kosmos_holds_light_side() {
  local active self="${KOSMOS_LIGHT_SIDE_COOKIE:-}"
  [ -n "$self" ] || return 1
  active="$(_kosmos_light_side_active)"
  [ -n "$active" ] && [ "$(printf '%s' "$active" | awk '{print $1}')" = "$self" ]
}

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

# kosmos#9139: a run that goes BESIDE a queued holder on purpose (relay CI past its wait cap on Mortals) says so here,
# so the holder's red summary in run-tests.sh can name it: a red in that window then reads as contention at once, not
# as the change (PigeonPete, 11-26). One line per event in <marker dir>/beside-runs.log:
#   S <id> <epoch> <what>     when it starts beside a holder
#   E <id> <epoch>            when it ends
# kosmos_note_beside_run start <id> <what> | end <id>. Best-effort: a line it cannot write changes nothing else, and it
# returns 0 even under `set -e` (review 4: GitHub Actions runs steps as bash -eo pipefail, and a failed mkdir or rmdir
# here ended the CI step). The writer's id should be unique per attempt (a CI run id with its attempt number): a new
# start line for an id replaces its earlier window, but only one at least as new as the current start (lines folded in
# from pending files arrive out of order). Spaces
# and tabs in <id> become "_" (an id is one field). Review 1: every append and the trim happen under one mkdir lock, so
# a rename cannot drop a line appended meanwhile. Review 2: the hold is short (the time is read before the lock, and the
# file is trimmed only past 500 lines, back to 400 plus the partners of the ids kept (at most two lines each; a log
# whose tail is 400 different ids can stay past 500 for a few hundred appends, each a rewrite of milliseconds); a writer waits up to about 10 s;
# a lock is broken only when its holder is gone, or past 300 s, or with no pid yet past 10 s (see _kosmos_beside_stale). A
# writer that still has not got it writes a pending file instead (#9139 follow-up, below) and skips the trim; it falls
# back to an unlocked append only if mktemp fails (a lost line costs less than a CI step that waits).
# Review 3: GNU stat first. GNU `stat -f` means "file system": it prints lines of text and THEN fails, so a BSD-first
# fallback fed text into the arithmetic and bash dropped the whole call on Linux (as launchagent-leak-guard.sh:27
# already orders it; BSD stat rejects -c at once). A stale lock is broken in place by one breaker at a time (the
# "$d.break" lock), only while it still names the holder judged dead. Remaining limit: a holder stopped for over 300 s
# (SIGSTOP, a sleeping Mac) is broken by the ceiling; its release then removes nothing (it checks its own pid). A
# marker dir that cannot be written gives up at once instead of spinning.
_kosmos_beside_mtime() { local m; m="$(stat -c %Y "$1" 2>/dev/null)" || m="$(stat -f %m "$1" 2>/dev/null)" || m=""; case "$m" in ''|*[!0-9]*) date +%s ;; *) printf '%s' "$m" ;; esac; }
# kosmos#9139 follow-up: the lock names its HOLDER (the real pid of the shell that took it: $$ is the parent's pid in a
# ( ) & subshell, so it is read with sh -c 'echo $PPID'). It is broken only when that pid is gone. Before, a lock older
# than 10 s was broken whoever held it, so a live holder slowed past 10 s (a loaded CI runner, or a clock step) had a
# second holder beside it, and two trims at once cut the log short (CI, Ubuntu, 11-26: 188 lines). A live holder is
# never broken now: the others give up and write pending files, which nothing loses. A lock with no pid yet (taken a
# moment ago, or by an older lib) keeps the 10 s age rule. An older lib breaking a lock of this one leaves its
# .stale.* dir behind (its plain rmdir cannot remove the pid file); nothing reads those names.
# Review: with a pid, also an age CEILING of 300 s (a real hold lasts milliseconds), so a pid that was reused by an
# unrelated process, or a stopped holder, cannot hold the lock for ever; a pid of 0 or 1 is never a holder. Review 7: a
# lock with NO pid has the same 300 s ceiling (it was 10 s, and a holder slowed past 10 s between its mkdir and its pid
# write, a fork on a loaded runner, was broken while alive). A writer killed in that gap holds up folding for 300 s and
# loses no line: the others write pending files, which the reader reads.
_kosmos_beside_stale() {   # _kosmos_beside_stale <lock dir>: 0 when it may be broken
  _kosmos_beside_stale_h "$1" "$(cat "$1/pid" 2>/dev/null)"
}
# Review 6: the same judgement of a pid value read ONCE by the caller, so the value judged is the value compared.
_kosmos_beside_stale_h() {   # _kosmos_beside_stale_h <lock dir> <pid as read>
  local h="$2" age; age=$(( $(date +%s) - $(_kosmos_beside_mtime "$1") ))
  case "$h" in
    ''|*[!0-9]*) [ "$age" -gt 300 ] ;;   # review 7: no pid is the same 300 s ceiling (was 10 s; see above)
    0|1) return 0 ;;
    *) [ "$age" -gt 300 ] || ! kill -0 "$h" 2>/dev/null ;;
  esac
}
# Review (two holders): breakers are SERIALIZED by a small "$d.break" lock, and under it the lock is judged again and
# removed IN PLACE only if it still names the same dead holder. Before, a breaker judged holder A, A released, B took
# the lock, and B's live lock was moved aside and deleted: two holders. A break lock left by a killed breaker goes after
# 60 s. The pid written here is kept in _KOSMOS_BESIDE_OWN for the release's own check.
# Review 6 (two holders again): the pid is read ONCE under the break lock, that value is judged, and the lock is broken
# only if a second read still gives it. An EMPTY value names no lock (every lock just made has none yet): it is broken
# only if the dir is still over 300 s old when judged again AFTER the second read. Before, an empty first read, a lock
# that changed hands twice, and an empty second read broke a live holder's lock (reviewer's interleaving, reproduced).
# A dead holder cannot release, so after the second read only another breaker could change the lock, and breakers are
# serialized. The break lock is taken over only past 60 s; a breaker stopped longer than that is the stated limit.
# Review 7: the break lock holds a file named by its taker's TOKEN. A waiter that takes over an old break lock first
# notes the name in it, then judges the age, and removes only that name, then rmdir: a fresh break lock taken meanwhile
# holds another name, so its rmdir fails. A taker whose token write fails (its fresh dir was removed in the moment
# before) does not break anything. Review 8: that dir can be removed AND made again by a third taker, so two tokens can
# land in one dir: a taker breaks only if its token is the ONLY entry; otherwise it removes its own and backs off.
_kosmos_beside_break_mine() {   # <break dir> <token>: 0 when the token is the dir's only entry
  local e n=0
  for e in "$1"/*; do [ -e "$e" ] && n=$((n + 1)); done
  [ "$n" = 1 ] && [ -e "$1/$2" ]
}
_kosmos_beside_lock() {
  local d="$1" i=0 h1 tk t1
  [ -w "${d%/*}" ] || return 1
  until mkdir "$d" 2>/dev/null; do
    i=$((i + 1)); [ "$i" -ge "${KOSMOS_BESIDE_LOCK_TRIES:-100}" ] && return 1   # a count, not a time: under load it is reached
    if _kosmos_beside_stale "$d"; then
      if mkdir "$d.break" 2>/dev/null; then
        tk="$$.$RANDOM$RANDOM"
        if { : > "$d.break/$tk"; } 2>/dev/null && ! _kosmos_beside_break_mine "$d.break" "$tk"; then
          rm -f "$d.break/$tk" 2>/dev/null || true   # review 8: another taker wrote into this dir too: both back off
          # kosmos#9300: and the last one out removes the dir. rmdir takes only an EMPTY dir, so while the other taker's
          # token is there this does nothing, and that taker removes it. Without it the empty dir stayed, and no writer
          # could break a stale lock for 60 s. A taker killed holding its token still leaves the dir to that 60 s path.
          rmdir "$d.break" 2>/dev/null || true
        elif [ -e "$d.break/$tk" ]; then
          h1="$(cat "$d/pid" 2>/dev/null)"
          if _kosmos_beside_stale_h "$d" "$h1" && [ "$(cat "$d/pid" 2>/dev/null)" = "$h1" ] \
            && { [ -n "$h1" ] || _kosmos_beside_stale_h "$d" ""; }; then
            rm -f "$d/pid" 2>/dev/null; rmdir "$d" 2>/dev/null || true
            rm -f "$d.break/$tk" 2>/dev/null; rmdir "$d.break" 2>/dev/null || true
            continue
          fi
          rm -f "$d.break/$tk" 2>/dev/null; rmdir "$d.break" 2>/dev/null || true   # declined: on to the sleep
        else
          rmdir "$d.break" 2>/dev/null || true   # kosmos#9300: the token could not be written, so its own empty dir goes too
        fi
      else
        t1=""; for t1 in "$d.break"/*; do break; done   # the name seen BEFORE the age is judged
        if [ $(( $(date +%s) - $(_kosmos_beside_mtime "$d.break") )) -gt 60 ]; then
          [ -n "$t1" ] && [ -e "$t1" ] && { rm -f "$t1" 2>/dev/null || true; }
          rmdir "$d.break" 2>/dev/null || true
        fi
      fi
    fi
    sleep 0.1
  done
  # Not $(sh -c 'echo $PPID'): inside a substitution its parent is the substitution's own short-lived subshell, so the
  # lock named a pid that was already gone and the next writer broke a live lock (measured: a lost line). Write, then read back.
  { sh -c 'echo $PPID' > "$d/pid"; } 2>/dev/null || true
  _KOSMOS_BESIDE_OWN="$(cat "$d/pid" 2>/dev/null)"
  return 0
}
_kosmos_beside_unlock() {   # _kosmos_beside_unlock <lock dir>: removes it only while it carries this writer's pid
  if [ -n "${_KOSMOS_BESIDE_OWN:-}" ] && [ "$(cat "$1/pid" 2>/dev/null)" = "$_KOSMOS_BESIDE_OWN" ]; then
    rm -f "$1/pid" 2>/dev/null || true; rmdir "$1" 2>/dev/null || true
  fi
  return 0
}
kosmos_note_beside_run() {
  local f l id got=0 now; f="$(_kosmos_marker_dir)/beside-runs.log"; l="$f.lock"; now="$(date +%s)"
  # Review 5: a misspelled verb warns and returns 0 too (a set -e CI step must not die on a typo), before touching the dir.
  case "${1:-}" in start|end) ;; *) echo "kosmos_note_beside_run: unknown verb '${1:-}' (start or end); nothing noted" >&2; return 0 ;; esac
  mkdir -p "$(_kosmos_marker_dir)" 2>/dev/null || true
  local what; what="$(printf '%s' "${3:-}" | tr '\n\r' '  ')"   # review 3: one record is one line
  id="$(printf '%s' "${2:-unnamed}" | tr ' \t\n\r' '____')"; [ -n "$id" ] || id=unnamed   # review 5: no -s (it squeezed "_" too)
  _kosmos_beside_lock "$l" && got=1
  # #9139 follow-up: a writer that could not get the lock (100 lost polls: reached under CI load, with 20 writers) used
  # to append to the log anyway, and a trim's rename running at that moment lost the line (CI, 11-26 19:06 UTC: 299 of
  # 300). It writes to a pending file of its own instead, which no trim touches; readers read the pending files too,
  # and the next writer that holds the lock folds them into the log.
  # A pending file is written under a temporary name and renamed into place, so a writer folding it never reads one
  # half-made (it would remove it with the line still to come).
  # The name from mktemp, not $$.$RANDOM: $$ is the PARENT's pid in a ( ) & subshell, so twenty writer subshells shared
  # it, and two could choose the same name and the second mv overwrote the first's line (299 of 300, measured).
  local out="$f"; [ "$got" = 1 ] || out="$(mktemp "$f.pending-tmp.XXXXXXXX" 2>/dev/null)" || out="$f"
  # Review 4: the redirect inside a group, so a file that cannot be opened is silent and, under set -e, not fatal.
  if [ "$1" = start ]; then { printf 'S %s %s %s\n' "$id" "$now" "$what" >> "$out"; } 2>/dev/null || true
  else { printf 'E %s %s\n' "$id" "$now" >> "$out"; } 2>/dev/null || true; fi
  # The pending name keeps mktemp's unique suffix, and mv -n never replaces another writer's file.
  # Review 3: every step || true: a fold that took this temp file first (it is past 60 s on a stalled writer) made mv
  # fail, and under the caller's errexit that ended the caller. The line is in the log already then.
  [ "$out" = "$f" ] || { mv -n "$out" "$f.pending.${out##*pending-tmp.}" 2>/dev/null || true; [ -e "$out" ] && { { cat "$out" >> "$f"; rm -f "$out"; } 2>/dev/null || true; }; true; }
  if [ "$got" = 1 ]; then
    local pf
    # Each pending file is CLAIMED by a rename to a name of this fold's own before it is read, so if two folds ever run
    # at once (a stress run once counted a line twice: a file folded by two), only one takes it. A fold killed between
    # its claim and its read leaves a .folding. file, folded below once it is 60 s old.
    for pf in "$f".pending.*; do
      [ -f "$pf" ] || continue
      local cf="$f.folding.${pf##*.pending.}"
      mv "$pf" "$cf" 2>/dev/null || continue
      touch "$cf" 2>/dev/null || true   # review: mv keeps the mtime, so an old claim read as 60 s old and was folded twice
      { cat "$cf" >> "$f"; } 2>/dev/null && { rm -f "$cf" 2>/dev/null || true; }
    done
    # Review 2: a writer killed between its mktemp and its rename leaves a pending-tmp file nothing reads. Past 60 s its
    # writer is gone (a write is one printf), so it is folded too.
    for pf in "$f".pending-tmp.* "$f".folding.*; do
      [ -f "$pf" ] || continue
      [ $(( $(date +%s) - $(_kosmos_beside_mtime "$pf") )) -gt 60 ] || continue
      { cat "$pf" >> "$f"; } 2>/dev/null && { rm -f "$pf" 2>/dev/null || true; }
    done
  fi
  if [ "$got" = 1 ] && [ "$(wc -l < "$f" 2>/dev/null | tr -d ' ')" -gt 500 ] 2>/dev/null; then
    # Review 3: the last 400 lines and, for an id among them, its partner from earlier, so a start and its end are never
    # split at the cut (a fold can put an end above its start, and the kept start then read as still going). Review 4:
    # only that id's newest start and largest end are kept from before the cut (every line of a repeated id grew the
    # log without limit), and an empty id is never a partner.
    # Review 5: a line the reader skips (not a number, or more than a day ahead) is never chosen as a partner here.
    # #9139 follow-up (CI, 11-26 16:4x CST, Ubuntu: 188 lines left, all of them writers'): the temp file was named
    # "$f.tmp.$$", and $$ is the PARENT's pid in a ( ) & subshell, so writers shared one name and two trims at once (a
    # stale-lock break under load) wrote it together. It is a mktemp name now, and a trim installs its result only if it
    # kept at least the 400 lines a trim past 500 always keeps (a short file means the trim went wrong: keep the log).
    local tf; tf="$(mktemp "$f.trim.XXXXXXXX" 2>/dev/null)" || tf="$f.trim.$$.$RANDOM"
    { awk -v keep=400 -v now="$now" 'NR == FNR { n = FNR; ln[FNR] = $2; ok = ($3 ~ /^[0-9]+$/ && $3 + 0 <= now + 86400)
           if (ok && $1 == "S" && (!($2 in bs) || $3 + 0 >= bsv[$2])) { bs[$2] = FNR; bsv[$2] = $3 + 0 }
           if (ok && $1 == "E" && (!($2 in be) || $3 + 0 > bev[$2])) { be[$2] = FNR; bev[$2] = $3 + 0 }
           next }
         FNR == 1 { for (i = n - keep + 1; i <= n; i++) if (i > 0 && ln[i] != "") ids[ln[i]] = 1 }
         FNR > n - keep || (($2 in ids) && (FNR == bs[$2] || FNR == be[$2])) { print }' "$f" "$f" > "$tf"; } 2>/dev/null \
      && [ "$(wc -l < "$tf" 2>/dev/null | tr -d ' ')" -ge 400 ] 2>/dev/null && { mv -f "$tf" "$f" 2>/dev/null || true; }   # review: never ends an errexit caller
    rm -f "$tf" 2>/dev/null || true
  fi
  # Review: only a lock that still carries this writer's own pid (a ceiling break may have given it to another).
  [ "$got" = 1 ] && _kosmos_beside_unlock "$l"
  return 0
}
# kosmos_beside_runs_since <epoch>: one line for each run noted above whose window overlaps <epoch> to now, as
# "<what> (<id>), from MM-DD HH:MM:SS to MM-DD HH:MM:SS" or "... to still going". Review 1: a run with no end line counts
# as still going only for KOSMOS_BESIDE_OPEN_MAX_S (default 7200 s, past relay CI's job limits): a job cancelled or killed
# before its end line would otherwise read as still going forever. It is a bound measured from now: such a job reads
# as still going for up to that long, and a run noted beside a suite that itself runs longer than it is dropped. A new start line for an id clears its old end. A
# line whose epoch is not a number is skipped. The date is printed with the time, so an older run cannot read as today.
kosmos_beside_runs_since() {
  local f t0="${1:-0}" now omax what id st en sr er; f="$(_kosmos_marker_dir)/beside-runs.log"; now="$(date +%s)"
  # Review 1: pending lines count while the log does not exist yet too.
  [ -r "$f" ] || ls "$f".pending.* >/dev/null 2>&1 || ls "$f".folding.* >/dev/null 2>&1 || return 0   # each alone: ls fails if ANY argument is missing
  case "$t0" in ''|*[!0-9]*) t0=0 ;; esac
  omax="${KOSMOS_BESIDE_OPEN_MAX_S:-7200}"; case "$omax" in ''|*[!0-9]*) omax=7200 ;; esac
  # awk picks the overlapping runs (tab-separated: what, id, start, end or "-"); the times are formatted below, since
  # macOS awk has no strftime (date -d @ first, which fails at once on macOS, then date -r).
  # #9139 follow-up: the pending files too, through cat (an unmatched glob stays literal, and macOS awk stops at a file
  # it cannot open; cat goes on past it).
  # Review 1: grouped with || true: cat of an unmatched glob exits 1, and under set -eo pipefail that ended the caller.
  # Review 4: the pending files FIRST: a fold appends to the log before it removes a pending file, so a line FOLDED
  # during this read is still in a file cat has not read yet. Not seen, in either order: a pending file made after
  # the glob was expanded (the next read sees it).
  # A line being folded is in a .folding. file for a moment: read those too (read twice is harmless: newest start,
  # largest end per id).
  # Review: three reads in turn, each glob expanded after the one before was read (one cat expanded both first, so a
  # claim between the expansion and the read hid the line).
  { { cat "$f".pending.* 2>/dev/null || true; }; { cat "$f".folding.* 2>/dev/null || true; }; { cat "$f" 2>/dev/null || true; }; } | awk -v t0="$t0" -v now="$now" -v omax="$omax" '
    # Review 3: ORDER-INDEPENDENT (folded lines arrive in any order): the newest start and the largest end per id; a run
    # has ended only if that end is at or after that start. Epochs more than a day ahead are malformed and skipped.
    ($1 == "S" || $1 == "E") && ($3 !~ /^[0-9]+$/ || $3 + 0 > now + 86400) { next }
    $1 == "S" && (!($2 in s) || $3 + 0 >= s[$2]) { id = $2; s[id] = $3 + 0; w = ""; for (i = 4; i <= NF; i++) w = w (w == "" ? "" : " ") $i; what[id] = w; if (!(id in on)) { on[id] = 1; order[++n] = id } }
    $1 == "E" && (!($2 in e) || $3 + 0 > e[$2]) { e[$2] = $3 + 0 }
    END { for (k = 1; k <= n; k++) { id = order[k]
            if ((id in e) && e[id] < s[id]) delete e[id]   # the largest end is older than the newest start: still open
            if (s[id] > now) continue
            if (id in e) { if (e[id] < t0) continue }
            else if (now - s[id] > omax + 0) continue
            printf "%s\t%s\t%s\t%s\n", (what[id] == "" ? "a run" : what[id]), id, s[id], ((id in e) ? e[id] : "-") } }' 2>/dev/null |
  while IFS="$(printf '\t')" read -r what id st en; do
    # Review 3: never ends an errexit caller. Review 4: the raw epoch is kept apart (the assignment emptied it first).
    sr="$st"; st="$(date -d "@$sr" '+%m-%d %H:%M:%S' 2>/dev/null || date -r "$sr" '+%m-%d %H:%M:%S' 2>/dev/null)" || st="epoch $sr"
    if [ "$en" = - ]; then en="still going"; else er="$en"; en="$(date -d "@$er" '+%m-%d %H:%M:%S' 2>/dev/null || date -r "$er" '+%m-%d %H:%M:%S' 2>/dev/null)" || en="epoch $er"; fi
    printf '%s (%s), from %s to %s\n' "$what" "$id" "$st" "$en"
  done
  return 0
}

# kosmos_light_side_intruder <root pid>: 0 (and why, on stdout) when the side turn should YIELD; 1 to stay. queued-heavy.sh
# asks it every few seconds through a side turn and stops its command when it says yes. Yields on: an older
# queued-heavy.sh's waiter (round 16); a machine claim other than the holder the take recorded (round 17: an older
# wrapper that found the queue empty marks nothing); a cut; an install harness (review 6); a browser run that is not the
# side command's own (root pid and its descendants); a Playwright browser that is not its own (review 5). The start
# gate cannot see what starts AFTER the side turn did; yielding protects the holder whatever it runs, and the light run
# takes the red, which is the side turn's bargain. Same probes as the start gate (KOSMOS_BC_PROBE, KOSMOS_PW_PROBE), plus
# the run markers. A probe that cannot answer is an intruder (the safe side: the light run stops).
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
    lines="$(kosmos_running_lines tools/browser-checks.sh)"; rc=$?; [ "$rc" -le 1 ] && rc=0   # #5470: the shared anchored match
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
