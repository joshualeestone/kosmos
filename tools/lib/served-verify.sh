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

# _served_verify_redact_userinfo <url-head>: print the head with any USERINFO replaced.
#
# 🛑 EXTRACTED SO IT CAN BE DRIVEN DIRECTLY. Inline in the note, the only way to exercise it was
# an end-to-end redirect, and the adversarial shapes cannot be driven that way: a Location whose
# userinfo carries a raw `/` makes `curl -L` fail to connect, so the caller takes the transport
# branch and never reaches the note at all. A function the test can call with a table of inputs is
# the difference between a guard that is checked and one that is merely present.
#
# 🛑 USERINFO ENDS AT THE **LAST** `@`, NOT THE FIRST, and the first version of this got both
# halves wrong. It asked "does the text before the FIRST `@` contain a `/`" as a proxy for "is the
# `@` before the path", which is a different question. MEASURED, both defects, with real curl:
#   http://user:pa/ss@host.example/path   -> NOT redacted at all; the password printed WHOLE
#   http://user@host@evil.example/path    -> only `user` hidden, and the displayed host was wrong
# The second is the classic domain-confusion shape: a real URL parser reads `user@host` as the
# userinfo and `evil.example` as the host, so hiding only `user` both leaks and misleads.
#
# ⚠️ RESIDUAL, NAMED AND MEASURED: a target with BOTH an explicit port AND an `@` in its path
# (`http://host:8080/a/@b`) over-redacts to `http://<redacted>@b`, losing the host, which is the
# primary tell. It fails in the SAFE direction (nothing leaks) and it is not a shape this infra
# produces. A path `@` with no port (`http://host/users/@handle`) is left alone, which is the
# common case and is what the `:` test protects.
_served_verify_redact_userinfo() {
  _svru_h=$1
  case "$_svru_h" in
    *://*@*)
      _svru_scheme=${_svru_h%%://*}
      _svru_after=${_svru_h#*://}
      # The AUTHORITY is everything up to the first `/`, per RFC 3986. Two cases, and the second
      # exists only because a malformed target can put a raw `/` inside the userinfo.
      _svru_auth=${_svru_after%%/*}
      case "$_svru_auth" in
        *@*)
          # Well-formed: userinfo is everything before the LAST `@` IN THE AUTHORITY, which is what
          # a real URL parser does. Taking the FIRST `@` is the domain-confusion bug:
          # `http://user@host@evil.example/p` has host `evil.example`, not `host`.
          _svru_h="${_svru_scheme}://<redacted>@${_svru_auth##*@}${_svru_after#"$_svru_auth"}"
          ;;
        *:*)
          # No `@` in the authority, yet the head has one: the `/` that ended the authority is
          # INSIDE the credential (`http://user:pa/ss@host/p`). A `:` in the authority is a
          # credential separator, so redact to the last `@` in the whole head rather than leak.
          _svru_h="${_svru_scheme}://<redacted>@${_svru_after##*@}"
          ;;
        *)
          # No `@` and no `:` in the authority: the `@` is in the PATH (`/users/@handle`), which is
          # legal and carries tell, so it is left alone.
          : ;;
      esac
      ;;
  esac
  printf '%s' "$_svru_h"
}

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
# ⚠️ THAT TRANSPORT-FAILURE PATH IS NOW DRIVEN, NOT MERELY ASSERTED. It had no fixture, so nothing
# proved the note stays silent when its own request fails while the caller's already succeeded. The
# test's /ssoflap/ host 302s the caller's probe and then kills the connection on the note's
# un-followed re-fetch, which exercises the `|| return 0` below with the verdict already made.
# Same headers as the real probes, or it could describe a response the verdict was not based on.
# ⚠️ RESIDUAL, NAMED: this is a SECOND request, so a flaky or adversarial host can answer it
# differently from the one the verdict came from. It is diagnostic-only and cannot move a verdict,
# so the cost is a possibly-misleading reason rather than a wrong result, but reusing the first
# response is not possible without a second curl invocation shape and this is not worth that.
#
# 🛑 EVERY MESSAGE SITE USES printf, NOT echo, AND THAT IS NOT STYLE. (The note below uses
# `printf '<literal> %s ... %s'` rather than `printf '%s\n'`; an earlier version of this sentence
# said every site used `'%s\n'`, which was false for the ONE site that actually emits the remote
# value. What matters is that the remote value is an ARGUMENT, never part of the format.) ⚠️ The first version
# of this sentence was FALSE where it stood: the conversion matched only the sites ending `>&2`, so
# the success-path message on stdout stayed an `echo` one line below a comment claiming every site
# had been converted. That is the defect class this branch exists to remove, surviving in the one
# sentence that claimed completeness.
# ⚠️ WHAT IS CONVERTED IS NOT WHAT IS GUARDED, AND THIS SENTENCE HAS NOW BEEN WRONG THREE TIMES.
# Every site is converted. Which ones are COVERED was stated wrongly twice over: it named the
# *text/html* branch, and /ssoesc's escaped Location matches no fixture handler, so curl -L lands
# on the fixture's terminal 404 and the arm was actually driving the NOT-SERVED branch. MEASURED:
# printf -> echo on the text/html branch left the suite GREEN; the same mutation on the NOT-SERVED
# branch red it. The two errors compounded, because the text/html branch is the ONE site that
# interpolates a remote byte outside the note (${_svao_ct}, the server's own Content-Type), which
# is exactly the site the old sentence excused as needing no coverage.
# ✅ BOTH ARE COVERED NOW: /ssoesc reaches the NOT-SERVED branch and /ssoesc2 redirects to a
# handler that answers 200 text/html, so the text/html branch is driven with an escaped Location
# in its message too. Each is asserted under a shell whose echo truncates. The redirect target is
# the first field a REMOTE host writes into our output, and `echo` interprets backslash escapes in
# several shells. MEASURED on this box with a Location of `http://x/a\tb\cTRUNCATED`:
#   dash  -> tab rendered, and everything after \c DROPPED
#   zsh   -> same
#   bash  -> printed literally
# This file is #!/bin/sh and tools/deploy-site.sh is too, so on a dash /bin/sh a hostile or merely
# odd Location could truncate the very diagnostic that explains a refusal. It cannot reach a verdict
# (the verdict text precedes the substitution and the return is unconditional), but a note whose
# stated contract is REPORT WHAT WAS OBSERVED must not be the one thing that reports something else.
_served_verify_redirect_note() {
  # ⚠️ A TIGHTER BUDGET THAN THE PROBES IT EXPLAINS (5s/10s, not 10s/30s). The verdict is already
  # decided by the time this runs, and it is a command substitution inside the message, so a
  # black-holing host would otherwise withhold the refusal for up to 30s per failing check. A
  # diagnostic must not delay the answer it annotates.
  _svrn_out=$(curl -sS --connect-timeout 5 --max-time 10 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code} %{redirect_url}' "$1" 2>/dev/null) || return 0
  _svrn_code=${_svrn_out%% *}
  _svrn_target=${_svrn_out#* }
  case "$_svrn_code" in
    3??)
      [ -n "$_svrn_target" ] || _svrn_target='(no Location reported)'
      # 🛑 REDACT QUERY VALUES, KEEP QUERY KEYS (kosmos#2566, Mona Lisa's call, accepted).
      # This note used to print the target WHOLE, and a live Vercel SSO redirect is shaped
      # `.../sso-api?url=<deployment>&nonce=<...>`, so every refusal copied a short-lived nonce into
      # the deploy log AND into the agent-session transcript, which is retained on disk. I had
      # rejected redaction on the grounds that truncating at `?` hides the half of the target that
      # discriminates an auth redirect from a catch-all route. That objection was right about
      # TRUNCATION and wrong about the option space: the discriminating signal is the host, the
      # path, and WHICH KEYS ARE PRESENT. The values are payload and carry no diagnostic signal, so
      # redacting them costs the note nothing and leaks nothing.
      # ⚠️ RESIDUALS, NAMED NOT FIXED, and the list is meant to be complete rather than indicative:
      #   1. a credential in a PATH SEGMENT is still printed whole. Redacting path segments would
      #      destroy the tell, which is the same objection that killed truncation.
      #   2. a VALUELESS query or fragment component is still printed whole (`?url=a&SECRET` keeps
      #      SECRET, `?SECRET` keeps it), because it is indistinguishable from a KEY and keys are
      #      the discriminating signal. This follows correctly from "keep the keys" and it is a
      #      shape the first version of this list did not mention.
      # 🛑 AND THE LIST CLAIMED COMPLETENESS WHILE OMITTING THE ONE COMPONENT THAT IS ALWAYS A
      # CREDENTIAL: USERINFO. MEASURED against a fixture whose Location was
      # `http://alice:SECRETPASSWORD@host/landing?tok=QVAL#frag=FVAL`, the query and fragment were
      # redacted correctly and the PASSWORD printed whole into the deploy log and the retained
      # transcript, which is the exact surface kosmos#2566 was filed about. Unlike a path segment,
      # userinfo carries NO diagnostic signal at all: an auth redirect is told by the host, the
      # path and the query keys, never by who is authenticating. So it is redacted, not named.
      # 🛑 SPLIT AT THE FIRST `?` OR `#`, AND REDACT ONLY AFTER IT. The path is never touched,
      # because the path is half the tell. The FRAGMENT is redacted like the query: an implicit-flow
      # `#access_token=...` is exactly the shape this exists to keep out of a retained transcript,
      # and the first version handled only `?`. That version also SWALLOWED a fragment when a query
      # was present (`?url=abc#frag` lost `#frag`, because the value match ran to the next `&`) and
      # kept it when one was not, which is two different answers to "report what was observed".
      # `[^&#]*` stops a value at either separator, so both are now preserved and both are redacted.
      case "$_svrn_target" in
        *\?*|*\#*)
          _svrn_head=$(printf '%s' "$_svrn_target" | sed 's/[?#].*$//')
          _svrn_tail=${_svrn_target#"$_svrn_head"}
          _svrn_tail=$(printf '%s' "$_svrn_tail" | sed 's/=[^&#]*/=<redacted>/g')
          _svrn_target="${_svrn_head}${_svrn_tail}"
          ;;
        *) _svrn_head=$_svrn_target; _svrn_tail='' ;;
      esac
      # USERINFO, on the head only, so a `@` inside a query or fragment is never touched.
      _svrn_head=$(_served_verify_redact_userinfo "$_svrn_head")
      _svrn_target="${_svrn_head}${_svrn_tail}"
      # ⚠️ RESIDUAL: printf stops the SHELL interpreting escapes, but raw control bytes already in
      # the header (an ESC colour sequence, say) still reach the terminal verbatim. Deploy log and
      # operator terminal only, and stripping them would fight the "report what was observed"
      # contract, so it is named rather than filtered.
      # 📌 SUPERSEDED, KEPT ONLY AS THE RECORD OF A WRONG CALL. This block used to read: "the target
      # is printed WHOLE, QUERY STRING INCLUDED ... Not filtered, for the same report-what-was-
      # observed reason and because truncating at `?` would hide the discriminating half." That was
      # TRUE UNTIL kosmos#2566 AND IS NOW FALSE: the code fifteen lines above redacts query values.
      # It is prefixed rather than deleted because the reasoning is worth keeping and the sentence
      # is not: the objection to TRUNCATION was right, and it was mistaken for an objection to
      # redaction, which is what kept a live nonce in a retained transcript for twelve commits.
      # ⚠️ It also stood unprefixed for one commit, contradicting the accurate note above it, with
      # an audience of "whoever ships these logs somewhere shared" -- the one reader it misinformed.
      printf ' | MECHANISM: un-followed, this URL answers %s and redirects to %s. Judge that target: an auth/login page answers 200 to every path (the #1667 shape), and a catch-all route or SPA rewrite produces the same blindness for a different reason. Either way the status carries no information about your asset.' "$_svrn_code" "$_svrn_target"
      ;;
    *) : ;;
  esac
  # Explicit, so "every path returns 0" is true BY CONSTRUCTION rather than by the exit status of
  # whichever command happened to run last (printf, or the `:` above).
  return 0
}

# served_verify_host_discriminates <host-base-url> [route-prefix]
# 0 = the host 404s (or otherwise non-200s) a path that cannot exist, so its 200s are meaningful.
# 1 = the host returned 200 for a nonexistent path (the #1667 SSO-200-for-everything shape): BLIND.
# 2 = the probe could not run (transport error); the caller cannot conclude either way.
#
# 🛑 [route-prefix] AIMS THE CONTROL AT THE ROUTE THE CALLER IS ABOUT TO TRUST (kosmos#2565).
# It defaults to `/dist`, preserving the original probe for every existing caller. But a control
# proves discrimination only for the ROUTE it probed: the #1667 SSO-200-for-everything shape is
# host-wide and any route sees it, but a route-SCOPED blindness (a rewrite rule, a catch-all, or
# an SPA fallback under one path prefix) can discriminate under `/dist` and be blind under `/setup`.
# A caller that trusts 200s under a different route (e.g. deploy-site.sh trusts `$HOST/setup`, the
# site root) must PROVE discrimination THERE too, by passing that route (`/` for the site root).
# A trailing slash is stripped so `/` probes the root (`$HOST/__...`) rather than `$HOST//__...`.
#
# ⚠️ RESIDUAL, BOUNDED: this proves discrimination for the route PREFIX (a nonexistent sibling under
# it), which is the granularity real rewrites / catch-alls / SPA fallbacks operate at. It does NOT
# catch a blindness scoped to an EXACT literal path (e.g. a rewrite of exactly `/setup` -> a 200 with
# no wildcard and no catch-all elsewhere): a sibling probe 404s correctly and the control passes. That
# case is unreachable by ANY negative control in principle -- no other path routes identically to an
# exact match, so there is nothing to probe -- and it is largely covered from the other side:
# served_verify_asset_ok rejects a 200 carrying text/html (the usual exact-route rewrite target is an
# html page), leaving only a non-html exact-route rewrite of the one path, which is not a shape this
# infra produces. Named rather than left to be found.
served_verify_host_discriminates() {
  _svhd_host=$1
  _svhd_route=${2:-/dist}
  # Normalise: ensure ONE leading slash (a caller passing `setup` must not yield the malformed
  # `${host}setup/__...`), then strip ALL trailing slashes so `/` (and `//`) map to root
  # (`${host}/__...`, never `${host}//__...`). Both are no-ops for the existing `/dist` and `/`
  # callers. POSIX: the `case` glob is unquoted so it matches; the loop drops each trailing `/`.
  case "$_svhd_route" in /*) ;; *) _svhd_route="/$_svhd_route" ;; esac
  while [ "$_svhd_route" != "${_svhd_route%/}" ]; do _svhd_route=${_svhd_route%/}; done
  _svhd_url="${_svhd_host}${_svhd_route}/__served-verify-negative-control-$$-$(date +%s)-must-404.bin"
  _svhd_code=$(curl -sSL --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code}' "$_svhd_url") || {
    printf '%s\n' "served-verify: negative-control probe to ${_svhd_url} failed at the transport layer" >&2
    return 2
  }
  if [ "$_svhd_code" = "200" ]; then
    printf '%s\n' "served-verify: NEGATIVE CONTROL FAILED -- ${_svhd_host} returned 200 for a path that cannot exist (${_svhd_url}). Every 200-based served check is BLIND on this host right now (the #1667 SSO-200-for-everything shape); a 200 no longer means the asset exists.$(_served_verify_redirect_note "$_svhd_url")" >&2
    return 1
  fi
  # ⚠️ THE SENTENCE NAMES THE ROUTE IT ACTUALLY PROVED. It used to say "for a nonexistent path",
  # host-wide, over a probe that was always under /dist. Now the route is a parameter and the
  # message reports whichever one was proved, so a caller that proves /dist cannot read the result
  # as a statement about the root.
  printf '%s\n' "served-verify: negative control OK -- ${_svhd_host} returns ${_svhd_code} (not 200) for a nonexistent path under '${_svhd_route:-/ (the site root)}', so its 200s under that route are meaningful."
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
    printf '%s\n' "served-verify: could not reach ${_svao_url} (${_svao_label}) -- transport error" >&2
    return 2
  }
  _svao_code=${_svao_hdr%% *}
  _svao_ct=${_svao_hdr#* }
  if [ "$_svao_code" != "200" ]; then
    printf '%s\n' "served-verify: ${_svao_label} is NOT served (${_svao_code}) -- ${_svao_url}$(_served_verify_redirect_note "$_svao_url")" >&2
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
      printf '%s\n' "served-verify: ${_svao_label} returned 200 but with NO content-type -- cannot confirm it is a real asset, not a page (#1667) -- ${_svao_url}$(_served_verify_redirect_note "$_svao_url")" >&2
      return 1
      ;;
    *text/html*)
      printf '%s\n' "served-verify: ${_svao_label} returned 200 but its content-type is '${_svao_ct}' (expected a non-html asset) -- an html page wearing a success code (#1667) -- ${_svao_url}$(_served_verify_redirect_note "$_svao_url")" >&2
      return 1
      ;;
  esac
  return 0
}
