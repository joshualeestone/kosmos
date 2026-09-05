#!/usr/bin/env bash
# Test for tools/lib/cut-rerun-guard.sh (#2006): the cut's isolation-rerun
# discriminator. It re-runs a failing test FILE alone and dismisses ONLY a file
# that goes green alone (contention makes false reds, never false greens), so
# the controls below prove it does NOT dismiss a file that stays red, and does
# NOT dismiss a failure it cannot isolate.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$REPO/tools/lib/cut-rerun-guard.sh"

fails=0
ok()  { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A scratch repo with one file that passes alone and one that fails alone.
cat > "$WORK/pass.test.js" <<'EOF'
const { test } = require('node:test'); const a = require('node:assert');
test('passes alone', () => { a.equal(1, 1); });
EOF
cat > "$WORK/fail.test.js" <<'EOF'
const { test } = require('node:test'); const a = require('node:assert');
test('fails alone', () => { a.equal(1, 2); });
EOF

# A node-suite tally line, as node prints it (aggregate "ℹ fail N").
tally() { printf '\xe2\x84\xb9 tests %s\n\xe2\x84\xb9 pass %s\n\xe2\x84\xb9 fail %s\n' "$1" "$2" "$3"; }

# --- kosmos_failing_test_files: extraction ---
log_pass="$WORK/log-pass"
{
  echo "failing tests:"
  echo ""
  echo "test at pass.test.js:2:1"
  echo "  passes alone (5ms)"
  echo "      at TestContext.<anonymous> (/abs/pass.test.js:2:1)"
  tally 3 2 1
} > "$log_pass"
got="$(kosmos_failing_test_files "$log_pass")"
[ "$got" = "pass.test.js" ] && ok "extracts the failing file and ignores the indented stack frame" \
  || bad "extraction got [$got], expected [pass.test.js]"

log_none="$WORK/log-none"
{ echo "a shell test failed"; echo "not ok 3 - something"; } > "$log_none"
got="$(kosmos_failing_test_files "$log_none")"
[ -z "$got" ] && ok "a red with no 'test at <file>' line extracts nothing (a shell/gate failure names no node file)" \
  || bad "expected empty extraction, got [$got]"

# --- CONTENTION: a file that passes alone is dismissed -> verdict 0 ---
if out="$(kosmos_isolation_rerun_verdict "$log_pass" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "a file that passes alone (tally accounts for it) -> verdict 0 (contention dismissed)" \
  || bad "contention case: rc=$rc, expected 0"
printf '%s\n' "$out" | grep -q "Dismissed" && ok "narration says the file was dismissed (re-ran and why)" \
  || bad "narration missing 'Dismissed'"
printf '%s\n' "$out" | grep -q "The cut proceeds" && ok "narration says the cut proceeds" \
  || bad "narration missing the proceed line"

# --- CONTROL (dangerous answer): a file that stays red alone must NOT be dismissed -> verdict 1 ---
log_fail="$WORK/log-fail"
{ echo "failing tests:"; echo "test at fail.test.js:2:1"; echo "  fails alone (5ms)"; tally 2 1 1; } > "$log_fail"
if out="$(kosmos_isolation_rerun_verdict "$log_fail" "$WORK" 2)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a file red in isolation across all attempts -> verdict 1 (abort), NOT dismissed" \
  || bad "real-red case: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "real failure" && ok "narration names it a real failure" \
  || bad "narration missing 'real failure'"

# --- #2006 SHELL-STAGE EXTENSION: a fail-0 red is the SHELL stage (node passed,
# the browser-check gate is fail-soft on the cut's trunk, a coverage mismatch has
# no tally). It re-runs the shell stage ALONE and dismisses ONLY on a green. All of
# these drive the KOSMOS_SHELL_RERUN_CMD seam so the assertion never runs a real
# 2-minute suite, and set SLEEP=0 so retries do not pause. A stray 'test at' line
# is present to prove the shell branch never reads the node file list. ---
export KOSMOS_SHELL_RERUN_SLEEP=0
log_shellred="$WORK/log-shellred"
{ tally 100 100 0; echo "test at pass.test.js:2:1"; echo "some shell test then failed"; } > "$log_shellred"

# CONTROL (dangerous answer): a shell stage that STAYS red alone must NOT be dismissed.
if out="$(KOSMOS_SHELL_RERUN_CMD=false kosmos_isolation_rerun_verdict "$log_shellred" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "fail-0 + a shell stage that stays red alone -> verdict 1 (abort), even past a stray 'test at'" \
  || bad "fail-0 shell-red case: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "real shell-test failure" && ok "narration names it a real shell-test failure" \
  || bad "narration missing 'real shell-test failure'"

# CONTENTION: a shell stage that passes alone IS dismissed (the whole point of the extension).
if out="$(KOSMOS_SHELL_RERUN_CMD=true kosmos_isolation_rerun_verdict "$log_shellred" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "fail-0 + a shell stage that passes alone -> verdict 0 (contention dismissed)" \
  || bad "fail-0 shell-contention case: rc=$rc, expected 0"
printf '%s\n' "$out" | grep -q "Dismissed" && ok "shell narration says the stage was dismissed" \
  || bad "shell narration missing 'Dismissed'"
printf '%s\n' "$out" | grep -q "The cut proceeds" && ok "shell narration says the cut proceeds" \
  || bad "shell narration missing the proceed line"

# TRANSIENT contention: red on attempt 1, green on attempt 2 -> dismissed (the retry is what
# lets an unrelated live page layer clear). A per-scratch counter script flips on the 2nd run.
flip="$WORK/flip.sh"; cnt="$WORK/flip.count"; : > "$cnt"
cat > "$flip" <<EOF
#!/bin/sh
n=\$(wc -l < "$cnt" 2>/dev/null | tr -d ' '); echo x >> "$cnt"
[ "\$n" -ge 1 ] && exit 0 || exit 1
EOF
chmod +x "$flip"
if out="$(KOSMOS_SHELL_RERUN_CMD="sh $flip" kosmos_isolation_rerun_verdict "$log_shellred" "$WORK" 3)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "fail-0 + shell red on attempt 1, green on attempt 2 -> verdict 0 (transient contention dismissed)" \
  || bad "fail-0 shell-transient case: rc=$rc, expected 0"
printf '%s\n' "$out" | grep -q "attempt 2/3 -> contention" && ok "narration shows it dismissed on the 2nd attempt" \
  || bad "narration missing the attempt-2 dismissal"

# The rerun runs IN $repo: a command that greps a repo-local file must see it. Prove cd works.
echo "sentinel" > "$WORK/repo-marker"
if out="$(KOSMOS_SHELL_RERUN_CMD='grep -q sentinel repo-marker' kosmos_isolation_rerun_verdict "$log_shellred" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "the shell rerun runs INSIDE \$repo (a repo-relative command sees the tree)" \
  || bad "shell rerun cwd: rc=$rc, expected 0 (grep of a repo-local file should pass)"

# ERREXIT: a DIRECT caller under set -euo pipefail (release.sh's context, minus its if-wrapper)
# must reach the shell rerun and dismiss without aborting at any bare-list step.
export REPO WORK log_shellred
eset3_out="$(bash -c 'set -euo pipefail; export KOSMOS_SHELL_RERUN_SLEEP=0 KOSMOS_SHELL_RERUN_CMD=true; . "$REPO/tools/lib/cut-rerun-guard.sh"; kosmos_isolation_rerun_verdict "$log_shellred" "$WORK" 2' 2>&1)"; eset3_rc=$?
if [ "$eset3_rc" -eq 0 ] && printf '%s\n' "$eset3_out" | grep -q "Dismissed"; then
  ok "as a DIRECT caller under set -euo pipefail, the fail-0 shell rerun reaches the loop and dismisses (errexit-safe)"
else
  bad "errexit-safety (shell rerun): rc=$eset3_rc out=[$eset3_out]"
fi
unset KOSMOS_SHELL_RERUN_SLEEP

# --- COMPLETENESS: an INCOMPLETE parse (more failures than 'test at' lines) -> verdict 1 ---
# node says 2 failed but only one has a parseable 'test at' line: do NOT dismiss on the parseable one.
log_incomplete="$WORK/log-incomplete"
{ echo "test at pass.test.js:2:1"; echo "  passes alone"; tally 5 3 2; } > "$log_incomplete"
if out="$(kosmos_isolation_rerun_verdict "$log_incomplete" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "2 failures reported but 1 parseable -> verdict 1 (incomplete parse, abort)" \
  || bad "incomplete-parse case: rc=$rc, expected 1"

# --- COMPLETENESS control (pattern mismatch): a 'test at' line naming a NON-.test.js path
# (a test registered in a required helper) must NOT count toward completeness, or a real
# failure it represents would be dropped from the rerun set while a dismissable .test.js
# failure gets the cut waved through. Here: pass.test.js (dismissable) + engine/helper.js
# (a real failure, not a .test.js) + fail 2. testat_count must count only the .test.js line
# (1) < fail 2 -> abort. If it counted the broad '^test at ' pattern (2 == 2) it would
# dismiss on pass.test.js and let the helper.js failure through. ---
log_helper="$WORK/log-helper"
{ echo "test at pass.test.js:2:1"; echo "  passes alone"; echo "test at engine/helper.js:5:3"; echo "  a real failure registered from a helper"; tally 4 2 2; } > "$log_helper"
if out="$(kosmos_isolation_rerun_verdict "$log_helper" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a failure on a non-.test.js path (helper) + a dismissable .test.js -> verdict 1 (abort, not dismissed)" \
  || bad "pattern-mismatch case: rc=$rc, expected 1 (a broad testat_count would wrongly dismiss)"

# --- DEDUP: one file with MULTIPLE failing tests (testat_count 2 > files 1, both == fail 2) ---
# The count is per-test (2 'test at' lines), the file list dedups to 1; the check compares
# testat_count to fail_count (both 2), so it is accounted for and, passing alone, dismissed.
log_multi="$WORK/log-multi"
{ echo "test at pass.test.js:2:1"; echo "  first"; echo "test at pass.test.js:2:38"; echo "  second"; tally 3 1 2; } > "$log_multi"
if out="$(kosmos_isolation_rerun_verdict "$log_multi" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "one file with 2 failing tests (dedup, testat 2 == fail 2) passes alone -> verdict 0 (dismissed)" \
  || bad "multi-test-single-file case: rc=$rc, expected 0"

# --- fail>0 but ZERO parseable .test.js files -> the empty-files abort branch ---
log_onlyhelper="$WORK/log-onlyhelper"
{ echo "test at helper.js:1:1"; echo "  a non-.test.js failure, alone"; tally 2 1 1; } > "$log_onlyhelper"
if out="$(kosmos_isolation_rerun_verdict "$log_onlyhelper" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "fail 1 but no parseable .test.js file (only a helper.js line) -> verdict 1 (abort)" \
  || bad "no-parseable-file case: rc=$rc, expected 1"

# --- COMPLETENESS: no readable tally at all -> verdict 1 ---
log_notally="$WORK/log-notally"
{ echo "test at pass.test.js:2:1"; echo "  killed before the tally"; } > "$log_notally"
if out="$(kosmos_isolation_rerun_verdict "$log_notally" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "no 'fail N' tally (suite killed) -> verdict 1 (cannot prove completeness, abort)" \
  || bad "no-tally case: rc=$rc, expected 1"

# --- ERREXIT regression guard: as a DIRECT caller under set -euo pipefail (release.sh's
# context, but WITHOUT its if-wrapper that suspends errexit), the no-tally path must RETURN
# and narrate, not abort at the fail_count assignment. Runs in a fresh set -e shell. ---
export REPO WORK log_notally
eset_out="$(bash -c 'set -euo pipefail; . "$REPO/tools/lib/cut-rerun-guard.sh"; kosmos_isolation_rerun_verdict "$log_notally" "$WORK" 1' 2>&1)"; eset_rc=$?
if [ "$eset_rc" -eq 1 ] && printf '%s\n' "$eset_out" | grep -q "cannot be proven complete"; then
  ok "as a DIRECT caller under set -euo pipefail, no-tally returns 1 and narrates (errexit-safe, early branch)"
else
  bad "errexit-safety: a direct set -e caller aborted before narrating -- rc=$eset_rc out=[$eset_out]"
fi

# Deeper errexit coverage: a CONTENTION log reaches the while-read loop, the rerun for-loop,
# and the node --test rerun under active set -e, then dismisses. Guards those paths too.
export log_pass
eset2_out="$(bash -c 'set -euo pipefail; . "$REPO/tools/lib/cut-rerun-guard.sh"; kosmos_isolation_rerun_verdict "$log_pass" "$WORK" 1' 2>&1)"; eset2_rc=$?
if [ "$eset2_rc" -eq 0 ] && printf '%s\n' "$eset2_out" | grep -q "Dismissed"; then
  ok "as a DIRECT caller under set -euo pipefail, a contention log reaches the rerun loop and dismisses (errexit-safe, deep)"
else
  bad "errexit-safety (deep): rc=$eset2_rc out=[$eset2_out]"
fi

# --- SAFE FALLBACK: a red naming no node file cannot be isolated -> verdict 1 ---
if out="$(kosmos_isolation_rerun_verdict "$log_none" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a failure that names no node file -> verdict 1 (not auto-dismissed)" \
  || bad "no-file case: rc=$rc, expected 1"

# --- SAFE FALLBACK: a named-but-missing file cannot be isolated -> verdict 1 ---
log_missing="$WORK/log-missing"
{ echo "test at ghost.test.js:1:1"; echo "  ghost"; tally 2 1 1; } > "$log_missing"
if out="$(kosmos_isolation_rerun_verdict "$log_missing" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a named-but-missing file -> verdict 1 (cannot isolate, abort)" \
  || bad "missing-file case: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "NOT FOUND" && ok "narration says NOT FOUND" \
  || bad "narration missing 'NOT FOUND'"

# --- MIXED: one dismissable + one real -> verdict 1 (a real failure among contention still aborts) ---
log_mixed="$WORK/log-mixed"
{ echo "test at pass.test.js:2:1"; echo "  passes alone"; echo "test at fail.test.js:2:1"; echo "  fails alone"; tally 4 2 2; } > "$log_mixed"
if out="$(kosmos_isolation_rerun_verdict "$log_mixed" "$WORK" 2)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "mixed (a real failure alongside a dismissable one) -> verdict 1 (abort)" \
  || bad "mixed case: rc=$rc, expected 1"

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-cut-rerun-guard: ALL PASS"
  exit 0
else
  echo "test-cut-rerun-guard: $fails FAILED"
  exit 1
fi
