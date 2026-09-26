#!/bin/bash
# Who signs Kosmos for macOS, in ONE place (#3643).
#
# Every tool that signs, notarises or checks the installer's signature reads these defaults from
# here: the app bundle's codesign (build-kosmos-bundle.sh), the installer .pkg and its notarisation
# (build-installer-pkg.sh), the cut's signing preflight (lib/cut-sign-preflight.sh), and the
# served-pkg signer check (verify-served.sh). Before this file there were four hard-coded copies.
# Not covered: no check reads the served APP binaries' signing team (kosmos-artifact-check.sh accepts
# any Developer ID), so after a switch confirm the app with `codesign -dv` by hand.
#
# Switching teams (#3643, Kosmos Agent Manager, Inc.) is an edit HERE, plus the new team's certs in
# the cutting keychain and its App Store Connect API key (.p8) filed in the secrets map under the
# target named below.
#
# This file is a hashed input of the installer .pkg (lib/pkg-inputs.sh): changing any VALUE line
# makes the next cut rebuild, sign and notarise the pkg (minutes; it needs the Installer identity and
# the notary key on the cut box). Whole-line comments and blank lines are not hashed, so editing
# these comments costs nothing. Keep comments on their own lines: a value line is hashed byte for
# byte, including an inline comment or a change of indentation.
#
# What a team switch changes for people who already have Kosmos: macOS privacy grants are keyed to
# the signer, so Files and Folders, Automation (Terminal) and Accessibility for the bundled tmux may
# each ask once more. Say so in that release's notes. Updates are unaffected (the updater does not
# check the signing team). The installer's bundle identifier (com.stonesyndicate.kosmos.installer,
# in build-installer-pkg.sh) is not a signing value and is deliberately left alone: changing it
# changes installer receipts.
#
# At the BUILD call sites each value stays overridable by its existing environment variable:
# KOSMOS_CODESIGN_ID, KOSMOS_INSTALLER_CERT, KOSMOS_NOTARY_KEY_ID, KOSMOS_NOTARY_ISSUER.
# verify-served deliberately ignores KOSMOS_INSTALLER_CERT: it checks which team signed what users
# download.
KOSMOS_SIGN_TEAM_NAME="Stone Syndicate LLC"
KOSMOS_SIGN_TEAM_ID="864QZ69GF2"
KOSMOS_SIGN_APP_DEFAULT="Developer ID Application: $KOSMOS_SIGN_TEAM_NAME ($KOSMOS_SIGN_TEAM_ID)"
KOSMOS_SIGN_INSTALLER_DEFAULT="Developer ID Installer: $KOSMOS_SIGN_TEAM_NAME ($KOSMOS_SIGN_TEAM_ID)"
KOSMOS_NOTARY_KEY_ID_DEFAULT="43F2HU5BT8"
KOSMOS_NOTARY_ISSUER_DEFAULT="69a6de7f-a03e-47e3-e053-5b8c7c11a4d1"
# EDIT-ONLY (no environment override): the secrets-map target holding that key's .p8, which
# build-installer-pkg.sh reads for notarytool. A new team's key filed under a NEW target must be
# named here, or the new key id pairs with the old .p8.
KOSMOS_NOTARY_SECRET_TARGET="kosmos-notarize"
