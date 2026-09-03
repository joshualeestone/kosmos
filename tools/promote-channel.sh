#!/usr/bin/env bash
# promote-channel.sh - kosmos#2036, the staging->prod PROMOTE side.
#
# Promote the staging pointer to prod: point `dist/latest.json` at exactly the bytes
# `dist/latest-staging.json` already names, after verifying (a) those bytes are present
# and their served sha matches the pointer, and (b) the #2036/#2063 experience gate says a
# fresh session can USE the board on that build. It is a POINTER copy - it never rebuilds,
# so prod gets the exact artifact staging verified. That same-bytes property is the whole
# reason the channel lives in the pointer and not in the artifact (Kitty, 2026-09-03).
#
# 🛑 IT DOES NOT DEPLOY. It rewrites `latest.json` in the SITE CHECKOUT's dist/; the next
# site deploy publishes it. Same boundary as publish-staging-pointer.sh / #2008.
#
# The experience gate (tools/staging-experience-check.sh, #2063) can only PASS where a
# fresh enforcing board exists. On the dev box it returns cannot-tell (2) by construction
# (the board runs from source and never enforces), so promote HOLDS there - correctly: you
# cannot promote from a machine that cannot test the update. Run this on/against the fresh
# staging machine, or use --force after a HAND verification (which never overrides a
# provably-broken board - exit 1 is always a refusal).
#
# Usage:
#   tools/promote-channel.sh <site-checkout> [--force]
# Overrides (mainly for the test):
#   KOSMOS_PROMOTE_GATE_CMD   the experience gate to run (default: bash <repo>/tools/staging-experience-check.sh)
set -uo pipefail

SITE=""; FORCE=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    -*) echo "promote-channel: unknown option $a" >&2; exit 1 ;;
    *) [ -z "$SITE" ] && SITE="$a" || { echo "promote-channel: unexpected extra argument $a" >&2; exit 1; } ;;
  esac
done
SITE="${SITE:-${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}}"
[ -d "$SITE/dist" ] || { echo "promote-channel: no $SITE/dist" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "promote-channel: node is required" >&2; exit 1; }

STAGING="$SITE/dist/latest-staging.json"
[ -f "$STAGING" ] || { echo "promote-channel: no $STAGING - publish a staging pointer first (publish-staging-pointer.sh)" >&2; exit 1; }

# Read the staging pointer's fields via node (exact JSON, never a sed heuristic).
read_field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$STAGING" "$1" 2>/dev/null || true; }
V="$(read_field version)"; SHA="$(read_field sha256)"; ARTIFACT="$(read_field artifact)"
[ -n "$V" ] && [ -n "$SHA" ] && [ -n "$ARTIFACT" ] || { echo "promote-channel: $STAGING is missing version/sha256/artifact - not a usable pointer" >&2; exit 1; }

# THE SAME-BYTES INVARIANT, checked before the gate and before any promote: the artifact
# the staging pointer names must EXIST and its served sha must verify in place AND equal the
# pointer's sha. This is the refusal that makes promote safe - it can only ever point prod at
# bytes that are present and match what staging advertised. Not overridable by --force.
[ -f "$SITE/dist/$ARTIFACT" ] || { echo "promote-channel: staging names $ARTIFACT, which is not in $SITE/dist - refusing to promote a missing artifact" >&2; exit 1; }
[ -f "$SITE/dist/$ARTIFACT.sha256" ] || { echo "promote-channel: $ARTIFACT.sha256 sidecar is missing - cannot verify the bytes" >&2; exit 1; }
( cd "$SITE/dist" && shasum -a 256 --status -c "$ARTIFACT.sha256" ) \
  || { echo "promote-channel: $ARTIFACT does not verify against its sidecar - refusing to promote unverified bytes" >&2; exit 1; }
DISK_SHA="$(awk '{print $1}' "$SITE/dist/$ARTIFACT.sha256")"
[ "$DISK_SHA" = "$SHA" ] || { echo "promote-channel: staging pointer sha ($SHA) != the served artifact sha ($DISK_SHA) - refusing (the pointer does not describe the bytes on disk)" >&2; exit 1; }
# The pointer promote is about to copy to latest.json also advertises the manifest; do not
# promote a prod pointer to a manifest that has gone missing since publish.
MANIFEST="$(read_field manifest)"
[ -n "$MANIFEST" ] && [ -f "$SITE/dist/$MANIFEST" ] || { echo "promote-channel: the staging pointer advertises manifest '${MANIFEST:-<none>}', which is not in $SITE/dist - refusing to promote a pointer to a missing manifest" >&2; exit 1; }

# THE EXPERIENCE GATE (#2063). 0 = a fresh session can use the board -> promote; 1 = the
# board is provably broken for a fresh session (#2023) -> refuse, never forceable; 2 =
# cannot-tell here (no enforcing fresh board) -> HOLD, forceable only after a HAND check.
GATE_CMD="${KOSMOS_PROMOTE_GATE_CMD:-bash $(cd "$(dirname "$0")/.." && pwd)/tools/staging-experience-check.sh}"
echo "promote-channel: running the experience gate: $GATE_CMD"
$GATE_CMD; GATE_RC=$?
case "$GATE_RC" in
  0) echo "promote-channel: gate PASSED - a fresh session can use $V." ;;
  1) echo "promote-channel: gate FAILED (exit 1) - the board is broken for a fresh session (the #2023 class). REFUSING to promote; --force does not override a provably-broken board." >&2; exit 1 ;;
  2)
    if [ "$FORCE" = 1 ]; then
      echo "promote-channel: gate could not run here (exit 2, cannot-tell) and --force was given - promoting on the strength of a HAND verification. NOTE: the experience was NOT automatically verified." >&2
    else
      echo "promote-channel: gate could not run here (exit 2, cannot-tell) - no fresh enforcing board on this machine. HOLDING. Run this on/against the fresh staging machine, or pass --force after verifying by hand." >&2
      exit 2
    fi ;;
  *) echo "promote-channel: gate returned an unexpected code ($GATE_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
esac

# Promote: copy the staging pointer to prod. A pointer copy - the artifact bytes are already
# served and unchanged; only which pointer prod fetches changes. Written ATOMICALLY (temp in
# the same dir + rename): latest.json is the prod pointer every install fetches, so an
# interrupted write must never leave it truncated. rename(2) within one directory is atomic.
PTMP="$(mktemp "$SITE/dist/.latest.json.XXXXXX")" || { echo "promote-channel: could not make a temp file in $SITE/dist" >&2; exit 1; }
trap 'rm -f "$PTMP"' EXIT   # a signal between mktemp and the rename must not leak the temp
cp "$STAGING" "$PTMP" && mv "$PTMP" "$SITE/dist/latest.json" \
  || { echo "promote-channel: could not write latest.json" >&2; rm -f "$PTMP"; exit 1; }
# Prove the promote landed: latest.json now names the same artifact + sha as staging.
PROD_ART="$(node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).artifact||""))}catch{}' "$SITE/dist/latest.json" 2>/dev/null || true)"
PROD_SHA="$(node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sha256||""))}catch{}' "$SITE/dist/latest.json" 2>/dev/null || true)"
[ "$PROD_ART" = "$ARTIFACT" ] && [ "$PROD_SHA" = "$SHA" ] || { echo "promote-channel: promote did not land - latest.json does not match staging after the copy" >&2; exit 1; }

echo "promote-channel: PROMOTED $V to prod - latest.json now points at the exact bytes staging verified ($ARTIFACT)."
echo "   -> $(cat "$SITE/dist/latest.json")"
echo "promote-channel: the next site deploy publishes the prod pointer. No rebuild happened."
