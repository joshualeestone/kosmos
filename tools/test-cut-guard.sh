#!/bin/bash
# The live-cut guard shown red, green and unable to answer (#708).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/cut-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
# A pid proven dead at runtime (#4206 review 11). The guards now run a real lsof and ancestry walk on
# every candidate, so a fixed probe pid is only safe where it cannot be handed out: 99999 holds on
# macOS (pids stop at 99998) but not on Linux (pid_max is often 4194304). A reused pid would need the
# counter to wrap within this run.
( : ) & DEAD=$!; wait "$DEAD"
# #1796: isolate the run-marker dir so the always-on marker arm reads THIS test's
# fixtures, never a real marker a live run on this box may have left in the default
# /tmp dir. The existing arms below get an empty dir (marker arm inert); the marker
# arms at the end point it at populated fixtures.
export KOSMOS_RUN_MARKER_DIR="$T/markers-empty"; mkdir -p "$KOSMOS_RUN_MARKER_DIR"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
# A pid named in OUT as a whole number: plain has() would pass if pid 123 were only a substring of a
# sibling pid 91234 printed there instead (#4206 review 8).
has_pid() { case " $1 " in *[!0-9]"$2"[!0-9]*) return 0;; *) return 1;; esac; }
printf '#!/bin/sh\nprintf "'"$DEAD"' bash tools/release.sh 0.5.54\\n"\n' > "$T/probe-live"; chmod +x "$T/probe-live"
printf '#!/bin/sh\nexit 1\n' > "$T/probe-quiet"; chmod +x "$T/probe-quiet"
printf '#!/bin/sh\nexit 3\n' > "$T/probe-dead"; chmod +x "$T/probe-dead"
printf '#!/bin/sh\n[ "$1" = '"$DEAD"' ] && printf "node --test tools.release-gate.test.js\\nbash tools/run-tests.sh\\n"\n' > "$T/ancestor-fixture"; chmod +x "$T/ancestor-fixture"
printf '#!/bin/sh\nexit 0\n' > "$T/ancestor-none"; chmod +x "$T/ancestor-none"

out="$(KOSMOS_CUT_PROBE="$T/probe-live" kosmos_refuse_if_cut_live "a full run" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses while a cut is running"; else fail "refuses while a cut is running (rc=$rc)"; fi
if has "$out" "release.sh 0.5.54" && has "$out" "cut-suite-runs.log"; then pass "and names the cut and where its end is recorded"; else fail "and names the cut: $out"; fi
if has "$out" "KOSMOS_HARNESS_IGNORE_CUT=1"; then pass "and names the override"; else fail "and names the override: $out"; fi

# #4206: release-gate tests execute a real release.sh fixture. The process name
# is deliberately identical to a cut, so only its real node --test ancestry can
# distinguish the fixture. The same candidate without that ancestry remains the
# positive control for the load-bearing second-cut refusal.
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-fixture" KOSMOS_CUT_PROBE="$T/probe-live" kosmos_refuse_if_cut_live "a full run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a release.sh fixture beneath node --test does not impersonate a concurrent cut" \
  || fail "a node --test release fixture false-refused the cut (rc=$rc, out=$out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-live" kosmos_refuse_if_cut_live "a full run" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "the same release.sh without node --test ancestry still refuses as a real cut" \
  || fail "fixture filtering also hid a real concurrent cut (rc=$rc, out=$out)"

out="$(KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a full run" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "passes silently when no cut is running"; else fail "passes when no cut is running (rc=$rc, out=$out)"; fi

out="$(KOSMOS_CUT_PROBE="$T/probe-dead" kosmos_refuse_if_cut_live "a full run" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "could not tell"; then pass "a probe that cannot answer is a refusal, not a pass"; else fail "a probe that cannot answer is a refusal (rc=$rc, out=$out)"; fi


# --- self-exclusion (#1050): the guard is about to be wired into release.sh,
# --- and release.sh IS a `bash tools/release.sh`. Without these, the wiring
# --- refuses every cut on an idle Mac and reads as the guard working.
# ⚠️ The pid is baked into the probe, not passed as `FAKE_SELF=… func`: that
# form sets the variable for a FUNCTION, and does not export it to the probe
# the function then runs, so the fixture emitted a LINE WITH NO PID and the
# exclusion had nothing to match. The test failed while the code was correct.
printf '#!/bin/sh\nprintf "4242 bash tools/release.sh 0.5.99\\n"\n' > "$T/probe-self"; chmod +x "$T/probe-self"
out="$(KOSMOS_CUT_SELF_PID=4242 KOSMOS_CUT_PROBE="$T/probe-self" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "the caller's own release.sh is not a reason to refuse itself" \
  || fail "the caller's own release.sh is not a reason to refuse itself (rc=$rc, $out)"

printf '#!/bin/sh\nprintf "4242 bash tools/release.sh 0.5.99\\n'"$DEAD"' bash tools/release.sh 0.5.98\\n"\n' > "$T/probe-two"; chmod +x "$T/probe-two"
out="$(KOSMOS_CUT_SELF_PID=4242 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-two" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "ANOTHER cut still refuses once self is excluded" \
  || fail "excluding self also excluded a real second cut, so the guard cannot fire (rc=$rc)"
has_pid "$out" "$DEAD" && pass "and it names the OTHER cut, not itself" || fail "it named the wrong process: $out"

# Use ordinary live pids through the probe seam. A test process genuinely named
# tools/release.sh would be visible to every agent's pgrep and could block a real
# cut, recreating #4206 merely by testing its fix.
( cd / && exec sleep 30 ) & cut_self=$!
( cd / && exec sleep 30 ) & cut_other=$!
printf '#!/bin/sh\nprintf "%s bash tools/release.sh 0.5.99\\n"\n' "$cut_self" > "$T/probe-real-self"; chmod +x "$T/probe-real-self"
printf '#!/bin/sh\nprintf "%s bash tools/release.sh 0.5.99\\n%s bash tools/release.sh 0.5.98\\n"\n' "$cut_self" "$cut_other" > "$T/probe-real-two"; chmod +x "$T/probe-real-two"
out="$(KOSMOS_CUT_SELF_PID="$cut_self" KOSMOS_CUT_PROBE="$T/probe-real-self" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a live caller pid presented as release.sh does not refuse ITSELF" \
  || fail "a live caller pid refused itself: rc=$rc out=$out"
out="$(KOSMOS_CUT_SELF_PID="$cut_self" KOSMOS_CUT_PROBE="$T/probe-real-two" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$cut_other"; } && pass "but a SECOND live pid presented as release.sh is refused and named" \
  || fail "a second live cut candidate proceeded: rc=$rc out=$out"
kill "$cut_self" "$cut_other" 2>/dev/null; wait "$cut_self" "$cut_other" 2>/dev/null

# A missing classifier must keep every candidate. browser-checks.sh does not
# enable set -e, so a bare failed source followed by an undefined pipeline
# function could otherwise empty `out` and fail open.
mkdir -p "$T/lone-lib"
cp "$HERE/lib/cut-guard.sh" "$T/lone-lib/cut-guard.sh"
out="$(KOSMOS_RUN_MARKER_DIR="$T/markers-empty" KOSMOS_CUT_PROBE="$T/probe-live" bash -c '. "$1" 2>/dev/null; kosmos_refuse_if_cut_live "a cut"' _ "$T/lone-lib/cut-guard.sh" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && has_pid "$out" "$DEAD" && pass "a missing fixture classifier keeps the candidate and refuses" \
  || fail "a missing fixture classifier failed open (rc=$rc, out=$out)"

# #4206 follow-up: the run-tests.sh sandbox rule (heavy-gate's) now reaches the cut guard too. A
# fixture that detached from node --test is marked by its cwd in a kt<digits> folder. Live sleeps
# through the probe seam, never a pgrep-visible release.sh. The negative control runs from / so it
# cannot land in a kt folder even where TMPDIR itself is one (run-tests.sh on Linux).
if ! command -v lsof >/dev/null 2>&1; then
  echo "SKIP  #4206 follow-up sandbox arms: lsof is not on this machine, so no live cwd can be read (a skip, NOT a pass)"
else
mkdir -p "$T/tmp/kt4206"
# Waits until PID's cwd is DIR (up to 3s), so an arm never reads a process that has not moved yet:
# a late cd would leave the test's own cwd, and a control could then pass for the wrong reason.
wait_cwd() { local i=0; while [ "$i" -lt 30 ]; do [ "$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n '/^n/{s/^n//p;q;}')" = "$2" ] && return 0; sleep 0.1; i=$((i+1)); done; return 1; }
( cd "$T/tmp/kt4206" && exec sleep 30 ) & kt_fx=$!
( cd / && exec sleep 30 ) & kt_real=$!
wait_cwd "$kt_fx" "$(cd "$T/tmp/kt4206" && pwd -P)" || fail "the kt fixture sleep never reached its cwd, so its arms cannot answer"
wait_cwd "$kt_real" "/" || fail "the / control sleep never reached its cwd, so its arms cannot answer"
printf '#!/bin/sh\nprintf "%s bash tools/release.sh 0.5.99\\n"\n' "$kt_fx" > "$T/probe-kt-fixture"; chmod +x "$T/probe-kt-fixture"
printf '#!/bin/sh\nprintf "%s bash tools/release.sh 0.5.99\\n"\n' "$kt_real" > "$T/probe-kt-real"; chmod +x "$T/probe-kt-real"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-kt-fixture" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a release.sh fixture running in the run-tests.sh sandbox (no node ancestor) is not a cut" \
  || fail "a kt-sandbox fixture refused the cut (rc=$rc, out=$out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-kt-real" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$kt_real"; } && pass "but the same candidate outside any sandbox still refuses, and is named" \
  || fail "the sandbox rule also hid a real cut (rc=$rc, out=$out)"

# #4206 follow-up: the browser-run guard reads the same fixture rule. Its self pid is one that does
# not exist, so the self-subtree exclusion cannot be what drops a candidate here.
printf '#!/bin/sh\nprintf "'"$DEAD"' bash tools/browser-checks.sh\\n"\n' > "$T/bprobe-live"; chmod +x "$T/bprobe-live"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-fixture" KOSMOS_BC_PROBE="$T/bprobe-live" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a browser-checks.sh fixture beneath node --test is not a browser run" \
  || fail "a node --test browser-checks fixture refused the run (rc=$rc, out=$out)"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-live" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$DEAD"; } && pass "the same browser-checks.sh without node --test ancestry still refuses, and is named" \
  || fail "the browser guard's fixture filter hid a real run (rc=$rc, out=$out)"
printf '#!/bin/sh\nprintf "%s bash tools/browser-checks.sh\\n"\n' "$kt_fx" > "$T/bprobe-kt"; chmod +x "$T/bprobe-kt"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-kt" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a browser-checks.sh fixture in the run-tests.sh sandbox is not a browser run" \
  || fail "a kt-sandbox browser-checks fixture refused the run (rc=$rc, out=$out)"
printf '#!/bin/sh\nprintf "%s bash tools/browser-checks.sh\\n"\n' "$kt_real" > "$T/bprobe-real"; chmod +x "$T/bprobe-real"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-real" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$kt_real"; } && pass "but the same live browser run outside any sandbox still refuses, and is named" \
  || fail "the browser guard's sandbox rule hid a real run (rc=$rc, out=$out)"
kill "$kt_fx" "$kt_real" 2>/dev/null; wait "$kt_fx" "$kt_real" 2>/dev/null

# The SCRIPT half of the sandbox rule: cwd /, but the script it runs sits in a kt folder. Its
# control is the same line with a script path outside any sandbox.
( cd / && exec sleep 30 ) & kt_script=$!
wait_cwd "$kt_script" "/" || fail "the kt-script sleep never reached /, so its arms cannot answer"
printf '#!/bin/sh\nprintf "%s bash %s/tools/release.sh 0.5.99\\n"\n' "$kt_script" "$T/tmp/kt4206" > "$T/probe-kt-script"; chmod +x "$T/probe-kt-script"
printf '#!/bin/sh\nprintf "%s bash /opt/kosmos/tools/release.sh 0.5.99\\n"\n' "$kt_script" > "$T/probe-plain-script"; chmod +x "$T/probe-plain-script"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-kt-script" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a release.sh whose SCRIPT is in the run-tests.sh sandbox (cwd /) is not a cut" \
  || fail "a kt-script fixture refused the cut (rc=$rc, out=$out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-plain-script" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$kt_script"; } && pass "but the same pid running a script outside any sandbox still refuses" \
  || fail "the script rule also hid a real cut (rc=$rc, out=$out)"
# Only the script word is read: a real cut whose ARGUMENT names a sandbox path (release notes kept in a
# kt folder, say) is still a cut. Matching the whole line instead would drop it (#4206 review 9).
printf '#!/bin/sh\nprintf "%s bash /opt/kosmos/tools/release.sh 0.5.99 --notes %s/notes.md\\n"\n' "$kt_script" "$T/tmp/kt4206" > "$T/probe-kt-arg"; chmod +x "$T/probe-kt-arg"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-kt-arg" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$kt_script"; } && pass "a cut whose argument, not its script, is in the sandbox still refuses, and is named" \
  || fail "a sandbox path in a real cut's ARGUMENTS dropped it as a fixture (rc=$rc, out=$out)"
# The browser guard reads the same script word (#4206 review 10): the three script arms again, for
# browser-checks.sh.
printf '#!/bin/sh\nprintf "%s bash %s/tools/browser-checks.sh\\n"\n' "$kt_script" "$T/tmp/kt4206" > "$T/bprobe-kt-script"; chmod +x "$T/bprobe-kt-script"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-kt-script" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a browser-checks.sh fixture whose script is in the sandbox is not a browser run, whatever its cwd" \
  || fail "a kt-sandbox browser-checks script was not recognised (rc=$rc, out=$out)"
printf '#!/bin/sh\nprintf "%s bash /opt/kosmos/tools/browser-checks.sh\\n"\n' "$kt_script" > "$T/bprobe-plain-script"; chmod +x "$T/bprobe-plain-script"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-plain-script" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$kt_script"; } && pass "but the same pid running browser-checks.sh outside any sandbox still refuses, and is named" \
  || fail "the browser guard's script rule hid a real run (rc=$rc, out=$out)"
printf '#!/bin/sh\nprintf "%s bash /opt/kosmos/tools/browser-checks.sh --out %s/report\\n"\n' "$kt_script" "$T/tmp/kt4206" > "$T/bprobe-kt-arg"; chmod +x "$T/bprobe-kt-arg"
out="$(KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-kt-arg" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$kt_script"; } && pass "a browser run whose argument, not its script, is in the sandbox still refuses, and is named" \
  || fail "a sandbox path in a real browser run's ARGUMENTS dropped it as a fixture (rc=$rc, out=$out)"
kill "$kt_script" 2>/dev/null; wait "$kt_script" 2>/dev/null

# #4206 follow-up (Baron): a REAL cut runs from its frozen build tree under TMPDIR,
# ${TMPDIR}/kosmos-release.<X>/kosmos-<sha> (measured on a 0.7.03 cut). That cwd and that script path
# must never read as a sandbox fixture. TMPDIR is set to its parent, so a "directly under this shell's
# TMPDIR" branch widened past kt<digits> would take it: that widening is what these arms catch. The double slash in the directory is only how it was
# made: lsof and pwd -P both normalize it, so the matcher sees a single-slash path.
# Rooted under /tmp BY NAME, not under $T: where mktemp honours TMPDIR (Linux, under run-tests.sh)
# $T sits inside a kt<digits> folder, and a frozen tree built there would rightly read as a fixture.
FR="$(mktemp -d /tmp/cutguard-frozen.XXXXXX)" && [ -n "$FR" ] || { echo "FAIL  no frozen root (mktemp failed), so the frozen-tree arms cannot run"; exit 1; }
trap 'rm -rf "$T" "$FR"' EXIT
FROZEN="$FR/T//kosmos-release.msHOlx/kosmos-aad0d84cd3e8"
mkdir -p "$FROZEN/tools"
( cd "$FROZEN" && exec sleep 30 ) & frozen=$!
wait_cwd "$frozen" "$(cd "$FROZEN" && pwd -P)" || fail "the frozen-tree sleep never reached its cwd, so its arm cannot answer"
printf '#!/bin/sh\nprintf "%s bash %s/tools/release.sh 0.7.03\\n"\n' "$frozen" "$(cd "$FROZEN" && pwd -P)" > "$T/probe-frozen"; chmod +x "$T/probe-frozen"
FRT="$(cd "$FR/T" && pwd -P)/"
out="$(TMPDIR="$FRT" KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_CUT_PROBE="$T/probe-frozen" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$frozen"; } && pass "a real cut running from its frozen build tree under TMPDIR still refuses, and is named" \
  || fail "a REAL cut's frozen build tree was dropped as a fixture (rc=$rc, out=$out)"
kill "$frozen" 2>/dev/null; wait "$frozen" 2>/dev/null

# The same for the browser guard: a REAL browser-checks.sh runs from its own frozen tree,
# ${TMPDIR}/kosmos-bc-freeze.<X>/kosmos-<sha> (tools/browser-checks.sh, via release_freeze), and must
# still refuse through both halves of the sandbox rule.
BCFROZEN="$FR/T//kosmos-bc-freeze.sfQH4q/kosmos-71d1f796503531bea19198c04b5768f25f7c998e"
mkdir -p "$BCFROZEN/tools"
( cd "$BCFROZEN" && exec sleep 30 ) & bcfrozen=$!
wait_cwd "$bcfrozen" "$(cd "$BCFROZEN" && pwd -P)" || fail "the browser frozen-tree sleep never reached its cwd, so its arm cannot answer"
printf '#!/bin/sh\nprintf "%s bash %s/tools/browser-checks.sh\\n"\n' "$bcfrozen" "$(cd "$BCFROZEN" && pwd -P)" > "$T/bprobe-frozen"; chmod +x "$T/bprobe-frozen"
out="$(TMPDIR="$FRT" KOSMOS_BC_SELF_PID=999999 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_BC_PROBE="$T/bprobe-frozen" kosmos_refuse_if_browser_run_live "a run" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && has_pid "$out" "$bcfrozen"; } && pass "a real browser run from its frozen tree under TMPDIR still refuses, and is named" \
  || fail "a REAL browser run's frozen tree was dropped as a fixture (rc=$rc, out=$out)"
kill "$bcfrozen" 2>/dev/null; wait "$bcfrozen" 2>/dev/null
fi

# --- #1713: the MIRROR guard, kosmos_refuse_if_harness_live, shown red, green,
# --- and unable to answer via its own KOSMOS_HARNESS_PROBE seam. Reuses the
# --- probe-quiet/probe-dead fixtures above (exit 1 / exit 3 are guard-agnostic).
mkdir -p "$T/tools"
printf '#!/bin/sh\nprintf "77123 bash tools/test-install.sh\\n"\n' > "$T/hprobe-live"; chmod +x "$T/hprobe-live"
out="$(KOSMOS_HARNESS_PROBE="$T/hprobe-live" kosmos_refuse_if_harness_live "this cut" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "the cut refuses while an install harness is running"; else fail "the cut refuses while a harness runs (rc=$rc)"; fi
if has "$out" "test-install.sh" && has "$out" "test ports"; then pass "and names the harness and why they collide"; else fail "and names the harness: $out"; fi
if has "$out" "KOSMOS_CUT_IGNORE_HARNESS=1"; then pass "and names the harness override"; else fail "and names the override: $out"; fi

out="$(KOSMOS_HARNESS_PROBE="$T/probe-quiet" kosmos_refuse_if_harness_live "this cut" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "the cut passes silently when no harness is running"; else fail "the cut passes when no harness (rc=$rc, out=$out)"; fi

out="$(KOSMOS_HARNESS_PROBE="$T/probe-dead" kosmos_refuse_if_harness_live "this cut" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "could not tell"; then pass "a harness probe that cannot answer is a refusal, not a pass"; else fail "a harness probe that cannot answer is a refusal (rc=$rc, out=$out)"; fi

# self-exclusion: a caller that is ITSELF a test-install.sh (a future caller,
# or this test) is not a reason to refuse.
printf '#!/bin/sh\nprintf "5252 bash tools/test-install.sh\\n"\n' > "$T/hprobe-self"; chmod +x "$T/hprobe-self"
out="$(KOSMOS_HARNESS_SELF_PID=5252 KOSMOS_HARNESS_PROBE="$T/hprobe-self" kosmos_refuse_if_harness_live "this cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "the caller's own test-install.sh is not a reason to refuse itself" \
  || fail "the caller's own harness refused itself (rc=$rc, $out)"

# --- END TO END through the real pgrep, with a script genuinely named
# --- tools/test-install.sh. The probe seam cannot prove the robust filter (a
# --- MENTION must not match) nor the live detection: both live in what pgrep
# --- really reports.
# 🛑 CRITICAL: the guard is called from a SEPARATE process ($E2E/tools/cut-start.sh,
# standing in for the cut that calls it), so a harness/mention this test spawns is
# a SIBLING of that caller, not its descendant. Called directly from this test,
# _kosmos_drop_self_subtree would drop the spawned processes as "self's subtree"
# and both arms would pass for the WRONG reason (self-exclusion, not the filter or
# detection). Measured: the direct form silently dropped the real harness.
# #4410: the stand-in harness below is a REAL `bash tools/test-install.sh` for 8 seconds, and every
# suite runs this file. Outside the fixture sandbox, every other guard on the Mac saw it: a cut
# starting then refused (#3619 measured 12 of 26 release-gate arms red on it), and since #4410
# heavy-gate and any other agent's run-tests.sh would read it as a live harness too. So the
# stand-ins live in a kt<digits> folder under a T folder, which the shared fixture rule drops
# everywhere, and cut-start.sh sets KOSMOS_HARNESS_KEEP_FIXTURES=1 so THIS test's own guard call
# still sees it and the detection arm below is real. cut-start-plain.sh, without the seam, is the
# arm showing what every other caller sees.
E2E="$T/T/kt$$"; mkdir -p "$E2E/tools" || { fail "#4410 could not make the stand-in folder $E2E"; E2E="$T"; }
_kosmos_path_in_kt_sandbox "$E2E/tools/test-install.sh" \
  && pass "#4410 the end-to-end stand-ins sit in the fixture sandbox, so no other guard on the Mac counts them" \
  || fail "#4410 the end-to-end stand-ins sit outside the fixture sandbox, so other agents' gates would count them ($E2E)"
cat > "$E2E/tools/test-install.sh" <<SH
#!/bin/bash
if [ "\${1:-}" = "--sleep" ]; then sleep "\$2"; exit 0; fi
exit 0
SH
chmod +x "$E2E/tools/test-install.sh"
cat > "$E2E/tools/cut-start.sh" <<SH
#!/bin/bash
. "$HERE/lib/cut-guard.sh"
KOSMOS_HARNESS_KEEP_FIXTURES=1 kosmos_refuse_if_harness_live "this cut" || exit 1
echo CUT-PROCEEDS
SH
chmod +x "$E2E/tools/cut-start.sh"
cat > "$E2E/tools/cut-start-plain.sh" <<SH
#!/bin/bash
. "$HERE/lib/cut-guard.sh"
kosmos_refuse_if_harness_live "this cut" || exit 1
echo CUT-PROCEEDS
SH
chmod +x "$E2E/tools/cut-start-plain.sh"
# #4410: fixtures dropped, so another agent's sandboxed stand-in (this same test, running in their
# suite) neither skips this section nor reaches the plain guard calls below.
live_harness="$(pgrep -fl 'test-install\.sh' 2>/dev/null | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |$)' | _kosmos_drop_test_fixtures || true)"
if [ -n "$live_harness" ]; then
  _fh="${live_harness%%$'\n'*}"
  echo "SKIP  harness end-to-end: a real harness is live on this Mac, so this arm cannot answer"
  echo "      (that is a skip, NOT a pass: ${_fh:0:60})"
else
  # #1967: this "cut proceeds" arm is the same CLASS as the mention arm below (a
  # concurrent run's real harness would make cut-start.sh refuse and red it), but
  # it runs on a FRESH pre-flight -- the only gap is a `bash` fork plus a
  # `source lib/cut-guard.sh` (a few milliseconds), with no `sleep` between --
  # whereas the mention arm asserts across the `sleep 1` at step 4, so its
  # pre-flight is over a second stale. The re-check is placed at the mention arm,
  # the one with real exposure; this arm is left to the fresh pre-flight
  # deliberately, not by oversight.
  out="$(bash "$E2E/tools/cut-start-plain.sh" 2>&1)"; rc=$?
  { [ "$rc" -eq 0 ] && has "$out" "CUT-PROCEEDS"; } \
    && pass "no harness running: the cut proceeds through the real pgrep" \
    || fail "the cut refused with no harness running: rc=$rc out=$out"

  # A MENTION: a shell whose argv CONTAINS tools/test-install.sh but is NOT a
  # `bash tools/test-install.sh`, so only the robust filter can exclude it.
  # 🛑 The mention must SURVIVE in argv. `bash -c 'sleep 4' tools/test-install.sh`
  # does NOT: bash's single-command exec optimization replaces the shell with
  # `sleep 4`, dropping the string entirely, so pgrep finds nothing and the arm
  # would pass on an empty process table rather than by the filter -- vacuous. A
  # compound `-c` body defeats that optimization, so bash stays alive with the
  # string in its own command line for pgrep to find and the filter to exclude.
  ( bash -c 'sleep 4; : tools/test-install.sh' ) & mention=$!
  sleep 1
  # Prove the mention is actually VISIBLE to pgrep (else this arm is vacuous):
  # Anchor the pid at line start (pgrep -fl prints '<pid> <cmdline>'), so a pid
  # that is a SUBSTRING of another process's pid cannot false-satisfy the very
  # check that exists to prove this arm is not vacuous.
  pgrep -fl 'test-install\.sh' 2>/dev/null | grep -qE "^$mention " \
    && pass "the mention is present in the process table (the filter arm is not vacuous)" \
    || fail "the mention did not survive in argv, so the filter arm below proves nothing"
  # #1967: RE-CHECK for a foreign live harness immediately before this assertion,
  # exactly as the section's pre-flight above does. Two suites run this test at
  # once, and one run's REAL step-7 harness landing inside another run's step-5
  # window makes cut-start.sh correctly refuse -- reddening THIS arm for a reason
  # external to the branch (a DESIGNED-IN cross-run collision). The filter is the
  # pre-flight's exact one: it matches only a real `bash tools/test-install.sh`,
  # so it excludes our own `bash -c` MENTION, and our own step-7 harness is not
  # spawned until AFTER this arm -- so a match here can only be a CONCURRENT run,
  # never this test's own process. SKIP rather than FAIL, as step 1 does. This
  # narrows the collision window to the moment before the assertion; it cannot
  # close it (an 8 s harness can still appear in the gap), and re-running alone is
  # what settles a genuine red -- but it removes the DESIGNED-IN case where our
  # own paired step 7 is another run's live harness.
  _foreign_harness="$(pgrep -fl 'test-install\.sh' 2>/dev/null | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |$)' | _kosmos_drop_test_fixtures || true)"
  if [ -n "$_foreign_harness" ]; then
    _fh5="${_foreign_harness%%$'\n'*}"
    echo "SKIP  a mere MENTION does not count: a real harness is live (a concurrent run), so this arm cannot answer"
    echo "      (that is a skip, NOT a pass: ${_fh5:0:60})"
  else
    out="$(bash "$E2E/tools/cut-start-plain.sh" 2>&1)"; rc=$?
    { [ "$rc" -eq 0 ] && has "$out" "CUT-PROCEEDS"; } \
      && pass "a mere MENTION of test-install.sh in a command line does not count" \
      || fail "a mention was mistaken for a live harness: rc=$rc out=$out"
  fi
  kill "$mention" 2>/dev/null; wait "$mention" 2>/dev/null

  # #4410: started by its absolute path, so the SCRIPT path proves the sandbox to every other guard
  # on the Mac: its cwd is this test's, never in the sandbox, so the path is the only proof. Both guard calls run while it is still alive,
  # and the kill -0 after them says so: a stand-in that already exited would let the "dropped" arm
  # pass on an empty process table, so that is a SKIP, never a pass.
  bash "$E2E/tools/test-install.sh" --sleep 8 & harness=$!
  sleep 1
  out_plain="$(bash "$E2E/tools/cut-start-plain.sh" 2>&1)"; rc_plain=$?
  out="$(bash "$E2E/tools/cut-start.sh" 2>&1)"; rc=$?
  if kill -0 "$harness" 2>/dev/null; then
    # #4410: another agent's sandboxed stand-in would also refuse cut-start.sh (it keeps fixtures),
    # so the pass also needs OUR stand-in in the name arm's own candidate lines.
    ours="$(pgrep -fl 'test-install\.sh' 2>/dev/null | grep -E "^$harness +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |\$)" || true)"
    { [ "$rc" -ne 0 ] && [ -n "$ours" ]; } && pass "a real bash tools/test-install.sh IS detected and refuses the cut" \
      || fail "a live harness was not detected: rc=$rc ours='$ours' out=$out"
    # A REAL harness another agent started after the pre-flight would refuse the plain caller too;
    # re-check it (fixtures dropped, as the mention arm does) so that reads as a SKIP, not a FAIL.
    _late_harness="$(pgrep -fl 'test-install\.sh' 2>/dev/null | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |$)' | _kosmos_drop_test_fixtures || true)"
    if [ -n "$_late_harness" ] && [ "$rc_plain" -ne 0 ]; then
      echo "SKIP  the plain-caller arm: a real harness started meanwhile, so it cannot answer (${_late_harness:0:60})"
    else
    { [ "$rc_plain" -eq 0 ] && has "$out_plain" "CUT-PROCEEDS"; } \
      && pass "#4410 the same live stand-in, in the fixture sandbox, is dropped by the harness guard without the test seam" \
      || fail "#4410 a sandboxed stand-in refused the harness guard without the seam, so other agents' runs would too: rc=$rc_plain out=$out_plain"
    fi
  else
    echo "SKIP  harness detection: the stand-in exited before both guard calls finished (a loaded Mac), so neither arm can answer"
  fi
  kill "$harness" 2>/dev/null; wait "$harness" 2>/dev/null
fi

# --- #1796: the marker arm, driven by KOSMOS_RUN_MARKER_DIR. Each arm uses a fresh
# --- dir and probe-quiet (the NAME arm clean), so ONLY the marker arm can fire --
# --- proving it works independently of the pgrep detection.
# A live foreign-cookie marker refuses even when the name arm is clean.
M1="$T/m1"; mkdir -p "$M1"; ( sleep 30 ) & p1=$!; printf 'FOREIGN\n%s\n' "$(ps -ww -o command= -p "$p1" 2>/dev/null)" > "$M1/cut.$p1"
out="$(KOSMOS_RUN_MARKER_DIR="$M1" KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "#1796 a live marked cut (foreign cookie) refuses with the name arm clean" \
  || fail "#1796 marked cut did not refuse (rc=$rc, $out)"
has_pid "$out" "$p1" && pass "#1796 and it names the marked run's pid" || fail "#1796 did not name the marked pid: $out"
kill "$p1" 2>/dev/null; wait "$p1" 2>/dev/null

# The caller's OWN marker (matching cookie) is excluded -- the self-refuse outage.
M2="$T/m2"; mkdir -p "$M2"; ( sleep 30 ) & p2=$!; printf 'MINE\n%s\n' "$(ps -ww -o command= -p "$p2" 2>/dev/null)" > "$M2/cut.$p2"
out="$(KOSMOS_RUN_MARKER_DIR="$M2" KOSMOS_RUN_COOKIE_CUT=MINE KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#1796 the caller's OWN marker (matching cookie) is not a reason to refuse" \
  || fail "#1796 own marker refused itself (rc=$rc, $out)"
kill "$p2" 2>/dev/null; wait "$p2" 2>/dev/null

# A stale (dead-pid) marker does not refuse, and is cleaned.
M3="$T/m3"; mkdir -p "$M3"; ( exit 0 ) & p3=$!; wait "$p3" 2>/dev/null; printf 'FOREIGN\n' > "$M3/cut.$p3"
out="$(KOSMOS_RUN_MARKER_DIR="$M3" KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#1796 a stale (dead-pid) marker does not refuse -- a crash cannot brick the guard" \
  || fail "#1796 stale marker refused (rc=$rc, $out)"
[ ! -e "$M3/cut.$p3" ] && pass "#1796 and the stale marker was cleaned" || fail "#1796 stale marker not cleaned"

# Working on the script (no marker at all) does not refuse.
M4="$T/m4"; mkdir -p "$M4"
out="$(KOSMOS_RUN_MARKER_DIR="$M4" KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#1796 no marker (working on the script, not running it) does not refuse" \
  || fail "#1796 empty marker dir refused (rc=$rc, $out)"

# #2215: a live pid whose recorded command does NOT match the live process is a
# RECYCLED pid, not the marking run -- treated stale and unlinked, so the guard does
# not false-refuse. The pid is genuinely alive (kill -0 succeeds), so ONLY the
# command mismatch prevents the refuse: the old kill-0-only check refused here, which
# is exactly the false-positive that aborted the 6.32 cut against a system daemon.
MR="$T/mr"; mkdir -p "$MR"; ( sleep 30 ) & pR=$!; printf 'FOREIGN\nnot-the-command-that-marked-this recycled pid\n' > "$MR/cut.$pR"
out="$(KOSMOS_RUN_MARKER_DIR="$MR" KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#2215 a live pid whose command does not match (recycled pid) does not refuse" \
  || fail "#2215 a recycled-pid marker false-refused (rc=$rc, $out)"
[ ! -e "$MR/cut.$pR" ] && pass "#2215 and the recycled-pid marker was cleaned" || fail "#2215 recycled-pid marker not cleaned"
kill "$pR" 2>/dev/null; wait "$pR" 2>/dev/null

# #2215: a pre-fix marker (cookie only, no recorded command) on a live pid cannot be
# verified, so it is treated stale and unlinked rather than trusted -- clearing the
# accumulation the old kill-0-only check could never remove. A genuine foreign run is
# still caught by the name arm each guard OR's with this one.
MC="$T/mc"; mkdir -p "$MC"; ( sleep 30 ) & pC=$!; printf 'FOREIGN\n' > "$MC/cut.$pC"
out="$(KOSMOS_RUN_MARKER_DIR="$MC" KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#2215 a command-less (pre-fix) marker on a live pid does not refuse" \
  || fail "#2215 a command-less marker false-refused (rc=$rc, $out)"
[ ! -e "$MC/cut.$pC" ] && pass "#2215 and the command-less marker was cleaned" || fail "#2215 command-less marker not cleaned"
kill "$pC" 2>/dev/null; wait "$pC" 2>/dev/null

# 🛑 THE RELEASE-OUTAGE PATH: a run that marks ITSELF and then checks its own type
# must NOT refuse itself. If kosmos_mark_run's exported cookie did not reach the
# guard in the SAME process, release.sh would mark 'cut', then see its own marker as
# a foreign cut, and refuse EVERY cut forever. Run in a bash -c so the export does
# not leak into later arms; probe-quiet keeps the name arm clean.
M6="$T/m6"
out="$(KOSMOS_RUN_MARKER_DIR="$M6" KOSMOS_CUT_PROBE="$T/probe-quiet" bash -c '. "'"$HERE"'/lib/cut-guard.sh"; kosmos_mark_run cut; kosmos_refuse_if_cut_live "a cut"' 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#1796 a run that marks itself then checks its own type does NOT refuse itself" \
  || fail "#1796 self-mark then check refused ITSELF (rc=$rc, $out) -- this would be a total release outage"

# END-TO-END: kosmos_mark_run makes a real run detectable by a separate guard call.
M5="$T/m5"
cat > "$T/mark-harness.sh" <<SH
#!/bin/bash
. "$HERE/lib/cut-guard.sh"
kosmos_mark_run harness
sleep 30
SH
chmod +x "$T/mark-harness.sh"
KOSMOS_RUN_MARKER_DIR="$M5" bash "$T/mark-harness.sh" & p5=$!
sleep 1
out="$(KOSMOS_RUN_MARKER_DIR="$M5" KOSMOS_HARNESS_PROBE="$T/probe-quiet" kosmos_refuse_if_harness_live "a cut" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "#1796 kosmos_mark_run harness makes a real run detectable by the guard (marker written, pid $p5)" \
  || fail "#1796 a kosmos_mark_run harness was not detected (rc=$rc, $out)"
# and that same run, checking for ITS OWN type, does not refuse itself (cookie set in-process).
kill "$p5" 2>/dev/null; wait "$p5" 2>/dev/null

# --- #4410: the harness guard follows the shared fixture rule, and its mirror (a harness asking
# --- about a live suite) is shown red, green and unable to answer. Each drop arm has a control that
# --- differs only in the deciding detail, so no pass comes from a guard that cannot refuse.
KTD="$T/T/kt4410"; mkdir -p "$KTD/tools"
printf '#!/bin/sh\nprintf "%s bash %s/tools/test-install.sh\\n"\n' "$DEAD" "$KTD" > "$T/hprobe-kt"; chmod +x "$T/hprobe-kt"
printf '#!/bin/sh\nprintf "%s bash /Users/someone/work/kosmos/tools/test-install.sh\\n"\n' "$DEAD" > "$T/hprobe-real"; chmod +x "$T/hprobe-real"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_HARNESS_SELF_PID=999999 KOSMOS_HARNESS_PROBE="$T/hprobe-kt" kosmos_refuse_if_harness_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 a harness whose script sits in the kt<digits> sandbox is a fixture, not a harness" \
  || fail "#4410 a sandboxed harness fixture refused (rc=$rc, $out)"
printf '#!/bin/sh\nprintf "%s bash tools/test-install.sh\\n"\n' "$DEAD" > "$T/hprobe-dead-pid"; chmod +x "$T/hprobe-dead-pid"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-fixture" KOSMOS_HARNESS_SELF_PID=999999 KOSMOS_HARNESS_PROBE="$T/hprobe-dead-pid" kosmos_refuse_if_harness_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 a harness with a node --test ancestor is a fixture, not a harness" \
  || fail "#4410 a node --test harness fixture refused (rc=$rc, $out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_HARNESS_SELF_PID=999999 KOSMOS_HARNESS_PROBE="$T/hprobe-real" kosmos_refuse_if_harness_live "a cut" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && pass "#4410 CONTROL: the same harness in a checkout, with no test ancestor, refuses" \
  || fail "#4410 CONTROL: a real harness did not refuse (rc=$rc, $out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_HARNESS_SELF_PID=999999 KOSMOS_HARNESS_PROBE="$T/hprobe-real" kosmos_refuse_if_harness_live "this test run" "KOSMOS_TESTS_IGNORE_HARNESS=1 runs anyway" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "KOSMOS_TESTS_IGNORE_HARNESS=1 runs anyway" && ! has "$out" "KOSMOS_CUT_IGNORE_HARNESS"; } \
  && pass "#4410 run-tests.sh's refusal names its own override, not the cut's" \
  || fail "#4410 the caller's override was not the one named (rc=$rc, $out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_HARNESS_SELF_PID=999999 KOSMOS_HARNESS_PROBE="$T/hprobe-real" kosmos_refuse_if_harness_live "a cut" 2>&1)"
has "$out" "KOSMOS_CUT_IGNORE_HARNESS=1 cuts anyway" && pass "#4410 CONTROL: with no second argument the cut's override is still the one named" \
  || fail "#4410 the cut's default override text changed: $out"

# The mirror: kosmos_refuse_if_suite_live, through its KOSMOS_SUITE_PROBE seam.
printf '#!/bin/sh\nprintf "%s bash tools/run-tests.sh\\n"\n' "$DEAD" > "$T/sprobe-live"; chmod +x "$T/sprobe-live"
printf '#!/bin/sh\nprintf "%s bash %s/tools/run-tests.sh\\n"\n' "$DEAD" "$KTD" > "$T/sprobe-kt"; chmod +x "$T/sprobe-kt"
printf '#!/bin/sh\nprintf "5353 bash tools/run-tests.sh\\n"\n' > "$T/sprobe-self"; chmod +x "$T/sprobe-self"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-live" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "tools/run-tests.sh" && has "$out" "KOSMOS_HARNESS_IGNORE_SUITE=1"; } \
  && pass "#4410 a harness refuses to start while a test suite is running, and names the override" \
  || fail "#4410 a live suite did not refuse the harness (rc=$rc, $out)"
out="$(KOSMOS_SUITE_PROBE="$T/probe-quiet" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 CONTROL: no suite running, the harness proceeds" || fail "#4410 the harness refused with no suite (rc=$rc, $out)"
out="$(KOSMOS_SUITE_PROBE="$T/probe-dead" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "could not tell"; } && pass "#4410 a suite probe that cannot answer is a refusal, not a guess" \
  || fail "#4410 an unanswerable suite probe did not refuse (rc=$rc, $out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-kt" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 a run-tests.sh fixture in the kt<digits> sandbox is not a live suite (control: the live arm above)" \
  || fail "#4410 a sandboxed run-tests.sh fixture refused the harness (rc=$rc, $out)"
printf '#!/bin/sh\nprintf "%s /opt/homebrew/bin/bash %s/tools/run-tests.sh\\n"\n' "$DEAD" "$KTD" > "$T/sprobe-kt-brew"; chmod +x "$T/sprobe-kt-brew"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-kt-brew" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 a sandboxed run-tests.sh fixture started by a Homebrew bash is dropped too (the fixture rule's interpreter is as wide as the suite arm's)" \
  || fail "#4410 a Homebrew-bash sandboxed fixture refused the harness (rc=$rc, $out)"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-fixture" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-live" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 a run-tests.sh with a node --test ancestor is not a live suite (control: the live arm above)" \
  || fail "#4410 a node --test run-tests.sh fixture refused the harness (rc=$rc, $out)"
out="$(KOSMOS_SUITE_SELF_PID=5353 KOSMOS_SUITE_PROBE="$T/sprobe-self" kosmos_refuse_if_suite_live "a full install-harness run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4410 the caller's own pid is not a separate suite" || fail "#4410 the guard refused its own caller (rc=$rc, $out)"

# The suite guard's REAL name arm (pgrep plus the filter), through _kosmos_suite_candidates. Other
# agents' real suites may be live, so a refusal would prove nothing; instead this looks for its OWN
# stand-in's pid in the candidates, then shows the fixture rule drops exactly that line. Started by
# pid and stopped by pid (never by pattern).
cat > "$E2E/tools/run-tests.sh" <<'SH'
#!/bin/bash
if [ "${1:-}" = "--sleep" ]; then sleep "$2"; exit 0; fi
exit 0
SH
chmod +x "$E2E/tools/run-tests.sh"
bash "$E2E/tools/run-tests.sh" --sleep 8 & suite_sp=$!
sleep 1
cands="$(_kosmos_suite_candidates)"; crc=$?
kept="$(printf '%s\n' "$cands" | _kosmos_drop_test_fixtures || true)"
if kill -0 "$suite_sp" 2>/dev/null; then
  printf '%s\n' "$cands" | grep -qE "^$suite_sp " \
    && pass "#4410 the suite guard's real pgrep and filter see a live bash .../tools/run-tests.sh (rc=$crc)" \
    || fail "#4410 the suite guard's real name arm missed a live run-tests.sh stand-in (pid $suite_sp): $cands"
  printf '%s\n' "$kept" | grep -qE "^$suite_sp " \
    && fail "#4410 the sandboxed run-tests.sh stand-in survived the fixture rule, so it would refuse other agents' harnesses" \
    || pass "#4410 the same stand-in, in the fixture sandbox, is dropped by the fixture rule"
else
  echo "SKIP  suite name arm: the stand-in exited before the read (a loaded Mac), so neither arm can answer"
fi
kill "$suite_sp" 2>/dev/null; wait "$suite_sp" 2>/dev/null

# Wired, not only defined: each script asks the other's question on a line that is not a comment,
# and test-install.sh skips it only in a cut's own gate run or on its named override.
_wired() { grep -vE '^[[:space:]]*#' "$1" | grep -q "$2"; }
RT="$HERE/run-tests.sh"; TI="$HERE/test-install.sh"
_wired "$RT" 'kosmos_refuse_if_harness_live "this test run" "KOSMOS_TESTS_IGNORE_HARNESS=1 runs anyway"' \
  && pass "#4410 run-tests.sh asks whether an install harness is live, naming its own override" \
  || fail "#4410 run-tests.sh does NOT call kosmos_refuse_if_harness_live with its own override -- a suite can start beside a harness, or names the cut's override"
_wired "$TI" 'kosmos_refuse_if_suite_live "a full install-harness run"' \
  && pass "#4410 test-install.sh asks whether a test suite is live" \
  || fail "#4410 test-install.sh does NOT call kosmos_refuse_if_suite_live -- a harness can start beside a suite"
_wired "$TI" 'KOSMOS_HARNESS_IGNORE_SUITE:-0}" != 1 \] && ! kosmos_holds_machine_claim; then' \
  && pass "#4410 the harness's suite check stands down only for the claim holder (a cut) or on its override" \
  || fail "#4410 the harness's suite check is not scoped to the claim holder"
_wired "$TI" 'if ! kosmos_holds_machine_claim && \[ "${KOSMOS_HARNESS_IGNORE_CUT' \
  && pass "#4410 the harness's cut check is skipped only for the claim holder, not for KOSMOS_INSTALL_GATE=1 alone" \
  || fail "#4410 the harness's cut check is skipped for yarn test:install-gate outside a cut"
_wired "$RT" '&& ! kosmos_holds_machine_claim; then' \
  && pass "#4410 run-tests.sh's harness check stands down only for the claim holder (a cut's own suite)" \
  || fail "#4410 run-tests.sh's harness check is not scoped to the claim holder"

# kosmos_holds_machine_claim: our live claim yes; a foreign one, none, or no cookie of ours, no.
MCD="$T/mc4410"; mkdir -p "$MCD"; sleep 30 & mcp=$!
printf 'MINE %s %s host release x\n' "$mcp" "$(( $(date +%s) + 600 ))" > "$MCD/machine-claim"
KOSMOS_RUN_MARKER_DIR="$MCD" KOSMOS_MACHINE_CLAIM_COOKIE=MINE bash -c '. "$1"; kosmos_holds_machine_claim' _ "$HERE/lib/cut-guard.sh" \
  && pass "#4410 the run holding the live claim is recognised as the claim holder" \
  || fail "#4410 the claim holder was not recognised, so a cut's own runs would refuse each other"
KOSMOS_RUN_MARKER_DIR="$MCD" KOSMOS_MACHINE_CLAIM_COOKIE=OTHER bash -c '. "$1"; kosmos_holds_machine_claim' _ "$HERE/lib/cut-guard.sh" \
  && fail "#4410 a foreign cookie read as the claim holder" || pass "#4410 CONTROL: a run with another cookie is not the holder"
KOSMOS_RUN_MARKER_DIR="$MCD" bash -c 'unset KOSMOS_MACHINE_CLAIM_COOKIE; . "$1"; kosmos_holds_machine_claim' _ "$HERE/lib/cut-guard.sh" \
  && fail "#4410 a run with no cookie read as the claim holder" || pass "#4410 CONTROL: a run with no cookie (yarn test:install-gate outside a cut) is not the holder"
kill "$mcp" 2>/dev/null; wait "$mcp" 2>/dev/null
KOSMOS_RUN_MARKER_DIR="$MCD" KOSMOS_MACHINE_CLAIM_COOKIE=MINE bash -c '. "$1"; kosmos_holds_machine_claim' _ "$HERE/lib/cut-guard.sh" \
  && fail "#4410 a claim whose holder is dead still read as held" || pass "#4410 CONTROL: a dead holder's claim is not held"

# --- #4498: waiting instead of refusing, and the suite queue ------------------------------------
W="$T/w4498"; mkdir -p "$W/markers"
export KOSMOS_RUN_MARKER_DIR="$W/markers"
# A check that refuses its first N calls, then passes; each call is logged.
wcheck() { local n; n=$(( $(cat "$W/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$W/calls"; [ "$n" -gt "${WPASS_AFTER:-0}" ] && return 0; echo "busy: stand-in run $n" >&2; return 1; }
rm -f "$W/calls"
out="$(WPASS_AFTER=2 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "a test run" wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 0 ] && [ "$(cat "$W/calls")" = 3 ] && has "$out" "waiting for it" && has "$out" "clear after waiting 60s"; } \
  && pass "#4498 a busy box is asked again every 30 s and the run starts when it clears" \
  || fail "#4498 the wait did not end in a start (rc=$rc, calls=$(cat "$W/calls"), $out)"
rm -f "$W/calls"
out="$(WPASS_AFTER=99 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "a test run" wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 3 ] && has "$out" "gave up after waiting 60s" && has "$out" "busy: stand-in run 3"; } \
  && pass "#4498 at the bound the wait refuses, with the check's latest reason" \
  || fail "#4498 the bound did not end in a refusal (rc=$rc, calls=$(cat "$W/calls"), $out)"
rm -f "$W/calls"
out="$(WPASS_AFTER=99 KOSMOS_NO_WAIT=1 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "a test run" wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 1 ] && ! has "$out" "waiting for it"; } \
  && pass "#4498 KOSMOS_NO_WAIT=1 refuses at once, asking once" \
  || fail "#4498 no-wait still waited (rc=$rc, calls=$(cat "$W/calls"), $out)"
rm -f "$W/calls"
out="$(KOSMOS_WAIT_SLEEP=false kosmos_wait_until_clear "a test run" wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 0 ] && [ -z "$out" ]; } && pass "#4498 CONTROL: a clear box starts at once and says nothing" \
  || fail "#4498 a clear box did not start quietly (rc=$rc, $out)"

# A waiting suite is not a live suite. The stand-in waiter is a real process of ours, stopped by pid.
sleep 60 & wp=$!
printf '100 %s\n%s\n%s\n' "$wp" "$(ps -ww -o command= -p "$wp")" "$(_kosmos_pid_started "$wp")" > "$W/markers/suitewait.$wp"
printf '#!/bin/sh\nprintf "%s bash tools/run-tests.sh\\n"\n' "$wp" > "$T/sprobe-waiter"; chmod +x "$T/sprobe-waiter"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-waiter" kosmos_refuse_if_suite_live "this test run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4498 a suite that is only waiting for the box does not count as running" \
  || fail "#4498 a waiting suite was counted as running (rc=$rc, $out)"
mv "$W/markers/suitewait.$wp" "$W/held"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-waiter" kosmos_refuse_if_suite_live "this test run" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && pass "#4498 CONTROL: the same process with no waiting marker is a running suite" \
  || fail "#4498 CONTROL: an unmarked suite did not refuse (rc=$rc, $out)"
# The right start time with the wrong command, so ONLY the command check can call it stale (Kano's review: with no
# start time the start-time check caught it first, and removing the command check left this green).
printf '100 %s\nnot its command\n%s\n' "$wp" "$(_kosmos_pid_started "$wp")" > "$W/markers/suitewait.$wp"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-waiter" kosmos_refuse_if_suite_live "this test run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$W/markers/suitewait.$wp" ]; } && pass "#4498 a waiting marker whose pid now runs another command is stale: counted as running and removed" \
  || fail "#4498 a recycled-pid waiting marker was trusted (rc=$rc, $out)"
# Same command, different start time: a new suite that inherited a dead waiter's pid (review 1). Every suite's command
# is the same, so the command alone cannot tell them apart.
printf '100 %s\n%s\nMon Jan  1 00:00:00 2001\n' "$wp" "$(ps -ww -o command= -p "$wp")" > "$W/markers/suitewait.$wp"
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_SELF_PID=999999 KOSMOS_SUITE_PROBE="$T/sprobe-waiter" kosmos_refuse_if_suite_live "this test run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$W/markers/suitewait.$wp" ]; } && pass "#4498 a waiting marker with the same command but another start time is stale: counted as running" \
  || fail "#4498 a recycled pid running the same command was taken for the waiter (rc=$rc, $out)"

# A waiter's own subshells, several levels down, are part of the waiter (review 1): a candidate two levels below the
# waiter is dropped. A real process tree of ours: sh -> sh -> sleep, all stopped by pid below.
# Each level runs a second command, so no shell execs straight into its child.
sh -c 'sh -c "sleep 60; :" & wait; :' & deep=$!
sleep 1; mid="$(pgrep -P "$deep" | head -1)"; leaf="$(pgrep -P "$mid" 2>/dev/null | head -1)"
printf '100 %s\n%s\n%s\n' "$deep" "$(ps -ww -o command= -p "$deep")" "$(_kosmos_pid_started "$deep")" > "$W/markers/suitewait.$deep"
if [ -n "$leaf" ]; then
  out="$(printf '%s bash tools/run-tests.sh\n' "$leaf" | _kosmos_drop_suite_waiters)"
  [ -z "$out" ] && pass "#4498 a subshell two levels below a waiter is part of the waiter" \
    || fail "#4498 a waiter's grandchild was counted as a separate suite ($out)"
  rm -f "$W/markers/suitewait.$deep"
  out="$(printf '%s bash tools/run-tests.sh\n' "$leaf" | _kosmos_drop_suite_waiters)"
  [ -n "$out" ] && pass "#4498 CONTROL: the same process with no waiter above it is kept" || fail "#4498 CONTROL: an unrelated process was dropped"
else
  fail "#4498 could not build the three-level process tree for the walk test"
fi
for p in $leaf $mid $deep; do kill "$p" 2>/dev/null; done; wait "$deep" 2>/dev/null
rm -f "$W/markers/suitewait.$deep"

# The queue: the oldest waiter goes first; a run with no marker is behind every waiter.
rm -f "$W/held"; printf '100 %s\n%s\n%s\n' "$wp" "$(ps -ww -o command= -p "$wp")" "$(_kosmos_pid_started "$wp")" > "$W/markers/suitewait.$wp"
out="$(kosmos_refuse_if_earlier_suite_waiter "this test run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has_pid "$out" "$wp"; } && pass "#4498 a run that is not yet queued waits behind a queued suite" \
  || fail "#4498 an unqueued run jumped the queue (rc=$rc, $out)"
kosmos_mark_suite_waiting 200
out="$(kosmos_refuse_if_earlier_suite_waiter "this test run" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && pass "#4498 a later waiter waits for the earlier one" || fail "#4498 a later waiter went first (rc=$rc, $out)"
kosmos_mark_suite_waiting 50
out="$(kosmos_refuse_if_earlier_suite_waiter "this test run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4498 CONTROL: the earliest waiter goes" || fail "#4498 the earliest waiter was held (rc=$rc, $out)"
kosmos_unmark_suite_waiting
kill "$wp" 2>/dev/null; wait "$wp" 2>/dev/null
out="$(kosmos_refuse_if_earlier_suite_waiter "this test run" 2>&1)"; rc=$?
{ [ "$rc" -eq 0 ] && [ ! -e "$W/markers/suitewait.$wp" ]; } && pass "#4498 a dead waiter holds no place and its marker is removed" \
  || fail "#4498 a dead waiter still held the queue (rc=$rc, $out)"

# The second ask: clear once, but something started while this run was still marked, so it goes
# back to waiting in its OLD place, then starts. The check logs the queue time it sees each call.
qcheck() { local n; n=$(( $(cat "$W/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$W/calls"
  sed -n '1p' "$W/markers/suitewait.$$" 2>/dev/null | cut -d' ' -f1 >> "$W/seen"
  case "$n" in 1|3) echo "busy: call $n" >&2; return 1 ;; esac; return 0; }
rm -f "$W/calls" "$W/seen"
# Real one-second sleeps (review 1): with no sleep every mark lands in the same second, and a re-mark that took a
# NEW time would look the same as one that kept the old place.
out="$(KOSMOS_WAIT_EVERY_S=1 kosmos_wait_until_clear "this test run" --suite-queue qcheck 2>&1)"; rc=$?
seen="$(sort -u "$W/seen" | grep -c .)"
{ [ "$rc" -eq 0 ] && [ "$(cat "$W/calls")" = 5 ] && [ "$seen" = 1 ] && [ ! -e "$W/markers/suitewait.$$" ]; } \
  && pass "#4498 a harness that appears as the suite unqueues sends it back to waiting in its old place" \
  || fail "#4498 the second ask misbehaved (rc=$rc, calls=$(cat "$W/calls"), queue times seen=$seen, $out)"
rm -f "$W/calls"
# #4574: a STUCK run ahead (the same refusal every time). wcheck's message changes each call, which the queue now
# reads as the queue moving, so the give-up arms use wsame.
wsame() { local n; n=$(( $(cat "$W/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$W/calls"; [ "$n" -gt "${WPASS_AFTER:-0}" ] && return 0; echo "busy: stand-in run" >&2; return 1; }
out="$(WPASS_AFTER=99 KOSMOS_WAIT_MAX_S=30 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$W/markers/suitewait.$$" ]; } && pass "#4498 a suite that gives up leaves the queue" \
  || fail "#4498 a suite that gave up left its marker (rc=$rc, $out)"

# --- #4574: in the queue the bound counts from the last time a waiter AHEAD left ------------------
# Three live stand-in waiters with earlier queue times sit ahead of this run. A waiter leaves the queue by removing its
# marker (what a waiter that starts does), and the stand-in sleeper removes one on chosen calls. A fake clock
# (KOSMOS_WAIT_NOW) moves by QSTEP per sleep, so the wall-clock arm of the bound is exercised as well as the sleep count.
q_ahead() { local i; : > "$W/ahead"; for i in 1 2 3; do sleep 300 & echo "$!" >> "$W/ahead"
  printf '%s %s\n%s\n%s\n' "$((10 + i))" "$!" "$(ps -ww -o command= -p "$!")" "$(_kosmos_pid_started "$!")" > "$W/markers/suitewait.$!"; done; }
q_clear() { local p; for p in $(cat "$W/ahead" 2>/dev/null); do rm -f "$W/markers/suitewait.$p"; kill "$p" 2>/dev/null; wait "$p" 2>/dev/null; done; rm -f "$W/ahead" "$W/calls" "$W/clock" "$W/sleeps"; }
qnow() { cat "$W/clock" 2>/dev/null || echo 0; }
# Sleeps: advance the clock by QSTEP; on every QLEAVE-th sleep (0 = never) the first waiter still marked leaves.
qsleep() { local n p; n=$(( $(cat "$W/sleeps" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$W/sleeps"
  echo $(( $(qnow) + ${QSTEP:-30} )) > "$W/clock"
  [ "${QLEAVE:-0}" -gt 0 ] && [ $((n % QLEAVE)) -eq 0 ] || return 0
  for p in $(cat "$W/ahead"); do [ -e "$W/markers/suitewait.$p" ] && { rm -f "$W/markers/suitewait.$p"; return 0; }; done; }
q_clear; q_ahead
out="$(QLEAVE=2 WPASS_AFTER=8 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_NOW=qnow KOSMOS_WAIT_SLEEP=qsleep kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
# 10 calls: 8 refusals, the clear one, and the #4498 second ask after leaving the queue; 240 s on a 60 s bound.
{ [ "$rc" -eq 0 ] && [ "$(cat "$W/calls")" = 10 ] && [ ! -e "$W/markers/suitewait.$$" ]; } \
  && pass "#4574 a queue that keeps moving is waited through past the bound (240 s on a 60 s bound), then the run starts" \
  || fail "#4574 a moving queue gave up at the bound (rc=$rc, calls=$(cat "$W/calls"), $out)"
q_clear; q_ahead
out="$(QLEAVE=0 WPASS_AFTER=8 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_NOW=qnow KOSMOS_WAIT_SLEEP=qsleep kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 3 ] && has "$out" "no waiter ahead left for 60s" && [ ! -e "$W/markers/suitewait.$$" ]; } \
  && pass "#4574 CONTROL: a queue where nobody ahead leaves still gives up at the bound, and says no waiter ahead left" \
  || fail "#4574 a stuck queue was waited on past the bound (rc=$rc, calls=$(cat "$W/calls"), $out)"
q_clear; q_ahead
# The wall-clock arm: 100 s pass per sleep but only 30 s is counted asleep, so only the clock can reach a 60 s bound.
out="$(QSTEP=100 QLEAVE=1 WPASS_AFTER=4 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_NOW=qnow KOSMOS_WAIT_SLEEP=qsleep kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 0 ] && [ "$(cat "$W/calls")" = 6 ]; } \
  && pass "#4574 the wall-clock arm restarts too: three waiters leaving 100 s apart keep a 60 s bound from firing" \
  || fail "#4574 the wall clock gave up on a moving queue (rc=$rc, calls=$(cat "$W/calls"), $out)"
q_clear; q_ahead
out="$(QSTEP=100 QLEAVE=0 WPASS_AFTER=4 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_NOW=qnow KOSMOS_WAIT_SLEEP=qsleep kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 2 ]; } \
  && pass "#4574 CONTROL: with nobody leaving, the wall clock alone ends the wait at the bound (one 100 s sleep)" \
  || fail "#4574 the wall-clock arm did not fire (rc=$rc, calls=$(cat "$W/calls"), $out)"
q_clear
qbad() { echo "not a time"; }
rm -f "$W/calls"
out="$(WPASS_AFTER=2 KOSMOS_WAIT_NOW=qbad KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 0 ] && ! has "$out" "syntax error"; } && pass "#4574 a clock seam that prints no number falls back to the real clock" \
  || fail "#4574 a non-numeric KOSMOS_WAIT_NOW broke the wait (rc=$rc, $out)"
rm -f "$W/calls"
# A refusal whose words change every call (wcheck) is not the queue moving: a new pid in a message is no signal.
out="$(WPASS_AFTER=10 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this test run" --suite-queue wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 3 ]; } \
  && pass "#4574 a refusal that only changes its wording does not restart the bound" \
  || fail "#4574 a changing refusal was read as the queue moving (rc=$rc, calls=$(cat "$W/calls"), $out)"
rm -f "$W/calls"
out="$(WPASS_AFTER=10 KOSMOS_WAIT_MAX_S=60 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "a test run" wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 3 ]; } \
  && pass "#4574 outside the queue the bound is unchanged" \
  || fail "#4574 a non-queue wait was stretched (rc=$rc, calls=$(cat "$W/calls"), $out)"
rm -f "$W/calls"
out="$(unset KOSMOS_WAIT_MAX_S KOSMOS_WAIT_EVERY_S; WPASS_AFTER=999 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this test run" --suite-queue wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 91 ]; } \
  && pass "#4574 the queue's default bound is 45 minutes (90 waits of 30 s), longer than a full suite (14 to 26 min measured)" \
  || fail "#4574 the queue default bound is not 2700 s (rc=$rc, calls=$(cat "$W/calls"))"
rm -f "$W/calls"
out="$(unset KOSMOS_WAIT_MAX_S KOSMOS_WAIT_EVERY_S; WPASS_AFTER=999 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "a test run" wsame 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$(cat "$W/calls")" = 41 ]; } \
  && pass "#4574 CONTROL: outside the queue the default bound stays 20 minutes (40 waits)" \
  || fail "#4574 the non-queue default bound moved (rc=$rc, calls=$(cat "$W/calls"))"
rm -f "$W/calls"

# The loop itself honours the queue: the box is clear, but an older suite is waiting, so this one waits.
sleep 60 & wp=$!
printf '100 %s\n%s\n%s\n' "$wp" "$(ps -ww -o command= -p "$wp")" "$(_kosmos_pid_started "$wp")" > "$W/markers/suitewait.$wp"
rm -f "$W/calls"
out="$(KOSMOS_NO_WAIT=1 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this test run" --suite-queue wcheck 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "has been waiting for the box longer" && has_pid "$out" "$wp"; } \
  && pass "#4498 a clear box still waits behind an older waiting suite" \
  || fail "#4498 the wait jumped an older waiting suite (rc=$rc, $out)"
kill "$wp" 2>/dev/null; wait "$wp" 2>/dev/null
rm -f "$W/calls"
out="$(KOSMOS_NO_WAIT=1 KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this test run" --suite-queue wcheck 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "#4498 CONTROL: once that waiter is gone the same run starts" || fail "#4498 a dead waiter still held the run (rc=$rc, $out)"

# The override and the inside-a-test rule skip the queue as well as the suite check (review 1). A copy of the real
# run-tests.sh in a scratch tree with one stray test file stops at its coverage check, the first thing after the
# guard, so "COVERAGE MISMATCH" means the guard let it through and nothing ran. The tree is rooted under /tmp by
# name (not $T, which may sit in the kt sandbox and would make every run here a fixture).
RT="$(mktemp -d /tmp/rt4498.XXXXXX)"; trap 'rm -rf "$T" "$RT"' EXIT
mkdir -p "$RT/tools/lib" "$RT/sub"; cp "$HERE/run-tests.sh" "$RT/tools/"; cp "$HERE"/lib/*.sh "$RT/tools/lib/"
: > "$RT/sub/stray.test.js"
sleep 60 & wp=$!
printf '100 %s\n%s\n%s\n' "$wp" "$(ps -ww -o command= -p "$wp")" "$(_kosmos_pid_started "$wp")" > "$W/markers/suitewait.$wp"
# The caller reads as a fixture (a node --test ancestor), except the stand-in pid $DEAD (see the wiring test below).
printf '#!/bin/sh\n[ "$1" = '"$DEAD"' ] || printf "node --test tools.x.test.js\\n"\n' > "$T/ancestor-all"; chmod +x "$T/ancestor-all"
rt_run() { (cd "$RT" && env KOSMOS_NO_WAIT=1 KOSMOS_WAIT_MAX_S=0 KOSMOS_HARNESS_PROBE="$T/probe-quiet" KOSMOS_SUITE_PROBE="$T/probe-quiet" \
  KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD= "$@" bash tools/run-tests.sh 2>&1); }
out="$(rt_run KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none")"
has "$out" "has been waiting for the box longer" && pass "#4498 CONTROL: a plain run waits behind an older waiting suite" \
  || fail "#4498 CONTROL: a plain run did not queue ($(printf '%s' "$out" | tail -2))"
out="$(rt_run KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_TESTS_IGNORE_SUITE=1)"
{ has "$out" "COVERAGE MISMATCH" && ! has "$out" "waiting for the box longer"; } \
  && pass "#4498 KOSMOS_TESTS_IGNORE_SUITE=1 runs past the queue too, as its message says" \
  || fail "#4498 the override still queued ($(printf '%s' "$out" | tail -2))"
out="$(rt_run KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-all")"
{ has "$out" "COVERAGE MISMATCH" && ! has "$out" "waiting for the box longer"; } \
  && pass "#4498 a run-tests.sh inside a test does not queue behind a waiting suite" \
  || fail "#4498 a run-tests.sh fixture queued ($(printf '%s' "$out" | tail -2))"
kill "$wp" 2>/dev/null; wait "$wp" 2>/dev/null; rm -f "$W/markers/suitewait.$wp"

# A cut that claims the box while a suite waits holds it (Kano's review, Liu Kang m3015): the stand-in suite is live
# on the first ask, and that ask also writes a foreign, live, unexpired claim; after it the suite is gone. A run that
# asked the claim only once, before waiting, would now start inside the cut (COVERAGE MISMATCH); this one keeps
# waiting, names the release, and refuses at its short bound.
sleep 60 & holder=$!
cat > "$T/sprobe-then-cut" <<SH
#!/bin/sh
n=\$(cat "$W/cutcalls" 2>/dev/null || echo 0); n=\$((n + 1)); echo "\$n" > "$W/cutcalls"
if [ "\$n" -eq 1 ]; then
  printf 'OTHER %s %s mortals release 0.9.99\\n' "$holder" "\$((\$(date +%s) + 600))" > "$W/markers/machine-claim"
  printf '%s bash tools/run-tests.sh\\n' "$DEAD"; exit 0
fi
exit 1
SH
chmod +x "$T/sprobe-then-cut"; rm -f "$W/cutcalls" "$W/markers/machine-claim"
out="$(cd "$RT" && env KOSMOS_WAIT_EVERY_S=1 KOSMOS_WAIT_MAX_S=3 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" \
  KOSMOS_HARNESS_PROBE="$T/probe-quiet" KOSMOS_SUITE_PROBE="$T/sprobe-then-cut" KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD= bash tools/run-tests.sh 2>&1)"; rc=$?
# It began waiting on the suite (the first ask), then the claim held it to the bound. After the claim appears the claim
# is asked first and refuses, so the suite probe is asked only once.
{ [ "$rc" -eq 1 ] && has "$out" "a test suite (tools/run-tests.sh) is already running" && has "$out" "release 0.9.99" \
  && has "$out" "gave up after waiting" && ! has "$out" "COVERAGE MISMATCH"; } \
  && pass "#4498 a cut that claims the box while a suite waits holds the suite, and the wait names the release" \
  || fail "#4498 a waiting suite started inside a cut (rc=$rc, asks=$(cat "$W/cutcalls" 2>/dev/null), $(printf '%s' "$out" | tail -2))"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null; rm -f "$W/markers/machine-claim" "$W/cutcalls"

# The wiring, end to end: a real run-tests.sh beside a stand-in suite refuses at once under
# KOSMOS_NO_WAIT=1 (and KOSMOS_WAIT_MAX_S=0, so even a build that ignores it cannot wait) and names the suite, before it runs a test. (A green end-to-end would run the whole
# suite; the go paths are shown above.) test-install.sh refuses an unknown argument.
out="$(cd "$HERE/.." && KOSMOS_NO_WAIT=1 KOSMOS_WAIT_MAX_S=0 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_HARNESS_PROBE="$T/probe-quiet" KOSMOS_SUITE_PROBE="$T/sprobe-live" \
  KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD= bash tools/run-tests.sh 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "a test suite (tools/run-tests.sh) is already running" && has "$out" "KOSMOS_TESTS_IGNORE_SUITE=1"; } \
  && pass "#4498 run-tests.sh refuses beside another live suite (KOSMOS_NO_WAIT=1), naming its override" \
  || fail "#4498 run-tests.sh did not refuse beside a live suite (rc=$rc, $(printf '%s' "$out" | tail -3))"
# A run-tests.sh inside a test (here: every pid has a node --test ancestor) is part of the suite that
# started it, so it skips the suite check. The live stand-in harness (fixtures kept) is what refuses
# it instead; the suite check comes first, so a missing skip would print the suite refusal.
# The stand-in suite's own pid ($DEAD) is exempt, so only the CALLER reads as a fixture.
printf '#!/bin/sh\n[ "$1" = '"$DEAD"' ] || printf "node --test tools.x.test.js\\n"\n' > "$T/ancestor-all"; chmod +x "$T/ancestor-all"
out="$(cd "$HERE/.." && KOSMOS_NO_WAIT=1 KOSMOS_WAIT_MAX_S=0 KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-all" KOSMOS_HARNESS_KEEP_FIXTURES=1 KOSMOS_HARNESS_SELF_PID=999999 \
  KOSMOS_HARNESS_PROBE="$T/hprobe-real" KOSMOS_SUITE_PROBE="$T/sprobe-live" KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD= bash tools/run-tests.sh 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "an install harness" && ! has "$out" "a test suite (tools/run-tests.sh) is already running"; } \
  && pass "#4498 a run-tests.sh inside a test does not wait on the suite that started it" \
  || fail "#4498 a run-tests.sh fixture checked for other suites (rc=$rc, $(printf '%s' "$out" | tail -3))"
# Bounded as if the parse were broken: a 999999999 MB disk floor and no waiting, so this can never start a harness.
out="$(cd "$HERE/.." && KOSMOS_HARNESS_MIN_FREE_MB=999999999 KOSMOS_NO_WAIT=1 KOSMOS_WAIT_MAX_S=0 bash tools/test-install.sh --nowait 2>&1)"; rc=$?
{ [ "$rc" -eq 2 ] && has "$out" "unknown argument '--nowait'"; } && pass "#4498 test-install.sh refuses a mistyped --no-wait instead of waiting" \
  || fail "#4498 test-install.sh took an unknown argument (rc=$rc, $out)"

echo "cut guard: $fails failures"; [ "$fails" -eq 0 ]
