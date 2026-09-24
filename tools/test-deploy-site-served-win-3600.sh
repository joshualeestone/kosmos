#!/usr/bin/env bash
# test-deploy-site-served-win-3600.sh - #3600: deploy-site.sh's post-deploy Windows verify must
# check the zip USERS GET, not the one the site's committed latest-win.json names.
#
# Production redirects /dist/latest-win.json (and the Windows zips) to R2, and a Windows promote
# updates R2 without a site commit. So the committed pointer goes stale, and on 2026-09-24 a correct
# 0.6.91 Mac promote exited 1 because the verify 404'd on kosmos-0.6.72-win-x64.zip, a zip nobody
# is pointed at. The fix: when the served latest-win.json is a REDIRECT, verify the zip the SERVED
# pointer names, and prove its served .sha256 equals the sha the pointer advertises.
#
# Harness: the same stubbed curl/vercel convention as tools/test-deploy-site-exit0-2791.sh, plus a
# redirect model. A path matching a glob in $LIVE_DIR/.redirects answers 307 to a fake R2 host
# (served from $R2_DIR) when curl is run without -L, and is served from R2 when run with -L. That
# mirrors Vercel, where a redirect wins over a static file of the same path.
#
#   A1  the card's exact shape (committed stale, R2 current) -> rc 0 + the NOTE naming both
#   A2  CONTROL for A1: the same scenario with KOSMOS_WIN_ZIP pinning the stale committed name
#       (the old semantics) REFUSES with "NOT served" -- so A1's green is the fix, not the harness
#   A3  redirect, but R2's pointer names a zip R2 does not serve -> refuse
#   A4  redirect, R2's sidecar disagrees with R2's pointer sha -> refuse (the updater would)
#   A5  NO redirect (pointer served statically) -> the committed zip is verified, no NOTE
#   A6  CONTROL for A5: no redirect and the committed zip not served -> refuse
#
#   bash tools/test-deploy-site-served-win-3600.sh
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
DEPLOY="$HERE/deploy-site.sh"
[ -f "$DEPLOY" ] || { echo "FAIL: deploy-site.sh not found at $DEPLOY"; exit 1; }

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

T=$(mktemp -d "${TMPDIR:-/tmp}/deploy-servedwin-test.XXXXXXXX")
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

V=0.6.50
ART="kosmos-$V-arm64.tar.gz"
# The committed (stale) Windows build, and the one R2 actually serves.
WV_OLD=0.6.40;  WZ_OLD="kosmos-$WV_OLD-win-x64.zip"
WV_NEW=0.6.48;  WZ_NEW="kosmos-$WV_NEW-win-x64.zip"
HOSTURL="https://fake.test"
R2URL="https://r2.test"

BIN="$T/bin"; mkdir -p "$BIN"
cat > "$BIN/curl" <<'CURL'
#!/bin/bash
url=""; dest=""; wfmt=""; follow=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) dest="$2"; shift 2;;
    -w) wfmt="$2"; shift 2;;
    -H) shift 2;;
    --*) shift;;
    -*L*) follow=1; shift;;
    http://*|https://*) url="$1"; shift;;
    *) shift;;
  esac
done
case "$url" in
  "$R2_URL"/*) served_file="$R2_DIR/${url#"$R2_URL"/}" ;;
  *)
    rel="${url#"$HOST_URL"/}"
    served_file="$LIVE_DIR/$rel"
    if [ -f "$LIVE_DIR/.redirects" ]; then
      while IFS= read -r g; do
        [ -n "$g" ] || continue
        # shellcheck disable=SC2254
        case "$rel" in $g)
          if [ "$follow" = 0 ]; then
            [ -n "$wfmt" ] && printf '307 %s/%s' "$R2_URL" "${rel#dist/}"
            exit 0
          fi
          served_file="$R2_DIR/${rel#dist/}"; break ;;
        esac
      done < "$LIVE_DIR/.redirects"
    fi
    ;;
esac
if [ -n "$wfmt" ]; then
  if [ -f "$served_file" ]; then [ -n "$dest" ] && [ "$dest" != /dev/null ] && cp "$served_file" "$dest"; printf '200'; else printf '404'; fi
  exit 0
fi
[ -f "$served_file" ] || exit 22
if [ -n "$dest" ]; then cp "$served_file" "$dest"; else cat "$served_file"; fi
exit 0
CURL
chmod +x "$BIN/curl"
cat > "$BIN/vercel" <<'VERCEL'
#!/bin/bash
mkdir -p "$LIVE_DIR/dist"
[ -d ./dist ] && cp -R ./dist/. "$LIVE_DIR/dist/" 2>/dev/null
for f in setup index.html vercel.json; do [ -f "./$f" ] && cp "./$f" "$LIVE_DIR/$f"; done
exit 0
VERCEL
chmod +x "$BIN/vercel"

write_ptr() { printf '{"version":"%s","sha256":"%s","artifact":"%s","manifest":"kosmos-%s-arm64.manifest.json"}\n' "$2" "$3" "$4" "$2" > "$1"; }
write_win_ptr() {  # <file> <version> <sha>
  printf '{"version":"%s","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"kosmos-%s-win-x64.zip","arch":"x64"}\n' "$2" "$3" "$2" > "$1"
}
sha_of() { shasum -a 256 < "$1" | awk '{print $1}'; }

# mode:
#   redirect         - the card: committed pointer names WZ_OLD, R2 serves a pointer naming WZ_NEW
#   redirect-nozip   - as redirect, but R2 lacks WZ_NEW
#   redirect-badsum  - as redirect, but R2's WZ_NEW.sha256 disagrees with R2's pointer sha
#   static           - no redirect: the committed pointer and zip are served as-is
#   static-nozip     - no redirect, and the committed zip is missing from what is served
make_scenario() {  # <mode> ; echoes "SITE LIVE R2"
  local mode="$1" s live r2 realsha oldsha newsha
  s="$(mktemp -d "$T/site.XXXXXX")"; live="$(mktemp -d "$T/live.XXXXXX")"; r2="$(mktemp -d "$T/r2.XXXXXX")"
  mkdir -p "$s/dist" "$live/dist"

  # --- LIVE Mac state, all verifiable (same shape as test-deploy-site-exit0-2791.sh) ---
  printf 'ARTIFACT-BYTES-%s\n' "$V" > "$live/dist/$ART"
  ( cd "$live/dist" && shasum -a 256 "$ART" > "$ART.sha256" )
  realsha="$(awk '{print $1}' "$live/dist/$ART.sha256")"
  printf 'ALIAS-BYTES-%s\n' "$V" > "$live/dist/kosmos-arm64.tar.gz"
  ( cd "$live/dist" && shasum -a 256 kosmos-arm64.tar.gz > kosmos-arm64.tar.gz.sha256 )
  printf 'TMUX-BYTES\n' > "$live/dist/tmux-arm64.tar.gz"
  ( cd "$live/dist" && shasum -a 256 tmux-arm64.tar.gz > tmux-arm64.tar.gz.sha256 )
  printf 'PKG-BYTES\n' > "$live/dist/Kosmos.pkg"
  ( cd "$live/dist" && shasum -a 256 Kosmos.pkg > Kosmos.pkg.sha256 )
  printf 'in\npkg:z\n' > "$live/dist/Kosmos.pkg.inputs"
  printf 'setup-script\n' > "$live/setup"
  ( cd "$live" && shasum -a 256 setup > setup.sha256 )
  write_ptr "$live/dist/latest.json" "$V" "$realsha" "$ART"

  # --- the SITE checkout: committed latest.json == live, and the (stale) committed Windows build ---
  git init -q --initial-branch=main "$s"
  printf '<h1>site</h1>\n' > "$s/index.html"; printf '{}\n' > "$s/vercel.json"
  printf 'docs/\n' > "$s/.vercelignore"
  printf 'setup-script\n' > "$s/setup"
  printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$s/.gitignore"
  write_ptr "$s/dist/latest.json" "$V" "$realsha" "$ART"
  printf 'WINZIP-%s\n' "$WV_OLD" > "$s/dist/$WZ_OLD"
  ( cd "$s/dist" && shasum -a 256 "$WZ_OLD" > "$WZ_OLD.sha256" )
  oldsha=$(sha_of "$s/dist/$WZ_OLD")
  write_win_ptr "$s/dist/latest-win.json" "$WV_OLD" "$oldsha"
  printf 'WINALIAS\n' > "$s/dist/kosmos-win-x64.zip"
  ( cd "$s/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  git -C "$s" add -A && git -C "$s" commit -q -m "site at $V"
  mkdir -p "$s/.vercel"; printf '{"projectId":"p"}\n' > "$s/.vercel/project.json"

  case "$mode" in
    redirect*)
      # Vercel: these paths 307 to R2 and a static file of the same path is never served.
      printf '%s\n' 'dist/latest-win.json' 'dist/kosmos-*win-x64.zip' 'dist/kosmos-*win-x64.zip.sha256' > "$live/.redirects"
      printf 'WINZIP-%s\n' "$WV_NEW" > "$r2/$WZ_NEW"
      ( cd "$r2" && shasum -a 256 "$WZ_NEW" > "$WZ_NEW.sha256" )
      newsha=$(sha_of "$r2/$WZ_NEW")
      write_win_ptr "$r2/latest-win.json" "$WV_NEW" "$newsha"
      printf 'WINALIAS\n' > "$r2/kosmos-win-x64.zip"
      ( cd "$r2" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
      # R2 does NOT carry the stale committed build: that is the card.
      [ "$mode" = redirect-nozip ] && rm -f "$r2/$WZ_NEW"
      [ "$mode" = redirect-badsum ] && printf '%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 "$WZ_NEW" > "$r2/$WZ_NEW.sha256"
      ;;
    static-nozip)
      # The committed zip is carried by git archive, so drop it from what the stub serves AFTER the
      # deploy by marking it unservable: a redirect to an R2 that lacks it.
      printf '%s\n' "dist/$WZ_OLD" > "$live/.redirects"
      ;;
  esac
  printf '%s %s %s' "$s" "$live" "$r2"
}

run_deploy() {  # <site> <live> <r2> [KOSMOS_WIN_ZIP value or ""] ; sets RC + out
  local s="$1" live="$2" r2="$3" wz="${4:-}"
  out="$(env PATH="$BIN:$PATH" LIVE_DIR="$live" R2_DIR="$r2" HOST_URL="$HOSTURL" R2_URL="$R2URL" \
    KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" \
    ${wz:+KOSMOS_WIN_ZIP="$wz"} bash "$DEPLOY" --publish 2>&1)"
  RC=$?
}

# A1) the card's shape: a correct deploy with a stale committed Windows pointer must exit 0.
read -r S L R <<<"$(make_scenario redirect)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && has "$out" "names $WZ_NEW" && has "$out" "names $WZ_OLD and is stale"; then
  pass "A1: redirected latest-win.json -> verified the SERVED $WZ_NEW, noted the stale committed $WZ_OLD, rc=0"
else
  bad "A1: expected rc=0 + the #3600 NOTE naming both builds (rc=$RC); out=$out"
fi

# A2) CONTROL: pin the stale committed name (the pre-#3600 semantics) on the SAME scenario. It must
# refuse on the 404, or A1 proves nothing about the fix.
read -r S L R <<<"$(make_scenario redirect)"
run_deploy "$S" "$L" "$R" "$WZ_OLD"
if [ "$RC" != 0 ] && has "$out" "$WZ_OLD is NOT served"; then
  pass "A2-CONTROL: verifying the committed $WZ_OLD on the same scenario refuses (rc=$RC) -- A1's green is the fix"
else
  bad "A2-CONTROL: the stale-name verify did not refuse (rc=$RC); A1 would be vacuous. out=$out"
fi

# A3) the served pointer names a zip R2 does not serve -> a real outage, refuse.
read -r S L R <<<"$(make_scenario redirect-nozip)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "$WZ_NEW is NOT served"; then
  pass "A3: the served pointer names an unserved $WZ_NEW -> refuses (rc=$RC)"
else
  bad "A3: an unserved served-pointer zip did not refuse (rc=$RC); out=$out"
fi

# A4) the served sidecar disagrees with the served pointer's sha -> the updater would refuse; so do we.
read -r S L R <<<"$(make_scenario redirect-badsum)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "the Windows updater would refuse this update"; then
  pass "A4: served pointer sha != served $WZ_NEW.sha256 -> refuses (rc=$RC)"
else
  bad "A4: a pointer/sidecar disagreement did not refuse (rc=$RC); out=$out"
fi

# A5) NO redirect: the committed pointer is what is served, so the committed zip is verified and
# there is no #3600 NOTE (behaviour unchanged from before the fix).
read -r S L R <<<"$(make_scenario static)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && ! has "$out" "#3600"; then
  pass "A5: no redirect -> the committed $WZ_OLD is verified, no NOTE, rc=0"
else
  bad "A5: the static path changed behaviour (rc=$RC); out=$out"
fi

# A6) CONTROL for A5: no pointer redirect and the committed zip unservable -> refuse. Proves the
# non-redirect path still verifies $WINZIP rather than skipping it.
read -r S L R <<<"$(make_scenario static-nozip)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "$WZ_OLD is NOT served"; then
  pass "A6-CONTROL: no pointer redirect + the committed zip unserved -> refuses (rc=$RC)"
else
  bad "A6-CONTROL: an unserved committed zip on the static path did not refuse (rc=$RC); out=$out"
fi

[ "$fails" -eq 0 ] || { echo "$fails failing arm(s)"; exit 1; }
echo "test-deploy-site-served-win-3600: all 6 arms passed"
