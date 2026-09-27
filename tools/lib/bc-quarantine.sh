#!/usr/bin/env bash
# A quarantined browser check is reported as QUARANTINED, never as a pass, and a
# run with one is refused unless the operator overrides it (#4160).
#
# 🛑 WHY. regress-a-night printed "PASS ... QUARANTINED for this cut" and exited 0
# before its browser started, for twelve days (#1079). run_one saw exit 0 and logged
# PASS, so every cut's step 3b was green while the heaviest page check checked
# nothing. A check can only tell the harness it did not run by what it prints, so
# the harness has to read that.
#
# Sourced by tools/browser-checks.sh, which owns the arrays these touch:
#   QUARANTINED  labels of checks that said QUARANTINED
#   FAILED       labels that fail the run
#   REASONS      "label:\n  why" lines printed under FAILED
# and the log function. Kept here so tools/test-bc-quarantine.sh can run them
# without booting a board or a browser.

## bc_quarantine_note <label> <captured-output-file>
## After a check exited 0: returns 0 and records it when its output says
## QUARANTINED (any case, whole word), so the caller prints nothing more; returns 1
## when it did not, so the caller logs its PASS.
bc_quarantine_note() {
  local label="$1" cap="$2"
  grep -qiwE 'quarantined' "$cap" 2>/dev/null || return 1
  QUARANTINED+=("$label")
  log "QUARANTINED  $label (exited 0 but says it did not run its assertions; this is not a pass)"
  return 0
}

## bc_quarantine_verdict
## At the summary: a quarantined check fails the run, unless
## KOSMOS_BC_ALLOW_QUARANTINE=1, in which case the override is printed with the
## names it let through. Exactly "1": any other value is not an override.
bc_quarantine_verdict() {
  [ "${#QUARANTINED[@]}" -gt 0 ] || return 0
  log "quarantined (did NOT run): ${QUARANTINED[*]}"
  if [ "${KOSMOS_BC_ALLOW_QUARANTINE:-}" = 1 ]; then
    log "‼️  QUARANTINE OVERRIDE (KOSMOS_BC_ALLOW_QUARANTINE=1): this run is green WITHOUT: ${QUARANTINED[*]}"
    return 0
  fi
  local q
  for q in "${QUARANTINED[@]}"; do
    FAILED+=("$q (QUARANTINED: exited 0 without running its assertions)")
    REASONS+=("$q:"$'\n'"           it says QUARANTINED, so it checked nothing. Fix it, or set KOSMOS_BC_ALLOW_QUARANTINE=1 to go on without it (printed in the log).")
  done
}
