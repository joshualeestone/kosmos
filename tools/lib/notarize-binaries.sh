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
# What the build checks before it accepts the submission: the status value read from
# its own JSON key is Accepted, and every architecture slice of every binary has its
# cdhash (codesign -dvvv --arch, one per slice that lipo -archs lists) inside the
# ticketContents of Apple's log for that submission. "Accepted" alone would pass for
# a zip that held other bytes.
#
# A submission that comes back with no submission id (the upload or Apple's service
# failed before a job existed) is tried again after each delay in
# KOSMOS_NOTARY_RETRY_DELAYS (seconds, default "30 120": three tries). A submission
# with an id is never resubmitted: Apple answered, and its answer stands.
#
# Usage: notarize_binaries <binary>...   returns non-zero on any failure, after
# printing why. Sourced by build-kosmos-bundle.sh under set -euo pipefail; call it
# as `notarize_binaries ... || exit 1`.
#
# KOSMOS_NOTARIZE=0 skips it, LOUDLY, for a local test build that has no notary
# key. release.sh refuses to cut while it, any seam below, or KOSMOS_NOTARY_RETRY_DELAYS is set.
#
# Seams (tests only): KOSMOS_NOTARYTOOL_CMD replaces `xcrun notarytool`,
# KOSMOS_NOTARY_CODESIGN_CMD replaces codesign, KOSMOS_NOTARY_LIPO_CMD replaces lipo,
# and KOSMOS_SECRETS_MAP_BIN replaces secrets-map.sh, as in cut-sign-preflight.sh.

. "$(dirname "${BASH_SOURCE[0]}")/signing-identity.sh"

# Prints the cdhash (40 hex) of one architecture slice, or nothing.
_notarize_cdhash() {
  local cs="${KOSMOS_NOTARY_CODESIGN_CMD:-codesign}"
  "$cs" -dvvv --arch "$2" "$1" 2>&1 | sed -n 's/^CDHash=\([0-9a-f]\{40\}\)$/\1/p' | head -1
}

# Prints the architectures in a Mach-O file, space-separated, or nothing.
_notarize_archs() {
  local lp="${KOSMOS_NOTARY_LIPO_CMD:-lipo}"
  "$lp" -archs "$1" 2>/dev/null
}

# Runs notarytool with the given arguments. A function so the seam can be a shell function.
_notarytool() {
  if [ -n "${KOSMOS_NOTARYTOOL_CMD:-}" ]; then "$KOSMOS_NOTARYTOOL_CMD" "$@"; else xcrun notarytool "$@"; fi
}

# Prints the value of the FIRST "<key>": "<value>" pair in notarytool's JSON, or nothing.
# The first, not the last: a greedy `.*"id"` would take a later nested id.
_notarize_json_first() {
  { printf '%s' "$2" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'; } || :
}

# Prints the notary key's path, or explains on stderr and returns 1.
_notarize_key() {
  local sm="${KOSMOS_SECRETS_MAP_BIN:-$HOME/.claude/scripts/secrets-map.sh}" key
  key="$("$sm" path "$KOSMOS_NOTARY_SECRET_TARGET" 2>/dev/null)" || key=""
  if [ -z "$key" ] || [ ! -f "$key" ] || [ ! -r "$key" ]; then
    echo "notarize: the notary key \"$KOSMOS_NOTARY_SECRET_TARGET\" does not resolve to a readable file through $sm. File it with /add-secret, cut on the Mac that holds it, or set KOSMOS_NOTARIZE=0 for a local test build." >&2
    return 1
  fi
  printf '%s\n' "$key"
}

# The cut's step 1c probe: one authenticated request to Apple's notary service with the key
# step 4 will use, so a revoked or mistyped key, or an outage, stops the cut BEFORE the version
# bump is pushed rather than at step 4, after it. It reads Apple's answer, not notarytool's exit
# status: an answer carrying the "history" key is the only pass.
# KOSMOS_NOTARY_PROBE_BIN (tests only, like the preflight's KOSMOS_CODESIGN_BIN) replaces this
# one probe and nothing else: step 4 never reads it. It is run with no arguments, its exit status
# decides, and the line it prints says nothing was probed.
notarize_probe_credentials() (
  if [ -n "${KOSMOS_NOTARY_PROBE_BIN:-}" ]; then
    "$KOSMOS_NOTARY_PROBE_BIN" >/dev/null 2>&1 || { echo "notary preflight: KOSMOS_NOTARY_PROBE_BIN=$KOSMOS_NOTARY_PROBE_BIN failed"; exit 1; }
    echo "notary preflight: PASSED THROUGH KOSMOS_NOTARY_PROBE_BIN=$KOSMOS_NOTARY_PROBE_BIN, NOT notarytool: the key was not probed. Unset it for a real cut."
    exit 0
  fi
  key_id="${KOSMOS_NOTARY_KEY_ID:-$KOSMOS_NOTARY_KEY_ID_DEFAULT}"
  issuer="${KOSMOS_NOTARY_ISSUER:-$KOSMOS_NOTARY_ISSUER_DEFAULT}"
  key="$(_notarize_key)" || exit 1
  rc=0
  out="$(_notarytool history --key "$key" --key-id "$key_id" --issuer "$issuer" --output-format json 2>&1)" || rc=$?
  case "$out" in
    *'"history"'*) echo "notary preflight: Apple answered an authenticated request with the notary key ($KOSMOS_NOTARY_SECRET_TARGET, key id $key_id)"; exit 0 ;;
  esac
  echo "notary preflight: Apple's notary service did not answer an authenticated request with the notary key (notarytool rc=$rc). Step 4 notarises the app binaries with it (#5137), after the version bump is pushed. What it said:"
  printf '%s\n' "$out" | sed 's/^/    /'
  exit 1
)

# A subshell body, so the EXIT trap removes the scratch copies on every path, an
# interrupted --wait included.
notarize_binaries() (
  if [ "$#" = 0 ]; then echo "notarize_binaries: no binaries named" >&2; exit 1; fi
  if [ "${KOSMOS_NOTARIZE:-1}" = 0 ]; then
    echo "==> NOT NOTARISED (KOSMOS_NOTARIZE=0): $*. A test build only; Gatekeeper rejects these if anything quarantines them (#5137)."
    exit 0
  fi
  key_id="${KOSMOS_NOTARY_KEY_ID:-$KOSMOS_NOTARY_KEY_ID_DEFAULT}"
  issuer="${KOSMOS_NOTARY_ISSUER:-$KOSMOS_NOTARY_ISSUER_DEFAULT}"
  dir=""
  trap 'rm -rf "${dir:-}"' EXIT
  trap 'exit 130' INT TERM

  key="$(_notarize_key)" || exit 1

  # Every slice's cdhash, read BEFORE submitting: an unsigned binary cannot be notarised, and
  # finding that out after a several-minute wait is waste. One "name arch cdhash" line each.
  want=""
  for b in "$@"; do
    [ -f "$b" ] || { echo "notarize: no such binary: $b" >&2; exit 1; }
    archs="$(_notarize_archs "$b")"
    [ -n "$archs" ] || { echo "notarize: could not read the architectures of $b (is it a Mach-O file?)" >&2; exit 1; }
    for a in $archs; do
      h="$(_notarize_cdhash "$b" "$a")"
      [ -n "$h" ] || { echo "notarize: could not read a cdhash from the $a slice of $b (is it signed?)" >&2; exit 1; }
      want="$want${b##*/} $a $h
"
    done
  done

  dir="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-notarize.XXXXXX")" || { echo "notarize: could not make a scratch directory" >&2; exit 1; }
  mkdir "$dir/bin" || { echo "notarize: could not make $dir/bin" >&2; exit 1; }
  for b in "$@"; do cp -p "$b" "$dir/bin/" || { echo "notarize: could not copy $b" >&2; exit 1; }; done
  ditto -c -k --keepParent "$dir/bin" "$dir/binaries.zip" || { echo "notarize: could not zip the binaries" >&2; exit 1; }

  read -r -a delays <<< "${KOSMOS_NOTARY_RETRY_DELAYS-30 120}"
  tries=$(( ${#delays[@]} + 1 )); try=1
  while :; do
    echo "==> notarytool submit --wait (try $try of $tries): $*"
    rc=0
    out="$(_notarytool submit "$dir/binaries.zip" --key "$key" --key-id "$key_id" --issuer "$issuer" \
             --wait --timeout 30m --output-format json 2>&1)" || rc=$?
    printf '%s\n' "$out" | sed 's/^/    /'
    id="$(_notarize_json_first id "$out")"
    [ -z "$id" ] && [ "$try" -lt "$tries" ] || break
    d="${delays[$((try - 1))]:-0}"
    echo "==> notarytool returned no submission id (rc=$rc); trying again in ${d}s (#5137)" >&2
    sleep "$d" || :
    try=$((try + 1))
  done
  # The status VALUE, read from its own key: a glob for "Accepted" anywhere would pass an answer
  # whose message merely mentions the word.
  status="$(_notarize_json_first status "$out")"
  if [ "$status" != Accepted ]; then
    echo "notarize: Apple did not accept the binaries (status '${status:-none}', notarytool rc=$rc)." >&2
    if [ -n "$id" ]; then
      echo "notarize: Apple's log for $id:" >&2
      _notarytool log "$id" --key "$key" --key-id "$key_id" --issuer "$issuer" 2>&1 | sed 's/^/    /' >&2 || :
    fi
    exit 1
  fi
  [ -n "$id" ] || { echo "notarize: Accepted, but no submission id in notarytool's answer, so the ticket cannot be checked" >&2; exit 1; }

  log="$(_notarytool log "$id" --key "$key" --key-id "$key_id" --issuer "$issuer" 2>&1)" || {
    printf '%s\n' "$log" | sed 's/^/    /' >&2; echo "notarize: could not fetch Apple's log for $id" >&2; exit 1; }
  # Only the ticketContents array counts: a hash named in issues[] is not a ticket.
  ticket="$(printf '%s' "$log" | tr -d '\n' | sed -n 's/.*"ticketContents"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p')"

  missing=""
  while read -r name a h; do
    [ -n "$name" ] || continue
    case "$ticket" in
      *"\"$h\""*) echo "==> notarised: $name $a (cdhash $h, submission $id)" ;;
      *) missing="$missing $name/$a($h)" ;;
    esac
  done <<EOF
$want
EOF
  if [ -n "$missing" ]; then
    echo "notarize: Apple's ticket for $id does not list these cdhashes:$missing. The ticket covers other bytes." >&2
    exit 1
  fi
  exit 0
)
