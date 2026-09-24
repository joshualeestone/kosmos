#!/usr/bin/env bash
# test-served-verify-head-3073.sh
#
# #3073 part 4: served_verify_asset_ok is HEAD-first. It checks only STATUS + CONTENT-TYPE
# (the asset's byte integrity is verified separately, locally, against its manifest/.sha256),
# so it answers from a HEAD response's headers and does NOT transfer the body -- the point of
# the change is to stop pulling the multi-hundred-MB Windows zip in full just to read a status
# line. It TRUSTS the HEAD only on an unambiguous success (200 + non-empty, non-html
# content-type); on anything else it falls through to the existing GET path, so it is never
# weaker than the full GET it replaces.
#
# This file is DELIBERATELY separate from tools/test-served-verify.sh: that suite's frozen
# fixture server (do_GET only) and its handler-extraction meta-guards must not be perturbed.
# It stays green under this change because a HEAD to its mock hits no do_HEAD, returns 501, and
# falls through to GET -- the existing behavior. THIS file covers the NEW fast path with its
# own HEAD-aware mock and, crucially, proves the body is not fetched on the fast path by
# logging the request method the server actually saw.
set -u

FAILED=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

DIR=$(cd "$(dirname "$0")" && pwd)
LIB="$DIR/lib/served-verify.sh"
[ -f "$LIB" ] || { echo "FAIL  cannot find $LIB"; exit 1; }
# shellcheck source=/dev/null
. "$LIB"
command -v served_verify_asset_ok >/dev/null 2>&1 || { echo "FAIL  served_verify_asset_ok not defined after sourcing $LIB"; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/svhead.XXXXXX")
LOG="$WORK/requests.log"
: > "$LOG"
cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# A HEAD-aware mock. It records EVERY request as "<METHOD> <path>" so a test can prove the
# fast path issued a HEAD and NO GET. Paths, by design:
#   /good.zip  HEAD -> 200 application/zip (no body)   GET -> 200 application/zip + body
#   /htmlhead  HEAD -> 200 text/html                   GET -> 200 text/html + body   (#1667)
#   /nohead    HEAD -> 405 (HEAD unsupported)          GET -> 200 application/zip + body (fallback)
#   /emptyct   HEAD -> 200 with NO content-type        GET -> 200 application/zip + body (fallback)
cat > "$WORK/srv.py" <<PY
import http.server

LOG = r"""$LOG"""

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _record(self):
        with open(LOG, "a") as f:
            f.write(self.command + " " + self.path + "\n")

    def do_HEAD(self):
        self._record()
        if self.path == "/good.zip":
            self.send_response(200); self.send_header("Content-Type", "application/zip"); self.end_headers()
        elif self.path == "/htmlhead":
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
        elif self.path == "/nohead":
            self.send_response(405); self.end_headers()
        elif self.path == "/emptyct":
            self.send_response(200); self.end_headers()
        elif self.path == "/redir":
            self.send_response(302); self.send_header("Location", "/good2.zip"); self.end_headers()
        elif self.path == "/good2.zip":
            self.send_response(200); self.send_header("Content-Type", "application/zip"); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

    def do_GET(self):
        self._record()
        if self.path == "/redir":
            self.send_response(302); self.send_header("Location", "/good2.zip"); self.end_headers()
            return
        if self.path in ("/good.zip", "/good2.zip", "/nohead", "/emptyct"):
            self.send_response(200); self.send_header("Content-Type", "application/zip"); self.end_headers()
            self.wfile.write(b"PK\x03\x04payload-bytes")
        elif self.path == "/htmlhead":
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
            self.wfile.write(b"<html>login</html>")
        else:
            self.send_response(404); self.end_headers()

srv = http.server.HTTPServer(("127.0.0.1", 0), H)
print("PORT %d" % srv.server_address[1], flush=True)
srv.serve_forever()
PY

python3 -u "$WORK/srv.py" > "$WORK/srv.out" 2>&1 &
SRV_PID=$!
disown "$SRV_PID" 2>/dev/null || true   # keep bash's job control from printing "Terminated" when the EXIT trap kills it
PORT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  PORT=$(sed -n 's/^PORT //p' "$WORK/srv.out" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  sleep 0.3
done
[ -n "$PORT" ] || { echo "FAIL  mock server did not start: $(cat "$WORK/srv.out" 2>/dev/null)"; exit 1; }
HOST="http://127.0.0.1:$PORT"
pass "mock HEAD-aware server listening on $HOST"

# requests logged for a path, as "<METHOD> <path>" lines
methods_for() { /usr/bin/grep -E " $1\$" "$LOG" 2>/dev/null | sed 's/ .*//'; }

# CONTROL: the GET path for /good.zip actually serves a body, so "no GET happened" below is a
# real saving (the fast path SKIPPED a working GET), not an artifact of a broken GET route.
_ctl_body=$(curl -sS --max-time 5 "$HOST/good.zip" 2>/dev/null)
case "$_ctl_body" in
  PK*) pass "CONTROL: a direct GET /good.zip serves a real body ($(printf '%s' "$_ctl_body" | wc -c | tr -d ' ') bytes), so skipping it on the fast path is a genuine saving" ;;
  *)   fail "CONTROL: a direct GET /good.zip did not serve the expected body (got '${_ctl_body}'); the no-GET assertion below would be vacuous" ;;
esac
: > "$LOG"   # reset the log so the control's GET does not pollute the fast-path assertions

# 1) FAST PATH: a clean HEAD (200 + non-html content-type) returns 0 WITHOUT a GET.
if served_verify_asset_ok "$HOST/good.zip" "the good zip" >/dev/null 2>&1; then
  pass "fast path: served_verify_asset_ok returns 0 on a HEAD 200 + application/zip"
else
  fail "fast path: served_verify_asset_ok did NOT return 0 for a HEAD 200 + application/zip"
fi
_gm=$(methods_for /good.zip | tr '\n' ',' | sed 's/,$//')
case ",$_gm," in
  *,HEAD,*|,HEAD,) : ;;
  *) fail "fast path: expected a HEAD to /good.zip, saw methods '[$_gm]'" ;;
esac
if printf '%s\n' "$(methods_for /good.zip)" | /usr/bin/grep -qx GET; then
  fail "fast path: a GET reached /good.zip -- the body was transferred; the HEAD short-circuit did not fire (methods '[$_gm]')"
else
  pass "fast path: HEAD only, NO GET reached /good.zip -- the body was not transferred (methods '[$_gm]')"
fi

# 1b) FAST PATH THROUGH A REDIRECT: `curl -sSLI -L` follows a 302 with HEAD (verified: it does NOT
#     switch to GET on the redirect), so a HEAD that 302s to a clean 200 + non-html asset still
#     resolves without transferring a body. asset_ok returns 0 and no GET reaches the final asset.
: > "$LOG"
if served_verify_asset_ok "$HOST/redir" "an asset behind a HEAD 302" >/dev/null 2>&1; then
  pass "fast path via redirect: returns 0 when a HEAD 302s to a 200 + application/zip"
else
  fail "fast path via redirect: expected rc=0 when a HEAD 302s to a 200 + application/zip"
fi
if printf '%s\n' "$(methods_for /good2.zip)" | /usr/bin/grep -qx HEAD; then
  pass "fast path via redirect: the HEAD followed the 302 to the target /good2.zip"
else
  fail "fast path via redirect: no HEAD reached the redirect target /good2.zip (methods '[$(methods_for /good2.zip | tr '\n' ',' | sed 's/,$//')]')"
fi
if printf '%s\n' "$(methods_for /good2.zip)" | /usr/bin/grep -qx GET; then
  fail "fast path via redirect: a GET reached /good2.zip -- the body was transferred despite a clean HEAD across the 302"
else
  pass "fast path via redirect: HEAD only across the 302, NO GET reached /good2.zip -- no body transfer"
fi

# 2) HTML wearing 200 on HEAD: must still be caught (#1667). It falls through to GET, whose
#    error path owns the message; the verdict must be a refusal (rc 1).
: > "$LOG"
served_verify_asset_ok "$HOST/htmlhead" "an html page wearing 200" >/dev/null 2>&1; _rc_html=$?
if [ "$_rc_html" = "1" ]; then
  pass "html-on-HEAD: a 200 carrying text/html is still refused (rc=1, #1667 preserved)"
else
  fail "html-on-HEAD: expected rc=1 for a 200 text/html, got rc=$_rc_html"
fi
if printf '%s\n' "$(methods_for /htmlhead)" | /usr/bin/grep -qx GET; then
  pass "html-on-HEAD: fell through to a GET (the #1667 branch and its message stay on the GET path)"
else
  fail "html-on-HEAD: no GET reached /htmlhead, so the fall-through did not happen (methods '[$(methods_for /htmlhead | tr '\n' ',' | sed 's/,$//')]')"
fi

# 3) FALLBACK, HEAD unsupported (405): falls through to GET and passes on the 200 zip.
: > "$LOG"
if served_verify_asset_ok "$HOST/nohead" "an asset whose server 405s a HEAD" >/dev/null 2>&1; then
  pass "fallback (405 HEAD): falls through to GET and returns 0 on the 200 zip"
else
  fail "fallback (405 HEAD): expected rc=0 via the GET fallback"
fi
if printf '%s\n' "$(methods_for /nohead)" | /usr/bin/grep -qx GET; then
  pass "fallback (405 HEAD): a GET actually ran (the fallback is not vacuous)"
else
  fail "fallback (405 HEAD): no GET ran, so the 405 result was trusted instead of falling through"
fi

# 4) FALLBACK, HEAD 200 but NO content-type: an empty content-type is ambiguous, so it must
#    fall through to GET (which here serves a real content-type) rather than be trusted.
: > "$LOG"
if served_verify_asset_ok "$HOST/emptyct" "an asset whose HEAD omits content-type" >/dev/null 2>&1; then
  pass "fallback (empty CT on HEAD): falls through to GET and returns 0"
else
  fail "fallback (empty CT on HEAD): expected rc=0 via the GET fallback"
fi
if printf '%s\n' "$(methods_for /emptyct)" | /usr/bin/grep -qx GET; then
  pass "fallback (empty CT on HEAD): a GET actually ran (an empty HEAD content-type is not trusted)"
else
  fail "fallback (empty CT on HEAD): no GET ran, so an empty HEAD content-type was wrongly trusted"
fi

if [ "$FAILED" = 0 ]; then
  echo "test-served-verify-head-3073: PASS -- HEAD-first fast path skips the body on a clean 200+non-html HEAD, and falls through to GET on html/405/empty-CT so it is never weaker than the full GET."
  exit 0
else
  echo "test-served-verify-head-3073: FAIL"
  exit 1
fi
