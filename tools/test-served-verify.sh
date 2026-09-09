#!/usr/bin/env bash
# test-served-verify.sh -- kosmos#1667. Proves tools/lib/served-verify.sh can return the DANGEROUS
# answer, which is the whole point of the card: a check that certifies a green it could never have
# reddened is worthless.
#
# It sources the SAME lib deploy-site.sh sources (not a copy) and drives it against a local server
# with the behaviours listed below. ⚠️ NO COUNT IS STATED HERE ON PURPOSE. This sentence has been
# wrong twice ("three behaviours" over four, then "four handlers plus two landing pages" over five
# and three), each time in the sentence that had just been corrected for the same class. An arm at
# the end of this file DERIVES the handler list from the server source and fails if one is not named
# below, which is the only version of this that has not gone stale. 📌 ITS SCOPE, STATED RATHER THAN
# IMPLIED BY THE WORD "DERIVES": it reads DISPATCH STATEMENTS (`if`/`elif` on `p` or `rest`), top
# level and sub-dispatch, in EITHER quote style. A handler reached some other way would still be
# invisible to it: a routing table, a regex, a dict lookup, or a startswith() given a TUPLE of
# prefixes rather than one string. This file's history says the honest move is to name that rather
# than let "derived" imply completeness it does not have.
#   /discriminating/...  a sound host with FIVE sub-paths and a 404 floor: /dist/real.bin -> 200
#                        octet-stream, /setup -> 200 text/plain, /dist/htmlpage.bin -> 200 text/html,
#                        /dist/htmlcaps.bin -> 200 Text/HTML (mixed case), /dist/nocontenttype.bin ->
#                        200 with NO content-type at all, anything else -> 404. 🛑 THE LAST TWO WERE
#                        MISSING AND THE LINE SAID "anything else -> 404", which was FALSE for both:
#                        the derived arm below saw only the TOP-LEVEL dispatch, so the sub-dispatch
#                        could go stale exactly the way the prose counts did. It now reads both.
#   /blind/...           the CONSEQUENCE, flattened: EVERY path -> 200 text/html, no redirect.
#   /sso/... + /ssologin the MECHANISM April measured: every /sso/ path 302s to /ssologin, which
#                        then answers 200 text/html to anything reaching it.
#   /ssoflap/...         302s the FIRST request to a path and kills the connection on every later
#                        one, so the caller's probe succeeds and the DIAGNOSTIC's own un-followed
#                        re-fetch fails. Covers _served_verify_redirect_note's `|| return 0`, which
#                        had no fixture: nothing proved the note stays silent rather than adding a
#                        second error to a verdict already reached.
#   /ssomissing/ -> /ssogone      a redirect landing on a 404, so the NOT-SERVED branch is reached
#                                 WITH a redirect in front of it.
#   /ssoesc/ -> /ssologin?...     a redirect whose Location carries BACKSLASH ESCAPES, so the
#                                 echo-vs-printf difference is observable under a dash /bin/sh.
#   /ssonoct/ -> /ssonoctpage     a redirect landing on a 200 with no content-type, for the third
#                                 refusal branch. Both exist because those two call sites of the
#                                 diagnostic were asserted by return code only, and rc cannot see
#                                 whether a reason was printed.
#
# 🛑 /blind/ AND /sso/ ARE NOT REDUNDANT, and an earlier version of this header said /blind/ WAS
# "the #1667 SSO shape (April's measured failure)", which contradicted the comment fifty lines below
# and would tell a reader the /sso/ arms add nothing. They differ in the thing that matters: /blind/
# skips the transport, so it cannot catch a guard that mishandles the redirect itself, and /sso/ is
# flip-sensitive to -L where /blind/ is not (measured: dropping -L turns the /sso/ host arm from
# rc=1 into rc=0, declaring a blind host sound).
#
# Positive arms confirm the sound host passes. The RED-CAPABLE arms confirm every refusal path is
# reachable and reddens. Several arms assert the MESSAGE rather than the return code, because rc
# alone cannot see which route produced it: an asset behind a redirect is rc=1 both with -L (the
# landing page's content-type) and without it (the bare 302), and only the message separates them.
#
#   bash tools/test-served-verify.sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/lib/served-verify.sh"

T="$(mktemp -d)"
SRV=""
trap 'rm -rf "$T"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null' EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }

# check_rc <actual-rc> <expected-rc> <label> -- the command has already run and the caller captured
# $? into $rc. (This comment used to describe an `expect` helper with a different name and argument
# order; no such function exists, and it heads the helper every arm calls.)
check_rc() { # <got-rc> <expected-rc> <label>
  if [ "$1" = "$2" ]; then pass "$3 (rc=$1)"; else fail "$3 (got rc=$1, expected $2)"; fi
}

cat > "$T/srv.py" <<'PY'
import http.server

class H(http.server.BaseHTTPRequestHandler):
    # per-path request counter, for the one-shot /ssoflap/ host below
    _seen = {}

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_noct(self, code, body):
        # a 200 with NO Content-Type header (send_response sends no Content-Type of its own)
        self.send_response(code)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path.split('?', 1)[0]
        if p.startswith('/blind/'):
            # the #1667 SSO shape, FLATTENED: 200 text/html for EVERY path, no redirect. Kept
            # because it isolates the 200-for-everything tell from the transport that produces it.
            self._send(200, 'text/html; charset=utf-8', b'<html><body>SSO login</body></html>')
            return
        if p.startswith('/sso/'):
            # 🛑 THE MEASURED MECHANISM, NOT A FLATTENING OF IT. The card's failure was not "a host
            # that 200s everything"; it was a host that 302s to vercel.com/sso-api, whose login page
            # then 200s every path. The /blind/ behaviour above models the CONSEQUENCE and skips the
            # transport, so it could not have caught a guard that mishandled the redirect itself.
            # This arm reproduces the real shape: every /sso/ path 302s to /ssologin.
            self.send_response(302)
            self.send_header('Location', '/ssologin')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/ssoflap/'):
            # 🛑 THE CALLER'S PROBE SUCCEEDS AND THE DIAGNOSTIC'S OWN REQUEST FAILS. The first request
            # to a given path 302s, so served_verify_asset_ok follows it to /ssologin and reddens on
            # text/html exactly as normal; every LATER request to that same path is answered by
            # closing the connection, which is what _served_verify_redirect_note's un-followed
            # re-fetch gets. That is the only way to drive its `|| return 0` with a verdict already
            # made, and the note must stay SILENT there rather than append a second error.
            n = H._seen.get(p, 0)
            H._seen[p] = n + 1
            if n == 0:
                self.send_response(302)
                self.send_header('Location', '/ssologin')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            self.close_connection = True
            return
        if p.startswith('/ssomissing/'):
            # a redirect that lands on a 404: reaches served_verify_asset_ok's NOT-SERVED branch
            # WITH a redirect in front of it, which is the only way to cover the note there.
            self.send_response(302)
            self.send_header('Location', '/ssogone')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p == '/ssogone':
            self._send(404, 'text/html; charset=utf-8', b'not found behind the redirect')
            return
        if p.startswith('/ssoesc/'):
            # A Location carrying BACKSLASH ESCAPES: legal bytes in a header, and the first field a
            # REMOTE host writes into our diagnostic. Under a dash /bin/sh, `echo` renders the \t
            # and TRUNCATES at the \c; printf '%s' does not. Without this fixture the suite, which
            # runs under bash, could not see the difference.
            self.send_response(302)
            self.send_header('Location', '/ssologin?a=\\tb\\cTRUNCATEDMARKER')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/ssonoct/'):
            # a redirect that lands on a 200 with NO content-type: covers the note on the
            # empty-content-type branch, which rc alone cannot distinguish from the html one.
            self.send_response(302)
            self.send_header('Location', '/ssonoctpage')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p == '/ssonoctpage':
            self._send_noct(200, b'bytes behind a redirect, with no content-type at all')
            return
        if p == "/ssologin":
            # 🛑 DOUBLE-QUOTED ON PURPOSE, DO NOT NORMALISE. This is the fixture's only
            # double-quoted dispatch, and it is what proves the handler extraction below is
            # quote-agnostic. Python treats the two styles identically; the extraction did not, and
            # an undocumented `if p.startswith("/evil/"):` was invisible to it while the suite
            # stayed green. An arm fails if this line ever becomes single-quoted again.
            # the login page the redirect lands on: 200 text/html for anything that reaches it.
            self._send(200, 'text/html; charset=utf-8', b'<html><body>SSO login page</body></html>')
            return
        if p.startswith('/discriminating'):
            rest = p[len('/discriminating'):]
            if rest == '/dist/real.bin':
                self._send(200, 'application/octet-stream', b'REALBYTES')
            elif rest == '/dist/htmlpage.bin':
                self._send(200, 'text/html; charset=utf-8', b'<html>oops, a page not an asset</html>')
            elif rest == '/dist/htmlcaps.bin':
                # mixed-case media type: must still be caught (media types are case-insensitive)
                self._send(200, 'Text/HTML; charset=utf-8', b'<html>mixed-case content-type</html>')
            elif rest == '/dist/nocontenttype.bin':
                self._send_noct(200, b'bytes served with no content-type at all')
            elif rest == '/setup':
                self._send(200, 'text/plain; charset=utf-8', b'#!/bin/sh\necho setup\n')
            else:
                self._send(404, 'text/html; charset=utf-8', b'not found')
            return
        self._send(404, 'text/html; charset=utf-8', b'not found')

    def log_message(self, *a):
        pass

srv = http.server.HTTPServer(('127.0.0.1', 0), H)
print('PORT %d' % srv.server_address[1], flush=True)
srv.serve_forever()
PY

/usr/bin/python3 -u "$T/srv.py" >"$T/srv.log" 2>&1 &
SRV=$!

PORT=""
i=0
while [ "$i" -lt 50 ]; do
  PORT=$(sed -n 's/^PORT \([0-9][0-9]*\).*/\1/p' "$T/srv.log" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  i=$((i + 1))
  sleep 0.1
done
if [ -z "$PORT" ]; then
  echo "FAIL  local server did not start: $(cat "$T/srv.log" 2>/dev/null)"
  exit 1
fi
pass "local server listening on $PORT"

SOUND="http://127.0.0.1:$PORT/discriminating"
BLIND="http://127.0.0.1:$PORT/blind"
SSO="http://127.0.0.1:$PORT/sso"
SSOMISSING="http://127.0.0.1:$PORT/ssomissing"
SSONOCT="http://127.0.0.1:$PORT/ssonoct"
SSOESC="http://127.0.0.1:$PORT/ssoesc"
SSOFLAP="http://127.0.0.1:$PORT/ssoflap"

# --- the instrument reads something (a floor, like the repo's other meta-guards) ---
# If curl itself were broken every arm below would pass or fail for the wrong reason.
probe=$(curl -sSL -o /dev/null -w '%{http_code}' "$SOUND/dist/real.bin" 2>/dev/null || echo "ERR")
if [ "$probe" = "200" ]; then pass "curl reaches the fixture ($probe)"; else fail "curl cannot reach the fixture (got '$probe') -- the arms below would be vacuous"; fi

echo "-- host discriminates (negative control) --"
served_verify_host_discriminates "$SOUND" >/dev/null 2>&1; rc=$?
check_rc "$rc" 0 "sound host: negative control passes (nonexistent path 404s)"

# RED-CAPABLE: the blind host 200s a path that cannot exist. If this returns 0 the guard is unarmed.
served_verify_host_discriminates "$BLIND" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "BLIND host: negative control CATCHES the #1667 SSO-200-for-everything shape"

# RED-CAPABLE, AND THIS IS THE SHAPE THE CARD ACTUALLY MEASURED. /blind/ 200s directly; this one
# 302s to a login page that 200s everything, which is what a Vercel preview/deployment URL does.
# A guard that handled the flattened case but mishandled the redirect would pass the arm above and
# fail here, and until this arm existed nothing on the branch could tell those apart.
served_verify_host_discriminates "$SSO" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "SSO-REDIRECT host: negative control CATCHES a 302-to-a-login-page-that-200s-everything (the measured #1667 mechanism)"

# And the diagnostic must NAME the mechanism, not just the symptom: the card's second tell is that
# the 302 has to be visible. Without it an operator reads "200 for a path that cannot exist" and
# cannot tell an auth redirect from a catch-all route.
sso_msg=$(served_verify_host_discriminates "$SSO" 2>&1 >/dev/null)
# Match the STATUS and the TARGET too, not just the prefix: a note printing "(999 before -L)" or
# naming no target would have passed a prefix-only match while telling the operator nothing.
case "$sso_msg" in
  *"MECHANISM: un-followed, this URL answers 302 and redirects to"*"/ssologin"*)
    pass "the refusal names the redirect, its STATUS and its TARGET" ;;
  *) fail "the refusal does not name the redirect status and target; the operator is told the symptom only. Got: $sso_msg" ;;
esac
# 🛑 AND IT MUST NOT DIAGNOSE WHAT IT DID NOT OBSERVE. The first version asserted the target was an
# auth/login page for ANY 3xx, without ever reading Location: an http-to-https upgrade or an
# apex-to-www redirect produced the same claim. The note may describe the target; it may not
# conclude what the target IS.
# ⚠️ MATCHED AS A CLASS, NOT ONE DEAD PHRASE. The first version of this control looked for the
# exact string "That is the auth-redirect shape", which never reached a commit, so it could only
# ever pass and would not have caught the same overclaim differently worded. These are the shapes
# an overclaim takes here: any sentence asserting what the target IS, when the code only ever saw a
# status and a URL. The note must DESCRIBE and hedge.
# ⚠️ LOWERCASED ON BOTH SIDES. `case` is case-sensitive, so this loop claimed to match a CLASS of
# overclaim while a re-introduction differing only in capitalisation walked past it: appending
# "Note: it IS An Auth page most likely." passed the suite silently. Same tr idiom the lib already
# uses for content-type, and for the same reason.
_oc_hit=""
_sso_msg_lc=$(printf '%s' "$sso_msg" | tr '[:upper:]' '[:lower:]')
for _oc in "that is the auth-redirect shape" "is an auth" "is a login page" "is an sso" "definitely" "which means it is"; do
  case "$_sso_msg_lc" in
    *"$_oc"*) [ -n "$_oc_hit" ] || _oc_hit="$_oc" ;;
  esac
done
# One FAIL per root cause: a message tripping two forbidden phrasings is still one overclaim.
if [ -n "$_oc_hit" ]; then
  fail "the note asserts what the redirect target IS ('$_oc_hit'), which it never established: it reads a status and a URL, not the page"
fi
case "$sso_msg" in
  *"Judge that target"*) pass "CONTROL: the note hands the interpretation to the operator rather than concluding it" ;;
  *) fail "the note no longer hedges; it must describe the redirect, not diagnose it. Got: $sso_msg" ;;
esac
# 🛑 THE SIX ABOVE ARE A LIST, NOT A CLASS, AND THE COMMENT ON THEM CLAIMED OTHERWISE. MEASURED:
# appending "This target serves an SSO login screen, so the status is meaningless." to the note
# trips none of the six and the suite stays green -- and that sentence is precisely what the comment
# forbids, an assertion about what the target IS. The list is kept because it names the phrasings
# this note has actually worn and it gives a precise failure message, but the guard that is really
# class-wide is this one: the note must be EXACTLY the shipped sentence with the observed status and
# target substituted in. Any extra sentence, however worded, reds it, and so does a reworded one.
_note_expected=" | MECHANISM: un-followed, this URL answers 302 and redirects to http://127.0.0.1:$PORT/ssologin. Judge that target: an auth/login page answers 200 to every path (the #1667 shape), and a catch-all route or SPA rewrite produces the same blindness for a different reason. Either way the status carries no information about your asset."
case "$sso_msg" in
  *" | MECHANISM:"*) _note_actual=" | MECHANISM:${sso_msg#* | MECHANISM:}" ;;
  *) _note_actual="(no note present at all)" ;;
esac
if [ "$_note_actual" = "$_note_expected" ]; then
  pass "the note is EXACTLY the shipped sentence plus the observed status and target; no extra claim can hide in it"
else
  fail "the note is not the shipped sentence, so something was added or reworded. If you changed the wording on purpose, update this literal in the SAME commit; if you did not, an extra claim has appeared in a diagnostic whose contract is to report only what it observed. Expected: [$_note_expected] Got: [$_note_actual]"
fi

echo "-- the note's OWN request fails, the caller's did not --"
# CONTROL FIRST, on its own path so it cannot disturb the arm below: the fixture must really refuse
# a second request, or the silence proved below is the silence of a note that had nothing to fail on.
curl -sS -o /dev/null --max-time 5 "$SSOFLAP/control.bin" >/dev/null 2>&1; _f1=$?
curl -sS -o /dev/null --max-time 5 "$SSOFLAP/control.bin" >/dev/null 2>&1; _f2=$?
if [ "$_f1" -eq 0 ] && [ "$_f2" -ne 0 ]; then
  pass "CONTROL: the one-shot fixture answers the first request and FAILS the second (curl rc=$_f2)"
else
  fail "CONTROL: the one-shot fixture is not one-shot (first rc=$_f1, second rc=$_f2), so the arm below cannot tell a silent note from a note whose probe never failed"
fi
flap_msg=$(served_verify_asset_ok "$SSOFLAP/dist/real.bin" "an asset behind a one-shot redirect" 2>&1 >/dev/null); flap_rc=$?
check_rc "$flap_rc" 1 "a one-shot-redirect host still reddens on the landing page's text/html"
case "$flap_msg" in
  *"MECHANISM: un-followed"*)
    fail "the note SPOKE although its own re-fetch failed. A diagnostic whose probe failed must print nothing, or it describes a response the verdict was not based on. Got: $flap_msg" ;;
  *"content-type is 'text/html"*)
    pass "the note stayed silent on its own transport failure and the primary refusal survives intact" ;;
  *)
    fail "the primary refusal is missing or reworded, so this arm cannot distinguish a silent note from a lost message. Got: $flap_msg" ;;
esac
# CONTROL: the flattened blind host reaches its 200 WITHOUT a redirect, so it must NOT claim one.
blind_msg=$(served_verify_host_discriminates "$BLIND" 2>&1 >/dev/null)
case "$blind_msg" in
  *"MECHANISM: un-followed"*) fail "the redirect note fired on a host that did NOT redirect, so the note carries no information" ;;
  *) pass "CONTROL: no redirect claimed for a host that 200s directly" ;;
esac

echo "-- asset content-type tell --"
served_verify_asset_ok "$SOUND/dist/real.bin" "the real asset" >/dev/null 2>&1; rc=$?
check_rc "$rc" 0 "a real 200 octet-stream asset passes"

served_verify_asset_ok "$SOUND/setup" "/setup" >/dev/null 2>&1; rc=$?
check_rc "$rc" 0 "a 200 text/plain /setup passes (text/plain is a real asset, not html)"

# RED-CAPABLE: a 200 carrying text/html where an asset is expected. If this returns 0 the tell is dead.
served_verify_asset_ok "$SOUND/dist/htmlpage.bin" "an html page at an asset path" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "CATCHES a 200 wearing text/html (a page not an asset)"

# RED-CAPABLE: a 200 carrying MIXED-CASE Text/HTML must still be caught (media types are case-insensitive).
served_verify_asset_ok "$SOUND/dist/htmlcaps.bin" "a 200 wearing mixed-case Text/HTML" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "CATCHES a 200 wearing MIXED-CASE Text/HTML (case-insensitive, the fleet's most-repeated false-zero)"

# RED-CAPABLE: a 200 with NO content-type cannot be confirmed a real asset.
served_verify_asset_ok "$SOUND/dist/nocontenttype.bin" "a 200 with no content-type" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "CATCHES a 200 with NO content-type (cannot confirm it is an asset, not a page)"

missing_msg=$(served_verify_asset_ok "$SOUND/dist/does-not-exist.bin" "a missing asset" 2>&1 >/dev/null); rc=$?
check_rc "$rc" 1 "a 404 asset is caught (not served)"
# The SILENCE half, on the asset path. The equivalent control existed only for the host function, so
# nothing proved the note stays quiet when served_verify_asset_ok refuses with no redirect involved.
case "$missing_msg" in
  *"MECHANISM"*) fail "the note claimed a redirect on a plain 404 with none in front of it. Got: $missing_msg" ;;
  *) pass "CONTROL: no mechanism claimed when an asset 404s without a redirect" ;;
esac

# RED-CAPABLE: an asset fetched THROUGH the redirect. curl -L lands on the login page, which is a
# 200 carrying text/html, so the content-type tell must catch it on the real mechanism too.
# 🛑 ASSERT THE MESSAGE, NOT THE RC. `rc=1` here is reachable by TWO different routes: with -L the
# landing page's text/html trips the content-type tell, and WITHOUT -L the bare 302 trips the
# not-a-200 branch. Measured both ways, both rc=1. So an rc-only arm cannot see the transport
# property its own label names, and would have passed on a guard that never reached the landing
# page at all. The message is what discriminates.
sso_asset_msg=$(served_verify_asset_ok "$SSO/dist/real.bin" "an asset behind an SSO redirect" 2>&1 >/dev/null); rc=$?
check_rc "$rc" 1 "CATCHES an asset URL that 302s to a login page 200ing text/html (the measured mechanism)"
case "$sso_asset_msg" in
  *"content-type is 'text/html"*) pass "the asset refusal reached the LANDING PAGE and judged its content-type (not the bare 302)" ;;
  *) fail "the asset refusal did not judge the landing page's content-type, so the arm cannot tell -L from no -L. Got: $sso_asset_msg" ;;
esac
# The note's call site on the TEXT/HTML branch. ⚠️ An earlier version of this comment said
# "the note's SECOND call site ... Measured: it did", which was true of THIS branch and silently
# generalised to all of served_verify_asset_ok. There are FOUR call sites, and the other two are
# covered below; the generalisation was the same overclaim this branch is a record of.
case "$sso_asset_msg" in
  *"MECHANISM: un-followed"*) pass "served_verify_asset_ok's refusal also names the mechanism" ;;
  *) fail "served_verify_asset_ok's refusal does not name the mechanism; that call site is uncovered. Got: $sso_asset_msg" ;;
esac

# 🛑 THE REMAINING TWO CALL SITES. Deleting the note from either of these branches left the whole
# suite green, because both were asserted by return code only and rc cannot see whether a reason was
# printed. Each needs a redirect IN FRONT of it, or the note correctly prints nothing and the arm
# would pass for the wrong reason.
notserved_msg=$(served_verify_asset_ok "$SSOMISSING/dist/real.bin" "an asset whose redirect 404s" 2>&1 >/dev/null); rc=$?
check_rc "$rc" 1 "a redirect landing on a 404 is caught (not served)"
case "$notserved_msg" in
  *"MECHANISM: un-followed"*"/ssogone"*) pass "the NOT-SERVED branch also names the redirect and its target" ;;
  *) fail "the NOT-SERVED branch printed no mechanism; that call site is uncovered. Got: $notserved_msg" ;;
esac

noct_msg=$(served_verify_asset_ok "$SSONOCT/dist/real.bin" "an asset whose redirect 200s with no content-type" 2>&1 >/dev/null); rc=$?
check_rc "$rc" 1 "a redirect landing on a 200 with NO content-type is caught"
case "$noct_msg" in
  *"MECHANISM: un-followed"*"/ssonoctpage"*) pass "the NO-CONTENT-TYPE branch also names the redirect and its target" ;;
  *) fail "the NO-CONTENT-TYPE branch printed no mechanism; that call site is uncovered. Got: $noct_msg" ;;
esac

# 🛑 THE DIAGNOSTIC MUST SURVIVE A HOSTILE Location, UNDER THE SHELL THE LIB DECLARES. This suite
# runs under bash, where `echo` prints backslashes literally, so nothing else here can see the
# difference between echo and printf. The lib is #!/bin/sh and tools/deploy-site.sh is too, and on
# Debian-family hosts /bin/sh IS dash. MEASURED on this box with a Location of
# `http://x/a\tb\cTRUNCATED`: dash and zsh render the tab and DROP everything after \c; bash does
# not. ⚠️ AND macOS IS NOT EXEMPT: /bin/sh on this box truncates too, and tools/deploy-site.sh is
# #!/bin/sh, so the hazard is live where these deploys actually run, not only on Debian hosts. A
# reader who took the Debian framing literally could reasonably delete this arm.
# The sub-shell's own stderr is NOT discarded: swallowing it turned a sourcing or syntax failure
# into an empty result and a failure message with no cause.
# 🛑 PROBE FOR A TRUNCATING SHELL, DO NOT NAME ONE. This is the ONLY arm that can see the branch's
# headline change, and keying it to `dash` made it skip SILENTLY on any box without dash. CI runs
# macos-latest, where dash is not guaranteed, so the one arm covering printf-vs-echo was likely
# skipping exactly where it mattered, with no arm-count assertion to notice.
# MEASURED here: dash, zsh AND /bin/sh all truncate `echo "A\cB"` to `A`; bash does not.
ESC_SH=""
for _c in dash zsh sh /bin/sh; do
  command -v "$_c" >/dev/null 2>&1 || continue
  [ "$("$_c" -c 'echo "A\cB"' 2>/dev/null)" = "A" ] || continue
  ESC_SH="$_c"; break
done
if [ -n "$ESC_SH" ]; then
  pass "found a shell whose echo truncates at backslash-c, so the printf fix is observable here: $ESC_SH"
  esc_out=$("$ESC_SH" -c '. "$1"/lib/served-verify.sh; served_verify_asset_ok "$2/dist/real.bin" "an asset behind an escaped Location" 2>&1 >/dev/null' _ "$DIR" "$SSOESC")
  case "$esc_out" in
    *TRUNCATEDMARKER*) pass "under $ESC_SH, a Location carrying backslash escapes prints whole (printf, not echo)" ;;
    *) fail "under $ESC_SH the diagnostic was TRUNCATED or mangled by a server-controlled Location; use printf not echo. Got: $esc_out" ;;
  esac
  loc=$(curl -sS -o /dev/null -w '%{redirect_url}' "$SSOESC/dist/real.bin" 2>/dev/null)
  # 🛑 ASSERT THE ESCAPE, NOT JUST THE MARKER. A marker-only control still holds if curl
  # percent-encodes the backslash -- and then there is no `\c` left for a shell to truncate at, so
  # the arm above would pass under `echo` too and this control would have quietly stopped being able
  # to see the failure it names. MEASURED here: curl emits the backslashes verbatim.
  if printf '%s' "$loc" | /usr/bin/grep -qF 'TRUNCATEDMARKER' && printf '%s' "$loc" | /usr/bin/grep -qF '\c'; then
    pass "CONTROL: the fixture's Location really carries a literal backslash-c before the marker ($loc)"
  else
    fail "CONTROL: the fixture's Location lacks the literal backslash-c escape or the marker ($loc); the truncation arm above is vacuous"
  fi
else
  fail "no shell here truncates at backslash-c, so the printf-vs-echo arm could not run. It is the only arm covering that fix; do not read this suite as green for it."
fi

# 🛑 THE HEADER IS DERIVED, NOT RESTATED. Two prose counts went stale here, so this arm reads the
# embedded server source, extracts every path it dispatches on, and fails if the header does not
# name it. A handler added without documenting it reds this.
# ⚠️ THE HEADER REGION IS DELIMITED, NOT COUNTED. A hardcoded `sed -n '1,45p'` is a magic number
# that needs bumping by hand as the header grows; the failure direction was safe (a spurious FAIL)
# but the count is exactly the kind of thing this file keeps getting wrong.
# 🛑 THE DELIMITER MUST EXIST, OR sed PRINTS TO EOF AND THIS ARM IS VACUOUS. With no `set -u` line
# to stop at, $hdr becomes the WHOLE FILE and every handler token is trivially "named", because they
# all appear in the server source below. MEASURED: undocumenting /ssogone correctly reds, and then
# adding a single TRAILING SPACE to `set -u` (behaviourally identical, as would `set -eu`) turns it
# green again. ⚠️ THAT IS NOW PAST TENSE AND THE COMMENT SAID IT IN THE PRESENT: with the two
# assertions below in place, a trailing space is CAUGHT (two failures). Left as history because the
# guard exists for it, but a reader was being sent to chase a residual that is closed.
/usr/bin/grep -qx 'set -u' "$0" || fail "the header delimiter line is gone; the slice below would run to EOF and pass trivially"
hdr=$(sed -n '1,/^set -u$/p' "$0")
if [ "$(printf '%s\n' "$hdr" | wc -l)" -ge "$(wc -l < "$0")" ]; then
  fail "the header slice is the whole file; the naming check below cannot fail"
fi
# ⚠️ THE TRAILING SLASH IS LOAD-BEARING. Extracting `/sso` and substring-matching it against the
# header made this guard VACUOUS for that one handler: `/sso` is a prefix of /ssologin, /ssomissing,
# /ssoesc, /ssonoct, /ssonoctpage and /ssogone, so documenting ANY of the six satisfied it and a
# future edit dropping the `/sso/` mention would pass silently. Keeping the slash that the dispatch
# itself uses makes the token unambiguous.
# ⚠️ THE `/?` IS BACK IN THE FIRST PATTERN, AND DROPPING IT SILENTLY LOST A HANDLER. Requiring a
# trailing slash there stopped matching `p.startswith('/discriminating')`, which has none, so the
# guard quietly stopped checking the sound host entirely and the >= 5 floor was too loose to notice.
# Match an optional slash in the DISPATCH, and keep whatever slash it carries in the TOKEN.
# 🛑 BOUNDED TO THE HEREDOC, BECAUSE THE FILE CONTAINS PROSE ABOUT ITS OWN DISPATCH. Grepping the
# whole file let a COMMENT supply a token: the comment above quotes
# p.startswith('/discriminating'), so rewriting the REAL dispatch into an equivalent the regex
# cannot see left this arm printing 9 and the suite green. That is precisely the regression this
# guard was added to catch, and it was blind to it for that one handler.
srv_src=$(sed -n '/srv\.py" <</,/^PY$/p' "$0")
# 🛑 BOUNDING TO THE HEREDOC MOVED THE HOLE, IT DID NOT CLOSE IT: the heredoc is itself the file's
# densest comment region, about ten blocks of it. MEASURED on a copy: rewrite the real dispatch
# `if p.startswith('/blind/'):` into `if p[:7] == '/blind/':` and add ONE comment line INSIDE the
# heredoc quoting the old form, and the count stayed 9, the naming arm passed and the suite exited
# 0 with /blind/ no longer extracted -- byte for byte the regression this guard exists to catch, one
# layer in. Two changes close it, and THE ANCHOR IS THE LOAD-BEARING ONE: the pattern now matches
# only a DISPATCH STATEMENT (`if`/`elif` on `p` or `rest`, at the start of a line), which a comment
# cannot be. Stripping comment lines first is belt-and-braces, not the fix.
srv_code=$(printf '%s\n' "$srv_src" | /usr/bin/grep -v '^[[:space:]]*#')
# 🛑 THE SUB-DISPATCH COUNTS TOO. /discriminating routes five sub-paths through `rest == ...`,
# and an extraction that read only the top level left /dist/htmlcaps.bin and /dist/nocontenttype.bin
# undocumented while the header asserted "anything else -> 404" -- false for both, and green.
# ⚠️ AND THE CHARACTER CLASS WAS `[a-z]+`, SO A HANDLER NAMED WITH A DIGIT OR A HYPHEN WAS INVISIBLE.
# MEASURED: adding `if p.startswith('/sso-x2/'):` serving 200 text/html left the count at 9 and the
# suite green. The quoted literal is now taken whole, whatever characters it carries.
# 🛑 BOTH QUOTE STYLES. The pattern matched only SINGLE-quoted literals, and Python does not
# care: MEASURED, adding `if p.startswith("/evil/"):` serving 200 text/html for every path left the
# count at 15, the naming arm trivially green (no token was ever surfaced to check) and the suite
# exited 0 with an undocumented blind-host handler in the fixture. That is not one of the exclusions
# named below -- it is the exact mechanism this guard claims to cover, defeated by a quote.
srv_paths=$(printf '%s\n' "$srv_code" \
  | /usr/bin/grep -E "^[[:space:]]*(el)?if (p|rest)(\.startswith\(|[[:space:]]==[[:space:]])['\"]/[^'\"]*['\"]" \
  | /usr/bin/grep -oE "['\"]/[^'\"]*['\"]" | tr -d "'\"" | sort -u)
# CONTROL, AND IT IS WHY ONE DISPATCH BELOW IS DELIBERATELY DOUBLE-QUOTED: without a double-quoted
# dispatch in the fixture, nothing here exercises the half of the pattern that was just added, and a
# future edit normalising the quotes would silently restore the blindness with every arm still green.
if ! printf '%s\n' "$srv_code" | /usr/bin/grep -qE "^[[:space:]]*(el)?if (p|rest)(\.startswith\(|[[:space:]]==[[:space:]])\"/"; then
  fail "no DOUBLE-QUOTED dispatch is left in the fixture server, so nothing proves the extraction is quote-agnostic; a handler written with double quotes would be invisible to it again"
fi
# 🛑 CONTROL: THE SLICE MUST END AT THE TERMINATOR. ⚠️ The first version of this control checked
# only that the slice was shorter than the file, and its comment said "if the address never matched,
# sed prints to EOF". Both were wrong, in opposite directions, and MEASURED:
#   opening address unmatched -> sed emits NOTHING (not EOF-to-end)
#   closing address unmatched -> sed prints from the opening anchor TO EOF
# So renaming the heredoc terminator consistently (PY -> ENDPY) while this pattern still looks for
# /^PY$/ produced a slice hundreds of lines too long but still SHORTER than the file, and the
# length check never fired. Asserting the last line IS the terminator catches that directly, and
# the empty case is caught by the same assertion.
# CONTROL: the comment strip must actually remove lines. If it silently became a no-op nobody would
# notice, and the belt-and-braces half of the fix above would be decoration.
if [ "$(printf '%s\n' "$srv_code" | wc -l)" -ge "$(printf '%s\n' "$srv_src" | wc -l)" ]; then
  fail "the comment strip removed no lines from the server source, so it is a no-op and the dispatch anchor is the only defence left"
fi
_srv_last=$(printf '%s\n' "$srv_src" | tail -1)
if [ "$_srv_last" != "PY" ]; then
  fail "the server-source slice does not end at the heredoc terminator (last line: '$_srv_last'). The delimiters moved, so this arm is reading unrelated lines, not the server."
fi
n_paths=$(printf '%s\n' "$srv_paths" | /usr/bin/grep -c .)
# The floor is the COUNT OF DISPATCH BRANCHES, not a round number: fifteen today -- ten top-level
# and five sub-dispatch, which is why it is not the nine it was before the sub-dispatch was read. A
# floor below the truth is what let the lost /discriminating go unnoticed, which this file has now
# been bitten by twice (a `>= 5` here, and a `>= 8` on another branch).
if [ "$n_paths" -ne 15 ]; then
  fail "the handler extraction found $n_paths dispatch paths, expected 15: [$(printf '%s' "$srv_paths" | tr '\n' ' ')]. If you added or removed a server behaviour, update the number in the same commit; if you did not, the extraction has stopped seeing one (a missing trailing slash did exactly that once, and so did a character class that could not see a digit)"
else
  pass "handler extraction found $n_paths dispatch paths"
  missing=""
  for _p in $srv_paths; do
    case "$hdr" in *"$_p"*) : ;; *) missing="$missing $_p" ;; esac
  done
  if [ -n "$missing" ]; then fail "the header does not name these server handlers:$missing"; else pass "every server handler is named in the header (derived, not counted in prose)"; fi
fi

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-served-verify: PASS -- served-verify.sh discriminates a sound host, catches the #1667 blind host, and rejects a 200 wearing text/html; the positive arms pass. Red-capability proven."
  exit 0
fi
echo "test-served-verify: $fails FAILED"
exit 1
