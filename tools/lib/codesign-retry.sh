# tools/lib/codesign-retry.sh (kosmos#5149): Developer ID signing with --timestamp asks Apple's
# timestamp service, and a blip of seconds there failed a cut after its 70-minute test run passed.
# codesign_ts_retry runs codesign with the arguments it is given and, ONLY when the output says
# the timestamp service is not available, tries again after each delay in
# KOSMOS_CODESIGN_TS_DELAYS (seconds, default "5 15 45": four tries). Every other failure
# (wrong identity, locked keychain, errSecInternalComponent) returns at once with codesign's own
# exit status. Each retry is printed, so the cut log shows it happened. codesign's output is
# indented four spaces, as the build printed it before.
# KOSMOS_CODESIGN_CMD names the codesign to run (tools/test-codesign-retry-5149.sh passes a stub). It is read in a
# real build too, like KOSMOS_CODESIGN_ID: leave it unset on a cut.
# It returns codesign's status, so call it as `codesign_ts_retry ... || { <fail> }`, as the bundle build does.
CODESIGN_TS_UNAVAILABLE='The timestamp service is not available'

codesign_ts_retry() {
  local cs="${KOSMOS_CODESIGN_CMD:-codesign}" out rc d try=1 tries ts nc=
  local -a delays
  read -r -a delays <<< "${KOSMOS_CODESIGN_TS_DELAYS-5 15 45}"   # split on spaces, never glob-expanded
  tries=$(( ${#delays[@]} + 1 ))
  while :; do
    out="$("$cs" "$@" 2>&1)" && rc=0 || rc=$?
    [ -z "$out" ] || printf '%s\n' "$out" | sed 's/^/    /'
    [ "$rc" -eq 0 ] && return 0
    # Case-insensitive, so a recapitalised message from a newer codesign is still retried.
    shopt -q nocasematch && nc=1
    shopt -s nocasematch
    case "$out" in *"$CODESIGN_TS_UNAVAILABLE"*) ts=1 ;; *) ts= ;; esac
    [ -n "$nc" ] || shopt -u nocasematch
    [ -n "$ts" ] || return "$rc"
    [ "$try" -lt "$tries" ] || break
    d="${delays[$((try - 1))]}"
    echo "==> codesign: Apple's timestamp service did not answer (try $try of $tries); trying again in ${d}s (kosmos#5149)" >&2
    sleep "$d" || :   # a bad delay must not end a set -e build; the try still happens
    try=$((try + 1))
  done
  echo "==> codesign: Apple's timestamp service did not answer (tries: $tries); failing as before (kosmos#5149)" >&2
  return "$rc"
}
