#!/usr/bin/env bash
# Print the SHA-256 signing fingerprint that must go into the hosted
# assetlinks.json for TWA verification. Digital Asset Links matches the app's
# signing certificate against the fingerprint published at
# https://<host>/.well-known/assetlinks.json, so these two must agree exactly.
#
# Usage:
#   tools/print-signing-fingerprint.sh [keystore] [alias]
#   KEYSTORE_PASS=... tools/print-signing-fingerprint.sh [keystore] [alias]   # release
#
# With no arguments it reads the Android debug keystore, which is what
# `./gradlew assembleDebug` signs with (its password is the universally-known
# "android", not a secret). For a release keystore, supply the password via the
# KEYSTORE_PASS environment variable.
#
# SECURITY: a real release password must never reach a command line. Command-line
# arguments are world-readable in `ps -ww -o args` for the life of the process, so
# any local process (including other agents on a shared box) could read it while
# keytool runs -- the same side channel kosmos's own bin already guards against.
# This script therefore passes the password to keytool via `-storepass:env`, which
# reads it from an environment variable rather than argv. Prefer KEYSTORE_PASS; the
# script never puts the password on keytool's command line. (Passing the password
# as a $3 positional was removed for this reason -- it would sit in THIS script's
# own argv, visible in `ps`.)
#
# If the app is distributed through Play App Signing, the fingerprint that matters
# is the one Play shows under "App integrity > App signing key certificate", NOT
# the local upload key.
set -euo pipefail

KEYSTORE="${1:-$HOME/.android/debug.keystore}"
ALIAS="${2:-androiddebugkey}"
# The password is funneled through the environment so it never appears in argv.
# Defaults to the known debug password when KEYSTORE_PASS is unset.
export KEYSTORE_PASS="${KEYSTORE_PASS:-android}"

if [ ! -f "$KEYSTORE" ]; then
  echo "keystore not found: $KEYSTORE" >&2
  echo "(the debug keystore is created on the first Gradle build)" >&2
  exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool not on PATH; ensure a JDK is installed (JAVA_HOME set)" >&2
  exit 1
fi

# -storepass:env reads the password from the named env var, keeping it out of the
# process table. Verified supported by this JDK's keytool.
keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env KEYSTORE_PASS \
  | grep -i 'SHA256:' \
  | sed 's/.*SHA256: *//'
