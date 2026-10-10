#!/usr/bin/env bash
# #5727 follow-up 2: prove, IN CI, that tools/run-tests.sh really (a) EXPORTS a clamped
# KOSMOS_TEST_TIME_SCALE to the test processes it spawns (so test-support/eventually.js reads it)
# and (b) PRINTS the clamped scale where a reader of a red sees it. Sonya's review of #5738
# flagged that the runner wiring itself was unit-tested but never exercised end-to-end in CI.
#
# How: drive the REAL runner on a one-file --only run (#4929) against a tiny temp probe, with
# KOSMOS_FAKE_LOAD forced so the scale is deterministic (cut-load-guard.sh honors the seam, and
# test-time-scale.sh clamps to [1.00, 4.00]). A PASSING probe records the env it was handed, so
# we read the value the child actually saw; a FAILING probe reds the run so the #708 machine
# banner prints, and we grep it for the scale line.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

fails=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-scale-ci.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
PROBE_OUT="$TMP/seen-scale.txt"

# A passing probe: record the scale this child was handed, and assert it is clamped. Kept OUT of
# the repo tree (temp dir) so the ordinary suite glob never picks it up; --only takes its abs path.
cat > "$TMP/scale-pass.test.js" <<'PROBE'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
test('#5727: the runner handed this process a clamped KOSMOS_TEST_TIME_SCALE', () => {
  const v = process.env.KOSMOS_TEST_TIME_SCALE;
  fs.writeFileSync(process.env.PROBE_OUT, String(v));
  assert.match(String(v), /^[1-4]\.[0-9][0-9]$/, 'scale must be a clamped %.2f in [1.00, 4.00], got ' + v);
});
PROBE

# A failing probe: force a red so the runner prints its "when this run started" banner (#708),
# which carries the scale line.
cat > "$TMP/scale-red.test.js" <<'PROBE'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
test('#5727 fixture: a deliberate red so the runner prints its banner', () => {
  assert.equal(1, 2, 'deliberate');
});
PROBE

# Nest the runner for ONE file. Three things must be neutralized or this test false-passes:
#   - KOSMOS_TEST_PART / KOSMOS_SHELL_SHARD: the CI shell-shard job exports these
#     (.github/workflows/test.yml), and run-tests.sh refuses --only when either is set. Reset
#     them to the whole-run defaults, exactly as tools/test-cut-guard.sh does when it nests the
#     runner (KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD=).
#   - A FOREIGN machine claim or a live install harness: absent on a CI runner, overridden here so
#     a busy dev box is deterministic too.
#   - An INHERITED, already-exported KOSMOS_TEST_TIME_SCALE. In CI (and a local `yarn test`) this
#     test runs INSIDE the outer run-tests.sh, which has already EXPORTED this var. Bash keeps the
#     export attribute across a plain reassignment, so if the runner's own `export` (run-tests.sh
#     line ~302) were ever dropped, the inner reassignment would STILL reach the child via the
#     inherited attribute, and the regression this test exists to catch would pass green. So the
#     subshell `unset`s it first: then only the runner's own `export` makes the child see it, and a
#     dropped export yields `undefined` and reds the pass arm. (A `VAR=val ... bash` prefix cannot
#     unset, which is why this is a subshell, not more prefix assignments.)
# The --only path does no queue wait and no suite-live check, so once past the refusals it runs
# the one probe directly. reached_runner() below turns a remaining refusal into a loud failure.
run_only() { # load file
  local load="$1" file="$2"
  (
    unset KOSMOS_TEST_TIME_SCALE
    KOSMOS_FAKE_LOAD="$load" KOSMOS_IGNORE_MACHINE_CLAIM=1 KOSMOS_TESTS_IGNORE_HARNESS=1 \
      KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD= \
      PROBE_OUT="$PROBE_OUT" bash "$REPO/tools/run-tests.sh" --only "$file" 2>&1
  )
}
# The runner prints this line (to stderr, captured via 2>&1) only once it has ACCEPTED the --only
# run (run-tests.sh #4929). It is emitted in the --only ARGUMENT block, BEFORE the machine-claim /
# harness / light-side refusals, so on its own it proves only that the shard-var reset worked, not
# that the probe ran. It is necessary, not sufficient: the companion checks (rc==0 AND seen==4.00
# on the pass arms; rc==1 AND the banner on the red arm) are what catch a refusal that happens
# after this line. Do not lean on reached_runner alone in a future edit.
reached_runner() { printf '%s\n' "$1" | grep -qF -- "--only: 1 named file(s)"; }

# (a) EXPORT reaches the test process, and is clamped. Saturating load -> the 4x cap.
: > "$PROBE_OUT"
out="$(run_only 99999 "$TMP/scale-pass.test.js")"; rc=$?
seen="$(cat "$PROBE_OUT" 2>/dev/null)"
if reached_runner "$out"; then ok "saturating load: the --only run reached the runner (not refused)"; else bad "saturating load: --only was REFUSED (never ran), so the rest is meaningless; output:
$out"; fi
if [ "$rc" -eq 0 ]; then ok "saturating load: the --only probe run passed (export reached it, value clamped)"; else bad "saturating load: the probe run exited $rc, not 0; output:
$out"; fi
if [ "$seen" = "4.00" ]; then ok "saturating load: the child saw KOSMOS_TEST_TIME_SCALE=4.00 (exported + capped)"; else bad "saturating load: the child saw '$seen', want '4.00'"; fi

# A near-idle load floors at 1.00, byte-identical-budget path.
: > "$PROBE_OUT"
out="$(run_only 0.01 "$TMP/scale-pass.test.js")"; rc=$?
seen="$(cat "$PROBE_OUT" 2>/dev/null)"
if reached_runner "$out"; then ok "near-idle load: the --only run reached the runner (not refused)"; else bad "near-idle load: --only was REFUSED; output:
$out"; fi
if [ "$rc" -eq 0 ] && [ "$seen" = "1.00" ]; then ok "near-idle load: the child saw KOSMOS_TEST_TIME_SCALE=1.00 (floored)"; else bad "near-idle load: rc=$rc, child saw '$seen', want rc 0 and '1.00'"; fi

# (b) PRINTS the clamped scale on a red (the #708 banner, where a reader of a timing red needs it).
out="$(run_only 99999 "$TMP/scale-red.test.js")"; rc=$?
if reached_runner "$out"; then ok "red run: the --only run reached the runner (not refused)"; else bad "red run: --only was REFUSED, so the rc below is a refusal, not a test red; output:
$out"; fi
# Exactly 1: a real test failure exits 1 (NODE_STATUS), where a REFUSAL exits 2. Pinning to 1
# stops a refusal from satisfying this vacuously.
if [ "$rc" -eq 1 ]; then ok "red run: the deliberate-red probe made the run fail with exit 1 (a test red, not a refusal)"; else bad "red run: expected exit 1 from the failing probe, got $rc; output:
$out"; fi
if printf '%s\n' "$out" | grep -qF "wall-clock test time-scale 4.00x"; then
  ok "red run: the runner printed 'wall-clock test time-scale 4.00x' in its banner"
else
  bad "red run: the scale banner line was not printed on a red; output:
$out"
fi
# CONTROL: the banner line is the runner's, not something this test echoed.
if printf '%s\n' "$out" | grep -qF "the machine, when this run started"; then ok "CONTROL: the #708 banner really rendered (its header is present)"; else bad "CONTROL: the #708 banner header was absent, so the grep above may be matching the wrong thing; output:
$out"; fi

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-runner-scale-export-5727: ALL PASS"
  exit 0
else
  echo "test-runner-scale-export-5727: $fails FAILED"
  exit 1
fi
