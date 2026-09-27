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
## After a check exited 0: returns 0 and records it when a PASS line in its output
## says QUARANTINED (both upper case as written, whole words, either order), so the caller prints nothing more; returns
## 1 when none does, so the caller logs its PASS. Only a PASS line with the capitalised
## token counts: the product has a "quarantined" moderation status, and a check asserting on
## it must not read as skipped. The same rule as browser-checks-quarantine-guard.test.js.
bc_quarantine_note() {
  local label="$1" cap="$2"
  # One output line with PASS and QUARANTINED, upper case as written, whole words, either order:
  # the rule browser-checks-quarantine-guard.test.js holds a marked quarantine to. Case-sensitive
  # on purpose: QUARANTINED in capitals is the token, and "quarantined" in lower case is a real
  # moderation status a fully-run check can report on (review round 6). awk, not a grep pipe:
  # under pipefail an early-exiting `grep -q` reads as a failure (SIGPIPE).
  # LC_ALL=C: under a UTF-8 locale macOS awk exits 2 on one invalid byte anywhere in the output,
  # and an error read as "no match" would log a quarantined check as PASS (review round 9). The
  # patterns are ASCII, so the C locale changes nothing else. 0 = match, 1 = no match, anything
  # else = the output could not be read, which fails CLOSED: it cannot be shown to be a pass.
  local rc=0
  LC_ALL=C awk '$0 ~ /(^|[^A-Za-z0-9_])PASS([^A-Za-z0-9_]|$)/ && $0 ~ /(^|[^A-Za-z0-9_])QUARANTINED([^A-Za-z0-9_]|$)/ { f = 1 }
       END { exit !f }' "$cap" 2>/dev/null || rc=$?
  case "$rc" in
    0) log "QUARANTINED  $label (exited 0 but says it did not run its assertions; this is not a pass)" ;;
    1) return 1 ;;
    *) log "QUARANTINED  $label (its output could not be read for the quarantine token, awk exit $rc; not counted as a pass)" ;;
  esac
  QUARANTINED+=("$label")
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
