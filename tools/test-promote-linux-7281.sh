#!/bin/bash
# test-promote-linux-7281.sh -- kosmos#7281 slice C2. Unit-tests tools/lib/promote-linux.sh (a Mac promote moves the
# Linux pointer in lockstep) against a fake site, checks promote-channel.sh wires it, and drives whole promotes with
# the gates stubbed (the e2e section). The signature check is a stub: the lib (and, for the e2e, promote-channel.sh) is
# copied into a temp tools/, so no seam is added to the shipped code.
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
// verify-under-list <manifest> <sig> <list> <list.sig>: as the real tool, refuse a missing list; and the list's own
// signature must be the COMMITTED one ("list-sig"), so a read of the working tree or a missing fetch cannot pass.
if (verb === 'verify-under-list') {
  const [, , , list, listSig] = process.argv.slice(2);
  if (!fs.existsSync(list) || !fs.existsSync(listSig) || !fs.readFileSync(listSig, 'utf8').includes('list-sig')) process.exit(1);
  if (s.includes('LIST')) process.exit(1);
}
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
# Review 5 (W1): a named promote takes the Linux pointer COMMITTED with the Mac one, not the working tree's.
S="$(newsite named 1.4.0)"; git -C "$S" init -q -b main; git -C "$S" config user.email t@t; git -C "$S" config user.name t
git -C "$S" add dist; git -C "$S" commit -q -m "cut 1.4.0"; C140="$(git -C "$S" rev-parse HEAD)"
S5="$(newsite named5 1.5.0)"; cp "$S5"/dist/kosmos-1.5.0-* "$S/dist/"; cp "$S5/dist/latest-linux-staging.json" "$S/dist/latest-linux-staging.json"
chk "CONTROL: staging has moved on to 1.5.0, so an unnamed promote of 1.4.0 refuses (lockstep)" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
chk "a named promote of 1.4.0 takes the pointer committed in its cut" [ "$(prep "$S" 1.4.0 "$C140")" = "rc=0 linux=yes" ]
chk "a named promote whose commit names another Linux version refuses" [ "$(prep "$S" 1.4.1 "$C140")" = "rc=1 linux=no" ]
git -C "$S" rm -q --cached dist/latest-linux-staging.json; git -C "$S" commit -q -m "no linux"; CNOL="$(git -C "$S" rev-parse HEAD)"
chk "CONTROL: a named commit with no Linux pointer and no prod one: the Mac promote goes alone" [ "$(prep "$S" 1.4.0 "$CNOL")" = "rc=0 linux=no" ]
printf '{"manifest":"x"}\n' > "$S/dist/latest-linux.json"
chk "a named commit with no Linux pointer while prod has one refuses (lockstep)" [ "$(prep "$S" 1.4.0 "$CNOL")" = "rc=1 linux=no" ]
out="$( ( promote_linux_prepare "$S" 1.4.0 "$CNOL" 2>&1 >/dev/null; promote_linux_cleanup ) )"
case "$out" in *"cut before the Linux family"*"Roll back to a build that has a Linux build"*) PASS=$((PASS+1)) ;; *) FAIL=$((FAIL+1)); echo "FAIL: a named rollback to a pre-Linux build does not say what to do (review 7 W3): $out" >&2 ;; esac
rm -f "$S/dist/latest-linux.json"
promote_linux_prepare "$S" 1.4.0 "$C140" >/dev/null 2>&1
printf ' ' >> "$S/dist/latest-linux-staging.json"
chk "a named promote is not refused when the staging pointer's FILE moves (it read a commit)" promote_linux_unchanged "$S"
promote_linux_cleanup
# Review 7 (W1): after a named promote, the remedy writes the COMMITTED pointer, not the staging file (which has moved on).
out="$( ( promote_linux_prepare "$S" 1.4.0 "$C140" >/dev/null 2>&1; promote_linux_stage "$S" >/dev/null 2>&1; rm -f "$PROMOTE_LINUX_TMP"; promote_linux_commit "$S" 2>&1 >/dev/null; promote_linux_refuse_if_failed 2>&1; promote_linux_cleanup ) )"
case "$out" in *"show $C140:dist/latest-linux-staging.json"*) PASS=$((PASS+1)) ;; *) FAIL=$((FAIL+1)); echo "FAIL: a named promote's remedy does not name its commit (review 7 W1): $out" >&2 ;; esac
case "$out" in *"copy dist/latest-linux-staging.json"*) FAIL=$((FAIL+1)); echo "FAIL: a named promote's remedy still says to copy the staging file (review 7 W1)" >&2 ;; *) PASS=$((PASS+1)) ;; esac
rm -f "$S/dist/latest-linux.json"
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
# Review 4 (W2): a prod pointer that exists but names no manifest refuses, rather than skipping the check.
S="$(newsite prodnoman 1.4.0)"; printf '{"version":"1.3.0"}\n' > "$S/dist/latest-linux.json"
chk "a prod Linux pointer that names no manifest refuses" [ "$(prep "$S" 1.4.0)" = "rc=1 linux=no" ]
# Review 2 (W1): the key-list arm needs a real origin carrying the served list, or the fetch refuses first and the
# check itself is never reached.
S="$(newsite list 1.4.0)"; O="$T/origin-list.git"; git init -q --bare -b main "$O"
git -C "$S" init -q -b main; git -C "$S" config user.email t@t; git -C "$S" config user.name t
printf '{"keys":[]}\n' > "$S/dist/release-keys.json"; printf 'stale-old-list\n' > "$S/dist/release-keys.json.sig"
git -C "$S" add dist/release-keys.json dist/release-keys.json.sig; git -C "$S" commit -q -m keys; git -C "$S" remote add origin "$O"; git -C "$S" push -q origin main
# Review 3: the served list moves on from ANOTHER clone, so this checkout's origin/main is stale until it fetches.
CL="$T/clone-list"; git clone -q "$O" "$CL"; git -C "$CL" config user.email t@t; git -C "$CL" config user.name t
printf 'list-sig\n' > "$CL/dist/release-keys.json.sig"; git -C "$CL" commit -qam "served list"; git -C "$CL" push -q origin main
# Review 3: the working tree's copy now disagrees with origin, so only a read of origin/main after the fetch can pass.
printf 'working-tree-not-served\n' > "$S/dist/release-keys.json.sig"
chk "CONTROL: key-list check ON, a good signature passes (the check ran and agreed)" [ "$(STUB_NEEDS_LIST=0 prep "$S" 1.4.0)" = "rc=0 linux=yes" ]
printf 'sig LIST\n' > "$S/dist/kosmos-1.4.0-linux-x64.manifest.json.sig"
chk "CONTROL: with the key-list check off, a LIST-only signature passes" [ "$(prep "$S" 1.4.0)" = "rc=0 linux=yes" ]
chk "with it on, a signature the served list does not name refuses" [ "$(STUB_NEEDS_LIST=0 prep "$S" 1.4.0)" = "rc=1 linux=no" ]
# Review 3: origin reachable but carrying no list: refused (the real tool refuses a missing list).
S3="$(newsite listmissing 1.4.0)"; O3="$T/origin-listmissing.git"; git init -q --bare -b main "$O3"
git -C "$S3" init -q -b main; git -C "$S3" config user.email t@t; git -C "$S3" config user.name t
printf 'x\n' > "$S3/dist/.keep"; git -C "$S3" add dist/.keep; git -C "$S3" commit -q -m e; git -C "$S3" remote add origin "$O3"; git -C "$S3" push -q origin main
chk "with it on and no served list on origin, it refuses" [ "$(STUB_NEEDS_LIST=0 prep "$S3" 1.4.0)" = "rc=1 linux=no" ]
S2="$(newsite listnoorigin 1.4.0)"; git -C "$S2" init -q
chk "with it on and no way to fetch the served list, it refuses" [ "$(STUB_NEEDS_LIST=0 prep "$S2" 1.4.0)" = "rc=1 linux=no" ]

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
# Review 4 (W3): the files the pointer names are checked again right before the writes, not only at prepare.
S="$(newsite recheck 1.6.0)"; promote_linux_prepare "$S" 1.6.0 >/dev/null 2>&1
chk "CONTROL: prepare took it, and the re-check passes on untouched files" promote_linux_unchanged "$S"
printf 'x' >> "$S/dist/kosmos-1.6.0-linux-x64.tar.gz"
chk "a tarball replaced after prepare (pointer unchanged) refuses" not promote_linux_unchanged "$S" 2>/dev/null
promote_linux_cleanup
S="$(newsite resig 1.6.0)"; promote_linux_prepare "$S" 1.6.0 >/dev/null 2>&1
printf 'BAD\n' > "$S/dist/kosmos-1.6.0-linux-x64.manifest.json.sig"
chk "a manifest signature replaced after prepare refuses" not promote_linux_unchanged "$S" 2>/dev/null
promote_linux_cleanup
chk "cleanup removes the snapshot" [ ! -f "$PROMOTE_LINUX_SNAP" ]
# Review 1 (W1): a failed rename after latest.json moved does not exit; it is owed at the end.
S="$(newsite fail 1.6.0)"; promote_linux_prepare "$S" 1.6.0 >/dev/null 2>&1; promote_linux_stage "$S"
rm -f "$PROMOTE_LINUX_TMP"
chk "a failed rename returns 0 so the promote's other steps still run" promote_linux_commit "$S" 2>/dev/null
out="$(promote_linux_cleanup 2>&1)"
case "$out" in *"ALSO NOT DONE: latest-linux.json"*) PASS=$((PASS+1)) ;; *) FAIL=$((FAIL+1)); echo "FAIL: an exit before the end check did not say the Linux remedy (review 2 W2): $out" >&2 ;; esac
chk "and the end of the promote refuses, naming what was not done" not promote_linux_refuse_if_failed 2>/dev/null
out="$(promote_linux_cleanup 2>&1)"
chk "once the end check has said it, the trap does not say it again" [ -z "$out" ]
PROMOTE_LINUX_FAILED=0; PROMOTE_LINUX_REMEDY_SAID=0
# Review 3 (nit): a read-back failure (the rename happened, the bytes are not the snapshot) is owed too, and the trap
# must not delete the latest-linux.json that is now real.
S="$(newsite readback 1.6.1)"; promote_linux_prepare "$S" 1.6.1 >/dev/null 2>&1; promote_linux_stage "$S"
printf 'drift\n' >> "$PROMOTE_LINUX_SNAP"
promote_linux_commit "$S" 2>/dev/null
chk "a read-back failure is owed" [ "$PROMOTE_LINUX_FAILED" = 1 ]
chk "and leaves no temp for the trap to remove" [ -z "$PROMOTE_LINUX_TMP" ]
promote_linux_cleanup 2>/dev/null
chk "the trap keeps the real latest-linux.json" [ -f "$S/dist/latest-linux.json" ]
PROMOTE_LINUX_FAILED=0; PROMOTE_LINUX_REMEDY_SAID=0
PROMOTE_LINUX=no; E2="$T/site-none"; mkdir -p "$E2/dist"
chk "with no Linux family the commit is a no-op" promote_linux_commit "$E2"
chk "and writes nothing" [ ! -f "$E2/dist/latest-linux.json" ]

# ---- promote-channel.sh wires it ----
PC="$HERE/tools/promote-channel.sh"
wired() { grep -qF -- "$1" "$PC"; }
chk "the marker release.sh reads is there, exactly" grep -qx 'PROMOTE_MOVES_LINUX=1' "$PC"
chk "the lib is sourced" wired '/lib/promote-linux.sh" || {'
chk "prepare runs for a Mac promote, gets a named promote's COMMIT (not its version), and exits on refusal" wired 'promote_linux_prepare "$SITE" "$V" "${NAMED_VERSION:+$NAMED_COMMIT}" || exit 1'
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

# ---- review 5 (W3): a whole Mac promote, DRIVEN, with a Linux pair on the site ----
# promote-channel.sh and its libs are copied into a temp tools/ beside the signature stub above, so no seam is added to
# shipped code; the gates are stubbed the way tools/test-promote-named-7005.sh does.
mkdir -p "$T/e2e/tools"; cp "$HERE/tools/promote-channel.sh" "$T/e2e/tools/"; cp -R "$HERE/tools/lib" "$T/e2e/tools/lib"
cp "$T/tools/lib/manifest-sign.js" "$T/e2e/tools/lib/manifest-sign.js"
GSTUB="$T/e2e/gate.sh"; printf '#!/usr/bin/env bash\nexit 0\n' > "$GSTUB"
e2e() {   # <site> [args...]: a promote; prints rc=<n>
  ( export KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=0.0.0 KOSMOS_PLUS_VERIFY_DIR="$T/e2e/plus" \
      KOSMOS_PROMOTE_GATE_CMD="bash $GSTUB" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $GSTUB" \
      KOSMOS_PROMOTE_PLUS_GATE_CMD="bash $GSTUB" KOSMOS_PROMOTE_TUNNEL_GATE_CMD="bash $GSTUB"
    bash "$T/e2e/tools/promote-channel.sh" "$@" > "$T/e2e/out.log" 2>&1; echo "rc=$?" )
}
e2esite() {   # <name> <version> [linux pointer version]: prod 1.0.0 (Mac only), staging cut <version> with the Linux pair
  local s="$T/e2e/site-$1" v="$2" lv="${3:-$2}" art="kosmos-$2-arm64.tar.gz" sha
  mkdir -p "$s/dist"; git -C "$s" init -q -b main; git -C "$s" config user.email t@t; git -C "$s" config user.name t
  echo '{"version":"1.0.0"}' > "$s/dist/latest.json"
  printf 'PROD-INSTALLER KOSMOS_READONLY_APP\n' > "$s/setup"; ( cd "$s" && shasum -a 256 setup > setup.sha256 )
  printf 'ARTIFACT-BYTES-%s\n' "$v" > "$s/dist/$art"; ( cd "$s/dist" && shasum -a 256 "$art" > "$art.sha256" )
  sha="$(awk '{print $1}' "$s/dist/$art.sha256")"
  printf '{"files":[]}\n' > "$s/dist/kosmos-$v-arm64.manifest.json"
  printf 'INSTALLER-%s KOSMOS_READONLY_APP\n' "$v" > "$s/setup-staging"; ( cd "$s" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
  KM_LJ_VERSION="$v" KM_LJ_SHA="$sha" KM_LJ_ARTIFACT="$art" KM_LJ_MANIFEST="kosmos-$v-arm64.manifest.json" \
    KM_LJ_SETUP_SHA="$(shasum -a 256 < "$s/setup-staging" | awk '{print $1}')" node "$HERE/tools/lib/write-latest-pointer.js" "$s/dist/latest-staging.json"
  local l; l="$(newsite "e2e-$1" "$lv")"; cp "$l"/dist/kosmos-"$lv"-linux-x64.* "$l/dist/latest-linux-staging.json" "$s/dist/"
  git -C "$s" add -A; git -C "$s" commit -qm "cut $v"
  printf '%s\n' "$s"
}
S="$(e2esite go 9.9.9)"
chk "e2e CONTROL: a promote with a Linux pair exits 0" [ "$(e2e "$S")" = "rc=0" ]
chk "e2e: latest.json names 9.9.9" grep -q '"version": *"9.9.9"' "$S/dist/latest.json"
chk "e2e: latest-linux.json is the staging Linux pointer, byte for byte" cmp -s "$S/dist/latest-linux-staging.json" "$S/dist/latest-linux.json"
S="$(e2esite skew 9.9.9 9.9.8)"
chk "e2e: a Linux pointer on another version refuses" [ "$(e2e "$S")" = "rc=1" ]
chk "e2e: and latest.json was not written" [ "$(cat "$S/dist/latest.json")" = '{"version":"1.0.0"}' ]
chk "e2e: nor latest-linux.json" [ ! -e "$S/dist/latest-linux.json" ]
S="$(e2esite owed 9.9.9)"; mkdir -p "$S/dist/latest-linux.json/blocker"   # the rename lands inside a folder: read-back fails
chk "e2e: a Linux write that does not take refuses at the end" [ "$(e2e "$S")" = "rc=1" ]
chk "e2e: after latest.json was promoted" grep -q '"version": *"9.9.9"' "$S/dist/latest.json"
chk "e2e: and /setup too (the steps after the Linux write still ran)" [ "$(cat "$S/setup")" = "INSTALLER-9.9.9 KOSMOS_READONLY_APP" ]
chk "e2e: saying what is owed" grep -q 'REFUSED AT THE END' "$T/e2e/out.log"
chk "e2e: an unnamed promote's remedy copies the staging pointer" grep -q 'copy dist/latest-linux-staging.json onto dist/latest-linux.json' "$T/e2e/out.log"
# Review 7 (W2): a rollback promote says the deploy needs KOSMOS_LINUX_ROLLBACK (deploy-site refuses a backwards move).
chk "a rollback promote names KOSMOS_LINUX_ROLLBACK for the deploy" grep -qF 'deploy it with KOSMOS_LINUX_ROLLBACK=$V set' "$HERE/tools/promote-channel.sh"
# A NAMED promote, driven: staging has moved on to a later cut, and --version takes the Linux pointer committed with
# the named cut, not the working tree's.
e2eaddcut() {   # <site> <version>: one more committed staging cut with its Linux pair
  local s="$1" v="$2" art="kosmos-$2-arm64.tar.gz" sha l
  printf 'ARTIFACT-BYTES-%s\n' "$v" > "$s/dist/$art"; ( cd "$s/dist" && shasum -a 256 "$art" > "$art.sha256" )
  sha="$(awk '{print $1}' "$s/dist/$art.sha256")"
  printf '{"files":[]}\n' > "$s/dist/kosmos-$v-arm64.manifest.json"
  printf 'INSTALLER-%s KOSMOS_READONLY_APP\n' "$v" > "$s/setup-staging"; ( cd "$s" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
  KM_LJ_VERSION="$v" KM_LJ_SHA="$sha" KM_LJ_ARTIFACT="$art" KM_LJ_MANIFEST="kosmos-$v-arm64.manifest.json" \
    KM_LJ_SETUP_SHA="$(shasum -a 256 < "$s/setup-staging" | awk '{print $1}')" node "$HERE/tools/lib/write-latest-pointer.js" "$s/dist/latest-staging.json"
  l="$(newsite "e2eadd-$v" "$v")"; cp "$l"/dist/kosmos-"$v"-linux-x64.* "$l/dist/latest-linux-staging.json" "$s/dist/"
  git -C "$s" add -A; git -C "$s" commit -qm "cut $v"
}
S="$(e2esite named 9.9.8)"; C998="$(git -C "$S" rev-parse HEAD)"; e2eaddcut "$S" 9.9.9
git -C "$S" show "$C998:dist/latest-linux-staging.json" > "$T/e2e/ptr-998.json"
chk "e2e named: a --version promote of an earlier cut exits 0" [ "$(e2e "$S" --version 9.9.8)" = "rc=0" ]
chk "e2e named: latest.json names 9.9.8" grep -q '"version": *"9.9.8"' "$S/dist/latest.json"
chk "e2e named: latest-linux.json is the pointer committed with 9.9.8, byte for byte" cmp -s "$T/e2e/ptr-998.json" "$S/dist/latest-linux.json"
chk "e2e named: staging's Linux pointer still names 9.9.9" grep -q '"version":"9.9.9"' "$S/dist/latest-linux-staging.json"

echo "test-promote-linux-7281: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
