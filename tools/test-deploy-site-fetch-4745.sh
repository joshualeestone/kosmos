#!/usr/bin/env bash
# test-deploy-site-fetch-4745.sh - deploy-site.sh must never fetch onto an artifact's real name (#4745).
#
# On 2026-09-30 a stalled download (curl exit 18) made deploy-site.sh refuse, correctly, but it had
# written over the good dist/kosmos-0.7.11-arm64.tar.gz in place and left a half file there under
# the real name. The fix fetches to a temp beside the target, verifies it against the .sha256
# sidecar, and only then renames it over the real name; a file that already matches is not fetched.
#
# This test EXTRACTS the helper block from tools/deploy-site.sh (between its ">>> site-fetch
# helpers" and "<<< site-fetch helpers" markers) and runs it against a stub `curl` on PATH, in a
# temp dir. It never contacts a real host and never touches a real site checkout.
#
# Arms:
#   a  stub writes HALF the bytes and exits 18   -> refuses, original byte-identical, no temp left
#   b  stub writes full bytes with the WRONG sha -> refuses, original byte-identical, no temp left
#   c  CONTROL: stub writes the right bytes      -> file replaced, sha matches the sidecar
#   d  local file already correct                -> the artifact URL is never requested
#   e  one stalled attempt, then a good one      -> a retry, not a refusal
#   f  the fetch carries a time limit            -> --max-time and --connect-timeout reach curl
#   h  local correct, artifact 404               -> refuses (a served sidecar alone proves nothing)
#   i  local correct, served size differs        -> full fetch, refuses on the sha, never skips
#   j  CONTROL local correct, right served size  -> skips on one ranged probe, no download
#   k  artifact 404, no local file               -> refuses, creates nothing, no temp
#   l  skip path installs the served sidecar
#   m  a 206 with the wrong Content-Range        -> not trusted, full fetch
#   n  a server ignoring Range (200 + body)      -> "cannot prove", full fetch
#   o  same size, different first byte          -> not a proof
#
#   bash tools/test-deploy-site-fetch-4745.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/deploy-site.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/deploy-fetch-4745.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0; npass=0
pass() { printf 'PASS  %s\n' "$*"; npass=$((npass + 1)); }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# ---- extract the helper block; refuse loudly if it is not there (never a vacuous green) --------
BLOCK="$T/fetch-block.sh"
sed -n '/^# >>> site-fetch helpers (#4745)/,/^# <<< site-fetch helpers (#4745)/p' "$DEPLOY" > "$BLOCK"
if grep -q '^fetch_verified() {' "$BLOCK" && grep -q '^fetch() {' "$BLOCK"; then
  pass "extracted the site-fetch helper block from deploy-site.sh ($(wc -l < "$BLOCK" | tr -d ' ') lines)"
else
  bad "could not extract the site-fetch helper block from $DEPLOY (markers moved?)"; exit 1
fi

# ---- stub curl ---------------------------------------------------------------------------------
# Serves $LIVE_DIR/<basename of URL>. Logs every URL and its flags to $CALLS.
# STUB_MODE applies to non-.sha256 URLs only: good | half18 | wrongsha.
# STUB_FAIL_FIRST=N makes the first N artifact requests behave as half18, then good.
# A RANGED request (-r) is the skip path's proof and is logged as "RANGE <url>", so it is never
# counted as a download. It answers from the live file: 404 when absent, else 206 with
# "Content-Range: bytes 0-0/<size>" and the first byte. STUB_PROBE=liar answers 206 with a
# Content-Range for a DIFFERENT size (a status that proves nothing); STUB_PROBE=norange ignores
# Range and answers 200 with the whole body, honouring --max-filesize like curl (exit 63).
BIN="$T/bin"; mkdir -p "$BIN"
cat > "$BIN/curl" <<'CURL'
#!/bin/bash
url=""; dest=""; all="$*"; range=""; hdr=""; wfmt=""; maxfs=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) dest="$2"; shift 2;;
    -r) range="$2"; shift 2;;
    -D) hdr="$2"; shift 2;;
    -w) wfmt="$2"; shift 2;;
    --max-filesize) maxfs="$2"; shift 2;;
    -H|--connect-timeout|--max-time|--speed-limit|--speed-time) shift 2;;
    http://*|https://*) url="$1"; shift;;
    *) shift;;
  esac
done
src="$LIVE_DIR/${url##*/}"
if [ -n "$range" ]; then
  printf 'RANGE %s\t%s\n' "$url" "$all" >> "$CALLS"
  if [ ! -f "$src" ]; then printf 'HTTP/2 404\r\n\r\n' > "$hdr"; : > "$dest"; printf '404'; exit 0; fi
  sz=$(wc -c < "$src" | tr -d ' ')
  case "${STUB_PROBE:-real}" in
    liar)    printf 'HTTP/2 206\r\ncontent-range: bytes 0-0/%s\r\n\r\n' "$((sz + 7))" > "$hdr"; head -c 1 "$src" > "$dest"; printf '206';;
    norange) if [ -n "$maxfs" ] && [ "$sz" -gt "$maxfs" ]; then printf 'HTTP/2 200\r\ncontent-length: %s\r\n\r\n' "$sz" > "$hdr"; exit 63; fi
             printf 'HTTP/2 200\r\n\r\n' > "$hdr"; cp "$src" "$dest"; printf '200';;
    *)       printf 'HTTP/2 206\r\ncontent-range: bytes 0-0/%s\r\n\r\n' "$sz" > "$hdr"; head -c 1 "$src" > "$dest"; printf '206';;
  esac
  exit 0
fi
printf '%s\t%s\n' "$url" "$all" >> "$CALLS"
[ -f "$src" ] || exit 22
mode="${STUB_MODE:-good}"
case "$url" in *.sha256) mode=good;; *)
  if [ "${STUB_FAIL_FIRST:-0}" -gt 0 ]; then
    n=$(grep -v '^RANGE ' "$CALLS" | grep -cv '\.sha256	')
    [ "$n" -le "$STUB_FAIL_FIRST" ] && mode=half18
  fi;;
esac
case "$mode" in
  good)     cp "$src" "$dest"; exit 0;;
  half18)   sz=$(wc -c < "$src" | tr -d ' '); head -c $((sz / 2)) "$src" > "$dest"; exit 18;;
  wrongsha) { cat "$src"; printf 'X'; } > "$dest"; exit 0;;
esac
exit 99
CURL
chmod +x "$BIN/curl"

NAME=kosmos-0.7.11-arm64.tar.gz
HOSTURL=https://fake.test
# scenario: a LIVE dir serving NEW bytes + sidecar, a SITE dist holding OLD bytes + OLD sidecar.
setup() {
  rm -rf "$T/live" "$T/site"; mkdir -p "$T/live" "$T/site/dist"
  head -c 200000 /dev/urandom > "$T/live/$NAME"
  ( cd "$T/live" && shasum -a 256 "$NAME" > "$NAME.sha256" )
  head -c 150000 /dev/urandom > "$T/site/dist/$NAME"
  ( cd "$T/site/dist" && shasum -a 256 "$NAME" > "$NAME.sha256" )
  cp "$T/site/dist/$NAME" "$T/orig"; cp "$T/site/dist/$NAME.sha256" "$T/orig.sha256"
  : > "$T/calls"; rm -rf "$T/tmp"; mkdir -p "$T/tmp"
}
run_fetch() {  # runs fetch_verified in a subshell under /bin/sh with set -eu, like deploy-site.sh; sets OUT RC
  OUT=$(PATH="$BIN:$PATH" CALLS="$T/calls" LIVE_DIR="$T/live" TMPDIR="$T/tmp" \
    sh -c 'set -eu; . "$1"; FETCH_RETRY_DELAY=0; fetch_verified "$2" "$3"' _ \
    "$BLOCK" "$HOSTURL/dist/$NAME" "$T/site/dist/$NAME" 2>&1); RC=$?
}
no_temps() { [ -z "$(find "$T/site/dist" -name '.fetch-*' 2>/dev/null)" ]; }
artifact_calls() { grep -c "^$HOSTURL/dist/$NAME	" "$T/calls"; }   # full downloads only
ranged_calls()   { grep -c "^RANGE $HOSTURL/dist/$NAME	" "$T/calls"; }
no_probe_temps() { [ -z "$(ls -A "$T/tmp" 2>/dev/null)" ]; }
correct_local() { cp "$T/live/$NAME" "$T/site/dist/$NAME"; cp "$T/site/dist/$NAME" "$T/orig"; }

# ---- a: partial transfer, exit 18 ----------------------------------------------------------------
setup; STUB_MODE=half18 run_fetch
[ "$RC" -ne 0 ] && pass "a: a partial fetch (exit 18) refuses (rc=$RC)" || bad "a: a partial fetch did not refuse"
has "$OUT" "could not fetch $HOSTURL/dist/$NAME -- refusing (a missing artifact would drop from the live site)" \
  && pass "a: the original refusal message is kept" || bad "a: refusal message changed: $OUT"
cmp -s "$T/orig" "$T/site/dist/$NAME" && pass "a: the original artifact is byte-identical after the refusal" \
  || bad "a: the original artifact was changed ($(wc -c < "$T/site/dist/$NAME" | tr -d ' ') bytes, was $(wc -c < "$T/orig" | tr -d ' '))"
cmp -s "$T/orig.sha256" "$T/site/dist/$NAME.sha256" && pass "a: the original sidecar is byte-identical (the pair is left whole)" \
  || bad "a: the sidecar was replaced although the artifact was refused"
no_temps && pass "a: no temp file is left in dist/" || bad "a: a temp file was left behind: $(ls -a "$T/site/dist")"
[ "$(artifact_calls)" = 3 ] && pass "a: a stalled fetch is retried (3 attempts)" || bad "a: expected 3 artifact attempts, got $(artifact_calls)"

# ---- b: full bytes, wrong sha ----------------------------------------------------------------------
setup; STUB_MODE=wrongsha run_fetch
[ "$RC" -ne 0 ] && has "$OUT" "sha mismatch" && pass "b: a wrong-sha fetch refuses with a sha mismatch (rc=$RC)" \
  || bad "b: a wrong-sha fetch did not refuse on the sha (rc=$RC): $OUT"
cmp -s "$T/orig" "$T/site/dist/$NAME" && pass "b: the original artifact is byte-identical after the refusal" \
  || bad "b: the original artifact was replaced by unverified bytes"
cmp -s "$T/orig.sha256" "$T/site/dist/$NAME.sha256" && pass "b: the original sidecar is byte-identical" \
  || bad "b: the sidecar was replaced although the artifact was refused"
no_temps && pass "b: no temp file is left in dist/" || bad "b: a temp file was left behind: $(ls -a "$T/site/dist")"

# ---- c: CONTROL, the right bytes -------------------------------------------------------------------
setup; STUB_MODE=good run_fetch
[ "$RC" -eq 0 ] && pass "c: a good fetch succeeds" || bad "c: a good fetch failed (rc=$RC): $OUT"
cmp -s "$T/live/$NAME" "$T/site/dist/$NAME" && pass "c: CONTROL the artifact was replaced with the served bytes" \
  || bad "c: the artifact was NOT replaced (so a/b intact could be vacuous)"
[ "$(sha_of "$T/site/dist/$NAME")" = "$(awk '{print $1}' "$T/live/$NAME.sha256")" ] \
  && pass "c: the replaced artifact's sha matches the served sidecar" || bad "c: sha does not match the served sidecar"
cmp -s "$T/live/$NAME.sha256" "$T/site/dist/$NAME.sha256" && pass "c: the sidecar was replaced with the served one" \
  || bad "c: the sidecar was not replaced"
no_temps && pass "c: no temp file is left in dist/" || bad "c: a temp file was left behind"

# ---- d: already correct locally --------------------------------------------------------------------
setup; cp "$T/live/$NAME" "$T/site/dist/$NAME"; STUB_MODE=half18 run_fetch
[ "$RC" -eq 0 ] && pass "d: an already-correct local file passes without a fetch" || bad "d: failed (rc=$RC): $OUT"
[ "$(artifact_calls)" = 0 ] && pass "d: the artifact URL was never requested" || bad "d: the artifact was fetched $(artifact_calls) time(s) although it was already correct"
cmp -s "$T/live/$NAME" "$T/site/dist/$NAME" && pass "d: the local file is untouched and correct" || bad "d: the local file changed"
[ "$(ranged_calls)" = 1 ] && pass "d: the skip was proven by exactly one ranged request" || bad "d: expected 1 ranged probe, got $(ranged_calls)"
# l: the sidecar outcome on the skip path: the served sidecar replaces the old one.
cmp -s "$T/live/$NAME.sha256" "$T/site/dist/$NAME.sha256" && pass "l: on the skip path the served sidecar is installed" \
  || bad "l: on the skip path the sidecar is not the served one"
no_temps && no_probe_temps && pass "d: no temp file or probe dir is left" || bad "d: a temp was left: $(ls -A "$T/site/dist" "$T/tmp")"

# ---- h: local correct, sidecar served, artifact 404: must NOT pass silently ------------------------
setup; correct_local; rm -f "$T/live/$NAME"; run_fetch
[ "$RC" -ne 0 ] && pass "h: artifact 404 with a correct local copy refuses (rc=$RC)" || bad "h: artifact 404 passed silently (the skip trusted the sidecar alone): $OUT"
cmp -s "$T/orig" "$T/site/dist/$NAME" && pass "h: the original artifact is untouched" || bad "h: the original artifact changed"
no_temps && no_probe_temps && pass "h: no temp file or probe dir is left" || bad "h: a temp was left"

# ---- i: local correct, artifact served at a DIFFERENT size: never skips -----------------------------
setup; correct_local; head -c 99 /dev/urandom >> "$T/live/$NAME"; run_fetch
[ "$(artifact_calls)" -ge 1 ] && pass "i: a different served size falls back to a full fetch ($(artifact_calls) download(s))" || bad "i: skipped although the served size differs"
[ "$RC" -ne 0 ] && has "$OUT" "sha mismatch" && pass "i: the fallback refuses on the sha (rc=$RC)" || bad "i: did not refuse (rc=$RC): $OUT"
cmp -s "$T/orig" "$T/site/dist/$NAME" && pass "i: the original artifact is untouched" || bad "i: the original artifact changed"

# ---- j: CONTROL, local correct, artifact served at the right size: skips, no body downloaded --------
setup; correct_local; run_fetch
[ "$RC" -eq 0 ] && [ "$(artifact_calls)" = 0 ] && [ "$(ranged_calls)" = 1 ] \
  && pass "j: CONTROL a correct local copy of a served artifact skips with one ranged probe and no download" \
  || bad "j: the proven skip did not happen (rc=$RC, downloads $(artifact_calls), probes $(ranged_calls)): $OUT"
has "$(grep '^RANGE ' "$T/calls")" "--max-filesize" && pass "j: the probe bounds a Range-ignoring answer with --max-filesize" || bad "j: the probe has no --max-filesize"

# ---- k: artifact 404, no local file: refuses, no temp left ----------------------------------------
setup; rm -f "$T/site/dist/$NAME" "$T/live/$NAME"; run_fetch
[ "$RC" -ne 0 ] && [ ! -e "$T/site/dist/$NAME" ] && pass "k: a 404 with no local file refuses and creates nothing" || bad "k: rc=$RC, file exists: $([ -e "$T/site/dist/$NAME" ] && echo yes)"
no_temps && no_probe_temps && pass "k: no temp file is left" || bad "k: a temp was left"

# ---- m: a 206 whose Content-Range names another size proves nothing: never skips ---------------------
setup; correct_local; STUB_PROBE=liar run_fetch
[ "$RC" -eq 0 ] && [ "$(artifact_calls)" = 1 ] && pass "m: a 206 with the wrong Content-Range is not trusted (fell back to a full fetch)" \
  || bad "m: a lying 206 was trusted (rc=$RC, downloads $(artifact_calls))"

# ---- n: a server that ignores Range (200, whole body) cannot prove, so fetch normally ----------------
setup; correct_local; head -c 100000 /dev/urandom > "$T/live/$NAME"; cp "$T/live/$NAME" "$T/site/dist/$NAME"; cp "$T/live/$NAME" "$T/orig"
( cd "$T/live" && shasum -a 256 "$NAME" > "$NAME.sha256" )
STUB_PROBE=norange run_fetch
[ "$RC" -eq 0 ] && [ "$(artifact_calls)" = 1 ] && cmp -s "$T/live/$NAME" "$T/site/dist/$NAME" \
  && pass "n: a Range-ignoring 200 is 'cannot prove' and falls back to a normal fetch" \
  || bad "n: rc=$RC downloads $(artifact_calls): $OUT"
no_probe_temps && pass "n: no probe dir is left" || bad "n: a probe dir was left"

# ---- o: same size, different first byte: the first-byte clause is what refuses to skip -----------
setup; correct_local; { printf 'Z'; tail -c +2 "$T/site/dist/$NAME"; } > "$T/live/$NAME"
[ "$(head -c 1 "$T/site/dist/$NAME")" = Z ] && { printf 'Y'; tail -c +2 "$T/site/dist/$NAME"; } > "$T/live/$NAME"
run_fetch
[ "$(artifact_calls)" -ge 1 ] && [ "$RC" -ne 0 ] && cmp -s "$T/orig" "$T/site/dist/$NAME" \
  && pass "o: a same-size served artifact with a different first byte is not a proof (fetched, refused, original intact)" \
  || bad "o: skipped or changed on a first-byte mismatch (rc=$RC, downloads $(artifact_calls))"

# ---- e: one stall, then good: a retry, not a refusal -----------------------------------------------
setup; STUB_MODE=good STUB_FAIL_FIRST=1 run_fetch
[ "$RC" -eq 0 ] && cmp -s "$T/live/$NAME" "$T/site/dist/$NAME" && [ "$(artifact_calls)" = 2 ] \
  && pass "e: one stalled attempt then a good one is retried and succeeds (2 attempts)" \
  || bad "e: a single stall was not recovered by a retry (rc=$RC, attempts $(artifact_calls)): $OUT"

# ---- f: the time limits reach curl -----------------------------------------------------------------
line=$(grep "^$HOSTURL/dist/$NAME	" "$T/calls" | head -n 1)
has "$line" "--max-time" && has "$line" "--connect-timeout" && has "$line" "--speed-time" \
  && pass "f: the artifact fetch carries --max-time, --connect-timeout and --speed-time" || bad "f: time limits missing: $line"

# ---- g: every artifact caller in deploy-site.sh uses the verified fetch --------------------------
for a in '"$HOST/dist/$ART"' '"$HOST/dist/Kosmos.pkg"' '"$HOST/dist/tmux-arm64.tar.gz"' '"$HOST/dist/kosmos-arm64.tar.gz"'; do
  if grep -qF "fetch_verified $a " "$DEPLOY"; then pass "g: deploy-site.sh fetches $a through fetch_verified"
  else bad "g: deploy-site.sh does not fetch $a through fetch_verified"; fi
done

echo "test-deploy-site-fetch-4745: $npass passed, fail=$fail"
[ "$fail" = 0 ] || exit 1
exit 0
