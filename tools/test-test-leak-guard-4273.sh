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
            'Ab12Cd=(unnamed)'; do
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
printf '%s\n' "$out" | grep -q 'brand-new (not on the allowlist)' && ok "the unlisted family is named" || bad "unlisted family not named: $out"
printf '%s\n' "$out" | grep -q -E 'x codex-forget|x aoc-state|x tmp ' && bad "an allowlisted family was reported: $out" || ok "allowlisted families (a name, a glob, a commented line) are not reported"
printf '%s\n' "$out" | grep -q 'note: 1 allowlisted families left nothing' && ok "listed families that left nothing are counted on one note line" || bad "no single note: $out"
rm -rf "$root/brand-new-Qw12Er"
leak_tmp_check "$root" "$work/allow" > /dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "only allowlisted families left: clean" || bad "allowlisted-only root: rc=$rc"
mkdir "$root/Ab12Cd"
out=$(leak_tmp_check "$root" "$work/allow"); rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q '(unnamed)'; then ok "an entry that normalises to nothing is reported, not skipped"; else bad "unnamed entry: rc=$rc out=$out"; fi
rm -rf "$root/Ab12Cd"
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
