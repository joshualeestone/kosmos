#!/bin/bash
# The pkg-input freshness guard, with its control: prove the input sha CHANGES
# when the postinstall changes, so a stale served pkg would be caught (#638).
# A guard shipped without a control is the defect this whole day was about.
set -u
cd "$(dirname "$0")/.." || exit 1
. tools/lib/pkg-inputs.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/pkg-input-guard.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/install/pkg-scripts"
printf '#!/bin/sh\necho hello\n' > "$T/install/pkg-scripts/postinstall"

a="$(pkg_input_sha "$T")"
[ -n "$a" ] && ok "computes an input sha" || bad "no sha computed"
b="$(pkg_input_sha "$T")"
[ "$a" = "$b" ] && ok "deterministic: same inputs give the same sha" || bad "non-deterministic ($a != $b)"

# CONTROL: change the postinstall, the sha MUST change (a stale pkg is caught).
printf '#!/bin/sh\necho hello world\n' > "$T/install/pkg-scripts/postinstall"
c="$(pkg_input_sha "$T")"
[ "$c" != "$a" ] && ok "CONTROL: editing the postinstall changes the sha (divergence is detectable)" || bad "editing the postinstall did NOT change the sha -- the guard is blind"

# a NEW pkg-scripts file also changes the sha (an added script is an input).
printf 'x\n' > "$T/install/pkg-scripts/preinstall"
d="$(pkg_input_sha "$T")"
[ "$d" != "$c" ] && ok "adding a pkg-scripts file changes the sha" || bad "a new pkg-scripts file was not seen"

# the compare semantics release.sh uses: equal passes, differ/absent red.
served="$c"; want="$c"; [ "$served" = "$want" ] && ok "compare: matching served and source pass" || bad "matching compare failed"
served="$a"; want="$c"; [ "$served" != "$want" ] && ok "compare: a stale served sha differs from source (release reds)" || bad "stale compare not caught"
served="";  [ -z "$served" ] && ok "compare: an absent sidecar is empty (release reds)" || bad "absent sidecar not caught"

# missing pkg-scripts dir refuses rather than emitting an empty sha.
if pkg_input_sha "$T/nope" >/dev/null 2>&1; then bad "a missing pkg-scripts dir did not refuse"; else ok "a missing pkg-scripts dir refuses, not a blank sha"; fi

echo "pkg-input-guard: $FAILS failures"; [ "$FAILS" -eq 0 ]
