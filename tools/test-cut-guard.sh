#!/bin/bash
# The live-cut guard shown red, green and unable to answer (#708).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/cut-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
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

echo "cut guard: $fails failures"; [ "$fails" -eq 0 ]
