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
# #2259/#2648: the content side (you/policy/doctrine) is read from REAL engine state via
# engine/store.js's data root (AGENT_WORKFORCE_HOME || os.homedir()), NOT a stub, and the arms
# below assume that state is EMPTY (no you record, no policies, no doctrine). That held on a dev
# laptop but NOT on a live cut box (mortals), whose provisioned roster saves a real you.json --
# so the STALE arm read the fixture `you` block as "delivered to all entitled" instead of STALE,
# and every mortals release cut aborted at step 3. Sandbox the data root too (an empty $T/home has
# no .../Kosmos/you.json), so the content side is absent BY CONSTRUCTION on any box. The CONTROL
# arm at the end writes a real you record into a separate home and proves the STALE detection still
# discriminates -- a fix that greened against real you-state would let a genuinely-stale block ship.
# AGENT_WORKFORCE_DATA (the multi-Kosmos data-root switch) WINS OVER AGENT_WORKFORCE_HOME in
# engine/store.js's dataRootFor (it is the first branch), so a cut/dev shell that carries it (a
# world switch, direnv, an exported world) would make the HOME redirect inert and read the real
# you.json again -- the exact recurrence this fix exists to prevent. Unset it so the HOME branch is
# reached. (tools/test-data-root-1511.sh strips AGENT_WORKFORCE_DATA the same way; that harness
# sandboxes a different, shell-side data root, so only the unset idiom is shared, not the machinery.)
unset AGENT_WORKFORCE_DATA
export AGENT_WORKFORCE_HOME="$T/home"; mkdir -p "$AGENT_WORKFORCE_HOME"
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

# 🔑 CODEX AGENTS BOOT AGENTS.md, NOT CLAUDE.md (#2245/#2259). A CLAUDE.md-only
# reader silently OMITS them -- the exact population #2245 added -- and reports a
# false clean. This arm is the regression guard: a claude agent that HAS the block
# and a codex agent (AGENTS.md, no CLAUDE.md) that LACKS it. The fix must see BOTH,
# so colleagues reads UNDELIVERED to 1. The OLD code saw only the claude agent and
# read "delivered to all entitled" -- vacuously green while blind to the codex agent.
mkdir -p "$T/codex/claudey" "$T/codex/codexy"
printf '# agent\n<!-- kosmos:colleagues:start -->\nx\n<!-- kosmos:colleagues:end -->\n' > "$T/codex/claudey/CLAUDE.md"
printf '# agent\nnothing here\n' > "$T/codex/codexy/AGENTS.md"
out="$(run "$T/codex")"
case "$out" in
  *"(2 agents)"*) ok "a codex agent (AGENTS.md, no CLAUDE.md) is SEEN, not silently omitted" ;;
  *) bad "the codex agent was omitted; fleet count is not 2: $(printf '%s' "$out" | grep '^fleet:')" ;;
esac
# Per-row, not a whole-output glob (the convention this file fixed for `projects`).
row="$(printf '%s' "$out" | grep -E '^  colleagues ')"
case "$row" in
  *"UNDELIVERED to 1"*) ok "a block missing from a codex agent's AGENTS.md is caught, not false-cleaned" ;;
  *) bad "codex undelivered misread (old CLAUDE.md-only code would say delivered-to-all): $row" ;;
esac

# --- a codex agent that HAS the block reads as delivered (AGENTS.md is READ) --
mkdir -p "$T/codexfull/codexy"
printf '# agent\n<!-- kosmos:colleagues:start -->\nx\n<!-- kosmos:colleagues:end -->\n' > "$T/codexfull/codexy/AGENTS.md"
row="$(run "$T/codexfull" | grep -E '^  colleagues ')"
case "$row" in
  *"delivered to all entitled"*) ok "a block present in a codex agent's AGENTS.md reads as delivered (the file is actually read)" ;;
  *) bad "codex AGENTS.md content not read: $row" ;;
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

# --- CONTROL: the sandbox must not blanket-green the STALE arm (#2259/#2648) --------------
# Splinter's requirement: prove the STALE detection still DISCRIMINATES under the sandbox. With a
# REAL you record present, the SAME fixture `you` block must read DELIVERED, not STALE -- so the
# harness still tells a deliverable block from a stale one, and a genuinely-stale block cannot ship
# just because we sandboxed the content state. The setup guard fails LOUDLY if the record could not
# be saved, so a broken control can never masquerade as a passing (or vacuous) detection.
CTRL_HOME="$T/ctrl-home"; mkdir -p "$CTRL_HOME"
# Short-circuit on a setup failure: if the record cannot be saved the control is unusable, so
# emit ONE clear FAIL and skip the verdict check (which would otherwise ALSO fail -- STALE, since
# nothing was saved -- turning one root cause into two confusing FAIL lines).
if ! AGENT_WORKFORCE_HOME="$CTRL_HOME" node -e "require('./engine/you.js').save({name:'You',does:'a thing',know:'a fact'})"; then
  bad "CONTROL SETUP: could not save a you record into the sandbox (control unusable)"
else
  out_ctrl="$(AGENT_WORKFORCE_HOME="$CTRL_HOME" KOSMOS_WORKERS_DIR="$T/stale" node tools/check-block-delivery.js 2>&1)"
  # Extract the `you` row alone before matching (this file's row-test convention -- the projects
  # and codex arms grep '^  <block> ' first), so a stray STALE/delivered token from another row
  # could never flip the verdict if the fixture grows.
  you_ctrl="$(printf '%s' "$out_ctrl" | grep -E '^  you ')"
  case "$you_ctrl" in
    "") bad "CONTROL: no 'you' row in the output at all; the table shape changed" ;;
    *"STALE"*) bad "CONTROL: a you-block with a REAL you record present was still read STALE -- the STALE detection is vacuous under the sandbox" ;;
    *"delivered to all entitled"*) ok "CONTROL: with a real you record present the same block reads DELIVERED, not STALE -- the STALE detection discriminates" ;;
    *) bad "CONTROL: unexpected verdict for a present you record: $you_ctrl" ;;
  esac
fi

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
