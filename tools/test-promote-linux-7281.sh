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
// stub, by verb: verify / verify-under / verify-under-list pass unless the signature says BAD (verify-under also fails
// on UNDER, as when prod's current release pins other keys); needs-list answers STUB_NEEDS_LIST (default 3, off).
const fs = require('fs');
const [verb, , sig] = process.argv.slice(2);
if (verb === 'needs-list') process.exit(Number(process.env.STUB_NEEDS_LIST || 3));
const s = fs.readFileSync(sig, 'utf8');
if (s.includes('BAD')) process.exit(1);
if (verb === 'verify-under' && s.includes('UNDER')) process.exit(1);
if (verb === 'verify-under-list' && s.includes('LIST')) process.exit(1);
process.exit(0);
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
prep() { ( promote_linux_prepare "$@" >/dev/null 2>&1; r=$?; echo "rc=$r linux=$PROMOTE_LINUX"; promote_linux_cleanup ); }

# ---- prepare ----
S="$(newsite ok 1.4.0)"
chk "CONTROL: a staging Linux pointer at V is taken" [ "$(prep "$S" 1.4.0)" = "rc=0 linux=yes" ]
chk "a staging Linux pointer at another version refuses (lockstep)" [ "$(prep "$S" 1.4.1)" = "rc=1 linux=no" ]
S2="$(newsite vfield 1.4.0)"; node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version="1.4.9";require("fs").writeFileSync(f,JSON.stringify(p))' "$S2/dist/latest-linux-staging.json"
chk "a pointer whose version field alone disagrees refuses (the names still say 1.4.0)" [ "$(prep "$S2" 1.4.0)" = "rc=1 linux=no" ]
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

# Review 1 (W2): prod's current Linux release must accept the new signature, and so must the served key list when on.
S="$(newsite under 1.4.0)"; printf '{"manifest":"kosmos-1.3.0-linux-x64.manifest.json"}\n' > "$S/dist/latest-linux.json"; printf '{}\n' > "$S/dist/kosmos-1.3.0-linux-x64.manifest.json"
chk "CONTROL: signed by a key prod's current Linux release accepts" [ "$(prep "$S" 1.4.0)" = "rc=0 linux=yes" ]
printf 'sig UNDER\n' > "$S/dist/kosmos-1.4.0-linux-x64.manifest.json.sig"
chk "a signature prod's current Linux release does not accept refuses" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
rm -f "$S/dist/kosmos-1.3.0-linux-x64.manifest.json"; printf 'sig\n' > "$S/dist/kosmos-1.4.0-linux-x64.manifest.json.sig"
chk "prod's current Linux manifest unreadable refuses (cannot tell)" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
S="$(newsite list 1.4.0)"; git -C "$S" init -q; printf 'sig LIST\n' > "$S/dist/kosmos-1.4.0-linux-x64.manifest.json.sig"
chk "CONTROL: with the key-list check off, a LIST-only signature passes" [ "$(prep "$S" 1.4.0)" = "rc=0 linux=yes" ]
chk "with it on, a signature the served list does not name refuses" [ "$(STUB_NEEDS_LIST=0 prep "$S" 1.4.0)" = "rc=1 linux=no" ]

# ---- unchanged + stage + commit ----
S="$(newsite write 1.5.0)"
promote_linux_prepare "$S" 1.5.0 >/dev/null 2>&1
chk "prepare took it" [ "$PROMOTE_LINUX" = yes ]
chk "CONTROL: an unchanged staging pointer passes" promote_linux_unchanged "$S"
chk "the stage succeeds before anything moves" promote_linux_stage "$S"
chk "and has not written latest-linux.json yet" [ ! -f "$S/dist/latest-linux.json" ]
promote_linux_commit "$S" >/dev/null
chk "the commit renames it into place" cmp -s "$S/dist/latest-linux-staging.json" "$S/dist/latest-linux.json"
chk "and nothing is owed at the end" promote_linux_refuse_if_failed
printf ' ' >> "$S/dist/latest-linux-staging.json"
chk "a staging pointer that changed while the promote ran refuses" not promote_linux_unchanged "$S" 2>/dev/null
promote_linux_cleanup
chk "cleanup removes the snapshot" [ ! -f "$PROMOTE_LINUX_SNAP" ]
# Review 1 (W1): a failed rename after latest.json moved does not exit; it is owed at the end.
S="$(newsite fail 1.6.0)"; promote_linux_prepare "$S" 1.6.0 >/dev/null 2>&1; promote_linux_stage "$S"
rm -f "$PROMOTE_LINUX_TMP"
chk "a failed rename returns 0 so the promote's other steps still run" promote_linux_commit "$S" 2>/dev/null
chk "and the end of the promote refuses, naming what was not done" not promote_linux_refuse_if_failed 2>/dev/null
promote_linux_cleanup; PROMOTE_LINUX_FAILED=0
PROMOTE_LINUX=no; E2="$T/site-none"; mkdir -p "$E2/dist"
chk "with no Linux family the commit is a no-op" promote_linux_commit "$E2"
chk "and writes nothing" [ ! -f "$E2/dist/latest-linux.json" ]

# ---- promote-channel.sh wires it ----
PC="$HERE/tools/promote-channel.sh"
wired() { grep -qF -- "$1" "$PC"; }
chk "the marker release.sh reads is there, exactly" grep -qx 'PROMOTE_MOVES_LINUX=1' "$PC"
chk "the lib is sourced" wired '/lib/promote-linux.sh" || {'
chk "prepare runs for a Mac promote and exits on refusal" wired 'promote_linux_prepare "$SITE" "$V" "$NAMED_VERSION" || exit 1'
chk "the unchanged check runs before the writes" wired 'promote_linux_unchanged "$SITE" || exit 1'
chk "the stage runs before latest.json moves, and exits on failure" wired 'promote_linux_stage "$SITE" || exit 1'
chk "the commit follows latest.json and does NOT exit (review 1 W1)" grep -qx '\[ "\$FAMILY" != mac \] || promote_linux_commit "\$SITE"' "$PC"
chk "the end refuses when the Linux rename failed" wired 'promote_linux_refuse_if_failed || exit 1'
chk "the EXIT trap removes the snapshot" wired "trap 'promote_linux_cleanup;"
chk "--family linux is refused" wired '  linux) echo "promote-channel: the Linux family is not promoted on its own'
# Order: prepare before the first write, the write right after latest.json's mv.
order() {
  local p u m w
  local st a r
  p="$(grep -nF 'promote_linux_prepare "$SITE"' "$PC" | cut -d: -f1)"; u="$(grep -nF 'promote_linux_unchanged "$SITE"' "$PC" | cut -d: -f1)"
  st="$(grep -nF 'promote_linux_stage "$SITE"' "$PC" | cut -d: -f1)"
  m="$(grep -nF 'mv "$PTMP" "$SITE/dist/$PROD_NAME"' "$PC" | cut -d: -f1)"; w="$(grep -nF 'promote_linux_commit "$SITE"' "$PC" | cut -d: -f1)"
  a="$(grep -nF 'echo "   refreshed the prod alias $ALIAS to $V"' "$PC" | cut -d: -f1)"; r="$(grep -nF 'promote_linux_refuse_if_failed || exit 1' "$PC" | cut -d: -f1)"
  [ -n "$p" ] && [ -n "$u" ] && [ -n "$st" ] && [ -n "$m" ] && [ -n "$w" ] && [ -n "$a" ] && [ -n "$r" ] \
    && [ "$p" -lt "$u" ] && [ "$u" -lt "$st" ] && [ "$st" -lt "$m" ] && [ "$m" -lt "$w" ] && [ "$w" -lt "$a" ] && [ "$a" -lt "$r" ]
}
chk "prepare, unchanged, stage, latest.json, latest-linux.json, the alias, then the end check" order

echo "test-promote-linux-7281: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
