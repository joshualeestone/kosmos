#!/bin/bash
# Does the service key set this cut ships list the coordinator key the live service answers with? (kosmos#7568)
#
# WHY. Since #7561 a Kosmos Cloud box pins the coordinator keys the release ships (engine/service-keys.json, staged by
# tools/lib/stage-service-keys.sh), and a Mac's connector is handed the same list. A set without the live key would
# make every new cloud box stop joining and every sign-in refuse the real service, and nothing in the cut asked the
# coordinator which key it uses. Asked here, before the bump, so a wrong set costs a fix and not a cut.
#
# THE CHECK. Neither the set nor its .sig in the tree: nothing to check, and the coordinator is not asked. A .sig
# alone: refused. A set: /v1/meta "coordinator_pubkey" must be one of its keys (tools/check-service-keys-live.js).
# release.sh runs it twice: on the checkout before the bump (step 1d3), and on the frozen tree after step 2b, since a
# fast-forward in between can bring in or change a set.
#
# FAILS CLOSED, NO OVERRIDE. A /v1/meta that cannot be read or names no key is refused, and so is a set without the
# key. There is no legitimate set that omits the key in use: a rotation lists the next key BESIDE the current one.
#
# Usage: source, then
#   service_keys_live_check <repo>
# Env: KOSMOS_COORDINATOR_URL (default https://login.kosmosplus.com, as coordinator-floor.sh) and
# KOSMOS_COORDINATOR_RETRIES (default 2; the tests' file:// arms set 0). Returns 0 or says why, 1.
service_keys_live_check() {
  local repo="${1:?service_keys_live_check needs the repo}"
  local set="$repo/engine/service-keys.json"
  local url="${KOSMOS_COORDINATOR_URL:-https://login.kosmosplus.com}"
  local meta _why curl_err
  url="${url%/}"
  if [ ! -f "$set" ] && [ ! -f "$set.sig" ]; then
    echo "service_keys_live: no service key set ships (engine/service-keys.json absent); nothing to check."
    return 0
  fi
  [ -f "$set" ] || { echo "service_keys_live: engine/service-keys.json.sig is there without the set it signs; refused (#6587: they ship together)." >&2; return 1; }
  case "${KOSMOS_COORDINATOR_RETRIES:-2}" in ''|*[!0-9]*) echo "service_keys_live: KOSMOS_COORDINATOR_RETRIES must be a number (got '${KOSMOS_COORDINATOR_RETRIES}'); refused." >&2; return 1 ;; esac
  command -v node >/dev/null 2>&1 || { echo "service_keys_live: node is not on PATH, so /v1/meta cannot be compared; refused." >&2; return 1; }
  curl_err="$(mktemp "${TMPDIR:-/tmp}/skeyslive-curl.XXXXXX")" || curl_err=/dev/null
  meta="$(curl -fsS -m 15 --retry "${KOSMOS_COORDINATOR_RETRIES:-2}" --retry-delay 2 --retry-all-errors "$url/v1/meta" 2>"$curl_err")" || {
    _why="$(tail -1 "$curl_err" 2>/dev/null)"
    echo "service_keys_live: could not read $url/v1/meta${_why:+ ($_why)}, so whether the set lists the live coordinator key is UNKNOWN; refused. Retry; if it persists, check $url/v1/meta by hand." >&2
    [ "$curl_err" = /dev/null ] || rm -f "$curl_err"; return 1; }
  [ "$curl_err" = /dev/null ] || rm -f "$curl_err"
  printf '%s' "$meta" | node "$repo/tools/check-service-keys-live.js" "$set" || {
    echo "service_keys_live: refused. Fix engine/service-keys.json (and its .sig) to list the key $url/v1/meta answers with, then cut." >&2
    return 1; }
  return 0
}
