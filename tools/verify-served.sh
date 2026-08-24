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
check_200   "$HOST/setup.sha256" "/setup.sha256"
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
  vpub=$(curl -fsS "$vurl.sha256" | awk '{print $1}')
  if [ "$vreal" = "$vpub" ]; then say "/dist/kosmos-$want-arm64.tar.gz" "versioned pair present, checksum matches"
  else say "/dist/kosmos-$want-arm64.tar.gz" "CHECKSUM MISMATCH on the versioned pair"; fail=1; fi
else say "/dist/kosmos-$want-arm64.tar.gz" "MISSING -- installers fall back to the cacheable plain name"; fail=1; fi
rm -f "$vtmp"

echo
[ "$fail" = "0" ] && echo "every artifact a user can receive matches the repo" || { echo "SOMETHING A USER RECEIVES IS WRONG"; exit 1; }
