#!/bin/bash
#
# Build a SIGNED, NOTARISED, STAPLED Kosmos installer .pkg (#546 / #555).
#
#   bash tools/build-installer-pkg.sh <version>
#
# The package is PAYLOAD-FREE: it ships only a postinstall that runs the
# current install/setup.sh (installkosmos.com/setup) as the console user.
# Double-clicking opens macOS's own Installer UI — no Terminal, no paste, no
# "Possible Malware" dialog — and because it carries NO Mach-O of ours, only
# the PACKAGE is signed (Developer ID Installer), then notarised and stapled.
# There is no codesign of executables and no inside-out dylib signing here;
# that is the app-bundle path (#555's recipe), and this deliberately avoids it
# by shipping nothing to sign but a shell script.
#
# It is a DISTRIBUTION package (productbuild), not a bare component, so it
# carries a Welcome and a Conclusion screen (#546/#662/#663 fresh-account
# test): the Welcome sets expectations for the minutes-long silent download
# bar (a named wait is not a hang), and the Conclusion tells the person where
# Kosmos went and how to open it (installing is not the finish line; opening
# it is). In a .pkg, setup.sh's own stdout guidance is SWALLOWED by Installer,
# so that guidance has to live in the package UI, which the person sees.
#
# Requires: the Developer ID Installer identity in the keychain (partition
# list set for unattended signing), and the notarytool key via the secrets
# map. FAILS LOUD if the identity is missing — never falls back to unsigned,
# which builds clean and fails notarisation later (#555's lesson).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:?usage: bash tools/build-installer-pkg.sh <version>}"
OUT_DIR="${OUT_DIR:-$REPO/dist}"
SCRIPTS="$REPO/install/pkg-scripts"
IDENTIFIER="com.stonesyndicate.kosmos.installer"
INSTALLER_CERT="${KOSMOS_INSTALLER_CERT:-Developer ID Installer: Stone Syndicate LLC (864QZ69GF2)}"
NOTARY_KEY_ID="${KOSMOS_NOTARY_KEY_ID:-43F2HU5BT8}"
NOTARY_ISSUER="${KOSMOS_NOTARY_ISSUER:-69a6de7f-a03e-47e3-e053-5b8c7c11a4d1}"
PKG="$OUT_DIR/Kosmos.pkg"
UNSIGNED="$OUT_DIR/.Kosmos-unsigned.pkg"

# Fail loud if the signing identity is absent.
if ! security find-identity -v | grep -qF "$INSTALLER_CERT"; then
  echo "FATAL: signing identity not found: $INSTALLER_CERT" >&2
  echo "Refusing to build an unsigned package that would fail notarisation later." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$PKG" "$UNSIGNED"

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
RESOURCES="$REPO/install/pkg-resources"

# The input identity is taken NOW, before pkgbuild reads a byte, and written
# at the end: this script is also run by hand from a checkout other agents
# fast-forward, and a pull during the minutes of notarytool's wait would
# otherwise produce a sidecar naming inputs this pkg was not built from.
. "$REPO/tools/lib/pkg-inputs.sh"
_insha="$(pkg_input_sha "$REPO")" || { echo "could not compute the pkg input sha" >&2; exit 1; }
echo "==> inputs: $_insha"

echo "==> pkgbuild (payload-free component, scripts only)"
pkgbuild --nopayload \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --scripts "$SCRIPTS" \
  "$BUILD/component.pkg"

echo "==> distribution.xml (Welcome + Conclusion UI)"
cat > "$BUILD/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
  <title>Kosmos</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
  <choices-outline>
    <line choice="default"><line choice="$IDENTIFIER"/></line>
  </choices-outline>
  <choice id="default"/>
  <choice id="$IDENTIFIER" visible="false">
    <pkg-ref id="$IDENTIFIER"/>
  </choice>
  <pkg-ref id="$IDENTIFIER" version="$VERSION" onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
XML

echo "==> productbuild (distribution package)"
productbuild --distribution "$BUILD/distribution.xml" \
  --package-path "$BUILD" \
  --resources "$RESOURCES" \
  "$UNSIGNED"

echo "==> productsign (Developer ID Installer)"
productsign --sign "$INSTALLER_CERT" "$UNSIGNED" "$PKG"
rm -f "$UNSIGNED"

echo "==> notarytool submit --wait"
NOTARY_KEY="$("$HOME/.claude/scripts/secrets-map.sh" path kosmos-notarize)"
xcrun notarytool submit "$PKG" \
  --key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" \
  --wait

echo "==> stapler staple"
xcrun stapler staple "$PKG"

echo "==> proof (the negative: genuinely notarised + stapled, not just present)"
echo "-- pkgutil --check-signature --"; pkgutil --check-signature "$PKG"
echo "-- spctl -a -t install --";       spctl -a -vvv -t install "$PKG" 2>&1 || true
echo "-- stapler validate --";          xcrun stapler validate "$PKG"

echo
# The input sidecar (#638, B guard): the sha of the inputs THIS build was made
# from (taken before pkgbuild, above) and the sha of the bytes it produced,
# published beside the pkg so a later release can prove the served pkg is not
# stale against source AND that the sidecar belongs to these bytes. Written by
# the SAME shared functions the release verifies with, so they cannot drift.
pkg_sidecar_write "$PKG" "$_insha" "$OUT_DIR/Kosmos.pkg.inputs"
echo "==> input sidecar: $(tr '\n' ' ' < "$OUT_DIR/Kosmos.pkg.inputs")"
# The checksum the site serves beside the pkg, in the shape every other served
# pair uses ("<sha>  Kosmos.pkg"), written HERE so build and publish cannot
# drift: the first served pair was made by hand.
( cd "$OUT_DIR" && shasum -a 256 Kosmos.pkg > Kosmos.pkg.sha256 )
echo "==> checksum: $(cat "$OUT_DIR/Kosmos.pkg.sha256")"

echo "built + notarised + stapled: $PKG"
