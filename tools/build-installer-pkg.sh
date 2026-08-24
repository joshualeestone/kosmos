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

echo "==> pkgbuild (payload-free, scripts only)"
pkgbuild --nopayload \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --scripts "$SCRIPTS" \
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
echo "built + notarised + stapled: $PKG"
