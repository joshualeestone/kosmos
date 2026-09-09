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
# below, which is the only version of this that has not gone stale.
#
# 📌 ITS SCOPE, NAMED BY WHAT THE REGEX ACTUALLY MATCHES RATHER THAN BY WHAT IT IS FOR: a line
# whose first token is `if` or `elif` FOLLOWED BY EXACTLY ONE SPACE, whose subject is the bare name
# `p` or `rest`, and whose test is `.startswith(` or `==` against ONE quoted literal BEGINNING WITH
# `/`, in either quote style, with any spacing around `==` but NO SPACE after `startswith(`.
# 📌 PRECISION, because this sentence is the thing the non-fix decision traded for: "ONE quoted
# literal" describes the SELECTION of a line. The EXTRACTION then pulls EVERY `'/...'` literal off
# a selected line, so `if p == '/a' or p == '/b':` yields two tokens. That is a superset and fails
# in the safe direction (an extra token needs a manifest entry), but it is not what "one" says. That is a restriction on the METHOD, and
# the earlier wording ("if/elif on p or rest") implied it was a restriction on the SUBJECT.
# ⚠️ THE TWO CLAUSES IN CAPITALS WERE MISSING FROM THIS SENTENCE AND ARE IN THE REGEX. MEASURED:
# `if  p == '/twospaceafterif':` (two spaces after `if`) is NOT matched, and `if p == 'noslash':`
# is NOT matched. The leading-slash restriction is harmless in practice, because `p` is always
# `self.path.split('?')[0]` and a literal without a slash is dead code, but the whole point of the
# decision below was to trade closure for a TRUE scope sentence, so the sentence has to be true. MEASURED, three handlers each answering 200 text/html
# to every path, each leaving this arm green at its expected count:
#   if self.path.startswith('/evilself/'):     <- `self.path` is literally what `p` is derived from
#   if p.endswith('/evilend'):
#   if p in ('/evilin', '/evilin2'):
#
# 🛑 THOSE ARE OUT OF SCOPE BY DESIGN, NOT BY OVERSIGHT, AND THE WIDENING STOPS HERE. Seven
# closures of this guard have each produced the next evasion (a comment supplying a token, a slice
# running to EOF, a count floor, a character class blind to digits, one quote character, one spacing
# of `==`, prose standing in for documentation), and what it defends is the accuracy of a COMMENT
# ABOUT A FIXTURE INSIDE A TEST. No product behaviour depends on it. Closing the next hole costs
# more than the hole does, so the honest move is to state the scope truthfully and stop.
# 💰 AND NAME THE COST, BECAUSE A FUTURE EDITOR WILL HIT IT WITH NO WARNING: the fixture's
# Python is now FORMATTING-FROZEN in two places on purpose. `if p=='/ssonoctpage':` must stay
# spaceless and `if p == "/ssologin":` must stay double-quoted, because each is the only thing
# exercising one half of the extraction pattern, and a tidy-up that normalises either reds the
# suite. That is a real cost of keeping this apparatus, paid so that a widening cannot be silently
# lost; it is stated here rather than discovered by whoever reformats the heredoc.
# 🔑 THE WEAKEST PREMISE IN THAT CALL, named because it is what would make the race worth
# resuming: an undocumented fixture handler can only cause a stale comment SO LONG AS no arm selects
# a fixture path dynamically. If one ever does, an undocumented handler could make an arm pass for
# the wrong reason, and this guard becomes product-relevant again.
#
# 🛑 THE MANIFEST IS DELIMITED, ONE LINE PER TOKEN, AND THE ARM MATCHES ONLY AT THE START OF AN
# ENTRY. Before this, the arm asked whether the token appeared ANYWHERE in the header, so PROSE
# ABOUT a handler documented it: MEASURED, deleting the whole /sso/ manifest entry left the suite
# green, because /sso/ and /ssologin both survive in the "🛑 /blind/ AND /sso/ ARE NOT REDUNDANT"
# paragraph below and in the /ssoesc/ entry. That is the same "a comment supplied the token" defect
# this file already closed on the SERVER-SOURCE side, still open on the HEADER side, under a pass
# message that read "derived, not counted in prose". Explanations now live BELOW the block.
# --- MANIFEST BEGIN ---
#   /discriminating         a sound host: sub-paths below, and a 404 floor for anything else
#   /dist/real.bin          200 application/octet-stream (sub-path of /discriminating)
#   /setup                  200 text/plain, a real asset that is legitimately not html
#   /dist/htmlpage.bin      200 text/html: a page wearing an asset's path
#   /dist/htmlcaps.bin      200 Text/HTML, mixed case, which must still be caught
#   /dist/nocontenttype.bin 200 with NO content-type at all
#   /blind/                 the CONSEQUENCE, flattened: EVERY path -> 200 text/html, no redirect
#   /sso/                   the MECHANISM April measured: every path here 302s to /ssologin
#   /ssologin               the login page: 200 text/html to anything that reaches it
#   /ssoflap/               302s the FIRST request to a path, kills the connection on later ones
#   /ssomissing/            302s to /ssogone
#   /ssogone                404 behind a redirect
#   /ssoesc/                302 whose Location carries BACKSLASH ESCAPES
#   /ssonoct/               302s to /ssonoctpage
#   /ssonoctpage            200 with no content-type at all, behind a redirect
#   /ssonoloc/              302 with NO Location header at all
#   /sso301/                301, not 302, so the note's `3??` arm is more than a 302 arm
#   /sso308/                308, so that arm is more than a 301-or-302 arm either
#   /ssoq/                  302 whose Location carries a QUERY with a secret-shaped value
#   /ssoesc2/               like /ssoesc/, but its escaped Location LANDS on 200 text/html
#   /esclanding             the 200 text/html that /ssoesc2/'s escaped Location resolves to
#   /routeblind             a ROUTE-SCOPED blindness: 404 under its /dist, 200 at its root
#   /dist/                  the sub-dispatch inside /routeblind that makes /dist discriminate
# --- MANIFEST END ---
#
# WHY SEVERAL OF THOSE EXIST, which is the part that does not belong in a manifest:
#   /dist/htmlcaps.bin and /dist/nocontenttype.bin were MISSING from the old manifest while it said
#     "anything else -> 404", false for both, because the derived arm read only the TOP-LEVEL
#     dispatch and the sub-dispatch could go stale exactly the way the prose counts did.
#   /ssoflap/ covers _served_verify_redirect_note's `|| return 0`: nothing else proved the note
#     stays SILENT when its own re-fetch fails rather than adding a second error to a verdict
#     already reached.
#   /ssomissing/ and /ssonoct/ exist because those two call sites of the diagnostic were asserted by
#     RETURN CODE ONLY, and rc cannot see whether a reason was printed.
#   /ssonoloc/ is the note's `(no Location reported)` branch, the last uncovered path in it.
#   /sso301/ and /sso308/ exist because every other redirect fixture sent 302, so narrowing the
#     note's `3??` arm left the suite GREEN: first to a literal `302`, and then, once /sso301/
#     existed, to `30[12]`. Three distinct codes are now driven and a control keeps it that way.
#     📌 WHAT IS DELIBERATELY NOT GUARDED: narrowing `3??` to `30?` is invisible here and always
#     will be, because every real redirect status is 300-308. That is a distinction with no
#     behavioural difference, and pretending to guard it would be the third layer of a guard that
#     already defends only a comment. The comment on that arm names an http-to-https
#     upgrade and an apex-to-www redirect, both commonly 301, as cases it covers; nothing tested
#     that claim until this fixture.
#   /ssoesc/ makes the echo-vs-printf difference observable under a shell whose echo truncates.
#     🛑 IT REACHES THE **NOT-SERVED** BRANCH, NOT THE text/html ONE, and a comment in the lib
#     claimed the opposite for twelve commits: the escaped Location matches no handler, so curl -L
#     lands on the terminal 404. MEASURED: printf -> echo on the text/html branch left the suite
#     GREEN. /ssoesc2/ exists to close that, because the text/html branch is the ONE message site
#     that interpolates a remote byte outside the note (the server's own Content-Type header).
#     🛑 ITS MARKER MOVED FROM THE QUERY INTO THE PATH when kosmos#2566's redaction landed:
#     the note now redacts query VALUES, which would have eaten the marker and red an arm that has
#     nothing to do with redaction. The escape hazard is identical in a path.
#   /ssoq/ proves that redaction actually happens: a Location whose query carries a secret-shaped
#     value must reach the note as `key=<redacted>`, with the value absent.
#   /routeblind is kosmos#2565 made drivable: it DISCRIMINATES under /dist and is BLIND at the
#     root, which is the shape a rewrite rule or an SPA fallback produces. The default probe passes
#     on it and the root-route probe catches it, which is the whole reason the route is a
#     parameter. 🛑 THIS FIXTURE AND THE ROUTE PARAMETER CAME FROM MAIN, NOT FROM THIS BRANCH.
#     kosmos#2565 was filed FROM this loop, someone else implemented it, and PR #2572 merged first
#     with a better interface than the one I had written here: callers pass `/` for the root and the
#     route is normalised, where mine required an explicitly EMPTY string. Mine was dropped at the
#     merge. Its handler is `startswith('/routeblind')` with NO trailing slash on purpose, which is
#     what makes their leading-slash-normalisation arm non-vacuous; my two-handler version would
#     have shadowed it into dead code and quietly made that arm prove nothing.
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
            # 🛑 THE ESCAPES ARE IN THE PATH, NOT A QUERY VALUE. They lived in `?a=...` until the
            # note began redacting query values (kosmos#2566), which would have removed the marker
            # and red the printf-vs-echo arm for a reason unrelated to escapes. A backslash is just
            # as legal, and just as hostile, in a path.
            self.send_header('Location', '/ssologin\\tb\\cTRUNCATEDMARKER')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/ssoesc2/'):
            # like /ssoesc/, but the escaped Location resolves to a handler that answers 200
            # text/html, so served_verify_asset_ok takes the *text/html* branch instead of the
            # NOT-SERVED one. That branch is the only message site carrying a remote byte outside
            # the note, and it was uncovered while a comment said it was the covered one.
            self.send_response(302)
            self.send_header('Location', '/esclanding\\tb\\cTRUNCATEDMARKER2')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/esclanding'):
            # startswith, not ==, because the escaped suffix is part of the resolved path.
            self._send(200, 'text/html; charset=utf-8', b'<html><body>escaped landing</body></html>')
            return
        if p.startswith('/ssoq/'):
            # a Location carrying a QUERY whose values look like credentials. The note must print
            # the KEYS and redact the VALUES (kosmos#2566): keys are the discriminating tell, values
            # are payload. SECRETNONCEVALUE must never appear in the note.
            self.send_response(302)
            # the FRAGMENT carries a secret too: an implicit-flow `#access_token=...` is the same
            # hazard as a query nonce, and the first redaction handled only `?` (and silently ate a
            # fragment that followed a query, because the value match ran to the next `&`).
            self.send_header('Location', '/ssologin?url=https%3A%2F%2Fdeploy.example&nonce=SECRETNONCEVALUE#access_token=SECRETFRAGVALUE')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/sso308/'):
            # a THIRD distinct 3xx. With only 301 and 302 driven, narrowing the note's `3??` arm to
            # `30[12]` was invisible; the arm's comment names cases whose real statuses span
            # 301/307/308, so the broadest claim had the narrowest coverage.
            self.send_response(308)
            self.send_header('Location', '/ssologin')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/sso301/'):
            # 🛑 301, NOT 302, ON PURPOSE. The note fires on `3??`, and every other redirect
            # fixture here sends 302, so a regression narrowing that arm to a literal `302` was
            # invisible: MEASURED, the suite stayed green. The arm's own comment names an
            # http-to-https upgrade and an apex-to-www redirect as cases it covers, and those are
            # commonly 301, so the claim was untested exactly where it was broadest.
            self.send_response(301)
            self.send_header('Location', '/ssologin')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p.startswith('/ssonoloc/'):
            # a 302 with NO Location header at all: curl reports an empty %{redirect_url}, which is
            # the note's `(no Location reported)` branch and the last path in it with no fixture.
            self.send_response(302)
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
        if p=='/ssonoctpage':
            # 🛑 NO SPACES AROUND `==` ON PURPOSE, DO NOT REFORMAT. The extraction required
            # exactly one space on each side, so `if p=='/evilnodoc':` serving 200 text/html for
            # every path was invisible to it and the suite stayed green with the count at 15. This
            # is the only spaceless dispatch in the fixture and an arm fails if it disappears.
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
        if p.startswith('/routeblind'):
            # #2565: a ROUTE-SCOPED blindness. Discriminates under /dist (a nonexistent /dist path
            # 404s, so the default control passes), but the site ROOT is a catch-all that 200s every
            # path -- including a nonexistent one -- so a 200 at /setup there is meaningless. This is
            # the rewrite/catch-all/SPA-fallback case the card names, distinct from the host-wide
            # /blind/ SSO shape above.
            rest = p[len('/routeblind'):]
            if rest.startswith('/dist/'):
                if rest == '/dist/real.bin':
                    self._send(200, 'application/octet-stream', b'REALBYTES')
                else:
                    self._send(404, 'text/html; charset=utf-8', b'not found')
            else:
                # root route: blind -- 200 for EVERYTHING, including a path that cannot exist.
                self._send(200, 'text/plain; charset=utf-8', b'catch-all root body')
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
SSONOLOC="http://127.0.0.1:$PORT/ssonoloc"
SSO301="http://127.0.0.1:$PORT/sso301"
SSO308="http://127.0.0.1:$PORT/sso308"
SSOQ="http://127.0.0.1:$PORT/ssoq"
SSOESC2="http://127.0.0.1:$PORT/ssoesc2"
ROUTEBLIND="http://127.0.0.1:$PORT/routeblind"   # #2565: discriminates under /dist, blind at root

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
# 🛑 THE SIX-PHRASE DENYLIST THAT USED TO LIVE HERE IS RETIRED, AND ITS REMOVAL IS THE POINT.
# The whole-refusal-line equality below asserts the message is BYTE-EXACT, so the loop could only
# ever fire on a message that arm had already failed: it was an arm guarding another arm. It also
# emitted no `ok` line and, unlike every other matcher in this file, had no positive control proving
# it could match anything. Kept only as this note, because the phrasings it named are real history:
# "that is the auth-redirect shape", "is an auth", "is a login page", "is an sso", "definitely",
# "which means it is" -- each an assertion about what the target IS, from a function that reads a
# status and a URL and never sees the page.
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
# 🛑 SCOPED TO THE NOTE, THE GUARD MISSED THE HARM IT NAMED. `_note_actual` is everything AFTER
# the " | MECHANISM:" marker, so an overclaim placed BEFORE it is invisible: MEASURED, appending
# "This host is behind an SSO login screen, which is why the status is meaningless." to
# served_verify_host_discriminates' own verdict string, ahead of the substitution, left the suite
# exit 0. That is exactly the harm this file states (the operator told SSO when the cause might be
# routing); only its location changed. So assert the WHOLE refusal line: a fixed head, the probe URL
# in the middle, and a fixed tail that ends with the note. The URL is the only free region, and it
# is pinned to the negative-control shape the lib builds, so no sentence can hide there either.
_verdict_head="served-verify: NEGATIVE CONTROL FAILED -- ${SSO} returned 200 for a path that cannot exist ("
_verdict_tail="). Every 200-based served check is BLIND on this host right now (the #1667 SSO-200-for-everything shape); a 200 no longer means the asset exists.${_note_expected}"
_vok=0
case "$sso_msg" in
  "$_verdict_head"*"$_verdict_tail")
    _vmid=${sso_msg#"$_verdict_head"}
    _vmid=${_vmid%"$_verdict_tail"}
    case "$_vmid" in
      "${SSO}"/dist/__served-verify-negative-control-*-must-404.bin) _vok=1 ;;
    esac
    ;;
esac
if [ "$_vok" -eq 1 ]; then
  pass "the WHOLE refusal line is exactly the shipped text plus the probe URL and the observed status and target; no extra claim can hide anywhere in it"
else
  fail "the refusal line is not the shipped text, so something was added or reworded somewhere in it (verdict, URL or note). If you changed the wording on purpose, update these literals in the SAME commit. Expected head: [$_verdict_head] Expected tail: [$_verdict_tail] Got: [$sso_msg] Note portion seen: [$_note_actual]"
fi

echo "-- kosmos#2566: query VALUES are redacted, query KEYS are kept --"
q_msg=$(served_verify_asset_ok "$SSOQ/dist/real.bin" "an asset behind a redirect carrying a query" 2>&1 >/dev/null)
case "$q_msg" in
  *SECRETNONCEVALUE*) fail "the note printed a secret-shaped query VALUE verbatim. A refusal lands in the deploy log and in a retained agent transcript, so a live nonce would too. Got: $q_msg" ;;
  *SECRETFRAGVALUE*) fail "the note printed a secret-shaped FRAGMENT value verbatim. An implicit-flow #access_token= is the same hazard as a query nonce. Got: $q_msg" ;;
  *) pass "the note prints neither the query value nor the fragment value (a live SSO nonce or token cannot reach the log)" ;;
esac
case "$q_msg" in
  *"#access_token=<redacted>"*) pass "the fragment survives with its KEY intact and its value redacted, rather than being swallowed or printed whole" ;;
  *) fail "the fragment was lost or left unredacted. A value match that runs to the next & eats it when a query precedes it, which is two different answers to 'report what was observed'. Got: $q_msg" ;;
esac
case "$q_msg" in
  *"redirects to"*"/ssologin?url=<redacted>&nonce=<redacted>"*)
    pass "the note keeps the query KEYS and the path, which is the whole discriminating tell, and redacts only the values" ;;
  *) fail "the note lost the query keys or the path. Keys plus host plus path are what separate an auth redirect from a catch-all route; redacting them would blind the diagnostic it exists to give. Got: $q_msg" ;;
esac


m308=$(served_verify_asset_ok "$SSO308/dist/real.bin" "an asset behind a 308" 2>&1 >/dev/null); rc308=$?
check_rc "$rc308" 1 "an asset behind a 308 is caught (the landing page's text/html)"
case "$m308" in
  *"MECHANISM: un-followed, this URL answers 308 and redirects to"*"/ssologin"*)
    pass "the note fires on a 308 too, so its arm is not a 301-or-302 arm" ;;
  *) fail "the note did not name a 308. Two driven codes let a narrowing to 30[12] pass; three do not. Got: $m308" ;;
esac

m301=$(served_verify_asset_ok "$SSO301/dist/real.bin" "an asset behind a 301" 2>&1 >/dev/null); rc301=$?
check_rc "$rc301" 1 "an asset behind a 301 is caught (the landing page's text/html)"
case "$m301" in
  *"MECHANISM: un-followed, this URL answers 301 and redirects to"*"/ssologin"*)
    pass "the note fires on a 301 and names it, so its arm really is 3xx and not 302-only" ;;
  *) fail "the note did not name a 301. Its case arm is written 3?? and its comment claims to cover an http-to-https upgrade and an apex-to-www redirect, both commonly 301. Got: $m301" ;;
esac

noloc_msg=$(served_verify_asset_ok "$SSONOLOC/dist/real.bin" "an asset behind a 302 with no Location" 2>&1 >/dev/null); noloc_rc=$?
check_rc "$noloc_rc" 1 "a 302 carrying NO Location header is caught (not served)"
# The last path in the diagnostic with no fixture. curl reports an EMPTY %{redirect_url} here, and
# the note must say so rather than print "redirects to " with nothing after it.
case "$noloc_msg" in
  *"MECHANISM: un-followed, this URL answers 302 and redirects to (no Location reported)"*)
    pass "the note names a MISSING Location instead of printing an empty target" ;;
  *) fail "the note did not report a missing Location. Got: $noloc_msg" ;;
esac

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
echo "-- #2565: route-aimed control (the route param proves discrimination WHERE the caller trusts) --"
# The sound host also discriminates at the ROOT route (a nonexistent root path 404s), so aiming the
# control at "/" does not false-red a sound host -- the root probe is a real control, not always-red.
served_verify_host_discriminates "$SOUND" "/" >/dev/null 2>&1; rc=$?
check_rc "$rc" 0 "sound host: the ROOT-route control also passes (a nonexistent root path 404s)"
# THE GAP #2565 CLOSES: the route-blind host discriminates under /dist, so the DEFAULT (/dist) control
# passes -- exactly what let deploy-site trust its /setup 200. A control aimed only at /dist cannot see
# a blindness one route over.
served_verify_host_discriminates "$ROUTEBLIND" >/dev/null 2>&1; rc=$?
check_rc "$rc" 0 "#2565: the DEFAULT /dist control PASSES the route-blind host (the gap: /dist is not the route /setup is on)"
# RED-CAPABLE: aiming the control at the ROOT route (where /setup lives) CATCHES the blindness the
# /dist control missed. If this returns 0 the route parameter buys nothing.
served_verify_host_discriminates "$ROUTEBLIND" "/" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "#2565: the ROOT-route control CATCHES the route-scoped blindness the /dist control missed"
# RED-CAPABLE: a route passed WITHOUT a leading slash is normalised to one. `dist` must behave as
# `/dist` -> probes /routeblind/dist/<nonexistent> -> 404 -> rc 0. WITHOUT normalisation the malformed
# `${host}dist/...` (i.e. /routeblinddist/...) falls to the blind root branch -> 200 -> rc 1, so this
# arm fails; it is not vacuous.
served_verify_host_discriminates "$ROUTEBLIND" "dist" >/dev/null 2>&1; rc=$?
check_rc "$rc" 0 "#2565: a leading-slash-less route ('dist') is normalised to '/dist' (not a malformed probe)"

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
# Candidates are deduplicated by RESOLVED PATH, because `sh` and `/bin/sh` are usually the same
# binary under two names and trying it twice reads as two probes.
ESC_SH=""
_esc_seen=""
for _c in dash zsh sh /bin/sh; do
  command -v "$_c" >/dev/null 2>&1 || continue
  _rp=$(command -v "$_c")
  case " $_esc_seen " in *" $_rp "*) continue ;; esac
  _esc_seen="$_esc_seen $_rp"
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
  # 🛑 THE SECOND ESCAPE ARM, ON THE OTHER BRANCH. /ssoesc/ above reaches the NOT-SERVED
  # branch; this one lands on a 200 text/html, which is the only message site that also
  # interpolates a remote byte of its own (the Content-Type). A comment claimed this branch was
  # the covered one while it was the uncovered one.
  esc2_out=$("$ESC_SH" -c '. "$1"/lib/served-verify.sh; served_verify_asset_ok "$2/dist/real.bin" "an asset behind an escaped Location landing on html" 2>&1 >/dev/null' _ "$DIR" "$SSOESC2")
  case "$esc2_out" in
    *TRUNCATEDMARKER2*) pass "under $ESC_SH, the *text/html* branch also prints an escaped Location whole (printf, not echo)" ;;
    *) fail "under $ESC_SH the text/html branch TRUNCATED a server-controlled Location. That branch is the one message site carrying a remote byte outside the note, and it was the site a comment wrongly called covered. Got: $esc2_out" ;;
  esac
  case "$esc2_out" in
    *"content-type is 'text/html"*) pass "CONTROL: the /ssoesc2 arm really reaches the text/html branch, not the NOT-SERVED one (which is what /ssoesc drives)" ;;
    *) fail "CONTROL: /ssoesc2 did not reach the text/html branch, so the arm above is testing the same branch as /ssoesc and proves nothing new. Got: $esc2_out" ;;
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
  # 📌 THIS REDS RATHER THAN SKIPS, DELIBERATELY, AND IT DOES MAKE THE SUITE MACHINE-DEPENDENT.
  # That is the lesser evil: keyed to `dash` by name this arm skipped SILENTLY on any box without
  # it, so the branch's headline fix was likely uncovered exactly where it mattered. A red here is
  # not something an engineer can fix in the code; it means this machine cannot observe the fix, and
  # the suite should say so out loud rather than report green for a claim it never tested.
  fail "no shell here truncates at backslash-c, so the printf-vs-echo arm could not run. It is the only arm covering that fix; do not read this suite as green for it. NOTE FOR WHOEVER SEES THIS RED: it is a statement about THIS MACHINE's shells, not a defect in served-verify.sh, and there is nothing to fix in the code. Install a shell whose echo truncates (dash), or accept that this box cannot observe that fix."
fi

echo "-- deploy-site.sh's WIRING: the control must run before the first 200 is trusted --"
# 🛑 THE CONTROL USED TO RUN ONLY AT THE END OF deploy-site.sh, WHICH MADE IT UNREACHABLE IN THE
# SHAPE THE CARD MEASURED. On a host-wide-blind $HOST the script died far earlier, at
# "latest.json names no artifact" -- a symptom, and the wrong diagnosis. A guard placed after every
# check it would have explained is not a guard, and nothing in the suite could see the ordering,
# because every other arm drives the LIBRARY rather than its caller.
DS="$DIR/deploy-site.sh"
if [ -f "$DS" ]; then
  # 🛑 COMMENT LINES ARE EXCLUDED, THE SAME RULE THE FIXTURE EXTRACTION ABOVE USES AND FOR THE
  # SAME REASON: a comment that happens to quote a call is not a call. These arms grepped raw text
  # while the extraction thirty lines up deliberately strips comments first, which is inconsistent
  # rigor inside one file. It fails NOISY rather than silently green (a comment can only add a
  # spurious hit, not hide a real one), so it was a latent spurious-FAIL rather than a blind spot,
  # and deploy-site.sh has no such comment today: MEASURED, both patterns return nothing when
  # restricted to comment lines. Fixed anyway, because "no such comment today" is a fact with an
  # expiry date and this file's whole subject is guards that quietly stop seeing.
  # The line numbers stay the FILE's, so the ordering comparison below is still about the real file.
  # 📌 AND THE LIMITATION, STATED: `_ds_curl` is a TEXTUAL proxy for execution order. It finds the
  # first non-comment line carrying both `curl` and `$HOST`, so a curl on $HOST reached through a
  # helper whose `curl` and `$HOST` are on different lines (deploy-site.sh's own `fetch()` is
  # exactly that shape) is invisible to it. It is correct today because the first read is inline,
  # and a refactor moving that read into a helper would flip it to a FALSE FAIL rather than a false
  # pass. Named so the next person reads the failure as "the proxy broke", not "the order broke".
  _ds_code=$(/usr/bin/grep -v '^[[:space:]]*#' "$DS")
  if [ "$(printf '%s\n' "$_ds_code" | wc -l)" -ge "$(wc -l < "$DS")" ]; then
    fail "the comment strip removed no lines from deploy-site.sh, so it is a no-op and a comment quoting a call would count as the call"
  fi
  _ds_ctl=$(/usr/bin/grep -n 'served_verify_host_discriminates "\$HOST"' "$DS" | /usr/bin/grep -v '^[0-9]*:[[:space:]]*#' | sed -n '1s/:.*//p')
  _ds_curl=$(/usr/bin/grep -n 'curl' "$DS" | /usr/bin/grep '\$HOST' | /usr/bin/grep -v '^[0-9]*:[[:space:]]*#' | sed -n '1s/:.*//p')
  if [ -z "$_ds_ctl" ] || [ -z "$_ds_curl" ]; then
    fail "could not locate both the negative-control call and the first curl on \$HOST in deploy-site.sh (control line '$_ds_ctl', first curl line '$_ds_curl'); this arm cannot answer the ordering question and must not pass on a search that found nothing"
  elif [ "$_ds_ctl" -lt "$_ds_curl" ]; then
    pass "deploy-site.sh proves the host discriminates (line $_ds_ctl) BEFORE its first curl on \$HOST (line $_ds_curl)"
    # 🛑 ITS OWN PAIR RULE, TURNED INTO A CHECK. deploy-site.sh states that a sidecar-only serve
    # drop breaks new-install verification while the artifact still serves, so "check the pair" --
    # and the Windows zip was checked ALONE for as long as that sentence had been there. A rationale
    # in a comment is not a check, which is this branch's recurring lesson.
    _pairs_missing=""
    for _a in $(printf '%s\n' "$_ds_code" | /usr/bin/grep -oE 'served_verify_asset_ok "\$HOST/dist/[^"]+"' | sed 's/.*dist\///; s/"$//'); do
      case "$_a" in *.sha256) continue ;; esac
      printf '%s\n' "$_ds_code" | /usr/bin/grep -qF "served_verify_asset_ok \"\$HOST/dist/$_a.sha256\"" || _pairs_missing="$_pairs_missing $_a"
    done
    # deploy-site.sh checks its GITIGNORED artifacts by a different mechanism (served_matches, by
    # sha against the local verified copy) inside a loop over $f. The pair rule applies there too,
    # and the arm above could not see it: MEASURED, deleting the `.sha256` line from that loop left
    # the suite green. One mechanism guarded and the other not is the same half-covered shape.
    if ! printf '%s\n' "$_ds_code" | /usr/bin/grep -qF 'served_matches "$f"'; then
      fail "deploy-site.sh no longer has a served_matches loop over \$f, so this arm is checking a mechanism that is gone; it must not pass by finding nothing"
    elif printf '%s\n' "$_ds_code" | /usr/bin/grep -qF 'served_matches "$f.sha256"'; then
      pass "deploy-site.sh's served_matches loop checks the .sha256 sidecar as well as the artifact (the same pair rule, its other mechanism)"
    else
      fail "deploy-site.sh's served_matches loop checks the artifact but not its .sha256 sidecar. Same pair rule as above, other mechanism: a sidecar-only drop breaks new-install verification while the artifact still serves."
    fi
    # 🛑 THE SECOND CONTROL MUST ALSO PRECEDE WHAT IT WOULD EXPLAIN. Moving the pre-deploy one
    # forward fixed half of this: the POST-deploy call still sat at the BOTTOM of the post-deploy
    # block, after served_matches had already compared bytes. If the host goes blind between the two
    # calls (the only reason the second exists), the first refusal was "wrong bytes on the live
    # site" -- a symptom, and the wrong diagnosis, one block over from the bug this branch fixed.
    # The arm above cannot see it: it only compares the FIRST control against the FIRST curl.
    _ctl_n=$(printf '%s\n' "$_ds_code" | /usr/bin/grep -c 'served_verify_host_discriminates "\$HOST"')
    _ctl2=$(/usr/bin/grep -n 'served_verify_host_discriminates "\$HOST"' "$DS" | /usr/bin/grep -v '^[0-9]*:[[:space:]]*#' | sed -n '2s/:.*//p')
    _sm1=$(/usr/bin/grep -n 'served_matches "\$f"' "$DS" | /usr/bin/grep -v '^[0-9]*:[[:space:]]*#' | sed -n '1s/:.*//p')
    if [ "$_ctl_n" -ne 3 ]; then
      fail "deploy-site.sh calls served_verify_host_discriminates $_ctl_n times, expected 3 (pre-flight on /dist, post-deploy on /dist, and post-deploy on the ROOT before /setup is trusted). If you added or removed a call, update this number in the same commit."
    elif [ -z "$_ctl2" ] || [ -z "$_sm1" ]; then
      fail "could not locate the second negative-control call or the first served_matches in deploy-site.sh (control2 '$_ctl2', served_matches '$_sm1'); this arm must not pass on a search that found nothing"
    elif [ "$_ctl2" -lt "$_sm1" ]; then
      pass "the post-deploy negative control (line $_ctl2) runs BEFORE the post-deploy byte comparison (line $_sm1), so a host that went blind after the deploy is diagnosed rather than reported as wrong bytes"
    else
      fail "deploy-site.sh compares served bytes at line $_sm1 but does not re-prove the host discriminates until line $_ctl2. A host that went blind after the deploy refuses with 'wrong bytes on the live site' instead of the mechanism."
    fi
    # 🛑 EXISTENCE, ARITY AND ORDER WERE ALL ASSERTED. WHETHER A FAILING CHECK REFUSES WAS NOT.
    # MEASURED: rewrite every `served_verify_host_discriminates "$HOST" ... || { ...exit 1; }` and
    # every `served_verify_asset_ok "$HOST/..." ... || { ...exit 1; }` into `... || true` and the
    # suite stays green with 0 FAIL. The branch's headline product consequence is that a blind host
    # STOPS THE DEPLOY, and that consequence was guarded by nothing: every wiring arm matched the
    # call as a substring and never looked at what follows `||`. Asymmetric with the byte-exact
    # assertion on the refusal's WORDING one file over, which is pinned to the character.
    _sv_calls=$(printf '%s\n' "$_ds_code" | /usr/bin/grep -E '^[[:space:]]*served_verify_(host_discriminates|asset_ok) "\$HOST')
    _sv_n=$(printf '%s\n' "$_sv_calls" | /usr/bin/grep -c .)
    # The pattern does NOT pin the spacing after `exit 1`: a legitimate `|| { echo ...; exit 1 ; }`
    # would otherwise red this arm, which is the "so tight it reds on a correct edit" defect.
    _sv_guarded=$(printf '%s\n' "$_sv_calls" | /usr/bin/grep -c '|| { .*exit 1')
    if [ "$_sv_n" -lt 8 ]; then
      fail "found only $_sv_n served_verify_* calls on \$HOST in deploy-site.sh, expected at least 8 (3 controls plus 5 assets). This arm must not pass on a search that found nothing."
    elif [ "$_sv_n" -ne "$_sv_guarded" ]; then
      fail "$_sv_n served_verify_* calls on \$HOST but only $_sv_guarded of them refuse: each must be followed by '|| { ... exit 1; }'. A check whose failure is swallowed is not a check, and every other arm here would still pass."
    else
      pass "all $_sv_n served_verify_* calls in deploy-site.sh refuse on failure (not just present, counted and ordered: they actually stop the deploy)"
    fi
    # 🛑 THE ROOT ROUTE MUST BE PROVED BEFORE /setup IS TRUSTED (kosmos#2565). Every control in
    # this script probed /dist, and /setup is at the root, so a host blind only off /dist passed
    # them all and had its /setup 200 believed. The /routeblind/ fixture above drives exactly that
    # shape against the library; this arm checks the CALLER actually asks the question.
    _ctl_root=$(/usr/bin/grep -n 'served_verify_host_discriminates "\$HOST" "/"' "$DS" | /usr/bin/grep -v '^[0-9]*:[[:space:]]*#' | sed -n '1s/:.*//p')
    _setup_ln=$(/usr/bin/grep -n 'served_verify_asset_ok "\$HOST/setup"' "$DS" | /usr/bin/grep -v '^[0-9]*:[[:space:]]*#' | sed -n '1s/:.*//p')
    if [ -z "$_ctl_root" ] || [ -z "$_setup_ln" ]; then
      fail "could not locate both the ROOT-route control and the /setup check in deploy-site.sh (root control '$_ctl_root', /setup '$_setup_ln'); this arm must not pass on a search that found nothing"
    elif [ "$_ctl_root" -lt "$_setup_ln" ]; then
      pass "deploy-site.sh proves the ROOT route discriminates (line $_ctl_root) before trusting the 200 at /setup (line $_setup_ln)"
    else
      fail "deploy-site.sh trusts a 200 at /setup (line $_setup_ln) before proving the root route discriminates (line $_ctl_root). A host blind only off /dist passes every /dist control and is then believed at the root."
    fi
    # 🛑 AND THE SAME PAIR RULE BEFORE THE DEPLOY, NOT ONLY AFTER IT. The win zip's sidecar was
    # checked only post-deploy while all four gitignored pairs were checked in the export first, so
    # a missing one was caught AFTER `vercel deploy --prod` had already run. That is the
    # reports-rather-than-prevents shape this whole card is about, one artifact over.
    # ⚠️ THE FIRST VERSION OF THIS ARM RED ON THE UNMUTATED FILE, and both mutations I aimed at
    # it then "reddened" for that wrong reason, which is exactly how a broken guard reads as a
    # working one. The cause: deploy-site.sh checks its four gitignored sidecars through
    # `for s in <list>; do [ -f "$EXPORT/dist/$s" ]`, so the extraction picked up the LOOP VARIABLE
    # `$s` as if it were an artifact name. A loop variable is not a name; the loop LIST is. Both
    # forms are gathered now, and a control fails if the list form disappears rather than letting
    # four names quietly leave the set.
    _pre_names=$(printf '%s\n' "$_ds_code" | /usr/bin/grep -oE '\[ -f "\$EXPORT/dist/[^"]+"' | sed 's/.*dist\///; s/"$//')
    _pre_loop=$(printf '%s\n' "$_ds_code" | sed -n 's/^for s in \(.*\); do$/\1/p' | tr -d '"')
    if [ -z "$_pre_loop" ]; then
      fail "deploy-site.sh no longer has a 'for s in ...; do' sidecar list in its pre-deploy checks, so four artifact sidecars have left the set this arm can see; it must not pass by finding fewer names"
    fi
    # ⚠️ AND THE SECOND VERSION SEARCHED A HAYSTACK WIDER THAN ITS QUESTION. It asked "does
    # <name>.sha256 appear anywhere in deploy-site.sh", which the POST-deploy served-verify call
    # answers, so removing the PRE-deploy check stayed green: the arm was satisfied by the very
    # check whose lateness it exists to detect. It is pure SET MEMBERSHIP now -- a name is paired
    # only if its sidecar is itself one of the pre-deploy checked names -- so no line outside the
    # region can answer for it.
    _pre_all=$(printf '%s\n%s\n' "$_pre_names" "$_pre_loop" | tr ' ' '\n' | /usr/bin/grep -v '^$' | /usr/bin/grep -vx '\$s' | sort -u)
    # 🛑 SOME ARTIFACTS HAVE NO SIDECAR AND NEVER WILL, so a bare "every artifact must be paired"
    # rule FALSE-REDS on a legitimate hardening with advice about a file that does not exist.
    # MEASURED: adding an honest-marker check for latest.json (tracked, served, sidecar-less) red
    # this arm with "no .sha256 counterpart", sending the next engineer at a nonexistent problem.
    # An exemption list is the mechanism, and it is stated rather than implicit: pointer JSON and
    # the pkg input manifest are content the installer reads, not bytes it verifies by checksum.
    # 📌 AND IT IS INERT TODAY, WHICH IS WORTH SAYING RATHER THAN IMPLYING: deploy-site.sh does not
    # currently honest-marker-check any of these three, so emptying the list changes nothing and a
    # mutation that empties it stays GREEN. It is an escape hatch for the next hardening, not a
    # guard, and it should not be counted as one.
    _sidecarless="latest.json latest-win.json Kosmos.pkg.inputs"
    _export_missing=""
    for _e in $_pre_all; do
      case "$_e" in *.sha256) continue ;; esac
      case " $_sidecarless " in *" $_e "*) continue ;; esac
      printf '%s\n' "$_pre_all" | /usr/bin/grep -qxF "$_e.sha256" || _export_missing="$_export_missing $_e"
    done
    if [ -n "$_export_missing" ]; then
      fail "deploy-site.sh honest-marker-checks these artifacts in the export with no .sha256 counterpart among the pre-deploy checks:$_export_missing. A missing sidecar is then caught only AFTER vercel deploy --prod has run. If one of these legitimately has no sidecar (a pointer JSON, an input manifest), add it to _sidecarless in this file rather than weakening the rule."
    else
      pass "every artifact deploy-site.sh checks in the export has its .sha256 checked before the deploy too"
    fi
    if [ -n "$_pairs_missing" ]; then
      fail "deploy-site.sh checks these served /dist assets with no .sha256 companion:$_pairs_missing. Its own comment says a sidecar-only drop breaks new-install verification while the artifact still serves, so check the pair."
    else
      pass "every served /dist asset deploy-site.sh checks has its .sha256 checked too (the pair rule it states, asserted rather than described)"
    fi
  else
    fail "deploy-site.sh reads \$HOST at line $_ds_curl but does not prove it discriminates until line $_ds_ctl. On a host-wide-blind host the earlier read returns the login page with a 200 and the script refuses with a symptom instead of the mechanism, which is the #1667 failure itself."
  fi
elif [ -f "$DIR/../package.json" ]; then
  # 🛑 A DISCRIMINATING CONDITION, because "the file is missing" passed either way and that
  # silently disarmed SEVEN wiring arms. `$DIR/../package.json` exists only in the repo layout, so
  # in the repo a missing deploy-site.sh is a REAL failure, and only a true standalone copy of the
  # suite takes the stated skip below. `_armsites` cannot notice this: it counts source call sites,
  # not executed ones.
  fail "deploy-site.sh is missing from $DIR but this IS the repo layout ($DIR/../package.json exists), so seven wiring arms just silently did not run. If the file moved, update DS in the same commit."
else
  pass "deploy-site.sh is not beside this test AND this is not the repo layout (no ../package.json), so the wiring arms did not run. STATED, not silently skipped: every other arm drives the library and is unaffected."
fi

echo "-- the lib is #!/bin/sh, and package.json lints it with sh -n --"
# 🛑 ON macOS `sh` IS BASH, SO package.json's `sh -n` CANNOT FAIL ON A BASHISM ON THE ONLY RUNNER
# CI USES. MEASURED on this box: /bin/sh is GNU bash 3.2.57, and `sh -n` exits 0 on a file carrying
# `local`, an array literal and `[[ ]]`, where `dash -n` exits 2. Changing package.json from
# `bash -n` to `sh -n` is still right (it matches the shebang, and it IS a POSIX gate wherever
# /bin/sh is dash), but it is UNARMED on this runner, so the arming lives here, in two parts.
# 🛑 THE FIRST MATCHER FALSE-POSITIVED TWO WAYS AND I FOUND IT BY POINTING IT AT A SECOND FILE.
# `\[\[` matched `[[:space:]]`, a POSIX bracket expression that is perfectly valid sh, and
# `(^|space)local(space)` matched the WORD "local" inside an echo string. Both fire on
# tools/deploy-site.sh, which is clean. A matcher that reds on correct POSIX code is the
# "so tight it reds on a legitimate edit" defect, in the guard written to prevent it. Anchored to
# a statement position now: `local` and an array assignment must START a line, and `[[` must be a
# command (followed by whitespace), which `[[:space:]]` never is.
printf '%s\n' 'f() {' 'local x=1' '}' 'arr=(a b c)' '[[ 1 == 1 ]]' > "$T/bashism.sh"
_bashism_re='^[[:space:]]*local[[:space:]]|^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=\(|(^|[[:space:]])\[\[[[:space:]]'
# PART 1 is machine-independent, so it runs everywhere CI does. Its control comes first: a matcher
# that matches nothing would report a clean lib the same way a real pass does.
if /usr/bin/grep -qE "$_bashism_re" "$T/bashism.sh"; then
  pass "CONTROL: the bashism matcher really matches local, [[ ]] and an array literal"
  _bashy=""
  for _f in "$DIR/lib/served-verify.sh" "$DIR/deploy-site.sh"; do
    [ -f "$_f" ] || continue
    /usr/bin/grep -qE "$_bashism_re" "$_f" && _bashy="$_bashy $(basename "$_f")"
  done
  if [ -n "$_bashy" ]; then
    fail "these #!/bin/sh files contain a bashism token:$_bashy. sh -n on macOS is bash and would not have caught it, which is why package.json's sh -n needs this arm beside it."
  else
    pass "no bashism token in served-verify.sh or deploy-site.sh, both #!/bin/sh and both linted with sh -n (matcher proven able to match one)"
  fi
else
  fail "CONTROL: the bashism matcher matches nothing even in a file built to contain three bashisms, so the arm it guards is vacuous"
fi
# PART 2 needs a strict POSIX parser. PROBE for one rather than naming dash, the same trick as
# ESC_SH above: a candidate qualifies only if its own -n REJECTS the bashism file.
STRICT_SH=""
_strict_seen=""
for _c in dash /bin/dash ash /bin/ash; do
  command -v "$_c" >/dev/null 2>&1 || continue
  _rp=$(command -v "$_c")
  case " $_strict_seen " in *" $_rp "*) continue ;; esac
  _strict_seen="$_strict_seen $_rp"
  "$_c" -n "$T/bashism.sh" >/dev/null 2>&1 && continue
  STRICT_SH="$_c"; break
done
if [ -n "$STRICT_SH" ]; then
  pass "found a shell whose -n REJECTS a bash array literal, so a real POSIX parse is checkable here: $STRICT_SH"
  if "$STRICT_SH" -n "$DIR/lib/served-verify.sh" >/dev/null 2>&1; then
    pass "served-verify.sh parses under $STRICT_SH, which is what its #!/bin/sh claims"
  else
    fail "served-verify.sh does NOT parse under $STRICT_SH although its shebang is #!/bin/sh"
  fi
else
  pass "NO strict POSIX parser on this machine, so PART 2 did not run. STATED, not silently skipped: PART 1 above is machine-independent and did run, and package.json's sh -n is bash here."
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
# 🛑 THE LENGTH CHECK IS A PROXY AND IT MISSES A RELOCATED DELIMITER, WHICH THE COMMENT ABOVE
# CALLED CLOSED. MEASURED: move `set -u` to just after the heredoc terminator (behaviourally
# identical) and undocument a handler. $hdr then swallows the whole server source, every token is
# trivially "named", the slice is STILL SHORTER than the file so the -ge check never fires, and the
# suite exits 0 with an undocumented handler. The trailing-space instance really is caught; the
# CLASS was not, and the sentence generalised from the instance. This asserts the property directly.
case "$hdr" in
  *'srv.py" <<'*)
    fail "the header slice contains the server heredoc, so the delimiter has moved and every handler token is trivially named; the naming arm below cannot fail" ;;
esac
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
# 🛑 FIRST MATCH ONLY, WHICH sed CANNOT DO. `sed -n '/a/,/b/p'` RESTARTS: after the real
# heredoc range it looks for the opening address again, finds the literal in the header-slice
# control a few hundred lines below, and prints from there TO EOF because no `^PY$` follows. That
# happened the moment that control was added, and it reds this arm's own terminator check rather
# than passing quietly, which is why the check exists. awk with a `started` flag takes the FIRST
# range and nothing after it, so any later occurrence of the literal is inert.
srv_src=$(awk '/srv\.py" <</ && !started { started = 1; inblk = 1 }
               inblk { print }
               inblk && /^PY$/ { inblk = 0 }' "$0")
# 🛑 BOUNDING TO THE HEREDOC MOVED THE HOLE, IT DID NOT CLOSE IT: the heredoc is itself the file's
# densest comment region, about ten blocks of it. MEASURED on a copy: rewrite the real dispatch
# `if p.startswith('/blind/'):` into `if p[:7] == '/blind/':` and add ONE comment line INSIDE the
# heredoc quoting the old form, and the count stayed 9, the naming arm passed and the suite exited
# 0 with /blind/ no longer extracted -- byte for byte the regression this guard exists to catch, one
# layer in. Two changes close it, and THE ANCHOR IS THE LOAD-BEARING ONE: the pattern now matches
# only a DISPATCH STATEMENT (`if`/`elif` on `p` or `rest`, at the start of a line), which a comment
# cannot be. Stripping comment lines first is belt-and-braces, not the fix.
# 📌 WHOLE-LINE COMMENTS ONLY. A TRAILING comment on a dispatch line
# (`if p == '/a':  # unlike '/b'`) still injects a phantom token. That fails NOISY (the count
# mismatches and names the extra token) rather than hiding a handler, and stripping trailing `#`
# would have to reason about `#` inside a string literal, so it is named rather than done.
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
# 🛑 SPACES AROUND `==` ARE OPTIONAL, AND REQUIRING EXACTLY ONE WAS THE SAME HOLE AGAIN.
# MEASURED, three ways, all with the count still 15 and the suite exit 0: `if p=='/evilnodoc':`
# serving 200 text/html for every path, `elif rest=='/dist/secretpage.bin':` likewise, and
# `if p  ==  '/spacedout':` with two spaces. None of those is one of the exclusions named in the
# header; each is a dispatch statement on p or rest, in a quote style, defeated by whitespace.
srv_paths=$(printf '%s\n' "$srv_code" \
  | /usr/bin/grep -E "^[[:space:]]*(el)?if (p|rest)(\.startswith\(|[[:space:]]*==[[:space:]]*)['\"]/[^'\"]*['\"]" \
  | /usr/bin/grep -oE "['\"]/[^'\"]*['\"]" | tr -d "'\"" | sort -u)
# CONTROL, AND IT IS WHY ONE DISPATCH IN THE FIXTURE IS WRITTEN `p=='/ssonoctpage'`: without a
# spaceless dispatch, nothing exercises the half of the pattern just widened, and a future reformat
# would silently restore the blindness with every arm green. Same shape as the double-quote control.
# CONTROL: a NON-302 3xx fixture must remain, or the note's `3??` arm is only ever driven with a
# 302 and narrowing it to `302` goes unnoticed. MEASURED before /sso301/ existed: that narrowing
# left the suite green.
# 🛑 DISTINCT CODES, NOT "SOME NON-302". The first version of this control only asked that SOME
# non-302 3xx existed, which 301 satisfied, so narrowing the note's arm from `3??` to `30[12]` was
# still invisible. Counting DISTINCT codes is what makes a narrowing to any one code, or any pair,
# red. Three today: 301, 302, 308.
_n3xx=$(printf '%s\n' "$srv_code" | /usr/bin/grep -oE 'send_response\(3[0-9][0-9]\)' | sort -u | /usr/bin/grep -c .)
if [ "$_n3xx" -lt 3 ]; then
  fail "the fixture server drives only $_n3xx distinct 3xx status codes; with fewer than three, narrowing the note's 3?? arm to that one code or that pair is invisible. Add a redirect fixture with a code not already used."
fi
if ! printf '%s\n' "$srv_code" | /usr/bin/grep -qE "^[[:space:]]*(el)?if (p|rest)==['\"]/"; then
  fail "no SPACELESS == dispatch is left in the fixture server, so nothing proves the extraction tolerates missing spaces around ==; an undocumented 'if p==\"/x\":' would be invisible to it again"
fi
# CONTROL, AND IT IS WHY ONE DISPATCH BELOW IS DELIBERATELY DOUBLE-QUOTED: without a double-quoted
# dispatch in the fixture, nothing here exercises the half of the pattern that was just added, and a
# future edit normalising the quotes would silently restore the blindness with every arm still green.
# 🛑 THIS CONTROL WAS TIGHTER THAN THE EXTRACTION IT GUARDS, AND ITS MESSAGE WAS THEN FALSE.
# It required exactly one space around `==` while the extraction accepts any, so rewriting the
# fixture's double-quoted dispatch to `if p=="/ssologin":` (behaviour-identical, still double-quoted,
# still extracted, count unchanged) reds the suite with "no DOUBLE-QUOTED dispatch is left" -- which
# is untrue, and sends the next engineer at a problem that does not exist. A control must not be
# stricter than the thing it controls. Same spacing rule as the extraction now.
if ! printf '%s\n' "$srv_code" | /usr/bin/grep -qE "^[[:space:]]*(el)?if (p|rest)(\.startswith\(|[[:space:]]*==[[:space:]]*)\"/"; then
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
# The floor is the COUNT OF DISPATCH BRANCHES, not a round number, and it is an EQUALITY: a floor
# below the truth is what let the lost /discriminating go unnoticed, which this file has been bitten
# by twice (a `>= 5` here, and a `>= 8` on another branch). 📌 NO SPLIT OF THIS NUMBER IS STATED,
# in prose or here. An earlier version said "ten top-level and five sub-dispatch"; nothing read
# those two numbers, so adding one sub-path and bumping the total would have left both stale -- the
# exact failure this file's opening paragraph disclaims.
if [ "$n_paths" -ne 23 ]; then
  fail "the handler extraction found $n_paths dispatch paths, expected 23: [$(printf '%s' "$srv_paths" | tr '\n' ' ')]. If you added or removed a server behaviour, update the number and add a MANIFEST entry in the same commit; if you did not, the extraction has stopped seeing one (a missing trailing slash did exactly that once, and so did a character class that could not see a digit)"
else
  pass "handler extraction found $n_paths dispatch paths"
  # 🛑 MATCH INSIDE THE DELIMITED MANIFEST ONLY, AND ONLY AT THE START OF AN ENTRY. Asking
  # whether the token appeared anywhere in $hdr let PROSE ABOUT a handler document it: MEASURED,
  # deleting the entire /sso/ manifest entry left the suite green and the arm printed "derived, not
  # counted in prose", because both tokens survive in a later paragraph. That is the same defect
  # this file closed on the server-source side by anchoring, still open on the header side.
  man=$(printf '%s\n' "$hdr" | sed -n '/^# --- MANIFEST BEGIN ---$/,/^# --- MANIFEST END ---$/p')
  _man_last=$(printf '%s\n' "$man" | tail -1)
  if [ "$_man_last" != "# --- MANIFEST END ---" ]; then
    fail "the manifest slice does not end at its END sentinel (last line: '$_man_last'). Either a sentinel moved or the opening one is gone, and an unmatched OPENING address makes sed emit NOTHING while an unmatched CLOSING one prints to EOF; both make the naming arm below meaningless."
  elif [ "$(printf '%s\n' "$man" | wc -l)" -ge "$(printf '%s\n' "$hdr" | wc -l)" ]; then
    fail "the manifest slice is the whole header, so matching inside it is no narrower than matching the header; the prose hole is back"
  else
    missing=""
    for _p in $srv_paths; do
      _found=0
      while IFS= read -r _mline; do
        case "$_mline" in
          "#   $_p "*) _found=1; break ;;
        esac
      done <<MANIFEST
$man
MANIFEST
      [ "$_found" -eq 1 ] || missing="$missing $_p"
    done
    # 🛑 BOTH DIRECTIONS. The loop below catches a handler with NO entry; an entry for a handler
    # that no longer EXISTS stayed green, so the manifest could rot in the one direction nobody
    # looks. The equality catches that in one line.
    _man_entries=$(printf '%s\n' "$man" | /usr/bin/grep -c '^#   /')
    if [ "$_man_entries" -ne "$n_paths" ]; then
      fail "the manifest has $_man_entries entries but the dispatch has $n_paths paths. If you removed a handler, remove its entry in the same commit; if you added one, add an entry."
    fi
    if [ -n "$missing" ]; then
      fail "these server handlers have no MANIFEST ENTRY of their own:$missing. Prose mentioning a handler elsewhere in the header no longer counts as documenting it; add one '#   <token>  <one line>' entry inside the MANIFEST block."
    else
      pass "every server handler has its own manifest entry (derived from the dispatch, anchored to the start of an entry line)"
    fi
  fi
fi

# 🛑 A STATIC COUNT OF THE ARMS THEMSELVES, in a file whose entire subject is guards that quietly
# stop seeing. Deleting a whole section of this suite reports PASS: nothing here counted its own
# assertions. This counts pass/fail CALL SITES in the source (machine-independent, unlike a runtime
# tally, because several arms are conditional on which shells exist and on whether deploy-site.sh
# sits beside this file). It cannot tell you an arm became vacuous; it can only tell you one left.
# The number includes this arm's own two call sites. Bump it in the same commit as any arm you add.
# ⚠️ AND IT COUNTED THE WRONG THING TWICE, BOTH FOUND BY MUTATING IT RATHER THAN BY READING IT.
# First it counted only `pass`/`fail` at the start of a line, missing every arm written as
# `check_rc`, which reaches them through a helper: deleting a whole check_rc arm left the count
# unchanged and the suite green, precisely the "a deleted section reports PASS" hole this exists to
# close. Then, with check_rc added, it still missed the trailing `|| fail "..."` form: deleting the
# `set -u` delimiter guard, a real arm, again left the count unchanged. Three forms now, and the
# lesson is the one this whole file is about: a counter counts the shape you pictured, not the arms.
# 🛑 AND A THIRD TIME, THE SAME DEFECT THIS FILE HAS CLOSED TWICE ELSEWHERE: the `|| fail "`
# alternative is UNANCHORED, so A COMMENT CAN SUPPLY IT. MEASURED: delete the real `set -u`
# delimiter arm and add one comment line reading `# ... cmd || fail "something"`, and the count
# stays put with the suite green. The server-source extraction closed this by anchoring to a
# dispatch statement AND stripping comments; the manifest arm closed it by anchoring to the start
# of an entry. This counter did neither, in the one place nobody thought to look: the counter.
_arm_code=$(/usr/bin/grep -v '^[[:space:]]*#' "$0")
if [ "$(printf '%s\n' "$_arm_code" | wc -l)" -ge "$(wc -l < "$0")" ]; then
  fail "the comment strip removed no lines from this file, so a comment mentioning the || fail idiom would be counted as an arm"
fi
_armsites=$(printf '%s\n' "$_arm_code" | /usr/bin/grep -cE '^[[:space:]]*(pass|fail) "|^[[:space:]]*check_rc |\|\| fail "')
if [ "$_armsites" -ne 87 ]; then
  fail "this suite has $_armsites arm call sites (pass/fail/check_rc), expected 87. If you added or removed an arm, update the number in the same commit; if you did not, a section of this file has gone missing and the suite would still have reported PASS."
else
  pass "the suite still has all $_armsites of its arms (a deleted section cannot report PASS)"
fi

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-served-verify: PASS -- served-verify.sh discriminates a sound host, catches the #1667 blind host, and rejects a 200 wearing text/html; the positive arms pass. Red-capability proven."
  exit 0
fi
echo "test-served-verify: $fails FAILED"
exit 1
