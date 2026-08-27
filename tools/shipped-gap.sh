#!/usr/bin/env bash
# How far is main ahead of what people are actually running? (kosmos#1050)
#
# #1050 measured 50 commits on main since the last build that reached anyone,
# and the number had to be worked out by hand each time. This is that number on
# demand.
#
# ⚠️ IT DOES NOT FIX THE RATE. Merge rate exceeding release capacity is a
# capacity decision, not a script. This makes the gap a figure rather than an
# impression, so the decision is made against one.
#
#   bash tools/shipped-gap.sh
#
# 0  nothing merged since the served build
# 1  there is a gap (non-zero is normal mid-day; the SIZE is the signal)
# 2  could not tell
#
# ⚠️ EXIT 2 IS NOT A PASS. Failing to reach the site is not the same as
# nothing being unshipped.
set -uo pipefail

BASE="${KOSMOS_DIST_BASE:-https://installkosmos.com/dist}"
ARCH="${KOSMOS_DIST_ARCH:-arm64}"
REPO="${KOSMOS_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
say() { printf '%s\n' "$*"; }

version=$(curl -s --max-time 12 "$BASE/latest.json" 2>/dev/null | tr -d ' \n' | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
if [ -z "$version" ]; then
  say "could not read $BASE/latest.json, so what is served is unknown"; exit 2
fi
# 🛑 latest.json IS A POINTER, NOT A FINISH LINE, and this tool cannot see the
# difference. release.sh deploys the site at step 8 and KEEPS VERIFYING after
# that, so latest.json reads the new version BEFORE the cut has finished. For
# that window this tool will name a version nobody is running, and if the
# manifest is up too it will report a gap of zero against a build that never
# completed. The completed line in the cut's own run is the signal; nothing
# fetched over HTTP is.
# ⇒ This answers "how far is main ahead of the pointer". It does NOT answer
#   "did this cut ship". Those are different questions and only one of them is
#   safe to read during a cut.
say "served to people: $version   (per latest.json, which is a POINTER:"
say "                              during a cut it moves before the cut finishes)"

# 🔑 THE SHA COMES FROM THE MANIFEST, NOT FROM THE REPO, and the distinction is
# the whole reason this is trustworthy. `app.commit` is what is IN the build
# people are running. A bump commit's subject is only where the repo changed its
# version string. A cut that freezes one sha and bumps at another makes those
# two diverge, and the repo-side answer would be quietly wrong in exactly the
# case that matters.
manifest="$BASE/kosmos-${version}-${ARCH}.manifest.json"
sha=$(curl -s --max-time 12 "$manifest" 2>/dev/null | tr -d ' \n' \
      | sed -n 's/.*"app":{[^}]*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p')
[ -z "$sha" ] && sha=$(curl -s --max-time 12 "$manifest" 2>/dev/null | tr -d ' \n' | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1)
if [ -z "$sha" ]; then
  say "could not read app.commit from $manifest"
  say "  (so the served SHA is unknown; the gap is not counted rather than guessed)"
  exit 2
fi
say "built from:       ${sha:0:8}"

if ! git -C "$REPO" cat-file -e "$sha" 2>/dev/null; then
  say "that commit is not in this checkout; fetch, then run again"; exit 2
fi

n=$(git -C "$REPO" rev-list --count "$sha"..origin/main 2>/dev/null || echo "")
if [ -z "$n" ]; then say "could not count commits since that commit"; exit 2; fi

# A cross-check, NOT a second answer. If the bump commit for this version is not
# the commit the build was made from, the cut froze a different sha than it
# bumped, which is worth saying out loud. The manifest still decides the number.
want="v${version//./} -- version"
bump=$(git -C "$REPO" log origin/main --format='%H %s' 2>/dev/null \
       | awk -v w="$want" '{ s=substr($0, index($0," ")+1); if (s==w) { print $1; exit } }')
if [ -n "$bump" ] && [ "${bump:0:8}" != "${sha:0:8}" ]; then
  say ""
  say "⚠️ the \"$want\" commit is ${bump:0:8}, but the build was made from ${sha:0:8}."
  say "   The cut froze a different sha than it bumped. The number below uses the"
  say "   build's own sha, which is what people are actually running."
fi

say ""
if [ "$n" -eq 0 ]; then
  say "OK: main is exactly what is served. Nothing is waiting."
  say "   (if a cut is in flight, this can be true of a build that has not finished)"
  exit 0
fi
say "$n commits are merged and NOT in anyone's hands."
say "Non-zero is normal mid-day. The question is whether it grows faster than"
say "cuts land, which is what #1050 is about."
exit 1
