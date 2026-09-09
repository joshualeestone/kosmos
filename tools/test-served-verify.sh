#!/usr/bin/env bash
# test-served-verify.sh -- kosmos#1667. Proves tools/lib/served-verify.sh can return the DANGEROUS
# answer, which is the whole point of the card: a check that certifies a green it could never have
# reddened is worthless.
#
# It sources the SAME lib deploy-site.sh sources (not a copy) and drives it against a local server
# with three behaviours:
#   /discriminating/...  a sound host: /dist/real.bin -> 200 octet-stream, /setup -> 200 text/plain,
#                        /dist/htmlpage.bin -> 200 text/html, anything else -> 404.
#   /blind/...           the #1667 SSO shape: EVERY path -> 200 text/html (April's measured failure).
#
# Positive arms confirm the sound host passes; the two RED-CAPABLE arms confirm the blind host and an
# html-200 asset are caught. If either red arm passed, the guard would be an unarmed one.
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

# expect <expected-rc> <label> ; command already run, $? captured by caller into $rc
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
case "$sso_msg" in
  *"MECHANISM: it reached that 200 by REDIRECT"*) pass "the refusal NAMES the redirect mechanism, not just the 200" ;;
  *) fail "the refusal does not name the redirect mechanism; the operator is told the symptom only. Got: $sso_msg" ;;
esac
# CONTROL: the flattened blind host reaches its 200 WITHOUT a redirect, so it must NOT claim one.
blind_msg=$(served_verify_host_discriminates "$BLIND" 2>&1 >/dev/null)
case "$blind_msg" in
  *"MECHANISM: it reached that 200 by REDIRECT"*) fail "the redirect note fired on a host that did NOT redirect, so the note carries no information" ;;
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

served_verify_asset_ok "$SOUND/dist/does-not-exist.bin" "a missing asset" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "a 404 asset is caught (not served)"

# RED-CAPABLE: an asset fetched THROUGH the redirect. curl -L lands on the login page, which is a
# 200 carrying text/html, so the content-type tell must catch it on the real mechanism too.
served_verify_asset_ok "$SSO/dist/real.bin" "an asset behind an SSO redirect" >/dev/null 2>&1; rc=$?
check_rc "$rc" 1 "CATCHES an asset URL that 302s to a login page 200ing text/html (the measured mechanism)"

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-served-verify: PASS -- served-verify.sh discriminates a sound host, catches the #1667 blind host, and rejects a 200 wearing text/html; the positive arms pass. Red-capability proven."
  exit 0
fi
echo "test-served-verify: $fails FAILED"
exit 1
