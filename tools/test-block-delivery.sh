#!/bin/bash
# check-block-delivery.js, arm by arm, against a fixture fleet.
#
# 🛑 THE ARM THAT MATTERS is the one separating UNDELIVERED from CORRECTLY
# ABSENT. Counting absences alone reported FIVE undelivered blocks on this
# machine when the true number was two, and that wrong count would have argued
# for rewriting seventeen agents' boot instructions (#1071).
#
# The fleet is driven through KOSMOS_WORKERS_DIR. The content side is read from
# the real engine modules and is NOT stubbed, so these arms use `colleagues`,
# which produces an unconditional body -- its absence can only ever mean
# undelivered, which is exactly what makes it a usable probe.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
run() { KOSMOS_WORKERS_DIR="$1" node tools/check-block-delivery.js 2>&1; }

# --- a fleet that has the colleagues block -----------------------------------
mkdir -p "$T/full/a" "$T/full/b"
for d in a b; do printf '# agent\n<!-- kosmos:colleagues:start -->\nx\n<!-- kosmos:colleagues:end -->\n' > "$T/full/$d/CLAUDE.md"; done
out="$(run "$T/full")"
case "$out" in
  *"colleagues"*"delivered to all entitled"*) ok "a block present on every agent reads as delivered" ;;
  *) bad "delivered case misread: $(printf '%s' "$out" | grep colleagues)" ;;
esac

# --- the same fleet WITHOUT it -----------------------------------------------
mkdir -p "$T/none/a" "$T/none/b"
for d in a b; do printf '# agent\nnothing here\n' > "$T/none/$d/CLAUDE.md"; done
out="$(run "$T/none")"
case "$out" in
  *"colleagues"*"UNDELIVERED to 2"*) ok "an unconditional block absent everywhere reads as UNDELIVERED, with a count" ;;
  *) bad "undelivered case misread: $(printf '%s' "$out" | grep colleagues)" ;;
esac

# --- partial -----------------------------------------------------------------
mkdir -p "$T/part/a" "$T/part/b"
printf '# agent\n<!-- kosmos:colleagues:start -->\nx\n<!-- kosmos:colleagues:end -->\n' > "$T/part/a/CLAUDE.md"
printf '# agent\nnothing\n' > "$T/part/b/CLAUDE.md"
out="$(run "$T/part")"
case "$out" in
  *"colleagues"*"UNDELIVERED to 1"*) ok "a partial rollout names how many are missing, not just that some are" ;;
  *) bad "partial case misread: $(printf '%s' "$out" | grep colleagues)" ;;
esac

# 🔑 THE DISTINCTION THIS TOOL EXISTS FOR. `you` has no record on this machine,
# so its absence must NOT be reported as undelivered. If this arm ever fails,
# the tool has started counting absences again.
out="$(run "$T/none")"
case "$out" in
  *"you"*"correctly absent"*) ok "a block with NOTHING TO DELIVER is not reported as undelivered" ;;
  *) bad "the two-causes distinction is gone -- an empty block read as a failure: $(printf '%s' "$out" | grep ' you ')" ;;
esac

# 🔑 ENTITLEMENT, WHICH IS A THIRD CAUSE OF A ZERO AND THE ONE I MISSED FIRST.
# `projects` is a MEMBERSHIP block. These fixture agents are in no project, so
# their absence is CORRECT, not undelivered. Counting my way to "three
# undelivered" on this machine came from treating fifteen correct absences as
# failures.
# ⚠️ ADDED AFTER A CONTROL FOUND ITS ABSENCE: deleting the entitlement logic
# left this file fully green, so the suite claimed to cover a distinction it
# never tested. Same defect as asserting the fix instead of the property.
# ⚠️ SCOPED TO THE ONE LINE. The first version of this arm globbed the WHOLE
# output for "projects" and "UNDELIVERED" and matched them on DIFFERENT LINES
# -- a false failure on a correct tool. A multi-line glob is not a row test.
row="$(run "$T/none" | grep -E '^  projects ')"
case "$row" in
  *UNDELIVERED*) bad "a MEMBERSHIP block absent from non-members reads as undelivered; entitlement is not being applied ($row)" ;;
  "") bad "no projects row in the output at all; the table shape changed" ;;
  *) ok "a membership block is not 'undelivered' to agents who are not members" ;;
esac

# --- STALE: present where it is not entitled ---------------------------------
mkdir -p "$T/stale/a"
printf '# agent\n<!-- kosmos:you:start -->\nx\n<!-- kosmos:you:end -->\n' > "$T/stale/a/CLAUDE.md"
out="$(run "$T/stale")"
case "$out" in
  *"you"*"STALE on a"*) ok "a block present with nothing to deliver is named STALE, and by agent" ;;
  *) bad "stale case misread: $(printf '%s' "$out" | grep ' you ')" ;;
esac

# --- the population floor ----------------------------------------------------
mkdir -p "$T/empty"
KOSMOS_WORKERS_DIR="$T/empty" node tools/check-block-delivery.js >/dev/null 2>&1
[ $? -eq 2 ] && ok "an empty fleet REFUSES (exit 2) instead of reporting everything delivered" \
             || bad "an empty fleet did not refuse; every verdict would be vacuous"

KOSMOS_WORKERS_DIR="$T/does-not-exist" node tools/check-block-delivery.js >/dev/null 2>&1
[ $? -eq 2 ] && ok "an unreadable fleet dir refuses (exit 2), never 'all delivered'" \
             || bad "an unreadable dir did not refuse"

echo "block-delivery: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
