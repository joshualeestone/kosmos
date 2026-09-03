#!/bin/bash
# The live-cut guard shown red, green and unable to answer (#708).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/cut-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
# #1796: isolate the run-marker dir so the always-on marker arm reads THIS test's
# fixtures, never a real marker a live run on this box may have left in the default
# /tmp dir. The existing arms below get an empty dir (marker arm inert); the marker
# arms at the end point it at populated fixtures.
export KOSMOS_RUN_MARKER_DIR="$T/markers-empty"; mkdir -p "$KOSMOS_RUN_MARKER_DIR"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
printf '#!/bin/sh\nprintf "86263 bash tools/release.sh 0.5.54\\n"\n' > "$T/probe-live"; chmod +x "$T/probe-live"
printf '#!/bin/sh\nexit 1\n' > "$T/probe-quiet"; chmod +x "$T/probe-quiet"
printf '#!/bin/sh\nexit 3\n' > "$T/probe-dead"; chmod +x "$T/probe-dead"

out="$(KOSMOS_CUT_PROBE="$T/probe-live" kosmos_refuse_if_cut_live "a full run" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses while a cut is running"; else fail "refuses while a cut is running (rc=$rc)"; fi
if has "$out" "release.sh 0.5.54" && has "$out" "cut-suite-runs.log"; then pass "and names the cut and where its end is recorded"; else fail "and names the cut: $out"; fi
if has "$out" "KOSMOS_HARNESS_IGNORE_CUT=1"; then pass "and names the override"; else fail "and names the override: $out"; fi

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

printf '#!/bin/sh\nprintf "4242 bash tools/release.sh 0.5.99\\n9191 bash tools/release.sh 0.5.98\\n"\n' > "$T/probe-two"; chmod +x "$T/probe-two"
out="$(KOSMOS_CUT_SELF_PID=4242 KOSMOS_CUT_PROBE="$T/probe-two" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "ANOTHER cut still refuses once self is excluded" \
  || fail "excluding self also excluded a real second cut, so the guard cannot fire (rc=$rc)"
has "$out" "9191" && pass "and it names the OTHER cut, not itself" || fail "it named the wrong process: $out"

# --- END TO END, through the real pgrep, with a script genuinely named
# --- tools/release.sh. The probe seam cannot prove this one: the bug it
# --- guards against lives in what pgrep really reports about this process.
mkdir -p "$T/tools"
cat > "$T/tools/release.sh" <<SH
#!/bin/bash
. "$HERE/lib/cut-guard.sh"
if [ "\${1:-}" = "--sleep" ]; then sleep "\$2"; exit 0; fi
kosmos_refuse_if_cut_live "a cut" || exit 1
echo SELF-OK
SH
chmod +x "$T/tools/release.sh"
live_other="$(pgrep -fl 'release\.sh' 2>/dev/null | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/release\.sh( |$)' || true)"
if [ -n "$live_other" ]; then
  # Precomputed, not piped inside the echo: the repo's own hook rejects a pipe
  # here on sight, and it is right to -- this file exists to be trusted about
  # exit statuses.
  _first_live="${live_other%%$'\n'*}"
  echo "SKIP  end-to-end self-check: a real cut is live on this Mac, so this arm cannot answer"
  echo "      (that is a skip, NOT a pass: ${_first_live:0:60})"
else
  out="$(cd "$T" && bash tools/release.sh 2>&1)"; rc=$?
  { [ "$rc" -eq 0 ] && has "$out" "SELF-OK"; } \
    && pass "a real bash tools/release.sh does not refuse ITSELF (the outage this would have caused)" \
    || fail "a real release.sh refused itself: rc=$rc out=$out"

  ( cd "$T" && bash tools/release.sh --sleep 4 ) & sleeper=$!
  sleep 1
  out="$(cd "$T" && bash tools/release.sh 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && pass "but a SECOND real release.sh is refused while the first runs" \
    || fail "two real cuts both proceeded: rc=$rc out=$out"
  kill "$sleeper" 2>/dev/null; wait "$sleeper" 2>/dev/null
fi

# --- #1713: the MIRROR guard, kosmos_refuse_if_harness_live, shown red, green,
# --- and unable to answer via its own KOSMOS_HARNESS_PROBE seam. Reuses the
# --- probe-quiet/probe-dead fixtures above (exit 1 / exit 3 are guard-agnostic).
printf '#!/bin/sh\nprintf "77123 bash tools/test-install.sh\\n"\n' > "$T/hprobe-live"; chmod +x "$T/hprobe-live"
out="$(KOSMOS_HARNESS_PROBE="$T/hprobe-live" kosmos_refuse_if_harness_live "this cut" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "the cut refuses while an install harness is running"; else fail "the cut refuses while a harness runs (rc=$rc)"; fi
if has "$out" "test-install.sh" && has "$out" "fixed port"; then pass "and names the harness and why they collide"; else fail "and names the harness: $out"; fi
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
# 🛑 CRITICAL: the guard is called from a SEPARATE process ($T/tools/cut-start.sh,
# standing in for the cut that calls it), so a harness/mention this test spawns is
# a SIBLING of that caller, not its descendant. Called directly from this test,
# _kosmos_drop_self_subtree would drop the spawned processes as "self's subtree"
# and both arms would pass for the WRONG reason (self-exclusion, not the filter or
# detection). Measured: the direct form silently dropped the real harness.
cat > "$T/tools/test-install.sh" <<SH
#!/bin/bash
if [ "\${1:-}" = "--sleep" ]; then sleep "\$2"; exit 0; fi
exit 0
SH
chmod +x "$T/tools/test-install.sh"
cat > "$T/tools/cut-start.sh" <<SH
#!/bin/bash
. "$HERE/lib/cut-guard.sh"
kosmos_refuse_if_harness_live "this cut" || exit 1
echo CUT-PROCEEDS
SH
chmod +x "$T/tools/cut-start.sh"
live_harness="$(pgrep -fl 'test-install\.sh' 2>/dev/null | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |$)' || true)"
if [ -n "$live_harness" ]; then
  _fh="${live_harness%%$'\n'*}"
  echo "SKIP  harness end-to-end: a real harness is live on this Mac, so this arm cannot answer"
  echo "      (that is a skip, NOT a pass: ${_fh:0:60})"
else
  # #1967: this "cut proceeds" arm is the same CLASS as the mention arm below (a
  # concurrent run's real harness would make cut-start.sh refuse and red it), but
  # it runs IMMEDIATELY after the pre-flight above with no `sleep` between, so its
  # collision window is sub-millisecond -- versus the mention arm's window, which
  # spans the `sleep 1` at step 4. The re-check is placed at the mention arm, the
  # one with real exposure; this arm is left to the pre-flight deliberately, not
  # by oversight.
  out="$(bash "$T/tools/cut-start.sh" 2>&1)"; rc=$?
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
  # close it (a 4s harness can still appear in the gap), and re-running alone is
  # what settles a genuine red -- but it removes the DESIGNED-IN case where our
  # own paired step 7 is another run's live harness.
  _foreign_harness="$(pgrep -fl 'test-install\.sh' 2>/dev/null | grep -E '^[0-9]+ +(/bin/)?(ba)?sh +([^ ]*/)?tools/test-install\.sh( |$)' || true)"
  if [ -n "$_foreign_harness" ]; then
    _fh5="${_foreign_harness%%$'\n'*}"
    echo "SKIP  a mere MENTION does not count: a real harness is live (a concurrent run), so this arm cannot answer"
    echo "      (that is a skip, NOT a pass: ${_fh5:0:60})"
  else
    out="$(bash "$T/tools/cut-start.sh" 2>&1)"; rc=$?
    { [ "$rc" -eq 0 ] && has "$out" "CUT-PROCEEDS"; } \
      && pass "a mere MENTION of test-install.sh in a command line does not count" \
      || fail "a mention was mistaken for a live harness: rc=$rc out=$out"
  fi
  kill "$mention" 2>/dev/null; wait "$mention" 2>/dev/null

  ( cd "$T" && bash tools/test-install.sh --sleep 4 ) & harness=$!
  sleep 1
  out="$(bash "$T/tools/cut-start.sh" 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && pass "a real bash tools/test-install.sh IS detected and refuses the cut" \
    || fail "a live harness was not detected: rc=$rc out=$out"
  kill "$harness" 2>/dev/null; wait "$harness" 2>/dev/null
fi

# --- #1796: the marker arm, driven by KOSMOS_RUN_MARKER_DIR. Each arm uses a fresh
# --- dir and probe-quiet (the NAME arm clean), so ONLY the marker arm can fire --
# --- proving it works independently of the pgrep detection.
# A live foreign-cookie marker refuses even when the name arm is clean.
M1="$T/m1"; mkdir -p "$M1"; ( sleep 30 ) & p1=$!; printf 'FOREIGN\n' > "$M1/cut.$p1"
out="$(KOSMOS_RUN_MARKER_DIR="$M1" KOSMOS_CUT_PROBE="$T/probe-quiet" kosmos_refuse_if_cut_live "a cut" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "#1796 a live marked cut (foreign cookie) refuses with the name arm clean" \
  || fail "#1796 marked cut did not refuse (rc=$rc, $out)"
has "$out" "pid $p1" && pass "#1796 and it names the marked run's pid" || fail "#1796 did not name the marked pid: $out"
kill "$p1" 2>/dev/null; wait "$p1" 2>/dev/null

# The caller's OWN marker (matching cookie) is excluded -- the self-refuse outage.
M2="$T/m2"; mkdir -p "$M2"; ( sleep 30 ) & p2=$!; printf 'MINE\n' > "$M2/cut.$p2"
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

echo "cut guard: $fails failures"; [ "$fails" -eq 0 ]
