#!/bin/bash
# Test for tools/lib/test-leak-guard.sh (kosmos#4273). Every check has an arm that
# must find the leak and a control that must not, so a check that always passes or
# always fails turns this red. launchctl is a stub on PATH: this test never loads a
# real launchd job (that is the leak it guards against).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/test-leak-guard.sh
. "$HERE/lib/test-leak-guard.sh"

work=$(mktemp -d "${TMPDIR:-/tmp}/tlg-4273.XXXXXX") || { echo "FAIL could not make a work dir"; exit 1; }
pids=()
cleanup() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill -KILL "$p" 2>/dev/null; done
  # The orphans started below are found by the path they carry, so none outlives this test.
  ps -Awwo pid=,command= 2>/dev/null | while read -r p rest; do
    case "$rest" in *"$work/"*) kill -KILL "$p" 2>/dev/null ;; esac
  done
  rm -rf "$work"
}
trap cleanup EXIT INT TERM
fail=0; checks=0
ok() { checks=$((checks + 1)); echo "ok   $1"; }
bad() { checks=$((checks + 1)); echo "FAIL $1"; fail=1; }

# --- family names ---------------------------------------------------------------
for pair in 'codex-forget-AbC123=codex-forget' 'tmp.ULxoc1RTFh=tmp' 'worlds-1704-aB3dE4=worlds' \
            'aoc-state.0LbKWm.polls=aoc-state.polls' 'aoc-state.7T8Nud.polls=aoc-state.polls' \
            'kosmos-flags-32868.txt=kosmos-flags.txt' 'kosmos-flags-97930.txt=kosmos-flags.txt' \
            'aw-buildheader-570-data-Qz9xKp=aw-buildheader-data' 'kts-Zx81Pq=kts' \
            'win32stop-Ab12Cd=win32stop' 'yarn--1790560282614-0=yarn' 'yarn--1790999999999-0=yarn' \
            'avatarverAbC123=avatarver' 'kosmos-newAb12Cd=kosmos-new' 'cli path-AbC123=cli path' \
            'readme=readme' 'status=status' 'logfile=logfile' 'codex-forget-abcdef=codex-forget' \
            'sweep2-8ydBNT=sweep2' 'win32s-AbC123=win32s' 'Ab12Cd=Ab12Cd' '-AbC123=(unnamed)'; do
  name=${pair%%=*}; want=${pair#*=}; got=$(leak_family "$name")
  [ "$got" = "$want" ] && ok "family of $name is $want" || bad "family of $name: got '$got', want '$want'"
done

# --- temp entries ---------------------------------------------------------------
root="$work/kt1"; mkdir -p "$root"
mkdir "$root/codex-forget-AbC123" "$root/codex-forget-DeF456" "$root/brand-new-Qw12Er" "$root/aoc-state.abcdef.polls"
: > "$root/tmp.ULxoc1RTFh"
printf '%s\n' '# allowed' 'codex-forget' '  tmp  # trailing comment' 'aoc-state.*.polls' 'gone-family' > "$work/allow"
out=$(leak_tmp_check "$root" "$work/allow"); rc=$?
[ "$rc" -eq 1 ] && ok "an unlisted family fails the check" || bad "an unlisted family: rc=$rc"
printf '%s\n' "$out" | grep -q 'brand-new (not on the allowlist; e.g. brand-new-Qw12Er)' && ok "the unlisted family is named, with a raw example" || bad "unlisted family not named: $out"
printf '%s\n' "$out" | grep -q -E 'x codex-forget|x aoc-state|x tmp ' && bad "an allowlisted family was reported: $out" || ok "allowlisted families (a name, a glob, a commented line) are not reported"
printf '%s\n' "$out" | grep -q 'note: 1 allowlisted families left nothing' && ok "listed families that left nothing are counted on one note line" || bad "no single note: $out"
rm -rf "$root/brand-new-Qw12Er"
leak_tmp_check "$root" "$work/allow" > /dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "only allowlisted families left: clean" || bad "allowlisted-only root: rc=$rc"
mkdir -- "$root/-AbC123"
out=$(leak_tmp_check "$root" "$work/allow"); rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q '(unnamed)'; then ok "an entry that normalises to nothing is reported, not skipped"; else bad "unnamed entry: rc=$rc out=$out"; fi
rm -rf -- "$root/-AbC123"
leak_tmp_check "$work/no-such-root" "$work/allow" > /dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "a missing root is clean, not an error" || bad "missing root: rc=$rc"

# --- processes ------------------------------------------------------------------
proot="$work/kt2"; mkdir -p "$proot/fixture"
# A long-lived process that keeps its fixture path in its command line, as a leaked
# server does (an `exec sleep` would drop the path and model nothing).
printf '#!/bin/sh\nwhile :; do sleep 1; done\n' > "$proot/fixture/serve.sh"; chmod +x "$proot/fixture/serve.sh"
# ORPHANS (parent pid 1), as a leak is once the test that started it has exited: each
# subshell exits at once, so launchd adopts its child.
# Their stdio goes to /dev/null: an orphan holding this test's stdout would keep any
# pipe reading it open forever.
( /bin/sh "$proot/fixture/serve.sh" > /dev/null 2>&1 < /dev/null & )
# NOT orphaned: still this shell's child, like an operator's `tail -f` on a log in the root.
/bin/sh "$proot/fixture/serve.sh" > /dev/null 2>&1 & owned=$!; pids+=("$owned")
sleep 60 > /dev/null 2>&1 & outside=$!; pids+=("$outside")
sleep 0.5
out=$(leak_process_check "$proot"); rc=$?
[ "$rc" -eq 1 ] && ok "an orphaned process naming the root fails the check" || bad "leaked process: rc=$rc out=$out"
n=$(printf '%s\n' "$out" | grep -c '^process ')
[ "$n" -eq 1 ] && ok "exactly the one orphan is found" || bad "expected 1 leaked process, found $n: $out"
sleep 1.5
left=$(ps -Awwo pid=,ppid=,command= | awk '$2 == 1' | grep -F -c -- "$proot/" || true)
[ "$left" -eq 0 ] && ok "the leaked processes were stopped" || bad "$left leaked process(es) still running"
kill -0 "$owned" 2>/dev/null && ok "a process something alive still owns is left alone (control)" || bad "the guard killed an owned process"
kill -0 "$outside" 2>/dev/null && ok "a process outside the root is left alone (control)" || bad "the guard killed a process outside the root"
kill -KILL "$owned" 2>/dev/null
# An orphan that is on its way out (a child the last test signalled and did not wait for)
# is not a leak: it is judged only if still there a second after the first look.
printf '#!/bin/sh\nsleep 0.4\n' > "$proot/fixture/brief.sh"
( /bin/sh "$proot/fixture/brief.sh" > /dev/null 2>&1 < /dev/null & )
sleep 0.1
out=$(leak_process_check "$proot"); rc=$?
[ "$rc" -eq 0 ] && ok "an orphan that exits within the grace is not reported" || bad "a short-lived orphan was reported as a leak: rc=$rc out=$out"
out=$(leak_process_check "$proot"); rc=$?
[ "$rc" -eq 0 ] && ok "no leaked process: clean" || bad "clean process check: rc=$rc out=$out"

# --- launchd (stubbed) ----------------------------------------------------------
lroot="$work/kt3"; mkdir -p "$lroot"
lreal=$(cd "$lroot" && pwd -P)
stub="$work/bin"; mkdir -p "$stub"
# launchd reports the RESOLVED plist path: on macOS $TMPDIR is /var/..., a symlink to
# /private/var/..., so the stub reports the resolved spelling, as the real one does.
cat > "$stub/launchctl" <<EOF
#!/bin/bash
case "\$1" in
  list) printf 'PID\tStatus\tLabel\n'; cat "$work/labels" ;;
  print) case "\$2" in
           */com.kosmos.agent.leak) printf '{\n\tpath = $lreal/rx/leak.plist\n}\n' ;;
           */com.kosmos.agent.josh) printf '{\n\tpath = $lreal/sandbox/com.kosmos.agent.josh.plist\n}\n' ;;
           */com.apple.replaced) printf '{\n\tpath = $lreal/other.plist\n}\n' ;;
           */com.kosmos.agent.real) printf '{\n\tpath = $HOME/Library/LaunchAgents/com.kosmos.agent.real.plist\n}\n' ;;
         esac ;;
  bootout) echo "\$2" >> "$work/booted" ;;
esac
EOF
chmod +x "$stub/launchctl"
printf -- '-\t0\tcom.apple.x\n' > "$work/labels"
PATH="$stub:$PATH" leak_labels_snapshot > "$work/before"
printf -- '-\t0\tcom.apple.x\n-\t78\tcom.kosmos.agent.leak\n-\t0\tcom.kosmos.agent.real\n' > "$work/labels"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before" "$lroot"); rc=$?
[ "$rc" -eq 1 ] && ok "a new job whose plist is under the root (reported by its resolved path) fails the check" || bad "leaked job: rc=$rc out=$out"
grep -qx "gui/$(id -u)/com.kosmos.agent.leak" "$work/booted" 2>/dev/null && ok "the leaked job was booted out" || bad "the leaked job was not booted out"
grep -q 'com.kosmos.agent.real' "$work/booted" 2>/dev/null && bad "a job outside the root was booted out" || ok "a new job outside the root is left alone (control)"
printf -- '-\t0\tcom.apple.x\n-\t0\tcom.kosmos.agent.real\n' > "$work/labels"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before" "$lroot"); rc=$?
[ "$rc" -eq 0 ] && ok "no leaked job: clean" || bad "clean launchd check: rc=$rc out=$out"

# A job loaded BEFORE the run that a test REPLACED with one whose plist is under the root
# (the engine's reinstall path over the operator's own com.kosmos.agent.josh).
printf -- '-\t0\tcom.apple.x\n-\t0\tcom.kosmos.agent.josh\n' > "$work/labels"
PATH="$stub:$PATH" leak_labels_snapshot > "$work/before-josh"
: > "$work/booted"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before-josh" "$lroot"); rc=$?
if [ "$rc" -eq 1 ] && grep -qx "gui/$(id -u)/com.kosmos.agent.josh" "$work/booted" && printf '%s\n' "$out" | grep -q 'REPLACED'; then
  ok "a pre-loaded com.kosmos job replaced by one under the root fails, is booted out, and says it replaced a job"
else bad "replaced pre-loaded job: rc=$rc out=$out booted=$(cat "$work/booted")"; fi
# Control: a pre-loaded job of anyone else's is not judged (only com.kosmos.* and new ones are).
printf -- '-\t0\tcom.apple.replaced\n' > "$work/labels"
PATH="$stub:$PATH" leak_labels_snapshot > "$work/before-other"; : > "$work/booted"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before-other" "$lroot"); rc=$?
[ "$rc" -eq 0 ] && [ ! -s "$work/booted" ] && ok "a pre-loaded job outside com.kosmos is not judged (control)" || bad "a pre-loaded non-kosmos job was judged: rc=$rc out=$out"

# A new job whose plist path cannot be read is named on a note line, not passed silently.
printf -- '-\t0\tcom.apple.x\n-\t0\tcom.kosmos.agent.nopath\n' > "$work/labels"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before" "$lroot"); rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q 'note: new launchd job com.kosmos.agent.nopath: no plist path read'; then ok "a new job with no readable plist path is named on a note"; else bad "unreadable plist path: rc=$rc out=$out"; fi
printf -- '-\t0\tcom.apple.x\n-\t0\tcom.apple.mdworker.shared.0B00\n' > "$work/labels"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before" "$lroot"); rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "macOS's own plist-less jobs (mdworker) make no note (control)" || bad "a com.apple job made noise: rc=$rc out=$out"

# The REAL launchctl, through the guard's own parse (leak_plist_path): it must find a plist path for this Mac's own jobs.
# If launchctl's output changes shape this goes red, instead of every leak reading clean.
if command -v launchctl > /dev/null 2>&1 && launchctl list > /dev/null 2>&1; then
  # Only a job whose `launchctl print` says ANYTHING can judge the parse: with no jobs, or
  # no GUI domain (an SSH session, a CI runner), there is nothing to read, which is not a
  # format change. Red only when jobs printed and not one yielded a path.
  parsed=0; printed=0; tried=0
  while IFS= read -r l; do
    [ "$tried" -ge 40 ] && break
    tried=$((tried + 1))
    launchctl print "gui/$(id -u)/$l" 2>/dev/null | grep -q . || continue
    printed=$((printed + 1))
    p=$(leak_plist_path "$(id -u)" "$l")
    case "$p" in /*.plist) parsed=$((parsed + 1)) ;; esac
  done < <(leak_labels_snapshot)
  if [ "$printed" -eq 0 ]; then
    echo "skip the real-launchctl parse check ($tried jobs listed, none printable in gui/$(id -u) here)"
  elif [ "$parsed" -gt 0 ]; then
    ok "the plist-path parse works on this Mac's real launchctl ($parsed of $printed printable jobs)"
  else
    bad "no plist path parsed from $printed printable jobs: launchctl print's output format changed"
  fi
else
  echo "skip the real-launchctl parse check (no launchctl here)"
fi

# --- the whole guard, as run-tests.sh calls it ----------------------------------
groot="$work/kt4"; mkdir -p "$groot"
printf -- '-\t0\tcom.apple.x\n' > "$work/labels"
PATH="$stub:$PATH" leak_labels_snapshot > "$groot/tl-labels.AbCdEfGhIj"
printf '%s\n' 'codex-forget' > "$work/allow2"
mkdir "$groot/codex-forget-AbC123"
out=$(PATH="$stub:$PATH" leak_guard_after_suite "$groot/tl-labels.AbCdEfGhIj" "$groot" "$work/allow2"); rc=$?
[ "$rc" -eq 0 ] && ok "a clean run passes, and the guard's own labels file is not counted as a leak" || bad "clean whole guard: rc=$rc out=$out"
[ -e "$groot/tl-labels.AbCdEfGhIj" ] && bad "the labels file was left behind" || ok "the labels file is removed once used"
mkdir "$groot/new-leak-Qw12Er"
out=$(PATH="$stub:$PATH" leak_guard_after_suite "" "$groot" "$work/allow2"); rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q 'new-leak'; then ok "a leak fails the whole guard even with no labels snapshot"; else bad "whole guard leak: rc=$rc out=$out"; fi

# --- an INTERRUPTED run: run-tests.sh's own exit trap boots out this run's job -----
# The trap line is taken from run-tests.sh and run in a child bash that is sent SIGTERM
# mid-"suite", with the labels snapshot still unused, as an interrupted run leaves it.
trap_line=$(grep -m1 "^  trap '.*leak_launchd_check.*' EXIT$" "$HERE/run-tests.sh" | sed 's/^  //')
if [ -z "$trap_line" ]; then
  bad "run-tests.sh has no exit trap that runs leak_launchd_check"
else
  for arm in unused used; do
    iroot="$work/kt5-$arm"; mkdir -p "$iroot"; : > "$work/booted"
    printf -- '-\t0\tcom.apple.x\n' > "$work/labels"
    PATH="$stub:$PATH" leak_labels_snapshot > "$iroot/tl-labels.snap"
    printf -- '-\t0\tcom.apple.x\n-\t78\tcom.kosmos.agent.leak\n' > "$work/labels"
    # The stub reports the leak job's plist under $lreal; point this arm's root there.
    [ "$arm" = used ] && rm -f "$iroot/tl-labels.snap"
    PATH="$stub:$PATH" /bin/bash -c ". '$HERE/lib/test-leak-guard.sh'; KOSMOS_RUN_TMPDIR='$lroot'; _tl_labels_before='$iroot/tl-labels.snap'; mkdir -p '$lroot'; $trap_line
      kill -TERM \$\$; sleep 5" > /dev/null 2>&1
    if [ "$arm" = unused ]; then
      grep -qx "gui/$(id -u)/com.kosmos.agent.leak" "$work/booted" && ok "an interrupted run's exit trap boots out its job" || bad "the exit trap did not boot out the job on SIGTERM"
      [ -e "$lroot" ] && bad "the exit trap left the run root" || ok "the exit trap still removes the run root"
    else
      [ -s "$work/booted" ] && bad "the exit trap booted out a job after the guard had already run" || ok "after the guard ran (snapshot used), the trap boots out nothing (control)"
    fi
  done
fi

# --- run-tests.sh really calls it, after the suite ------------------------------
rt="$HERE/run-tests.sh"
suite_line=$(grep -n '^node --test ' "$rt" | head -1 | cut -d: -f1)
guard_line=$(grep -n 'leak_guard_after_suite "' "$rt" | head -1 | cut -d: -f1)
if [ -n "$suite_line" ] && [ -n "$guard_line" ] && [ "$guard_line" -gt "$suite_line" ]; then
  ok "run-tests.sh calls leak_guard_after_suite after the suite (line $guard_line > $suite_line)"
else
  bad "run-tests.sh does not call leak_guard_after_suite after the suite (suite=$suite_line guard=$guard_line)"
fi
grep -q 'leak_labels_snapshot > "$_tl_labels_before"' "$rt" && ok "run-tests.sh snapshots the labels before the suite" || bad "run-tests.sh does not snapshot the labels"

echo "$checks checks"
if [ "$fail" -ne 0 ]; then echo "test-test-leak-guard-4273: FAIL"; exit 1; fi
echo "test-test-leak-guard-4273: PASS"
