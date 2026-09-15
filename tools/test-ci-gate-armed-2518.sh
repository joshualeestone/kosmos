#!/usr/bin/env bash
# kosmos#2518: the PR-time browser-check DIFF gates must stay ARMED in CI.
#
# 🛑 WHAT THIS IS AND WHY. #2518 built a precise, no-browser surface->check gate
# (tools/lib/browser-check-surface-gate.sh, kosmos_browser_check_surface_gate) and
# its coarser sibling #1720 (tools/lib/browser-check-gate.sh, kosmos_browser_check_gate).
# Both run inside tools/run-tests.sh, which .github/workflows/test.yml runs on every PR.
# Together they refuse a web/index.html change that stales a browser-check BEFORE it
# merges -- the cut-time-only gap that cost 4 cut attempts on 0.6.49.
#
# ⚠️ BUT BOTH GATES ARE DIFF GATES: they compute `git diff origin/main...HEAD`. They
# are FAIL-SOFT by design -- if they cannot resolve that range they return 0 (a gate
# that reds a checkout it cannot read is worse than the gap). That fail-soft is safe
# LOCALLY, where an agent's clone has origin/main. It is a TRAP in CI: if the checkout
# does not create refs/remotes/origin/main, the range is unresolvable, BOTH gates
# fail-soft, and CI goes green having gated NOTHING -- the deepest form of the #2518
# gap, invisible because the guard reads as coverage (a-test-nothing-runs-is-an-
# unarmed-guard; can-they-see-it-at-the-moment-they-act).
#
# 🔑 THE LOAD-BEARING FACT, MEASURED. actions/checkout@v4 with `fetch-depth: 0` fetches
# with the all-heads refspec `+refs/heads/*:refs/remotes/origin/*`, so origin/main IS
# created; with the default depth it fetches only the single triggering branch and
# origin/main is ABSENT. Confirmed in a real run (test.yml run 35013011226,
# members-avatar-circle-3110): the checkout log shows `main -> origin/main` and the
# surface gate executed against the branch diff. So `fetch-depth: 0` is the one line
# keeping the gates non-vacuous in CI -- and test.yml's own comment attributes that
# line ONLY to #1025's range resolution, so a future #1025 refactor could "safely"
# drop it and silently disarm both gates with all-green CI. Nothing guarded that. This
# does (a-fix-to-the-update-path-cannot-arrive-through-it).
#
# EXECUTED, NOT MERELY MENTIONED. Static checks only (no run, no network); it runs in
# test:shell on EVERY PR, so a PR that disarms the gate is caught even when it does not
# itself touch the rendered surface. Part B PERTURBS temp copies of the two files to
# prove each assertion actually reds when the invariant is broken -- so this guard
# cannot itself pass vacuously.
#
#   bash tools/test-ci-gate-armed-2518.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WF="$REPO/.github/workflows/test.yml"
RUNTESTS="$REPO/tools/run-tests.sh"
COARSE_LIB="$REPO/tools/lib/browser-check-gate.sh"
SURFACE_LIB="$REPO/tools/lib/browser-check-surface-gate.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

# The load-bearing invariants, as anchored patterns so a PROSE mention in a comment
# cannot false-pass (the comment-false-pass class the sibling #2445 guard documents):
#  - the checkout's fetch-depth is exactly 0 (a bare `key: 0` line, not "fetch-depth 0"
#    in prose, which has no colon and carries surrounding words)
#  - the workflow RUNS run-tests.sh (the harness that invokes the gates)
#  - run-tests.sh SOURCES-AND-CALLS each gate (the `&& <fn> )` invocation shape; prose
#    never contains `&& kosmos_...`)
FETCH_DEPTH_RE='^[[:space:]]*fetch-depth:[[:space:]]*0[[:space:]]*$'
# The run-tests.sh invocation, matched on ANY line (not anchored to `run:`), so both
# `run: bash tools/run-tests.sh` and a multiline `run: |` block that calls it on its own
# line satisfy it. Comment mentions are excluded separately (grep -vE '^#') at the use
# site, so a `#`-prose reference to run-tests.sh cannot false-pass.
RUNTESTS_CALL_RE='bash[[:space:]]+tools/run-tests\.sh'
COARSE_CALL_RE='&&[[:space:]]*kosmos_browser_check_gate[[:space:]]*\)'
SURFACE_CALL_RE='&&[[:space:]]*kosmos_browser_check_surface_gate[[:space:]]*\)'

# ---------------------------------------------------------------------------
# Part A -- the real files hold every invariant.
# ---------------------------------------------------------------------------

[ -f "$WF" ] || fail ".github/workflows/test.yml is missing -- the CI that runs the gates is gone"
pass "test.yml exists"

# It is PARSEABLE YAML. A broken-indentation edit is a DIFFERENT disarming than a
# string drop (it reds only at GitHub's parser on the PR run); catch it statically.
# ruby ships on the dev Macs + the macos-latest runner test:shell runs on.
if command -v ruby >/dev/null 2>&1; then
  ruby -ryaml -e "YAML.load_file(ARGV[0])" "$WF" >/dev/null 2>&1 \
    || fail "test.yml is not parseable YAML (a broken-indentation edit would disarm CI silently)"
  pass "test.yml parses as YAML"
fi

# CONTROL: the grep instrument discriminates, so a clean run below means the assertions
# found populated lines rather than an empty/unreadable file.
grep -qE '^name:[[:space:]]*test[[:space:]]*$' "$WF" || fail "test.yml is not named test (or is empty; the grep instrument is dead)"
grep -q 'this-string-must-never-appear-in-test-yml-xyzzy' "$WF" && fail "CONTROL: an absent string was found; the grep matches too much"
pass "the grep instrument discriminates (present hits, absent misses)"

# 1. The checkout does a FULL fetch (fetch-depth: 0), so origin/main resolves and the
#    diff gates are non-vacuous in CI. This is THE line keeping the gates armed.
grep -qE "$FETCH_DEPTH_RE" "$WF" \
  || fail "test.yml checkout does not set 'fetch-depth: 0' -- origin/main would be ABSENT in CI, so BOTH browser-check diff gates (#1720 + #2518) fail-soft to a vacuous pass and gate nothing. Do not drop this line even if #1025's range resolution no longer needs it."
pass "test.yml checks out with fetch-depth: 0 (origin/main resolves -> the diff gates are armed)"

# 2. The workflow actually RUNS run-tests.sh (the harness the gates live inside). Match on a
#    NON-comment line, so both `run: bash tools/run-tests.sh` and a multiline `run: |` block
#    satisfy it, while a `#`-prose mention of run-tests.sh does not (the comment-false-pass
#    class). pipefail makes an empty first grep fail the pipeline -> the fail branch.
if grep -E "$RUNTESTS_CALL_RE" "$WF" | grep -qvE '^[[:space:]]*#'; then
  pass "test.yml runs tools/run-tests.sh on a non-comment line (the harness that invokes the gates)"
else
  fail "test.yml does not run 'bash tools/run-tests.sh' on a non-comment line -- the gates would never execute in CI"
fi

# 3. run-tests.sh SOURCES-AND-CALLS both gates. Removing either call stops that gate
#    running in CI while CI stays green -- the un-arming this guard exists to catch.
[ -f "$RUNTESTS" ] || fail "tools/run-tests.sh is missing"
grep -qE "$COARSE_CALL_RE" "$RUNTESTS" \
  || fail "run-tests.sh does not invoke kosmos_browser_check_gate (#1720 coarse gate) -- a web change with no check update would no longer be refused at PR time"
pass "run-tests.sh invokes the #1720 coarse gate (kosmos_browser_check_gate)"
grep -qE "$SURFACE_CALL_RE" "$RUNTESTS" \
  || fail "run-tests.sh does not invoke kosmos_browser_check_surface_gate (#2518 surface gate) -- a web change staling a SPECIFIC mapped check would no longer be refused at PR time"
pass "run-tests.sh invokes the #2518 surface gate (kosmos_browser_check_surface_gate)"

# 4. Sanity: the gate libs the calls source actually exist and parse, so a green CI is
#    not sourcing a missing/broken script (which would fail-soft or error, not gate).
for lib in "$COARSE_LIB" "$SURFACE_LIB"; do
  [ -f "$lib" ] || fail "gate lib is missing: ${lib#$REPO/} -- run-tests.sh would source nothing"
  bash -n "$lib" || fail "gate lib does not parse: ${lib#$REPO/}"
done
pass "both gate libs exist and parse (the sourced-and-called scripts are real)"

# ---------------------------------------------------------------------------
# Part B -- RED-CAPABILITY. Perturb temp copies of the real files and prove each
# key assertion FLIPS to a miss when the invariant is broken. Without this, a
# pattern that silently never matches (a typo, a dialect slip) would let Part A
# pass for the wrong reason (negative-control-before-destructive-check).
# ---------------------------------------------------------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 4a. Drop fetch-depth: 0 from a copy of test.yml -> assertion 1 must now MISS.
sed -E "/${FETCH_DEPTH_RE#^}/d" "$WF" > "$tmp/test.yml"
if grep -qE "$FETCH_DEPTH_RE" "$tmp/test.yml"; then
  fail "RED-CAPABILITY: fetch-depth check still matched after the line was removed -- the assertion cannot see its own disarming"
fi
pass "RED-CAPABILITY: removing fetch-depth: 0 reds the fetch-depth assertion"

# 4b. Set fetch-depth to 1 -> assertion 1 must still MISS (only 0 is armed).
sed -E "s/${FETCH_DEPTH_RE#^}/          fetch-depth: 1/" "$WF" > "$tmp/test-d1.yml"
if grep -qE "$FETCH_DEPTH_RE" "$tmp/test-d1.yml"; then
  fail "RED-CAPABILITY: fetch-depth check matched 'fetch-depth: 1' -- a shallow clone would disarm the gates and pass"
fi
pass "RED-CAPABILITY: fetch-depth: 1 (shallow) reds the fetch-depth assertion"

# 4c. Remove the run-tests.sh invocation from a copy of test.yml -> assertion 2 must MISS
#     (grep -vE drops every line carrying the invocation, comment or not, so the non-comment
#     match the assertion needs is gone).
grep -vE "$RUNTESTS_CALL_RE" "$WF" > "$tmp/test-no-runtests.yml"
if grep -E "$RUNTESTS_CALL_RE" "$tmp/test-no-runtests.yml" | grep -qvE '^[[:space:]]*#'; then
  fail "RED-CAPABILITY: run-tests invocation still matched after removal -- the assertion cannot see the harness call being dropped"
fi
pass "RED-CAPABILITY: removing the run-tests.sh invocation reds the harness-call assertion"

# 4d. Remove each gate call from a copy of run-tests.sh -> its assertion must MISS.
grep -vE "$SURFACE_CALL_RE" "$RUNTESTS" > "$tmp/run-tests-no-surface.sh"
if grep -qE "$SURFACE_CALL_RE" "$tmp/run-tests-no-surface.sh"; then
  fail "RED-CAPABILITY: surface-gate call still matched after removal -- the assertion cannot see the surface gate being dropped"
fi
pass "RED-CAPABILITY: dropping the surface-gate call reds the surface assertion"

grep -vE "$COARSE_CALL_RE" "$RUNTESTS" > "$tmp/run-tests-no-coarse.sh"
if grep -qE "$COARSE_CALL_RE" "$tmp/run-tests-no-coarse.sh"; then
  fail "RED-CAPABILITY: coarse-gate call still matched after removal -- the assertion cannot see the coarse gate being dropped"
fi
pass "RED-CAPABILITY: dropping the coarse-gate call reds the coarse assertion"

echo "ci-gate-armed (#2518): all arms passed -- the PR-time browser-check gates are armed in CI and guarded against silent disarming"
