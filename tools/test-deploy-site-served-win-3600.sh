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
#   A7  a committed staging pointer OLDER than the served prod build (superseded, absent from R2)
#       -> warned about and skipped, rc 0 (the live 0.6.81-staged / 0.6.89-prod state)
#   A8  a staging pointer NEWER than prod and present in R2 -> verified, rc 0, no warning
#   A9  CONTROL for A7: a NEWER staging pointer absent from R2 -> refuse (not skipped)
#   A10 the served pointer names a path, not a bare file name -> refuse
#   A11 the served pointer carries no sha256 -> refuse
#   A12 CONTROL for A7: superseded staged build, but the served staging pointer is NOT the committed
#       one -> refuse (the skip covers only the zip and sidecar, never the pointer check)
#   A13 the redirect probe answers 500 -> a NOTE, and the fallback verifies the committed name
#   A14 the served pointer names something that is not kosmos-<version>-win-x64.zip -> refuse
#   A15 redirected, and the served pointer names the SAME zip as the committed one -> rc 0, no NOTE
#   A16 KOSMOS_WIN_ZIP names the prod build: the staged compare uses ITS version, not the stale
#       committed pointer's, so a staged build older than the override is still superseded
#   A17 the committed Windows build is NEWER than what R2 serves (a promote R2 never got) -> a loud
#       WARNING that users do not have it (repeated after the final success line), not the
#       "stale, expected" NOTE; rc 0
#   A18 the redirect probe gets no status at all (transport error) -> a NOTE, strict fallback
#   A19 static path, committed pointer whose `version` (0.6.99) disagrees with its checked name
#       (0.6.40): the staged compare uses the NAME, so a pending 0.6.55 staged build is still verified
#   A20 the same on the STAGED side: a staging pointer whose `version` says 0.6.30 but whose name is
#       0.6.55 is not treated as superseded
#   A21 R2's zip bytes do not hash to the sha its pointer and sidecar agree on -> refuse
#   A22 the committed Windows name has no readable version -> a "cannot be told" NOTE, never the
#       "committed is older, stale" claim; rc 0
#   A23 right after a Windows promote R2 missed: committed 0.6.40, R2 0.6.30, and the staging pointer
#       still names the committed 0.6.40 -> the staged build is superseded (vs the committed build),
#       so the deploy reaches the unpublished WARNING and exits 0 instead of dying on the staged zip
#   A24 a superseded staged build whose zip is served STATICALLY (no redirect) is still verified: the
#       skip is only for a staged zip that is itself redirected
#   A25 #3618: the staging pointer is served by REDIRECT and names a newer R2 build -> that build is
#       verified (zip, sidecar == pointer sha, bytes), not the stale committed staging copy; rc 0
#   A26 CONTROL for A25: the redirected staging build's sidecar disagrees with its pointer -> refuse
#   A27 #3618: a redirected staging pointer naming a build older than prod -> superseded, rc 0, and
#       no "served is not the committed one" refusal
#   A28 #3610: the alias sidecar is served STATICALLY and is stale -> a WARNING naming the fix, rc 0
#   A29 CONTROL for A28: the alias sidecar is served from R2 and disagrees -> refuse
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
    if [ "$rel" = dist/latest-win.json ] && [ "$follow" = 0 ] && [ -f "$LIVE_DIR/.probe-fail" ]; then
      [ -n "$wfmt" ] && printf '000 '
      exit 7   # curl's "failed to connect": the real transport-error shape
    fi
    if [ "$rel" = dist/latest-win.json ] && [ "$follow" = 0 ] && [ -f "$LIVE_DIR/.probe-status" ]; then
      [ -n "$wfmt" ] && printf '%s ' "$(cat "$LIVE_DIR/.probe-status")"
      exit 0
    fi
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
  if [ -f "$served_file" ]; then
    [ -n "$dest" ] && [ "$dest" != /dev/null ] && cp "$served_file" "$dest"
    case "$wfmt" in *content_type*) printf '200 application/octet-stream';; *) printf '200';; esac
  else printf '404'; fi
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
# A scenario can make the STATIC staging pointer serve other bytes than were deployed.
[ -f "$LIVE_DIR/.served-staging" ] && cp "$LIVE_DIR/.served-staging" "$LIVE_DIR/dist/latest-win-staging.json"
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
#   redirect-badname - as redirect, but R2's pointer names a path rather than a bare file name
#   redirect-nosha   - as redirect, but R2's pointer carries no sha256
#   redirect-probe500 - as redirect, but the un-followed probe of latest-win.json answers 500
#   redirect-badshape - as redirect, but R2's pointer names evil.zip
#   redirect-same     - as redirect, but R2 serves the committed build (pointer names WZ_OLD)
#   redirect-stagedrift - as redirect, and the STATIC latest-win-staging.json serves other bytes than deployed
#   redirect-aliasstatic - as redirect, but the alias .sha256 is served statically (stale site copy)
#   redirect-aliasbad  - as redirect, and R2's alias .sha256 disagrees with the pointer
#   redirect-stagedr2  - as redirect, and the staging pointer redirects to R2 naming a newer 0.6.60
#   redirect-stagedr2-badsum - as stagedr2, but R2's 0.6.60 sidecar disagrees with its pointer
#   redirect-stagedr2-old - the staging pointer redirects to R2 naming 0.6.46 (< prod 0.6.48)
#   redirect-behind   - as redirect, but R2 serves an OLDER build (0.6.30) than the committed 0.6.40
#   redirect-probenone - as redirect, but the un-followed probe fails at transport (curl exit 7)
#   redirect-badbytes - as redirect, but R2's WZ_NEW bytes change after its sha was published
#   redirect-oddname  - as redirect, but the committed pointer names legacy-win.zip (no version)
#   static-versionskew - static, the committed pointer's version field says 0.6.99, and the staged
#                        zip is unservable
# $2 (optional) staged: "" none | old (0.6.45, absent from R2) | new (0.6.55, in R2) | new-missing
#    | old-withnew (old, and the site ALSO commits WZ_NEW so KOSMOS_WIN_ZIP can name it)
#    | new-skewed (new-missing, but the staging pointer's version field says 0.6.30)
#    | committed (the staging pointer names the committed prod build WZ_OLD, as after a promote)
make_scenario() {  # <mode> [staged] ; echoes "SITE LIVE R2"
  local mode="$1" staged="${2:-}" s live r2 realsha oldsha newsha sv sz
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
  if [ "$mode" = redirect-oddname ]; then
    printf 'LEGACY\n' > "$s/dist/legacy-win.zip"
    ( cd "$s/dist" && shasum -a 256 legacy-win.zip > legacy-win.zip.sha256 )
    printf '{"version":"x","sha256":"%s","versioned":"legacy-win.zip"}\n' "$(sha_of "$s/dist/legacy-win.zip")" > "$s/dist/latest-win.json"
  fi
  if [ "$mode" = static-versionskew ]; then
    printf '{"version":"0.6.99","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$oldsha" "$WZ_OLD" > "$s/dist/latest-win.json"
  fi
  printf 'WINALIAS\n' > "$s/dist/kosmos-win-x64.zip"
  ( cd "$s/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  if [ "$staged" = committed ]; then
    write_win_ptr "$s/dist/latest-win-staging.json" "$WV_OLD" "$oldsha"
  elif [ -n "$staged" ]; then
    case "$staged" in old|old-withnew) sv=0.6.45 ;; *) sv=0.6.55 ;; esac
    sz="kosmos-$sv-win-x64.zip"
    printf 'STAGED-%s\n' "$sv" > "$s/dist/$sz"
    ( cd "$s/dist" && shasum -a 256 "$sz" > "$sz.sha256" )
    write_win_ptr "$s/dist/latest-win-staging.json" "$sv" "$(sha_of "$s/dist/$sz")"
    if [ "$staged" = new-skewed ]; then
      printf '{"version":"0.6.30","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$(sha_of "$s/dist/$sz")" "$sz" > "$s/dist/latest-win-staging.json"
    fi
    if [ "$staged" = new ]; then cp "$s/dist/$sz" "$s/dist/$sz.sha256" "$r2/"; fi
    if [ "$staged" = old-withnew ]; then
      printf 'WINZIP-%s\n' "$WV_NEW" > "$s/dist/$WZ_NEW"
      ( cd "$s/dist" && shasum -a 256 "$WZ_NEW" > "$WZ_NEW.sha256" )
    fi
  fi
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
      # R2 does NOT carry the stale committed build: that is the card.
      [ "$mode" = redirect-nozip ] && rm -f "$r2/$WZ_NEW"
      [ "$mode" = redirect-badname ] && write_win_ptr "$r2/latest-win.json" "$WV_NEW/../x" "$newsha"
      [ "$mode" = redirect-nosha ] && printf '{"version":"%s","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$WV_NEW" "$WZ_NEW" > "$r2/latest-win.json"
      [ "$mode" = redirect-probe500 ] && printf '500' > "$live/.probe-status"
      [ "$mode" = redirect-probenone ] && : > "$live/.probe-fail"
      if [ "$mode" = redirect-behind ]; then
        printf 'WINZIP-0.6.30\n' > "$r2/kosmos-0.6.30-win-x64.zip"
        ( cd "$r2" && shasum -a 256 kosmos-0.6.30-win-x64.zip > kosmos-0.6.30-win-x64.zip.sha256 )
        write_win_ptr "$r2/latest-win.json" 0.6.30 "$(sha_of "$r2/kosmos-0.6.30-win-x64.zip")"
      fi
      [ "$mode" = redirect-badshape ] && printf '{"version":"x","sha256":"%s","versioned":"evil.zip"}\n' "$newsha" > "$r2/latest-win.json"
      if [ "$mode" = redirect-same ]; then
        cp "$s/dist/$WZ_OLD" "$s/dist/$WZ_OLD.sha256" "$r2/"
        write_win_ptr "$r2/latest-win.json" "$WV_OLD" "$oldsha"
      fi
      # R2's unversioned alias is the build R2's pointer names, and its sidecar says so.
      _an=$(sed -n 's/.*"versioned":"\([^"]*\)".*/\1/p' "$r2/latest-win.json")
      if [ -n "$_an" ] && [ -f "$r2/$_an" ]; then cp "$r2/$_an" "$r2/kosmos-win-x64.zip"; else printf 'WINALIAS\n' > "$r2/kosmos-win-x64.zip"; fi
      ( cd "$r2" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
      if [ "$mode" = redirect-stagedrift ]; then
        # The STATIC staging pointer serves other bytes than the committed one (deploy drift).
        write_win_ptr "$live/.served-staging" 0.6.44 "$newsha"
      fi
      if [ "$mode" = redirect-aliasstatic ]; then
        # Today's prod: the alias sidecar is NOT redirected, so the stale site copy is served.
        printf '%s\n' 'dist/latest-win.json' 'dist/kosmos-*win-x64.zip' 'dist/kosmos-[0-9]*-win-x64.zip.sha256' > "$live/.redirects"
      fi
      [ "$mode" = redirect-aliasbad ] && printf '%s  kosmos-win-x64.zip\n' 2222222222222222222222222222222222222222222222222222222222222222 > "$r2/kosmos-win-x64.zip.sha256"
      if [ "$mode" = redirect-stagedr2 ] || [ "$mode" = redirect-stagedr2-badsum ]; then
        # R2 keeps its own staging channel: the staging pointer redirects and names a NEWER build.
        printf '%s\n' 'dist/latest-win-staging.json' >> "$live/.redirects"
        printf 'STAGED-R2-0.6.60\n' > "$r2/kosmos-0.6.60-win-x64.zip"
        ( cd "$r2" && shasum -a 256 kosmos-0.6.60-win-x64.zip > kosmos-0.6.60-win-x64.zip.sha256 )
        write_win_ptr "$r2/latest-win-staging.json" 0.6.60 "$(sha_of "$r2/kosmos-0.6.60-win-x64.zip")"
        [ "$mode" = redirect-stagedr2-badsum ] && printf '%s  kosmos-0.6.60-win-x64.zip\n' 3333333333333333333333333333333333333333333333333333333333333333 > "$r2/kosmos-0.6.60-win-x64.zip.sha256"
      fi
      if [ "$mode" = redirect-stagedr2-old ]; then
        # R2's staging pointer redirects and names a build OLDER than prod, absent from R2.
        printf '%s\n' 'dist/latest-win-staging.json' >> "$live/.redirects"
        write_win_ptr "$r2/latest-win-staging.json" 0.6.46 "$newsha"
      fi
      [ "$mode" = redirect-badbytes ] && printf 'TRUNCATED\n' > "$r2/$WZ_NEW"
      [ "$mode" = redirect-badsum ] && printf '%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 "$WZ_NEW" > "$r2/$WZ_NEW.sha256"
      ;;
    static-versionskew)
      printf '%s\n' 'dist/kosmos-0.6.55-win-x64.zip' > "$live/.redirects"
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
  out="$(env -u KOSMOS_WIN_ZIP PATH="$BIN:$PATH" LIVE_DIR="$live" R2_DIR="$r2" HOST_URL="$HOSTURL" R2_URL="$R2URL" \
    KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" \
    ${wz:+KOSMOS_WIN_ZIP="$wz"} bash "$DEPLOY" --publish 2>&1)"
  RC=$?
}

# A1) the card's shape: a correct deploy with a stale committed Windows pointer must exit 0.
read -r S L R <<<"$(make_scenario redirect)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && has "$out" "names $WZ_NEW" && has "$out" "committed Windows name $WZ_OLD is older"; then
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

# A7) a superseded staging pointer (older than the served prod build, absent from R2) is skipped.
read -r S L R <<<"$(make_scenario redirect old)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && has "$out" "kosmos-0.6.45-win-x64.zip (0.6.45), which is not newer than the prod Windows build $WV_NEW" && has "$out" "(the staging pointer still is)"; then
  pass "A7: a superseded staged build (0.6.45 < prod $WV_NEW) is warned about and skipped, rc=0"
else
  bad "A7: a superseded staged build was not skipped with the warning (rc=$RC); out=$out"
fi

# A8) a newer staged build that R2 serves is verified, with no superseded warning.
read -r S L R <<<"$(make_scenario redirect new)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && ! has "$out" "not newer than the prod Windows build"; then
  pass "A8: a newer staged build (0.6.55) present in R2 is verified, rc=0"
else
  bad "A8: a newer, served staged build did not verify cleanly (rc=$RC); out=$out"
fi

# A9) CONTROL for A7: a NEWER staged build absent from R2 must refuse, so A7's skip is gated on the
# version compare and not a blanket skip of the staged block.
read -r S L R <<<"$(make_scenario redirect new-missing)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "the staged Windows zip kosmos-0.6.55-win-x64.zip failed served-verify"; then
  pass "A9-CONTROL: a newer staged build absent from R2 refuses (rc=$RC) -- A7's skip is version-gated"
else
  bad "A9-CONTROL: a newer, unserved staged build did not refuse (rc=$RC); out=$out"
fi

# A10) a served pointer naming a path (it becomes a URL) refuses.
read -r S L R <<<"$(make_scenario redirect-badname)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "which is not a bare file name"; then
  pass "A10: a served pointer naming a path refuses (rc=$RC)"
else
  bad "A10: a path-shaped served pointer name did not refuse on the name guard (rc=$RC); out=$out"
fi

# A11) a served pointer with no sha256 refuses (the sidecar check would otherwise be skipped).
read -r S L R <<<"$(make_scenario redirect-nosha)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "but no sha256"; then
  pass "A11: a served pointer with no sha256 refuses (rc=$RC)"
else
  bad "A11: a served pointer with no sha256 did not refuse (rc=$RC); out=$out"
fi

# A12) CONTROL for A7: the superseded skip must not skip the staging POINTER check.
read -r S L R <<<"$(make_scenario redirect-stagedrift old)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "the served latest-win-staging.json is not the committed one"; then
  pass "A12-CONTROL: superseded staged build + a served staging pointer that is not the committed one refuses (rc=$RC)"
else
  bad "A12-CONTROL: a drifted served staging pointer was not caught when the staged build is superseded (rc=$RC); out=$out"
fi

# A13) the probe answers neither a redirect nor 200: a NOTE, and the fallback verifies the committed
# name (which R2 lacks here, so it refuses: the fallback is the old, strict check, never a skip).
read -r S L R <<<"$(make_scenario redirect-probe500)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "answered 500 (neither a redirect nor 200)" && has "$out" "$WZ_OLD is NOT served"; then
  pass "A13: a 500 from the probe is named, and the fallback verifies the committed $WZ_OLD (refuses, rc=$RC)"
else
  bad "A13: a 500 probe was not named or did not fall back to the committed name (rc=$RC); out=$out"
fi

# A14) the served pointer names something that is not a kosmos-<version>-win-x64.zip.
read -r S L R <<<"$(make_scenario redirect-badshape)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "names 'evil.zip', not a kosmos-<version>-win-x64.zip"; then
  pass "A14: a served pointer naming evil.zip refuses on the shape guard (rc=$RC)"
else
  bad "A14: a wrong-shaped served name did not refuse on the shape guard (rc=$RC); out=$out"
fi

# A15) redirected, same build as committed: verified, and no stale-pointer NOTE.
read -r S L R <<<"$(make_scenario redirect-same)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && ! has "$out" "is stale"; then
  pass "A15: redirected to the same build as committed -> rc=0, no stale NOTE"
else
  bad "A15: a redirected pointer naming the committed build did not verify cleanly (rc=$RC); out=$out"
fi

# A16) the override names prod 0.6.48; the staged 0.6.45 is older than THAT (though newer than the
# stale committed 0.6.40), so it is superseded and skipped. Judged against 0.6.40 it would be
# verified, 404 through R2, and refuse.
read -r S L R <<<"$(make_scenario redirect old-withnew)"
run_deploy "$S" "$L" "$R" "$WZ_NEW"
if [ "$RC" = 0 ] && has "$out" "not newer than the prod Windows build $WV_NEW"; then
  pass "A16: with KOSMOS_WIN_ZIP=$WZ_NEW the staged compare uses $WV_NEW, so 0.6.45 is superseded, rc=0"
else
  bad "A16: the staged compare did not use the override's version (rc=$RC); out=$out"
fi

# A17) committed 0.6.40 is newer than R2's 0.6.30: users do not have the committed build. Warn loudly
# (not the "expected" NOTE), verify what IS served, and do not fail the Mac deploy for it.
read -r S L R <<<"$(make_scenario redirect-behind)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "is NEWER than what prod serves by redirect (kosmos-0.6.30-win-x64.zip)" \
   && has "$out" "BUT (#3600) the Windows build $WZ_OLD is committed and NOT served" && ! has "$out" "is older, so the committed pointer is stale"; then
  pass "A17: committed newer than served -> the loud 'users do NOT have' WARNING, not the stale NOTE, rc=0"
else
  bad "A17: a committed build newer than R2 was not flagged as unpublished (rc=$RC); out=$out"
fi

# A18) no status from the probe: named, then the strict fallback on the committed name (refuses here).
read -r S L R <<<"$(make_scenario redirect-probenone)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "could not probe whether latest-win.json is served by redirect" && has "$out" "$WZ_OLD is NOT served"; then
  pass "A18: a probe with no status is named, and the strict fallback on $WZ_OLD refuses (rc=$RC)"
else
  bad "A18: a status-less probe was not named or did not fall back strictly (rc=$RC); out=$out"
fi

# A19) the staged compare reads the checked NAME (0.6.40), not the pointer's version field (0.6.99),
# so the pending 0.6.55 staged build is verified, and refuses because it is not served.
read -r S L R <<<"$(make_scenario static-versionskew new-missing)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "the staged Windows zip kosmos-0.6.55-win-x64.zip failed served-verify"; then
  pass "A19: a committed version field that disagrees with the name does not skip a pending staged build (rc=$RC)"
else
  bad "A19: the staged compare trusted the pointer's version field over the checked name (rc=$RC); out=$out"
fi

# A20) staged side: the version comes from the name (0.6.55 > prod 0.6.48), not the field (0.6.30),
# so the pending staged build is verified, and refuses because R2 does not have it.
read -r S L R <<<"$(make_scenario redirect new-skewed)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "the staged Windows zip kosmos-0.6.55-win-x64.zip failed served-verify"; then
  pass "A20: a staging pointer's version field (0.6.30) does not make its 0.6.55 build look superseded (rc=$RC)"
else
  bad "A20: the staged compare trusted the staging pointer's version field over its name (rc=$RC); out=$out"
fi

# A21) pointer and sidecar agree, but R2's zip bytes do not hash to that sha.
read -r S L R <<<"$(make_scenario redirect-badbytes)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "a corrupt or partial R2 upload"; then
  pass "A21: served zip bytes that do not match the published sha refuse (rc=$RC)"
else
  bad "A21: corrupt served zip bytes were not caught (rc=$RC); out=$out"
fi

# A22) no readable committed version: say so, do not claim the committed pointer is the older one.
read -r S L R <<<"$(make_scenario redirect-oddname)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "has no readable version (or the compare failed), so which is newer cannot be told" && ! has "$out" "is older, so the committed pointer is stale"; then
  pass "A22: an unversioned committed name gets the 'cannot be told' NOTE, not a staleness claim, rc=0"
else
  bad "A22: an unversioned committed name was mislabeled or failed (rc=$RC); out=$out"
fi

# A23) the post-promote shape: the staged build equals the committed one, R2 serves an older build.
read -r S L R <<<"$(make_scenario redirect-behind committed)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "BUT (#3600) the Windows build $WZ_OLD is committed and NOT served" && has "$out" "not newer than the prod Windows build $WV_OLD"; then
  pass "A23: staged == committed while R2 lags -> staged superseded, the unpublished warning prints, rc=0"
else
  bad "A23: the post-promote R2-lag state died on the staged zip or lost the warning (rc=$RC); out=$out"
fi

# A24) static path, staged == prod (superseded by version) but served statically: verified, no skip.
read -r S L R <<<"$(make_scenario static committed)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "published and verified" && ! has "$out" "not newer than the prod Windows build"; then
  pass "A24: a superseded staged zip served statically is verified, not skipped, rc=0"
else
  bad "A24: a statically served superseded staged zip was skipped or failed (rc=$RC); out=$out"
fi

# A25) #3618: the redirected staging pointer is the truth; its newer R2 build is verified in full.
read -r S L R <<<"$(make_scenario redirect-stagedr2 old)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "prod serves latest-win-staging.json by redirect and it names kosmos-0.6.60-win-x64.zip" && ! has "$out" "not newer than the prod Windows build"; then
  pass "A25: a redirected staging pointer naming a newer R2 build is verified (not the stale committed copy), rc=0"
else
  bad "A25: the redirected staging build was not verified cleanly (rc=$RC); out=$out"
fi

# A26) CONTROL for A25: the redirected staging build's sidecar disagrees with its pointer.
read -r S L R <<<"$(make_scenario redirect-stagedr2-badsum old)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "the served latest-win-staging.json advertises sha"; then
  pass "A26-CONTROL: a redirected staging build whose sidecar disagrees refuses (rc=$RC)"
else
  bad "A26-CONTROL: a redirected staging sidecar mismatch was not caught (rc=$RC); out=$out"
fi

# A27) a redirected staging pointer naming an older build: superseded, no committed-copy refusal.
read -r S L R <<<"$(make_scenario redirect-stagedr2-old old)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "not newer than the prod Windows build" && ! has "$out" "is not the committed one"; then
  pass "A27: a redirected, superseded staging pointer is skipped without comparing it to the stale committed copy, rc=0"
else
  bad "A27: a redirected superseded staging pointer was refused or not skipped (rc=$RC); out=$out"
fi

# A28) #3610 today: the alias sidecar is static and stale -> warn, do not red the Mac deploy.
read -r S L R <<<"$(make_scenario redirect-aliasstatic)"
run_deploy "$S" "$L" "$R"
if [ "$RC" = 0 ] && has "$out" "WARNING (#3610): kosmos-win-x64.zip.sha256 is served from the site commit"; then
  pass "A28: a stale, statically served alias checksum warns (naming the redirect fix), rc=0"
else
  bad "A28: a stale static alias checksum did not warn cleanly (rc=$RC); out=$out"
fi

# A29) CONTROL for A28: served from R2 and wrong is a real broken checksum.
read -r S L R <<<"$(make_scenario redirect-aliasbad)"
run_deploy "$S" "$L" "$R"
if [ "$RC" != 0 ] && has "$out" "a broken alias checksum on R2"; then
  pass "A29-CONTROL: an R2-served alias checksum that disagrees with the pointer refuses (rc=$RC)"
else
  bad "A29-CONTROL: a wrong R2 alias checksum was not caught (rc=$RC); out=$out"
fi

[ "$fails" -eq 0 ] || { echo "$fails failing arm(s)"; exit 1; }
echo "test-deploy-site-served-win-3600: all 29 arms passed"
