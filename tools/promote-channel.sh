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
#   tools/promote-channel.sh <site-checkout> [port] [--force]
#     [port]  the port the experience gate should probe (the fresh staging board's port,
#             which is per-account and usually NOT 16180). Also settable via KOSMOS_PORT.
#             Give the port so a wrong-port HOLD does not push you toward --force, which
#             bypasses the gate entirely.
# Overrides (mainly for the test):
#   KOSMOS_PROMOTE_GATE_CMD   the experience gate to run (default: bash <repo>/tools/staging-experience-check.sh)
set -uo pipefail

SITE=""; FORCE=0; PORT=""
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    -*) echo "promote-channel: unknown option $a" >&2; exit 1 ;;
    *)
      if [ -z "$SITE" ]; then SITE="$a"
      elif [ -z "$PORT" ]; then
        case "$a" in *[!0-9]*) echo "promote-channel: expected a numeric [port], got '$a'" >&2; exit 1 ;; esac
        PORT="$a"
      else echo "promote-channel: unexpected extra argument $a" >&2; exit 1
      fi ;;
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

# Defense in depth on a prod path: artifact/manifest names come from the staging pointer and
# are used directly as filesystem paths below, so reject any value that is not a bare filename
# (a pointer should only ever name a file in dist/, never a path). Out of the accidental-
# corruption threat model -- anyone who can write the pointer can write latest.json -- but cheap.
reject_pathy() { case "$2" in *"/"*|*".."*) echo "promote-channel: the staging pointer's $1 ('$2') is not a bare filename - refusing" >&2; exit 1 ;; esac; }
reject_pathy artifact "$ARTIFACT"
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
reject_pathy manifest "$MANIFEST"
[ -n "$MANIFEST" ] && [ -f "$SITE/dist/$MANIFEST" ] || { echo "promote-channel: the staging pointer advertises manifest '${MANIFEST:-<none>}', which is not in $SITE/dist - refusing to promote a pointer to a missing manifest" >&2; exit 1; }

# THE EXPERIENCE GATE (#2063). 0 = a fresh session can use the board -> promote; 1 = the
# board is provably broken for a fresh session (#2023) -> refuse, never forceable; 2 =
# cannot-tell here (no enforcing fresh board) -> HOLD, forceable only after a HAND check.
GATE_CMD="${KOSMOS_PROMOTE_GATE_CMD:-bash $(cd "$(dirname "$0")/.." && pwd)/tools/staging-experience-check.sh}"
# Forward [port] to the gate as its arg1 (the gate reads arg1 -> KOSMOS_PORT -> 16180). Giving
# the fresh staging board's real port here is what keeps a wrong-port HOLD from pushing an
# operator toward --force. When no port is given the gate falls back to KOSMOS_PORT/16180.
echo "promote-channel: running the experience gate: $GATE_CMD${PORT:+ (port $PORT)}"
$GATE_CMD ${PORT:+"$PORT"}; GATE_RC=$?
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

# THE AGENT-SPAWN GATE (#2036/#2129). The experience gate above proves a fresh BROWSER can
# reach the board (#2023); it does NOT exercise agent spawn. #2129 was exactly that gap -
# spawned agents wedged at the Claude Code trust prompt while the board served fine, so the
# experience gate alone would PASS a #2129 build. This second gate creates a Claude and an
# OpenAI agent and confirms each comes ONLINE. Same exit contract: 0 online -> promote; 1 a
# trust wedge / auth / never-online (#2129 class) -> refuse, never forceable; 2 cannot-tell
# (no enforcing board, a provider not signed in, or a populated fleet) -> HOLD, forceable
# only after a HAND check. Override the command via KOSMOS_PROMOTE_AGENT_GATE_CMD.
AGENT_GATE_CMD="${KOSMOS_PROMOTE_AGENT_GATE_CMD:-bash $(cd "$(dirname "$0")/.." && pwd)/tools/staging-agent-online-check.sh}"
echo "promote-channel: running the agent-spawn gate: $AGENT_GATE_CMD${PORT:+ (port $PORT)}"
$AGENT_GATE_CMD ${PORT:+"$PORT"}; AGENT_RC=$?
case "$AGENT_RC" in
  0) echo "promote-channel: agent-spawn gate PASSED - a fresh Claude and OpenAI agent came online (the #2129 class is not present)." ;;
  1) echo "promote-channel: agent-spawn gate FAILED (exit 1) - a fresh agent did not come online (trust wedge/auth/timeout, the #2129 class). REFUSING to promote; --force does not override a provably-broken build." >&2; exit 1 ;;
  2)
    if [ "$FORCE" = 1 ]; then
      echo "promote-channel: agent-spawn gate could not run here (exit 2, cannot-tell) and --force was given - promoting on the strength of a HAND verification. NOTE: agent spawn was NOT automatically verified." >&2
    else
      echo "promote-channel: agent-spawn gate could not run here (exit 2, cannot-tell) - no fresh enforcing board, a provider not signed in, or a populated fleet board. HOLDING. Run on/against the fresh staging machine with both providers signed in, or pass --force after verifying by hand." >&2
      exit 2
    fi ;;
  *) echo "promote-channel: agent-spawn gate returned an unexpected code ($AGENT_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
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
[ "$PROD_ART" = "$ARTIFACT" ] && [ "$PROD_SHA" = "$SHA" ] || { echo "promote-channel: latest.json was written but does not read back as the promoted pointer (unexpected - a faulty filesystem?). It now holds a copy of the verified staging pointer." >&2; exit 1; }

# #2036: refresh the unversioned prod alias (kosmos-<arch>.tar.gz) to the promoted bytes. The
# alias is the prod download fallback (old installers, and a modern install whose versioned fetch
# fails) and must track the CURRENT prod version. A staging cut deliberately leaves the alias at
# the prior prod bytes (release.sh gates its alias publish on a prod cut), so the PROMOTE is where
# the alias moves. Copy the just-verified versioned artifact onto the alias and re-derive its
# .sha256 named for the alias (verified in place by sha256_publish_as). The next deploy carries it.
_arch="${ARTIFACT#kosmos-$V-}"; _arch="${_arch%.tar.gz}"
ALIAS="kosmos-$_arch.tar.gz"
# REFUSE rather than report a successful promote with a stale or wrongly-named alias. latest.json
# is already promoted here, so a silent stale prod alias (an old installer/fallback keeps getting
# the prior version) is exactly the prod-facing surprise this card exists to prevent. The
# recomposition check catches any artifact whose name does not have the kosmos-<V>-<arch>.tar.gz
# shape (e.g. a version/name mismatch): then the strip is a no-op and the recomposed name differs.
if [ -z "$_arch" ] || [ "$ARTIFACT" != "kosmos-$V-$_arch.tar.gz" ]; then
  echo "promote-channel: cannot derive the prod alias from $ARTIFACT (expected kosmos-$V-<arch>.tar.gz) -- latest.json was promoted but the prod alias would be stale. Refusing; refresh kosmos-<arch>.tar.gz by hand or fix the artifact name." >&2
  exit 1
fi
cp "$SITE/dist/$ARTIFACT" "$SITE/dist/$ALIAS" || { echo "promote-channel: could not refresh the prod alias $ALIAS" >&2; exit 1; }
. "$(cd "$(dirname "$0")" && pwd)/lib/sha256-name.sh"
sha256_publish_as "$SITE/dist/$ARTIFACT.sha256" "$SITE/dist/$ALIAS.sha256" "$ALIAS" \
  || { echo "promote-channel: could not write $ALIAS.sha256 (the alias may be half-refreshed)" >&2; exit 1; }
echo "   refreshed the prod alias $ALIAS to $V"

echo "promote-channel: PROMOTED $V to prod - latest.json now points at the exact bytes staging verified ($ARTIFACT)."
echo "   -> $(cat "$SITE/dist/latest.json")"
echo "promote-channel: the next site deploy publishes the prod pointer. No rebuild happened."
