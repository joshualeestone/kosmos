#!/usr/bin/env bash
# #3579: prove the cut can SIGN before it spends ~22 minutes on the gated steps.
#
# Step 4 Developer ID signs the connector and the native app. On a box where the
# identity is present but the login keychain is LOCKED (every plain SSH session on
# Mortals), codesign cannot reach the private key and fails with
# errSecInternalComponent -- after the suite and the page layer have already run,
# and release.sh cannot resume, so the fix is a full re-run. Measured 2026-09-24
# cutting 0.6.91: persistent, not a flake, until the keychain was unlocked.
#
# So sign a throwaway copy of a system binary with the SAME identity step 4 uses,
# here, in about a second. --timestamp=none keeps it off the network: the question
# is only "can this session use the key", which a timestamp does not change.
# Step 3c's productsign (Developer ID Installer) reads the same login keychain, so a
# lock this probe finds would have killed that too.
#
# Sourced by release.sh under `set -euo pipefail`; errexit-safe, no pipes, bash 3.2.
#
# Seams (tests only): KOSMOS_CODESIGN_BIN replaces codesign.

# The identity step 4 signs with. tools/test-cut-sign-preflight.sh asserts this
# default equals the one in tools/build-kosmos-bundle.sh, so the two cannot drift.
KOSMOS_SIGN_PREFLIGHT_DEFAULT_ID="Developer ID Application: Stone Syndicate LLC (864QZ69GF2)"

kosmos_sign_preflight() {
  local id="${KOSMOS_CODESIGN_ID:-$KOSMOS_SIGN_PREFLIGHT_DEFAULT_ID}"
  local cs="${KOSMOS_CODESIGN_BIN:-codesign}"
  local dir out rc kc="$HOME/Library/Keychains/login.keychain-db"

  if ! command -v "$cs" >/dev/null 2>&1; then
    echo "signing preflight: no codesign on this machine, and step 4 signs every binary Developer ID. Cut on the Mac that holds \"$id\"."
    return 1
  fi
  dir="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-sign-preflight.XXXXXX")" || {
    echo "signing preflight: could not make a scratch directory to test-sign in"; return 1; }
  if ! cp /usr/bin/true "$dir/probe"; then
    rm -rf "$dir"; echo "signing preflight: could not copy a probe binary into $dir"; return 1
  fi

  rc=0
  out="$("$cs" --force --timestamp=none -s "$id" "$dir/probe" 2>&1)" || rc=$?
  rm -rf "$dir"

  if [ "$rc" = 0 ]; then
    echo "signing preflight: test-signed with \"$id\" (the key is reachable from this session)"
    return 0
  fi

  # Print codesign's own words first, whatever the cause, so nothing is inferred.
  echo "signing preflight: a test codesign with \"$id\" FAILED (rc=$rc):"
  printf '%s\n' "$out" | sed 's/^/    /'
  case "$out" in
    *errSecInternalComponent*|*"User interaction is not allowed"*)
      echo "The identity is here but the login keychain is LOCKED, which is normal in an SSH session."
      echo "Step 4 would fail the same way AFTER the suite and the page layer. Unlock it, then re-run the cut:"
      echo "    security unlock-keychain \"$kc\"          # prompts for the login password"
      echo "    security set-keychain-settings \"$kc\"    # no auto-lock while the cut runs"
      ;;
    *"no identity found"*|*"could not be found"*|*"ambiguous"*)
      echo "No usable identity named \"$id\" in this session's keychains. Cut on the Mac holding the cert, or set KOSMOS_CODESIGN_ID."
      ;;
    *)
      echo "Not a cause this preflight recognises. Step 4 signs with the same identity, so it would fail too."
      ;;
  esac
  return 1
}
