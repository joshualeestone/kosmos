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
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

BUILD_SH="$REPO/tools/build-installer-pkg.sh"
SETUP_SH="$REPO/install/setup.sh"

# The Distribution the build emits (the heredoc's XML block).
DIST="$(sed -n '/<installer-gui-script/,/<\/installer-gui-script>/p' "$BUILD_SH")"
if [ -z "$DIST" ]; then
  echo "FAIL  could not extract the Distribution from $BUILD_SH"; exit 1
fi

# 1. arm64 ONLY. Kosmos ships no x86_64 bundle; declaring the extra arch lets an
#    Intel Mac run the installer, which then dies generic. arm64 makes macOS
#    refuse it up front. Check the ATTRIBUTE VALUE itself (not a substring over
#    the whole block), so a comment that merely names the old value cannot
#    satisfy or trip this.
ARCHVAL="$(printf '%s' "$DIST" | grep -oE 'hostArchitectures="[^"]*"' | head -1 | sed 's/.*="//; s/"$//')"
if [ "$ARCHVAL" = "arm64" ]; then
  pass "Distribution hostArchitectures is exactly arm64 (no x86_64)"
else
  fail "Distribution hostArchitectures must be exactly \"arm64\", got \"$ARCHVAL\""
fi

# 2. macOS floor gated up front via allowed-os-versions.
if has "$DIST" "<allowed-os-versions>" && has "$DIST" '<os-version min="13.5"/>'; then
  pass "Distribution gates macOS via allowed-os-versions (min 13.5)"
else
  fail 'Distribution must gate macOS with <allowed-os-versions><os-version min="13.5"/>'
fi

# 3. The floor MATCHES setup.sh's own MACOS_FLOOR, so the pkg's up-front gate and
#    setup.sh's late gate cannot drift to different numbers.
MAJ="$(grep -E '^MACOS_FLOOR_MAJOR=' "$SETUP_SH" | head -1 | cut -d= -f2)"
MIN="$(grep -E '^MACOS_FLOOR_MINOR=' "$SETUP_SH" | head -1 | cut -d= -f2)"
if [ -n "$MAJ" ] && [ -n "$MIN" ] && has "$DIST" "<os-version min=\"$MAJ.$MIN\"/>"; then
  pass "Distribution macOS floor ($MAJ.$MIN) matches setup.sh's MACOS_FLOOR"
else
  fail "Distribution os-version min must equal setup.sh's MACOS_FLOOR ($MAJ.$MIN)"
fi

# CONTROL: prove the two content checks CAN fail, on the OLD (bad) shape, so a
# green run means the guards fired rather than matched nothing.
BAD_ARCH='<options hostArchitectures="arm64,x86_64"/>'
if has "$BAD_ARCH" 'arm64,x86_64'; then
  pass "CONTROL: the arch check catches the old arm64,x86_64"
else
  fail "CONTROL broken: arch check would not catch the old shape"
fi
BAD_OS='<options hostArchitectures="arm64"/>'
if ! has "$BAD_OS" '<os-version min="13.5"/>'; then
  pass "CONTROL: the macOS-gate check catches a Distribution with no gate"
else
  fail "CONTROL broken: macOS-gate check would pass an ungated Distribution"
fi

if [ "$fails" -eq 0 ]; then
  echo "test-pkg-arch-gate-1562: all passed"
else
  echo "test-pkg-arch-gate-1562: $fails failed"; exit 1
fi
