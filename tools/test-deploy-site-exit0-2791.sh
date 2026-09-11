#!/usr/bin/env bash
# test-deploy-site-exit0-2791.sh - #2791: deploy-site.sh must return 0 on a successful
# --publish/--promote, so any runner or CI gate reading DEPLOY_EXIT never reads a clean publish as a
# failure (Baron saw DEPLOY_EXIT=128 trail a verified 0.6.55 publish -- a latent false-alarm trap).
#
# The success exit used to be IMPLICIT: the script's last statement was the #2159
# `if [ "$PROMOTE" = 1 ]; then ... fi` block, and on a --publish that condition is false. A false
# `if...fi` with no else returns 0 (POSIX), so the exit happened to be 0 -- but only by that trailing
# construct's status, which a future trailing command would silently break. The fix is an explicit
# trailing `exit 0`.
#
# This test has TWO parts, and both matter:
#   PART A (source-level pins) -- the property the runtime arm CANNOT prove: that the success exit is
#     EXPLICIT and immune to a future trailing command. A1: the script's last executable line is
#     literally `exit 0` (nothing trails it). A2: the script runs under `set -e`, so a REAL failure
#     exits non-zero BEFORE that exit 0 -- the explicit success exit masks no real failure.
#   PART B (runtime, end-to-end) -- the card's literal claim: a SUCCESSFUL --publish actually returns
#     0. Modeled on tools/test-deploy-site-promote.sh's proven stubbing (a `curl` that serves a fake
#     LIVE dir, a `vercel` that publishes the export into LIVE). B1 drives a --publish to completion
#     on a consistent site (committed latest.json == live) and asserts the real process rc==0 AND the
#     "published and verified" success line. B2 is B1's CONTROL: a STALE site (committed != live)
#     must make --publish REFUSE (rc!=0) -- proving B1's rc==0 is not vacuous. Part B specifically
#     exercises the --publish (PROMOTE=0) path, where the trailing #2159 if-block is FALSE and control
#     falls straight through to the new `exit 0` -- the exact case #2791 is about; the promote test
#     already covers the PROMOTE=1 (if-TRUE) path reaching the same exit.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
DEPLOY="$HERE/deploy-site.sh"
[ -f "$DEPLOY" ] || { echo "FAIL: deploy-site.sh not found at $DEPLOY"; exit 1; }

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# =============================================================================================
# PART A -- source-level pins (the immune-to-a-trailing-command property)
# =============================================================================================

# A1) The last non-blank, non-comment line must be `exit 0`.
last=$(grep -vE '^[[:space:]]*(#|$)' "$DEPLOY" | tail -1 | sed 's/[[:space:]]*$//')
if [ "$last" = "exit 0" ]; then
  pass "A1: deploy-site.sh ends with an explicit 'exit 0' -- success returns 0, immune to a trailing command"
else
  bad "A1: deploy-site.sh's last executable line is '$last', not 'exit 0'. A successful --publish's exit status is implicit/trailing again (#2791 latent false-alarm trap: a runner reading DEPLOY_EXIT could read a clean publish as a failure)."
fi

# A2) `set -e` (or `set -eu`) is present, so real failures exit non-zero before the explicit exit 0.
if grep -qE '^[[:space:]]*set -e' "$DEPLOY"; then
  pass "A2: deploy-site.sh runs under 'set -e', so a real failure exits before the explicit exit 0 (it masks no failure)"
else
  bad "A2: deploy-site.sh has no 'set -e' -- an explicit trailing 'exit 0' could then mask a mid-script failure"
fi

# A-CONTROL: prove A1 can FAIL. A script whose last line is a bare command, not `exit 0`, must be
# caught by the same check -- otherwise A1 is vacuous.
tmp=$(mktemp "${TMPDIR:-/tmp}/ds-exit0-ctl.XXXXXX")
printf '#!/bin/sh\nset -eu\necho done\n' > "$tmp"
ctl_last=$(grep -vE '^[[:space:]]*(#|$)' "$tmp" | tail -1 | sed 's/[[:space:]]*$//')
rm -f "$tmp"
if [ "$ctl_last" = "exit 0" ]; then
  bad "A-CONTROL: a script ending in 'echo done' was read as ending in 'exit 0'; the A1 check is broken"
else
  pass "A-CONTROL: a script ending in a bare command is correctly NOT read as 'exit 0' ($ctl_last)"
fi

# =============================================================================================
# PART B -- runtime: a successful --publish returns 0 (end-to-end, stubbed like the promote test)
# =============================================================================================
# The real deploy-site.sh fetches artifacts over HTTP and runs `vercel deploy --prod`. Both are
# stubbed on PATH: a `curl` that serves files from a fake LIVE dir keyed on the URL path, and a
# `vercel` that publishes the export (its cwd) into LIVE so the post-deploy served-by-content verify
# runs against what was "deployed". This is the same harness convention the sibling
# tools/test-deploy-site-promote.sh established.

T=$(mktemp -d "${TMPDIR:-/tmp}/deploy-exit0-test.XXXXXXXX")
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

V=0.6.50
ART="kosmos-$V-arm64.tar.gz"
WINZIP="kosmos-$V-win-x64.zip"
HOSTURL="https://fake.test"

# ---- stubs on PATH (curl serves from LIVE, vercel publishes the export into LIVE) --------------
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
cat > "$BIN/vercel" <<'VERCEL'
#!/bin/bash
# `vercel deploy --prod --yes` runs with the EXPORT as cwd. Publish it into LIVE (additive copy is
# enough to run the served-verify honestly).
mkdir -p "$LIVE_DIR/dist"
[ -d ./dist ] && cp -R ./dist/. "$LIVE_DIR/dist/" 2>/dev/null
for f in setup index.html vercel.json; do [ -f "./$f" ] && cp "./$f" "$LIVE_DIR/$f"; done
exit 0
VERCEL
chmod +x "$BIN/vercel"

# write a pointer JSON. args: <file> <version> <sha> <artifact>
write_ptr() { printf '{"version":"%s","sha256":"%s","artifact":"%s","manifest":"kosmos-%s-arm64.manifest.json"}\n' "$2" "$3" "$4" "$2" > "$1"; }

# Build a SITE checkout + a LIVE served dir for a --publish SUCCESS: the committed latest.json is
# byte-identical to the live one (the site-copy path requires committed == live), LIVE serves the
# current version's artifacts, and every served-verify precondition is satisfied.
# mode: "ok" -> committed == live (success);  "stale" -> committed != live (must refuse: the control)
make_publish_scenario() {  # <mode> ; echoes "SITE LIVE"
  local mode="$1" s live realsha
  s="$(mktemp -d "$T/site.XXXXXX")"; live="$(mktemp -d "$T/live.XXXXXX")"
  mkdir -p "$s/dist" "$live/dist"

  # --- LIVE (served) state: the current version's artifacts, all verifiable ---
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
  printf 'WINZIP\n' > "$live/dist/$WINZIP"
  ( cd "$live/dist" && shasum -a 256 "$WINZIP" > "$WINZIP.sha256" )
  printf 'WINALIAS\n' > "$live/dist/kosmos-win-x64.zip"
  ( cd "$live/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  printf 'setup-script\n' > "$live/setup"
  # LIVE prod pointer: the current version, advertising the real served sha.
  write_ptr "$live/dist/latest.json" "$V" "$realsha" "$ART"

  # --- the SITE checkout ---
  git init -q "$s"
  printf '<h1>site</h1>\n' > "$s/index.html"; printf '{}\n' > "$s/vercel.json"
  printf 'docs/\n' > "$s/.vercelignore"
  printf 'setup-script\n' > "$s/setup"
  printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$s/.gitignore"
  if [ "$mode" = ok ]; then
    # committed == live: an honest site-copy of the current release.
    write_ptr "$s/dist/latest.json" "$V" "$realsha" "$ART"
  else
    # STALE: committed advertises a version that is NOT what LIVE serves -> the CJ==LJ guard refuses.
    write_ptr "$s/dist/latest.json" "0.6.49" "$realsha" "kosmos-0.6.49-arm64.tar.gz"
  fi
  # the tracked win zip + alias and their sidecars (git archive ships these committed copies).
  printf 'WINZIP\n' > "$s/dist/$WINZIP"
  ( cd "$s/dist" && shasum -a 256 "$WINZIP" > "$WINZIP.sha256" )
  printf 'WINALIAS\n' > "$s/dist/kosmos-win-x64.zip"
  ( cd "$s/dist" && shasum -a 256 kosmos-win-x64.zip > kosmos-win-x64.zip.sha256 )
  git -C "$s" add -A && git -C "$s" commit -q -m "site at $V"
  mkdir -p "$s/.vercel"; printf '{"projectId":"p"}\n' > "$s/.vercel/project.json"
  printf '%s %s' "$s" "$live"
}

run_deploy() {  # <site> <live> <flag...> ; sets RC + out. KOSMOS_WIN_ZIP set so the win-derive is skipped.
  local s="$1" live="$2"; shift 2
  out="$(PATH="$BIN:$PATH" LIVE_DIR="$live" HOST_URL="$HOSTURL" \
    KOSMOS_SITE="$s" KOSMOS_REPO="$REPO" KOSMOS_SITE_URL="$HOSTURL" KOSMOS_WIN_ZIP="$WINZIP" \
    bash "$DEPLOY" "$@" 2>&1)"
  RC=$?
}

# B1) SUCCESS: a --publish on a consistent site returns 0 and reports the verified success line.
read -r S L <<<"$(make_publish_scenario ok)"
run_deploy "$S" "$L" --publish
if [ "$RC" = 0 ] && has "$out" "published and verified"; then
  pass "B1: a successful --publish returns 0 (the #2791 explicit exit 0 is reached on the PROMOTE=0 path)"
else
  bad "B1: a successful --publish did not return 0 with the success line (rc=$RC); out=$out"
fi

# B2) CONTROL: a STALE site (committed pointer != live) must REFUSE with a non-zero exit -- proving
# B1's rc==0 is a real success signal, not a harness that returns 0 no matter what.
read -r S2 L2 <<<"$(make_publish_scenario stale)"
run_deploy "$S2" "$L2" --publish
if [ "$RC" != 0 ] && has "$out" "COMMITTED latest.json differs from LIVE"; then
  pass "B2-CONTROL: a stale --publish (committed != live) REFUSES with rc=$RC -- B1's rc==0 discriminates"
else
  bad "B2-CONTROL: a stale --publish did not refuse (rc=$RC); B1's rc==0 would be vacuous. out=$out"
fi

[ "$fails" -eq 0 ] || { echo "$fails failing arm(s)"; exit 1; }
echo "test-deploy-site-exit0-2791: all arms passed"
