#!/bin/sh
# served-verify.sh -- shared helpers to verify a deploy's SERVED artifacts in a way that CAN return
# the dangerous answer (kosmos#1667).
#
# 🛑 WHY. A 200 only means a request SUCCEEDED, never that the asset you named exists. On this infra
# a Vercel preview/deployment URL 302s to an SSO page that returns 200 (text/html) for EVERY path,
# so a status-only check goes blind and would certify a broken deploy. April measured it: a preview
# URL returned 200 with ~341KB of HTML for a must-not-exist control. The production alias
# discriminates (a nonexistent path 404s) and remains trustworthy -- but that must be PROVEN at
# runtime, not assumed, because the whole failure is a green that could not have been red.
#
# The two cheap tells, both from the card:
#   1. READ THE CONTENT-TYPE, NOT THE STATUS. application/gzip / text/plain separate a real artifact
#      from a login page or a 404 body; a 200 carrying text/html where you expected an asset is a
#      page wearing a success code.
#   2. PROVE THE HOST DISCRIMINATES. Fetch a path that cannot exist; if it does not 404, every
#      200-based check against that host is meaningless right now.
#
# These functions RETURN non-zero and print the reason to stderr; the CALLER decides whether to
# exit. That is deliberate: the same code the deploy runs is then exercisable by a test that drives
# it against a server in the blind state, so the guard is proven able to go red.
#
# Usage (from a script whose repo root is $REPO):
#   . "$REPO/tools/lib/served-verify.sh"
#   served_verify_host_discriminates "$HOST"            || exit 1
#   served_verify_asset_ok "$HOST/dist/foo.zip" "label" || exit 1

# _served_verify_redirect_note <url>: the card's SECOND tell, as a DIAGNOSTIC.
#
# 🛑 BOTH PROBES BELOW USE `curl -L`, AND THE CARD SAYS "DROP -L SO THE 302 IS VISIBLE". Following
# the redirect does not make the PAIR of checks miss the #1667 shape, because the SSO landing page
# answers 200 with text/html and both tells fire on that. ⚠️ SCOPE, because the sentence was
# broader than the code once already: that holds for a landing page carrying text/html, and it
# holds for the two functions used TOGETHER as tools/deploy-site.sh uses them. On its own,
# served_verify_asset_ok is still fooled by a redirect to a 200 carrying a NON-html type, which is
# reachable for /setup (it legitimately expects text/plain).
# What -L costs even where the verdict is right is the REASON: an operator reads "returned 200 for
# a path that cannot exist" and is told the symptom, never the mechanism, which is the whole point
# of #1667.
#
# 🛑 REPORT WHAT WAS OBSERVED, NOT WHAT IT PROBABLY MEANS. An earlier version of this note fired on
# ANY 3xx and then asserted "that is the auth-redirect shape from the card: the login page it lands
# on answers 200 to every path". The code never read Location, never looked at the target, and never
# saw a login page. An http-to-https upgrade, an apex-to-www redirect and an SPA rewrite all produce
# that byte-identical claim, so at a deploy refusal the operator was told SSO when the cause might
# be routing. The discriminating datum is free in the same request, so the note now PRINTS THE
# TARGET and leaves the interpretation open.
#
# It runs ONLY on a failure path, where one extra request is free and something is already wrong. A
# transport failure yields no note rather than a second error: a diagnostic must never change a
# verdict the caller already reached, so every path here returns 0 and prints nothing on doubt.
# Same headers as the real probes, or it could describe a response the verdict was not based on.
_served_verify_redirect_note() {
  _svrn_out=$(curl -sS --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code} %{redirect_url}' "$1" 2>/dev/null) || return 0
  _svrn_code=${_svrn_out%% *}
  _svrn_target=${_svrn_out#* }
  case "$_svrn_code" in
    3??)
      [ -n "$_svrn_target" ] || _svrn_target='(no Location reported)'
      printf ' MECHANISM: un-followed, this URL answers %s and redirects to %s. Judge that target: an auth/login page answers 200 to every path (the #1667 shape), and a catch-all route or SPA rewrite produces the same blindness for a different reason. Either way the status carries no information about your asset.' "$_svrn_code" "$_svrn_target"
      ;;
    *) : ;;
  esac
}

# served_verify_host_discriminates <host-base-url>
# 0 = the host 404s (or otherwise non-200s) a path that cannot exist, so its 200s are meaningful.
# 1 = the host returned 200 for a nonexistent path (the #1667 SSO-200-for-everything shape): BLIND.
# 2 = the probe could not run (transport error); the caller cannot conclude either way.
served_verify_host_discriminates() {
  _svhd_host=$1
  _svhd_url="${_svhd_host}/dist/__served-verify-negative-control-$$-$(date +%s)-must-404.bin"
  _svhd_code=$(curl -sSL --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code}' "$_svhd_url") || {
    echo "served-verify: negative-control probe to ${_svhd_url} failed at the transport layer" >&2
    return 2
  }
  if [ "$_svhd_code" = "200" ]; then
    echo "served-verify: NEGATIVE CONTROL FAILED -- ${_svhd_host} returned 200 for a path that cannot exist (${_svhd_url}). Every 200-based served check is BLIND on this host right now (the #1667 SSO-200-for-everything shape); a 200 no longer means the asset exists.$(_served_verify_redirect_note "$_svhd_url")" >&2
    return 1
  fi
  echo "served-verify: negative control OK -- ${_svhd_host} returns ${_svhd_code} (not 200) for a nonexistent path, so its 200s are meaningful."
  return 0
}

# served_verify_asset_ok <full-url> <label>
# For an asset that is NEVER an html page (a tarball, a zip, /setup's text/plain).
# 0 = served with a 200 and a non-html content-type.
# 1 = not a 200, OR a 200 carrying text/html (a login/404 page wearing a success code).
# 2 = the request could not run (transport error).
served_verify_asset_ok() {
  _svao_url=$1
  _svao_label=$2
  _svao_hdr=$(curl -sSL --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code} %{content_type}' "$_svao_url") || {
    echo "served-verify: could not reach ${_svao_url} (${_svao_label}) -- transport error" >&2
    return 2
  }
  _svao_code=${_svao_hdr%% *}
  _svao_ct=${_svao_hdr#* }
  if [ "$_svao_code" != "200" ]; then
    echo "served-verify: ${_svao_label} is NOT served (${_svao_code}) -- ${_svao_url}$(_served_verify_redirect_note "$_svao_url")" >&2
    return 1
  fi
  # #1667 tell: a real asset carries a content-type, and it is never an html page. Media types are
  # case-insensitive (RFC 2045), so lowercase before matching -- a server sending Text/HTML must not
  # slip through (the fleet's most-repeated false-zero class). Use the [:upper:]/[:lower:] class form,
  # not an A-Z range (locale-collation-fragile, and the newer lib convention here). An EMPTY
  # content-type is also refused: a 200 with no content-type cannot be confirmed to be a real asset.
  _svao_ct_lc=$(printf '%s' "$_svao_ct" | tr '[:upper:]' '[:lower:]')
  case "$_svao_ct_lc" in
    '')
      echo "served-verify: ${_svao_label} returned 200 but with NO content-type -- cannot confirm it is a real asset, not a page (#1667) -- ${_svao_url}$(_served_verify_redirect_note "$_svao_url")" >&2
      return 1
      ;;
    *text/html*)
      echo "served-verify: ${_svao_label} returned 200 but its content-type is '${_svao_ct}' (expected a non-html asset) -- an html page wearing a success code (#1667) -- ${_svao_url}$(_served_verify_redirect_note "$_svao_url")" >&2
      return 1
      ;;
  esac
  return 0
}
