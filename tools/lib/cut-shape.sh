# #6977: run a command in the environment a cut's step 3 gives the shell tests, so a test that fails only in a
# cut fails before the cut. The 0.7.64 cut aborted twice on shell tests that had passed every validation of their
# branch: one met release.sh's "a second cut" guard, the other wrote where AGENT_WORKFORCE_HOME pointed.
#
# What a cut's step 3 has that an ordinary run does not:
#   - AGENT_WORKFORCE_HOME exported (release.sh: the cut-only home, an empty folder under TMPDIR);
#   - a live `bash tools/release.sh` that is NOT an ancestor of the tests: the machine-claim renewer release.sh starts
#     at every step (#5134, `_cut_renew_start`) is a backgrounded subshell, so it carries the cut's own command line.
#     It runs in a serial step 3 as in a parallel one. The cut guard's name arm (kosmos_running_lines) leaves out the
#     caller's ancestors, the cut among them, so the renewer is the cut a test's sandboxed release.sh can see.
# kosmos_cut_shape_run gives the command both: a fresh empty AGENT_WORKFORCE_HOME (a cut's own, if one is already
# exported, is kept), and a stand-in `bash tools/release.sh` that sleeps, started from a scratch folder.
# Not reproduced: the cut's marker (kosmos_mark_run, in the real $HOME/.cache/kosmos-run-markers) and its exported
# KOSMOS_RUN_COOKIE_CUT. A test that reads the marker arm alone (KOSMOS_CUT_PROBE replacing the name arm, with the real
# HOME) is not covered by this shape.
#
# ⚠️ THE STAND-IN IS VISIBLE TO THE WHOLE MACHINE. Every cut guard on the computer that runs it reads it as a cut,
# so another agent's suite or cut waits or refuses while it lives. That is why tools/run-tests.sh uses this only on
# GitHub's own runners (one job per runner): it refuses it outside CI and does not use it on a self-hosted runner.
#
# The scratch folder is made under BASE (default: TMPDIR). Outside CI (GITHUB_ACTIONS) the base MUST be inside a
# kt<digits> folder, run-tests.sh's sandbox shape: a process working there is a test fixture to every cut guard
# (process-fixture.sh), so the stand-in reads as a cut to nobody, and a base anywhere else is refused. On CI it must be
# OUTSIDE one (run-tests.sh puts it beside the sandbox), or the guard would not count it either.
# The stand-in watches the shell that started it and ends within a second of that shell going, removing the scratch
# folder as it goes, so a killed run leaves neither a cut nor a folder behind. When the command ends, red or green,
# kosmos_cut_shape_run stops the stand-in and removes the folder itself.

# kosmos_cut_shape_run [--base DIR] <command...>: run the command in a cut's shape; its exit status is the command's.
# 2 when the shape could not be set up (nothing was run).
kosmos_cut_shape_run() {
  # caller: the calling shell, read here (inside the ( ) below it would be the stand-in itself). bash 3.2 has no BASHPID,
  # so there it is $$, the top-level script, even when this is called from a subshell.
  local base="${TMPDIR:-/tmp}" dir standin rc=0 n=0 caller="${BASHPID:-$$}"
  if [ "${1:-}" = --base ]; then
    [ "$#" -ge 2 ] || { echo "cut-shape: --base needs a folder" >&2; return 2; }
    base="$2"; shift 2
  fi
  [ "$#" -gt 0 ] || { echo "cut-shape: no command to run" >&2; return 2; }
  base="${base%/}"
  case "$base" in /*) ;; *) echo "cut-shape: the scratch base must be an absolute path (got '$base')" >&2; return 2 ;; esac
  if [ "${GITHUB_ACTIONS:-}" != true ] && ! [[ "$base" =~ (^|/)(T|tmp)/kt[0-9]+(/|$) ]]; then
    echo "cut-shape: outside CI the scratch base must be inside a kt<digits> folder (got '$base'): a stand-in anywhere else reads as a live cut to every agent on this computer" >&2
    return 2
  fi
  dir="$(mktemp -d "$base/kosmos-cut-shape.XXXXXX")" || { echo "cut-shape: could not make a scratch folder under $base" >&2; return 2; }
  mkdir -p "$dir/home" "$dir/standin/tools" || { rm -rf "$dir"; echo "cut-shape: could not fill $dir" >&2; return 2; }
  # The stand-in: `bash tools/release.sh`, as a cut's command line starts. It ends when the shell that started it
  # does (that shell's pid, passed in), and then removes the scratch folder (passed in too, and checked by its name).
  # A signal (kosmos_cut_shape_run's own stop, or a tree kill that reaches the caller at the same moment) removes it too.
  printf '%s\n' '# #6977: a stand-in for a live cut (tools/lib/cut-shape.sh). It does nothing but wait.' \
    'gone() { cd / && case "$2" in */kosmos-cut-shape.?*) rm -rf "$2" ;; esac; }' \
    'trap "gone \"\$@\"; exit 0" TERM INT HUP' \
    'while kill -0 "$1" 2>/dev/null; do sleep 1; done' \
    'gone "$@"' > "$dir/standin/tools/release.sh"
  ( cd "$dir/standin" && exec bash tools/release.sh "$caller" "$dir" ) </dev/null >/dev/null 2>&1 &
  standin=$!
  # Wait (up to 5 s) until the process table shows it as the stand-in, so the command never starts before the cut does.
  while [ "$n" -lt 50 ]; do
    case "$(ps -ww -o command= -p "$standin" 2>/dev/null)" in "bash tools/release.sh"*) break ;; esac
    sleep 0.1; n=$((n + 1))
  done
  if [ "$n" -ge 50 ]; then
    kill "$standin" 2>/dev/null; wait "$standin" 2>/dev/null; rm -rf "$dir"
    echo "cut-shape: the stand-in cut did not start" >&2; return 2
  fi
  echo "cut-shape (#6977): running in a cut's shape: AGENT_WORKFORCE_HOME=${AGENT_WORKFORCE_HOME:-$dir/home}, stand-in cut pid $standin" >&2
  ( [ -n "${AGENT_WORKFORCE_HOME:-}" ] || export AGENT_WORKFORCE_HOME="$dir/home"; "$@" ) || rc=$?
  kill "$standin" 2>/dev/null; wait "$standin" 2>/dev/null
  rm -rf "$dir"
  return "$rc"
}
