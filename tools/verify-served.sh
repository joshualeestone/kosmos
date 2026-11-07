#!/bin/bash
# Every artifact a USER can receive, named and checked one at a time.
#
# 🛑 WHY IT IS A LIST AND NOT A LOOP OVER "the release". 0.2.11 verified
# latest.json, the tarball's version and the tarball's checksum. All three
# passed. All three measured the BUNDLE, and the installer served at the site
# ROOT was a whole change stale — the one file BOTH the install path and the
# update path actually run. A check that measures the thing you were thinking
# about, standing next to a thing you were not, is indistinguishable from
# coverage.
#
# ⚠️ DERIVED FROM THE CODE THAT FETCHES, not from memory:
#   engine/update.js:82   GET  <base>/latest.json          (existing installs, every 15m)
#   engine/update.js:189  runs <base minus /dist>/setup    (existing installs, on update; /setup-staging on a staging box, #5032)
#   install/setup.sh:30   runs https://installkosmos.com/setup   (new installs)
#   install/setup.sh:373  GET  <base>/tmux-$ARCH.tar.gz  + .sha256
#   install/setup.sh:~390 GET  <base>/kosmos-$ARCH.tar.gz + .sha256
#   site index.html (the macOS Download button)  GET <base>/Kosmos.pkg (+ .sha256, .inputs)
set -uo pipefail
REPO=${REPO:-/Users/agent1/work/agent-workforce}
HOST=${HOST:-https://installkosmos.com}
fail=0
say() { printf '  %-42s %s\n' "$1" "$2"; }

# #5032: which installer. DEFAULT setup (prod), unchanged for every existing caller. A staging cut
# passes KOSMOS_VERIFY_SETUP=setup-staging: that cut publishes /setup-staging and leaves /setup at the
# prior prod installer, which install/setup.sh in this tree is then NOT (so checking /setup here would
# fail a correct staging cut). Only the two names are accepted, so a typo cannot verify some other file;
# checked before the network control, so a bad name is refused without a fetch.
SETUP_NAME="${KOSMOS_VERIFY_SETUP:-setup}"
case "$SETUP_NAME" in setup|setup-staging) ;; *) say "KOSMOS_VERIFY_SETUP" "must be setup or setup-staging (got '$SETUP_NAME')"; exit 1 ;; esac

# ⚠️ THE CONTROL FIRST. An empty body and a missing file look identical, and a
# wrong URL reads as an outage. Splinter hit exactly this within a minute of
# the release: a fetch of the site root returned empty and he nearly reported
# latest.json as unverifiable.
# ⚠️ NO `-f`: it makes curl exit non-zero on 404, and the fallback then
# APPENDS to the code already captured, producing '404404'. The control's own
# first run failed that way.
code=$(curl -sS -o /dev/null -w '%{http_code}' "$HOST/dist/definitely-not-here.json" 2>/dev/null)
[ "$code" = "404" ] && say "CONTROL: a file that is not there" "404, so a 200 below means something" \
  || { say "CONTROL: a file that is not there" "answered $code -- this host answers everything, so nothing below discriminates"; exit 1; }

check_bytes() {   # url  local-file  label
  got=$(curl -fsS "$1" | shasum -a 256 | awk '{print $1}')
  want=$(shasum -a 256 < "$2" | awk '{print $1}')
  if [ "$got" = "$want" ]; then say "$3" "identical to the repo"; else say "$3" "DIFFERS from $2"; fail=1; fi
}
check_200() {     # url  label
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)
  if [ "$code" = "200" ]; then say "$2" "200"; else say "$2" "$code"; fail=1; fi
}

echo "== what a NEW install runs, and what an UPDATE re-runs =="
check_bytes "$HOST/$SETUP_NAME" "$REPO/install/setup.sh" "/$SETUP_NAME"
check_200   "$HOST/$SETUP_NAME.sha256" "/$SETUP_NAME.sha256"
# #568: the served installer must be a COMMITTED revision of the site, not
# whatever the working tree held at deploy time; a script matching no
# revision confounds the line-number diagnostic that found the 0.5.13
# wedge, and leaves the thing every install runs outside anybody's history.
# ⚠️ FETCHED WITH THE UPDATER'S OWN CACHE-BUSTER (?v=<version>), so a stale
# edge cannot fail this check spuriously the way it served stale bytes on
# 2026-08-24: this line measures what an UPDATING machine runs; check_bytes
# above measures the plain URL the marketing line runs, and the six-read
# retry in release.sh covers edge lag on both. Both sides hash FILES whose
# fetch succeeded: an empty stdin hashes to a real value, so a failed curl
# and a missing ref used to agree with each other and print a match.
SITE=${SITE:-${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}}
if [ -d "$SITE/.git" ]; then
  fetched=yes
  git -C "$SITE" fetch -q origin 2>/dev/null || fetched=no
  vtmp_s=$(mktemp); vtmp_c=$(mktemp)
  if curl -fsS "$HOST/$SETUP_NAME?v=$want" -o "$vtmp_s" && git -C "$SITE" show "origin/main:$SETUP_NAME" > "$vtmp_c" 2>/dev/null && [ -s "$vtmp_s" ] && [ -s "$vtmp_c" ]; then
    if cmp -s "$vtmp_s" "$vtmp_c"; then
      say "/$SETUP_NAME (history)" "matches origin/main of the site$([ "$fetched" = yes ] || printf ' (fetch failed; compared against the last-fetched origin/main)')"
    else
      say "/$SETUP_NAME (history)" "SERVED SCRIPT IS NOT THE COMMITTED ONE (origin/main of the site)$([ "$fetched" = yes ] || printf '; and the fetch failed, so origin/main may be stale here')"; fail=1
    fi
  else
    say "/$SETUP_NAME (history)" "COULD NOT COMPARE (the served script or origin/main:$SETUP_NAME did not come back)"; fail=1
  fi
  rm -f "$vtmp_s" "$vtmp_c"
else
  say "/$SETUP_NAME (history)" "NO SITE CHECKOUT at $SITE, so the served script was not checked against history"; fail=1
fi

echo "== what an existing install polls =="
# #2036: which pointer to check. DEFAULT latest.json (prod) -- unchanged for every existing
# caller. A staging cut passes KOSMOS_VERIFY_POINTER=latest-staging.json so the STAGING
# pointer's version is the one verified (prod latest.json still names the prior version then,
# which release.sh asserts separately). The versioned-artifact, sha and /setup checks above are
# pointer-independent, so this polled-pointer read is parameterized, and so (kosmos#8172) is which channel's
# pkg-against-pointer check can fail the run (see the kosmos#8172 note above _vs_pkg).
POINTER="${KOSMOS_VERIFY_POINTER:-latest.json}"
served=$(curl -fsS -H 'Cache-Control: no-cache' "$HOST/dist/$POINTER")
want=$(node -e "console.log(require('$REPO/package.json').version)")
if printf '%s' "$served" | grep -q "\"$want\""; then say "/dist/$POINTER" "$served"; else say "/dist/$POINTER" "$served -- expected $want"; fail=1; fi

echo "== what the installer downloads =="
for a in kosmos tmux; do
  url="$HOST/dist/$a-arm64.tar.gz"
  tmp=$(mktemp)
  if curl -fsS "$url" -o "$tmp"; then
    real=$(shasum -a 256 "$tmp" | awk '{print $1}')
    pub=$(curl -fsS "$url.sha256" | awk '{print $1}')
    if [ "$real" = "$pub" ]; then say "/dist/$a-arm64.tar.gz" "$(wc -c < "$tmp" | tr -d ' ') bytes, checksum matches"
    else say "/dist/$a-arm64.tar.gz" "CHECKSUM MISMATCH -- every install refuses this"; fail=1; fi
  else say "/dist/$a-arm64.tar.gz" "could not be fetched"; fail=1; fi
  rm -f "$tmp"
done

# The VERSIONED pair is the name new installers prefer (the plain name
# is one URL across releases and a cache can serve it stale); a deploy
# that dropped it would silently demote every installer to the weaker
# cache-busted fallback, on exactly the artifact the 0.5.13 wedge was
# about.
vurl="$HOST/dist/kosmos-$want-arm64.tar.gz"
vtmp=$(mktemp)
if curl -fsS "$vurl" -o "$vtmp"; then
  vreal=$(shasum -a 256 "$vtmp" | awk '{print $1}')
  vline=$(curl -fsS "$vurl.sha256")
  vpub=$(awk '{print $1}' <<<"$vline"); vname=$(awk '{print $2}' <<<"$vline")
  if [ "$vreal" = "$vpub" ]; then say "/dist/kosmos-$want-arm64.tar.gz" "versioned pair present, checksum matches"
  else say "/dist/kosmos-$want-arm64.tar.gz" "CHECKSUM MISMATCH on the versioned pair"; fail=1; fi
  # #930: the name INSIDE the .sha256 is what `shasum -c` opens. A digest that
  # matches beside a name that does not is a FAILED for the careful tester.
  if [ "$vname" = "kosmos-$want-arm64.tar.gz" ]; then say "/dist/kosmos-$want-arm64.tar.gz.sha256" "names the file it is served beside (shasum -c would pass)"
  else say "/dist/kosmos-$want-arm64.tar.gz.sha256" "NAMES '${vname:-nothing}', not kosmos-$want-arm64.tar.gz: shasum -c fails on good bytes (#930)"; fail=1; fi
else say "/dist/kosmos-$want-arm64.tar.gz" "MISSING -- installers fall back to the cacheable plain name"; fail=1; fi
rm -f "$vtmp"

echo "== what the Download button serves =="
# The homepage's macOS button points at /dist/Kosmos.pkg (#555). The pkg is
# payload-free and rebuilt only when its inputs change, so "current" here means
# its INPUTS sidecar matches the source (tools/lib/pkg-inputs.sh, the one
# definition), its bytes match the checksum served beside it, and the
# signature and staple are real. A pkg that fails any of these is what a
# person double-clicks, so each is its own line.
. "$REPO/tools/lib/pkg-inputs.sh"
pwant=$(pkg_input_sha "$REPO") || { say "/dist/Kosmos.pkg inputs" "could not compute the source input sha"; fail=1; pwant=; }
# kosmos#8167: two names. A staging cut publishes Kosmos-staging.pkg and leaves Kosmos.pkg (the button's) alone;
# promote copies one onto the other. So when a staging pkg is served, IT must match the source, and Kosmos.pkg is
# checked as a whole, signed, stapled triple, its inputs not checked against the source: between a staging cut
# and its promote they are meant to lag. With no staging pkg served yet
# (before the first staging cut after kosmos#8167), Kosmos.pkg must match the source, as before.
# kosmos#8172: each served pkg is ALSO held to the pkg_sha256 its own channel's pointer names, when it names one:
# strictly for the channel this run verifies ($POINTER), and as a report for the other channel.
# _vs_pkg <name> <source|any>
_vs_pkg() {
  pn="$1"; pmode="$2"
  pdir=$(mktemp -d); pvouch=
  if curl -fsS -H 'Cache-Control: no-cache' "$HOST/dist/$pn.inputs" -o "$pdir/inputs" 2>/dev/null && [ -s "$pdir/inputs" ]; then
    pside=$(pkg_sidecar_inputs "$pdir/inputs"); pvouch=$(pkg_sidecar_pkgsha "$pdir/inputs")
    if [ -n "$pwant" ] && [ "$pside" = "$pwant" ]; then say "/dist/$pn.inputs" "matches source (${pwant:0:12})"
    elif [ "$pmode" = any ]; then say "/dist/$pn.inputs" "inputs ${pside:0:12} (prod, not the source's ${pwant:0:12}: it moves at the promote, kosmos#8167)"
    else say "/dist/$pn.inputs" "STALE -- served ${pside:0:12}, source ${pwant:0:12}"; fail=1; fi
  else say "/dist/$pn.inputs" "MISSING -- the served pkg predates the guard, its inputs are unknown"; fail=1; fi
  # ⚠️ NAMED $pn ON DISK, not a bare mktemp: `stapler validate` decides
  # the file type from the extension and reports "no valid staple" on a stapled
  # pkg with none. Measured on the served pkg itself: rc 66 as `mktemp` output,
  # rc 0 as served.pkg, same bytes. A check that cannot reach the state it
  # tests reads as the defect it was built to catch.
  ptmp="$pdir/$pn"
  if curl -fsS "$HOST/dist/$pn" -o "$ptmp"; then
    preal=$(_pkg_hash < "$ptmp" | awk '{print $1}')
    ppub=$(curl -fsS "$HOST/dist/$pn.sha256" 2>/dev/null | awk '{print $1}')
    if [ -z "$ppub" ]; then say "/dist/$pn.sha256" "could not be fetched"; fail=1
    elif [ "$preal" = "$ppub" ]; then say "/dist/$pn" "$(wc -c < "$ptmp" | tr -d ' ') bytes, checksum matches"
    else say "/dist/$pn" "CHECKSUM MISMATCH -- the pair a person downloads disagrees with itself"; fail=1; fi
    # kosmos#8172: the served pointer for this pkg's channel may NAME it (pkg_sha256). Then it must be those bytes.
    # A pointer cut before #8172 names none, and that is said, not passed silently.
    case "$pn" in Kosmos.pkg) _vs_ptr=latest.json ;; Kosmos-staging.pkg) _vs_ptr=latest-staging.json ;; *) _vs_ptr="" ;; esac
    if [ -z "$_vs_ptr" ]; then say "/dist/$pn" "has no channel pointer to be held to (kosmos#8172 knows Kosmos.pkg and Kosmos-staging.pkg)"; fail=1
    elif curl -fsS -m 30 -H 'Cache-Control: no-cache' "$HOST/dist/$_vs_ptr" -o "$pdir/ptr" 2>/dev/null; then
      _vs_named=$(node -e 'try{const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(p.pkg_sha256===undefined?"":(/^[0-9a-f]{64}$/.test(String(p.pkg_sha256))?p.pkg_sha256:"MALFORMED"))}catch{}' "$pdir/ptr" 2>/dev/null)
      if [ "$_vs_named" = MALFORMED ] && [ "$_vs_ptr" = "$POINTER" ]; then say "/dist/$pn vs $_vs_ptr" "the pointer's pkg_sha256 is not a sha256, so it names nothing this run can hold $pn to"; fail=1
      elif [ "$_vs_named" = MALFORMED ]; then say "/dist/$pn vs $_vs_ptr" "the pointer's pkg_sha256 is not a sha256; not this run's channel ($POINTER), so not failed"
      elif [ -z "$_vs_named" ]; then say "/dist/$pn vs $_vs_ptr" "the pointer names no pkg (cut before kosmos#8172, or republished by hand): not checked"
      elif [ "$_vs_named" = "$preal" ]; then say "/dist/$pn vs $_vs_ptr" "is the pkg the pointer names (${preal:0:12})"
      elif [ "$_vs_ptr" = "$POINTER" ]; then say "/dist/$pn vs $_vs_ptr" "NOT the pkg the pointer names: served ${preal:0:12}, named ${_vs_named:0:12}"; fail=1
      # The OTHER channel's pointer is not this check's to enforce: a prod cut rewrites Kosmos-staging.pkg under the
      # older latest-staging.json, and a promote that could not move the pkg leaves latest.json naming one it does not
      # serve. Neither is this run's channel, so it is said, not failed.
      else say "/dist/$pn vs $_vs_ptr" "differs from what $_vs_ptr names (served ${preal:0:12}, named ${_vs_named:0:12}); not this run's channel ($POINTER), so not failed"; fi
    # An unreadable pointer fails THIS run's channel. The other channel's may be missing for reasons this run did not
    # cause (a site that never had a staging cut, an aborted cut's pointer removed), so it is said, not failed.
    elif [ "$_vs_ptr" = "$POINTER" ]; then say "/dist/$_vs_ptr" "could not be fetched, so $pn was not held to it"; fail=1
    else say "/dist/$_vs_ptr" "could not be fetched; not this run's channel ($POINTER), so $pn was not held to it and not failed"; fi
    # The sidecar must vouch for THESE bytes: a new sidecar beside the prior
    # pkg pair (each self-consistent) is the mixed edge state this line catches.
    if [ -s "$pdir/inputs" ]; then
      if [ -z "$pvouch" ]; then say "/dist/$pn.inputs vouches for" "NO bytes (no pkg: line) -- a hand-written or truncated sidecar"; fail=1
      elif [ "$pvouch" = "$preal" ]; then say "/dist/$pn.inputs vouches for" "these bytes"
      else say "/dist/$pn.inputs vouches for" "OTHER bytes (${pvouch:0:12}) than the served pkg (${preal:0:12})"; fail=1; fi
    fi
    # The signature and the staple, from the downloaded bytes, on a Mac only
    # (elsewhere the tools do not exist and their absence is said, not passed).
    if command -v pkgutil >/dev/null 2>&1; then
      # OUR identity, by team id, not any Developer ID Installer's (named once, lib/signing-identity.sh,
      # #3643). The build-time override (KOSMOS_INSTALLER_CERT) is deliberately NOT honoured here: it may be
      # a loose name or a SHA-1, and this check is about which TEAM signed what users download.
      # The identity of the release being verified ($REPO); if that checkout predates the lib, the one
      # beside this script.
      _vs_inst=""; _vs_lib="$REPO/tools/lib/signing-identity.sh"
      [ -f "$_vs_lib" ] || _vs_lib="$(dirname "$0")/lib/signing-identity.sh"
      if . "$_vs_lib" 2>/dev/null; then _vs_inst="${KOSMOS_SIGN_INSTALLER_DEFAULT:-}"; fi
      _vs_sig="$(pkgutil --check-signature "$ptmp" 2>/dev/null || true)"   # captured: no pipe into an early-exiting grep
      if [ -z "$_vs_inst" ]; then say "/dist/$pn signature" "NOT checked: could not read the signing identity from $_vs_lib"; fail=1
      elif printf '%s\n' "$_vs_sig" | grep -qF "$_vs_inst"; then say "/dist/$pn signature" "$_vs_inst"
      else say "/dist/$pn signature" "NOT signed by our Developer ID Installer ($_vs_inst)"; fail=1; fi
    else say "/dist/$pn signature" "not checked here (no pkgutil on this machine)"; fi
    if command -v xcrun >/dev/null 2>&1 && xcrun --find stapler >/dev/null 2>&1; then
      if xcrun stapler validate "$ptmp" >/dev/null 2>&1; then say "/dist/$pn staple" "notarisation ticket stapled"
      else say "/dist/$pn staple" "NO valid staple -- a fresh Mac shows the warning"; fail=1; fi
    else say "/dist/$pn staple" "not checked here (no stapler on this machine)"; fi
  else say "/dist/$pn" "could not be fetched"; fail=1; fi
  rm -rf "$pdir"
}
# Only a 404 means "no staging pkg served". Any other failure is said as itself, not read as "none".
_vs_scode="$(curl -sS -L -m 30 -o /dev/null -w '%{http_code}' -H 'Cache-Control: no-cache' "$HOST/dist/Kosmos-staging.pkg.sha256" 2>/dev/null)" || _vs_scode="${_vs_scode:-000}"
case "$_vs_scode" in
  200) _vs_pkg Kosmos-staging.pkg source; _vs_pkg Kosmos.pkg any ;;
  404) _vs_pkg Kosmos.pkg source ;;
  *) say "/dist/Kosmos-staging.pkg.sha256" "could not tell whether it is served (HTTP ${_vs_scode:-none}), so neither pkg was judged"; fail=1 ;;
esac

echo
[ "$fail" = "0" ] && echo "every artifact a user can receive matches the repo" || { echo "SOMETHING A USER RECEIVES IS WRONG"; exit 1; }
