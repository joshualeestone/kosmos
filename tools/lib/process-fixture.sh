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
  local pid="$1" q="$1" depth=0 commands="" cmd last="$1"
  if [ -n "${KOSMOS_PROCESS_ANCESTOR_PROBE:-}" ]; then
    commands="$("$KOSMOS_PROCESS_ANCESTOR_PROBE" "$pid" 2>/dev/null)" || return 1
  else
    while [ "$depth" -lt 10 ]; do
      depth=$((depth + 1))
      last="$q"
      # `|| q=""`: defensive. Today every caller is the left side of && (where set -e is off), so a
      # pid gone mid-walk already just ends the walk; this keeps it so if a caller ever calls bare
      # under set -e with pipefail (release.sh sets both).
      q="$(ps -o ppid= -p "$q" 2>/dev/null | tr -d '[:space:]')" || q=""
      { [ -z "$q" ] || [ "$q" -le 1 ] 2>/dev/null; } && break
      cmd="$(ps -o command= -p "$q" 2>/dev/null)" || cmd=""
      [ -n "$cmd" ] && commands="${commands}${commands:+$'\n'}$cmd"
    done
    # #7334: on Windows an MSYS process whose parent reads as 1 was usually started by a Windows program (a test
    # file's node, npm's cmd.exe) that Git Bash's /proc does not list, so the rest of the chain is asked of Windows
    # (the reader at the end of this file), within the same ten.
    if [ "${_KOSMOS_PROC_WIN:-0}" = 1 ] && [ "$q" = 1 ] && [ "$depth" -le 10 ] \
        && _kosmos_win_native_ancestors "$last" $((11 - depth)) && [ -n "$_KOSMOS_WIN_ANC" ]; then
      commands="${commands}${commands:+$'\n'}$_KOSMOS_WIN_ANC"
    fi
  fi
  while IFS= read -r cmd; do
    _kosmos_command_is_node_test_runner "$cmd" && return 0
  done <<< "$commands"
  return 1
}

# True if PATH is in tools/run-tests.sh's sandbox: a kt<digits> folder under a folder named T
# (macOS TMPDIR) or tmp, or directly under this shell's own $TMPDIR. Some fixtures detach from
# node --test, so the path marks them (#4206 follow-up: moved here from heavy-gate so the cut and
# browser guards read the same rule).
#
# The regex matches ANY folder named T or tmp, not only temp roots, so a checkout at ~/tmp/kt1/ would
# read as a fixture; accepted, since the rule is heavy-gate's and nothing real runs from such a path.
#
# The $TMPDIR branch compares the path as given. lsof reports a cwd with symlinks resolved
# (/private/var/...) while macOS's TMPDIR is /var/..., so for an lsof cwd on macOS only the regex
# half decides; a fixture that only this branch would mark is counted as a real run instead.
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
  # `|| cwd=""`: defensive, as above. An lsof that fails (a pid gone since the snapshot) reads as no
  # cwd and must never end a caller's loop over the other candidates.
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n '/^n/{s/^n//p;q;}')" || cwd=""
  [ -n "$cwd" ] && _kosmos_path_in_kt_sandbox "$cwd" && return 0
  [ -n "$script" ] && _kosmos_path_in_kt_sandbox "$script" && return 0
  return 1
}

# --- #7334: the process table on Windows (Git Bash, MSYS2, Cygwin) -----------
# The guards in this file and in cut-guard.sh read the process table with four forms: `ps -o <field>= -p <pid>` (ppid,
# pgid, command, lstart; command also as `ps -ww -o command= -p <pid>`), `pgrep -fa <ERE>` and
# `lsof -a -p <pid> -d cwd -Fn`. Git Bash's ps takes none of those options and Git Bash has no pgrep or lsof, so on
# Windows every guard answered "could not tell" and run-tests.sh switched its suite and harness checks off there
# (#7257). Git Bash keeps its own process table in /proc: the pid, parent, group, command line, cwd and start time of
# every MSYS process (and of every Windows program one of them started), in the same pid space as $$, $!, kill -0 and
# the run-marker file names, read without starting a process. So on Windows ONLY, ps, pgrep and lsof are shell
# functions that answer exactly those forms from /proc and hand every other form to the real program unchanged (so
# run-tests.sh's file watchdog, which asks ps -A and pgrep -P, gets what it got before). A caller in the same shell that
# asks one of the four forms itself gets the /proc answer too: shell-parallel.sh's stop reads `ps -o ppid= -p`.
# Windows is read from uname once, here, never from the environment. Elsewhere nothing below is defined.
# They fail the way the real ones do: a pid with no /proc entry prints nothing and exits 1, so a guard reads it as gone
# or unresolved exactly as on a Mac; a /proc that cannot be listed at all makes pgrep exit 2, which every guard reads as
# "could not tell" and refuses.
# One gap the /proc table cannot close: a Windows program that was NOT started from an MSYS process (npm's cmd.exe, a
# node --test runner's per-file node) is not in it, so an MSYS process started by one has parent 1 there. Only the
# node --test ancestor rule above needs to see past that, and it asks Windows itself (_kosmos_win_native_ancestors).
_KOSMOS_PROC_WIN=0
case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) _KOSMOS_PROC_WIN=1 ;; esac
if [ "$_KOSMOS_PROC_WIN" = 1 ]; then
  # _kosmos_win_argv0 <argv0>: into _KOSMOS_WIN_A0. A Windows program's argv[0] is a Windows path (C:\...\node.exe,
  # often with a space in it), which no guard's ([^ ]*/)? path rule or `${1##*/} = node` test can read, so a
  # Windows-form one (a backslash or a drive colon) becomes its bare name, and a trailing .exe is dropped from any. An
  # MSYS one (bash, /usr/bin/bash) is left as it is, as a Mac or Linux ps would show it. No subshell: pgrep below must
  # not start a process while it lists them.
  _kosmos_win_argv0() {
    local a="$1"
    case "$a" in *\\*|?:*) a="${a//\\//}"; a="${a##*/}" ;; esac
    case "$a" in *.[Ee][Xx][Ee]) a="${a%.*}" ;; esac
    _KOSMOS_WIN_A0="$a"
  }
  # _kosmos_win_cmdline <pid>: the command line from /proc/<pid>/cmdline, its words joined by single spaces as ps shows
  # them, into _KOSMOS_WIN_CMD. Returns 1 when there is no such process (or no words).
  _kosmos_win_cmdline() {
    local w first=1 c=""
    _KOSMOS_WIN_CMD=""
    [ -r "/proc/$1/cmdline" ] || return 1
    while IFS= read -r -d '' w || [ -n "$w" ]; do
      if [ "$first" = 1 ]; then _kosmos_win_argv0 "$w"; w="$_KOSMOS_WIN_A0"; first=0; c="$w"
      else c="$c $w"; fi
    done 2>/dev/null < "/proc/$1/cmdline" || return 1
    [ -n "$c" ] || return 1
    _KOSMOS_WIN_CMD="$c"
  }
  ps() {
    local field="" pid="" v
    if [ "$#" = 4 ] && [ "$1" = -o ] && [ "$3" = -p ]; then field="$2"; pid="$4"
    elif [ "$#" = 5 ] && [ "$1" = -ww ] && [ "$2" = -o ] && [ "$4" = -p ] && [ "$3" = command= ]; then field="$3"; pid="$5"
    fi
    case "$field" in ppid=|pgid=|command=|lstart=) ;; *) command ps "$@"; return ;; esac
    case "$pid" in ''|*[!0-9]*) return 1 ;; esac
    case "$field" in
      ppid=|pgid=) read -r v 2>/dev/null < "/proc/$pid/${field%=}" || return 1
                   [ -n "$v" ] || return 1; printf '%s\n' "$v" ;;
      command=) _kosmos_win_cmdline "$pid" || return 1; printf '%s\n' "$_KOSMOS_WIN_CMD" ;;
      # The start time, as ps -o lstart= prints it, in the caller's TZ (cut-guard.sh asks it in UTC and the C locale and
      # in its own). Git Bash stamps /proc/<pid> with the process's start, to the second, the same on every read.
      lstart=) [ -e "/proc/$pid" ] || return 1
               v="$(date -r "/proc/$pid" '+%a %b %e %H:%M:%S %Y' 2>/dev/null)" || return 1
               [ -e "/proc/$pid" ] || return 1   # gone during the read: the stamp may not be its own
               [ -n "$v" ] || return 1; printf '%s\n' "$v" ;;
    esac
  }
  # pgrep -fa <ERE>: "pid command" for every process whose command line matches, as procps pgrep -fa prints it. Like
  # pgrep it leaves out itself (this subshell, which carries its caller's command line), and like procps it lists the
  # caller's own ancestors (_kosmos_pgrep_cmdlines drops those). Nothing in the loop starts a process, so no other
  # short-lived copy of the caller's command line is in the list because of this read.
  pgrep() {
    if [ "$#" != 2 ] || [ "$1" != -fa ]; then command pgrep "$@"; return; fi
    local re="$2" self="${BASHPID:-}" d p found=1 rc
    [ -n "$self" ] && [ -r /proc/self/cmdline ] || return 2
    for d in /proc/[0-9]*; do
      p="${d#/proc/}"
      case "$p" in *[!0-9]*) continue ;; esac
      [ "$p" = "$self" ] && continue
      _kosmos_win_cmdline "$p" || continue
      [[ $_KOSMOS_WIN_CMD =~ $re ]] 2>/dev/null; rc=$?
      [ "$rc" -ge 2 ] && return 2   # not a regex this bash can read: could not tell
      [ "$rc" = 0 ] || continue
      printf '%s %s\n' "$p" "$_KOSMOS_WIN_CMD"; found=0
    done
    return "$found"
  }
  # lsof -a -p <pid> -d cwd -Fn: the "n<cwd>" line, from /proc/<pid>/cwd (an MSYS path, as $TMPDIR and the kt sandbox
  # rule read it).
  lsof() {
    if [ "$#" != 6 ] || [ "$1" != -a ] || [ "$2" != -p ] || [ "$4" != -d ] || [ "$5" != cwd ] || [ "$6" != -Fn ]; then
      command lsof "$@"; return
    fi
    local c
    case "$3" in ''|*[!0-9]*) return 1 ;; esac
    c="$(readlink "/proc/$3/cwd" 2>/dev/null)" || return 1
    [ -n "$c" ] || return 1
    printf 'p%s\nn%s\n' "$3" "$c"
  }
  # _kosmos_win_native_ancestors <msys pid> <count>: the command lines of up to <count> WINDOWS ancestors of <msys pid>,
  # nearest first, into _KOSMOS_WIN_ANC (one per line, each argv[0] a bare name as above). For an MSYS process whose
  # /proc parent is 1, the one place a node --test runner can hide: a test file's node, and the runner above it, are
  # Windows programs no MSYS process started. One PowerShell call (about 0.5 to 1 s, measured on the Windows box) walks
  # Win32_Process by ParentProcessId; a parent created after its child is a reused pid, and ends the walk. Anything that
  # fails (no PowerShell, no WMI, a pid gone) leaves the list short or empty, which reads as "no node --test ancestor":
  # counted as a real run, the side every guard here takes. Kept per process (pid and start) for this shell, since a
  # suite check walks every subshell of another suite up to the same top process: a check asks Windows once per tree.
  declare -gA _KOSMOS_WIN_ANC_SEEN 2>/dev/null || true
  _kosmos_win_native_ancestors() {
    local pid="$1" n="$2" wp key out rc line a0 rest
    local -a st=()
    _KOSMOS_WIN_ANC=""
    case "$pid" in ''|*[!0-9]*) return 1 ;; esac
    case "$n" in ''|*[!0-9]*|0) return 1 ;; esac
    read -r wp 2>/dev/null < "/proc/$pid/winpid" || return 1
    case "$wp" in ''|*[!0-9]*) return 1 ;; esac
    read -r -a st 2>/dev/null < "/proc/$pid/stat" || st=()
    key="$pid:$wp:${st[21]:-}"
    if [ -n "${_KOSMOS_WIN_ANC_SEEN[$key]+set}" ]; then
      _KOSMOS_WIN_ANC="${_KOSMOS_WIN_ANC_SEEN[$key]}"; _kosmos_win_anc_first "$n"; return 0
    fi
    out="$(MSYS_NO_PATHCONV=1 powershell.exe -NoProfile -NonInteractive -Command "\$p = Get-CimInstance Win32_Process -Filter 'ProcessId=$wp'; for (\$i = 0; \$i -lt 10 -and \$p; \$i++) { \$q = Get-CimInstance Win32_Process -Filter ('ProcessId=' + \$p.ParentProcessId); if (-not \$q -or \$q.CreationDate -gt \$p.CreationDate) { break }; \$c = \$q.CommandLine; if (-not \$c) { \$c = \$q.Name }; [Console]::Out.WriteLine((\$c -replace '[\r\n]+', ' ')); \$p = \$q }" 2>/dev/null </dev/null)"; rc=$?
    while IFS= read -r line; do
      line="${line%$'\r'}"
      line="${line#"${line%%[![:space:]]*}"}"
      [ -n "$line" ] || continue
      if [ "${line:0:1}" = '"' ]; then
        rest="${line:1}"; a0="${rest%%\"*}"
        if [ "$a0" = "$rest" ]; then rest=""; else rest="${rest#*\"}"; fi
      else
        a0="${line%% *}"; rest="${line#"$a0"}"
      fi
      rest="${rest#"${rest%%[![:space:]]*}"}"
      _kosmos_win_argv0 "$a0"
      _KOSMOS_WIN_ANC="${_KOSMOS_WIN_ANC}${_KOSMOS_WIN_ANC:+$'\n'}$_KOSMOS_WIN_A0${rest:+ $rest}"
    done <<< "$out"
    # Kept only when PowerShell answered, so a failed call is asked again next time.
    [ "$rc" = 0 ] && _KOSMOS_WIN_ANC_SEEN[$key]="$_KOSMOS_WIN_ANC"
    _kosmos_win_anc_first "$n"
    return 0
  }
  # Keeps the first <n> lines of _KOSMOS_WIN_ANC (the cache holds ten, the most any walk here asks for).
  _kosmos_win_anc_first() {
    local kept="" line i=0
    while IFS= read -r line; do
      [ "$i" -lt "$1" ] || break
      kept="${kept}${kept:+$'\n'}$line"; i=$((i + 1))
    done <<< "$_KOSMOS_WIN_ANC"
    _KOSMOS_WIN_ANC="$kept"
  }
fi
