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
# cutting keychain and its App Store Connect API key for notarytool. This file is also a hashed input
# of the installer .pkg (lib/pkg-inputs.sh), so changing the team makes the next cut rebuild and
# re-sign the pkg rather than keep serving one signed by the old team.
#
# Each value stays overridable by its existing environment variable at the call site
# (KOSMOS_CODESIGN_ID, KOSMOS_INSTALLER_CERT, KOSMOS_NOTARY_KEY_ID, KOSMOS_NOTARY_ISSUER).
KOSMOS_SIGN_TEAM_NAME="Stone Syndicate LLC"
KOSMOS_SIGN_TEAM_ID="864QZ69GF2"
KOSMOS_SIGN_APP_DEFAULT="Developer ID Application: $KOSMOS_SIGN_TEAM_NAME ($KOSMOS_SIGN_TEAM_ID)"
KOSMOS_SIGN_INSTALLER_DEFAULT="Developer ID Installer: $KOSMOS_SIGN_TEAM_NAME ($KOSMOS_SIGN_TEAM_ID)"
KOSMOS_NOTARY_KEY_ID_DEFAULT="43F2HU5BT8"
KOSMOS_NOTARY_ISSUER_DEFAULT="69a6de7f-a03e-47e3-e053-5b8c7c11a4d1"
