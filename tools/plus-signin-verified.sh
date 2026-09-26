#!/usr/bin/env bash
# plus-signin-verified.sh - kosmos#2036: the FIRST KOSMOS+ SIGN-IN gate for the Mac promote.
#
# promote-channel.sh runs it after the experience gate (#2063) and the agent-spawn gate (#2150),
# on the snapshot of the staging pointer. Neither of those touches Kosmos+; this one reads the
# record tools/plus-signin-fresh.js leaves after an agent takes the fresh staging board through a
# real first in-app sign-in (the #3827 parseSaid class). Record location and shape: one place,
# tools/lib/plus-signin-record.js.
#
# Exit contract (the Mac gates'):
#   0  a record names the pointer's sha256 AND version, and says pass;
#   1  the record says fail, or is ambiguous -> refuse (never forceable);
#   2  no record for this sha, or the pointer cannot be read -> HOLD (forceable after a hand check).
#
#   bash tools/plus-signin-verified.sh <site>/dist/latest-staging.json
set -uo pipefail

say() { printf '%s\n' "$*"; }
POINTER="${1:-}"
[ -n "$POINTER" ] || { say "plus-signin-verified: usage: plus-signin-verified.sh <latest-staging.json> - cannot tell"; exit 2; }
[ -f "$POINTER" ] || { say "plus-signin-verified: no staging pointer at $POINTER - cannot tell"; exit 2; }
command -v node >/dev/null 2>&1 || { say "plus-signin-verified: node is required - cannot tell"; exit 2; }
SPEC="$(cd "$(dirname "$0")" && pwd)/lib/plus-signin-record.js"
[ -f "$SPEC" ] || { say "plus-signin-verified: the record spec $SPEC is missing - cannot tell"; exit 2; }

field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$POINTER" "$1" 2>/dev/null || true; }
V="$(field version)"; SHA="$(field sha256)"
[ -n "$V" ] || { say "plus-signin-verified: $POINTER names no version - cannot tell"; exit 2; }
case "$SHA" in *[!0-9a-f]*|'') say "plus-signin-verified: $POINTER names no sha256 - cannot tell"; exit 2 ;; esac
[ "${#SHA}" = 64 ] || { say "plus-signin-verified: $POINTER's sha256 is not 64 hex - cannot tell"; exit 2; }

node "$SPEC" check "$V" "$SHA"
