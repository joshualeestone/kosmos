# #4206: is this process a unit-test FIXTURE rather than a real run? One answer, shared by
# tools/heavy-gate.sh (#3805) and the concurrent-run guards in tools/lib/cut-guard.sh, so the two
# cannot drift. It was drift that blocked the Mac 0.7.03 cut: heavy-gate already ignored a
# release.sh with a `node --test` ancestor, the cut guard did not, and three agents' ordinary
# `yarn test` validations refused a release.
#
# A process is a fixture when:
#   - one of its ancestors IS a node test runner: node as the program, with a bare --test among
#     node's OWN options, the words before its script; or
#   - its cwd, or the script it runs, sits in tools/run-tests.sh's sandbox: a kt<digits> folder
#     under a folder named T (macOS TMPDIR) or tmp, or directly under this shell's own $TMPDIR.
#     Some fixtures detach from node --test, so the path marks them.
# Anything this cannot read (a gone pid, a cwd lsof cannot see, a chain deeper than the limit) is
# NOT a fixture: every error runs toward "a real run", which a guard refuses.
#
# Bash only (it uses [[ =~ ]]), and safe under set -u. Sourced; defines functions only.

KOSMOS_FX_ANC_SEP=$'\036'   # joins ancestor commands: a command line can contain any printable joiner
KOSMOS_FX_ANCESTOR_DEPTH=10 # a fixture sits a few hops below node --test; deeper stops early, toward "real"
KOSMOS_FX_KT_RE='(^|/)(T|tmp)/kt[0-9]+(/|$)'

# The ancestor command lines of a pid, nearest first, joined by KOSMOS_FX_ANC_SEP.
kosmos_fx_pid_ancestry() {
  local q="$1" anc="" depth=0
  while [ "$depth" -lt "$KOSMOS_FX_ANCESTOR_DEPTH" ]; do
    depth=$((depth + 1))
    q="$(ps -o ppid= -p "$q" 2>/dev/null | tr -d ' ')"
    { [ -z "$q" ] || [ "$q" -le 1 ]; } && break
    anc="$anc$KOSMOS_FX_ANC_SEP$(ps -o command= -p "$q" 2>/dev/null)"
  done
  printf '%s' "${anc#"$KOSMOS_FX_ANC_SEP"}"
}

# The cwd of a pid, or nothing when it cannot be read.
kosmos_fx_pid_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n '/^n/{s/^n//p;q;}'
}

# True if one ancestor (KOSMOS_FX_ANC_SEP-joined) is a node test runner. Subshell, globbing off.
kosmos_fx_has_test_runner() (
  set -f
  IFS="$KOSMOS_FX_ANC_SEP"
  for a in $1; do
    prog="${a%% *}"; prog="${prog##*/}"
    [ "$prog" = node ] || continue
    IFS=' '
    first=1
    for w in $a; do
      if [ "$first" = 1 ]; then first=0; continue; fi
      case "$w" in --test) exit 0 ;; -*) ;; *) break ;; esac
    done
    IFS="$KOSMOS_FX_ANC_SEP"
  done
  exit 1
)

# True if the path is in tools/run-tests.sh's sandbox.
kosmos_fx_in_kt_sandbox() {
  [[ "$1" =~ $KOSMOS_FX_KT_RE ]] && return 0
  local t="${TMPDIR:-}"; t="${t%/}"
  [ -n "$t" ] || return 1
  case "$1" in "$t"/kt*) ;; *) return 1 ;; esac
  local rest="${1#"$t"/kt}"; rest="${rest%%/*}"
  [ -n "$rest" ] && [ -z "${rest//[0-9]/}" ]
}

# For a live pid: prints why it is a fixture and returns 0, or returns 1 (a real run, or unreadable).
# The optional second argument is the script path the process runs, checked against the sandbox too.
kosmos_fx_pid_is_fixture() {
  local pid="$1" script="${2:-}" anc cwd
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  ps -p "$pid" >/dev/null 2>&1 || return 1
  anc="$(kosmos_fx_pid_ancestry "$pid")"
  if kosmos_fx_has_test_runner "$anc"; then echo "a unit-test fixture (node --test ancestor)"; return 0; fi
  cwd="$(kosmos_fx_pid_cwd "$pid")"
  if { [ -n "$cwd" ] && kosmos_fx_in_kt_sandbox "$cwd"; } || { [ -n "$script" ] && kosmos_fx_in_kt_sandbox "$script"; }; then
    echo "a unit-test fixture (run-tests.sh sandbox)"; return 0
  fi
  return 1
}

# Filters guard lines ("<pid> <command...>") on stdin, dropping the ones whose pid is a fixture.
kosmos_fx_drop_fixtures() {
  local line pid script re='([^ ]*/tools/(release|browser-checks)\.sh)( |$)'
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"
    script=""
    [[ "$line" =~ $re ]] && script="${BASH_REMATCH[1]}"
    kosmos_fx_pid_is_fixture "$pid" "$script" >/dev/null && continue
    printf '%s\n' "$line"
  done
}
