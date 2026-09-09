#!/usr/bin/env bash
# test-served-verify.sh -- kosmos#1667. Proves tools/lib/served-verify.sh can return the DANGEROUS
# answer, which is the whole point of the card: a check that certifies a green it could never have
# reddened is worthless.
#
# It sources the SAME lib deploy-site.sh sources (not a copy) and drives it against a local server
# with the behaviours listed below. ⚠️ NO COUNT IS STATED HERE ON PURPOSE. This sentence has been
# wrong twice ("three behaviours" over four, then "four handlers plus two landing pages" over five
# and three), each time in the sentence that had just been corrected for the same class. An arm at
# the end of this file DERIVES the handler list from the server source and fails if one is not
# named below, which is the only version of this that has not gone stale:
#   /discriminating/...  a sound host: /dist/real.bin -> 200 octet-stream, /setup -> 200 text/plain,
#                        /dist/htmlpage.bin -> 200 text/html, anything else -> 404.
#   /blind/...           the CONSEQUENCE, flattened: EVERY path -> 200 text/html, no redirect.
#   /sso/... + /ssologin the MECHANISM April measured: every /sso/ path 302s to /ssologin, which
#                        then answers 200 text/html to anything reaching it.
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
        if p == '/ssologin':
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
_oc_hit=""
for _oc in "That is the auth-redirect shape" "is an auth" "is a login page" "is an SSO" "definitely" "which means it is"; do
  case "$sso_msg" in
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
  case "$loc" in
    *TRUNCATEDMARKER*) pass "CONTROL: the fixture really serves a Location carrying the marker" ;;
    *) fail "CONTROL: the fixture's Location lacks the marker ($loc); the dash arm is vacuous" ;;
  esac
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
# green again.
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
srv_paths=$(printf '%s\n' "$srv_src" | /usr/bin/grep -oE "p\.startswith\('/[a-z]+/?'\)|p == '/[a-z]+'" | /usr/bin/grep -oE "/[a-z]+/?" | sort -u)
# CONTROL: the slice must BE a slice. If the address never matched, sed prints to EOF and this arm
# silently degrades to grepping the whole file again.
if [ "$(printf '%s\n' "$srv_src" | wc -l)" -ge "$(wc -l < "$0")" ]; then
  fail "the server-source slice is as long as the whole file; the heredoc delimiters moved and this arm is grepping prose again"
fi
n_paths=$(printf '%s\n' "$srv_paths" | /usr/bin/grep -c .)
# The floor is the COUNT OF DISPATCH BRANCHES, not a round number: nine today. A floor below the
# truth is what let the lost /discriminating go unnoticed, which this file has now been bitten by
# twice (a `>= 5` here, and a `>= 8` on another branch).
if [ "$n_paths" -ne 9 ]; then
  fail "the handler extraction found $n_paths dispatch paths, expected 9: [$(printf '%s' "$srv_paths" | tr '\n' ' ')]. If you added or removed a server behaviour, update the number in the same commit; if you did not, the extraction has stopped seeing one (a missing trailing slash did exactly that once)"
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
