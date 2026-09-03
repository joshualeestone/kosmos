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

# --- kosmos_failing_test_files: extraction ---
log_pass="$WORK/log-pass"
{
  echo "failing tests:"
  echo ""
  echo "test at pass.test.js:2:1"
  echo "  passes alone (5ms)"
  echo "      at TestContext.<anonymous> (/abs/pass.test.js:2:1)"
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
[ "$rc" -eq 0 ] && ok "a file that passes alone -> verdict 0 (contention dismissed, cut proceeds)" \
  || bad "contention case: rc=$rc, expected 0"
printf '%s\n' "$out" | grep -q "Dismissed" && ok "narration says the file was dismissed (re-ran and why)" \
  || bad "narration missing 'Dismissed'"
printf '%s\n' "$out" | grep -q "The cut proceeds" && ok "narration says the cut proceeds" \
  || bad "narration missing the proceed line"

# --- CONTROL (dangerous answer): a file that stays red alone must NOT be dismissed -> verdict 1 ---
log_fail="$WORK/log-fail"
{ echo "failing tests:"; echo "test at fail.test.js:2:1"; echo "  fails alone (5ms)"; } > "$log_fail"
if out="$(kosmos_isolation_rerun_verdict "$log_fail" "$WORK" 2)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a file red in isolation across all attempts -> verdict 1 (abort), NOT dismissed" \
  || bad "real-red case: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "real failure" && ok "narration names it a real failure" \
  || bad "narration missing 'real failure'"

# --- SAFE FALLBACK: a red naming no node file cannot be isolated -> verdict 1 ---
if out="$(kosmos_isolation_rerun_verdict "$log_none" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a failure that names no node file -> verdict 1 (not auto-dismissed)" \
  || bad "no-file case: rc=$rc, expected 1"

# --- SAFE FALLBACK: a named-but-missing file cannot be isolated -> verdict 1 ---
log_missing="$WORK/log-missing"
{ echo "test at ghost.test.js:1:1"; echo "  ghost"; } > "$log_missing"
if out="$(kosmos_isolation_rerun_verdict "$log_missing" "$WORK" 1)"; then rc=0; else rc=$?; fi
[ "$rc" -eq 1 ] && ok "a named-but-missing file -> verdict 1 (cannot isolate, abort)" \
  || bad "missing-file case: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "NOT FOUND" && ok "narration says NOT FOUND" \
  || bad "narration missing 'NOT FOUND'"

# --- MIXED: one dismissable + one real -> verdict 1 (a real failure among contention still aborts) ---
log_mixed="$WORK/log-mixed"
{ echo "test at pass.test.js:2:1"; echo "  passes alone"; echo "test at fail.test.js:2:1"; echo "  fails alone"; } > "$log_mixed"
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
