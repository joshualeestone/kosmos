#!/bin/bash
#
# kosmos#2792: the .pkg installer must refuse an Intel Mac with a CLEAR
# "Apple Silicon required" message, at the door, before install -- not leave the
# user with Apple's generic "The installation failed" (which is what happens when
# setup.sh's own arch refusal is swallowed by Installer into /var/log/install.log).
#
# The fix lives in the distribution.xml template inside tools/build-installer-pkg.sh:
# an <installation-check> running kosmosArchCheck(), which allows ONLY a positively
# confirmed Apple-silicon Mac (sysctl hw.optional.arm64 == "1") and otherwise fails
# Fatal with the clear message.
#
# This test RENDERS that distribution.xml template (no signing, no productbuild, no
# network -- so it runs in the automatic suite) and asserts the guard is present,
# well-formed, and shaped so it actually blocks Intel while keeping the installer
# able to open on Intel to show the message. A negative control proves the checks
# can fail.
#
#   bash tools/test-pkg-arch-guard-2792.sh
#
# NOTE (stated limitation): this cannot exercise the macOS Installer JS engine on a
# real Intel Mac from CI, so it verifies the guard's PRESENCE and SHAPE, not the live
# refusal. productbuild acceptance + the message + the Fatal type + the x86_64 host
# arch are the checkable proxies; the live Intel refusal is verified by hand on Intel
# hardware when available.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$REPO/tools/build-installer-pkg.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

[ -f "$BUILD" ] || { echo "FAIL: build script not found at $BUILD"; exit 1; }

# Render the distribution.xml exactly as the build script generates it: the body
# between `cat > "$BUILD/distribution.xml" <<XML` and the closing lone `XML`, with
# the two shell vars the heredoc interpolates substituted.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
awk '
  /cat > "\$BUILD\/distribution\.xml" <<XML/ { grab=1; next }
  grab && /^XML$/ { grab=0 }
  grab { print }
' "$BUILD" \
  | sed -e 's/\$IDENTIFIER/com.stonesyndicate.kosmos.installer/g' \
        -e 's/\$VERSION/0.0.0-test/g' > "$T/distribution.xml"

[ -s "$T/distribution.xml" ] || { echo "FAIL: could not render distribution.xml from the build script heredoc"; exit 1; }

# 1. Well-formed XML (a malformed installation-check/script block would break the build).
if command -v xmllint >/dev/null 2>&1; then
  xmllint --noout "$T/distribution.xml" 2>/dev/null \
    && ok "the rendered distribution.xml is well-formed" \
    || bad "the rendered distribution.xml is NOT well-formed XML"
else
  echo "SKIP  xmllint not available (well-formedness not checked)"
fi

# 2. The installation-check is wired to kosmosArchCheck().
grep -q '<installation-check script="kosmosArchCheck()"/>' "$T/distribution.xml" \
  && ok "an installation-check runs kosmosArchCheck() at the door" \
  || bad "no installation-check wired to kosmosArchCheck() -- an Intel Mac would not be refused up front (#2792)"

# 3. The check allows ONLY a positively confirmed Apple-silicon Mac.
grep -q "hw.optional.arm64" "$T/distribution.xml" \
  && ok "the check confirms Apple silicon via hw.optional.arm64" \
  || bad "the check does not read hw.optional.arm64 -- it cannot tell Apple silicon from Intel"

# 4. The refusal is FATAL (blocks install), not a warning the user can click past.
grep -q "my.result.type = 'Fatal'" "$T/distribution.xml" \
  && ok "the refusal is Fatal (blocks the install), not a skippable warning" \
  || bad "the arch refusal is not Fatal -- an Intel user could proceed anyway"

# 5. The message is clear and names Apple silicon (the whole point of #2792).
grep -q "Kosmos requires a Mac with Apple silicon (M1 or newer)" "$T/distribution.xml" \
  && ok "the refusal message clearly names the Apple-silicon requirement" \
  || bad "the refusal message does not clearly name Apple silicon -- back to a generic-looking failure (#2792)"

# 6. hostArchitectures KEEPS x86_64 so Installer opens on Intel far enough to SHOW the
#    message. Dropping x86_64 would make Installer refuse with ITS generic message first,
#    and the clear message would never appear -- the exact regression #2792 fixes.
grep -q 'hostArchitectures="[^"]*x86_64[^"]*"' "$T/distribution.xml" \
  && ok "hostArchitectures keeps x86_64 so the installer opens on Intel to show the message" \
  || bad "hostArchitectures no longer allows x86_64 -- Installer would refuse Intel with a GENERIC message before the clear one can show (#2792)"

# NEGATIVE CONTROL: strip the installation-check and confirm the presence check would
# fail on it. Without this, a check that can never fail reads as coverage (the exact
# defect tools.every-test-runs.test.js exists to catch).
sed '/<installation-check script="kosmosArchCheck()"\/>/d' "$T/distribution.xml" > "$T/stripped.xml"
if grep -q '<installation-check script="kosmosArchCheck()"/>' "$T/stripped.xml"; then
  bad "CONTROL: the installation-check presence assertion could not be made to fail (test is vacuous)"
else
  ok "CONTROL: removing the installation-check makes the presence assertion fail (test is not vacuous)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "$PASS passed, 0 failed"
  exit 0
else
  echo "$PASS passed, $FAIL FAILED"
  exit 1
fi
