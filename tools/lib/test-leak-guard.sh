# shellcheck shell=bash
# test-leak-guard.sh (kosmos#4273): what a test suite leaves behind, checked by
# tools/run-tests.sh after the suite and before its per-run temp root is removed.
#
# THREE KINDS OF LEAK, measured 2026-09-27 on Agent1s:
#   1. A LAUNCHD JOB. A test bootstrapped `com.kosmos.agent.josh` from a plist in a
#      temp dir and never booted it out; after the dir was gone it respawned 8,096
#      times with exit 1 until a person noticed.
#   2. A PROCESS. A server or helper started from a fixture dir outlives its test.
#   3. TEMP ENTRIES. $TMPDIR held 128,442 entries, 9,325 of them from the last day.
#
# EACH CHECK IS SCOPED TO THIS RUN'S TEMP ROOT, so a suite running beside another
# one (another checkout, another agent) never blames the other's leftovers or kills
# the other's processes: a job whose plist lives under THIS root, a process whose
# command line names THIS root, an entry INSIDE this root.
#
# ⚠️ WHAT IT DOES NOT SEE: a job or process that never touched the run's temp root
# (a load generator started with no fixture path, a job bootstrapped from a plist
# outside it), and anything a test file makes when it is run directly, outside
# run-tests.sh. test-support/tmpscope.js is the fix for the last one.
#
# All functions print what they found to stdout and return 1 when they found
# something, 0 when clean. They never exit, and never fail on a missing tool.

# Every loaded launchd label for this user, one per line, sorted.
leak_labels_snapshot() {
  launchctl list 2>/dev/null | awk 'NR > 1 && NF >= 3 { print $3 }' | LC_ALL=C sort -u
}

# leak_launchd_check <before-file> <root>: a label loaded since <before-file> whose
# plist lives under <root> is this run's leak. It is booted out (it would otherwise
# respawn against a directory about to be removed) and printed.
leak_launchd_check() {
  local before="$1" root="${2%/}" uid label plist found=0
  [ -n "$root" ] && [ -f "$before" ] || return 0
  uid=$(id -u)
  while IFS= read -r label; do
    [ -n "$label" ] || continue
    plist=$(launchctl print "gui/$uid/$label" 2>/dev/null | awk -F' = ' '/^[[:space:]]+path = / { print $2; exit }')
    case "$plist" in
      "$root"/*)
        launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
        echo "launchd job $label (plist $plist): booted out"
        found=1 ;;
    esac
  done < <(leak_labels_snapshot | LC_ALL=C comm -13 "$before" -)
  return "$found"
}

# leak_process_check <root>: a process whose command line names <root> outlived
# the suite. It is sent TERM, then KILL if it is still there, and printed.
leak_process_check() {
  local root="${1%/}" found=0 pid cmd snap
  [ -n "$root" ] || return 0
  # Snapshot FIRST, filter after: a `ps | grep root` pipeline lists the grep itself,
  # whose own command line names the root, and the guard would kill its own grep.
  snap=$(ps -Ao pid=,command= 2>/dev/null)
  while IFS= read -r line; do
    line=${line#"${line%%[![:space:]]*}"}
    pid=${line%% *}; cmd=${line#* }
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$pid" = "$$" ] && continue
    case "$cmd" in *"$root/"*) ;; *) continue ;; esac
    kill -TERM "$pid" 2>/dev/null || continue
    echo "process $pid: $cmd"
    found=1
  done <<< "$snap"
  if [ "$found" -eq 1 ]; then
    sleep 1
    snap=$(ps -Ao pid=,command= 2>/dev/null)
    while IFS= read -r line; do
      line=${line#"${line%%[![:space:]]*}"}
      pid=${line%% *}; cmd=${line#* }
      case "$pid" in ''|*[!0-9]*) continue ;; esac
      case "$cmd" in *"$root/"*) kill -KILL "$pid" 2>/dev/null || true ;; esac
    done <<< "$snap"
  fi
  return "$found"
}

# The family name of a temp entry, so every run of one test maps to one name:
# mkdtemp's random tail (and mktemp's longer ones) and trailing digits removed, and
# any random token INSIDE the name too (`aoc-state.0LbKWm.polls` -> `aoc-state.polls`).
# A token is random when it is exactly 6 characters (mkdtemp) or 10 (macOS mktemp)
# between separators and mixes letters with digits, or upper with lower case; a real
# word with digits (`win32stop`, 9) is kept. A run of 10+ digits (a millisecond
# timestamp, as in yarn's `yarn--1790560282614-0`) is dropped too.
leak_family() {
  printf '%s\n' "$1" | sed -E 's/[A-Za-z0-9]{6,10}$//; s/[0-9]{10,}//g' | awk '
    function random(t) {
      if (length(t) != 6 && length(t) != 10) return 0
      return (t ~ /[0-9]/ && t ~ /[A-Za-z]/) || (t ~ /[a-z]/ && t ~ /[A-Z]/)
    }
    {
      s = $0; out = ""
      while (match(s, /[-_.]/)) {
        tok = substr(s, 1, RSTART - 1); sep = substr(s, RSTART, 1); s = substr(s, RSTART + 1)
        if (!random(tok)) out = out tok sep
      }
      if (!random(s)) out = out s
      print out
    }' | sed -E 's/[-_.]?[0-9]+[-_.]*$//; s/[-_.]+$//'
}

# leak_tmp_check <root> <allowlist>: the families of entries left inside <root>
# that are not on <allowlist> (one family per line, `#` comments allowed). A family
# on the list that left nothing prints a note so the list can shrink.
leak_tmp_check() {
  local root="${1%/}" allow="$2" found=0 fam
  [ -d "$root" ] || return 0
  local left
  left=$(find "$root" -mindepth 1 -maxdepth 1 2>/dev/null | while IFS= read -r p; do leak_family "${p##*/}"; done | LC_ALL=C sort | uniq -c)
  local allowed=""
  [ -f "$allow" ] && allowed=$(sed 's/#.*//; s/[[:space:]]*$//' "$allow" | grep -v '^$' | LC_ALL=C sort -u)
  while read -r n fam; do
    [ -n "$fam" ] || continue
    if ! printf '%s\n' "$allowed" | grep -qxF -- "$fam"; then
      echo "temp: $n x $fam (not on the allowlist)"
      found=1
    fi
  done <<< "$left"
  while IFS= read -r fam; do
    [ -n "$fam" ] || continue
    printf '%s\n' "$left" | awk '{ print $2 }' | grep -qxF -- "$fam" || echo "note: allowlisted family $fam left nothing; remove it from $(basename "$allow")"
  done <<< "$allowed"
  return "$found"
}
