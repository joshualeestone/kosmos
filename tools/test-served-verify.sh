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
# whose first token is `if` or `elif`, whose subject is the bare name `p` or `rest`, and whose test
# is `.startswith(` or `==` against ONE quoted literal, in either quote style, with any spacing
# around `==`. That is a restriction on the METHOD, and the earlier wording ("if/elif on p or rest")
# implied it was a restriction on the SUBJECT. MEASURED, three handlers each answering 200 text/html
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
  fail "no shell here truncates at backslash-c, so the printf-vs-echo arm could not run. It is the only arm covering that fix; do not read this suite as green for it."
fi

echo "-- the lib is #!/bin/sh, and package.json lints it with sh -n --"
# 🛑 ON macOS `sh` IS BASH, SO package.json's `sh -n` CANNOT FAIL ON A BASHISM ON THE ONLY RUNNER
# CI USES. MEASURED on this box: /bin/sh is GNU bash 3.2.57, and `sh -n` exits 0 on a file carrying
# `local`, an array literal and `[[ ]]`, where `dash -n` exits 2. Changing package.json from
# `bash -n` to `sh -n` is still right (it matches the shebang, and it IS a POSIX gate wherever
# /bin/sh is dash), but it is UNARMED on this runner, so the arming lives here, in two parts.
printf '%s\n' 'f() { local x=1; }' 'arr=(a b c)' '[[ 1 == 1 ]]' > "$T/bashism.sh"
_bashism_re='(^|[[:space:]])local[[:space:]]|\[\[|[A-Za-z_][A-Za-z0-9_]*=\('
# PART 1 is machine-independent, so it runs everywhere CI does. Its control comes first: a matcher
# that matches nothing would report a clean lib the same way a real pass does.
if /usr/bin/grep -qE "$_bashism_re" "$T/bashism.sh"; then
  pass "CONTROL: the bashism matcher really matches local, [[ ]] and an array literal"
  if /usr/bin/grep -qE "$_bashism_re" "$DIR/lib/served-verify.sh"; then
    fail "served-verify.sh declares #!/bin/sh and contains a bashism token; sh -n on macOS is bash and would not have caught it"
  else
    pass "no bashism token in served-verify.sh (matcher proven able to match one)"
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
if [ "$n_paths" -ne 18 ]; then
  fail "the handler extraction found $n_paths dispatch paths, expected 18: [$(printf '%s' "$srv_paths" | tr '\n' ' ')]. If you added or removed a server behaviour, update the number and add a MANIFEST entry in the same commit; if you did not, the extraction has stopped seeing one (a missing trailing slash did exactly that once, and so did a character class that could not see a digit)"
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

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-served-verify: PASS -- served-verify.sh discriminates a sound host, catches the #1667 blind host, and rejects a 200 wearing text/html; the positive arms pass. Red-capability proven."
  exit 0
fi
echo "test-served-verify: $fails FAILED"
exit 1
