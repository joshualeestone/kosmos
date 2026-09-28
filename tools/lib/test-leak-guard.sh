# shellcheck shell=bash
# test-leak-guard.sh (kosmos#4273): what a test suite leaves behind, checked by
# tools/run-tests.sh (leak_guard_after_suite) after the suite and before its per-run
# temp root is removed.
#
# THREE KINDS OF LEAK, measured 2026-09-27 on Agent1s:
#   1. A LAUNCHD JOB. A test bootstrapped `com.kosmos.agent.josh` from a plist in a
#      temp dir and never booted it out; after the dir was gone it respawned 8,096
#      times with exit 1 until a person noticed.
#   2. A PROCESS. A server or helper started by a test outlives it.
#   3. TEMP ENTRIES. $TMPDIR held 128,442 entries, 9,325 of them from the last day.
#
# EACH CHECK IS SCOPED TO THIS RUN'S TEMP ROOT, so a suite running beside another
# one (another checkout, another agent) never blames the other's leftovers or kills
# the other's processes: a job whose plist lives under THIS root, an ORPHANED
# process whose command line names THIS root, an entry INSIDE it.
#
# ⚠️ WHAT IT DOES NOT SEE: a job or process that never touched the run's temp root
# (a load generator started with no fixture path, a job bootstrapped from a plist
# outside it), a process that names the root only in its ENVIRONMENT (macOS ps cannot
# read it), a leaked process still parented by something alive, and anything
# a test file makes when it is run directly, outside run-tests.sh
# (test-support/tmpscope.js is the fix for that one). An INTERRUPTED run
# (Ctrl-C, a timeout) never reaches leak_guard_after_suite: run-tests.sh's exit
# trap runs only the launchd check then, and no process or temp check.
#
# A NEW TEMP PREFIX WITH NO SEPARATOR before its random part (`fixtureAbC123`; none today) is
# recognised only when that part mixes letters with digits or cases, so about 1 run in
# 90 keeps it and reports a new family. Give such a prefix a separator, or allowlist it
# as a glob (`fixture*`), as `aoc-state.*.polls` is for a random part mid-name.
#
# The check functions print what they found to stdout and return 1 when they found
# something, 0 when clean. They never exit, and never fail on a missing tool.

# Every loaded launchd label for this user, one per line, sorted.
leak_labels_snapshot() {
  launchctl list 2>/dev/null | awk 'NR > 1 && NF >= 3 { print $3 }' | LC_ALL=C sort -u
}

# leak_launchd_check <before-file> <root>: a label loaded since <before-file> whose
# plist lives under <root> is this run's leak. It is booted out (it would otherwise
# respawn against a directory about to be removed) and printed.
# launchd records a plist's RESOLVED path, and on macOS the temp root is reached
# through the /var -> /private/var symlink, so both spellings of the root are matched.
leak_launchd_check() {
  local before="$1" root="${2%/}" real uid label plist found=0
  [ -n "$root" ] && [ -f "$before" ] || return 0
  real=$(cd "$root" 2>/dev/null && pwd -P) || real="$root"
  uid=$(id -u)
  while IFS= read -r label; do
    [ -n "$label" ] || continue
    plist=$(launchctl print "gui/$uid/$label" 2>/dev/null | awk -F' = ' '/^[[:space:]]+path = / { print $2; exit }')
    case "$plist" in
      "$root"/*|"$real"/*)
        launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
        echo "launchd job $label (plist $plist): booted out"
        found=1 ;;
    esac
  done < <(leak_labels_snapshot | LC_ALL=C comm -13 "$before" -)
  return "$found"
}

# leak_process_check <root>: an ORPHANED process (parent pid 1: whatever started it
# has exited) whose command line names <root> outlived the suite. It
# is sent TERM, then KILL if it is still there, and printed. Orphaned only: a process
# something alive still owns (an operator's `tail -f` on a log in the root, another
# suite's child) is never touched.
leak_process_check() {
  local root="${1%/}" real found=0 line pid ppid cmd snap
  [ -n "$root" ] || return 0
  real=$(cd "$root" 2>/dev/null && pwd -P) || real="$root"
  # Snapshot FIRST, filter after (a `ps | grep root` pipeline lists the grep itself).
  # -A: EVERY process. Without it ps lists only processes with a controlling terminal,
  # and an orphaned daemon has none, so the leaks this exists for were invisible
  # (measured). -ww stops long command lines being cut. The ENVIRONMENT is not
  # readable: `ps -E` shows none on macOS 26.7, even for this user's own processes
  # (measured), so a child that names the root only in its TMPDIR is not seen.
  snap=$(ps -Awwo pid=,ppid=,command= 2>/dev/null)
  while IFS= read -r line; do
    # `read`, not `set -- $line`: the latter would also glob-expand a `*` in a command.
    read -r pid ppid cmd <<< "$line"
    case "$pid$ppid" in ''|*[!0-9]*) continue ;; esac
    [ "$ppid" = "1" ] || continue
    case "$line" in *"$root/"*|*"$real/"*|*"=$root "*|*"=$real "*|*"=$root"|*"=$real"|*" $root "*|*" $real "*|*" $root"|*" $real") ;; *) continue ;; esac
    kill -TERM "$pid" 2>/dev/null || continue
    echo "process $pid: ${cmd%% *}"
    found=1
  done <<< "$snap"
  if [ "$found" -eq 1 ]; then
    # Three seconds for a load-starved process to finish its own cleanup, then KILL.
    sleep 3
    snap=$(ps -Awwo pid=,ppid=,command= 2>/dev/null)
    while IFS= read -r line; do
      read -r pid ppid cmd <<< "$line"
      [ "$ppid" = "1" ] || continue
      case "$line" in *"$root/"*|*"$real/"*|*"=$root "*|*"=$real "*|*"=$root"|*"=$real"|*" $root "*|*" $real "*|*" $root"|*" $real") kill -KILL "$pid" 2>/dev/null || true ;; esac
    done <<< "$snap"
  fi
  return "$found"
}

# The family name of a temp entry, so every run of one test maps to one name:
#  - the random tail: the last token if it is 6 (node mkdtemp) or 10 (macOS mktemp)
#    characters after a separator, otherwise the last 6 characters (a mkdtemp prefix
#    with no separator, `avatarverAbC123` -> `avatarver`);
#  - a random token INSIDE the name (`aoc-state.0LbKWm.polls` -> `aoc-state.polls`):
#    exactly 6 or 10 characters mixing letters with digits or upper with lower case;
#  - a digit-only token (a pid: `kosmos-flags-32868.txt` -> `kosmos-flags.txt`) and a
#    run of 10+ digits (a millisecond timestamp: `yarn--1790560282614-0` -> `yarn`).
# A name that normalises to nothing is reported as `(unnamed)`, never skipped.
leak_family() {
  printf '%s\n' "$1" | awk '
    function random(t) {
      if (length(t) != 6 && length(t) != 10) return 0
      return (t ~ /[0-9]/ && t ~ /[A-Za-z]/) || (t ~ /[a-z]/ && t ~ /[A-Z]/)
    }
    {
      s = $0
      # The TRAILING 6/10-character token after a separator is always the random tail,
      # whatever its case mix (an all-lowercase tail is still random). With no separator,
      # the last 6 go only when they look random, so a real name (`readme`) is kept.
      if (match(s, /[-_.][A-Za-z0-9]+$/) && (RLENGTH == 7 || RLENGTH == 11)) s = substr(s, 1, RSTART)
      else if (s ~ /[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]$/ && length(s) > 6 && random(substr(s, length(s) - 5))) s = substr(s, 1, length(s) - 6)
      gsub(/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]+/, "", s)
      out = ""
      while (match(s, /[-_.]/)) {
        tok = substr(s, 1, RSTART - 1); sep = substr(s, RSTART, 1); s = substr(s, RSTART + 1)
        # A dropped token takes its separator with it: the NEXT separator replaces the
        # one before it, so `flags-32868.txt` reads `flags.txt`.
        if (random(tok) || tok ~ /^[0-9]+$/) { if (out ~ /[-_.]$/) out = substr(out, 1, length(out) - 1) sep; continue }
        out = out tok sep
      }
      if (!random(s) && s !~ /^[0-9]+$/) out = out s
      gsub(/[-_.]+$/, "", out); gsub(/^[-_.]+/, "", out); gsub(/[-_]+\./, ".", out)
      print (out == "" ? "(unnamed)" : out)
    }'
}

# leak_tmp_check <root> <allowlist>: the families of entries left inside <root> that
# no allowlist line matches. A line is a family name or a shell glob
# (`aoc-state.*.polls`); `#` starts a comment. Allowlisted families that left nothing
# are counted on one closing line (so the list can shrink without burying a failure).
leak_tmp_check() {
  local root="${1%/}" allow="$2" found=0 n fam pat ok left allowed unused=0 line
  [ -d "$root" ] || return 0
  # One line per family: count, family, TAB, one raw name (so a report says what to fix).
  local ex
  left=$(find "$root" -mindepth 1 -maxdepth 1 2>/dev/null | while IFS= read -r p; do printf '%s\t%s\n' "$(leak_family "${p##*/}")" "${p##*/}"; done \
    | LC_ALL=C sort | awk -F '\t' '{ n[$1]++; if (!($1 in e)) e[$1] = $2 } END { for (f in n) print n[f] " " f "\t" e[f] }')
  allowed=""
  [ -f "$allow" ] && allowed=$(sed 's/#.*//; s/[[:space:]]*$//; s/^[[:space:]]*//' "$allow" | grep -v '^$' | LC_ALL=C sort -u)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    ex=${line##*$'\t'}; line=${line%$'\t'*}; n=${line%% *}; fam=${line#* }
    ok=0
    while IFS= read -r pat; do
      [ -n "$pat" ] || continue
      # shellcheck disable=SC2254  # the pattern is a glob on purpose
      case "$fam" in $pat) ok=1; break ;; esac
    done <<< "$allowed"
    if [ "$ok" -eq 0 ]; then echo "temp: $n x $fam (not on the allowlist; e.g. $ex)"; found=1; fi
  done <<< "$left"
  while IFS= read -r pat; do
    [ -n "$pat" ] || continue
    ok=0
    while IFS= read -r line; do
      line=${line%$'\t'*}; fam=${line#* }
      # shellcheck disable=SC2254
      case "$fam" in $pat) ok=1; break ;; esac
    done <<< "$left"
    [ "$ok" -eq 0 ] && unused=$((unused + 1))
  done <<< "$allowed"
  [ "$unused" -gt 0 ] && echo "note: $unused allowlisted families left nothing this run; remove any that no longer leak from $(basename "$allow")"
  return "$found"
}

# leak_guard_after_suite <labels-before-file> <root> <allowlist>: all three checks,
# each run whatever the others found, their findings on stdout. Returns 1 if any found
# a leak. A missing labels file skips only the launchd check. The labels file is
# removed once used: it usually lives inside <root>, and the temp check must not count
# the guard's own file as a leak.
leak_guard_after_suite() {
  local before="$1" root="$2" allow="$3" bad=0
  if [ -n "$before" ] && [ -f "$before" ]; then
    leak_launchd_check "$before" "$root" || bad=1
    rm -f "$before"
  fi
  leak_process_check "$root" || bad=1
  leak_tmp_check "$root" "$allow" || bad=1
  return "$bad"
}
