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
path="$LIVE_DIR/$rel"
if [ -n "$wfmt" ]; then
  if [ -f "$path" ]; then [ -n "$dest" ] && cp "$path" "$dest"; printf '200'; else printf '404'; fi
  exit 0
fi
[ -f "$path" ] || exit 22
if [ -n "$dest" ]; then cp "$path" "$dest"; else cat "$path"; fi
exit 0
CURL
chmod +x "$BIN/curl"
cat > "$BIN/vercel" <<'VERCEL'
#!/bin/bash
# `vercel deploy --prod --yes` runs with the EXPORT as cwd. Publish it into LIVE (additive copy;
# a real deploy replaces the site, but additive is enough to run the served-verify honestly).
mkdir -p "$LIVE_DIR/dist"
[ -d ./dist ] && cp -R ./dist/. "$LIVE_DIR/dist/" 2>/dev/null
for f in setup index.html vercel.json; do [ -f "./$f" ] && cp "./$f" "$LIVE_DIR/$f"; done
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
  printf 'setup-script\n' > "$live/setup"
  local newsha; newsha="$(sha_of "$live/dist/$NEWART")"
  write_ptr "$live/dist/latest.json" "$OLD" "oldsha000000" "$OLDART"   # LIVE prod = OLD

  # --- the SITE checkout: committed at the NEW pointer (promote-channel already moved it) ---
  git init -q "$s"
  printf '<h1>site</h1>\n' > "$s/index.html"; printf '{}\n' > "$s/vercel.json"
  printf 'docs/\n' > "$s/.vercelignore"
  printf 'setup-script\n' > "$s/setup"
  printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$s/.gitignore"
  local csha="${1:-$newsha}"
  write_ptr "$s/dist/latest.json" "$NEW" "$csha" "$NEWART"            # COMMITTED = NEW
  printf 'WINZIP\n' > "$s/dist/$WINZIP"                                # tracked win zip
  git -C "$s" add -A && git -C "$s" commit -q -m "site at $NEW"
  mkdir -p "$s/.vercel"; printf '{"projectId":"p"}\n' > "$s/.vercel/project.json"
  printf '%s %s' "$s" "$live"
}

run_deploy() {  # <site> <live> <flag...> ; echoes output, sets RC
  local s="$1" live="$2"; shift 2
  out="$(PATH="$BIN:$PATH" LIVE_DIR="$live" HOST_URL="$HOSTURL" \
    KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" \
    bash "$DEPLOY" "$@" 2>&1)"
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

echo ""
if [ "$fail" = 0 ]; then echo "test-deploy-site-promote: ALL PASS"; else echo "test-deploy-site-promote: FAILURES above"; exit 1; fi
