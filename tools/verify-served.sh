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
#   engine/update.js:189  runs <base minus /dist>/setup    (existing installs, on update)
#   install/setup.sh:30   runs https://installkosmos.com/setup   (new installs)
#   install/setup.sh:373  GET  <base>/tmux-$ARCH.tar.gz  + .sha256
#   install/setup.sh:~390 GET  <base>/kosmos-$ARCH.tar.gz + .sha256
#   site index.html (the macOS Download button)  GET <base>/Kosmos.pkg (+ .sha256, .inputs)
set -uo pipefail
REPO=${REPO:-/Users/agent1/work/agent-workforce}
HOST=${HOST:-https://installkosmos.com}
fail=0
say() { printf '  %-42s %s\n' "$1" "$2"; }

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
check_bytes "$HOST/setup" "$REPO/install/setup.sh" "/setup"
# ⚠️ #1666: A 200 IS NOT AN ANSWER HERE, and this line used to be check_200.
# Existence is not the question: a STALE sidecar returns 200 forever. Measured
# on the site repo, `setup` was replaced at 21:30:58 on 2026-08-30 and deployed
# 76 seconds later, while `setup.sha256` was last written at 10:28:51 and still
# described the 0.6.17 installer. Production served an installer whose
# published checksum was a whole release behind, and this check said 200
# throughout.
#
# ⭐ IT PUNISHES ONLY THE CAREFUL. Anyone who verifies before piping to a shell
# gets a mismatch that reads as tampering; anyone who pipes straight to sh sees
# nothing, which is why it went unreported.
#
# 🛑 AND IT HAS TO LIVE HERE, NOT ONLY IN release.sh. The release has its own
# guard now, but THE DEPLOY THAT CAUSED THIS NEVER RAN release.sh: it was a
# hand-sync of one source file followed by a bare deploy. A guard that fires
# only during a cut cannot see the path that broke it. This one asks
# production, so it holds however the bytes got there.
check_sidecar() {  # label
  # 🛑 THE FETCH MUST BE CHECKED SEPARATELY FROM THE HASH. `curl ... | shasum`
  # turns a FAILED fetch into e3b0c442..., the hash of empty input, which is a
  # perfectly plausible-looking sha. Measured: on an unfetchable URL the body
  # side is never empty, so an emptiness test on it is dead code, and a
  # sidecar that happened to contain the empty hash would MATCH an unreachable
  # installer and report the site healthy. Same class as the 206 in #1662: a
  # failure wearing the shape of a success.
  sc_tmp=$(mktemp)
  if ! curl -fsS "$HOST/setup" -o "$sc_tmp" 2>/dev/null; then
    say "$1" "could not fetch /setup, so nothing was compared"; fail=1; rm -f "$sc_tmp"; return
  fi
  sc_body=$(shasum -a 256 < "$sc_tmp" | awk '{print $1}')
  rm -f "$sc_tmp"
  sc_claim=$(curl -fsS "$HOST/setup.sha256" 2>/dev/null | awk '{print $1}')
  if [ -z "$sc_claim" ]; then
    say "$1" "could not read setup.sha256, so nothing was compared"; fail=1
  elif [ "$sc_body" = "$sc_claim" ]; then
    say "$1" "describes the served installer"
  else
    say "$1" "STALE: claims $sc_claim, /setup hashes to $sc_body"; fail=1
  fi
}
check_sidecar "/setup.sha256"
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
  if curl -fsS "$HOST/setup?v=$want" -o "$vtmp_s" && git -C "$SITE" show origin/main:setup > "$vtmp_c" 2>/dev/null && [ -s "$vtmp_s" ] && [ -s "$vtmp_c" ]; then
    if cmp -s "$vtmp_s" "$vtmp_c"; then
      say "/setup (history)" "matches origin/main of the site$([ "$fetched" = yes ] || printf ' (fetch failed; compared against the last-fetched origin/main)')"
    else
      say "/setup (history)" "SERVED SCRIPT IS NOT THE COMMITTED ONE (origin/main of the site)$([ "$fetched" = yes ] || printf '; and the fetch failed, so origin/main may be stale here')"; fail=1
    fi
  else
    say "/setup (history)" "COULD NOT COMPARE (the served script or origin/main:setup did not come back)"; fail=1
  fi
  rm -f "$vtmp_s" "$vtmp_c"
else
  say "/setup (history)" "NO SITE CHECKOUT at $SITE, so the served script was not checked against history"; fail=1
fi

echo "== what an existing install polls =="
served=$(curl -fsS -H 'Cache-Control: no-cache' "$HOST/dist/latest.json")
want=$(node -e "console.log(require('$REPO/package.json').version)")
if printf '%s' "$served" | grep -q "\"$want\""; then say "/dist/latest.json" "$served"; else say "/dist/latest.json" "$served -- expected $want"; fail=1; fi

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
pdir=$(mktemp -d); pvouch=
if curl -fsS -H 'Cache-Control: no-cache' "$HOST/dist/Kosmos.pkg.inputs" -o "$pdir/inputs" 2>/dev/null && [ -s "$pdir/inputs" ]; then
  pside=$(pkg_sidecar_inputs "$pdir/inputs"); pvouch=$(pkg_sidecar_pkgsha "$pdir/inputs")
  if [ -n "$pwant" ] && [ "$pside" = "$pwant" ]; then say "/dist/Kosmos.pkg.inputs" "matches source (${pwant:0:12})"
  else say "/dist/Kosmos.pkg.inputs" "STALE -- served ${pside:0:12}, source ${pwant:0:12}"; fail=1; fi
else say "/dist/Kosmos.pkg.inputs" "MISSING -- the served pkg predates the guard, its inputs are unknown"; fail=1; fi
# ⚠️ NAMED Kosmos.pkg ON DISK, not a bare mktemp: `stapler validate` decides
# the file type from the extension and reports "no valid staple" on a stapled
# pkg with none. Measured on the served pkg itself: rc 66 as `mktemp` output,
# rc 0 as served.pkg, same bytes. A check that cannot reach the state it
# tests reads as the defect it was built to catch.
ptmp="$pdir/Kosmos.pkg"
if curl -fsS "$HOST/dist/Kosmos.pkg" -o "$ptmp"; then
  preal=$(_pkg_hash < "$ptmp" | awk '{print $1}')
  ppub=$(curl -fsS "$HOST/dist/Kosmos.pkg.sha256" 2>/dev/null | awk '{print $1}')
  if [ -z "$ppub" ]; then say "/dist/Kosmos.pkg.sha256" "could not be fetched"; fail=1
  elif [ "$preal" = "$ppub" ]; then say "/dist/Kosmos.pkg" "$(wc -c < "$ptmp" | tr -d ' ') bytes, checksum matches"
  else say "/dist/Kosmos.pkg" "CHECKSUM MISMATCH -- the pair a person downloads disagrees with itself"; fail=1; fi
  # The sidecar must vouch for THESE bytes: a new sidecar beside the prior
  # pkg pair (each self-consistent) is the mixed edge state this line catches.
  if [ -s "$pdir/inputs" ]; then
    if [ -z "$pvouch" ]; then say "/dist/Kosmos.pkg.inputs vouches for" "NO bytes (no pkg: line) -- a hand-written or truncated sidecar"; fail=1
    elif [ "$pvouch" = "$preal" ]; then say "/dist/Kosmos.pkg.inputs vouches for" "these bytes"
    else say "/dist/Kosmos.pkg.inputs vouches for" "OTHER bytes (${pvouch:0:12}) than the served pkg (${preal:0:12})"; fail=1; fi
  fi
  # The signature and the staple, from the downloaded bytes, on a Mac only
  # (elsewhere the tools do not exist and their absence is said, not passed).
  if command -v pkgutil >/dev/null 2>&1; then
    # OUR identity, by team id, not any Developer ID Installer's.
    if pkgutil --check-signature "$ptmp" 2>/dev/null | grep -q "Developer ID Installer: Stone Syndicate LLC (864QZ69GF2)"; then say "/dist/Kosmos.pkg signature" "Developer ID Installer, Stone Syndicate LLC (864QZ69GF2)"
    else say "/dist/Kosmos.pkg signature" "NOT signed by Stone Syndicate's Developer ID Installer (864QZ69GF2)"; fail=1; fi
  else say "/dist/Kosmos.pkg signature" "not checked here (no pkgutil on this machine)"; fi
  if command -v xcrun >/dev/null 2>&1 && xcrun --find stapler >/dev/null 2>&1; then
    if xcrun stapler validate "$ptmp" >/dev/null 2>&1; then say "/dist/Kosmos.pkg staple" "notarisation ticket stapled"
    else say "/dist/Kosmos.pkg staple" "NO valid staple -- a fresh Mac shows the warning"; fail=1; fi
  else say "/dist/Kosmos.pkg staple" "not checked here (no stapler on this machine)"; fi
else say "/dist/Kosmos.pkg" "could not be fetched"; fail=1; fi
rm -rf "$pdir"

echo
[ "$fail" = "0" ] && echo "every artifact a user can receive matches the repo" || { echo "SOMETHING A USER RECEIVES IS WRONG"; exit 1; }
