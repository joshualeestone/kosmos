#!/bin/bash
# kosmos#8562: an aborted cut's never-served versioned files are moved aside before the next cut of that version builds,
# and anything served or unknown is refused. Covers release_leftovers_clear (tools/lib/release-leftovers.sh) with `curl`
# stubbed, and that release.sh runs it at step 1g, before the trap reads what the site already held.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/release-leftovers.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/release-leftovers-8562.XXXXXX")"; trap 'rm -rf "$T"' EXIT
SUM=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
HTML='<!doctype html>'

# The served host: $T/served/<path> is a 200 with that body; anything else is the site's HTML fallback (a 200 too,
# as installkosmos.com answers a made-up name), unless $T/down exists (every request fails).
curl() {
  local a url; for a in "$@"; do url="$a"; done; url="${url%%\?*}"; printf '%s\n' "$url" >> "$T/urls"
  [ -e "$T/down" ] && return 7
  local p="${url#https://h/}"
  if [ -f "$T/served/$p" ]; then cat "$T/served/$p"; else printf '%s\n' "$HTML"; fi
}
serve() { mkdir -p "$(dirname "$T/served/$1")"; printf '%s\n' "$2" > "$T/served/$1"; }

site() {   # a fresh site checkout with one committed file and the given untracked leftovers
  rm -rf "$T/site" "$T"/site.aborted-* "$T/served" "$T/down" "$T/urls"; mkdir -p "$T/site/dist"
  git -C "$T/site" init -q && git -C "$T/site" config user.email t@t && git -C "$T/site" config user.name t
  printf 'x\n' > "$T/site/dist/kosmos-0.8.05-arm64.manifest.json"
  git -C "$T/site" add -A && git -C "$T/site" commit -qm init
  local f; for f in "$@"; do printf 'old bytes\n' > "$T/site/dist/$f"; done
  serve dist/latest.json '{"version":"0.8.02"}'; serve dist/latest-linux.json '{"version":"0.8.02"}'
  serve dist/kosmos-0.8.02-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.02-arm64.tar.gz"
  serve dist/kosmos-0.8.02-linux-x64.tar.gz.sha256 "$SUM  kosmos-0.8.02-linux-x64.tar.gz"
}
left() { ls "$T/site/dist" | grep -c '^kosmos-0\.8\.05-' ; }
aside() { ls -d "$T"/site.aborted-0.8.05-* 2>/dev/null | head -1; }

# 1. Nothing left: nothing asked, nothing moved.
site
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && [ ! -e "$T/urls" ] && ok "no leftovers: returns 0, says nothing, asks the host nothing" || bad "none: rc=$rc out=$out"

# 2. The 11-13 case: never served (both families), moved aside, nothing deleted, the committed manifest untouched.
site kosmos-0.8.05-arm64.tar.gz kosmos-0.8.05-arm64.tar.gz.sha256 kosmos-0.8.05-linux-x64.tar.gz kosmos-0.8.05-linux-x64.tar.gz.sha256
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
d="$(aside)"
[ "$rc" = 0 ] && [ -n "$d" ] && [ "$(ls -d "$T"/site.aborted-0.8.05-* | wc -l | tr -d ' ')" = 1 ] && [ "$(ls "$d" | wc -l | tr -d ' ')" = 4 ] && ok "never served: all four leftovers moved into one dated folder beside the site" || bad "never served: rc=$rc moved=$(ls "$d" 2>/dev/null | wc -l) out=$out"
[ "$(left)" = 1 ] && [ -f "$T/site/dist/kosmos-0.8.05-arm64.manifest.json" ] && ok "the committed manifest of that version is left where it is" || bad "committed file moved: $(ls "$T/site/dist")"
[ "$(cat "$d/kosmos-0.8.05-arm64.tar.gz")" = "old bytes" ] && ok "moved, not deleted: the bytes are in the folder" || bad "bytes lost"
[ -z "$(git -C "$T/site" status --porcelain)" ] && ok "the site checkout is clean afterwards (the folder is outside it)" || bad "site dirty: $(git -C "$T/site" status --porcelain)"
grep -qx "https://h/dist/kosmos-0.8.05-arm64.tar.gz.sha256" "$T/urls" && grep -qx "https://h/dist/kosmos-0.8.02-linux-x64.tar.gz.sha256" "$T/urls" \
  && grep -q "leftover-control-arm64" "$T/urls" && ok "it read the version's own sidecar, the served version's, and a made-up one" || bad "urls: $(sort -u "$T/urls" | tr '\n' ' ')"

# 3. Served: refused, nothing moved.
site kosmos-0.8.05-arm64.tar.gz
serve dist/kosmos-0.8.05-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.05-arm64.tar.gz"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 2 ] && [ -z "$(aside)" ] && [[ "$out" == *"Bump the version"* ]] && ok "served: refused with 'bump the version', nothing moved" || bad "served: rc=$rc left=$(left) out=$out"

# 4. Unknown: the host is down. Refused, nothing moved, and the words say what to do.
site kosmos-0.8.05-arm64.tar.gz; : > "$T/down"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 2 ] && [ -z "$(aside)" ] && [[ "$out" == *"cannot tell"* ]] && [[ "$out" == *"move the files listed above"* ]] && ok "host down: refused as unknown, nothing moved, the way on said" || bad "down: rc=$rc left=$(left) out=$out"

# 5. Unknown: the served version's own sidecar does not answer a checksum (the positive control fails).
site kosmos-0.8.05-arm64.tar.gz; rm -f "$T/served/dist/kosmos-0.8.02-arm64.tar.gz.sha256"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && ok "positive control fails (the served version's sidecar is not a checksum): refused, nothing moved" || bad "pos ctl: rc=$rc out=$out"

# 6. Unknown: a version that cannot exist answers a checksum (the negative control fails).
site kosmos-0.8.05-arm64.tar.gz; serve dist/kosmos-0.0.0-leftover-control-arm64.tar.gz.sha256 "$SUM  x"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && ok "negative control fails (a made-up version answers a checksum): refused, nothing moved" || bad "neg ctl: rc=$rc out=$out"

# 7. Per family: Linux served, Mac never served. The Mac files are moved, then Linux is refused.
site kosmos-0.8.05-arm64.tar.gz kosmos-0.8.05-linux-x64.tar.gz
serve dist/kosmos-0.8.05-linux-x64.tar.gz.sha256 "$SUM  kosmos-0.8.05-linux-x64.tar.gz"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h)"; rc=$?
[ "$rc" = 1 ] && [ -f "$T/site/dist/kosmos-0.8.05-linux-x64.tar.gz" ] && ok "a served Linux family is refused and its file stays" || bad "linux served: rc=$rc out=$out"

# 8. release.sh runs it at step 1g, before step 2 and before the trap reads _pair_had.
R="tools/release.sh"
g=$(grep -n 'release_leftovers_clear "\$SITE" "\$V"' "$R" | head -1 | cut -d: -f1)
s2=$(grep -n 'step "== 2\. the version, in one place ==' "$R" | cut -d: -f1)
ph=$(grep -n '^_pair_had=0' "$R" | cut -d: -f1)
[ -n "$g" ] && [ -n "$s2" ] && [ -n "$ph" ] && [ "$g" -lt "$s2" ] && [ "$g" -lt "$ph" ] && ok "release.sh calls it at step 1g, before step 2 and before _pair_had is read" || bad "order: call=$g step2=$s2 pair_had=$ph"
grep -q 'release_leftovers_clear "\$SITE" "\$V" .* || { echo "nothing was built"; exit 1; }' "$R" && ok "a refusal stops the cut before anything is built" || bad "the call does not stop on a refusal"

[ "$FAILS" = 0 ] && echo "release-leftovers-8562: all passed" || { echo "release-leftovers-8562: $FAILS FAILED"; exit 1; }
