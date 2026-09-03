#!/usr/bin/env bash
# kosmos#1962: the machine-reservation claim in tools/lib/cut-guard.sh.
#
# The load-bearing arm is THE CONTROL that returns the dangerous answer: with a
# live foreign claim held, kosmos_refuse_if_machine_claimed must actually REFUSE
# (today nothing refuses). The rest prove the safe directions: our own run is
# never refused, a dead/expired/malformed claim never refuses (fail-open), and
# the override works.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

# Isolate every marker/claim under a throwaway dir so the test never reads or
# writes the real ~/.cache/kosmos-run-markers.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-claim-test.XXXXXX")"
export KOSMOS_RUN_MARKER_DIR="$TMP/markers"
trap 'rm -rf "$TMP" 2>/dev/null' EXIT

. "$REPO/tools/lib/cut-guard.sh"

CLAIM_FILE="$KOSMOS_RUN_MARKER_DIR/machine-claim"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$1"; }

# Reset state between arms: drop any claim file and clear the self-cookie so each
# arm starts as a fresh, un-claiming caller.
reset() { rm -f "$CLAIM_FILE" 2>/dev/null; unset KOSMOS_MACHINE_CLAIM_COOKIE KOSMOS_IGNORE_MACHINE_CLAIM; mkdir -p "$KOSMOS_RUN_MARKER_DIR"; }

# Write a claim file directly (bypassing kosmos_claim_machine) so an arm can
# forge a foreign / dead / expired / malformed claim.
write_claim() { printf '%s %s %s %s %s\n' "$1" "$2" "$3" "$4" "$5" > "$CLAIM_FILE"; }
now() { date +%s; }

# ---- THE CONTROL: a live FOREIGN claim must REFUSE, naming holder + until -----
reset
# A real, alive, foreign holder: use THIS test's pid (alive) with a cookie that
# is NOT our self-cookie (we have none set), unexpired.
write_claim "foreign-cookie-abc" "$$" "$(( $(now) + 600 ))" "somehost" "release 9.9.9"
msg="$(kosmos_refuse_if_machine_claimed 'this test run' 2>&1)"; rc=$?
if [ "$rc" -ne 0 ]; then ok "a live foreign claim REFUSES (the #1962 control: today nothing refuses)"; else bad "a live foreign claim did NOT refuse -- the whole point of the card"; fi
case "$msg" in *"pid $$"*) ok "the refusal names the holder pid" ;; *) bad "refusal did not name the holder pid: $msg" ;; esac
case "$msg" in *until*) ok "the refusal names an 'until' time" ;; *) bad "refusal did not name an until time: $msg" ;; esac
case "$msg" in *"9.9.9"*) ok "the refusal names the release label" ;; *) bad "refusal did not name the label: $msg" ;; esac

# ---- Positive control: OUR OWN claim never refuses (self-exclusion) -----------
reset
kosmos_claim_machine 30   # sets + exports KOSMOS_MACHINE_CLAIM_COOKIE, writes the file
if kosmos_refuse_if_machine_claimed 'the holder itself' >/dev/null 2>&1; then ok "our own claim does NOT refuse us (a release's own gates run)"; else bad "our own claim refused the holder -- release.sh would refuse its own suite"; fi
# And the file is a single well-formed line.
lines="$(wc -l < "$CLAIM_FILE" | tr -d ' ')"
if [ "$lines" = "1" ] && [ "$(awk 'NF>=4{print "ok"}' "$CLAIM_FILE")" = "ok" ]; then ok "kosmos_claim_machine writes one well-formed line"; else bad "claim file is not one well-formed line ($lines lines)"; fi

# ---- Expiry: a past-expiry claim proceeds AND is self-cleaned ----------------
reset
write_claim "foreign-cookie-exp" "$$" "$(( $(now) - 5 ))" "somehost" "release old"
if kosmos_refuse_if_machine_claimed 'this test run' >/dev/null 2>&1; then ok "an EXPIRED claim does not refuse (fail-safe)"; else bad "an expired claim still refused -- a hung cut would park the fleet"; fi
[ ! -f "$CLAIM_FILE" ] && ok "an expired claim is self-cleaned" || bad "an expired claim was not cleaned up"

# ---- Dead holder: a dead-pid claim proceeds AND is self-cleaned --------------
reset
# A pid that is definitely dead: spawn a trivial child, reap it, reuse its pid.
sh -c 'exit 0' & deadpid=$!; wait "$deadpid" 2>/dev/null
write_claim "foreign-cookie-dead" "$deadpid" "$(( $(now) + 600 ))" "somehost" "release crashed"
if kosmos_refuse_if_machine_claimed 'this test run' >/dev/null 2>&1; then ok "a DEAD-holder claim does not refuse (a crashed cut cannot hold the box)"; else bad "a dead-holder claim still refused"; fi
[ ! -f "$CLAIM_FILE" ] && ok "a dead-holder claim is self-cleaned" || bad "a dead-holder claim was not cleaned up"

# ---- Fail-open: malformed / empty / missing claim proceeds -------------------
reset
printf 'garbage-not-a-claim\n' > "$CLAIM_FILE"
if kosmos_refuse_if_machine_claimed 'this test run' >/dev/null 2>&1; then ok "a MALFORMED claim does not refuse (FAIL-OPEN)"; else bad "a malformed claim refused -- a broken file would wedge the fleet"; fi
[ -f "$CLAIM_FILE" ] && ok "a malformed claim is left in place (a mid-write publisher will overwrite)" || bad "a malformed claim was deleted -- could race a concurrent writer"
reset
: > "$CLAIM_FILE"   # empty
kosmos_refuse_if_machine_claimed 'this test run' >/dev/null 2>&1 && ok "an EMPTY claim file does not refuse" || bad "an empty claim file refused"
reset   # no file at all
kosmos_refuse_if_machine_claimed 'this test run' >/dev/null 2>&1 && ok "no claim file at all does not refuse" || bad "a missing claim file refused"

# ---- Override: KOSMOS_IGNORE_MACHINE_CLAIM runs under a live foreign claim ----
reset
write_claim "foreign-cookie-ovr" "$$" "$(( $(now) + 600 ))" "somehost" "release 9.9.9"
KOSMOS_IGNORE_MACHINE_CLAIM=1 kosmos_refuse_if_machine_claimed 'this test run' >/dev/null 2>&1 && ok "KOSMOS_IGNORE_MACHINE_CLAIM=1 runs anyway" || bad "the override did not let the run through"

# ---- Release removes OUR claim, never a foreign one --------------------------
reset
kosmos_claim_machine 30
[ -f "$CLAIM_FILE" ] && ok "kosmos_claim_machine created the claim file" || bad "claim file was not created"
kosmos_release_machine
[ ! -f "$CLAIM_FILE" ] && ok "kosmos_release_machine removes OUR claim" || bad "release did not remove our claim"
# A foreign claim must survive our release (we hold a different cookie).
reset
export KOSMOS_MACHINE_CLAIM_COOKIE="mine-not-theirs"
write_claim "foreign-cookie-xyz" "$$" "$(( $(now) + 600 ))" "somehost" "release theirs"
kosmos_release_machine
[ -f "$CLAIM_FILE" ] && ok "kosmos_release_machine does NOT remove a foreign claim" || bad "release clobbered a foreign claim"

# ---- Status: names the holder for an active claim, all-clear otherwise --------
reset
write_claim "foreign-cookie-st" "$$" "$(( $(now) + 600 ))" "somehost" "release 1.2.3"
st="$(kosmos_machine_claim_status 2>&1)"
case "$st" in *"pid $$"*until*) ok "kosmos_machine_claim_status names holder + until for an active claim" ;; *) bad "status did not name holder/until: $st" ;; esac
reset
st="$(kosmos_machine_claim_status 2>&1)"
case "$st" in *"no release holds"*) ok "kosmos_machine_claim_status says the box is free when it is" ;; *) bad "status did not report a free box: $st" ;; esac

echo
if [ "$FAIL" -eq 0 ]; then echo "ALL PASS ($PASS arms)"; exit 0; else echo "$FAIL FAILED, $PASS passed"; exit 1; fi
