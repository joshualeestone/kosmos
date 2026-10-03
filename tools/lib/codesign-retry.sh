# tools/lib/codesign-retry.sh (kosmos#5149): Developer ID signing with --timestamp asks Apple's
# timestamp service, and a blip of seconds there failed a cut after its 70-minute test run passed.
# codesign_ts_retry runs codesign with the arguments it is given and, ONLY when the output says
# the timestamp service is not available, tries again after each delay in
# KOSMOS_CODESIGN_TS_DELAYS (seconds, default "5 15 45": four tries). Every other failure
# (wrong identity, locked keychain, errSecInternalComponent) returns at once with codesign's own
# exit status. Each retry is printed, so the cut log shows it happened. codesign's output is
# indented four spaces, as the build printed it before.
# KOSMOS_CODESIGN_CMD names the codesign to run (tools/test-codesign-retry-5149.sh passes a stub).
CODESIGN_TS_UNAVAILABLE='The timestamp service is not available'

codesign_ts_retry() {
  local cs="${KOSMOS_CODESIGN_CMD:-codesign}" delays="${KOSMOS_CODESIGN_TS_DELAYS-5 15 45}"
  local out rc d try=1 tries
  tries=$(( $(set -- $delays; echo $#) + 1 ))
  for d in $delays ''; do
    out="$("$cs" "$@" 2>&1)" && rc=0 || rc=$?
    [ -z "$out" ] || printf '%s\n' "$out" | sed 's/^/    /'
    [ "$rc" -eq 0 ] && return 0
    case "$out" in
      *"$CODESIGN_TS_UNAVAILABLE"*) ;;
      *) return "$rc" ;;
    esac
    [ -n "$d" ] || break
    echo "==> codesign: Apple's timestamp service did not answer (try $try of $tries); trying again in ${d}s (kosmos#5149)" >&2
    sleep "$d"
    try=$((try + 1))
  done
  echo "==> codesign: Apple's timestamp service did not answer on any of $tries tries; failing as before (kosmos#5149)" >&2
  return "$rc"
}
