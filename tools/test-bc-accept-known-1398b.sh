#!/bin/bash
# kosmos#1398b: unit test for kosmos_bc_apply_accept_known (the KOSMOS_BC_ACCEPT_KNOWN
# filter browser-checks.sh's summary applies to FAILED). It drives the FUNCTION
# directly with synthetic FAILED arrays -- portable and deterministic, no browser and
# no board -- because a real failing check is env-specific and cannot be relied on in
# CI. The wiring into browser-checks.sh is a one-line call; this proves the behaviour.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/bc-accept-known.sh"

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
LOGGED=""
log() { LOGGED="${LOGGED}$*"$'\n'; }                    # capture what the function logs
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
reset() { FAILED=(); ACCEPTED_KNOWN=(); LOGGED=""; unset KOSMOS_BC_ACCEPT_KNOWN KOSMOS_BC_ACCEPT_REASON 2>/dev/null || true; }

# accept a named failing check WITH a reason -> leaves FAILED, recorded, reason logged
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="known-flaky env, tracked #3542"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 1 ] && has "$LOGGED" "ACCEPTED KNOWN-FAILING" && has "$LOGGED" "known-flaky env, tracked #3542"
then pass "accept + reason: named check leaves FAILED, is recorded, reason is logged"
else fail "accept + reason (FAILED='${FAILED[*]:-}' ACCEPTED='${ACCEPTED_KNOWN[*]:-}')"; fi

# no reason -> REFUSE: a failure stays, nothing is accepted
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -ge 1 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 0 ] && has "${FAILED[*]}" "without KOSMOS_BC_ACCEPT_REASON"
then pass "no reason: refused -- a failure stays and nothing is accepted"
else fail "no reason (FAILED='${FAILED[*]:-}')"; fi

# an UN-named failing check still gates; only the named one is accepted
reset; FAILED=(render-thread render-firstrun-wizard-flow); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="x"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 1 ] && [ "${FAILED[0]}" = "render-firstrun-wizard-flow" ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 1 ]
then pass "un-named check still gates -- only the named one is accepted"
else fail "un-named gates (FAILED='${FAILED[*]:-}')"; fi

# a suffixed FAILED entry ("name (failed twice)") matches by NAME
reset; FAILED=("render-thread (failed twice)"); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="x"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ]
then pass "a suffixed FAILED entry matches by name, not the whole string"
else fail "suffix match (FAILED='${FAILED[*]:-}')"; fi

# a named check that did NOT fail -> a prune note, never a gate
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread,render-recovered"; KOSMOS_BC_ACCEPT_REASON="x"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ] && has "$LOGGED" "did not fail this run"
then pass "a named-but-passing check prints a prune note and does not gate"
else fail "stale note (FAILED='${FAILED[*]:-}')"; fi

# comma AND space separators both parse
reset; FAILED=(render-thread render-fields); KOSMOS_BC_ACCEPT_KNOWN="render-thread,render-fields"; KOSMOS_BC_ACCEPT_REASON="x"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 2 ]
then pass "a comma-separated accept list accepts every named check"
else fail "comma list (FAILED='${FAILED[*]:-}' ACCEPTED='${ACCEPTED_KNOWN[*]:-}')"; fi

# no accept var -> untouched (the common path)
reset; FAILED=(render-thread)
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 1 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 0 ]
then pass "no KOSMOS_BC_ACCEPT_KNOWN: FAILED is untouched"
else fail "no-op (FAILED='${FAILED[*]:-}')"; fi

if [ "$fails" -eq 0 ]; then echo "test-bc-accept-known-1398b: all arms passed"; else echo "test-bc-accept-known-1398b: $fails failed"; exit 1; fi
