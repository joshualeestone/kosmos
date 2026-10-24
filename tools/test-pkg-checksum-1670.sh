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
# #3578: prefer the system /usr/bin/python3 (what CI has always used), but fall back to python3 on
# PATH when that shim cannot run -- on a Mac whose Xcode license is unaccepted it exits 69 on every call.
PY3=/usr/bin/python3; "$PY3" -c '' >/dev/null 2>&1 || PY3=python3
"$PY3" -c '' >/dev/null 2>&1 || { echo "FAIL  no runnable python3: /usr/bin/python3 and python3 on PATH both failed to start (the /usr/bin shim exits 69 until the Xcode license is accepted, #3578)"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
export KOSMOS_UPDATE_PAUSE_URL=http://127.0.0.1:9/v1/meta   # kosmos#6620: run-setup here must not ask the real coordinator
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-pkg-checksum-1670.XXXXXXXXXX")"; trap 'rm -rf "$T"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# --- lift the verification out of the shipped postinstall -------------------
INNER="$T/inner.sh"
"$PY3" - "$REPO/install/pkg-scripts/postinstall" "$INNER" <<'PY'
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
# The fake installer also records the directory it was run from (#4319), so an arm can check the
# verify directory is gone afterwards. macOS mktemp -d ignores TMPDIR, so the path cannot be predicted.
printf '#!/bin/sh\ntouch "%s/RAN"\nprintf x >> "%s/RANS"\ndirname "$0" > "%s/DIR"\n' "$T" "$T" "$T" > "$WWW/setup"
GOOD=$(/usr/bin/shasum -a 256 "$WWW/setup" | /usr/bin/awk '{print $1}')
cd "$WWW" || exit 1
"$PY3" -u -m http.server 0 -b 127.0.0.1 >"$T/srv.log" 2>&1 &
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
#
# RETRY BUDGET FOR THE TEST. The shipped default is 5 attempts / 3s pause; we drive
# it fast here (no pause, few attempts) via the env knobs the postinstall reads.
# These reach the lifted script because run_arm inherits this shell's environment;
# in a REAL install `sudo -u -H` strips them, so production keeps the 5/3 default.
# The refuse arms below therefore complete instantly instead of waiting ~12s each.
export KOSMOS_PKG_RETRY_SLEEP=0 KOSMOS_PKG_RETRY_MAX=4
# #6474: HOME is sandboxed. The lifted block hands off to an INSTALLED Kosmos at $HOME/.local/share/kosmos when it has
# a verifier, so the real HOME would make these arms depend on (and run against) this Mac's own install.
# #6507: for the WHOLE test, not only run_arm. ARM 4 and CONTROL #4319 ran the block directly with the real HOME, so on a
# Mac whose own install had the verifier (Mortals at 0.7.57) they took the hand-off and went red; a Mac on an older
# install passed. Exported here, every arm, present and future, starts in the empty sandbox; run_arm still points an arm
# at its own fake install through ARM_HOME.
mkdir -p "$T/nohome"
export HOME="$T/nohome"
run_arm() { rm -f "$T/RAN" "$T/RANS" "$T/DIR"; HOME="${ARM_HOME:-$T/nohome}" /bin/sh -c "$(cat "$INNER")" "$URL" 0 2>&1; }
# #4319: the verify directory the installer ran from must be gone once the run ends.
verify_dir_gone() {
  _vd=$(cat "$T/DIR" 2>/dev/null)
  if [ -z "$_vd" ]; then fail "$1: the fake installer did not record its directory, so cleanup cannot be checked"
  elif [ -e "$_vd" ]; then fail "$1: the verify directory was left behind: $_vd"; /bin/rm -rf "$_vd"
  else pass "$1: the verify directory is gone afterwards"; fi
}

# --- ARM 1: the checksum matches, so it runs -------------------------------
printf '%s  setup\n' "$GOOD" > "$WWW/setup.sha256"
out=$(run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ -f "$T/RAN" ]; then pass "a matching checksum runs the installer"
else fail "a matching checksum must run the installer (rc=$rc): $out"; fi
verify_dir_gone "ARM 1"

# --- ARM 1b (#4319): an installer that FAILS keeps its exit code, and still leaves nothing -----
cp "$WWW/setup" "$T/setup.good"
printf '#!/bin/sh\ndirname "$0" > "%s/DIR"\nexit 7\n' "$T" > "$WWW/setup"
printf '%s  setup\n' "$(/usr/bin/shasum -a 256 "$WWW/setup" | /usr/bin/awk '{print $1}')" > "$WWW/setup.sha256"
out=$(run_arm); rc=$?
if [ "$rc" -eq 7 ]; then pass "a failing installer's exit code (7) comes back unchanged"
else fail "a failing installer's exit code must come back unchanged (rc=$rc, want 7): $out"; fi
verify_dir_gone "ARM 1b"
cp "$T/setup.good" "$WWW/setup"

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
if has "$out" "could not download the installer or its published checksum"; then pass "and says it could not DOWNLOAD/check, a different sentence from a mismatch"; else fail "and distinguishes the two causes: $out"; fi
if has "$out" "safe to try again"; then pass "and this one IS safe to retry, so it says so"; else fail "and says a retry is safe here: $out"; fi

# --- ARMS 5 (#6474): an EXISTING install holds the installer to its signed release ----------------
# A fake installed home whose verifier pins a throwaway key, and the origin serving dist/latest.json plus the version's
# manifest and .sig. The checksum gate above still runs first (both arms here have a matching .sha256).
printf '%s  setup\n' "$GOOD" > "$WWW/setup.sha256"
IH="$T/ihome"; K="$IH/.local/share/kosmos"; mkdir -p "$K/app/engine" "$K/runtime/bin" "$WWW/dist"
ln -sf "$(command -v node)" "$K/runtime/bin/node"
printf '{"version":"1.2.0"}\n' > "$K/app/package.json"
node -e '
const c = require("crypto"), fs = require("fs");
const [repo, k, www, setup] = process.argv.slice(1);
const { privateKey, publicKey } = c.generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const src = fs.readFileSync(repo + "/engine/manifest-verify.js", "utf8");
const out = src.replace(/const KEYS = \[[\s\S]*?\];/, "const KEYS = [" + JSON.stringify(pub) + "];");
if (out === src) process.exit(4);
// Every hand-off call is recorded, and the first FAIL96 calls answer 96 (a failed download), so the retry can be seen.
const tap = "const __t = require(\"fs\"); __t.appendFileSync(" + JSON.stringify(k + "/../HANDOFF") + ", \"x\"); "
  + "{ const f = " + JSON.stringify(k + "/../FAIL96") + "; let n = 0; try { n = +__t.readFileSync(f, \"utf8\"); } catch {} "
  + "if (n > 0) { __t.writeFileSync(f, String(n - 1)); process.stderr.write(\"Kosmos: the signed manifest could not be downloaded, so the installer was not run.\\n\"); process.exit(96); } }\n";
fs.writeFileSync(k + "/app/engine/manifest-verify.js", tap + out);
const sign = (sha) => {
  const m = www + "/dist/kosmos-1.2.3-arm64.manifest.json";
  fs.writeFileSync(m, JSON.stringify({ manifest: 1, version: "1.2.3", arch: "arm64", setup_sha256: sha, files: [] }) + "\n");
  fs.writeFileSync(m + ".sig", c.sign(null, fs.readFileSync(m), privateKey).toString("base64") + "\n");
};
fs.writeFileSync(k + "/../signer.pem", privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
fs.writeFileSync(www + "/dist/latest.json", JSON.stringify({ version: "1.2.3" }) + "\n");
sign(c.createHash("sha256").update(fs.readFileSync(setup)).digest("hex"));
' "$REPO" "$K" "$WWW" "$WWW/setup" || { fail "ARMS 5: could not build the fake signed install"; }
HO="$IH/.local/share/HANDOFF"; F96="$IH/.local/share/FAIL96"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$T/RANS" 2>/dev/null)" = x ] && [ "$(cat "$HO" 2>/dev/null)" = x ]; then pass "ARM 5a (installer ran exactly once): an existing install checks the installer against its signed release (the hand-off ran once), then runs it"
else fail "ARM 5a: the signed, matching installer must run THROUGH the installed copy (rc=$rc, hand-off calls=$(cat "$HO" 2>/dev/null)): $out"; fi
# ARM 5d: a 96 (a download that failed) is retried, and the second try runs it.
rm -f "$HO"; printf 1 > "$F96"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$T/RANS" 2>/dev/null)" = x ] && [ "$(cat "$HO" 2>/dev/null)" = xx ]; then pass "ARM 5d (installer ran exactly once): a failed download (96) is retried, and the retry runs it"
else fail "ARM 5d: a 96 must be retried (rc=$rc, hand-off calls=$(cat "$HO" 2>/dev/null)): $out"; fi
# ARM 5g: a 96 that never clears ends after the retry budget with the safe-to-retry sentence, and nothing ran.
rm -f "$HO"; printf 99 > "$F96"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 96 ] && [ ! -f "$T/RAN" ] && [ "$(cat "$HO" 2>/dev/null)" = "$(printf %${KOSMOS_PKG_RETRY_MAX}s | tr " " x)" ] && has "$out" "safe to try again"; then pass "ARM 5g: a download that keeps failing stops after the retry budget, says a retry is safe, runs nothing"
else fail "ARM 5g: a persistent 96 (rc=$rc, hand-off calls=$(cat "$HO" 2>/dev/null)): $out"; fi
rm -f "$F96"
# ARM 5h: an unreadable pointer (latest.json missing) is a failed download (96, retried), never a refusal (97).
mv "$WWW/dist/latest.json" "$WWW/dist/latest.json.away"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 96 ] && [ ! -f "$T/RAN" ] && [ ! -e "$HO" ] && has "$out" "safe to try again"; then pass "ARM 5h: an unreadable pointer is retried as a failed download and ends safe-to-retry, nothing run"
else fail "ARM 5h: an unreadable pointer must be a 96 (rc=$rc, hand-off=$([ -e "$HO" ] && echo yes || echo no)): $out"; fi
mv "$WWW/dist/latest.json.away" "$WWW/dist/latest.json"
# Re-sign (with the same pinned key) a manifest naming OTHER installer bytes: the published checksum still matches,
# the signature is good, and only the signed installer hash differs.
node -e '
const fs = require("fs"); const m = process.argv[1] + "/dist/kosmos-1.2.3-arm64.manifest.json";
const j = JSON.parse(fs.readFileSync(m, "utf8")); j.setup_sha256 = "f".repeat(64); fs.writeFileSync(m, JSON.stringify(j) + "\n");
const c = require("crypto");
fs.writeFileSync(m + ".sig", c.sign(null, fs.readFileSync(m), c.createPrivateKey(fs.readFileSync(process.argv[2]))).toString("base64") + "\n");
' "$WWW" "$IH/.local/share/signer.pem"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 97 ] && [ ! -f "$T/RAN" ] && has "$out" "this Mac already has Kosmos, and its own check refused this installer"; then pass "ARM 5b (exit 97, the .pkg sentence): an installer the signed release does not name is NOT run, though its checksum matches"
else fail "ARM 5b: a mismatch with the signed release must refuse and not run (rc=$rc, ran=$([ -f "$T/RAN" ] && echo yes || echo no)): $out"; fi
if has "$out" "does not match its signed release, so the installer was not run"; then pass "ARM 5b: and says the installer does not match its signed release"; else fail "ARM 5b: and says why: $out"; fi
if [ "$(cat "$HO" 2>/dev/null)" = x ]; then pass "ARM 5b: a refusal (97) is not retried (the hand-off ran exactly once)"; else fail "ARM 5b: a refusal must run the hand-off once and not again (calls=$(cat "$HO" 2>/dev/null))"; fi
# ARM 5e: an installed node that will not RUN (a broken install being repaired) keeps the checksum path.
mv "$K/runtime/bin/node" "$K/runtime/bin/node.real"; printf '#!/bin/sh\nexit 1\n' > "$K/runtime/bin/node"; chmod +x "$K/runtime/bin/node"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ -f "$T/RAN" ] && [ ! -e "$HO" ]; then pass "ARM 5e: a broken installed node keeps the checksum path, so the .pkg still repairs it"
else fail "ARM 5e: a node that will not run must keep the checksum path (rc=$rc, hand-off=$([ -e "$HO" ] && echo yes || echo no)): $out"; fi
rm -f "$K/runtime/bin/node"; mv "$K/runtime/bin/node.real" "$K/runtime/bin/node"
# ARM 5i (review 4): a HALF-WRITTEN package.json that a pattern would pass, and a TRUNCATED verifier that still names
# run-setup, both keep the checksum path (the installed node parses the one and syntax-checks the other).
mv "$K/app/package.json" "$K/app/package.json.real"; printf '{"name":"kosmos","version":"1.2.0",' > "$K/app/package.json"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$T/RANS" 2>/dev/null)" = x ] && [ ! -e "$HO" ]; then pass "ARM 5i: a half-written package.json keeps the checksum path"
else fail "ARM 5i: a half-written package.json must keep the checksum path (rc=$rc): $out"; fi
mv "$K/app/package.json.real" "$K/app/package.json"
cp "$K/app/engine/manifest-verify.js" "$T/mv.real"; head -c 4000 "$T/mv.real" > "$K/app/engine/manifest-verify.js"; printf '\n// run-setup\nfunction (' >> "$K/app/engine/manifest-verify.js"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$T/RANS" 2>/dev/null)" = x ] && [ ! -e "$HO" ]; then pass "ARM 5j: a truncated verifier keeps the checksum path"
else fail "ARM 5j: a truncated verifier must keep the checksum path (rc=$rc): $out"; fi
cp "$T/mv.real" "$K/app/engine/manifest-verify.js"
# ARM 5k (review 5): valid JSON whose version is not x.y.z keeps the checksum path (the regex, not only the parse).
mv "$K/app/package.json" "$K/app/package.json.real"; printf '{"name":"kosmos","version":"1.2"}\n' > "$K/app/package.json"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$T/RANS" 2>/dev/null)" = x ] && [ ! -e "$HO" ]; then pass "ARM 5k: a version that is not x.y.z keeps the checksum path"
else fail "ARM 5k: a non x.y.z version must keep the checksum path (rc=$rc): $out"; fi
mv "$K/app/package.json.real" "$K/app/package.json"
# ARM 5f: an installed version that will not READ keeps the checksum path too.
mv "$K/app/package.json" "$K/app/package.json.real"; printf '{\n' > "$K/app/package.json"
rm -f "$HO"; out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ -f "$T/RAN" ] && [ ! -e "$HO" ]; then pass "ARM 5f: an unreadable installed version keeps the checksum path"
else fail "ARM 5f: an unreadable package.json must keep the checksum path (rc=$rc): $out"; fi
mv "$K/app/package.json.real" "$K/app/package.json"
# CONTROL: the same broken manifest, but the install has no verifier: the checksum path runs as before.
rm -f "$K/app/engine/manifest-verify.js"
out=$(ARM_HOME="$IH" run_arm); rc=$?
if [ "$rc" -eq 0 ] && [ -f "$T/RAN" ]; then pass "ARM 5c CONTROL: with no installed verifier the checksum path runs, so 5b refused on the signed check"
else fail "ARM 5c: with no verifier the checksum path must run (rc=$rc): $out"; fi
rm -rf "$IH" "$WWW/dist"

# --- ARM 4: a TRANSIENT mismatch (half-published window) then a MATCH RUNS --
# The 2026-09-15 hardening: a single-shot check turned a transient CDN/half-publish
# window into a hard "installation failed". The bounded retry must RECOVER when the
# window closes. We prove it deterministically (not on a wall-clock race): a tiny
# origin serves the WRONG setup.sha256 on the first request and the CORRECT one on
# every request after, so attempt 1 mismatches and attempt 2 matches and runs.
kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""
CNT="$T/sha_hits"; : > "$CNT"
# bind + report the port, then serve (wrong sha on the 1st fetch, right after)
FLIPLOG="$T/flip.log"
"$PY3" - "$GOOD" "$CNT" "$WWW" "$FLIPLOG" <<'PY' &
import http.server, sys
GOOD, CNT, ROOT, LOG = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
BAD = "0"*64
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/setup":
            body = open(ROOT+"/setup","rb").read()
        elif self.path == "/setup.sha256":
            with open(CNT) as f: hits = len(f.read())
            open(CNT,"a").write("x")
            body = ((BAD if hits == 0 else GOOD)+"  setup\n").encode()
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Length",str(len(body))); self.end_headers()
        self.wfile.write(body)
srv = http.server.HTTPServer(("127.0.0.1",0), H)
open(LOG,"w").write("port %d\n" % srv.server_address[1])
srv.serve_forever()
PY
SRV=$!
FPORT=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  FPORT=$(sed -n 's/.*port \([0-9][0-9]*\).*/\1/p' "$FLIPLOG" 2>/dev/null | head -1)
  [ -n "$FPORT" ] && break
  sleep 0.25
done
if [ -z "$FPORT" ]; then fail "ARM 4 flip-origin did not start"; else
  rm -f "$T/RAN" "$T/DIR"
  out=$(/bin/sh -c "$(cat "$INNER")" "http://127.0.0.1:$FPORT/setup" 0 2>&1); rc=$?
  if [ "$rc" -eq 0 ] && [ -f "$T/RAN" ]; then pass "a TRANSIENT mismatch that then matches RECOVERS and runs (retry works)"
  else fail "a transient-then-matching checksum must recover and run (rc=$rc, ran=$([ -f "$T/RAN" ] && echo yes || echo no)): $out"; fi
  verify_dir_gone "ARM 4"
fi

# --- CONTROL (#4319): with the old exec restored, the verify directory IS left behind -------
# So the three cleanup checks above can fail. The inner script is rewritten here only; the file is untouched.
EXEC_INNER="$T/inner-exec.sh"
/usr/bin/sed 's|^   /bin/sh "\$d/setup"$|   exec /bin/sh "$d/setup"|' "$INNER" > "$EXEC_INNER"
if cmp -s "$INNER" "$EXEC_INNER"; then fail "CONTROL #4319: could not restore exec in the lifted script; re-anchor this control"
elif [ -z "$FPORT" ]; then fail "CONTROL #4319: the ARM 4 origin never started, so this control could not run"
else
  # The ARM 4 origin is still up and, past its first hit, serves the matching checksum.
  rm -f "$T/RAN" "$T/DIR"
  /bin/sh -c "$(cat "$EXEC_INNER")" "http://127.0.0.1:$FPORT/setup" 0 >/dev/null 2>&1
  _vd=$(cat "$T/DIR" 2>/dev/null)
  if [ -n "$_vd" ] && [ -d "$_vd" ]; then pass "CONTROL #4319: with exec the directory is left, so the cleanup checks mean something"; /bin/rm -rf "$_vd"
  else fail "CONTROL #4319: exec left no directory, so the cleanup checks above prove nothing (dir=$_vd)"; fi
fi

# --- CONTROL: the harness can tell a run from a refusal --------------------
kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""
cd "$WWW" || exit 1
"$PY3" -u -m http.server 0 -b 127.0.0.1 >"$T/srv.log" 2>&1 &
SRV=$!
cd "$REPO" || exit 1
PORT=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  PORT=$(sed -n 's/.*port \([0-9][0-9]*\).*/\1/p' "$T/srv.log" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  sleep 0.25
done
URL="http://127.0.0.1:$PORT/setup"
rm -f "$T/RAN"; printf '%s  setup\n' "$GOOD" > "$WWW/setup.sha256"
run_arm >/dev/null 2>&1
if [ -f "$T/RAN" ]; then pass "CONTROL: the harness detects a real run, so the refusals above mean something"
else fail "CONTROL: the harness cannot detect a run; every refusal arm above is vacuous"; fi

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
