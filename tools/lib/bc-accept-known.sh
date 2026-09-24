# kosmos#1398b: apply KOSMOS_BC_ACCEPT_KNOWN to the browser gate's FAILED list.
#
# A way to ship a staging cut past a NAMED known-flaky / known-broken page check
# WITHOUT hiding the browser or skipping the whole page layer -- every OTHER check
# still gates.
#
# 🛑 IT IS NOT A WAY TO SILENCE A RED. Three properties are load-bearing:
#   - A MEANINGFUL reason is mandatory (not blank, not whitespace, not a stray
#     character, one line): trivial reasons are refused, so the reason that lands
#     in the release log and the served versions entry actually says something.
#   - Only GENUINE per-check reds are acceptable. An INFRA / meta failure -- a board
#     that did not boot (one such failure appends 20+ named entries), an allowlist
#     name that never ran, "matched no checks", "could not run" -- keeps gating, so
#     a single boot cascade can never be "accepted" wholesale.
#   - Every accepted check + the reason are logged LOUDLY, and release.sh writes the
#     reason into the served versions entry, so a shipped run that leaned on this can
#     never read as a clean pass.
#
# Operates on the caller's GLOBAL arrays (as browser-checks.sh's summary already
# does with RAN/RETRIED/FAILED): reads/rewrites FAILED, sets ACCEPTED_KNOWN, logs via
# the caller's `log`. That is what makes it unit-testable without booting the gate.

kosmos_bc_apply_accept_known() {
  [ -n "${KOSMOS_BC_ACCEPT_KNOWN:-}" ] || return 0

  # Split the accept list SAFELY on comma/whitespace -- no pathname expansion, so a
  # name containing * ? [ is literal (set -f), not a glob against the cwd.
  local _ak_list=() _tok _oldifs="$IFS"
  IFS=', '; set -f
  for _tok in ${KOSMOS_BC_ACCEPT_KNOWN}; do [ -n "$_tok" ] && _ak_list+=("$_tok"); done
  set +f; IFS="$_oldifs"

  # A named check that did NOT fail is a stale accept-list entry, and a FULLY GREEN
  # run is exactly when that should surface. Emit the prune note here and return --
  # nothing to accept, nothing to gate.
  if [ "${#FAILED[@]}" -eq 0 ]; then
    for _tok in ${_ak_list[@]+"${_ak_list[@]}"}; do
      log "note: KOSMOS_BC_ACCEPT_KNOWN named '$_tok' but it did not fail this run -- drop it from the accept list."
    done
    return 0
  fi

  # A MEANINGFUL reason is required. Count non-whitespace characters (so "   " and a
  # lone "x" both fail) and refuse a multi-line reason (grep -qF would then treat it
  # as several alternative patterns, weakening the versions-entry check). On refusal
  # append a failure so the run still gates -- never clear anything without a reason.
  # BC_MIN_REASON_CHARS: the minimum NON-WHITESPACE length for a reason to count as
  # real. 10 is "a short sentence, not a placeholder" -- enough to reject "   ", a lone
  # "x", or "  . " while a genuine reason like "accepted for the #3542 headless env
  # issue" passes. It is also what makes the release.sh `grep -qF` of the reason into
  # the versions entry meaningful: a trivial reason would match almost any HTML by
  # accident.
  local BC_MIN_REASON_CHARS=10 _reason_clean _reason_nl=0
  _reason_clean="$(printf '%s' "${KOSMOS_BC_ACCEPT_REASON:-}" | tr -d '[:space:]')"
  # A literal newline in the pattern uses bash's $'\n' (this lib is sourced by bash).
  # NOT "$(printf '\n')": command substitution strips the trailing newline, leaving an
  # empty pattern that matches every reason and would refuse all of them.
  case "${KOSMOS_BC_ACCEPT_REASON:-}" in *$'\n'*) _reason_nl=1 ;; esac
  if [ "${#_reason_clean}" -lt "$BC_MIN_REASON_CHARS" ] || [ "$_reason_nl" = 1 ]; then
    FAILED+=("KOSMOS_BC_ACCEPT_KNOWN needs a real one-line KOSMOS_BC_ACCEPT_REASON (>=${BC_MIN_REASON_CHARS} non-space chars, no newline) -- refusing to accept a failing check without one")
    return 0
  fi

  local _kept=() _f _name _ak _match
  ACCEPTED_KNOWN=()
  for _f in ${FAILED[@]+"${FAILED[@]}"}; do
    # Keep INFRA / meta failures gating: they are not known-flaky CHECKS, and one of
    # them can stand for a whole board (browser-checks.sh appends 20+ names on a
    # single boot failure). Only a genuine per-check red is acceptable.
    case "$_f" in
      *"did not boot"*|*"never ran"*|*"matched no checks"*|*"could not run"*)
        _kept+=("$_f"); continue ;;
    esac
    _name="${_f%% *}"                 # the check NAME, before any " (failed twice)" suffix
    _match=0
    for _ak in ${_ak_list[@]+"${_ak_list[@]}"}; do [ "$_ak" = "$_name" ] && { _match=1; break; }; done
    if [ "$_match" = 1 ]; then ACCEPTED_KNOWN+=("$_name"); else _kept+=("$_f"); fi
  done
  FAILED=(${_kept[@]+"${_kept[@]}"})

  if [ "${#ACCEPTED_KNOWN[@]}" -gt 0 ]; then
    log "‼️  ACCEPTED KNOWN-FAILING page checks (KOSMOS_BC_ACCEPT_KNOWN): ${ACCEPTED_KNOWN[*]}"
    log "‼️  They did NOT pass. This run is accepted deliberately, and every OTHER page check still gated."
    log "‼️  REASON: ${KOSMOS_BC_ACCEPT_REASON}"
    log "‼️  Recorded here and in the served versions entry -- never a silent pass."
  fi

  # A named check that was NOT accepted (it passed, or it was an infra failure that
  # keeps gating) is worth surfacing so the list gets pruned -- never a gate.
  local _hit _a
  for _ak in ${_ak_list[@]+"${_ak_list[@]}"}; do
    _hit=0
    for _a in ${ACCEPTED_KNOWN[@]+"${ACCEPTED_KNOWN[@]}"}; do [ "$_a" = "$_ak" ] && { _hit=1; break; }; done
    [ "$_hit" = 0 ] && log "note: KOSMOS_BC_ACCEPT_KNOWN named '$_ak' but it did not fail as an acceptable check this run (it passed, or it is an infra failure that keeps gating) -- drop it or fix the infra."
  done
}
