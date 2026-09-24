#!/bin/bash
# kosmos#1398b: unit test for kosmos_bc_apply_accept_known (the KOSMOS_BC_ACCEPT_KNOWN
# filter browser-checks.sh's summary applies to FAILED). It drives the FUNCTION
# directly with synthetic FAILED arrays -- portable and deterministic, no browser and
# no board -- because a real failing check is env-specific and cannot be relied on in
# CI. The wiring into browser-checks.sh is a one-line call; this proves the behaviour.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/bc-accept-known.sh"

R="accepted for the #3542 headless env issue"   # a meaningful, one-line reason

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
LOGGED=""
log() { LOGGED="${LOGGED}$*"$'\n'; }                    # capture what the function logs
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
reset() { FAILED=(); ACCEPTED_KNOWN=(); LOGGED=""; unset KOSMOS_BC_ACCEPT_KNOWN KOSMOS_BC_ACCEPT_REASON 2>/dev/null || true; }

# accept a named failing check WITH a real reason -> leaves FAILED, recorded, logged
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$R"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 1 ] && has "$LOGGED" "ACCEPTED KNOWN-FAILING" && has "$LOGGED" "$R"
then pass "accept + real reason: named check leaves FAILED, is recorded, reason is logged"
else fail "accept + reason (FAILED='${FAILED[*]:-}' ACCEPTED='${ACCEPTED_KNOWN[*]:-}')"; fi

# no reason -> REFUSE
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -ge 1 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 0 ] && has "${FAILED[*]}" "needs a real"
then pass "no reason: refused -- a failure stays, nothing accepted"
else fail "no reason (FAILED='${FAILED[*]:-}')"; fi

# a TRIVIAL reason (a lone char, or whitespace) is refused -- the #1398b blocker fix
for _trivial in "x" "   " "   .  "; do
  reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$_trivial"
  kosmos_bc_apply_accept_known
  if [ "${#ACCEPTED_KNOWN[@]}" -eq 0 ] && has "${FAILED[*]}" "needs a real"
  then pass "trivial reason '$_trivial' is refused (not enough non-space content)"
  else fail "trivial reason '$_trivial' was NOT refused (FAILED='${FAILED[*]:-}')"; fi
done

# a MULTI-LINE reason is refused (a newline would let release.sh's grep -qF match on
# just one line, weakening the "the reason is in the served entry" guarantee)
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$(printf 'line one is long enough\nsecond line here')"
kosmos_bc_apply_accept_known
if [ "${#ACCEPTED_KNOWN[@]}" -eq 0 ] && has "${FAILED[*]}" "needs a real"
then pass "a multi-line reason is refused (single line required)"
else fail "multi-line reason not refused (FAILED='${FAILED[*]:-}')"; fi

# an INFRA / board-cascade failure is NOT acceptable even when named -- it keeps gating.
# Both marked infra shapes: "(server did not boot)" and the 126/127 "(could not run)".
for _infra in "render-thread (server did not boot)" "render-thread (could not run)"; do
  reset; FAILED=("$_infra"); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$R"
  kosmos_bc_apply_accept_known
  if [ "${#FAILED[@]}" -eq 1 ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 0 ]
  then pass "an infra failure ('$_infra') keeps gating, even when its name is accepted"
  else fail "infra not gated for '$_infra' (FAILED='${FAILED[*]:-}')"; fi
done

# an UN-named failing check still gates; only the named one is accepted
reset; FAILED=(render-thread render-firstrun-wizard-flow); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$R"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 1 ] && [ "${FAILED[0]}" = "render-firstrun-wizard-flow" ] && [ "${#ACCEPTED_KNOWN[@]}" -eq 1 ]
then pass "un-named check still gates -- only the named one is accepted"
else fail "un-named gates (FAILED='${FAILED[*]:-}')"; fi

# name-extraction is robust to a trailing suffix. (A genuine two-strikes red is a BARE
# label in production -- only infra entries carry a suffix, and those keep gating -- so
# this is a robustness arm, not a production shape: the filter must key on the name
# regardless of any suffix a future FAILED entry might carry.)
reset; FAILED=("render-thread (failed twice)"); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$R"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ]; then pass "name-extraction matches by name even with a trailing suffix"
else fail "suffix match (FAILED='${FAILED[*]:-}')"; fi

# a fully GREEN run with a named check emits a PRUNE note (stale accept list surfaced)
reset; FAILED=(); KOSMOS_BC_ACCEPT_KNOWN="render-thread"; KOSMOS_BC_ACCEPT_REASON="$R"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ] && has "$LOGGED" "did not fail this run"
then pass "a green run with a named check prints the prune note (does not silently no-op)"
else fail "green-run prune note (LOGGED empty=$([ -z "$LOGGED" ] && echo yes || echo no))"; fi

# a named-but-passing check among real failures -> prune note, does not gate
reset; FAILED=(render-thread); KOSMOS_BC_ACCEPT_KNOWN="render-thread,render-recovered"; KOSMOS_BC_ACCEPT_REASON="$R"
kosmos_bc_apply_accept_known
if [ "${#FAILED[@]}" -eq 0 ] && has "$LOGGED" "render-recovered"
then pass "a named-but-passing check prints a prune note and does not gate"
else fail "stale note (FAILED='${FAILED[*]:-}')"; fi

# comma AND space separators both parse; a name with a glob char stays literal
reset; FAILED=(render-thread render-fields); KOSMOS_BC_ACCEPT_KNOWN="render-thread,render-fields"; KOSMOS_BC_ACCEPT_REASON="$R"
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

# --- the RELEASE-side gate (kosmos_release_accept_known_gate) -- staging-only + the
# reason must reach the served entry. Driven directly with temp files, no cut. ---
GT="$(mktemp -d)"; trap 'rm -rf "$GT"' EXIT
printf '%s\n' "‼️  ACCEPTED KNOWN-FAILING page checks (KOSMOS_BC_ACCEPT_KNOWN): render-thread" > "$GT/log-accept"
printf 'PASS everything\nall page checks passed\n' > "$GT/log-clean"
printf '<p>shipped with a note: %s here</p>\n' "$R" > "$GT/entry-has"
printf '<p>shipped, no accept note here</p>\n' > "$GT/entry-missing"
export KOSMOS_BC_ACCEPT_KNOWN="render-thread"; export KOSMOS_BC_ACCEPT_REASON="$R"

# no accept happened (clean log) -> no-op, proceeds even on prod
if kosmos_release_accept_known_gate "$GT/log-clean" prod 0.6.91 "$GT/entry-has" "$GT/cutlog" >/dev/null 2>&1
then pass "release gate: no accept banner -> no-op proceeds (even on prod)"
else fail "release gate no-op did not proceed"; fi

# an accept on a NON-STAGING (prod) channel is refused
out="$(kosmos_release_accept_known_gate "$GT/log-accept" prod 0.6.91 "$GT/entry-has" "$GT/cutlog" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "STAGING-ONLY"
then pass "release gate: an accept on a prod cut is REFUSED (staging-only)"
else fail "release gate prod refuse (rc=$rc, out='$out')"; fi

# an accept on staging with the reason NOT in the entry is refused, and it must NOT
# have recorded an "accepted_known" line (the record follows the entry check now)
: > "$GT/cutlog"
out="$(kosmos_release_accept_known_gate "$GT/log-accept" staging 0.6.91 "$GT/entry-missing" "$GT/cutlog" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "not written in the versions entry" && ! has "$(cat "$GT/cutlog" 2>/dev/null)" "accepted_known"
then pass "release gate: reason absent from the entry is REFUSED and records nothing (no overstated cut-log line)"
else fail "release gate entry-missing (rc=$rc, cutlog='$(cat "$GT/cutlog" 2>/dev/null)')"; fi

# an accept on staging with the reason IN the entry proceeds and records to the cut log
: > "$GT/cutlog"
out="$(kosmos_release_accept_known_gate "$GT/log-accept" staging 0.6.91 "$GT/entry-has" "$GT/cutlog" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "(staging)" && has "$(cat "$GT/cutlog" 2>/dev/null)" "accepted_known"
then pass "release gate: staging + reason-in-entry PROCEEDS and records accepted_known to the cut log"
else fail "release gate happy path (rc=$rc, cutlog='$(cat "$GT/cutlog" 2>/dev/null)')"; fi
unset KOSMOS_BC_ACCEPT_KNOWN KOSMOS_BC_ACCEPT_REASON

if [ "$fails" -eq 0 ]; then echo "test-bc-accept-known-1398b: all arms passed"; else echo "test-bc-accept-known-1398b: $fails failed"; exit 1; fi
