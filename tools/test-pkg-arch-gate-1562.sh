#!/bin/bash
# #1562: the .pkg Distribution must gate arch + macOS UP FRONT, so an
# unsupported Mac (Intel, or macOS below the floor) is refused by macOS
# Installer with a clear reason BEFORE any download -- instead of running
# setup.sh, hitting its named refusal, and having that reason swallowed into
# /var/log/install.log while the user sees only the generic "The installation
# failed." A real user hit exactly this (an Intel or old-macOS Mac was let in
# by the old hostArchitectures="arm64,x86_64", downloaded, then died generic).
#
# This is a SOURCE guard, and deliberately so: the pkg build signs + notarizes
# (certs + a cut), so it cannot be run here. It asserts the Distribution the
# build EMITS declares the gates, and that the macOS floor matches setup.sh's
# own floor so the two enforcement points cannot silently drift apart.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }
# Extract an attribute VALUE from text $1 using grep -oE pattern $2 (which
# captures attr="value"), printing what is between the quotes, or empty if
# absent. The SAME pipeline is used for the real Distribution and for the
# control inputs, so a control exercises the exact extraction an assertion does
# (not a different substring helper), and it reads the attribute value rather
# than a substring of the whole block, so a comment naming a tag cannot satisfy
# or trip it.
xval() { printf '%s' "$1" | grep -oE "$2" | head -1 | sed 's/.*="//; s/"$//'; }

BUILD_SH="$REPO/tools/build-installer-pkg.sh"
SETUP_SH="$REPO/install/setup.sh"

# The Distribution the build emits (the heredoc's XML block), with XML comments
# STRIPPED. The strip is load-bearing, not tidiness: the extraction below reads
# the first `attr="value"` match, and a `<!-- ... -->` comment above <options>
# can hold a literal quoted attribute (the old value, an example). Without the
# strip a future editor writing one there would make the checks read the comment
# instead of the real attribute; with it, xval is genuinely immune to comment
# prose rather than immune by luck.
DIST_RAW="$(sed -n '/<installer-gui-script/,/<\/installer-gui-script>/p' "$BUILD_SH")"
if [ -z "$DIST_RAW" ]; then
  echo "FAIL  could not extract the Distribution from $BUILD_SH"; exit 1
fi
DIST="$(printf '%s' "$DIST_RAW" | python3 -c 'import sys,re; sys.stdout.write(re.sub(r"<!--.*?-->", "", sys.stdin.read(), flags=re.S))')"
if [ -z "$DIST" ]; then
  echo "FAIL  Distribution was empty after stripping XML comments"; exit 1
fi

ARCH_PAT='hostArchitectures="[^"]*"'
OSMIN_PAT='os-version min="[^"]*"'

# 1. arm64 ONLY. Kosmos ships no x86_64 bundle; declaring the extra arch lets an
#    Intel Mac run the installer, which then dies generic. arm64 makes macOS
#    refuse it up front. Read the attribute VALUE.
ARCHVAL="$(xval "$DIST" "$ARCH_PAT")"
if [ "$ARCHVAL" = "arm64" ]; then
  pass "Distribution hostArchitectures is exactly arm64 (no x86_64)"
else
  fail "Distribution hostArchitectures must be exactly \"arm64\", got \"$ARCHVAL\""
fi

# 2 + 3. macOS floor gated up front, and the min MATCHES setup.sh's own
#    MACOS_FLOOR, so the pkg's up-front gate and setup.sh's late gate cannot
#    drift to different numbers. Read the os-version min VALUE (a non-empty value
#    also proves the gate is present).
MAJ="$(grep -E '^MACOS_FLOOR_MAJOR=' "$SETUP_SH" | head -1 | cut -d= -f2)"
MIN="$(grep -E '^MACOS_FLOOR_MINOR=' "$SETUP_SH" | head -1 | cut -d= -f2)"
OSMIN="$(xval "$DIST" "$OSMIN_PAT")"
if [ -n "$OSMIN" ] && [ -n "$MAJ" ] && [ -n "$MIN" ] && [ "$OSMIN" = "$MAJ.$MIN" ]; then
  pass "Distribution gates macOS via os-version min $OSMIN, matching setup.sh's MACOS_FLOOR ($MAJ.$MIN)"
else
  fail "Distribution must gate macOS with <os-version min> equal to setup.sh's MACOS_FLOOR ($MAJ.$MIN), got \"$OSMIN\""
fi

# CONTROLS: run the SAME xval extraction on the OLD / ungated shapes, so a green
# run proves the extraction pipeline itself catches them, not a different helper.
if [ "$(xval '<options hostArchitectures="arm64,x86_64"/>' "$ARCH_PAT")" != "arm64" ]; then
  pass "CONTROL: the arch extraction rejects the old arm64,x86_64 value"
else
  fail "CONTROL broken: the arch extraction accepted the old shape as arm64"
fi
if [ -z "$(xval '<options hostArchitectures="arm64"/>' "$OSMIN_PAT")" ]; then
  pass "CONTROL: the macOS-gate extraction yields empty on a Distribution with no gate"
else
  fail "CONTROL broken: the macOS-gate extraction found a min in an ungated Distribution"
fi

# CONTROL: the comment-strip is what makes xval immune to a commented-out
# attribute. Prove it fires: a block whose COMMENT holds a bad hostArchitectures
# and whose real <options> is arm64 must still extract arm64 after stripping.
STRIP_IN='<!-- old value was hostArchitectures="arm64,x86_64" -->
<options hostArchitectures="arm64"/>'
STRIP_OUT="$(printf '%s' "$STRIP_IN" | python3 -c 'import sys,re; sys.stdout.write(re.sub(r"<!--.*?-->", "", sys.stdin.read(), flags=re.S))')"
if [ "$(xval "$STRIP_OUT" "$ARCH_PAT")" = "arm64" ]; then
  pass "CONTROL: comment-strip makes xval read the real attribute, not a comment's"
else
  fail "CONTROL broken: xval read a commented-out attribute value"
fi

if [ "$fails" -eq 0 ]; then
  echo "test-pkg-arch-gate-1562: all passed"
else
  echo "test-pkg-arch-gate-1562: $fails failed"; exit 1
fi
