#!/usr/bin/env bash
# Notarise the bare Mach-O binaries the bundle ships (#5137).
#
# kosmos-app and kosmos-tunnel are Developer ID signed with hardened runtime by
# build-kosmos-bundle.sh, but until #5137 they were never NOTARISED, so
# `spctl -a -t exec` rejected both as "Unnotarized Developer ID" (measured on the
# served 0.7.19 and 0.7.38 tarballs). Nothing warns today only because nothing on
# the install path quarantines them; the moment something does (the app copied
# to another Mac by AirDrop, a zip or a browser), Gatekeeper refuses them.
#
# A bare binary cannot be stapled, so the ticket lives only on Apple's servers
# and Gatekeeper fetches it online. Notarising does not change the binary's bytes,
# so every checksum the build took after signing is still what ships.
#
# What this proves, and how: Apple's notary log lists the cdhash of every binary
# it ticketed. Each binary's OWN cdhash (codesign -dvvv, read here) must be in
# that list, or the build fails. That is the check that the ticket covers these
# bytes and not some other build's; "status: Accepted" alone would pass for a zip
# that held the wrong files.
#
# Usage: notarize_binaries <binary>...   returns non-zero on any failure, after
# printing why. Sourced by build-kosmos-bundle.sh under set -euo pipefail; call it
# as `notarize_binaries ... || exit 1`.
#
# KOSMOS_NOTARIZE=0 skips it, LOUDLY, for a local test build that has no notary
# key. Never set it on a cut: the release would ship binaries Gatekeeper rejects.
#
# Seams (tests only): KOSMOS_NOTARYTOOL_CMD replaces `xcrun notarytool`,
# KOSMOS_NOTARY_CODESIGN_CMD replaces codesign (for reading cdhashes), and
# KOSMOS_SECRETS_MAP_BIN replaces secrets-map.sh, as in cut-sign-preflight.sh.

. "$(dirname "${BASH_SOURCE[0]}")/signing-identity.sh"

# Prints the binary's cdhash (40 hex), or nothing.
_notarize_cdhash() {
  local cs="${KOSMOS_NOTARY_CODESIGN_CMD:-codesign}"
  "$cs" -dvvv "$1" 2>&1 | sed -n 's/^CDHash=\([0-9a-f]\{40\}\)$/\1/p' | head -1
}

# Runs notarytool with the given arguments. A function so the seam can be a shell function.
_notarytool() {
  if [ -n "${KOSMOS_NOTARYTOOL_CMD:-}" ]; then "$KOSMOS_NOTARYTOOL_CMD" "$@"; else xcrun notarytool "$@"; fi
}

notarize_binaries() {
  if [ "$#" = 0 ]; then echo "notarize_binaries: no binaries named" >&2; return 1; fi
  if [ "${KOSMOS_NOTARIZE:-1}" = 0 ]; then
    echo "==> NOT NOTARISED (KOSMOS_NOTARIZE=0): $*. A test build only; Gatekeeper rejects these if anything quarantines them (#5137)."
    return 0
  fi
  local sm="${KOSMOS_SECRETS_MAP_BIN:-$HOME/.claude/scripts/secrets-map.sh}"
  local key_id="${KOSMOS_NOTARY_KEY_ID:-$KOSMOS_NOTARY_KEY_ID_DEFAULT}"
  local issuer="${KOSMOS_NOTARY_ISSUER:-$KOSMOS_NOTARY_ISSUER_DEFAULT}"
  local key dir b h id out log status rc=0 missing=""
  local -a hashes=()

  key="$("$sm" path "$KOSMOS_NOTARY_SECRET_TARGET" 2>/dev/null)" || key=""
  if [ -z "$key" ] || [ ! -r "$key" ]; then
    echo "notarize: the notary key \"$KOSMOS_NOTARY_SECRET_TARGET\" does not resolve to a readable file through $sm. File it with /add-secret, cut on the Mac that holds it, or set KOSMOS_NOTARIZE=0 for a local test build." >&2
    return 1
  fi

  # Read every cdhash BEFORE submitting: a binary that is not signed cannot be notarised, and
  # finding that out after a several-minute wait is waste.
  for b in "$@"; do
    [ -f "$b" ] || { echo "notarize: no such binary: $b" >&2; return 1; }
    h="$(_notarize_cdhash "$b")"
    [ -n "$h" ] || { echo "notarize: could not read a cdhash from $b (is it signed?)" >&2; return 1; }
    hashes+=("$h")
  done

  dir="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-notarize.XXXXXX")" || { echo "notarize: could not make a scratch directory" >&2; return 1; }
  mkdir "$dir/bin"
  for b in "$@"; do cp -p "$b" "$dir/bin/" || { rm -rf "$dir"; echo "notarize: could not copy $b" >&2; return 1; }; done
  ditto -c -k --keepParent "$dir/bin" "$dir/binaries.zip" || { rm -rf "$dir"; echo "notarize: could not zip the binaries" >&2; return 1; }

  echo "==> notarytool submit --wait: $*"
  out="$(_notarytool submit "$dir/binaries.zip" --key "$key" --key-id "$key_id" --issuer "$issuer" \
           --wait --timeout 30m --output-format json 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/    /'
  id="$(printf '%s' "$out" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  # The status VALUE, read from its own key: a glob for "Accepted" anywhere would pass an answer
  # whose message merely mentions the word.
  status="$(printf '%s' "$out" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  case "$status" in
    Accepted) ;;
    *)
      echo "notarize: Apple did not accept the binaries (status '${status:-none}', notarytool rc=$rc)." >&2
      if [ -n "$id" ]; then
        echo "notarize: Apple's log for $id:" >&2
        _notarytool log "$id" --key "$key" --key-id "$key_id" --issuer "$issuer" 2>&1 | sed 's/^/    /' >&2 || :
      fi
      rm -rf "$dir"; return 1 ;;
  esac
  [ -n "$id" ] || { rm -rf "$dir"; echo "notarize: Accepted, but no submission id in notarytool's answer, so the ticket cannot be checked" >&2; return 1; }

  log="$(_notarytool log "$id" --key "$key" --key-id "$key_id" --issuer "$issuer" 2>&1)" || {
    printf '%s\n' "$log" | sed 's/^/    /' >&2; rm -rf "$dir"; echo "notarize: could not fetch Apple's log for $id" >&2; return 1; }
  rm -rf "$dir"

  # Every binary's own cdhash must be one Apple ticketed.
  local i=0
  for b in "$@"; do
    case "$log" in
      *"\"${hashes[$i]}\""*) echo "==> notarised: ${b##*/} (cdhash ${hashes[$i]}, submission $id)" ;;
      *) missing="$missing ${b##*/}(${hashes[$i]})" ;;
    esac
    i=$((i + 1))
  done
  if [ -n "$missing" ]; then
    echo "notarize: Apple's ticket for $id does not list these binaries' cdhashes:$missing. The ticket covers other bytes." >&2
    return 1
  fi
  return 0
}
