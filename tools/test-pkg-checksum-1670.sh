#!/bin/bash
# The pkg install path verifies the installer against its published checksum
# before running it (kosmos#1670), shown in all three states.
#
# ⚠️ WHY THIS RUNS A REAL SERVER AND REAL curl. The verification lives inside a
# single-quoted `sh -c` string in install/pkg-scripts/postinstall, and it calls
# /usr/bin/curl by ABSOLUTE PATH, so it cannot be stubbed by putting a fake curl
# on PATH. Anything short of a real fetch would be testing a rewrite of the code
# rather than the code. The script is extracted verbatim from the postinstall so
# the thing under test is the thing that ships.
#
# 🛑 THE THIRD ARM IS THE ONE PEOPLE WOULD OMIT. A missing .sha256 REFUSES, and
# that is a deliberate decision rather than an oversight: the threat guarded here
# is a MISCONFIGURED origin (a half-published site), not a malicious one, since
# an origin that can serve bad bytes can serve a matching checksum too. A missing
# checksum is a symptom of exactly the half-published state, so proceeding
# without it would make the pkg path no better than `curl | sh`, which is the
# whole argument for the card.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# --- lift the verification out of the shipped postinstall -------------------
INNER="$T/inner.sh"
/usr/bin/python3 - "$REPO/install/pkg-scripts/postinstall" "$INNER" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
m = re.search(r"/bin/sh -c \\\n\s*'(?P<inner>.*?)' \"\$SETUP_URL\"", s, re.S)
if not m:
    sys.stderr.write("could not lift the inner script; postinstall moved, re-anchor this test\n")
    sys.exit(2)
open(out, "w", encoding="utf-8").write(m.group("inner"))
PY
if [ ! -s "$INNER" ]; then echo "FAIL  could not lift the inner script from postinstall"; exit 1; fi
pass "lifted the verification out of the shipped postinstall"

# --- a local origin --------------------------------------------------------
WWW="$T/www"; mkdir -p "$WWW"
printf '#!/bin/sh\ntouch "%s/RAN"\n' "$T" > "$WWW/setup"
GOOD=$(/usr/bin/shasum -a 256 "$WWW/setup" | /usr/bin/awk '{print $1}')
cd "$WWW" || exit 1
/usr/bin/python3 -u -m http.server 0 -b 127.0.0.1 >"$T/srv.log" 2>&1 &
SRV=$!
cd "$REPO" || exit 1
# ⚠️ POLL, DO NOT SLEEP A FIXED SECOND. A fixed sleep is a race that fails on a
# loaded machine and passes on an idle one, which is the worst kind of test.
PORT=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  # ⚠️ `-u` and `-b` above are both load-bearing: without -u python buffers the
  # port line and this poll times out on an empty file; without -b it binds ::
  # and the IPv4 URL below cannot reach it.
  PORT=$(sed -n 's/.*port \([0-9][0-9]*\).*/\1/p' "$T/srv.log" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  sleep 0.25
done
if [ -z "$PORT" ]; then echo "FAIL  local origin did not start: $(cat "$T/srv.log" 2>/dev/null)"; exit 1; fi
pass "local origin listening on $PORT" 
URL="http://127.0.0.1:$PORT/setup"

# 🛑 `sh -c "$script" a b` NOT `sh script a b`. With `sh -c` the FIRST argument
# becomes $0, which is exactly how the postinstall passes $SETUP_URL and how the
# lifted script reads it. Running it as a plain script file makes $0 the FILE
# PATH, so curl gets a path instead of a URL and fails with "No host part in the
# URL". Two refusal arms then PASSED FOR THE WRONG REASON, because the script
# refused on a download failure rather than on the checksum. Only the control
# caught it.
run_arm() { rm -f "$T/RAN"; /bin/sh -c "$(cat "$INNER")" "$URL" 0 2>&1; }

# --- ARM 1: the checksum matches, so it runs -------------------------------
printf '%s  setup\n' "$GOOD" > "$WWW/setup.sha256"
out=$(run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ -f "$T/RAN" ]; then pass "a matching checksum runs the installer"
else fail "a matching checksum must run the installer (rc=$rc): $out"; fi

# --- ARM 2: the checksum does not match, so it refuses ---------------------
printf '%s  setup\n' "0000000000000000000000000000000000000000000000000000000000000000" > "$WWW/setup.sha256"
out=$(run_arm); rc=$?
if [ "$rc" -ne 0 ] && [ ! -f "$T/RAN" ]; then pass "a MISMATCHED checksum refuses and does not run it"
else fail "a mismatched checksum must refuse AND not run (rc=$rc, ran=$([ -f "$T/RAN" ] && echo yes || echo no))"; fi
if has "$out" "did not match its published checksum"; then pass "and says the checksum did not match"; else fail "and says why: $out"; fi
if has "$out" "report this rather than retrying"; then pass "and does NOT tell them to retry, because a mismatch does not fix itself"; else fail "and does not suggest a retry: $out"; fi

# --- ARM 3: no checksum published, so it refuses too -----------------------
rm -f "$WWW/setup.sha256"
out=$(run_arm); rc=$?
if [ "$rc" -ne 0 ] && [ ! -f "$T/RAN" ]; then pass "an ABSENT checksum refuses and does not run it"
else fail "an absent checksum must refuse AND not run (rc=$rc, ran=$([ -f "$T/RAN" ] && echo yes || echo no))"; fi
if has "$out" "could not check the installer"; then pass "and says it could not CHECK, a different sentence from a mismatch"; else fail "and distinguishes the two causes: $out"; fi
if has "$out" "safe to try again"; then pass "and this one IS safe to retry, so it says so"; else fail "and says a retry is safe here: $out"; fi

# --- CONTROL: the harness can tell a run from a refusal --------------------
rm -f "$T/RAN"; printf '%s  setup\n' "$GOOD" > "$WWW/setup.sha256"
run_arm >/dev/null 2>&1
if [ -f "$T/RAN" ]; then pass "CONTROL: the harness detects a real run, so the refusals above mean something"
else fail "CONTROL: the harness cannot detect a run; every refusal arm above is vacuous"; fi

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
