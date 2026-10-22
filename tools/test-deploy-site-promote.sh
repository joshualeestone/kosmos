#!/usr/bin/env bash
# test-deploy-site-promote.sh - the #2195 --promote mode of deploy-site.sh.
#
# --promote publishes a latest.json that INTENTIONALLY differs from the live one (a staging->prod
# promote, or a rollback). It must: skip the committed-vs-live guard (which is CORRECT for a
# site-copy deploy and would refuse a promote); derive the artifact from the COMMITTED pointer, not
# live; pin the committed pointer's advertised sha to the served bytes; derive the unversioned alias
# from the promoted bytes rather than fetching the stale live one; and keep every other guard.
#
# The real deploy-site.sh fetches artifacts over HTTP and runs `vercel deploy --prod`. Both are
# stubbed on PATH: a stub `curl` serves files from a fake LIVE dir keyed on the URL path, and a stub
# `vercel` publishes the export (its cwd) into LIVE so the post-deploy served-by-content verify runs
# against what was "deployed". Every assertion below has a control that can return the dangerous
# answer (the site-copy path STILL refusing the moved pointer is the load-bearing one).
#
#   bash tools/test-deploy-site-promote.sh
set -uo pipefail
# kosmos#6149: these fixtures are 0.6.x builds, older than the setup floor (0.7.45), so the floor is lowered here.
# tools/test-setup-floor-6149.sh tests the floor itself; this file tests deploy-site's other behaviour.
export KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=0.0.0
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DEPLOY="$HERE/deploy-site.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/deploy-promote-test.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

OLD=0.6.30
NEW=0.6.31
OLDART="kosmos-$OLD-arm64.tar.gz"
NEWART="kosmos-$NEW-arm64.tar.gz"
WINZIP="kosmos-$OLD-win-x64.zip"
HOSTURL="https://fake.test"

# ---- stubs on PATH (curl serves from LIVE, vercel publishes the export into LIVE) --------------
BIN="$T/bin"; mkdir -p "$BIN"
cat > "$BIN/curl" <<'CURL'
#!/bin/bash
# Minimal curl stub: serves $LIVE_DIR keyed on the URL path under $HOST_URL.
# Handles -o <dest>, -w <fmt> (prints an http code), -H <val> (ignored). Missing file -> exit 22
# (curl's failure code, which every -f caller treats as a refuse). The -w path never uses -f, so it
# returns 404 as a body-less code rather than failing (matches served_200's -sSL usage).
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
# NB: not `path=` -- in zsh `path` is tied to PATH, and tools/test-zsh-tied-names.sh
# statically refuses any shell file that writes it (a file sourced into zsh would clobber PATH).
served_file="$LIVE_DIR/$rel"
# kosmos#6620's mid-run arm: once, when the run fetches FREEZE_MID_RUN_ON, push the freeze waiting in FREEZE_MID_RUN_CLONE
# (another machine freezing while this deploy fetches its artifacts, after its early freeze check).
if [ -n "${FREEZE_MID_RUN_ON:-}" ] && [ "$rel" = "$FREEZE_MID_RUN_ON" ] && [ ! -e "$FREEZE_MID_RUN_CLONE.pushed" ]; then
  git -C "$FREEZE_MID_RUN_CLONE" push -q origin main 2>/dev/null && : > "$FREEZE_MID_RUN_CLONE.pushed"
fi
# #5589: an edge that cannot be reached for one file: <name>.down answers like a failed connection
# (curl prints 000 for -w and exits 7). <name>.dropafter is served once, then goes down.
case "$rel" in *must-404.bin)
  if [ -n "${CONTROL_DOWN:-}" ]; then [ -n "$wfmt" ] && printf '000'; exit 7; fi
  if [ -n "${CONTROL_200:-}" ]; then [ -n "$dest" ] && printf 'soft 404 page\n' > "$dest"; [ -n "$wfmt" ] && printf '200'; exit 0; fi ;;
esac
if [ -f "$served_file.err503" ]; then [ -n "$wfmt" ] && printf '503'; exit 0; fi
if [ -f "$served_file.down" ]; then
  if [ -n "$wfmt" ]; then printf '000'; fi
  exit 7
fi
if [ -f "$served_file.dropafter" ] && [ -f "$served_file" ]; then
  [ -n "$dest" ] && cp "$served_file" "$dest"
  [ -n "$wfmt" ] && printf '200'
  [ -n "$dest" ] || [ -n "$wfmt" ] || cat "$served_file"
  mv "$served_file.dropafter" "$served_file.down"
  exit 0
fi
# An edge that is late (#4819): a file held back as <name>.late answers 404 once, then is served.
if [ ! -f "$served_file" ] && [ -f "$served_file.late" ]; then
  mv "$served_file.late" "$served_file"
  if [ -n "$wfmt" ]; then printf '404'; exit 0; fi
  exit 22
fi
if [ -n "$wfmt" ]; then
  if [ -f "$served_file" ]; then [ -n "$dest" ] && cp "$served_file" "$dest"; printf '200'
  else
    # #5589: VARY_404=1 makes every 404 carry a different body, as a host's error page can.
    [ -n "${VARY_404:-}" ] && [ -n "$dest" ] && printf 'not found, request %s-%s\n' "$$" "$RANDOM" > "$dest"
    printf '404'
  fi
  exit 0
fi
[ -f "$served_file" ] || exit 22
if [ -n "$dest" ]; then cp "$served_file" "$dest"; else cat "$served_file"; fi
exit 0
CURL
chmod +x "$BIN/curl"
cat > "$BIN/vercel" <<'VERCEL'
#!/bin/bash
# `vercel deploy --prod --yes` runs with the EXPORT as cwd. Publish it into LIVE (additive copy;
# a real deploy replaces the site, but additive is enough to run the served-verify honestly).
mkdir -p "$LIVE_DIR/dist"
[ -d ./dist ] && cp -R ./dist/. "$LIVE_DIR/dist/" 2>/dev/null
for f in setup setup.sha256 setup-staging setup-staging.sha256 index.html vercel.json; do [ -f "./$f" ] && cp "./$f" "$LIVE_DIR/$f"; done
# A deploy that silently drops one file (the #1669 shape): the post-deploy served-verify must catch it.
[ -n "${DROP_FROM_DEPLOY:-}" ] && rm -f "$LIVE_DIR/dist/$DROP_FROM_DEPLOY"
# A deploy that serves DIFFERENT bytes for one file than the export held (#4819).
[ -n "${MANGLE_ON_DEPLOY:-}" ] && printf ' ' >> "$LIVE_DIR/dist/$MANGLE_ON_DEPLOY"
[ -n "${LATE_ON_DEPLOY:-}" ] && mv "$LIVE_DIR/dist/$LATE_ON_DEPLOY" "$LIVE_DIR/dist/$LATE_ON_DEPLOY.late"
# #5032: a site-root file served with different bytes than the export held.
[ -n "${MANGLE_ROOT_ON_DEPLOY:-}" ] && printf ' ' >> "$LIVE_DIR/$MANGLE_ROOT_ON_DEPLOY"
# #5032: a served sidecar whose FIRST field names other bytes (an appended byte would land after the newline).
[ -n "${LIE_SIDECAR_ON_DEPLOY:-}" ] && printf '%064d  setup\n' 0 > "$LIVE_DIR/$LIE_SIDECAR_ON_DEPLOY"
# #5032 review 13: an edge still serving an OLD but self-consistent /setup pair (the stale-cache shape after a promote).
[ -n "${STALE_SETUP_ON_DEPLOY:-}" ] && printf 'OLD-INSTALLER\n' > "$LIVE_DIR/setup" && ( cd "$LIVE_DIR" && shasum -a 256 setup > setup.sha256 )
exit 0
VERCEL
chmod +x "$BIN/vercel"

sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }
# write a pointer JSON. args: <file> <version> <sha> <artifact>
write_ptr() { printf '{"version":"%s","sha256":"%s","artifact":"%s","manifest":"kosmos-%s-arm64.manifest.json"}\n' "$2" "$3" "$4" "$2" > "$1"; }

# ---- build a fresh scenario: a SITE checkout committed at NEW, a LIVE serving OLD -------------
# Each call returns "SITE LIVE" and leaves globals unset; callers pass them to run_deploy.
make_scenario() {  # [committed_sha_override]
  local s live d
  s="$(mktemp -d "$T/site.XXXXXX")"; live="$(mktemp -d "$T/live.XXXXXX")"
  mkdir -p "$s/dist" "$live/dist"

  # --- the LIVE (served) state: OLD prod pointer + OLD alias, but the NEW versioned artifact is
  #     ALREADY served (the staging cut published it). Plus the version-independent artifacts. ---
  printf 'NEW-ARTIFACT-BYTES-%s\n' "$NEW" > "$live/dist/$NEWART"
  ( cd "$live/dist" && shasum -a 256 "$NEWART" > "$NEWART.sha256" )
  printf 'OLD-ALIAS-BYTES-%s\n' "$OLD" > "$live/dist/kosmos-arm64.tar.gz"
  ( cd "$live/dist" && shasum -a 256 kosmos-arm64.tar.gz > kosmos-arm64.tar.gz.sha256 )
  printf 'TMUX-BYTES\n' > "$live/dist/tmux-arm64.tar.gz"
  ( cd "$live/dist" && shasum -a 256 tmux-arm64.tar.gz > tmux-arm64.tar.gz.sha256 )
  printf 'PKG-BYTES\n' > "$live/dist/Kosmos.pkg"
  ( cd "$live/dist" && shasum -a 256 Kosmos.pkg > Kosmos.pkg.sha256 )
  printf 'in\npkg:z\n' > "$live/dist/Kosmos.pkg.inputs"
  printf 'WINZIP\n' > "$live/dist/$WINZIP"
  # the sidecar and the UNVERSIONED alias pair: deploy-site.sh honest-marker-checks both before the
  # deploy and served-verifies both after it. Without them this fixture refuses at the export check
  # and nine assertions below collapse for a reason unrelated to what they test.
  ( cd "$live/dist" && shasum -a 256 "$WINZIP" > "$WINZIP.sha256" )
  printf 'WINALIAS\n' > "$live/dist/kosmos-win-x64.zip"
  ( cd "$live/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  printf 'setup-script KOSMOS_READONLY_APP\n' > "$live/setup"
  # #2511/#1666: deploy-site's post-deploy edge-check re-fetches the (setup, setup.sha256) pair and
  # refuses a mismatch (the pair the .pkg postinstall verifies). Publish a matching setup.sha256.
  ( cd "$live" && shasum -a 256 setup > setup.sha256 )
  local newsha; newsha="$(sha_of "$live/dist/$NEWART")"
  write_ptr "$live/dist/latest.json" "$OLD" "oldsha000000" "$OLDART"   # LIVE prod = OLD

  # --- the SITE checkout: committed at the NEW pointer (promote-channel already moved it) ---
  git init -q --initial-branch=main "$s"   # #3073: pin the branch so the deploy-site non-main-publish guard sees 'main' regardless of the ambient init.defaultBranch (matches tools/test-release-detached.sh)
  printf '<h1>site</h1>\n' > "$s/index.html"; printf '{}\n' > "$s/vercel.json"
  printf 'docs/\n' > "$s/.vercelignore"
  printf 'setup-script KOSMOS_READONLY_APP\n' > "$s/setup"
  printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$s/.gitignore"
  local csha="${1:-$newsha}"
  write_ptr "$s/dist/latest.json" "$NEW" "$csha" "$NEWART"            # COMMITTED = NEW
  printf 'WINZIP\n' > "$s/dist/$WINZIP"                                # tracked win zip
  ( cd "$s/dist" && shasum -a 256 "$WINZIP" > "$WINZIP.sha256" )       # ...and its tracked sidecar
  printf 'WINALIAS\n' > "$s/dist/kosmos-win-x64.zip"                   # the unversioned win alias
  ( cd "$s/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  git -C "$s" add -A && git -C "$s" commit -q -m "site at $NEW"
  mkdir -p "$s/.vercel"; printf '{"projectId":"p"}\n' > "$s/.vercel/project.json"
  printf '%s %s' "$s" "$live"
}

run_deploy() {  # <site> <live> <flag...> ; echoes output, sets RC
  local s="$1" live="$2"; shift 2
  out="$(PATH="$BIN:$PATH" LIVE_DIR="$live" HOST_URL="$HOSTURL" \
    KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" \
    ${DEPLOY_SHELL:-bash} "$DEPLOY" "$@" 2>&1)"   # DEPLOY_SHELL=dash: the arms that run it as /bin/sh is on Linux
  RC=$?
}

# =============================================================================================
# 1) --promote deploys the MOVED pointer (committed NEW != live OLD): exit 0, and it serves NEW.
read -r S L <<<"$(make_scenario)"
run_deploy "$S" "$L" --promote
[ "$RC" = 0 ] && pass "promote: exit 0 on a moved pointer (committed NEW, live OLD)" || bad "promote exit (rc=$RC) out=$out"
served_v="$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L/dist/latest.json")"
[ "$served_v" = "$NEW" ] && pass "promote: LIVE now serves the NEW pointer ($NEW)" || bad "promote did not move the served pointer (got '$served_v')"
served_art="$(sed -n 's/.*"artifact":[[:space:]]*"\([^"]*\)".*/\1/p' "$L/dist/latest.json")"
[ "$served_art" = "$NEWART" ] && pass "promote: the served pointer names the NEW artifact (from the COMMITTED pointer, not live)" || bad "served pointer names '$served_art', not $NEWART"

# 2) THE LOAD-BEARING CONTROL: site-copy (--publish) STILL refuses the same moved pointer.
read -r S2 L2 <<<"$(make_scenario)"
run_deploy "$S2" "$L2" --publish
[ "$RC" = 1 ] && has "$out" "COMMITTED latest.json differs from LIVE" && pass "site-copy: --publish STILL refuses a moved pointer (the guard is intact for non-promote)" || bad "--publish did not refuse the moved pointer (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L2/dist/latest.json")" = "$OLD" ] && pass "site-copy: the refusal left LIVE on OLD (nothing deployed)" || bad "site-copy refusal still changed LIVE"

# 3) --promote derives the unversioned alias from the PROMOTED bytes, not the stale live alias.
read -r S3 L3 <<<"$(make_scenario)"
run_deploy "$S3" "$L3" --promote
[ "$RC" = 0 ] || bad "promote(3) unexpected rc=$RC out=$out"
if cmp -s "$L3/dist/kosmos-arm64.tar.gz" "$L3/dist/$NEWART"; then
  pass "promote: the served alias kosmos-arm64.tar.gz == the NEW versioned artifact (derived, not the stale live alias)"
else
  bad "the served alias is not the promoted bytes (still the stale OLD alias?)"
fi
( cd "$L3/dist" && shasum -a 256 --status -c kosmos-arm64.tar.gz.sha256 ) && pass "promote: the served alias .sha256 verifies in place against the new bytes" || bad "the served alias .sha256 does not verify"

# 4) --promote refuses a committed pointer whose sha does NOT describe the served bytes.
#    (Red-capable: the committed pointer advertises a wrong sha; the served NEW artifact is real.)
read -r S4 L4 <<<"$(make_scenario deadbeefdeadbeef)"
run_deploy "$S4" "$L4" --promote
[ "$RC" = 1 ] && has "$out" "does not describe the served bytes" && pass "promote: refuses when the committed pointer's sha != the served artifact" || bad "promote did not refuse a lying committed sha (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L4/dist/latest.json")" = "$OLD" ] && pass "promote: the sha-mismatch refusal left LIVE on OLD" || bad "the sha-mismatch refusal still moved LIVE"

# 5) --promote refuses when there is nothing to promote (committed == live).
read -r S5 L5 <<<"$(make_scenario)"
# make the committed pointer equal live: rewrite LIVE's latest.json to the committed NEW pointer.
cp "$S5/dist/latest.json" "$L5/dist/latest.json"
run_deploy "$S5" "$L5" --promote
[ "$RC" = 1 ] && has "$out" "nothing to promote" && pass "promote: refuses when the committed pointer already equals live (nothing to promote)" || bad "promote did not refuse a no-op promote (rc=$RC) out=$out"

# 6) a plain dry run (no flag) is unaffected: it takes the site-copy path and refuses the moved
#    pointer at the guard (proving --promote did not weaken the default).
read -r S6 L6 <<<"$(make_scenario)"
run_deploy "$S6" "$L6"
[ "$RC" = 1 ] && has "$out" "COMMITTED latest.json differs from LIVE" && pass "no-flag dry run: still the site-copy path, still guarded" || bad "the default path changed (rc=$RC) out=$out"

# =============================================================================================
# #2159: the release-notes auto-post hook fires ONLY on a FORWARD promote, never a rollback.
# The hook is DRY-RUN by construction here (no KOSMOS_SOCIAL_AUTOPOST / no creds), so the assertion
# is on which BRANCH deploy-site.sh took -- the announce branch invokes post-release-notes.sh (which
# prints "composing release-notes posts for <V>"), the skip branches print "skipping the notes hook".

# 7) FORWARD promote (committed NEW > live OLD) => the hook ANNOUNCES the new version.
read -r S7 L7 <<<"$(make_scenario)"
run_deploy "$S7" "$L7" --promote
[ "$RC" = 0 ] || bad "promote(7,forward) unexpected rc=$RC out=$out"
if has "$out" "composing release-notes posts for $NEW" && ! has "$out" "skipping the notes hook"; then
  pass "#2159: a FORWARD promote fires the release-notes hook for the new version ($NEW)"
else
  bad "#2159: forward promote did not fire the announce hook (out=$out)"
fi

# 8) ROLLBACK promote (committed OLD < live NEW) => the hook SKIPS (a rollback must not announce).
#    Build the mirror scenario: LIVE serves the NEW pointer and ALSO serves the OLD artifact
#    (verifiable), the SITE is committed at the OLD pointer -> deploy-site --promote rolls prod back.
make_rollback_scenario() {  # echoes "SITE LIVE"
  local s live
  s="$(mktemp -d "$T/rbsite.XXXXXX")"; live="$(mktemp -d "$T/rblive.XXXXXX")"
  mkdir -p "$s/dist" "$live/dist"
  # LIVE serves NEW; the OLD versioned artifact is ALSO present + verifiable (we roll back TO it).
  printf 'OLD-ARTIFACT-BYTES-%s\n' "$OLD" > "$live/dist/$OLDART"
  ( cd "$live/dist" && shasum -a 256 "$OLDART" > "$OLDART.sha256" )
  printf 'NEW-ALIAS-BYTES-%s\n' "$NEW" > "$live/dist/kosmos-arm64.tar.gz"
  ( cd "$live/dist" && shasum -a 256 kosmos-arm64.tar.gz > kosmos-arm64.tar.gz.sha256 )
  printf 'TMUX-BYTES\n' > "$live/dist/tmux-arm64.tar.gz"
  ( cd "$live/dist" && shasum -a 256 tmux-arm64.tar.gz > tmux-arm64.tar.gz.sha256 )
  printf 'PKG-BYTES\n' > "$live/dist/Kosmos.pkg"
  ( cd "$live/dist" && shasum -a 256 Kosmos.pkg > Kosmos.pkg.sha256 )
  printf 'in\npkg:z\n' > "$live/dist/Kosmos.pkg.inputs"
  printf 'WINZIP\n' > "$live/dist/$WINZIP"
  # the sidecar and the UNVERSIONED alias pair: deploy-site.sh honest-marker-checks both before the
  # deploy and served-verifies both after it. Without them this fixture refuses at the export check
  # and nine assertions below collapse for a reason unrelated to what they test.
  ( cd "$live/dist" && shasum -a 256 "$WINZIP" > "$WINZIP.sha256" )
  printf 'WINALIAS\n' > "$live/dist/kosmos-win-x64.zip"
  ( cd "$live/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  printf 'setup-script KOSMOS_READONLY_APP\n' > "$live/setup"
  # #2511/#1666: deploy-site's post-deploy edge-check re-fetches the (setup, setup.sha256) pair and
  # refuses a mismatch (the pair the .pkg postinstall verifies). Publish a matching setup.sha256.
  ( cd "$live" && shasum -a 256 setup > setup.sha256 )
  local oldsha; oldsha="$(sha_of "$live/dist/$OLDART")"
  write_ptr "$live/dist/latest.json" "$NEW" "newsha000000" "$NEWART"   # LIVE prod = NEW
  git init -q --initial-branch=main "$s"   # #3073: pin the branch so the deploy-site non-main-publish guard sees 'main' regardless of the ambient init.defaultBranch (matches tools/test-release-detached.sh)
  printf '<h1>site</h1>\n' > "$s/index.html"; printf '{}\n' > "$s/vercel.json"
  printf 'docs/\n' > "$s/.vercelignore"
  printf 'setup-script KOSMOS_READONLY_APP\n' > "$s/setup"
  printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$s/.gitignore"
  write_ptr "$s/dist/latest.json" "$OLD" "$oldsha" "$OLDART"           # COMMITTED = OLD (rollback)
  printf 'WINZIP\n' > "$s/dist/$WINZIP"
  ( cd "$s/dist" && shasum -a 256 "$WINZIP" > "$WINZIP.sha256" )
  printf 'WINALIAS\n' > "$s/dist/kosmos-win-x64.zip"
  ( cd "$s/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  git -C "$s" add -A && git -C "$s" commit -q -m "site rolled back to $OLD"
  mkdir -p "$s/.vercel"; printf '{"projectId":"p"}\n' > "$s/.vercel/project.json"
  printf '%s %s' "$s" "$live"
}
read -r S8 L8 <<<"$(make_rollback_scenario)"
run_deploy "$S8" "$L8" --promote
[ "$RC" = 0 ] || bad "promote(8,rollback) unexpected rc=$RC out=$out"
if has "$out" "is not newer than" && has "$out" "skipping the notes hook" && ! has "$out" "composing release-notes posts"; then
  pass "#2159: a ROLLBACK promote SKIPS the release-notes hook (a rollback must not announce)"
else
  bad "#2159: rollback promote did not skip the announce hook (out=$out)"
fi

# =============================================================================================
# The Windows staging channel: a committed latest-win-staging.json names a staged zip that must ship
# WHOLE (zip, checksum, pointer) and be served-verified after the deploy -- the Windows box verifies
# the build from those served copies before any promote.
STAGEDZ="kosmos-0.6.99-win-x64.zip"
add_staged_win() {  # <site> [omit-sidecar] ; commits a staged Windows build into the site checkout
  local s="$1" sha
  printf 'STAGED-WINZIP\n' > "$s/dist/$STAGEDZ"
  ( cd "$s/dist" && shasum -a 256 "$STAGEDZ" > "$STAGEDZ.sha256" )
  sha="$(awk '{print $1}' "$s/dist/$STAGEDZ.sha256")"
  printf '{"version":"0.6.99","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"%s","arch":"x64"}\n' "$sha" "$STAGEDZ" > "$s/dist/latest-win-staging.json"
  [ "${2:-}" = omit-sidecar ] && rm -f "$s/dist/$STAGEDZ.sha256"
  git -C "$s" add -A && git -C "$s" commit -q -m "stage windows 0.6.99"
}

# 9) the staged build is carried and served: exit 0, and LIVE serves the zip, its sidecar and the pointer.
read -r S9 L9 <<<"$(make_scenario)"; add_staged_win "$S9"
run_deploy "$S9" "$L9" --promote
[ "$RC" = 0 ] && has "$out" "derived the staged Windows zip $STAGEDZ" && pass "win staged: a deploy carries and served-verifies the staged Windows build" || bad "win staged deploy (rc=$RC) out=$out"
{ [ -f "$L9/dist/$STAGEDZ" ] && [ -f "$L9/dist/$STAGEDZ.sha256" ] && cmp -s "$L9/dist/latest-win-staging.json" "$S9/dist/latest-win-staging.json"; } \
  && pass "win staged: LIVE serves the staged zip, its sidecar and the committed staging pointer" || bad "win staged: LIVE is missing part of the staged build"

# 10) a staged sidecar missing from the checkout refuses BEFORE the deploy (LIVE untouched).
read -r S10 L10 <<<"$(make_scenario)"; add_staged_win "$S10" omit-sidecar
run_deploy "$S10" "$L10" --promote
{ [ "$RC" = 1 ] && has "$out" "the export has no $STAGEDZ.sha256" && [ ! -f "$L10/dist/latest-win-staging.json" ]; } \
  && pass "win staged: an export without the staged sidecar refuses before any deploy" || bad "win staged missing sidecar (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L10/dist/latest.json")" = "$OLD" ] && pass "win staged: that refusal left LIVE on OLD" || bad "win staged: the pre-deploy refusal still changed LIVE"

# 11) a deploy that silently drops the staging pointer fails the post-deploy served-verify.
read -r S11 L11 <<<"$(make_scenario)"; add_staged_win "$S11"
export DROP_FROM_DEPLOY=latest-win-staging.json
run_deploy "$S11" "$L11" --promote
unset DROP_FROM_DEPLOY
[ "$RC" = 1 ] && has "$out" "latest-win-staging.json failed served-verify" && pass "win staged: a deploy that drops the staging pointer fails the served-verify" || bad "win staged dropped pointer (rc=$RC) out=$out"

# =============================================================================================
# #4819: the STAGED MAC build. A committed latest-staging.json names a third version, served by
# LIVE but absent from the checkout's dist/ (the 2026-09-30 19:52 shape). The real deploy-site.sh
# must carry it (fetched from LIVE), deploy it, and served-verify it.
STG=0.6.32
STGART="kosmos-$STG-arm64.tar.gz"
add_staged_mac() {  # <site> <live> [not-served]
  printf 'STAGED-MAC-BYTES-%s\n' "$STG" > "$T/stg-bytes"
  write_ptr "$1/dist/latest-staging.json" "$STG" "$(sha_of "$T/stg-bytes")" "$STGART"
  git -C "$1" add dist/latest-staging.json && git -C "$1" commit -q -m "staging at $STG"
  if [ "${3:-}" != not-served ]; then
    cp "$T/stg-bytes" "$2/dist/$STGART"
    ( cd "$2/dist" && shasum -a 256 "$STGART" > "$STGART.sha256" )
  fi
}

# 12) carried from LIVE, deployed, served-verified.
read -r S12 L12 <<<"$(make_scenario)"; add_staged_mac "$S12" "$L12"
run_deploy "$S12" "$L12" --promote
{ [ "$RC" = 0 ] && has "$out" "fetching the one live serves" && [ -f "$S12/dist/$STGART" ] && [ -f "$S12/dist/$STGART.sha256" ]; } \
  && pass "mac staged: a checkout without the staged Mac build fetches it from LIVE and the deploy succeeds" || bad "mac staged carry (rc=$RC) out=$out"

# 13) a deploy that drops it is caught by the post-deploy served-verify (the pair is checked).
read -r S13 L13 <<<"$(make_scenario)"; add_staged_mac "$S13" "$L13"
export DROP_FROM_DEPLOY="$STGART"
run_deploy "$S13" "$L13" --promote
unset DROP_FROM_DEPLOY
[ "$RC" = 1 ] && has "$out" "SERVED dist/$STGART could not be fetched after deploy" && pass "mac staged: a deploy that drops the staged Mac build fails the served-verify" || bad "mac staged dropped (rc=$RC) out=$out"

# 14) neither the checkout nor LIVE has it: refuse BEFORE the deploy, naming it, LIVE untouched.
read -r S14 L14 <<<"$(make_scenario)"; add_staged_mac "$S14" "$L14" not-served
run_deploy "$S14" "$L14" --promote
{ [ "$RC" = 1 ] && has "$out" "live does not serve $STGART.sha256 either" && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L14/dist/latest.json")" = "$OLD" ]; } \
  && pass "mac staged: no copy anywhere refuses before any deploy, naming $STGART, LIVE left on OLD" || bad "mac staged not served (rc=$RC) out=$out"

# 15) a checkout committing an OLDER staging than LIVE serves refuses before any deploy, LIVE
#     untouched; the same checkout with KOSMOS_STAGING_ROLLBACK naming its version goes through.
read -r S15 L15 <<<"$(make_scenario)"; add_staged_mac "$S15" "$L15"
write_ptr "$L15/dist/latest-staging.json" 0.6.33 "$(sha_of "$T/stg-bytes")" kosmos-0.6.33-arm64.tar.gz
cp "$L15/dist/latest-staging.json" "$T/live-staging-before"
run_deploy "$S15" "$L15" --promote
{ [ "$RC" = 1 ] && has "$out" "live staging is 0.6.33" && cmp -s "$L15/dist/latest-staging.json" "$T/live-staging-before" && [ ! -e "$S15/dist/$NEWART" ] \
  && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L15/dist/latest.json")" = "$OLD" ]; } \
  && pass "mac staged: a checkout behind LIVE's staging refuses before any fetch or deploy, LIVE untouched" || bad "mac staged stale checkout (rc=$RC) out=$out"
KOSMOS_STAGING_ROLLBACK="$STG" run_deploy "$S15" "$L15" --promote   # inline, as the usage says
{ [ "$RC" = 0 ] && has "$out" "rolling staging back from 0.6.33 to $STG" && has "$(cat "$L15/dist/latest-staging.json")" "$STGART"; } \
  && pass "mac staged: KOSMOS_STAGING_ROLLBACK=$STG deploys the deliberate rollback" || bad "mac staged rollback (rc=$RC) out=$out"

# 16) the served staging pointer must be the committed one after the deploy.
read -r S16 L16 <<<"$(make_scenario)"; add_staged_mac "$S16" "$L16"
export MANGLE_ON_DEPLOY=latest-staging.json
run_deploy "$S16" "$L16" --promote
unset MANGLE_ON_DEPLOY
[ "$RC" = 1 ] && has "$out" "the served latest-staging.json is not the committed one" && pass "mac staged: a deploy serving a different staging pointer than committed fails the post-deploy check" || bad "mac staged pointer mangled (rc=$RC) out=$out"

# 19) a staging pointer published where there was none: the edge answers 404 once after the deploy,
#     and the post-deploy check reads again rather than failing a good deploy.
read -r S19 L19 <<<"$(make_scenario)"; add_staged_mac "$S19" "$L19"
LATE_ON_DEPLOY=latest-staging.json run_deploy "$S19" "$L19" --promote
{ [ "$RC" = 0 ] && cmp -s "$L19/dist/latest-staging.json" "$S19/dist/latest-staging.json"; } \
  && pass "mac staged: a staging pointer the edge serves late (404 once) does not fail a good deploy" || bad "mac staged late pointer (rc=$RC) out=$out"

# 20) a malformed committed staging pointer, live serving none: refused before any artifact is
#     downloaded into the shared dist/.
read -r S20 L20 <<<"$(make_scenario)"
write_ptr "$S20/dist/latest-staging.json" 0.6.32 "$(printf 'x' | shasum -a 256 | awk '{print $1}')" not-a-build.zip
git -C "$S20" add dist/latest-staging.json && git -C "$S20" commit -q -m "malformed staging"
run_deploy "$S20" "$L20" --promote
# kosmos#6149: the setup floor now refuses the malformed artifact name first (fail closed), before any fetch too.
# (deploy-site's own #4819 refusal is now shadowed for this shape by the floor's, which fires first.)
{ [ "$RC" = 1 ] && has "$out" "names artifact not-a-build.zip" && [ ! -e "$S20/dist/$NEWART" ]; } \
  && pass "mac staged: a malformed committed staging pointer refuses before any fetch" || bad "mac staged malformed (rc=$RC) out=$out"

# 17) THE INCIDENT'S PATH: a plain site-copy --publish (live latest.json == committed), from a checkout
#     whose dist/ lacks the staged tarball, carries it from LIVE and deploys.
read -r S17 L17 <<<"$(make_scenario)"; cp "$S17/dist/latest.json" "$L17/dist/latest.json"; add_staged_mac "$S17" "$L17"
run_deploy "$S17" "$L17" --publish
{ [ "$RC" = 0 ] && has "$out" "fetching the one live serves" && [ -f "$S17/dist/$STGART" ] && cmp -s "$L17/dist/latest-staging.json" "$S17/dist/latest-staging.json"; } \
  && pass "mac staged (--publish): a site-copy deploy from a checkout without the staged build carries it and deploys" || bad "mac staged publish carry (rc=$RC) out=$out"

# 18) the same site-copy --publish from a checkout behind LIVE's staging refuses before any fetch.
read -r S18 L18 <<<"$(make_scenario)"; cp "$S18/dist/latest.json" "$L18/dist/latest.json"; add_staged_mac "$S18" "$L18"
write_ptr "$L18/dist/latest-staging.json" 0.6.33 "$(sha_of "$T/stg-bytes")" kosmos-0.6.33-arm64.tar.gz
run_deploy "$S18" "$L18" --publish
{ [ "$RC" = 1 ] && has "$out" "live staging is 0.6.33" && [ ! -e "$S18/dist/$NEWART" ] && has "$(cat "$L18/dist/latest-staging.json")" "0.6.33"; } \
  && pass "mac staged (--publish): a site-copy deploy from a checkout behind LIVE's staging refuses before any fetch" || bad "mac staged publish stale (rc=$RC) out=$out"

# =============================================================================================
# #5032: the pointer NAMES its installer (setup_sha256). Every deploy refuses a committed /setup that is
# not that installer. Scenarios 1-18 above use pointers with no field, so they are the "not checked" control.
with_setup() {  # <site> <installer-text>: commit a setup pair with that text, and make the committed pointer name <named-sha> (arg 3, default the pair's own)
  local s="$1"; printf '%s KOSMOS_READONLY_APP\n' "$2" > "$s/setup"; ( cd "$s" && shasum -a 256 setup > setup.sha256 )
  local named="${3:-$(sha_of "$s/setup")}"
  node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.setup_sha256=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(p)+"\n")' "$s/dist/latest.json" "$named"
  git -C "$s" add setup setup.sha256 dist/latest.json && git -C "$s" commit -q -m "pointer names its installer"
}
# 19) a promote whose committed /setup IS the installer the pointer names: deploys, and serves it.
read -r S19 L19 <<<"$(make_scenario)"; with_setup "$S19" "NEW-INSTALLER"
run_deploy "$S19" "$L19" --promote
{ [ "$RC" = 0 ] && [ "$(cat "$L19/setup")" = "NEW-INSTALLER KOSMOS_READONLY_APP" ]; } && pass "#5032: a promote whose /setup is the pointer's installer deploys and serves it" || bad "#5032 matching promote (rc=$RC) out=$out"
# 20) a promote whose committed /setup is NOT that installer (promote-channel's copy not committed, or a
#     rollback that kept the newer installer): refused before anything is served.
read -r S20 L20 <<<"$(make_scenario)"; with_setup "$S20" "OLD-INSTALLER" "$(printf 'NEW-INSTALLER\n' | shasum -a 256 | awk '{print $1}')"
run_deploy "$S20" "$L20" --promote
{ [ "$RC" = 1 ] && has "$out" "names installer" && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L20/dist/latest.json")" = "$OLD" ] && [ "$(cat "$L20/setup")" = "setup-script KOSMOS_READONLY_APP" ]; } \
  && pass "#5032: a promote whose /setup is not the pointer's installer is refused, nothing served" || bad "#5032 mismatched promote (rc=$RC) out=$out"
# 21) the same mismatch on a site-copy --publish (committed pointer == live): refused too.
read -r S21 L21 <<<"$(make_scenario)"; with_setup "$S21" "OLD-INSTALLER" "$(printf 'NEW-INSTALLER\n' | shasum -a 256 | awk '{print $1}')"; cp "$S21/dist/latest.json" "$L21/dist/latest.json"
run_deploy "$S21" "$L21" --publish
{ [ "$RC" = 1 ] && has "$out" "names installer"; } && pass "#5032: a site-copy deploy whose /setup is not the pointer's installer is refused" || bad "#5032 mismatched publish (rc=$RC) out=$out"
# 22) a sidecar that does not name the committed setup, under a pointer that does: refused.
read -r S22 L22 <<<"$(make_scenario)"; with_setup "$S22" "NEW-INSTALLER"; printf '%064d  setup\n' 0 > "$S22/setup.sha256"; git -C "$S22" commit -qam "bad sidecar"
run_deploy "$S22" "$L22" --promote
{ [ "$RC" = 1 ] && has "$out" "setup.sha256 names"; } && pass "#5032: a committed setup.sha256 that does not name the installer is refused" || bad "#5032 bad sidecar (rc=$RC) out=$out"

# 23) a committed /setup-staging pair is served and edge-checked after the deploy (review 3: run, not grepped).
read -r S23 L23 <<<"$(make_scenario)"; with_setup "$S23" "NEW-INSTALLER"
printf 'NEXT-STAGING-INSTALLER KOSMOS_READONLY_APP\n' > "$S23/setup-staging"; ( cd "$S23" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
git -C "$S23" add setup-staging setup-staging.sha256 && git -C "$S23" commit -q -m "staging installer"
run_deploy "$S23" "$L23" --promote
{ [ "$RC" = 0 ] && [ "$(cat "$L23/setup-staging")" = "NEXT-STAGING-INSTALLER KOSMOS_READONLY_APP" ]; } && pass "#5032: a committed /setup-staging pair deploys and passes its edge check" || bad "#5032 setup-staging edge (rc=$RC) out=$out"
# 24) ...and a served /setup-staging.sha256 that does not describe the served script is refused.
read -r S24 L24 <<<"$(make_scenario)"; with_setup "$S24" "NEW-INSTALLER"
printf 'NEXT-STAGING-INSTALLER KOSMOS_READONLY_APP\n' > "$S24/setup-staging"; ( cd "$S24" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
git -C "$S24" add setup-staging setup-staging.sha256 && git -C "$S24" commit -q -m "staging installer"
out="$(MANGLE_ROOT_ON_DEPLOY=setup-staging PATH="$BIN:$PATH" LIVE_DIR="$L24" HOST_URL="$HOSTURL" KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$S24" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" bash "$DEPLOY" --promote 2>&1)"; RC=$?
{ [ "$RC" = 1 ] && has "$out" "is not the committed setup-staging"; } && pass "#5032: a served /setup-staging that is not the committed one is refused at the edge" || bad "#5032 setup-staging mangled (rc=$RC) out=$out"
# 25) a pointer naming an installer over a commit with no setup.sha256: refused before anything is served.
read -r S25 L25 <<<"$(make_scenario)"; with_setup "$S25" "NEW-INSTALLER"; git -C "$S25" rm -q setup.sha256 && git -C "$S25" commit -q -m "no sidecar"
run_deploy "$S25" "$L25" --promote
{ [ "$RC" = 1 ] && has "$out" "has no setup or setup.sha256" && [ "$(cat "$L25/setup")" = "setup-script KOSMOS_READONLY_APP" ]; } && pass "#5032: a pointer naming an installer over a commit with no sidecar is refused" || bad "#5032 missing sidecar (rc=$RC) out=$out"

# 26) the served script is the committed one, but its served sidecar names other bytes: refused at the edge.
read -r S26 L26 <<<"$(make_scenario)"; with_setup "$S26" "NEW-INSTALLER"
printf 'NEXT-STAGING-INSTALLER KOSMOS_READONLY_APP\n' > "$S26/setup-staging"; ( cd "$S26" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
git -C "$S26" add setup-staging setup-staging.sha256 && git -C "$S26" commit -q -m "staging installer"
out="$(LIE_SIDECAR_ON_DEPLOY=setup-staging.sha256 PATH="$BIN:$PATH" LIVE_DIR="$L26" HOST_URL="$HOSTURL" KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$S26" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" bash "$DEPLOY" --promote 2>&1)"; RC=$?
{ [ "$RC" = 1 ] && has "$out" "does NOT match its served /setup-staging.sha256"; } && pass "#5032: a served /setup-staging.sha256 that names other bytes is refused at the edge" || bad "#5032 lying staging sidecar (rc=$RC) out=$out"
# 27) the served /setup and its sidecar agree with each other but are an OLD installer, not the one the committed
#     pointer names (a stale edge pair): refused. Case 19 is the control (the same promote, served fresh, passes).
read -r S27 L27 <<<"$(make_scenario)"; with_setup "$S27" "NEW-INSTALLER"
out="$(STALE_SETUP_ON_DEPLOY=1 PATH="$BIN:$PATH" LIVE_DIR="$L27" HOST_URL="$HOSTURL" KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$S27" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" bash "$DEPLOY" --promote 2>&1)"; RC=$?
{ [ "$RC" = 1 ] && has "$out" "is not the installer the committed latest.json names"; } && pass "#5032: a served /setup pair that agrees with itself but is not the pointer's installer is refused at the edge" || bad "#5032 stale self-consistent /setup (rc=$RC) out=$out"
# 28) #5589: a release cut publishes a pointer WHILE this run is fetching and building. The stub's .late
#     mechanism serves latest-win-staging.json as 404 on its first read (the snapshot taken before any
#     fetch) and as a real pointer from then on, i.e. a cut landed in between. The pre-deploy re-read must
#     see the change and refuse with nothing deployed. Case 1 is the control: the same promote, with every
#     live pointer unchanged across the run, deploys.
read -r S28 L28 <<<"$(make_scenario)"
printf '{"version":"9.9.9"}\n' > "$L28/dist/latest-win-staging.json.late"
run_deploy "$S28" "$L28" --promote
{ [ "$RC" = 75 ] && has "$out" "a live pointer changed while this run was building" \
  && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L28/dist/latest.json")" = "$OLD" ]; } \
  && pass "#5589: a live pointer moved mid-run (a cut published) is refused before the deploy, LIVE untouched" \
  || bad "#5589 mid-run pointer move (rc=$RC) out=$out"
# 28b) #5589: the same mid-run move under --publish, the mode site-autodeploy.sh runs. Live serves the
#      committed pointer, so the only thing that can refuse is the mid-run re-read. Control: the same
#      scenario without the late pointer publishes (rc 0).
read -r S28c L28c <<<"$(make_scenario)"; cp "$S28c/dist/latest.json" "$L28c/dist/latest.json"
run_deploy "$S28c" "$L28c" --publish
[ "$RC" = 0 ] && pass "#5589 control: --publish with live = committed and no pointer moving deploys" || bad "#5589 --publish control (rc=$RC) out=$out"
read -r S28b L28b <<<"$(make_scenario)"; cp "$S28b/dist/latest.json" "$L28b/dist/latest.json"
printf '{"version":"9.9.9"}\n' > "$L28b/dist/latest-win-staging.json.late"
run_deploy "$S28b" "$L28b" --publish
{ [ "$RC" = 75 ] && has "$out" "a live pointer changed while this run was building"; } \
  && pass "#5589: --publish refuses a pointer moved mid-run (exit 75)" || bad "#5589 --publish mid-run move (rc=$RC) out=$out"
# 29) #5589: a pointer that is absent live (404) is compared by status only, so a 404 page whose body
#     differs per request does not read as a moved pointer. latest-win-staging.json is absent in this
#     scenario, so both snapshots see a 404 with a different body.
read -r SA LA <<<"$(make_scenario)"
out="$(VARY_404=1 PATH="$BIN:$PATH" LIVE_DIR="$LA" HOST_URL="$HOSTURL" KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$SA" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" bash "$DEPLOY" --promote 2>&1)"; RC=$?
[ "$RC" = 0 ] && pass "#5589: a 404 whose body varies per request is not a moved pointer (the deploy goes ahead)" || bad "#5589 varying 404 body refused (rc=$RC) out=$out"
# 30) #5589: a live pointer that cannot be read at the START refuses at once, before any fetch.
read -r S30 L30 <<<"$(make_scenario)"
: > "$L30/dist/latest-win-staging.json.down"
run_deploy "$S30" "$L30" --promote
{ [ "$RC" = 75 ] && has "$out" "could not read the live pointers at the start" && ! has "$out" "fetched and verified" \
  && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L30/dist/latest.json")" = "$OLD" ]; } \
  && pass "#5589: an unreadable live pointer at the start refuses before any fetch, LIVE untouched" \
  || bad "#5589 unreadable at start (rc=$RC) out=$out"
# 31) #5589: a live pointer readable at the start but not right before the deploy: refused, nothing deployed.
read -r S31 L31 <<<"$(make_scenario)"
printf '{"version":"9.9.9"}\n' > "$L31/dist/latest-win-staging.json"; : > "$L31/dist/latest-win-staging.json.dropafter"
run_deploy "$S31" "$L31" --promote
{ [ "$RC" = 75 ] && has "$out" "could not re-read the live pointers right before deploying" \
  && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L31/dist/latest.json")" = "$OLD" ]; } \
  && pass "#5589: a live pointer unreadable at the re-read refuses with nothing deployed" \
  || bad "#5589 unreadable at re-read (rc=$RC) out=$out"
# 32) #5589: the served-verify negative control could not RUN (a transport blip): exit 75, nothing deployed.
read -r S32 L32 <<<"$(make_scenario)"
out="$(CONTROL_DOWN=1 PATH="$BIN:$PATH" LIVE_DIR="$L32" HOST_URL="$HOSTURL" KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$S32" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" bash "$DEPLOY" --promote 2>&1)"; RC=$?
{ [ "$RC" = 75 ] && has "$out" "could not RUN against" \
  && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L32/dist/latest.json")" = "$OLD" ]; } \
  && pass "#5589: a negative control that could not run exits 75 (try again), nothing deployed" || bad "#5589 control blip (rc=$RC) out=$out"
# 32b) #5589: control for 32: a BLIND host (answers 200 for a path that cannot exist) is a finding, exit 1.
read -r S32b L32b <<<"$(make_scenario)"
out="$(CONTROL_200=1 PATH="$BIN:$PATH" LIVE_DIR="$L32b" HOST_URL="$HOSTURL" KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$S32b" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" bash "$DEPLOY" --promote 2>&1)"; RC=$?
{ [ "$RC" = 1 ] && has "$out" "negative control FAILED"; } && pass "#5589: a blind host (negative control answered 200) still exits 1, not 75" || bad "#5589 blind host (rc=$RC) out=$out"
# 33) #5589: latest.json readable for the snapshot but not for the read after it: exit 75.
read -r S33 L33 <<<"$(make_scenario)"
: > "$L33/dist/latest.json.dropafter"
run_deploy "$S33" "$L33" --promote
{ [ "$RC" = 75 ] && has "$out" "cannot read $HOSTURL/dist/latest.json"; } \
  && pass "#5589: an unreadable latest.json exits 75 (try again)" || bad "#5589 latest.json blip (rc=$RC) out=$out"
# 34) #5589: a pointer that answers 503 through every retry never said what it is: unread, exit 75 at
#     the start (not a 503 that compares equal at both reads and lets the deploy through).
read -r S34 L34 <<<"$(make_scenario)"
: > "$L34/dist/latest-win-staging.json.err503"
run_deploy "$S34" "$L34" --promote
{ [ "$RC" = 75 ] && has "$out" "could not read the live pointers at the start"; } \
  && pass "#5589: a pointer answering 5xx through every retry counts as unread (exit 75)" || bad "#5589 persistent 503 (rc=$RC) out=$out"
# 35) kosmos#6149: with the REAL setup floor (0.7.45; this file lowers it for its 0.6.x fixtures), the committed
#     0.6.31 pointer is refused before anything is deployed: LIVE still serves OLD. The control is arm 1 above (the
#     same make_scenario deploys under the file's lowered floor), and arm 38 below under the real floor.
read -r S35 L35 <<<"$(make_scenario)"
out="$(env -u KOSMOS_SETUP_FLOOR_TEST -u KOSMOS_SETUP_FLOOR_LOWER PATH="$BIN:$PATH" LIVE_DIR="$L35" HOST_URL="$HOSTURL" \
  KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$S35" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" \
  bash "$DEPLOY" --promote 2>&1)"; RC=$?
{ [ "$RC" = 1 ] && has "$out" "setup floor (kosmos#6149)" && has "$out" "older than 0.7.45"; } \
  && pass "#6149: the real floor refuses a committed pointer below 0.7.45" || bad "#6149 real floor (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L35/dist/latest.json")" = "$OLD" ] \
  && pass "#6149: the refusal deployed nothing (LIVE still serves $OLD)" || bad "#6149 refusal still changed LIVE"
# 36) kosmos#6149: a committed pointer whose version is not its tarball's is refused (the tarball is what installs).
read -r S36 L36 <<<"$(make_scenario)"
write_ptr "$S36/dist/latest.json" "$NEW" "$(sha_of "$L36/dist/$NEWART")" "kosmos-0.6.29-arm64.tar.gz"
git -C "$S36" add -A && git -C "$S36" commit -q -m "a pointer naming another version's tarball"
run_deploy "$S36" "$L36" --promote
{ [ "$RC" = 1 ] && has "$out" "says version $NEW but names artifact kosmos-0.6.29-arm64.tar.gz"; } \
  && pass "#6149: a pointer naming another version's tarball is refused" || bad "#6149 version/artifact mismatch (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L36/dist/latest.json")" = "$OLD" ] \
  && pass "#6149: that refusal deployed nothing" || bad "#6149 mismatch refusal still changed LIVE"
# 37-39) kosmos#6149 under the REAL floor, on a scenario above it (live 0.7.47, committed 0.7.49).
run_deploy_real() {  # <site> <live> <flag...> ; like run_deploy, without the lowered floor
  local s="$1" live="$2"; shift 2
  out="$(env -u KOSMOS_SETUP_FLOOR_TEST -u KOSMOS_SETUP_FLOOR_LOWER PATH="$BIN:$PATH" LIVE_DIR="$live" HOST_URL="$HOSTURL" \
    KOSMOS_DEPLOY_RETRY_SLEEP=0 KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" \
    bash "$DEPLOY" "$@" 2>&1)"
  RC=$?
}
above() { OLD=0.7.47 NEW=0.7.49 OLDART=kosmos-0.7.47-arm64.tar.gz NEWART=kosmos-0.7.49-arm64.tar.gz make_scenario; }
# 37) The committed /setup does not know the read-only app (an installer from before 0.7.45): refused, nothing deployed.
read -r S37 L37 <<<"$(above)"
printf 'setup-script\n' > "$S37/setup"; ( cd "$S37" && shasum -a 256 setup > setup.sha256 ); git -C "$S37" commit -qam "an installer from before 0.7.45"
run_deploy_real "$S37" "$L37" --promote
{ [ "$RC" = 1 ] && has "$out" "setup does not know KOSMOS_READONLY_APP"; } \
  && pass "#6149: an installer from before 0.7.45 beside a 0.7.49 pointer is refused" || bad "#6149 old installer (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L37/dist/latest.json")" = 0.7.47 ] \
  && pass "#6149: that refusal deployed nothing (LIVE still serves 0.7.47)" || bad "#6149 old-installer refusal still changed LIVE"
# 38) CONTROL: the same scenario with an installer that knows it deploys under the real floor.
read -r S38 L38 <<<"$(above)"
printf 'setup-script KOSMOS_READONLY_APP\n' > "$S38/setup"; ( cd "$S38" && shasum -a 256 setup > setup.sha256 )
git -C "$S38" add -A && git -C "$S38" commit -q -m "a current installer"
run_deploy_real "$S38" "$L38" --promote
{ [ "$RC" = 0 ] && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L38/dist/latest.json")" = 0.7.49 ]; } \
  && pass "#6149 CONTROL: a 0.7.49 pointer with a current installer deploys under the real floor" || bad "#6149 control (rc=$RC) out=$out"
# 39) The committed STAGING pointer below the floor (prod above it): refused, and the refusal names the staging pointer.
read -r S39 L39 <<<"$(above)"
printf 'setup-script KOSMOS_READONLY_APP\n' > "$S39/setup"
write_ptr "$S39/dist/latest-staging.json" 0.7.44 "$(sha_of "$L39/dist/kosmos-0.7.49-arm64.tar.gz")" kosmos-0.7.44-arm64.tar.gz
git -C "$S39" add -A && git -C "$S39" commit -q -m "a staging pointer below the floor"
run_deploy_real "$S39" "$L39" --promote
{ [ "$RC" = 1 ] && has "$out" "the committed dist/latest-staging.json names 0.7.44"; } \
  && pass "#6149: a committed staging pointer below the floor is refused" || bad "#6149 staging below floor (rc=$RC) out=$out"
[ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L39/dist/latest.json")" = 0.7.47 ] \
  && pass "#6149: that refusal deployed nothing (LIVE still serves 0.7.47)" || bad "#6149 staging refusal still changed LIVE"
# 40) The REPAIR docs/staging-channel.md gives, end to end under the real floor: a prod set below the floor is committed
#     on top of a good one and refused; restoring the whole set from the good commit, exactly as the doc says
#     (git checkout <commit> -- dist/latest.json setup setup.sha256), deploys and serves the good build.
read -r S40 L40 <<<"$(above)"
( cd "$S40" && shasum -a 256 setup > setup.sha256 ); git -C "$S40" add -A; git -C "$S40" commit -q -m "the good set" --allow-empty
GOOD40="$(git -C "$S40" rev-parse HEAD)"
write_ptr "$S40/dist/latest.json" 0.7.38 "$(sha_of "$L40/dist/kosmos-0.7.49-arm64.tar.gz")" kosmos-0.7.38-arm64.tar.gz
printf 'an installer from before 0.7.42\n' > "$S40/setup"; ( cd "$S40" && shasum -a 256 setup > setup.sha256 )
git -C "$S40" add -A && git -C "$S40" commit -q -m "a prod set below the floor"
run_deploy_real "$S40" "$L40" --promote
{ [ "$RC" = 1 ] && has "$out" "setup floor (kosmos#6149)"; } \
  && pass "#6149 repair: the broken prod set is refused by the floor" || bad "#6149 repair: broken set (rc=$RC) out=$out"
git -C "$S40" checkout -q "$GOOD40" -- dist/latest.json setup setup.sha256 && git -C "$S40" commit -q -m "restore the good prod set"
run_deploy_real "$S40" "$L40" --promote
{ [ "$RC" = 0 ] && [ "$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$L40/dist/latest.json")" = 0.7.49 ]; } \
  && pass "#6149 repair: restoring the whole set from the good commit deploys it under the real floor (LIVE serves 0.7.49)" || bad "#6149 repair: restored set (rc=$RC) out=$out"

# 41) The doc's USUAL case, on arm 40's site: live now serves the good set, so after another broken set is refused and
#     the same restore is committed, the pointer equals live: --promote refuses ("equals LIVE") and --publish deploys.
GOODLIVE41="$(cat "$L40/dist/latest.json")"
write_ptr "$S40/dist/latest.json" 0.7.38 "$(sha_of "$L40/dist/kosmos-0.7.49-arm64.tar.gz")" kosmos-0.7.38-arm64.tar.gz
printf 'an installer from before 0.7.42\n' > "$S40/setup"; ( cd "$S40" && shasum -a 256 setup > setup.sha256 )
git -C "$S40" add -A && git -C "$S40" commit -q -m "a prod set below the floor, again"
run_deploy_real "$S40" "$L40" --publish
{ [ "$RC" = 1 ] && has "$out" "setup floor (kosmos#6149)"; } \
  && pass "#6149 repair (usual case): the broken set is refused, nothing deployed" || bad "#6149 repair usual: broken set (rc=$RC) out=$out"
git -C "$S40" checkout -q "$GOOD40" -- dist/latest.json setup setup.sha256 && git -C "$S40" commit -q -m "restore the good prod set, again"
run_deploy_real "$S40" "$L40" --promote
{ [ "$RC" = 1 ] && has "$out" "already equals LIVE"; } \
  && pass "#6149 repair (usual case): --promote refuses, the restored pointer equals live" || bad "#6149 repair usual: --promote (rc=$RC) out=$out"
run_deploy_real "$S40" "$L40" --publish
{ [ "$RC" = 0 ] && [ "$(cat "$L40/dist/latest.json")" = "$GOODLIVE41" ]; } \
  && pass "#6149 repair (usual case): --publish deploys the restored set, as the doc says" || bad "#6149 repair usual: --publish (rc=$RC) out=$out"

# =============================================================================================
# kosmos#6620: the pointer freeze (tools/pointer-freeze.sh). While the COMMITTED tree carries dist/POINTER_FROZEN, a deploy
# publishes only the frozen version. Arm 1: a freeze naming the rollback's own version deploys it. Arm 2 (the control
# that can return the dangerous answer): a freeze naming another version refuses, and live keeps what it served.
read -r S45 L45 <<<"$(make_rollback_scenario)"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S45/dist/POINTER_FROZEN"
git -C "$S45" add -- dist/POINTER_FROZEN && git -C "$S45" commit -q -m "frozen at $OLD" -- dist/POINTER_FROZEN
run_deploy "$S45" "$L45" --promote
{ [ "$RC" = 0 ] && has "$out" "FROZEN at $OLD (dist/POINTER_FROZEN); the committed Mac pointers name it"; } \
  && pass "#6620: frozen at the committed version, the rollback promote deploys it" || bad "#6620 frozen at the committed version (rc=$RC) out=$out"
read -r S46 L46 <<<"$(make_rollback_scenario)"
LIVE46="$(cat "$L46/dist/latest.json")"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S46/dist/POINTER_FROZEN"
git -C "$S46" add -- dist/POINTER_FROZEN && git -C "$S46" commit -q -m "frozen at $NEW" -- dist/POINTER_FROZEN
run_deploy "$S46" "$L46" --promote
{ [ "$RC" = 1 ] && has "$out" "the pointers are FROZEN at $NEW" && [ "$(cat "$L46/dist/latest.json")" = "$LIVE46" ]; } \
  && pass "#6620: frozen at another version, the deploy is refused and live is untouched" || bad "#6620 frozen at another version (rc=$RC) out=$out"

# The runbook's two lines end to end (docs/staging-channel.md): tools/pointer-freeze.sh on, then the deploy it prints.
read -r S47 L47 <<<"$(make_rollback_scenario)"
# The real site commits the installer pair together (#2511); this scenario committed setup alone, so add its checksum.
( cd "$S47" && shasum -a 256 setup > setup.sha256 ) && git -C "$S47" add -- setup.sha256 && git -C "$S47" commit -q --amend --no-edit -- setup.sha256
git init -q --bare --initial-branch=main "$S47.origin.git" && git -C "$S47" remote add origin "$S47.origin.git" && git -C "$S47" push -q origin main
# The pinned build's signed manifest, served (pointer-freeze checks it is, before it pins).
printf '{"manifest":1}\n' > "$L47/dist/kosmos-$OLD-arm64.manifest.json"; printf 'SIG\n' > "$L47/dist/kosmos-$OLD-arm64.manifest.json.sig"
cp "$L47/dist/kosmos-$OLD-arm64.manifest.json" "$L47/dist/kosmos-$OLD-arm64.manifest.json.sig" "$S47/dist/"   # tracked on the real site
git -C "$S47" add -- dist/kosmos-$OLD-arm64.manifest.json dist/kosmos-$OLD-arm64.manifest.json.sig && git -C "$S47" commit -q -m "the manifest pair" -- dist/kosmos-$OLD-arm64.manifest.json dist/kosmos-$OLD-arm64.manifest.json.sig && git -C "$S47" push -q origin main
fout="$(PATH="$BIN:$PATH" LIVE_DIR="$L47" HOST_URL="$HOSTURL" KOSMOS_SITE="$S47" KOSMOS_SITE_URL="$HOSTURL" \
  bash "$REPO/tools/pointer-freeze.sh" on --mac "$OLD" --because "an end-to-end test incident" 2>&1)"; frc=$?
[ "$frc" = 0 ] || bad "#6620 end to end: pointer-freeze on (rc=$frc) out=$fout"
KOSMOS_STAGING_ROLLBACK="$OLD" run_deploy "$S47" "$L47" --promote
{ [ "$frc" = 0 ] && [ "$RC" = 0 ] && has "$out" "FROZEN at $OLD" && has "$(cat "$L47/dist/latest.json")" "\"version\":\"$OLD\"" && [ ! -e "$L47/dist/POINTER_FROZEN" ]; } \
  && pass "#6620 end to end: on, then the printed --promote, serves the pinned $OLD (and not the marker)" || bad "#6620 end to end (rc=$RC) out=$out"

# The marker records the pinned pointer's sha256: the frozen version with OTHER bytes (a re-cut, a hand edit) is refused.
read -r S49 L49 <<<"$(make_rollback_scenario)"
LIVE49="$(cat "$L49/dist/latest.json")"
printf 'mac=%s\nsha256=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$OLD" "0000000000000000000000000000000000000000000000000000000000000000" > "$S49/dist/POINTER_FROZEN"
git -C "$S49" add -- dist/POINTER_FROZEN && git -C "$S49" commit -q -m "frozen at $OLD, other bytes" -- dist/POINTER_FROZEN
run_deploy "$S49" "$L49" --promote
{ [ "$RC" = 1 ] && has "$out" "names another artifact" && [ "$(cat "$L49/dist/latest.json")" = "$LIVE49" ]; } \
  && pass "#6620: frozen at the version but other bytes: refused, live untouched" || bad "#6620 sha mismatch (rc=$RC) out=$out"

# A freeze pushed from another machine, not yet pulled here: deploy-site reads origin/main and refuses a pointer that is
# not the frozen version. CONTROL: arm 45 above (frozen at the committed version) deploys.
read -r S48 L48 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S48.origin.git" && git -C "$S48" remote add origin "$S48.origin.git" && git -C "$S48" push -q origin main
git clone -q "$S48.origin.git" "$S48.other" && git -C "$S48.other" config user.email t@t && git -C "$S48.other" config user.name t
printf 'mac=%s\nbecause=another machine\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S48.other/dist/POINTER_FROZEN"
git -C "$S48.other" add dist/POINTER_FROZEN && git -C "$S48.other" commit -q -m "frozen elsewhere" && git -C "$S48.other" push -q origin main
LIVE48="$(cat "$L48/dist/latest.json")"
run_deploy "$S48" "$L48" --promote
{ [ "$RC" = 1 ] && has "$out" "the pointers are FROZEN at $NEW" && [ "$(cat "$L48/dist/latest.json")" = "$LIVE48" ]; } \
  && pass "#6620: a freeze only on origin/main (this checkout stale) still refuses the deploy" || bad "#6620 origin-only freeze (rc=$RC) out=$out"

# A freeze pushed from another machine WHILE this deploy runs (after its early check, during its artifact fetches):
# the re-check just before vercel refuses, and live keeps what it served. CONTROL: arm 45 above deploys.
read -r S51 L51 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S51.origin.git" && git -C "$S51" remote add origin "$S51.origin.git" && git -C "$S51" push -q origin main
git clone -q "$S51.origin.git" "$S51.other" && git -C "$S51.other" config user.email t@t && git -C "$S51.other" config user.name t
printf 'mac=%s\nbecause=frozen mid-run\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S51.other/dist/POINTER_FROZEN"
git -C "$S51.other" add dist/POINTER_FROZEN && git -C "$S51.other" commit -q -m "frozen elsewhere, mid-run"
LIVE51="$(cat "$L51/dist/latest.json")"
FREEZE_MID_RUN_ON="dist/$OLDART" FREEZE_MID_RUN_CLONE="$S51.other" run_deploy "$S51" "$L51" --promote
{ [ "$RC" = 1 ] && [ -e "$S51.other.pushed" ] && has "$out" "FROZEN at $NEW on origin/main while this ran" && [ "$(cat "$L51/dist/latest.json")" = "$LIVE51" ]; } \
  && pass "#6620: a freeze pushed while the deploy fetches is caught just before vercel, live untouched" || bad "#6620 mid-run freeze (rc=$RC, pushed=$([ -e "$S51.other.pushed" ] && echo y || echo n)) out=$out"

# A site whose origin cannot be fetched: the freeze cannot be checked, so the deploy is refused (fails closed), unless
# KOSMOS_POINTER_FREEZE_OFFLINE=1 says to decide on the committed tree (CONTROL: then it deploys).
read -r S50 L50 <<<"$(make_rollback_scenario)"
git -C "$S50" remote add origin "$T/no-such-origin.git"
LIVE50="$(cat "$L50/dist/latest.json")"
run_deploy "$S50" "$L50" --promote
{ [ "$RC" = 75 ] && has "$out" "could not fetch origin/main to check the pointer freeze" && [ "$(cat "$L50/dist/latest.json")" = "$LIVE50" ]; } \
  && pass "#6620: a site origin that cannot be fetched refuses the deploy, live untouched" || bad "#6620 fail closed (rc=$RC) out=$out"
KOSMOS_POINTER_FREEZE_OFFLINE=1 run_deploy "$S50" "$L50" --promote
{ [ "$RC" = 0 ] && has "$out" "KOSMOS_POINTER_FREEZE_OFFLINE=1, so deciding the pointer freeze"; } \
  && pass "#6620 CONTROL: with KOSMOS_POINTER_FREEZE_OFFLINE=1 the same deploy goes ahead on the committed tree" || bad "#6620 offline (rc=$RC) out=$out"

# A stale checkout holding an OLD freeze (at the version its own pointers name, so on its own it would deploy) while
# origin/main is frozen at another version: origin/main decides. CONTROL: arm 45 (the same freeze, no origin) deploys.
read -r S52 L52 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S52.origin.git" && git -C "$S52" remote add origin "$S52.origin.git" && git -C "$S52" push -q origin main
git clone -q "$S52.origin.git" "$S52.other" && git -C "$S52.other" config user.email t@t && git -C "$S52.other" config user.name t
printf 'mac=%s\nbecause=the newer freeze\nat=2026-10-20T01:00:00Z\n' "$NEW" > "$S52.other/dist/POINTER_FROZEN"
git -C "$S52.other" add dist/POINTER_FROZEN && git -C "$S52.other" commit -q -m "frozen at $NEW elsewhere" && git -C "$S52.other" push -q origin main
printf 'mac=%s\nbecause=the old freeze\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S52/dist/POINTER_FROZEN"
git -C "$S52" add -- dist/POINTER_FROZEN && git -C "$S52" commit -q -m "frozen at $OLD here" -- dist/POINTER_FROZEN
LIVE52="$(cat "$L52/dist/latest.json")"
run_deploy "$S52" "$L52" --promote
{ [ "$RC" = 1 ] && has "$out" "the pointers are FROZEN at $NEW" && [ "$(cat "$L52/dist/latest.json")" = "$LIVE52" ]; } \
  && pass "#6620: an old freeze in this checkout does not answer for a newer one on origin/main; refused, live untouched" || bad "#6620 stale local freeze (rc=$RC) out=$out"

# An installer committed on top of the freeze (a staging pair: the real setup plus one line, so every installer check
# passes it, and this scenario has no latest-staging.json to name its bytes): refused, so a hand commit cannot ship under the pin. Before kosmos#6620 review 14
# this deployed. CONTROL: arm 45 deploys.
read -r S53 L53 <<<"$(make_rollback_scenario)"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S53/dist/POINTER_FROZEN"
git -C "$S53" add -- dist/POINTER_FROZEN && git -C "$S53" commit -q -m "frozen at $OLD" -- dist/POINTER_FROZEN
{ cat "$S53/setup"; printf '# a hand edit\n'; } > "$S53/setup-staging"; ( cd "$S53" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$S53" add -- setup-staging setup-staging.sha256 && git -C "$S53" commit -q -m "an installer by hand on top of the freeze" -- setup-staging setup-staging.sha256
LIVE53="$(cat "$L53/dist/latest.json")"
run_deploy "$S53" "$L53" --promote
{ [ "$RC" = 1 ] && has "$out" "since the freeze commit" && has "$out" "setup-staging" && has "$out" "do NOT lift the freeze" && ! has "$out" "lift the freeze first" && [ "$(cat "$L53/dist/latest.json")" = "$LIVE53" ]; } \
  && pass "#6620: an installer moved on top of the freeze is refused, live untouched" || bad "#6620 moved on top (rc=$RC) out=$out"

# A freeze landing WHILE this deploy runs, at the very version this deploy carries, whose commit restores an installer
# this tree had edited by hand: the late re-check compares the rest of what a freeze holds too, so it refuses.
# CONTROL: arm 51's shape with nothing moved is arm 45 (deploys).
read -r S54 L54 <<<"$(make_rollback_scenario)"
{ cat "$S54/setup"; printf '# a hand edit\n'; } > "$S54/setup-staging"; ( cd "$S54" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$S54" add -- setup-staging setup-staging.sha256 && git -C "$S54" commit -q -m "an installer by hand" -- setup-staging setup-staging.sha256
git init -q --bare --initial-branch=main "$S54.origin.git" && git -C "$S54" remote add origin "$S54.origin.git" && git -C "$S54" push -q origin main
git clone -q "$S54.origin.git" "$S54.other" && git -C "$S54.other" config user.email t@t && git -C "$S54.other" config user.name t
cp "$S54/setup" "$S54.other/setup-staging"; ( cd "$S54.other" && shasum -a 256 setup-staging > setup-staging.sha256 )
printf 'mac=%s\nbecause=frozen mid-run at this version\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S54.other/dist/POINTER_FROZEN"
git -C "$S54.other" add dist/POINTER_FROZEN setup-staging setup-staging.sha256 && git -C "$S54.other" commit -q -m "frozen elsewhere, installer restored"
LIVE54="$(cat "$L54/dist/latest.json")"
FREEZE_MID_RUN_ON="dist/$OLDART" FREEZE_MID_RUN_CLONE="$S54.other" run_deploy "$S54" "$L54" --promote
{ [ "$RC" = 1 ] && [ -e "$S54.other.pushed" ] && has "$out" "on origin/main while this ran, and this deploy changes setup-staging" && [ "$(cat "$L54/dist/latest.json")" = "$LIVE54" ]; } \
  && pass "#6620: a freeze landing mid-run at this version, which restores an installer this tree changed, is refused before vercel" || bad "#6620 mid-run moved installer (rc=$RC, pushed=$([ -e "$S54.other.pushed" ] && echo y || echo n)) out=$out"

# A BAD pointer pushed to origin/main ON TOP of the freeze, deployed from a checkout that is up to date: the refusal
# must not send the operator to pull (pulling changes nothing); it says what is true, a file committed on top.
read -r S55 L55 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S55.origin.git" && git -C "$S55" remote add origin "$S55.origin.git"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S55/dist/POINTER_FROZEN"
git -C "$S55" add -- dist/POINTER_FROZEN && git -C "$S55" commit -q -m "frozen at $OLD" -- dist/POINTER_FROZEN
cp "$L55/dist/latest.json" "$S55/dist/latest.json"
git -C "$S55" commit -q -m "the bad pointer by hand on top of the freeze" -- dist/latest.json && git -C "$S55" push -q origin main
LIVE55="$(cat "$L55/dist/latest.json")"
run_deploy "$S55" "$L55" --promote
{ [ "$RC" = 1 ] && has "$out" "the pointers are FROZEN at $OLD" && has "$out" "committed on top of the freeze" && ! has "$out" "pull it" && [ "$(cat "$L55/dist/latest.json")" = "$LIVE55" ]; } \
  && pass "#6620: a pointer pushed on top of the freeze, from an up-to-date checkout: refused, and not told to pull" || bad "#6620 on-top advice (rc=$RC) out=$out"
# CONTROL for that advice: the same freeze on origin, this checkout BEHIND it (arm 48's shape): told to pull.
read -r S56 L56 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S56.origin.git" && git -C "$S56" remote add origin "$S56.origin.git" && git -C "$S56" push -q origin main
git clone -q "$S56.origin.git" "$S56.other" && git -C "$S56.other" config user.email t@t && git -C "$S56.other" config user.name t
printf 'mac=%s\nbecause=another machine\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S56.other/dist/POINTER_FROZEN"
git -C "$S56.other" add dist/POINTER_FROZEN && git -C "$S56.other" commit -q -m "frozen elsewhere" && git -C "$S56.other" push -q origin main
run_deploy "$S56" "$L56" --promote
{ [ "$RC" = 1 ] && has "$out" "This checkout is behind origin/main: pull it"; } \
  && pass "#6620 CONTROL: a checkout behind a freeze on origin/main is told to pull" || bad "#6620 behind advice (rc=$RC) out=$out"

# A commit that moves an installer AND edits the marker (a because= line, say) after the freeze: the anchor is the
# commit that ADDED the marker, so the move is still seen. CONTROL: arm 45 (nothing moved) deploys.
read -r S57 L57 <<<"$(make_rollback_scenario)"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S57/dist/POINTER_FROZEN"
git -C "$S57" add -- dist/POINTER_FROZEN && git -C "$S57" commit -q -m "frozen at $OLD" -- dist/POINTER_FROZEN
{ cat "$S57/setup"; printf '# a hand edit\n'; } > "$S57/setup-staging"; ( cd "$S57" && shasum -a 256 setup-staging > setup-staging.sha256 )
printf 'mac=%s\nbecause=a test incident, reworded\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S57/dist/POINTER_FROZEN"
git -C "$S57" add -- setup-staging setup-staging.sha256 dist/POINTER_FROZEN && git -C "$S57" commit -q -m "an installer and a reworded marker" -- setup-staging setup-staging.sha256 dist/POINTER_FROZEN
LIVE57="$(cat "$L57/dist/latest.json")"
run_deploy "$S57" "$L57" --promote
{ [ "$RC" = 1 ] && has "$out" "since the freeze commit" && has "$out" "setup-staging" && [ "$(cat "$L57/dist/latest.json")" = "$LIVE57" ]; } \
  && pass "#6620: an installer moved in the same commit as a marker edit is still refused" || bad "#6620 marker-edit anchor (rc=$RC) out=$out"

# An ordinary site change on top of the pin (a page, not a release file) deploys while frozen: the freeze holds the
# release files, not the site. Run under dash, the shell deploy-site.sh's #!/bin/sh is on Linux, so the freeze block's
# success path runs there too. The refusal beside it is arm 53 (an installer moved on top).
read -r S58 L58 <<<"$(make_rollback_scenario)"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$OLD" > "$S58/dist/POINTER_FROZEN"
git -C "$S58" add -- dist/POINTER_FROZEN && git -C "$S58" commit -q -m "frozen at $OLD" -- dist/POINTER_FROZEN
printf '<p>an incident notice</p>\n' > "$S58/incident.html"
git -C "$S58" add -- incident.html && git -C "$S58" commit -q -m "a page during the freeze" -- incident.html
DEPLOY_SHELL=dash run_deploy "$S58" "$L58" --promote
{ [ "$RC" = 0 ] && has "$out" "no release pointer or installer moved since the freeze"; } \
  && pass "#6620 (dash): a page committed on top of the pin deploys while frozen" || bad "#6620 page during freeze (rc=$RC) out=$out"

# After off, the release tools are free again: a deploy of the (pulled) checkout is not refused for a freeze.
# The refusal beside it is arm 46 (frozen at another version).
read -r S59 L59 <<<"$(make_rollback_scenario)"
printf 'mac=%s\nbecause=a test incident\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S59/dist/POINTER_FROZEN"
git -C "$S59" add -- dist/POINTER_FROZEN && git -C "$S59" commit -q -m "frozen at $NEW" -- dist/POINTER_FROZEN
git -C "$S59" rm -q -- dist/POINTER_FROZEN && git -C "$S59" commit -q -m "lifted" -- dist/POINTER_FROZEN
run_deploy "$S59" "$L59" --promote
{ [ "$RC" = 0 ] && ! has "$out" "FROZEN"; } \
  && pass "#6620: after off, the same deploy arm 46 refused goes ahead" || bad "#6620 after off (rc=$RC) out=$out"

# The two refusal paths that read git under dash: the moved-files diff (arm 57's shape) and an origin fetch (arm 56's).
DEPLOY_SHELL=dash run_deploy "$S57" "$L57" --promote
{ [ "$RC" = 1 ] && has "$out" "since the freeze commit" && has "$out" "setup-staging"; } \
  && pass "#6620 (dash): an installer moved on top of the freeze is refused" || bad "#6620 dash moved (rc=$RC) out=$out"
DEPLOY_SHELL=dash run_deploy "$S56" "$L56" --promote
{ [ "$RC" = 1 ] && has "$out" "This checkout is behind origin/main: pull it"; } \
  && pass "#6620 (dash): a freeze read from origin/main refuses a checkout behind it, and says pull" || bad "#6620 dash origin (rc=$RC) out=$out"

# A checkout that has DIVERGED from a frozen origin/main (a local commit origin/main lacks, origin/main frozen since):
# told it diverged, not to pull (a pull would merge) and not that a file was committed on top.
read -r S60 L60 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S60.origin.git" && git -C "$S60" remote add origin "$S60.origin.git" && git -C "$S60" push -q origin main
git clone -q "$S60.origin.git" "$S60.other" && git -C "$S60.other" config user.email t@t && git -C "$S60.other" config user.name t
printf 'mac=%s\nbecause=another machine\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S60.other/dist/POINTER_FROZEN"
git -C "$S60.other" add dist/POINTER_FROZEN && git -C "$S60.other" commit -q -m "frozen elsewhere" && git -C "$S60.other" push -q origin main
printf '<p>local</p>\n' > "$S60/local.html"; git -C "$S60" add -- local.html && git -C "$S60" commit -q -m "a local commit" -- local.html
run_deploy "$S60" "$L60" --promote
{ [ "$RC" = 1 ] && has "$out" "has diverged from origin/main" && ! has "$out" "pull it" && ! has "$out" "committed on top"; } \
  && pass "#6620: a checkout diverged from a frozen origin/main is told so" || bad "#6620 diverged advice (rc=$RC) out=$out"

# A freeze committed here and never pushed (origin/main not frozen, this checkout ahead of it): told so, with the
# command that pushes it, not "pull" (which would do nothing).
read -r S61 L61 <<<"$(make_rollback_scenario)"
git init -q --bare --initial-branch=main "$S61.origin.git" && git -C "$S61" remote add origin "$S61.origin.git" && git -C "$S61" push -q origin main
printf 'mac=%s\nbecause=never pushed\nat=2026-10-20T00:00:00Z\n' "$NEW" > "$S61/dist/POINTER_FROZEN"
git -C "$S61" add -- dist/POINTER_FROZEN && git -C "$S61" commit -q -m "frozen here only" -- dist/POINTER_FROZEN
run_deploy "$S61" "$L61" --promote
{ [ "$RC" = 1 ] && has "$out" "this freeze was never pushed" && ! has "$out" "pull it"; } \
  && pass "#6620: a freeze committed here and never pushed is told so, with the command that pushes it" || bad "#6620 unpushed advice (rc=$RC) out=$out"

echo ""
if [ "$fail" = 0 ]; then echo "test-deploy-site-promote: ALL PASS"; else echo "test-deploy-site-promote: FAILURES above"; exit 1; fi
