#!/usr/bin/env bash
# test-deploy-site-winderive.sh - #2571: deploy-site.sh DERIVES the Windows zip name from
# dist/latest-win.json (replacing the stale hardcoded $WINZIP, which was 13 versions old), and the
# derivation is an INSTRUMENT, not just a lookup: the derived name is trusted ONLY when the committed
# latest-win.json's sha256 EQUALS the committed versioned zip's .sha256 sidecar. A drifted pointer
# (a partial tools/publish-kosmos-windows.sh run, or a hand-edited manifest) REFUSES rather than
# silently deriving a name whose bytes do not match. This closes the card's weakest premise:
# latest-win.json is written only by publish-kosmos-windows.sh, so deriving blindly would MOVE the
# staleness; verifying the pointer against the committed sidecar REMOVES it.
#
# The real deploy-site.sh fetches over HTTP; curl is stubbed to serve latest.json from a fake LIVE
# dir and to FAIL every other path (exit 22), so a bare dry run stops right after the win-derive
# block -- which is all this test exercises. Every assertion has a control that can return the
# dangerous answer (the DRIFT refusal is the load-bearing one; #1's green derive is its control).
#
#   bash tools/test-deploy-site-winderive.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DEPLOY="$HERE/deploy-site.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/deploy-winderive-test.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HOSTURL="https://fake.test"
# A version that is NOT the 0.6.24 fallback, so "derived the current name" is distinguishable from
# "fell back to the hardcode".
V=0.6.99
WINV="kosmos-$V-win-x64.zip"
ART="kosmos-$V-arm64.tar.gz"

# ---- stubs on PATH: curl serves latest.json from LIVE, fails everything else -------------------
BIN="$T/bin"; mkdir -p "$BIN"
cat > "$BIN/curl" <<'CURL'
#!/bin/bash
url=""; dest=""; wfmt=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) dest="$2"; shift 2;;
    -w) wfmt="$2"; shift 2;;
    -H) shift 2;;
    http://*|https://*) url="$1"; shift;;
    *) shift;;
  esac
done
rel="${url#"$HOST_URL"/}"
served_file="$LIVE_DIR/$rel"
if [ -n "$wfmt" ]; then
  if [ -f "$served_file" ]; then [ -n "$dest" ] && cp "$served_file" "$dest"; printf '200'; else printf '404'; fi
  exit 0
fi
[ -f "$served_file" ] || exit 22
if [ -n "$dest" ]; then cp "$served_file" "$dest"; else cat "$served_file"; fi
exit 0
CURL
chmod +x "$BIN/curl"
# deploy-site.sh runs `command -v vercel` as a precondition BEFORE the derive block, so a box with
# no vercel would exit there and every assertion below would false-fail (the test:shell gate goes
# spuriously red for an unrelated reason). A bare no-op stub makes the test host-independent; the
# dry run (no --publish) never actually invokes it.
printf '#!/bin/sh\nexit 0\n' > "$BIN/vercel"; chmod +x "$BIN/vercel"

# ---- a site checkout committed with latest.json + latest-win.json + the versioned win zip -------
# $1 mode:
#   agree    - latest-win.json's sha256 == the committed zip's real bytes-hash (the happy path)
#   drift    - latest-win.json's sha256 != the committed zip's bytes-hash (a hand-edit / partial publish)
#   absent   - no latest-win.json at all (an older checkout)
#   nofields - latest-win.json present but missing the "versioned"/"sha256" fields (a malformed manifest)
#   nozip    - latest-win.json names a versioned zip that is NOT committed in the checkout
make_site() {
  local s live mode="$1"
  s="$(mktemp -d "$T/site.XXXXXX")"; live="$(mktemp -d "$T/live.XXXXXX")"
  mkdir -p "$s/dist" "$live/dist"
  git init -q "$s"
  printf '<h1>site</h1>\n' > "$s/index.html"; printf '{}\n' > "$s/vercel.json"
  printf 'docs/\n' > "$s/.vercelignore"
  printf 'setup-script\n' > "$s/setup"
  printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$s/.gitignore"
  # latest.json committed == served (so a reached committed-vs-live guard would pass; it is AFTER
  # the win-derive block anyway). The mac artifacts are never fetched in this test (curl fails them,
  # which stops the dry run just past the win block).
  printf '{"version":"%s","sha256":"macsha","artifact":"%s","manifest":"kosmos-%s-arm64.manifest.json"}\n' "$V" "$ART" "$V" > "$s/dist/latest.json"
  cp "$s/dist/latest.json" "$live/dist/latest.json"
  # the tracked versioned win zip and its REAL sha sidecar (omit the committed zip for the nozip mode)
  local realsha=""
  if [ "$mode" != nozip ]; then
    printf 'WINZIP-BYTES-%s\n' "$V" > "$s/dist/$WINV"
    ( cd "$s/dist" && shasum -a 256 "$WINV" > "$WINV.sha256" )
    realsha="$(awk '{print $1}' "$s/dist/$WINV.sha256")"
  fi
  case "$mode" in
    agree) printf '{"version":"%s","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$V" "$realsha" "$WINV" > "$s/dist/latest-win.json" ;;
    drift) printf '{"version":"%s","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$V" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$WINV" > "$s/dist/latest-win.json" ;;
    nofields) printf '{"version":"%s","artifact":"kosmos-win-x64.zip","arch":"x64"}\n' "$V" > "$s/dist/latest-win.json" ;;
    nozip) printf '{"version":"%s","sha256":"aaaa","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$V" "$WINV" > "$s/dist/latest-win.json" ;;
    absent) : ;;
  esac
  git -C "$s" add -A && git -C "$s" commit -q -m "site"
  mkdir -p "$s/.vercel"; printf '{"projectId":"p"}\n' > "$s/.vercel/project.json"
  printf '%s %s' "$s" "$live"
}

run() {  # <site> <live> [extra env assignments...] ; bare (dry-run). KOSMOS_WIN_ZIP intentionally unset.
  local s="$1" live="$2"; shift 2
  out="$(PATH="$BIN:$PATH" LIVE_DIR="$live" HOST_URL="$HOSTURL" \
    KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" "$@" \
    bash "$DEPLOY" 2>&1)"
  RC=$?
}

# 1) AGREEMENT (green): derives the CURRENT versioned name, sha-verified against the committed zip.
read -r S L <<<"$(make_site agree)"
run "$S" "$L"
has "$out" "derived the Windows zip $WINV from dist/latest-win.json" \
  && pass "derive: uses the current versioned name from latest-win.json (sha-verified)" \
  || bad "did not derive $WINV; out=$out"
has "$out" "0.6.24" \
  && bad "still references the stale 0.6.24 fallback despite a good latest-win.json" \
  || pass "derive: does NOT fall back to the stale 0.6.24 hardcode when latest-win.json is present"

# 2) DRIFT (red, load-bearing): pointer sha != committed sidecar -> REFUSE (#2571) and derive nothing.
read -r S L <<<"$(make_site drift)"
run "$S" "$L"
if [ "$RC" != 0 ] && has "$out" "DISAGREES" && has "$out" "#2571"; then
  pass "agreement: refuses when latest-win.json's sha != the committed zip's actual bytes (the instrument)"
else
  bad "did not refuse a drifted win pointer (rc=$RC); out=$out"
fi
has "$out" "derived the Windows zip" \
  && bad "drift case still emitted a derive line (it must refuse BEFORE trusting the name)" \
  || pass "agreement: the drift refusal happens BEFORE any name is trusted"

# 3) ABSENT (fallback): no latest-win.json -> warn + fall back to $WINZIP, no agreement refusal.
read -r S L <<<"$(make_site absent)"
run "$S" "$L"
has "$out" "no committed dist/latest-win.json -- using the fallback" \
  && pass "fallback: warns + falls back to \$WINZIP when latest-win.json is absent (older checkout)" \
  || bad "no fallback warning; out=$out"
has "$out" "DISAGREES" \
  && bad "absent case wrongly hit the agreement refusal" \
  || pass "fallback: an absent latest-win.json does not trip the agreement check"

# 4) OVERRIDE: an explicit KOSMOS_WIN_ZIP skips the derivation entirely (operator escape hatch).
read -r S L <<<"$(make_site agree)"
run "$S" "$L" KOSMOS_WIN_ZIP="kosmos-1.2.3-win-x64.zip"
has "$out" "derived the Windows zip" \
  && bad "override still ran the derivation" \
  || pass "override: an explicit KOSMOS_WIN_ZIP skips the derivation"

# 5) MALFORMED MANIFEST (red): latest-win.json present but with no "versioned"/"sha256" -> REFUSE.
read -r S L <<<"$(make_site nofields)"
run "$S" "$L"
if [ "$RC" != 0 ] && has "$out" "names no versioned/sha256" && has "$out" "#2571"; then
  pass "malformed: a latest-win.json missing versioned/sha256 refuses (does not derive an empty name)"
else
  bad "did not refuse a fieldless manifest (rc=$RC); out=$out"
fi

# 6) POINTER NAMES AN UNCOMMITTED ZIP (red): latest-win.json's versioned zip is not committed -> REFUSE.
read -r S L <<<"$(make_site nozip)"
run "$S" "$L"
if [ "$RC" != 0 ] && has "$out" "not committed in the site checkout" && has "$out" "#2571"; then
  pass "missing-zip: a pointer naming a versioned zip absent from the checkout refuses (bytes-agreement precondition)"
else
  bad "did not refuse a pointer whose versioned zip is uncommitted (rc=$RC); out=$out"
fi

[ "$fail" = 0 ] && echo "test-deploy-site-winderive: ALL PASS" || { echo "test-deploy-site-winderive: FAIL"; exit 1; }
