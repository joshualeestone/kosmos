#!/bin/bash
# kosmos#7363: release.sh step 3 runs its suite with EVERY KOSMOS_CUT_* removed. Twice a cut's own override reached the
# suite (KOSMOS_CUT_CHANNEL at 0.7.25, KOSMOS_CUT_LINUX at 0.7.71) and tests that run a nested release.sh obeyed it.
# The helper, cut_suite_env, is lifted from release.sh and RUN here (under /bin/bash, which is 3.2 on macOS, with set -u);
# the step-3 call sites are pinned structurally, since step 3 cannot run without a real cut.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
RS="$HERE/release.sh"
fail=0
pass() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
T="$(mktemp -d "${TMPDIR:-/tmp}/test-cut-suite-env-7363.XXXXXX")"
trap 'rm -rf "$T"' EXIT

# The function as release.sh defines it: from its first line to the first line that is just "}".
awk '/^cut_suite_env\(\) \{$/{f=1} f{print} f&&/^\}$/{exit}' "$RS" > "$T/fn.sh"
awk '/^cut_suite_unset\(\) \{$/{f=1} f{print} f&&/^\}$/{exit}' "$RS" >> "$T/fn.sh"
grep -q '^cut_suite_env() {$' "$T/fn.sh" && grep -q '^}$' "$T/fn.sh" && pass "cut_suite_env is defined in release.sh" || { bad "cut_suite_env is not in release.sh"; exit 1; }

cat > "$T/run.sh" <<EOF
set -u
. "$T/fn.sh"
cut_suite_env env
EOF
# Every KOSMOS_CUT_* the caller exports is gone, a sentinel the code has never heard of included; other KOSMOS_* stay.
out="$(env KOSMOS_CUT_SENTINEL_7363=leak KOSMOS_CUT_NO_WHATS_NEW=1 KOSMOS_CUT_LINUX=1 KOSMOS_KEEP_7363=kept /bin/bash "$T/run.sh" 2>&1)"; rc=$?
{ [ "$rc" = 0 ] && ! printf '%s\n' "$out" | grep -q '^KOSMOS_CUT_'; } \
  && pass "no KOSMOS_CUT_* reaches the suite, a sentinel included" || bad "KOSMOS_CUT_* reached it (rc=$rc): $(printf '%s\n' "$out" | grep '^KOSMOS_CUT_' | head -3)"
printf '%s\n' "$out" | grep -qx 'KOSMOS_KEEP_7363=kept' && pass "CONTROL: a KOSMOS_* without the prefix still arrives" || bad "the control variable was removed too"
# With none exported, the empty list must not trip set -u on bash 3.2 (the `${a[@]+...}` form).
cat > "$T/run-none.sh" <<EOF
set -u
for v in \$(compgen -e); do case "\$v" in KOSMOS_CUT_*) unset "\$v" ;; esac; done
. "$T/fn.sh"
cut_suite_env true && echo ran
EOF
out="$(/bin/bash "$T/run-none.sh" 2>&1)"; rc=$?
{ [ "$rc" = 0 ] && [ "$out" = ran ]; } && pass "with no KOSMOS_CUT_* exported it still runs (bash $(/bin/bash -c 'echo $BASH_VERSION'), set -u)" || bad "no-override run failed (rc=$rc): $out"

# Step 3's suite calls, every non-comment line that runs `yarn test` into the suite log, go through cut_suite_env.
calls="$(grep -nE 'yarn test >"\$_suite_log"' "$RS" | grep -vE '^[0-9]+:[[:space:]]*#')"
n="$(printf '%s\n' "$calls" | grep -c . )"
wrapped="$(printf '%s\n' "$calls" | grep -cE 'cut_suite_env (nice -n 19 )?yarn test >"\$_suite_log"')"   # the wrap's shape, not just the word
{ [ "$n" = 2 ] && [ "$wrapped" = 2 ]; } && pass "both step-3 suite runs (serial, and the parallel 3+3b one) go through cut_suite_env" \
  || bad "step-3 suite runs: $n found, $wrapped wrapped: $calls"
# The isolation rerun (#2006), which decides whether a red suite stops the cut, runs in a subshell that unsets them first.
rr="$(grep -nE 'kosmos_isolation_rerun_verdict "\$_suite_log"' "$RS" | grep -vE '^[0-9]+:[[:space:]]*#')"
{ [ "$(printf '%s\n' "$rr" | grep -c .)" = 1 ] && printf '%s\n' "$rr" | grep -qE '\$\(cut_suite_unset; kosmos_isolation_rerun_verdict '; } \
  && pass "step 3's isolation rerun unsets every KOSMOS_CUT_* in its own subshell first" || bad "the isolation rerun is not stripped: $rr"
cat > "$T/run-unset.sh" <<EOF
set -u
. "$T/fn.sh"
out="\$(cut_suite_unset; env)"
printf '%s\n' "\$out" | grep -q '^KOSMOS_CUT_' && echo leaked || echo clean
env | grep -q '^KOSMOS_CUT_SENTINEL_7363=' && echo kept || echo lost
EOF
out="$(env KOSMOS_CUT_SENTINEL_7363=leak /bin/bash "$T/run-unset.sh" 2>&1)"
[ "$out" = "$(printf 'clean\nkept')" ] && pass "cut_suite_unset clears them in its subshell and leaves the caller's shell as it was" || bad "cut_suite_unset: $out"
# ...and the helper is defined before the first of them.
def="$(grep -n '^cut_suite_env() {$' "$RS" | cut -d: -f1)"; first="$(printf '%s\n' "$calls" | head -1 | cut -d: -f1)"
[ -n "$def" ] && [ -n "$first" ] && [ "$def" -lt "$first" ] && pass "defined before the first call" || bad "cut_suite_env defined at line ${def:-?}, first call at ${first:-?}"

if [ "$fail" = 0 ]; then echo "test-cut-suite-env-7363: ALL PASS"; else echo "test-cut-suite-env-7363: FAILURES above"; exit 1; fi
