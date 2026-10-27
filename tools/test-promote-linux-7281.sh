#!/bin/bash
# test-promote-linux-7281.sh -- kosmos#7281 slice C2. Unit-tests tools/lib/promote-linux.sh (a Mac promote moves the
# Linux pointer in lockstep) against a fake site, and checks promote-channel.sh wires it. A whole promote runs gates
# against a live board and is not driven here. The signature check is a stub: the lib is copied into a temp tools/lib,
# so no seam is added to the shipped code.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/promote-linux-7281.XXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/tools/lib"
cp "$HERE/tools/lib/promote-linux.sh" "$T/tools/lib/"
cat > "$T/tools/lib/manifest-sign.js" <<'EOF'
// stub: "verify" passes unless the signature file says BAD
const fs = require('fs');
process.exit(fs.readFileSync(process.argv[4], 'utf8').includes('BAD') ? 1 : 0);
EOF
. "$T/tools/lib/promote-linux.sh"

PASS=0; FAIL=0
chk() { local desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
not() { ! "$@"; }

# A site whose staging channel published version <v> of the Linux family, as release.sh leaves it.
newsite() {   # <name> <version> [pointer version]
  local s="$T/site-$1" v="$2" pv="${3:-$2}" sha
  mkdir -p "$s/dist"
  printf 'linux %s\n' "$v" > "$s/dist/kosmos-$v-linux-x64.tar.gz"
  ( cd "$s/dist" && shasum -a 256 "kosmos-$v-linux-x64.tar.gz" > "kosmos-$v-linux-x64.tar.gz.sha256" )
  sha="$(awk '{print $1}' "$s/dist/kosmos-$v-linux-x64.tar.gz.sha256")"
  printf '{"platform":"linux","version":"%s"}\n' "$v" > "$s/dist/kosmos-$v-linux-x64.manifest.json"
  printf 'sig\n' > "$s/dist/kosmos-$v-linux-x64.manifest.json.sig"
  printf '{"version":"%s","sha256":"%s","artifact":"kosmos-%s-linux-x64.tar.gz","manifest":"kosmos-%s-linux-x64.manifest.json","versioned":"kosmos-%s-linux-x64.tar.gz"}\n' "$pv" "$sha" "$pv" "$pv" "$pv" > "$s/dist/latest-linux-staging.json"
  printf '%s\n' "$s"
}
prep() { ( promote_linux_prepare "$@" >/dev/null 2>&1; echo "rc=$? linux=$PROMOTE_LINUX" ); }

# ---- prepare ----
S="$(newsite ok 1.4.0)"
chk "CONTROL: a staging Linux pointer at V is taken" [ "$(prep "$S" 1.4.0)" = "rc=0 linux=yes" ]
chk "a staging Linux pointer at another version refuses (lockstep)" [ "$(prep "$S" 1.4.1)" = "rc=1 linux=no" ]
chk "a named promote refuses while staging has a Linux pointer" [ "$(prep "$S" 1.4.0 1.4.0)" = "rc=1 linux=no" ]
E="$T/site-empty"; mkdir -p "$E/dist"
chk "CONTROL: no Linux pointers at all: the Mac promote goes ahead alone" [ "$(prep "$E" 1.4.0)" = "rc=0 linux=no" ]
printf '{}\n' > "$E/dist/latest-linux.json"
chk "a Linux PROD pointer with no staging one to move it refuses" [ "$(prep "$E" 1.4.0)" = "rc=1 linux=no" ]
S="$(newsite badsha 1.4.0)"; printf 'x' >> "$S/dist/kosmos-1.4.0-linux-x64.tar.gz"
chk "a Linux tarball that does not match its .sha256 refuses" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
S="$(newsite nosig 1.4.0)"; rm -f "$S/dist/kosmos-1.4.0-linux-x64.manifest.json.sig"
chk "a missing manifest signature refuses" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
S="$(newsite badsig 1.4.0)"; printf 'BAD\n' > "$S/dist/kosmos-1.4.0-linux-x64.manifest.json.sig"
chk "a signature that does not verify refuses" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
S="$(newsite ptrsha 1.4.0)"; node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.sha256="a".repeat(64);require("fs").writeFileSync(f,JSON.stringify(p))' "$S/dist/latest-linux-staging.json"
chk "a pointer whose sha256 is not the tarball's refuses" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]

# ---- unchanged + write ----
S="$(newsite write 1.5.0)"
promote_linux_prepare "$S" 1.5.0 >/dev/null 2>&1
chk "prepare took it" [ "$PROMOTE_LINUX" = yes ]
chk "CONTROL: an unchanged staging pointer passes" promote_linux_unchanged "$S"
chk "the write succeeds" promote_linux_write "$S" >/dev/null
chk "latest-linux.json is the staging pointer, byte for byte" cmp -s "$S/dist/latest-linux-staging.json" "$S/dist/latest-linux.json"
printf ' ' >> "$S/dist/latest-linux-staging.json"
chk "a staging pointer that changed while the promote ran refuses" not promote_linux_unchanged "$S" 2>/dev/null
promote_linux_cleanup
chk "cleanup removes the snapshot" [ ! -f "$PROMOTE_LINUX_SNAP" ]
PROMOTE_LINUX=no; E2="$T/site-none"; mkdir -p "$E2/dist"
chk "with no Linux family the write is a no-op" promote_linux_write "$E2"
chk "and writes nothing" [ ! -f "$E2/dist/latest-linux.json" ]

# ---- promote-channel.sh wires it ----
PC="$HERE/tools/promote-channel.sh"
wired() { grep -qF -- "$1" "$PC"; }
chk "the marker release.sh reads is there, exactly" grep -qx 'PROMOTE_MOVES_LINUX=1' "$PC"
chk "the lib is sourced" wired '/lib/promote-linux.sh" || {'
chk "prepare runs for a Mac promote and exits on refusal" wired 'promote_linux_prepare "$SITE" "$V" "$NAMED_VERSION" || exit 1'
chk "the unchanged check runs before the writes" wired 'promote_linux_unchanged "$SITE" || exit 1'
chk "the write follows latest.json and exits on failure" wired 'promote_linux_write "$SITE" || exit 1'
chk "the EXIT trap removes the snapshot" wired "trap 'promote_linux_cleanup;"
chk "--family linux is refused" wired '  linux) echo "promote-channel: the Linux family is not promoted on its own'
# Order: prepare before the first write, the write right after latest.json's mv.
order() {
  local p u m w
  p="$(grep -nF 'promote_linux_prepare "$SITE"' "$PC" | cut -d: -f1)"; u="$(grep -nF 'promote_linux_unchanged "$SITE"' "$PC" | cut -d: -f1)"
  m="$(grep -nF 'mv "$PTMP" "$SITE/dist/$PROD_NAME"' "$PC" | cut -d: -f1)"; w="$(grep -nF 'promote_linux_write "$SITE"' "$PC" | cut -d: -f1)"
  [ -n "$p" ] && [ -n "$u" ] && [ -n "$m" ] && [ -n "$w" ] && [ "$p" -lt "$u" ] && [ "$u" -lt "$m" ] && [ "$m" -lt "$w" ]
}
chk "prepare, then the unchanged check, then latest.json, then latest-linux.json" order

echo "test-promote-linux-7281: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
