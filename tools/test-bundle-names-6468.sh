#!/bin/bash
# #6468 ask 2: the build refuses a bundle whose names the signed manifest cannot list exactly
# (tools/build-kosmos-bundle.sh kosmos_bundle_odd_names). The real function is lifted out of the build script and run
# under the build's own shell options against small trees. Run: bash tools/test-bundle-names-6468.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/bundle-names-6468.XXXXXX")"; trap 'rm -rf "$T"' EXIT
fail=0; pass() { printf 'PASS  %s\n' "$*"; }; bad() { printf 'FAIL  %s\n' "$*"; fail=1; }
FN="$(awk '/^kosmos_bundle_odd_names\(\) \{/{p=1} p{print} p&&/^}/{exit}' "$HERE/build-kosmos-bundle.sh")"
[ -n "$FN" ] || { echo "FAIL  kosmos_bundle_odd_names is gone from build-kosmos-bundle.sh"; exit 1; }
eval "$FN"

tree() { local d; d="$(mktemp -d "$T/t.XXXXXX")"; mkdir -p "$d/bin" "$d/app/engine" "$d/runtime/bin"
  : > "$d/VERSION"; : > "$d/bin/kosmos"; : > "$d/app/server.js"; : > "$d/app/engine/manifest-verify.js"
  : > "$d/runtime/bin/node"; mkdir -p "$d/app/web"; : > "$d/app/web/x@2x.png"
  printf '%s' "$d"; }

d="$(tree)"; out="$(kosmos_bundle_odd_names "$d")"
[ -z "$out" ] && pass "CONTROL: a plain tree has no offenders" || bad "plain tree flagged: $out"

d="$(tree)"; : > "$d/app/a b.js"; : > "$d/app/a$(printf '\r')b.js"; : > "$d/app/c$(printf '\302\240')d.js"
out="$(kosmos_bundle_odd_names "$d")"
[ "$(printf '%s\n' "$out" | grep -c 'cannot carry')" = 3 ] && pass "a space, a CR and a no-break space are each named" || bad "odd names: $out"

d="$(tree)"; : > "$d/app/one
two.js"
out="$(kosmos_bundle_odd_names "$d")"
[ -n "$out" ] && pass "a name with a newline in it is refused" || bad "newline name passed"

d="$(tree)"; ln -s /etc/hosts "$d/app/link"
out="$(kosmos_bundle_odd_names "$d")"
printf '%s\n' "$out" | grep -q 'not a plain file: app/link' && pass "a symlink is refused" || bad "symlink: $out"

# The round-5 failure: under pipefail, a head inside the pipe let SIGPIPE fail it and a fallback threw the names away.
d="$(tree)"; mkdir -p "$d/app/many"; i=0; while [ $i -lt 3000 ]; do : > "$d/app/many/n $i.js"; i=$((i + 1)); done
out="$(kosmos_bundle_odd_names "$d")"
[ "$(printf '%s\n' "$out" | grep -c 'cannot carry')" = 3000 ] && pass "3000 offenders are all reported (no SIGPIPE fallback)" || bad "3000 offenders: got $(printf '%s\n' "$out" | grep -c 'cannot carry')"

echo ""
if [ "$fail" = 0 ]; then echo "test-bundle-names-6468: ALL PASS"; else echo "test-bundle-names-6468: FAILURES above"; exit 1; fi
