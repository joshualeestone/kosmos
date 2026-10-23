#!/usr/bin/env bash
# test-cut-shape-6977.sh - kosmos#6977: CI's shell shards run in a cut's shape (tools/lib/cut-shape.sh), so a shell test
# that fails only inside a cut fails on its pull request instead of at a cut's step 3 (0.7.64 aborted twice that way).
#
#   R  a command that fails only in a cut's shape (it needs AGENT_WORKFORCE_HOME unset) FAILS under kosmos_cut_shape_run;
#      CONTROL: the same command outside it passes; a cut-neutral command passes under it; an exit status comes back as is.
#   H  inside: AGENT_WORKFORCE_HOME is an absolute, empty folder under the base; one already exported is kept; afterwards
#      the scratch folder is gone, after a red run too.
#   S  inside: the stand-in `bash tools/release.sh` is live; afterwards it is gone (green and red); and it ends by itself
#      when the shell that started it is killed.
#   F  the arms above put the scratch folder in a kt<pid> sandbox, so the cut guard counts the stand-in as a test
#      fixture: running this test never reads as a cut to another agent on the same computer.
#   G  GitHub-hosted CI only (GITHUB_ACTIONS=true, RUNNER_ENVIRONMENT=github-hosted): with the scratch folder outside any sandbox, the cut guard counts THIS stand-in (by
#      its pid) as a cut and refuses; CONTROL: after the shape it no longer lists that pid. (On CI the test itself runs
#      inside run-tests.sh's shape, whose own stand-in makes the guard refuse either way, so G keys on the pid.)
#   W  the wiring: run-tests.sh refuses the flag outside CI (its flag check, lifted and run alone: behavioural). That the
#      shell part goes through kosmos_cut_shape_run when the flag is set, not on a self-hosted runner, and that test.yml
#      sets it for the shell jobs only, is checked in the source text (structural: running it here would start a
#      stand-in on this computer).
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib/cut-shape.sh"
GUARD="$HERE/lib/cut-guard.sh"
for f in "$LIB" "$GUARD" "$HERE/run-tests.sh" "$HERE/../.github/workflows/test.yml"; do [ -f "$f" ] || { echo "FAIL: $f not found"; exit 1; }; done
. "$LIB"

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }

# The base: a kt<pid> folder under TMPDIR, the run-tests.sh sandbox shape (process-fixture.sh), so the stand-in is a
# fixture to every cut guard on this computer (arm F checks that).
T="${TMPDIR:-/tmp}"; T="${T%/}/kt$$"
# Every agent's guard drops a fixture by the machine-wide pattern alone; under a TMPDIR that does not give one (its
# folder not named T or tmp) this test's own stand-ins would read as a cut to the other agents here, so it stops.
[[ "$T" =~ ${_KOSMOS_KT_RE:-(^|/)(T|tmp)/kt[0-9]+(/|$)} ]] || { echo "SKIP  all: TMPDIR '${TMPDIR:-}' gives no kt<digits> sandbox every agent's guard recognises (its folder is not named T or tmp); run with a standard TMPDIR"; exit 0; }
mkdir -p "$T" || { echo "FAIL: could not make $T"; exit 1; }
trap 'rm -rf "$T"' EXIT
unset AGENT_WORKFORCE_HOME

leftovers() { ls -d "$T"/kosmos-cut-shape.* 2>/dev/null | wc -l | tr -d ' '; }
# How many stand-ins from THIS test are live: a `bash tools/release.sh <pid>` working in one of its scratch folders. A
# script, so the same count runs inside the shape (as its command) and outside it.
COUNT="$T/count-standins.sh"
printf '%s\n' 'pgrep -f "^bash tools/release\.sh [0-9]+ " 2>/dev/null | while read -r p; do' \
  "  lsof -a -p \"\$p\" -d cwd -Fn 2>/dev/null | grep -q '/kt$$/kosmos-cut-shape\\.' && echo \"\$p\"" \
  'done | wc -l | tr -d " "' > "$COUNT"
standins() { bash "$COUNT"; }

# --- R ---------------------------------------------------------------------------------------------------------------
cut_only='[ -z "${AGENT_WORKFORCE_HOME:-}" ]'   # the 0.7.64 #6922 class: passes only when the variable is unset
kosmos_cut_shape_run --base "$T" sh -c "$cut_only" 2>/dev/null; rc=$?
[ "$rc" -ne 0 ] && pass "R: a test that fails only in a cut fails under the shape (rc=$rc)" || bad "R: the cut-only test passed under the shape"
sh -c "$cut_only"; rc=$?
[ "$rc" -eq 0 ] && pass "R CONTROL: the same test passes outside the shape" || bad "R CONTROL: it failed outside the shape too (rc=$rc), so R proves nothing"
kosmos_cut_shape_run --base "$T" sh -c 'exit 0' 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && pass "R: a cut-neutral test passes under the shape" || bad "R: a cut-neutral test failed under the shape (rc=$rc)"
kosmos_cut_shape_run --base "$T" sh -c 'exit 3' 2>/dev/null; rc=$?
[ "$rc" -eq 3 ] && pass "R: the command's own exit status comes back (3)" || bad "R: exit 3 came back as $rc"
kosmos_cut_shape_run --base relative sh -c 'exit 0' 2>/dev/null; rc=$?
[ "$rc" -eq 2 ] && pass "R: a relative base is refused (2), nothing run" || bad "R: a relative base gave $rc"
kosmos_cut_shape_run --base "$T" 2>/dev/null; rc=$?
[ "$rc" -eq 2 ] && pass "R: no command is refused (2)" || bad "R: no command gave $rc"
kosmos_cut_shape_run --base 2>/dev/null; rc=$?
[ "$rc" -eq 2 ] && pass "R: --base with no folder is refused (2)" || bad "R: --base with no folder gave $rc"
# Outside CI a base that is not a kt<digits> sandbox is refused BEFORE any stand-in starts (it would read as a cut to
# every agent here); CONTROL: the same call with the kt base above runs.
# Under run-tests.sh TMPDIR is itself a kt sandbox, so the base comes from /tmp, and is checked to be outside one first.
NK=$(mktemp -d "/tmp/cutshape-nokt.XXXXXX")
_kosmos_path_in_kt_sandbox "$NK" && bad "R: (the outside-a-sandbox base $NK reads as a sandbox, so the next two arms prove nothing)" \
  || pass "R: (the base for the next two arms is outside any kt sandbox: $NK)"
out=$(env -u GITHUB_ACTIONS bash -c ". '$LIB'; kosmos_cut_shape_run --base '$NK' sh -c 'echo RAN'" 2>&1); rc=$?
[ "$rc" -eq 2 ] && ! printf '%s' "$out" | grep -q RAN && [ -z "$(ls -A "$NK")" ] \
  && pass "R: outside CI a base outside a kt sandbox is refused (2), nothing run, nothing made" || bad "R: a non-kt base outside CI gave rc=$rc: $out"
out=$(GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=self-hosted bash -c ". '$LIB'; kosmos_cut_shape_run --base '$NK' sh -c 'echo RAN'" 2>&1); rc=$?
[ "$rc" -eq 2 ] && ! printf '%s' "$out" | grep -q RAN && [ -z "$(ls -A "$NK")" ] \
  && pass "R: on a self-hosted runner (a shared computer) a base outside a kt sandbox is refused too" || bad "R: a self-hosted runner let a non-kt base through (rc=$rc): $out"
out=$(GITHUB_ACTIONS=true bash -c "unset RUNNER_ENVIRONMENT; . '$LIB'; kosmos_cut_shape_run --base '$NK' sh -c 'echo RAN'" 2>&1); rc=$?
[ "$rc" -eq 2 ] && ! printf '%s' "$out" | grep -q RAN \
  && pass "R: on CI with no runner environment named (an older self-hosted runner) it is refused too" || bad "R: CI with RUNNER_ENVIRONMENT unset let a non-kt base through (rc=$rc): $out"
# A kt<digits> folder that is a sandbox only RELATIVE TO THE CALLER'S TMPDIR (process-fixture.sh's second branch) is not
# one to another agent, whose guard has its own TMPDIR: refused.
mkdir -p "$NK/kt9"
out=$(env -u GITHUB_ACTIONS TMPDIR="$NK" bash -c ". '$LIB'; kosmos_cut_shape_run --base '$NK/kt9' sh -c 'echo RAN'" 2>&1); rc=$?
[ "$rc" -eq 2 ] && ! printf '%s' "$out" | grep -q RAN && [ -z "$(ls -A "$NK/kt9")" ] \
  && pass "R: a kt folder that is a sandbox only to the caller's own TMPDIR is refused (another agent's guard would count it)" || bad "R: a caller-relative kt folder was let through (rc=$rc): $out"
rmdir "$NK/kt9" "$NK" 2>/dev/null
out=$(env -u GITHUB_ACTIONS bash -c ". '$LIB'; kosmos_cut_shape_run --base '$T' sh -c 'echo RAN'" 2>/dev/null); rc=$?
[ "$rc" -eq 0 ] && [ "$out" = RAN ] && pass "R CONTROL: the same call with a kt base runs" || bad "R CONTROL: a kt base outside CI did not run (rc=$rc, '$out')"

# --- H ---------------------------------------------------------------------------------------------------------------
inside=$(kosmos_cut_shape_run --base "$T" sh -c 'h="${AGENT_WORKFORCE_HOME:-}"; [ -d "$h" ] && n=$(ls -A "$h" | wc -l | tr -d " ") || n=missing; echo "$h $n"' 2>/dev/null)
h="${inside% *}"; n="${inside##* }"
case "$h" in "$T"/kosmos-cut-shape.*/home) pass "H: AGENT_WORKFORCE_HOME is a folder under the base ($h)" ;; *) bad "H: AGENT_WORKFORCE_HOME was '$h'" ;; esac
[ "$n" = 0 ] && pass "H: and it is empty, as a cut's cut-only home is" || bad "H: it held $n entries"
[ -n "$h" ] && [ ! -e "$h" ] && [ "$(leftovers)" = 0 ] && pass "H: the scratch folder is gone afterwards" || bad "H: the scratch folder was left ($(leftovers))"
kept=$(AGENT_WORKFORCE_HOME=/a/cut/own/home kosmos_cut_shape_run --base "$T" sh -c 'echo "$AGENT_WORKFORCE_HOME"' 2>/dev/null)
[ "$kept" = /a/cut/own/home ] && pass "H: a cut's own AGENT_WORKFORCE_HOME is kept" || bad "H: an exported AGENT_WORKFORCE_HOME became '$kept'"
kosmos_cut_shape_run --base "$T" sh -c 'exit 1' 2>/dev/null
[ "$(leftovers)" = 0 ] && pass "H: nothing is left after a red run either" || bad "H: a red run left $(leftovers) scratch folders"

# --- S ---------------------------------------------------------------------------------------------------------------
seen=$(kosmos_cut_shape_run --base "$T" bash "$COUNT" 2>/dev/null)
[ "$seen" = 1 ] && pass "S: inside, one stand-in 'bash tools/release.sh' is live, working in the scratch folder" || bad "S: inside, $seen stand-ins were live"
[ "$(standins)" = 0 ] && pass "S: afterwards it is gone" || bad "S: afterwards $(standins) stand-in(s) still live"
kosmos_cut_shape_run --base "$T" sh -c 'exit 5' 2>/dev/null
[ "$(standins)" = 0 ] && pass "S: and gone after a red run" || bad "S: a red run left $(standins) stand-in(s)"
# A run killed outright (no chance to clean up): the stand-in watches the shell that started it, and ends.
bash -c ". '$LIB'; kosmos_cut_shape_run --base '$T' sleep 8" 2>/dev/null & runner=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$(standins)" = 1 ] && break; sleep 0.3; done
[ "$(standins)" = 1 ] && pass "S: (the killed-run case started its stand-in)" || bad "S: the killed-run case's stand-in never started"
kill -9 "$runner" 2>/dev/null; wait "$runner" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ "$(standins)" = 0 ] && break; sleep 0.3; done
[ "$(standins)" = 0 ] && pass "S: when the run is killed outright, the stand-in ends by itself" || bad "S: the stand-in outlived a killed run"
for _ in 1 2 3 4 5 6; do [ "$(leftovers)" = 0 ] && break; sleep 0.3; done
[ "$(leftovers)" = 0 ] && pass "S: and it removes the scratch folder as it goes" || bad "S: a killed run left its scratch folder ($(leftovers))"

# A signal that reaches the stand-in while the command runs ends it but must not take the command's home with it.
SIG="$T/signal-probe.sh"
printf '%s\n' "sp=\$(pgrep -f '^bash tools/release\\.sh [0-9]+ ' | while read -r p; do lsof -a -p \"\$p\" -d cwd -Fn 2>/dev/null | grep -q '/kt$$/kosmos-cut-shape\\.' && echo \"\$p\"; done | head -1)" \
  'kill -TERM "$sp" 2>/dev/null; sleep 1.5; [ -d "$AGENT_WORKFORCE_HOME" ] && echo kept || echo gone' > "$SIG"
sig=$(kosmos_cut_shape_run --base "$T" bash "$SIG" 2>/dev/null)
[ "$sig" = kept ] && pass "S: a signal to the stand-in mid-run leaves the command's AGENT_WORKFORCE_HOME in place" || bad "S: a signal to the stand-in took the command's home ($sig)"
[ "$(leftovers)" = 0 ] && pass "S: and the folder is still removed when the command ends" || bad "S: after a signalled stand-in the folder was left ($(leftovers))"

# --- F ---------------------------------------------------------------------------------------------------------------
# Both halves, or the second could pass because the guard never saw the stand-in at all: the guard's process match
# lists it, and the fixture filter then drops it, as ANOTHER agent's guard runs it (TMPDIR unset, so only the
# machine-wide pattern decides). The stand-in's pid is the one working in this test's scratch folder.
FIX="$T/fixture-probe.sh"
printf '%s\n' ". '$GUARD'" "sp=\$(pgrep -f '^bash tools/release\\.sh [0-9]+ ' | while read -r p; do lsof -a -p \"\$p\" -d cwd -Fn 2>/dev/null | grep -q '/kt$$/kosmos-cut-shape\\.' && echo \"\$p\"; done | head -1)" \
  'raw=$(kosmos_running_lines tools/release.sh | grep -c "^$sp ")' \
  'kept=$(unset TMPDIR; kosmos_running_lines tools/release.sh | _kosmos_drop_test_fixtures | grep -c "^$sp ")' \
  'echo "$sp $raw $kept"' > "$FIX"
read -r fsp fraw fkept <<< "$(kosmos_cut_shape_run --base "$T" bash "$FIX" 2>/dev/null)"
[ -n "$fsp" ] && [ "$fraw" = 1 ] && pass "F: the cut guard's process match lists the stand-in (pid $fsp)" || bad "F: the guard's process match did not list the stand-in (pid '${fsp:-none}', raw $fraw), so the next line proves nothing"
[ "$fkept" = 0 ] && pass "F: in a kt<pid> sandbox it is then dropped as a test fixture (no other agent sees a cut)" \
  || bad "F: the cut guard kept this test's stand-in as a cut ($fkept): other agents on this computer would see one"

# --- G (CI only) -----------------------------------------------------------------------------------------------------
# On CI this test itself runs inside run-tests.sh's cut shape, so the guard already sees that outer stand-in and refuses
# either way. So G asks about THIS stand-in by its pid: the cut guard counts it as a cut inside (not dropped as a
# fixture, since its folder is outside any sandbox), and it is gone from the guard's list after.
if [ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ]; then
  B=$(mktemp -d "/tmp/cutshape6977.XXXXXX")
  GP="$B/guard-probe.sh"
  printf '%s\n' ". '$GUARD'" \
    "sp=\$(pgrep -f '^bash tools/release\\.sh [0-9]+ ' | while read -r p; do lsof -a -p \"\$p\" -d cwd -Fn 2>/dev/null | grep -q '$B/kosmos-cut-shape\\.' && echo \"\$p\"; done | head -1)" \
    'n=$(kosmos_running_lines tools/release.sh | _kosmos_drop_test_fixtures | grep -c "^$sp ")' \
    'KOSMOS_RUN_MARKER_DIR="'"$B"'/markers" kosmos_refuse_if_cut_live "this probe" >/dev/null 2>&1; echo "$sp $n $?"' > "$GP"
  read -r gsp gn grc <<< "$(kosmos_cut_shape_run --base "$B" bash "$GP" 2>/dev/null)"
  [ -n "$gsp" ] && [ "$gn" = 1 ] && pass "G: the cut guard counts this stand-in (pid $gsp) as a cut" || bad "G: the cut guard did not count this stand-in (pid '${gsp:-none}', counted $gn)"
  # Not a discriminating check on CI (the outer stand-in makes it refuse either way): a sanity line, the pid one above counts.
  [ "$grc" != 0 ] && pass "G (sanity, not coverage): release.sh's cut guard refuses inside the shape" || bad "G: the cut guard did not refuse inside the shape"
  after=$(bash -c ". '$GUARD'; kosmos_running_lines tools/release.sh | _kosmos_drop_test_fixtures" | grep -c "^${gsp:-none} ")
  [ -n "$gsp" ] && [ "$after" = 0 ] && pass "G CONTROL: after the shape the guard no longer lists it" || bad "G CONTROL: the guard still lists pid ${gsp:-none} after the shape ($after)"
  rm -rf "${B:?}"
else
  echo "SKIP  G: GitHub-hosted CI only. Outside a sandbox the stand-in reads as a cut to every agent on this computer."
fi

# --- W ---------------------------------------------------------------------------------------------------------------
RT="$HERE/run-tests.sh"; Y="$HERE/../.github/workflows/test.yml"
n=$(grep -c '\${_rt_shell_wrap\[@\]+"\${_rt_shell_wrap\[@\]}"} node "\$REPO/tools/shell-shard.js" run' "$RT")
[ "$n" = 2 ] && pass "W: both of run-tests.sh's shell-part calls go through the wrap" || bad "W: $n of run-tests.sh's shell-shard calls go through the wrap (want 2)"
grep -q '_rt_shell_wrap=(kosmos_cut_shape_run --base' "$RT" && grep -q 'KOSMOS_SHELL_CUT_ENV:-0}" = 1' "$RT" \
  && pass "W: the wrap is kosmos_cut_shape_run, set when KOSMOS_SHELL_CUT_ENV=1" || bad "W: run-tests.sh does not set the wrap from KOSMOS_SHELL_CUT_ENV"
# The flag check, lifted from run-tests.sh and run alone, so a regression here can never start the suite (or a stand-in
# on this computer): from its comment line to the first `esac` after it.
FC="$T/flag-check.sh"
awk '/^# #6977: KOSMOS_SHELL_CUT_ENV=1 runs the shell part/{f=1} f{print} f&&/^esac$/{exit}' "$RT" > "$FC"
grep -q 'KOSMOS_SHELL_CUT_ENV must be 0 or 1' "$FC" && pass "W: (the flag check was lifted from run-tests.sh)" || bad "W: could not lift the flag check from run-tests.sh"
out=$(env -u GITHUB_ACTIONS KOSMOS_SHELL_CUT_ENV=1 bash "$FC" 2>&1); rc=$?
[ "$rc" = 2 ] && printf '%s' "$out" | grep -q 'KOSMOS_SHELL_CUT_ENV=1 is for CI only' && pass "W: run-tests.sh refuses KOSMOS_SHELL_CUT_ENV=1 outside CI (2)" || bad "W: outside CI the flag was not refused (rc=$rc): $out"
out=$(GITHUB_ACTIONS=true KOSMOS_SHELL_CUT_ENV=1 bash "$FC" 2>&1); rc=$?
[ "$rc" = 0 ] && pass "W CONTROL: on CI the flag is let through" || bad "W CONTROL: on CI the flag was refused too (rc=$rc), so the refusal above proves nothing: $out"
out=$(KOSMOS_SHELL_CUT_ENV=yes bash "$FC" 2>&1); rc=$?
[ "$rc" = 2 ] && printf '%s' "$out" | grep -q 'KOSMOS_SHELL_CUT_ENV must be 0 or 1' && pass "W: a value other than 0 or 1 is refused" || bad "W: KOSMOS_SHELL_CUT_ENV=yes was not refused (rc=$rc): $out"
grep -q 'KOSMOS_SHELL_CUT_ENV:-0}" = 1 \] && \[ "\${RUNNER_ENVIRONMENT:-}" != github-hosted \]' "$RT" \
  && grep -q 'is used only on a GitHub-hosted runner' "$RT" \
  && pass "W: on a self-hosted runner (a shared computer) run-tests.sh does not use the shape, and says so" || bad "W: run-tests.sh would use the shape on a self-hosted runner"
grep -q "KOSMOS_SHELL_CUT_ENV: \${{ matrix.part == 'shell' && '1' || '0' }}" "$Y" \
  && pass "W: test.yml turns it on for the shell jobs only" || bad "W: test.yml does not set KOSMOS_SHELL_CUT_ENV for the shell jobs"

echo
[ "$fails" = 0 ] && { echo "test-cut-shape-6977: all passed"; exit 0; }
echo "test-cut-shape-6977: $fails failed"; exit 1
