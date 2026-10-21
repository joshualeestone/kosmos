#!/bin/bash
#
# Build a SIGNED, NOTARISED, STAPLED Kosmos installer .pkg (#546 / #555).
#
#   bash tools/build-installer-pkg.sh <version>
#
# The package is PAYLOAD-FREE: it ships only scripts, a postinstall that runs the
# current install/setup.sh (installkosmos.com/setup) as the console user, its
# helpers, and the release check (#6576).
# Double-clicking opens macOS's own Installer UI (no Terminal, no paste, no
# "Possible Malware" dialog). The PACKAGE is signed (Developer ID Installer),
# then notarised and stapled. Its scripts carry ONE executable of ours, the
# release check kosmos-pkg-verify (#6576), which is codesigned (Developer ID
# Application, hardened runtime) before pkgbuild; there is no app bundle and
# no inside-out dylib signing here, which is the app-bundle path (#555).
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
# ⚠️ THE VERSION IS METADATA ONLY. It is baked into the component and the
# pkg-ref (Installer shows it), but the pkg is rebuilt only when its INPUTS
# change (tools/lib/pkg-inputs.sh), so a pkg that stays current across cuts
# carries an older version string than the release that serves it. That is
# by design for a payload-free pkg; do not "fix" it by hashing the version.
VERSION="${1:?usage: bash tools/build-installer-pkg.sh <version>}"
OUT_DIR="${OUT_DIR:-$REPO/dist}"
SCRIPTS="$REPO/install/pkg-scripts"
IDENTIFIER="com.stonesyndicate.kosmos.installer"
. "$REPO/tools/lib/signing-identity.sh"   # the one place the signing team is named (#3643)
INSTALLER_CERT="${KOSMOS_INSTALLER_CERT:-$KOSMOS_SIGN_INSTALLER_DEFAULT}"
NOTARY_KEY_ID="${KOSMOS_NOTARY_KEY_ID:-$KOSMOS_NOTARY_KEY_ID_DEFAULT}"
NOTARY_ISSUER="${KOSMOS_NOTARY_ISSUER:-$KOSMOS_NOTARY_ISSUER_DEFAULT}"
PKG="$OUT_DIR/Kosmos.pkg"
UNSIGNED="$OUT_DIR/.Kosmos-unsigned.pkg"

# Fail loud if the signing identity is absent.
if ! security find-identity -v | grep -qF "$INSTALLER_CERT"; then
  echo "FATAL: signing identity not found: $INSTALLER_CERT" >&2
  echo "Refusing to build an unsigned package that would fail notarisation later." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
# All three outputs go, not only the pkg: a build that dies after productsign
# must not leave a fresh pkg beside a STALE sidecar and checksum.
rm -f "$PKG" "$UNSIGNED" "$OUT_DIR/Kosmos.pkg.inputs" "$OUT_DIR/Kosmos.pkg.sha256"

BUILD="$(mktemp -d)"
# kosmos#6831: the EXIT trap that removes $BUILD also turns a death after it (a missing library, an unset
# variable) into a failure, which bash 3.2 would otherwise report as exit 0.
. "$REPO/tools/lib/exit-guard.sh"
_cleanup() { rm -rf "$BUILD"; }
kosmos_exit_guard _cleanup build-installer-pkg
RESOURCES="$REPO/install/pkg-resources"

# The input identity is taken NOW, before pkgbuild reads a byte, and written
# at the end: this script is also run by hand from a checkout other agents
# fast-forward, and a pull during the minutes of notarytool's wait would
# otherwise produce a sidecar naming inputs this pkg was not built from.
. "$REPO/tools/lib/pkg-inputs.sh"
_insha="$(pkg_input_sha "$REPO")" || { echo "could not compute the pkg input sha" >&2; exit 1; }
echo "==> inputs: $_insha"

# kosmos#6576: the release check a first install runs (install/pkg-verify). Built here, signed with the Developer ID
# Application identity with the hardened runtime (notarization requires both for any executable in the package),
# and staged beside the scripts with the floor it checks against: the oldest release it accepts, the first signed
# one, a reviewed constant (install/pkg-verify/floor), NOT this build's version, which can run ahead of what the
# production pointer serves. While it reads "off" the postinstall does not run the check at all (until production
# serves a signed release), and it is built and signed even then, so the Developer ID Application identity is needed
# for every pkg build. The package is no longer free of Mach-O: this one helper is the exception.
APP_CERT="${KOSMOS_APP_CERT:-$KOSMOS_SIGN_APP_DEFAULT}"
if ! security find-identity -v | grep -qF "$APP_CERT"; then
  echo "FATAL: signing identity not found: $APP_CERT (the release check must be signed)" >&2
  exit 1
fi
STAGED_SCRIPTS="$BUILD/scripts"
mkdir -p "$STAGED_SCRIPTS"
cp -R "$SCRIPTS/." "$STAGED_SCRIPTS/"
echo "==> the release check (kosmos-pkg-verify): build, sign, verify"
xcrun swiftc -target "arm64-apple-macos$(cat "$REPO/tools/macos-floor")" -O "$REPO/install/pkg-verify/main.swift" \
  -o "$STAGED_SCRIPTS/kosmos-pkg-verify"
codesign --force --options runtime --timestamp --sign "$APP_CERT" "$STAGED_SCRIPTS/kosmos-pkg-verify"
codesign --verify --strict "$STAGED_SCRIPTS/kosmos-pkg-verify"
cp "$REPO/install/pkg-verify/floor" "$STAGED_SCRIPTS/kosmos-pkg-floor"

echo "==> pkgbuild (scripts only: the postinstall, its helpers, and the release check)"
pkgbuild --nopayload \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --scripts "$STAGED_SCRIPTS" \
  "$BUILD/component.pkg"

echo "==> distribution.xml (Welcome + Conclusion UI + bottom-left app logo)"
# The Kosmos app logo in the Installer's left column, bottom-left, like Tailscale
# (#1879, Josh's ask). alignment=bottomleft + scaling=none means the PNG is drawn
# at its own size in the corner; the margin is baked INTO the art, so this places
# it without stretching. Both a light AND a darkAqua image are named on purpose:
# with only <background/>, a dark-mode install shows NO logo at all. Both PNGs live
# in install/pkg-resources/ (passed to productbuild via --resources), so they are
# part of the pkg input hash and a cut rebuilds the pkg when they change.
cat > "$BUILD/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
  <title>Kosmos</title>
  <background file="background.png" alignment="bottomleft" scaling="none" mime-type="image/png"/>
  <background-darkAqua file="background-darkAqua.png" alignment="bottomleft" scaling="none" mime-type="image/png"/>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <!-- #1562: gate the machine UP FRONT, so an unsupported Mac is refused by
       macOS Installer with a clear reason BEFORE any download, instead of
       running setup.sh, hitting its named refusal, and having that reason
       swallowed into /var/log/install.log while the user sees only the generic
       "The installation failed." arm64 only (Kosmos ships no x86_64 bundle;
       the old value also listed x86_64, which let Intel Macs in), and macOS
       13.5 is the same floor setup.sh enforces (the shipped Node runtime's
       minos). -->
  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>
  <volume-check>
    <allowed-os-versions>
      <os-version min="13.5"/>
    </allowed-os-versions>
  </volume-check>
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
NOTARY_KEY="$("$HOME/.claude/scripts/secrets-map.sh" path "$KOSMOS_NOTARY_SECRET_TARGET")"
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
( cd "$OUT_DIR" && _pkg_hash < Kosmos.pkg | awk '{print $1"  Kosmos.pkg"}' > Kosmos.pkg.sha256 )
echo "==> checksum: $(cat "$OUT_DIR/Kosmos.pkg.sha256")"

echo "built + notarised + stapled: $PKG"
kosmos_finished
