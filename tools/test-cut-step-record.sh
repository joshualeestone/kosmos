#!/bin/bash
# The cut's completion line names WHICH STEP it died in (#1050 follow-up).
#
# ⭐ WHY: three cuts died on 2026-08-26 and `completed exit=1` named the fact
# and none of the cause, so each death began by guessing the phase from
# elapsed time. This shows the recorder red, green, and at the boundary.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# The real pair, lifted from release.sh rather than retyped, so this cannot
# drift from what ships.
SRC="$HERE/release.sh"
blk="$(awk '/^_STEP="before step 1"$/,/^}$/' "$SRC")"
case "$blk" in
  *"step()"*) : ;;
  *) echo "FAIL  the step/record block is gone from release.sh; this test now checks nothing"; exit 1 ;;
esac

run() {   # $1 = script body appended after the block, $2 = exit code to record
  # ⚠️ REMOVED AT THE END OF EACH CALL (#1151). This is a helper the file calls
  # repeatedly, so a leak here is one directory per invocation, not one per run.
  # A function-local trap would fire on the SCRIPT's exit, not the function's,
  # and would be replaced by the next call's, so the removal is explicit below.
  local T; T="$(mktemp -d)"; mkdir -p "$T/.claude/logs"
  HOME="$T" V=9.9.9 _CUT_DONE_WRITTEN=0 bash -c "
    _CUT_DONE_WRITTEN=0
    V=9.9.9
    $blk
    $1
    cut_record_done $2
  " >/dev/null 2>&1
  cat "$T/.claude/logs/cut-suite-runs.log" 2>/dev/null
  rm -rf "$T"
}

out="$(run 'true' 1)"
has "$out" 'step=before_step_1' && pass "a death before any step says so" || fail "no step on an early death: $out"

out="$(run 'step "== 4. build =="' 1)"
has "$out" 'step=' && has "$out" '4.' && pass "a death at step 4 names step 4" || fail "step 4 not recorded: $out"

out="$(run 'step "== 3. the whole suite =="; step "== 7. the versions page =="' 1)"
has "$out" '7.' && ! has "$out" '3.' \
  && pass "it names the LAST step reached, not the first" || fail "wrong step kept: $out"

# 🔑 THE FIELD MUST SURVIVE A LOG READER. Spaces would split the
# space-separated record into extra fields and shift everything after it.
out="$(run 'step "== 4b. a real install from the bundle =="' 1)"
case "$out" in
  *"step="*" "*) fail "the step field contains a space and breaks the record's columns: $out" ;;
  *) pass "the step field carries no spaces, so the record stays parseable" ;;
esac

# The control: a SUCCESS still records, or the field only exists on failures.
out="$(run 'step "== 9. done =="' 0)"
has "$out" 'exit=0' && has "$out" 'step=' && pass "a successful cut records its last step too" || fail "no step on success: $out"

echo "cut step record: $fails failures"
exit $((fails > 0))
