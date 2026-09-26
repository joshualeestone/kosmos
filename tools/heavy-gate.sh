#!/usr/bin/env bash
# kosmos#3805: is it safe to start a heavy run (a full suite, browser checks, a screenshot sheet)?
# One shared answer, instead of a check hand-rolled per agent (Liu Kang's rule, 2026-09-25).
#
#   bash tools/heavy-gate.sh [--except-cwd DIR] [--twice] [--quiet]
#
# Exit 0: clear. Exit 1: busy. Exit 2: usage error, which also means do not start.
# Busy means either of:
#   - a release reservation holds the machine (tools/who-has-the-box.sh), or
#   - a REAL tools/release.sh or tools/browser-checks.sh is running.
# A shell that only mentions those names (a watcher loop, a grep) does not count: the match is
# on the command, a shell running the script. These do not count either:
#   - a process with a `node --test` ancestor (a unit test's fixture);
#   - a process whose cwd or script sits under $TMPDIR/kt<digits>/ (tools/run-tests.sh's
#     sandbox; some fixtures there detach from node --test, so the path marks them);
#   - a process that has already exited;
#   - with --except-cwd DIR, a run in DIR or below it (your own).
# --twice: clear only if two reads, KOSMOS_HG_TWICE_SECONDS apart (default 60), are both clear.
# Every candidate is printed with the reason it counts or does not.
#
# Seams for tests (tools.heavy-gate-3805.test.js):
#   KOSMOS_HG_SNAPSHOT  a file of process lines to use instead of the live table, one per line,
#                       fields separated by the ASCII unit separator (\x1f), not a tab: read
#                       collapses repeated tabs, which would shift the fields after an empty cwd.
#                       pid, cwd, command, ancestor commands joined by " | "
#                       (a cwd of <exited> stands for a process that is gone; an EMPTY cwd means
#                       the cwd could not be read, and that process still counts)
#   KOSMOS_HG_CLAIM     set: use this text as the reservation line instead of who-has-the-box;
#                       it counts as free only if it says "no release holds"
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

EXCEPT="" ; TWICE=0 ; QUIET=0 ; EXCEPT_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --except-cwd) EXCEPT_SET=1; EXCEPT="${2:-}"; shift 2 || shift ;;
    --twice) TWICE=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "heavy-gate: unknown argument: $1" >&2; exit 2 ;;
  esac
done
# An empty or missing directory must never exclude everything (an empty prefix matches every cwd).
if [ "$EXCEPT_SET" = 1 ]; then
  if [ -z "$EXCEPT" ] || [ ! -d "$EXCEPT" ]; then
    echo "heavy-gate: --except-cwd needs an existing directory (got '${EXCEPT}'); reading as busy" >&2
    exit 2
  fi
  EXCEPT="$(cd "$EXCEPT" && pwd -P)"
fi

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
# A seam left set in an agent's shell would skip the real checks, so say so every time.
[ -n "${KOSMOS_HG_CLAIM+x}${KOSMOS_HG_SNAPSHOT:+x}" ] && say "(test seam active: KOSMOS_HG_CLAIM or KOSMOS_HG_SNAPSHOT is set)"

claim_line() {
  if [ -n "${KOSMOS_HG_CLAIM+x}" ]; then printf '%s\n' "$KOSMOS_HG_CLAIM"; return; fi
  bash "$REPO/tools/who-has-the-box.sh" 2>&1
}

# Live snapshot in the seam's format. Every shell that has a release.sh or browser-checks.sh
# word in its arguments is a candidate; classify decides whether it is RUNNING the script.
live_snapshot() {
  local p q cwd cmd anc
  ps -axo pid=,command= | awk '$2 ~ /(^|\/)(bash|sh|zsh)$/ { for (i = 3; i <= NF; i++) if ($i ~ /(^|\/)(release|browser-checks)\.sh$/) { print $1; next } }' |
  while read -r p; do
    cmd="$(ps -o command= -p "$p" 2>/dev/null)"
    # Gone means ps no longer knows the pid; a live pid whose cwd lsof cannot read keeps an
    # EMPTY cwd and still counts (fail toward busy).
    if [ -z "$cmd" ] || ! ps -p "$p" >/dev/null 2>&1; then cwd="<exited>"
    else cwd="$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; fi
    anc="" ; q="$p"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      q="$(ps -o ppid= -p "$q" 2>/dev/null | tr -d ' ')"
      { [ -z "$q" ] || [ "$q" -le 1 ]; } && break
      anc="$anc | $(ps -o command= -p "$q" 2>/dev/null)"
    done
    printf '%s\037%s\037%s\037%s\n' "$p" "$cwd" "$cmd" "${anc# | }"
  done
}

# The script a shell command runs: the first argument after the shell's own options. A -c
# command string is not a script run (it only mentions the name). Prints nothing if none.
script_of() {
  local w first=1
  for w in $1; do
    if [ "$first" = 1 ]; then first=0; continue; fi
    case "$w" in -c) return ;; -*) continue ;; *) printf '%s' "$w"; return ;; esac
  done
}

# True if one ancestor IS a node --test process (node as the program, a --test flag in its
# arguments), not a wrapper shell whose command line merely mentions it.
has_test_runner() {
  local a prog w
  local IFS=$'\n'
  for a in $(printf '%s\n' "$1" | sed 's/ | /\n/g'); do
    prog="${a%% *}"; prog="${prog##*/}"
    [ "$prog" = node ] || continue
    IFS=' '
    for w in $a; do case "$w" in --test|--test=*|--test-*) return 0 ;; esac; done
    IFS=$'\n'
  done
  return 1
}

# Reads snapshot lines on stdin; prints one verdict line each; prints COUNTED=<n> last.
classify() {
  local pid cwd cmd anc w1 base script n=0 why
  while IFS=$'\037' read -r pid cwd cmd anc; do
    [ -n "$pid" ] || continue
    read -r w1 _ <<< "$cmd"
    base="${w1##*/}"
    case "$base" in bash|sh|zsh) ;; *) say "  ignore $pid: not a shell running the script ($cmd)"; continue ;; esac
    script="$(script_of "$cmd")"
    case "$script" in
      */tools/release.sh|*/tools/browser-checks.sh|tools/release.sh|tools/browser-checks.sh) ;;
      release.sh|browser-checks.sh) case "$cwd" in */tools|"") ;; *) script="" ;; esac ;;
      *) script="" ;;
    esac
    if [ -z "$script" ]; then say "  ignore $pid: mentions the name but does not run it ($cmd)"; continue; fi
    why=""
    has_test_runner "$anc" && why="a unit-test fixture (node --test ancestor)"
    [ -z "$why" ] && [ "$cwd" = "<exited>" ] && why="already exited"
    if [ -z "$why" ]; then
      case "$cwd $script" in */T/kt[0-9]*/*) why="a unit-test fixture (run-tests.sh sandbox)" ;; esac
    fi
    if [ -z "$why" ] && [ -n "$EXCEPT" ] && [ -n "$cwd" ]; then
      case "$cwd" in "$EXCEPT"|"$EXCEPT"/*) why="your own run (--except-cwd)" ;; esac
    fi
    if [ -n "$why" ]; then say "  ignore $pid: $why ($cwd: $cmd)"; continue; fi
    n=$((n + 1)); say "  COUNTS $pid: a real run (${cwd:-cwd unknown}: $cmd)"
  done
  echo "COUNTED=$n"
}

one_read() {
  local claim out counted busy=0
  claim="$(claim_line)"
  case "$claim" in *"no release holds"*) say "reservation: none ($claim)" ;; *) say "reservation: HELD ($claim)"; busy=1 ;; esac
  if [ -n "${KOSMOS_HG_SNAPSHOT:-}" ]; then out="$(classify < "$KOSMOS_HG_SNAPSHOT")"; else out="$(live_snapshot | classify)"; fi
  counted="${out##*COUNTED=}"
  printf '%s\n' "${out%COUNTED=*}" | sed '/^$/d'
  [ "$counted" = 0 ] || busy=1
  return "$busy"
}

if one_read; then first=0; else first=1; fi
if [ "$TWICE" = 1 ] && [ "$first" = 0 ]; then
  sleep "${KOSMOS_HG_TWICE_SECONDS:-60}"
  if one_read; then first=0; else first=1; fi
fi
if [ "$first" = 0 ]; then say "heavy-gate: CLEAR"; exit 0; fi
say "heavy-gate: BUSY"; exit 1
