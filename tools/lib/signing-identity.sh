#!/bin/bash
# Who signs Kosmos for macOS, in ONE place (#3643).
#
# Every tool that signs, notarises or checks a signature reads these defaults from here: the app
# bundle's codesign (build-kosmos-bundle.sh), the installer .pkg (build-installer-pkg.sh), the cut's
# signing preflight (lib/cut-sign-preflight.sh) and the served-pkg signature check (verify-served.sh).
# Before this file there were four hard-coded copies of one team, which is how a partial switch would
# ship an app signed by one team with a checker expecting another.
#
# Switching teams (#3643, Kosmos Agent Manager, Inc.) is an edit HERE plus the new team's certs in the
# cutting keychain and its App Store Connect API key (.p8) filed in the secrets map under the target
# named below. This file is also a hashed input
# of the installer .pkg (lib/pkg-inputs.sh), so changing the team makes the next cut rebuild and
# re-sign the pkg rather than keep serving one signed by the old team.
#
# ⚠️ ANY edit here, even a comment, changes the pkg's input sha and makes the next cut rebuild, sign and
# notarise the installer (minutes, and it needs the Installer identity and the notary key on the cut box).
#
# What a team switch changes for people who already have Kosmos: macOS privacy grants are keyed to the
# signer, so Files and Folders, Automation (Terminal) and Accessibility for the bundled tmux may each
# ask once more. Say so in that release's notes. Updates themselves are unaffected (the updater does not
# check the signing team). The installer's bundle identifier (com.stonesyndicate.kosmos.installer, in
# build-installer-pkg.sh) is NOT a signing value and is deliberately left alone: changing it changes
# installer receipts.
#
# Each value stays overridable by its existing environment variable at the call site
# (KOSMOS_CODESIGN_ID, KOSMOS_INSTALLER_CERT, KOSMOS_NOTARY_KEY_ID, KOSMOS_NOTARY_ISSUER).
KOSMOS_SIGN_TEAM_NAME="Stone Syndicate LLC"
KOSMOS_SIGN_TEAM_ID="864QZ69GF2"
KOSMOS_SIGN_APP_DEFAULT="Developer ID Application: $KOSMOS_SIGN_TEAM_NAME ($KOSMOS_SIGN_TEAM_ID)"
KOSMOS_SIGN_INSTALLER_DEFAULT="Developer ID Installer: $KOSMOS_SIGN_TEAM_NAME ($KOSMOS_SIGN_TEAM_ID)"
KOSMOS_NOTARY_KEY_ID_DEFAULT="43F2HU5BT8"
KOSMOS_NOTARY_ISSUER_DEFAULT="69a6de7f-a03e-47e3-e053-5b8c7c11a4d1"
# The secrets-map target holding that key's .p8 (build-installer-pkg.sh reads it for notarytool). A
# new team's key filed under a NEW target must be named here, or the new key id pairs with the old .p8.
KOSMOS_NOTARY_SECRET_TARGET="kosmos-notarize"
