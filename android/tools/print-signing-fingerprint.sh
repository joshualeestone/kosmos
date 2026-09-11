#!/usr/bin/env bash
# Print the SHA-256 signing fingerprint that must go into the hosted
# assetlinks.json for TWA verification. Digital Asset Links matches the app's
# signing certificate against the fingerprint published at
# https://<host>/.well-known/assetlinks.json, so these two must agree exactly.
#
# Usage:
#   tools/print-signing-fingerprint.sh [keystore] [alias] [storepass]
#   KEYSTORE_PASS=... tools/print-signing-fingerprint.sh [keystore] [alias]
#
# With no arguments it reads the Android debug keystore, which is what
# `./gradlew assembleDebug` signs with. For a release build, pass the release
# keystore and alias, and its password as the third argument or via the
# KEYSTORE_PASS environment variable. If the app is distributed through Play App Signing, the
# fingerprint that matters is the one Play shows under
# "App integrity > App signing key certificate", NOT the local upload key.
set -euo pipefail

KEYSTORE="${1:-$HOME/.android/debug.keystore}"
ALIAS="${2:-androiddebugkey}"
# The debug keystore uses the fixed password "android". A real release keystore
# has its own password, so allow it to be supplied: as $3, or via KEYSTORE_PASS
# in the environment (preferred, so the password does not land in shell history
# or the process table of a shared box). Defaults to the debug password.
STOREPASS="${3:-${KEYSTORE_PASS:-android}}"

if [ ! -f "$KEYSTORE" ]; then
  echo "keystore not found: $KEYSTORE" >&2
  echo "(the debug keystore is created on the first Gradle build)" >&2
  exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool not on PATH; ensure a JDK is installed (JAVA_HOME set)" >&2
  exit 1
fi

keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$STOREPASS" \
  | grep -i 'SHA256:' \
  | sed 's/.*SHA256: *//'
