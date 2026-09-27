#!/usr/bin/env bash
# kosmos#3805: is it safe to start a heavy run (a full suite, browser checks, a screenshot sheet)?
# One shared answer, instead of a check hand-rolled per agent (Liu Kang's rule, 2026-09-25).
#
#   bash tools/heavy-gate.sh [--except-cwd DIR] [--twice] [--quiet] [--quiet-box]
#
# Run it, never source it: sourced, it refuses with exit 2 (do not start). Run by zsh, it
# re-runs itself under bash, because zsh does not split words the way the parsing below needs.
#
# Exit 0: clear. Exit 1: busy. Exit 2: usage error, which also means do not start.
# Busy means either of:
#   - a release reservation holds the machine (tools/who-has-the-box.sh), or
#   - a REAL tools/release.sh or tools/browser-checks.sh is running.
# A shell that only mentions those names in a command string (sh -c '... release.sh ...') does
# not count. A shell script that takes the path as an ARGUMENT does count (bash watch.sh
# .../tools/release.sh), because a path with a space arrives split and cannot be told apart from
# it: that errs toward busy. These do not count either:
#   - a process with a `node --test` ancestor (a unit test's fixture);
#   - a process whose cwd or script sits in a kt<digits> folder under a folder named T or tmp, or
#     directly under this shell's $TMPDIR
#     (tools/run-tests.sh's sandbox is ${TMPDIR:-/tmp}/kt$$: .../T/ on macOS, or /tmp); some
#     fixtures there detach from node --test, so the path marks them;
#   - a process that has already exited;
#   - with --except-cwd DIR, EVERY run whose cwd is DIR or below it, whoever started it. It is
#     for ruling out your own run, so pass your own worktree, never a shared checkout (that would
#     rule out other agents' runs there too). DIR must be a checkout (it has a .git), so a parent
#     folder passed by mistake is exit 2, not a clear.
# --quiet: print nothing on stdout, not even the CLEAR/BUSY verdict; read the exit code.
# --quiet-box: for timing-sensitive work, also count a live tools/run-tests.sh validation
#   suite. The default deliberately does not count validation suites, which may overlap.
# --twice: clear only if two reads, KOSMOS_HG_TWICE_SECONDS apart (default 60, whole seconds;
#   anything else is exit 2), are both clear.
# Every candidate is printed with the reason it counts or does not; its command is cut to
# 160 characters and "...", and a counted run also names its script.
#
# Seams for tests (tools.heavy-gate-3805.test.js):
#   KOSMOS_HG_SNAPSHOT  a file of process lines to use instead of the live table, one per line,
#                       fields separated by the ASCII unit separator (\x1f), not a tab: read
#                       collapses repeated tabs, which would shift the fields after an empty cwd.
#                       pid, cwd, command, ancestor commands joined by the record separator
#                       (\x1e): a command line can contain " | " itself, so no printable joiner
#                       is safe (a shell running `foo | node --test` would read as a test runner)
#                       (a cwd of <exited> stands for a process that is gone; an EMPTY cwd means
#                       the cwd could not be read, and that process still counts)
#   (Never export either seam in a shell profile: set, it replaces the real check. The tool
#   says so on stderr every run.)
#   KOSMOS_HG_CLAIM     set: use this text as the reservation line instead of who-has-the-box;
#                       it counts as free only if it is exactly who-has-the-box's free line
# Sourced, the exits below would close the caller's shell: refuse, and return 2 (do not start).
if [ -n "${ZSH_VERSION:-}" ]; then
  case "${ZSH_EVAL_CONTEXT:-}" in
    *file*) echo "heavy-gate: run it with bash, do not source it (reading as do-not-start)" >&2; return 2 ;;
  esac
  exec bash "$0" "$@"   # zsh as the interpreter would read every real run as a mention
elif [ -n "${BASH_VERSION:-}" ] && [ "${BASH_SOURCE[0]}" != "$0" ]; then
  echo "heavy-gate: run it with bash, do not source it (reading as do-not-start)" >&2; return 2
fi
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

EXCEPT="" ; TWICE=0 ; QUIET=0 ; QUIET_BOX=0 ; EXCEPT_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --except-cwd) EXCEPT_SET=1; EXCEPT="${2:-}"; shift 2 || shift ;;
    --twice) TWICE=1; shift ;;
    --quiet) QUIET=1; shift ;;
    --quiet-box) QUIET_BOX=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "heavy-gate: unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "${KOSMOS_HG_TWICE_SECONDS:-60}" in
  ''|*[!0-9]*) echo "heavy-gate: KOSMOS_HG_TWICE_SECONDS must be whole seconds (got '${KOSMOS_HG_TWICE_SECONDS}'); reading as do-not-start" >&2; exit 2 ;;
esac
# An empty or missing directory must never exclude everything (an empty prefix matches every cwd).
if [ "$EXCEPT_SET" = 1 ]; then
  if [ -z "$EXCEPT" ] || [ ! -d "$EXCEPT" ]; then
    echo "heavy-gate: --except-cwd needs an existing directory (got '${EXCEPT}'); reading as do-not-start" >&2
    exit 2
  fi
  if [ ! -e "$EXCEPT/.git" ]; then
    echo "heavy-gate: --except-cwd needs a checkout, a folder with .git (got '${EXCEPT}'); reading as do-not-start" >&2
    exit 2
  fi
  EXCEPT="$(cd "$EXCEPT" && pwd -P)"
fi

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
# A seam left set in an agent's shell would skip the real checks, so say so every time, on
# stderr, so --quiet does not hide it.
[ -n "${KOSMOS_HG_CLAIM+x}${KOSMOS_HG_SNAPSHOT:+x}" ] && echo "(test seam active: KOSMOS_HG_CLAIM or KOSMOS_HG_SNAPSHOT is set)" >&2

# who-has-the-box's whole line when nothing holds the machine, copied from
# kosmos_machine_claim_status in tools/lib/cut-guard.sh; tools.heavy-gate-3805.test.js pins the
# two equal. Anything else, including extra output around it, reads as held.
FREE_LINE='no release holds the machine right now.'
claim_line() {
  if [ -n "${KOSMOS_HG_CLAIM+x}" ]; then printf '%s\n' "$KOSMOS_HG_CLAIM"; return; fi
  bash "$REPO/tools/who-has-the-box.sh" 2>&1
}

# Live snapshot in the seam's format. Every shell that has a release.sh or browser-checks.sh
# word in its arguments is a candidate. In --quiet-box mode, run-tests.sh is one too.
# classify decides whether it is RUNNING the script.
# How far up the parent chain to look for a node --test runner. A test fixture sits a few hops
# below it (node, a wrapper shell, the script); a deeper chain stops early and fails toward busy.
ANCESTOR_DEPTH=10
ANC_SEP=$'\036'   # joins ancestor commands; see KOSMOS_HG_SNAPSHOT above
# Exits 3 when the process table cannot be read: ps failing, or a listing without pid 1 (which
# every Mac has), would otherwise look exactly like "nothing running" and read clear.
live_snapshot() {
  local p q cwd cmd anc depth listing
  listing="$(ps -axo pid=,command= 2>/dev/null)" || return 3
  printf '%s\n' "$listing" | awk '$1 == 1 { f = 1 } END { exit !f }' || return 3
  printf '%s\n' "$listing" | awk -v quiet_box="$QUIET_BOX" '$2 ~ /(^|\/)(bash|sh|zsh)$/ { for (i = 3; i <= NF; i++) if ($i ~ /(^|\/)(release|browser-checks)\.sh$/ || (quiet_box == 1 && $i ~ /(^|\/)run-tests\.sh$/)) { print $1; next } }' |
  while read -r p; do
    cmd="$(ps -o command= -p "$p" 2>/dev/null)"
    # Gone means ps no longer knows the pid; a live pid whose cwd lsof cannot read keeps an
    # EMPTY cwd and still counts (fail toward busy).
    if [ -z "$cmd" ] || ! ps -p "$p" >/dev/null 2>&1; then cwd="<exited>"
    else cwd="$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n '/^n/{s/^n//p;q;}')"; fi
    anc="" ; q="$p"; depth=0
    while [ "$depth" -lt "$ANCESTOR_DEPTH" ]; do
      depth=$((depth + 1))
      q="$(ps -o ppid= -p "$q" 2>/dev/null | tr -d ' ')"
      { [ -z "$q" ] || [ "$q" -le 1 ]; } && break
      anc="$anc$ANC_SEP$(ps -o command= -p "$q" 2>/dev/null)"
    done
    printf '%s\037%s\037%s\037%s\n' "$p" "$cwd" "$cmd" "${anc#"$ANC_SEP"}"
  done
}

# The script a shell command runs. ps loses argument boundaries, so a path with a space arrives
# split: any word ENDING in a heavy script path counts (fail toward busy); otherwise the first
# argument after the shell's own options and their values (-o/-O NAME, also as the last letter of
# a cluster like -eo NAME, and --rcfile FILE), for a
# bare release.sh. A command string (-c, or c inside combined flags like -lc) is not a script
# run (it only mentions the name), and neither is -n, a syntax check: prints nothing. Runs in a subshell with globbing off,
# so a `*` in a command line stays one literal word.
script_of() (
  set -f
  first=1; lead=""; skip=0
  for w in $1; do
    if [ "$first" = 1 ]; then first=0; continue; fi
    if [ -z "$lead" ]; then
      if [ "$skip" = 1 ]; then skip=0; continue; fi
      case "$w" in
        --rcfile|--init-file|[-+]o|[-+]O) skip=1; continue ;;
        --*) continue ;;
        -*c*|-*n*) exit 0 ;;   # a command string, or -n (read, never run)
        -*[oO]|+*[oO]) skip=1; continue ;;   # a cluster ending in o/O (-eo) takes the next word
        -*|+*) continue ;;
      esac
      lead="$w"
    fi
    case "$w" in */tools/release.sh|*/tools/browser-checks.sh|tools/release.sh|tools/browser-checks.sh|*/tools/run-tests.sh|tools/run-tests.sh)
      printf '%s' "$w"; exit 0 ;; esac
  done
  printf '%s' "$lead"
)

# True if one ancestor IS a node test-runner process: node as the program, with a bare --test
# among node's OWN options, the words before its script. Subshell with globbing off, as above.
has_test_runner() (
  set -f
  IFS="$ANC_SEP"
  for a in $1; do
    prog="${a%% *}"; prog="${prog##*/}"
    [ "$prog" = node ] || continue
    IFS=' '
    first=1
    for w in $a; do
      if [ "$first" = 1 ]; then first=0; continue; fi
      case "$w" in --test) exit 0 ;; -*) ;; *) break ;; esac
    done
    IFS="$ANC_SEP"
  done
  exit 1
)

# True if the path is in tools/run-tests.sh's sandbox: a kt<digits> folder under a folder named
# T (macOS TMPDIR) or tmp, or directly under this shell's own $TMPDIR.
KT_RE='(^|/)(T|tmp)/kt[0-9]+(/|$)'
in_kt_sandbox() {
  [[ "$1" =~ $KT_RE ]] && return 0
  local t="${TMPDIR:-}"; t="${t%/}"
  [ -n "$t" ] || return 1
  case "$1" in "$t"/kt*) ;; *) return 1 ;; esac
  local rest="${1#"$t"/kt}"; rest="${rest%%/*}"
  [ -n "$rest" ] && [ -z "${rest//[0-9]/}" ]
}

# A verdict line shows at most this many characters of the command, then "...": a shell running
# a long -c string once printed several thousand. Only the printed copy is cut, never $cmd.
CMD_SHOW_MAX=160

# Reads snapshot lines on stdin; prints one verdict line each; prints COUNTED=<n> last.
classify() {
  local pid cwd cmd anc w1 base script n=0 why show
  while IFS=$'\037' read -r pid cwd cmd anc; do
    [ -n "$pid" ] || continue
    show="$cmd"
    [ "${#show}" -gt "$CMD_SHOW_MAX" ] && show="${show:0:$CMD_SHOW_MAX}..."
    read -r w1 _ <<< "$cmd"
    base="${w1##*/}"
    case "$base" in bash|sh|zsh) ;; *) say "  ignore $pid: not a shell running the script ($show)"; continue ;; esac
    script="$(script_of "$cmd")"
    case "$script" in
      */tools/release.sh|*/tools/browser-checks.sh|tools/release.sh|tools/browser-checks.sh) ;;
      */tools/run-tests.sh|tools/run-tests.sh) [ "$QUIET_BOX" = 1 ] || script="" ;;
      release.sh|browser-checks.sh|./release.sh|./browser-checks.sh) case "$cwd" in */tools|"") ;; *) script="" ;; esac ;;
      run-tests.sh|./run-tests.sh) if [ "$QUIET_BOX" = 1 ]; then case "$cwd" in */tools|"") ;; *) script="" ;; esac; else script=""; fi ;;
      *) script="" ;;
    esac
    if [ -z "$script" ]; then say "  ignore $pid: mentions the name but does not run it ($show)"; continue; fi
    why=""
    has_test_runner "$anc" && why="a unit-test fixture (node --test ancestor)"
    [ -z "$why" ] && [ "$cwd" = "<exited>" ] && why="already exited"
    if [ -z "$why" ]; then
      if in_kt_sandbox "$cwd" || in_kt_sandbox "$script"; then why="a unit-test fixture (run-tests.sh sandbox)"; fi
    fi
    if [ -z "$why" ] && [ -n "$EXCEPT" ] && [ -n "$cwd" ]; then
      case "$cwd" in "$EXCEPT"|"$EXCEPT"/*) why="your own run (--except-cwd)" ;; esac
    fi
    if [ -n "$why" ]; then say "  ignore $pid: $why ($cwd: $show)"; continue; fi
    n=$((n + 1)); say "  COUNTS $pid: a real run (${cwd:-cwd unknown}: $show), script $script"
  done
  echo "COUNTED=$n"
}

one_read() {
  local claim out counted snap busy=0
  claim="$(claim_line)"
  case "$claim" in "$FREE_LINE") say "reservation: none ($claim)" ;; *) say "reservation: HELD ($claim)"; busy=1 ;; esac
  if [ -n "${KOSMOS_HG_SNAPSHOT:-}" ]; then out="$(classify < "$KOSMOS_HG_SNAPSHOT")"
  else
    snap="$(live_snapshot)" || {
      echo "heavy-gate: could not read the process table (ps failed, or listed no pid 1); reading as do-not-start" >&2
      exit 2
    }
    out="$(printf '%s\n' "$snap" | classify)"
  fi
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
