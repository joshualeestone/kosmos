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
cleanup() { for p in "${pids[@]:-}"; do [ -n "$p" ] && kill -KILL "$p" 2>/dev/null; done; rm -rf "$work"; }
trap cleanup EXIT INT TERM
fail=0; checks=0
ok() { checks=$((checks + 1)); echo "ok   $1"; }
bad() { checks=$((checks + 1)); echo "FAIL $1"; fail=1; }

# --- temp entries ---------------------------------------------------------------
root="$work/kt1"; mkdir -p "$root"
mkdir "$root/codex-forget-AbC123" "$root/codex-forget-DeF456" "$root/brand-new-Qw12Er"
: > "$root/tmp.ULxoc1RTFh"
printf '%s\n' '# allowed' 'codex-forget' 'tmp' 'gone-family' > "$work/allow"
out=$(leak_tmp_check "$root" "$work/allow"); rc=$?
[ "$rc" -eq 1 ] && ok "an unlisted family fails the check" || bad "an unlisted family: rc=$rc"
printf '%s\n' "$out" | grep -q 'brand-new (not on the allowlist)' && ok "the unlisted family is named" || bad "unlisted family not named: $out"
printf '%s\n' "$out" | grep -q 'codex-forget' && bad "an allowlisted family was reported: $out" || ok "allowlisted families are not reported"
printf '%s\n' "$out" | grep -q 'note: allowlisted family gone-family left nothing' && ok "a listed family that left nothing gets a tighten note" || bad "no tighten note: $out"
rm -rf "$root/brand-new-Qw12Er"
leak_tmp_check "$root" "$work/allow" > /dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "only allowlisted families left: clean" || bad "allowlisted-only root: rc=$rc"
leak_tmp_check "$work/no-such-root" "$work/allow" > /dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "a missing root is clean, not an error" || bad "missing root: rc=$rc"

# --- family names ---------------------------------------------------------------
for pair in 'codex-forget-AbC123=codex-forget' 'tmp.ULxoc1RTFh=tmp' 'worlds-1704-aB3dE4=worlds' \
            'aoc-state.0LbKWm.polls=aoc-state.polls' 'aoc-state.7T8Nud.polls=aoc-state.polls' \
            'aw-buildheader-570-data-Qz9xKp=aw-buildheader-570-data' 'kts-Zx81Pq=kts' \
            'win32stop-Ab12Cd=win32stop' 'yarn--1790560282614-0=yarn' 'yarn--1790999999999-0=yarn'; do
  name=${pair%%=*}; want=${pair#*=}; got=$(leak_family "$name")
  [ "$got" = "$want" ] && ok "family of $name is $want" || bad "family of $name: got '$got', want '$want'"
done

# --- processes ------------------------------------------------------------------
proot="$work/kt2"; mkdir -p "$proot/fixture"
# A long-lived process that keeps its fixture path in its command line, as a leaked
# server does (an `exec sleep` would drop the path and model nothing).
printf '#!/bin/sh\nwhile :; do sleep 1; done\n' > "$proot/fixture/serve.sh"; chmod +x "$proot/fixture/serve.sh"
/bin/sh "$proot/fixture/serve.sh" & inside=$!; pids+=("$inside")
sleep 60 & outside=$!; pids+=("$outside")
sleep 0.3
out=$(leak_process_check "$proot"); rc=$?
[ "$rc" -eq 1 ] && ok "a process whose command line names the root fails the check" || bad "leaked process: rc=$rc out=$out"
sleep 1.5
kill -0 "$inside" 2>/dev/null && bad "the leaked process is still running" || ok "the leaked process was stopped"
kill -0 "$outside" 2>/dev/null && ok "a process outside the root is left alone (control)" || bad "the guard killed a process outside the root"
out=$(leak_process_check "$proot"); rc=$?
[ "$rc" -eq 0 ] && ok "no leaked process: clean" || bad "clean process check: rc=$rc out=$out"

# --- launchd (stubbed) ----------------------------------------------------------
lroot="$work/kt3"; mkdir -p "$lroot"
stub="$work/bin"; mkdir -p "$stub"
cat > "$stub/launchctl" <<EOF
#!/bin/bash
case "\$1" in
  list) printf 'PID\tStatus\tLabel\n'; cat "$work/labels" ;;
  print) case "\$2" in
           */com.kosmos.agent.leak) printf '{\n\tpath = $lroot/rx/leak.plist\n}\n' ;;
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
[ "$rc" -eq 1 ] && ok "a new job whose plist is under the root fails the check" || bad "leaked job: rc=$rc out=$out"
grep -qx "gui/$(id -u)/com.kosmos.agent.leak" "$work/booted" 2>/dev/null && ok "the leaked job was booted out" || bad "the leaked job was not booted out"
grep -q 'com.kosmos.agent.real' "$work/booted" 2>/dev/null && bad "a job outside the root was booted out" || ok "a new job outside the root is left alone (control)"
printf -- '-\t0\tcom.apple.x\n-\t0\tcom.kosmos.agent.real\n' > "$work/labels"
out=$(PATH="$stub:$PATH" leak_launchd_check "$work/before" "$lroot"); rc=$?
[ "$rc" -eq 0 ] && ok "no leaked job: clean" || bad "clean launchd check: rc=$rc out=$out"

echo "$checks checks"
if [ "$fail" -ne 0 ]; then echo "test-test-leak-guard-4273: FAIL"; exit 1; fi
echo "test-test-leak-guard-4273: PASS"
