# Shared process classification for guards that must distinguish a real heavy
# run from a unit-test fixture (#4206): a shell launched by Node's test runner, or
# one running in tools/run-tests.sh's kt<digits> sandbox.

# True only when the command itself is a Node test runner. A shell command that
# mentions `node --test`, an app flag such as --test-endpoint, and a --test flag
# after the script operand are not test runners.
_kosmos_command_is_node_test_runner() (
  set -f
  IFS=' '
  set -- $1
  [ "$#" -gt 0 ] || exit 1
  local prog="${1##*/}" w
  [ "$prog" = node ] || exit 1
  shift
  for w in "$@"; do
    case "$w" in
      --test) exit 0 ;;
      -*) ;;
      *) break ;;
    esac
  done
  exit 1
)

# True when one of PID's first ten ancestors is a Node test runner. Ten is the
# existing heavy-gate bound: fixtures are normally node, one wrapper shell, and
# the guarded script. An unresolved or deeper chain fails toward counting the
# process as real.
#
# KOSMOS_PROCESS_ANCESTOR_PROBE is a focused-test seam. Its command receives the
# candidate pid and prints one ancestor command per line.
_kosmos_pid_has_node_test_ancestor() {
  local pid="$1" q="$1" depth=0 commands="" cmd
  if [ -n "${KOSMOS_PROCESS_ANCESTOR_PROBE:-}" ]; then
    commands="$("$KOSMOS_PROCESS_ANCESTOR_PROBE" "$pid" 2>/dev/null)" || return 1
  else
    while [ "$depth" -lt 10 ]; do
      depth=$((depth + 1))
      # `|| q=""`: a pid gone mid-walk ends the walk here, whatever the caller's set -e.
      q="$(ps -o ppid= -p "$q" 2>/dev/null | tr -d '[:space:]')" || q=""
      { [ -z "$q" ] || [ "$q" -le 1 ] 2>/dev/null; } && break
      cmd="$(ps -o command= -p "$q" 2>/dev/null)" || cmd=""
      [ -n "$cmd" ] && commands="${commands}${commands:+$'\n'}$cmd"
    done
  fi
  while IFS= read -r cmd; do
    _kosmos_command_is_node_test_runner "$cmd" && return 0
  done <<< "$commands"
  return 1
}

# True if PATH is in tools/run-tests.sh's sandbox: a kt<digits> folder under a folder named T
# (macOS TMPDIR) or tmp, or directly under this shell's own $TMPDIR. The $TMPDIR branch compares
# the path as given: lsof reports a cwd with symlinks resolved (/private/var/...), macOS's TMPDIR is
# /var/..., so for an lsof cwd on macOS only the regex half decides. That errs toward counting. Some fixtures detach from
# node --test, so the path marks them (#4206 follow-up: moved here from heavy-gate so the cut and
# browser guards read the same rule).
_KOSMOS_KT_RE='(^|/)(T|tmp)/kt[0-9]+(/|$)'
_kosmos_path_in_kt_sandbox() {
  [[ "$1" =~ $_KOSMOS_KT_RE ]] && return 0
  local t="${TMPDIR:-}"; t="${t%/}"
  [ -n "$t" ] || return 1
  case "$1" in "$t"/kt*) ;; *) return 1 ;; esac
  local rest="${1#"$t"/kt}"; rest="${rest%%/*}"
  [ -n "$rest" ] && [ -z "${rest//[0-9]/}" ]
}

# True when PID is a unit-test fixture: a node --test ancestor, or its cwd (or SCRIPT, when given)
# in the run-tests.sh sandbox. An unreadable cwd is not a fixture: it fails toward counting.
_kosmos_pid_is_test_fixture() {
  local pid="$1" script="${2:-}" cwd
  _kosmos_pid_has_node_test_ancestor "$pid" && return 0
  # `|| cwd=""`: an lsof that fails (a pid gone since the snapshot) reads as no cwd, whatever the
  # caller's set -e; it must never end a caller's loop over the other candidates.
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n '/^n/{s/^n//p;q;}')" || cwd=""
  [ -n "$cwd" ] && _kosmos_path_in_kt_sandbox "$cwd" && return 0
  [ -n "$script" ] && _kosmos_path_in_kt_sandbox "$script" && return 0
  return 1
}
