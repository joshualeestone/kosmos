#!/usr/bin/env bash
# Behavioural test for the #2760 P1 gated-steps region of tools/release.sh -- the
# restructure that lets the node suite (step 3) OVERLAP the headless render checks
# (step 3b) at low priority, opt-in via KOSMOS_CUT_PARALLEL=1.
#
# WHY THIS EXISTS: the restructure touches the single most safety-critical region
# of the cut -- the two gates that refuse to ship a red suite or a red page. The
# load-bearing invariant is that BOTH gates still RUN and still ABORT on red in
# BOTH the serial (default) and the parallel (opt-in) path. A bash -n cannot see
# that; a grep cannot see that; only running the region can. So this test extracts
# the region VERBATIM from release.sh (between the `#2760-P1 ... region START/END`
# markers, so it tracks the real bytes and cannot drift to a stale copy) and drives
# it under stubs for every red/green combination in both modes.
#
# It asserts the dangerous direction: a real red MUST abort. A test that only
# checked the green path would pass even if a red slipped through.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
GUARD="$REPO_ROOT/tools/lib/cut-load-guard.sh"
RELEASE="$REPO_ROOT/tools/release.sh"

fails=0
ok()  { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- extract the region between the markers (fail LOUD if absent: a vacuous
#     extraction must never read as a pass) ---
REGION="$WORK/region.sh"
awk '
  /#2760-P1 gated-steps region START/ { grab=1; next }
  /#2760-P1 gated-steps region END/   { grab=0 }
  grab { print }
' "$RELEASE" > "$REGION"
region_lines="$(wc -l < "$REGION" | tr -d ' ')"
if [ "${region_lines:-0}" -lt 20 ]; then
  bad "region extraction: got $region_lines lines between the markers (expected the full gated-steps block). The START/END markers in tools/release.sh are missing or renamed -- this test cannot run."
  echo "FAILS: $fails"; exit 1
fi
ok "extracted the gated-steps region from release.sh ($region_lines lines, by marker)"
# sanity: the region must still contain both gates' commands and both abort lines,
# or the extraction grabbed the wrong span.
grep -q 'yarn test' "$REGION"                     && ok "region contains the suite run (yarn test)"        || bad "region missing the suite run"
grep -q 'browser-checks.sh' "$REGION"             && ok "region contains the page run (browser-checks.sh)" || bad "region missing the page run"
grep -q 'the suite is genuinely red' "$REGION"    && ok "region contains the suite-red abort"              || bad "region missing the suite-red abort"
grep -q 'the page checks are red' "$REGION"        && ok "region contains the page-red abort"               || bad "region missing the page-red abort"
grep -q 'nice -n' "$REGION"                        && ok "region backgrounds the suite at low priority (nice)" || bad "region missing nice (low-priority suite)"
grep -q 'kosmos_cut_parallel_ok' "$REGION"         && ok "region gates the overlap on kosmos_cut_parallel_ok"  || bad "region missing the parallel gate"

# CLAUDE.md Convention #5 ("two derivations of one fact"): the page-gate invocation is
# duplicated byte-for-byte between the parallel branch and the serial branch (the SUITE
# invocation is deliberately NOT -- the parallel one adds `nice`). A comment asserts the two
# are "the SAME command", but a comment is not enforcement: a future edit to one branch (an
# added env var, a changed strict-version flag) could silently drift from the other with
# nothing catching it. Pin them equal here -- Convention #5's sanctioned "a test that pins
# duplicates equal" -- matching on the `>"$_page_log"` redirect so prose mentions of
# browser-checks.sh in comments cannot satisfy it.
pg_count=$(grep -c 'bash tools/browser-checks.sh >"$_page_log"' "$RELEASE")
[ "$pg_count" -eq 2 ] \
  && ok "page-gate invocation appears exactly twice in release.sh (parallel + serial branch)" \
  || bad "expected exactly 2 page-gate invocations in release.sh, found $pg_count -- a branch gained or lost one"
pg_distinct=$(grep 'bash tools/browser-checks.sh >"$_page_log"' "$RELEASE" | sed 's/^[[:space:]]*//' | sort -u | grep -c .)
[ "$pg_distinct" -eq 1 ] \
  && ok "the parallel and serial page-gate invocations are byte-identical (modulo indent)" \
  || bad "the parallel and serial page-gate invocations have DRIFTED ($pg_distinct distinct forms) -- Convention #5: keep them identical"

# --- drive the region under stubs ---
# $1 desc  $2 extra-env (space-separated VAR=val)  $3 expect (0=completes / 1=aborts)
#   optional $4 = a label the run's STEP output MUST contain (branch-taken proof)
run() {
  local desc="$1" extraenv="$2" expect="$3" wantstep="${4:-}"
  local repo bin out rc got
  repo="$(mktemp -d "$WORK/repo.XXXXXX")"; bin="$(mktemp -d "$WORK/bin.XXXXXX")"
  local fhome; fhome="$(mktemp -d "$WORK/home.XXXXXX")"
  mkdir -p "$repo/tools" "$fhome/.claude/logs"
  # the page gate stub: print a PASS line the region greps for, then exit PAGE_EXIT.
  printf '%s\n' 'echo "PASS stub-page-check"; exit "${PAGE_EXIT:-0}"' > "$repo/tools/browser-checks.sh"
  # the suite stub: print the tally lines the region greps for, then exit YARN_EXIT.
  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'echo "ℹ tests 1"; echo "ℹ pass 1"; echo "ℹ fail 0"; exit "${YARN_EXIT:-0}"'
  } > "$bin/yarn"; chmod +x "$bin/yarn"

  out="$(cd "$repo" && env PATH="$bin:$PATH" HOME="$fhome" REPO="$repo" V="9.9.9" $extraenv bash -c '
    set -euo pipefail
    . "'"$GUARD"'"
    step(){ echo "STEP: $1" >&2; }
    kosmos_isolation_rerun_verdict(){ return "${RERUN_RC:-0}"; }
    source "'"$REGION"'"
    echo "REGION-COMPLETED-OK"
  ' 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && got=0 || got=1

  if [ "$got" = "$expect" ]; then
    ok "$desc"
  else
    bad "$desc (rc=$rc, expected-abort=$expect)"; printf '%s\n' "$out" | sed 's/^/         | /'
  fi
  if [ -n "$wantstep" ]; then
    if printf '%s\n' "$out" | grep -qF "$wantstep"; then ok "  ^ took the expected branch ($wantstep)"; else bad "  ^ wrong branch: STEP output did not contain [$wantstep]"; fi
  fi
  rm -rf "$repo" "$bin" "$fhome"
}

echo "--- SERIAL mode (flag off -> current behaviour, unchanged) ---"
run "serial: green suite + green page -> completes"                 ""                                   0 "STEP: == 3. "
run "serial: REAL red suite (rerun stays red) -> ABORTS"            "YARN_EXIT=1 RERUN_RC=1"              1
run "serial: red suite dismissed as contention -> completes"        "YARN_EXIT=1 RERUN_RC=0 PAGE_EXIT=0"  0
run "serial: green suite + RED page -> ABORTS"                      "YARN_EXIT=0 PAGE_EXIT=1"             1
run "serial: page COULD-NOT-RUN (127) -> ABORTS"                    "YARN_EXIT=0 PAGE_EXIT=127"           1

echo "--- PARALLEL mode (opt-in + quiet box -> overlap) ---"
# Pin BOTH cores and max-load so the parallel arms take the overlap branch on ANY host,
# CI included. Without KOSMOS_CUT_PARALLEL_MIN_CORES=1 these arms depend on the host having
# >= 8 cores (the default min); CI runs on macos-latest (3-4 cores), where the decision
# returns SERIAL, the "== 3+3b." branch assertion fails, AND the parallel-mode abort proofs
# silently never run -- defeating this test's whole purpose. FAKE_LOAD=0.1 < MAX_LOAD=5
# keeps the load arm host-independent too. (The unit tests in test-cut-load-guard.sh pin
# MIN_CORES=1 on every decision case for exactly this reason.)
P="KOSMOS_CUT_PARALLEL=1 KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MIN_CORES=1 KOSMOS_CUT_PARALLEL_MAX_LOAD=5"
run "parallel: green suite + green page -> completes"               "$P"                                  0 "STEP: == 3+3b."
run "parallel: REAL red suite (rerun stays red) -> ABORTS"          "$P YARN_EXIT=1 RERUN_RC=1 PAGE_EXIT=0" 1
run "parallel: red suite dismissed as contention -> completes"      "$P YARN_EXIT=1 RERUN_RC=0 PAGE_EXIT=0" 0
run "parallel: green suite + RED page -> ABORTS"                    "$P YARN_EXIT=0 PAGE_EXIT=1 RERUN_RC=0" 1
run "parallel: page COULD-NOT-RUN (127) -> ABORTS"                  "$P YARN_EXIT=0 PAGE_EXIT=127 RERUN_RC=0" 1

echo
echo "FAILS: $fails"
[ "$fails" -eq 0 ]
