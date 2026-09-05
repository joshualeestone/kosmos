#!/bin/bash
# The concurrent-page-layer guard shown red, green and unable to answer.
#
# ⚠️ WHY THIS EXISTS SEPARATELY FROM tools/test-cut-guard.sh. The fleet rule
# said "do not run browser checks while a CUT is running" and the cut guard
# detects a CUT, so a HAND-RUN page layer was invisible to both. Measured
# 2026-08-27 13:17Z: a peer's `bash tools/browser-checks.sh` had been live for
# 8m29s, `pgrep release.sh` returned nothing CORRECTLY, and the cut guard said
# clear. What cost cut three was never the cut: it was two concurrent
# Playwright runs starving each other, and the loser failed with errors that
# read exactly like missing code.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/cut-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
# #2271: isolate every guard call below from the SHARED machine's real run-markers. The guard checks
# the marker dir (via _kosmos_marker_dir) IN ADDITION to KOSMOS_BC_PROBE, so on a busy box a foreign
# browser-checks run's marker leaked PAST the process probe and RED this test inside the cut's step-3
# run (measured on the 0.6.36 cut, twice: pids 53967 and 36115). Point the marker dir at an empty
# temp dir so the probe seam fully controls what "live" means; the marker input gets its own
# controlled arm below, so isolating it here does not lose marker-detection coverage.
export KOSMOS_RUN_MARKER_DIR="$T/markers"; mkdir -p "$T/markers"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

printf '#!/bin/sh\nprintf "99999 bash tools/browser-checks.sh\\n"\n' > "$T/probe-live"; chmod +x "$T/probe-live"
printf '#!/bin/sh\nexit 1\n' > "$T/probe-quiet"; chmod +x "$T/probe-quiet"
printf '#!/bin/sh\nexit 3\n' > "$T/probe-dead"; chmod +x "$T/probe-dead"

out="$(KOSMOS_BC_PROBE="$T/probe-live" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses while another page layer is live"; else fail "refuses while another page layer is live (rc=$rc)"; fi
if has "$out" "browser-checks.sh"; then pass "and names the run it found"; else fail "and names the run: $out"; fi
if has "$out" "KOSMOS_HARNESS_IGNORE_CUT=1"; then pass "and names the override"; else fail "and names the override: $out"; fi
if has "$out" "read like missing code"; then pass "and says WHY, because the symptom is indistinguishable from a defect"; else fail "and says why: $out"; fi

out="$(KOSMOS_BC_PROBE="$T/probe-quiet" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "passes silently when no other run is live"; else fail "passes when nothing is live (rc=$rc, out=$out)"; fi

out="$(KOSMOS_BC_PROBE="$T/probe-dead" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "could not tell"; then pass "a probe that cannot answer is a refusal, not a pass"; else fail "unanswerable probe (rc=$rc, out=$out)"; fi

# #2271: the MARKER input (the one that leaked in from the real box). It is checked IN ADDITION to the
# process probe, so isolating the marker dir above must not have disabled it. A live marked browser run
# in the CONTROLLED marker dir must refuse even with a QUIET process probe. Red-capable: remove the
# marker file and the same call passes (the very next arm).
sleep 30 & mpid=$!
{ printf 'test-cookie-2271\n'; ps -ww -o command= -p "$mpid"; } > "$T/markers/browser.$mpid"
out="$(KOSMOS_BC_PROBE="$T/probe-quiet" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "marked"; then pass "a live marker refuses even under a quiet process probe (#2271)"; else fail "marker not detected (rc=$rc, out=$out)"; fi
rm -f "$T/markers/browser.$mpid"; kill "$mpid" 2>/dev/null; wait "$mpid" 2>/dev/null

# #2271: with the marker gone AND a quiet process probe, the guard passes -- on ANY box, because the
# marker dir is the isolated temp dir, not the shared machine's. THIS is the arm that RED the cut
# before the isolation above (a foreign marker was present in the real dir); it now passes regardless
# of what else is running on the Mac.
out="$(KOSMOS_BC_PROBE="$T/probe-quiet" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "quiet probe + isolated empty marker dir -> passes on ANY box (#2271 cut-red fix)"; else fail "should pass with nothing live (rc=$rc, out=$out)"; fi

# ⚠️ SELF-EXCLUSION. browser-checks.sh IS a `bash tools/browser-checks.sh`, so
# without this the gate refuses EVERY page-layer run on a Mac with no other
# run -- a total outage that reads exactly like the guard working.
printf '#!/bin/sh\nprintf "%%s bash tools/browser-checks.sh\\n" "$$SELF"\n' > "$T/probe-self"
sed -i '' "s/\$\$SELF/$$/" "$T/probe-self"; chmod +x "$T/probe-self"
out="$(KOSMOS_BC_PROBE="$T/probe-self" KOSMOS_BC_SELF_PID=$$ kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "does not refuse itself"; else fail "does not refuse itself (rc=$rc, out=$out)"; fi

# #1391: THE CALLER'S OWN SUBTREE MUST NOT COUNT. The disarm happened because a
# `bash tools/browser-checks.sh` that is the caller's own DESCENDANT (an argv-
# inheriting subshell) survived a single-pid exclusion and the gate refused
# itself. These two use a REAL pid (a cheap `sleep`, never a browser process, so
# they are safe by default on a shared Mac) fed through the seam's command line,
# and drive `self` to the ancestor vs. an unrelated sibling.
sleep 30 & kid=$!
printf '#!/bin/sh\nprintf "%%s bash tools/browser-checks.sh\\n" "%s"\n' "$kid" > "$T/probe-kid"; chmod +x "$T/probe-kid"
out="$(KOSMOS_BC_PROBE="$T/probe-kid" KOSMOS_BC_SELF_PID=$$ kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
kill "$kid" 2>/dev/null; wait "$kid" 2>/dev/null
if [ "$rc" -eq 0 ]; then pass "excludes a candidate that is the caller's own DESCENDANT (#1391)"; else fail "#1391 descendant not excluded (rc=$rc): $out"; fi

sleep 30 & kid=$!; sleep 30 & unrel=$!
printf '#!/bin/sh\nprintf "%%s bash tools/browser-checks.sh\\n" "%s"\n' "$kid" > "$T/probe-kid2"; chmod +x "$T/probe-kid2"
out="$(KOSMOS_BC_PROBE="$T/probe-kid2" KOSMOS_BC_SELF_PID=$unrel kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
kill "$kid" "$unrel" 2>/dev/null; wait "$kid" "$unrel" 2>/dev/null
if [ "$rc" -eq 1 ]; then pass "a candidate OUTSIDE the caller's subtree still refuses (#1391 mirror)"; else fail "#1391 mirror: out-of-subtree not refused (rc=$rc): $out"; fi

# #1391: THE GUARD MUST STAY ARMED IN browser-checks.sh. Every test above drives
# the guard FUNCTION; none of them would go red if the arm call were removed from
# the shipped runner -- which is exactly how this guard reached the disarmed state
# it was in (a false positive cost a cut, the arming was deleted, and nothing said
# so). Assert the runner actually CALLS the arm, on a non-comment line, so a
# re-disarm or an accidental deletion turns this test red.
BC="$HERE/browser-checks.sh"
if [ -f "$BC" ] && grep -vE '^[[:space:]]*#' "$BC" | grep -q 'kosmos_refuse_if_browser_run_live'; then
  pass "browser-checks.sh ARMS the concurrent-page-layer guard (guards against re-disarm)"
else
  fail "browser-checks.sh does NOT call kosmos_refuse_if_browser_run_live -- the guard is disarmed"
fi

# ⚠️ THE REAL pgrep PATH, NOT ONLY THE SEAM. Every check above drives the probe
# seam, so all of them would still pass if the real pgrep expression matched
# nothing at all. A decoy process with the true command line proves the shipped
# expression matches what it claims to. It sleeps; it never starts a browser.
mkdir -p "$T/tools"
printf '#!/bin/bash\nsleep 30\n' > "$T/tools/browser-checks.sh"; chmod +x "$T/tools/browser-checks.sh"
# ⚠️ MEASURED AS A DELTA, NOT AS A VERDICT. A colleague's real page-layer run
# may be live on this shared Mac while this test runs, and then "the guard
# refused" would be true no matter what the shipped expression matched -- the
# control would pass for a reason nobody checked. So count before and after:
# the decoy must add exactly one, whatever else is running.
# #2287: key on the guard's EXIT CODE (its actual verdict: 1 = a live run was seen for this caller,
# 0 = none), NOT its message text. The old live_count parsed a "Mac (<n> live; first: ..." COUNT that
# the guard's current message (cut-guard.sh:301, a single <detail>, no count) no longer emits, so it
# returned 0 for EVERY caller and the delta assertion below was always 0 != 1. The rc is what the
# guard is actually deciding and cannot drift with the message wording. This makes the arm a boolean
# pair (mine must not refuse for the excluded decoy; theirs must) rather than a count-delta; that suits
# the arm's documented IDLE-box precondition, where there is no background page layer to cancel out.
live_refuses() {
  KOSMOS_BC_SELF_PID="${1:-$$}" kosmos_refuse_if_browser_run_live "count" >/dev/null 2>&1
  [ "$?" -eq 1 ] && echo 1 || echo 0
}
# #2287: prove live_refuses's rc-keying on the controlled probe seam, so the fix is validated by the
# DEFAULT run (the real-path arm below only runs opt-in on an idle box). Red-capable: probe-live -> 1,
# probe-quiet -> 0; a helper that ignored rc (the old text-parse bug) would print 0 for probe-live.
r="$(KOSMOS_BC_PROBE="$T/probe-live" live_refuses "$$")"
if [ "$r" = "1" ]; then pass "live_refuses reports 1 when the guard refuses (seam)"; else fail "live_refuses on a live probe: $r"; fi
r="$(KOSMOS_BC_PROBE="$T/probe-quiet" live_refuses "$$")"
if [ "$r" = "0" ]; then pass "live_refuses reports 0 when the guard passes (seam)"; else fail "live_refuses on a quiet probe: $r"; fi
# 🛑 OPT-IN, AND THE REASON IS NOT TIDINESS. This decoy is a literal
# `bash tools/browser-checks.sh`, deliberately, so the SHIPPED pgrep
# expression matches it -- that is the only thing that makes this a real-path
# control rather than a fifth seam check.
# ⭐ AND THAT IS EXACTLY WHY IT CANNOT RUN BY DEFAULT ON A SHARED BOX. On
# 2026-08-27 this test ran during a release cut's page layer, the cut's guard
# saw the decoy, and the cut was refused. Twice. Three people then spent time
# mis-identifying the process in `ps`, because it is indistinguishable from a
# real page layer to everyone, not just to the guard.
# ⚠️ THE SKIP IS PRINTED LOUDLY. A control that quietly does not run is worse
# than no control: the suite still says "all clear" and nobody knows which
# claims that covers.
if [ "${KOSMOS_BC_REALPATH:-0}" != 1 ]; then
  echo "SKIP  the SHIPPED pgrep expression vs a real process"
  echo "      -- spawns a look-alike page layer, which refuses any concurrent"
  echo "         release cut. Run it deliberately on an idle box:"
  echo "         KOSMOS_BC_REALPATH=1 bash tools/test-browser-run-guard.sh"
  echo
  if [ "$fails" -eq 0 ]; then echo "all clear (real-path control SKIPPED)"; else echo "$fails FAILURES"; fi
  exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
fi
# ⚠️ MEASURED AS A DELTA so a colleague's real page layer on this shared Mac
# cancels out. The decoy is a real `bash tools/browser-checks.sh`; counted from
# an UNRELATED caller it adds exactly one, and from its OWN ancestor (#1391) it
# adds zero -- so theirs - mine == 1 proves BOTH that the shipped pgrep sees it
# AND that the subtree exclusion drops it for its own run.
( cd "$T" && bash tools/browser-checks.sh ) & decoy=$!
sleep 30 & unrel=$!
sleep 1
mine="$(live_refuses $$)"        # the decoy is OUR descendant -> excluded -> guard does NOT refuse
theirs="$(live_refuses $unrel)"  # the decoy is unrelated to $unrel -> seen -> guard refuses
out="$(KOSMOS_BC_SELF_PID=$unrel kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
# Kill by PID. Never `pkill -f browser-checks.sh` -- that matches every agent's
# real run on this shared Mac, across account dirs.
kill "$decoy" "$unrel" 2>/dev/null; wait "$decoy" "$unrel" 2>/dev/null
# #2287: an rc-based pair, not a count-delta (the guard emits no count to delta). On the documented
# IDLE box: theirs must refuse (the shipped pgrep saw the real decoy) AND name it (browser-checks.sh),
# and mine must NOT refuse (the #1391 subtree exclusion dropped the decoy for its own ancestor). Both
# claims the old delta proved, now keyed on the guard's verdict. If the box is not idle, `mine` may
# refuse on a background layer and this fails loudly -- correct for an opt-in idle-only diagnostic.
if [ "$theirs" -eq 1 ] && [ "$mine" -eq 0 ] && has "$out" "browser-checks.sh"; then
  pass "the SHIPPED pgrep sees a real page layer (names it) AND the subtree exclusion drops it for its own run (mine=$mine theirs=$theirs)"
else
  fail "real pgrep/#1391: expected theirs=1 mine=0 + named, got mine=$mine theirs=$theirs out=$out"
fi
if [ "$rc" -eq 1 ] && has "$out" "browser-checks.sh"; then
  pass "and an out-of-subtree real page layer refuses and is named"
else
  fail "out-of-subtree real run not refused (rc=$rc): $out"
fi

echo
if [ "$fails" -eq 0 ]; then echo "all clear"; else echo "$fails FAILURES"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
