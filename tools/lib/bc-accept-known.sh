# kosmos#1398b: apply KOSMOS_BC_ACCEPT_KNOWN to the browser gate's FAILED list.
#
# The cut guard was one-directional and a separate concern (a gate refusing into a
# cut). THIS is the other lever the 0.6.91 cut needed: a way to ship a staging cut
# past a NAMED known-flaky / known-broken page check WITHOUT hiding the browser or
# skipping the whole page layer -- every OTHER check still gates.
#
# 🛑 IT IS NOT A WAY TO SILENCE A RED. A reason is mandatory; the accepted checks and
# the reason are logged LOUDLY (the run log), and release.sh writes the same reason
# into the SERVED versions entry, so a shipped run that leaned on this can never read
# as a clean pass -- it names what was accepted and why, in the artifact users see.
#
# Operates on the caller's GLOBAL arrays, the same way browser-checks.sh's summary
# already works on RAN/RETRIED/FAILED: it reads and rewrites FAILED and sets
# ACCEPTED_KNOWN, and logs via the caller's `log`. That is what makes it unit-testable
# without booting the gate: a test seeds FAILED + the env and calls this directly.
#
# Fail-safe direction throughout: no accept var -> no-op; a reason missing -> refuse
# (leave a failure so the run gates); a named check that did not fail -> a printed
# note to prune the list, never a gate.

kosmos_bc_apply_accept_known() {
  [ -n "${KOSMOS_BC_ACCEPT_KNOWN:-}" ] || return 0
  [ "${#FAILED[@]}" -gt 0 ] || return 0

  if [ -z "${KOSMOS_BC_ACCEPT_REASON:-}" ]; then
    # Refuse: an accept with no written reason must not clear anything, and must
    # leave the run red. Append a failure rather than return silently.
    FAILED+=("KOSMOS_BC_ACCEPT_KNOWN was set without KOSMOS_BC_ACCEPT_REASON -- refusing to accept a failing check with no written reason")
    return 0
  fi

  local _kept=() _f _name _ak _match
  ACCEPTED_KNOWN=()
  for _f in ${FAILED[@]+"${FAILED[@]}"}; do
    # The check NAME is the first token, before any " (failed twice)" /
    # " (server did not boot)" suffix run_one attaches.
    _name="${_f%% *}"
    _match=0
    for _ak in ${KOSMOS_BC_ACCEPT_KNOWN//,/ }; do
      [ "$_ak" = "$_name" ] && { _match=1; break; }
    done
    if [ "$_match" = 1 ]; then ACCEPTED_KNOWN+=("$_name"); else _kept+=("$_f"); fi
  done
  FAILED=(${_kept[@]+"${_kept[@]}"})

  if [ "${#ACCEPTED_KNOWN[@]}" -gt 0 ]; then
    log "‼️  ACCEPTED KNOWN-FAILING page checks (KOSMOS_BC_ACCEPT_KNOWN): ${ACCEPTED_KNOWN[*]}"
    log "‼️  They did NOT pass. This run is accepted deliberately, and every OTHER page check still gated."
    log "‼️  REASON: ${KOSMOS_BC_ACCEPT_REASON}"
    log "‼️  Recorded here and in the served versions entry -- never a silent pass."
  fi

  # A named check that did NOT fail means the accept list is stale (the check
  # recovered). Say so loudly so it gets pruned; never gate on it -- a shrinking
  # accept list is the safe direction.
  local _hit _a
  for _ak in ${KOSMOS_BC_ACCEPT_KNOWN//,/ }; do
    _hit=0
    for _a in ${ACCEPTED_KNOWN[@]+"${ACCEPTED_KNOWN[@]}"}; do
      [ "$_a" = "$_ak" ] && { _hit=1; break; }
    done
    [ "$_hit" = 0 ] && log "note: KOSMOS_BC_ACCEPT_KNOWN named '$_ak' but it did not fail this run -- drop it from the accept list."
  done
}
