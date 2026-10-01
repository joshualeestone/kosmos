#!/bin/bash
# #2858: the node test runner (tools/run-tests.sh) must strip the ambient Codex
# home BEFORE it runs the suite, so the suite is isolated from whoever invoked it.
# A Codex/gpt agent's session carries a live CODEX_HOME (e.g. a real ~/.codex-work2);
# invoking the suite from there makes the tests that read it assert against real
# agent state and RED with false failures. The card's argument is that a PER-TEST
# fix does not hold -- the same boundary re-opened after #1412 fixed it per-test in
# the OUTWARD direction -- so the strip lives once at the runner. This guard reds if
# that runner-level strip is ever removed or moved after `node --test`, which is
# exactly the regression the card exists to prevent.
#
# Convergence note: the runner strip + this guard were independently arrived at by
# PigeonPete and Ice Cream Kitty; the guard body is PigeonPete's, wired into
# test:shell here so it actually runs (an unwired guard catches nothing).
#
# This is a SOURCE-INVARIANT guard (it asserts the strip is present and precedes the
# suite), plus a behavioral leg that proves the `unset` mechanism actually clears
# BOTH names for a node child even when they are set on invocation. The source leg is
# what makes it a durable regression guard for run-tests.sh; the behavioral leg keeps
# it from passing on a mechanism that does not work.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RT="$HERE/run-tests.sh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=1; }

[ -f "$RT" ] || { echo "FAIL  run-tests.sh not found at $RT"; exit 1; }

# BOTH names must be stripped: the bare CODEX_HOME is the ambient leak this card is
# about; AGENT_WORKFORCE_CODEX_HOME is the sandbox seam #1412's fix routes through, and
# stripping only one leaves the other inherited path open.
grep -qE '^[[:space:]]*unset([[:space:]]|.*[[:space:]])CODEX_HOME([[:space:]]|$)' "$RT" \
  && pass "run-tests.sh unsets the ambient CODEX_HOME" \
  || fail "run-tests.sh no longer unsets CODEX_HOME (the #2858 boundary re-opened)"
grep -qE '^[[:space:]]*unset.*[[:space:]]AGENT_WORKFORCE_CODEX_HOME([[:space:]]|$)' "$RT" \
  && pass "run-tests.sh unsets AGENT_WORKFORCE_CODEX_HOME (the sandbox seam)" \
  || fail "run-tests.sh no longer unsets AGENT_WORKFORCE_CODEX_HOME"

# #4491 slice 7: the token-only switch is stripped at the same boundary, before the same node suite.
tln="$(grep -nE '^[[:space:]]*unset([[:space:]].*)?[[:space:]]KOSMOS_AGENT_TOKEN_ONLY([[:space:]]|$)' "$RT" | head -1 | cut -d: -f1)"
nln0="$(grep -nE 'node --test.*KOSMOS_TEST_FILES' "$RT" | head -1 | cut -d: -f1)"
if [ -n "$tln" ] && [ -n "$nln0" ] && [ "$tln" -lt "$nln0" ]; then
  pass "run-tests.sh unsets KOSMOS_AGENT_TOKEN_ONLY (line $tln) before the node suite (line $nln0)"
else
  fail "run-tests.sh no longer unsets KOSMOS_AGENT_TOKEN_ONLY before the node suite (unset=$tln node=$nln0)"
fi

# The strip must precede the node suite -- the FIRST test invocation, since
# `yarn -s test:shell` runs after it in run-tests.sh, so preceding the node suite
# guarantees preceding test:shell too. The node pattern is pinned to the real
# invocation (`node --test` with KOSMOS_TEST_FILES), NOT a bare `node --test`, so a
# comment that mentions `node --test` above the strip cannot red this falsely. (An
# earlier version also matched `yarn test:shell`, which matched this very file's
# run-tests.sh comment and false-failed -- pinning to the node invocation avoids it.)
uln="$(grep -nE '^[[:space:]]*unset.*CODEX_HOME' "$RT" | head -1 | cut -d: -f1)"
nln="$(grep -nE 'node --test.*KOSMOS_TEST_FILES' "$RT" | head -1 | cut -d: -f1)"
if [ -n "$uln" ] && [ -n "$nln" ] && [ "$uln" -lt "$nln" ]; then
  pass "the strip (line $uln) precedes the node suite (line $nln), which runs before test:shell"
else
  fail "the CODEX_HOME strip does not precede the node suite (unset=$uln node=$nln)"
fi

# Behavioral leg: with BOTH names set on invocation, the same `unset` the runner uses
# must leave a node child seeing them undefined. This proves the mechanism, so the
# source legs above are not passing over an `unset` that does not actually clear a
# child's environment.
probe="$(CODEX_HOME=/poison/codex AGENT_WORKFORCE_CODEX_HOME=/poison/awf bash -c \
  'unset CODEX_HOME AGENT_WORKFORCE_CODEX_HOME; \
   node -pe "[process.env.CODEX_HOME, process.env.AGENT_WORKFORCE_CODEX_HOME].join(\",\")"' 2>&1)"
if [ "$probe" = "," ]; then
  pass "a node child sees both Codex-home vars stripped even when set on invocation"
else
  fail "the unset did not clear both vars for a node child (got: $probe)"
fi

# #4491 slice 7, the behavioural leg for the switch: it runs the TEXT of the runner's unset line (grepped out of
# run-tests.sh) and checks a node child no longer sees the switch, so a line that does not clear it is caught. It
# cannot see whether the runner ever REACHES that line (a line inside an `if false` would pass); the column-0 check
# below narrows that: the line must sit at the top level of the file, not indented inside a block.
uline="$(grep -E '^[[:space:]]*unset([[:space:]].*)?[[:space:]]KOSMOS_AGENT_TOKEN_ONLY([[:space:]]|$)' "$RT" | head -1)"
probe2="$(KOSMOS_AGENT_TOKEN_ONLY=1 bash -c "$uline"'
  node -pe "String(process.env.KOSMOS_AGENT_TOKEN_ONLY)"' 2>&1)"
if [ -n "$uline" ] && [ "${uline#unset }" = "$uline" ]; then
  fail "the KOSMOS_AGENT_TOKEN_ONLY unset is indented, so it may sit inside a block the runner never enters"
elif [ -n "$uline" ] && [ "$probe2" = "undefined" ]; then
  pass "the runner's own unset line clears KOSMOS_AGENT_TOKEN_ONLY for a node child"
else
  fail "the runner's unset line did not clear KOSMOS_AGENT_TOKEN_ONLY for a node child (line: $uline; got: $probe2)"
fi

[ "$fails" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILED"; exit 1; }
