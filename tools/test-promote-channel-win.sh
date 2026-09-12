#!/usr/bin/env bash
# test-promote-channel-win.sh - the Windows staging channel's promote side.
#
# Runs the REAL publish-kosmos-windows.sh (prod 1.0.0, then a default-channel = staging 2.0.0),
# the REAL win-staging-verified.sh against records in a temp dir (KOSMOS_WIN_VERIFY_DIR), and the
# REAL promote-channel.sh --family win. Nothing is stubbed: the gate has no command override on
# purpose (it can never be forced or swapped). Asserts:
#   - the gate's 0/1/2 contract (pass / fail or ambiguous / no record);
#   - promote refuses without Josh's go, with a wrong sha or version, with --force, without a
#     record, and on a failed record -- each with prod byte-for-byte untouched;
#   - a promote with the right approval and a passing record copies the staging pointer onto
#     latest-win.json byte for byte, derives the alias kosmos-win-x64.zip from the promoted bytes,
#     and logs the approval (version, sha, time; never a user name).
# The Mac family is pinned by tools/test-staging-channel-2036.sh, which runs unchanged.
#
#   bash tools/test-promote-channel-win.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PUBLISH="$HERE/publish-kosmos-windows.sh"
PROMOTE="$HERE/promote-channel.sh"
GATE="$HERE/win-staging-verified.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/promote-win-test.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
unset KOSMOS_CUT_CHANNEL KOSMOS_WIN_VERIFY_DIR
export KOSMOS_WIN_PROMOTE_LOG="$T/approvals.log"

V_OLD=1.0.0
V=2.0.0
SOURCE_SHA=f120a6e22a94359b073c93aab8cd04ffda975a54

# A "built zip". Any bytes serve: an explicit <version> makes the publish skip the in-zip read.
make_build() { local f; f="$(mktemp "$T/build.XXXXXX")"; printf 'KOSMOS-WIN-BUILD-%s\n' "$1" > "$f"; printf '%s' "$f"; }
jget() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$1" "$2" 2>/dev/null; }

# A site whose prod is 1.0.0 (a prod publish) and whose staging channel holds 2.0.0 (a default
# publish), exactly as the publish script leaves them.
make_site() {
  local s; s="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$s/dist"
  KOSMOS_SITE="$s" KOSMOS_CUT_CHANNEL=prod sh "$PUBLISH" "$(make_build "$V_OLD")" "$V_OLD" >/dev/null 2>&1 || echo "fixture: the prod publish failed" >&2
  KOSMOS_SITE="$s" sh "$PUBLISH" "$(make_build "$V")" "$V" >/dev/null 2>&1 || echo "fixture: the staging publish failed" >&2
  printf '%s' "$s"
}
# write_record <dir> <version> <sha> <result>   (or <dir> - <sha> - <raw json> for a malformed one)
write_record() {
  mkdir -p "$1"
  if [ "$2" = - ]; then printf '%s\n' "$4" > "$1/win-staging-$3.json"; return; fi
  printf '{"version":"%s","sha256":"%s","source_sha":"%s","checks":["V1 sha matches pointer and sidecar","V2 Explorer unpack Z0-Z6","V3 in-app update from staging"],"at":"2026-09-12T16:10:00Z","result":"%s"}\n' \
    "$2" "$3" "$SOURCE_SHA" "$4" > "$1/win-staging-$3.json"
}
# A content fingerprint of the WHOLE dist, dotfiles included (a leaked promote temp file counts).
fingerprint() { ( cd "$1/dist" && for f in .[!.]* *; do [ -f "$f" ] && printf '%s %s\n' "$f" "$(shasum -a 256 "$f" | awk '{print $1}')"; done ); }
promote() {  # <site> <record-dir> [args...] ; sets out, rc
  local s="$1" rd="$2"; shift 2
  out="$(KOSMOS_WIN_VERIFY_DIR="$rd" bash "$PROMOTE" "$s" --family win "$@" 2>&1)"; rc=$?
}

# ---- the gate, directly ------------------------------------------------------------------------
S="$(make_site)"; P="$S/dist/latest-win-staging.json"
SHA="$(jget "$P" sha256)"; OLD_SHA="$(jget "$S/dist/latest-win.json" sha256)"
[ "$(jget "$P" version)" = "$V" ] && [ "${#SHA}" = 64 ] && pass "fixture: the staging pointer names $V" || bad "fixture: the staging pointer is not $V (P=$(cat "$P" 2>&1))"

out="$(KOSMOS_WIN_VERIFY_DIR="$T/rec-none" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 2 ] && has "$out" "HOLD" && pass "gate: no record -> 2 (HOLD)" || bad "gate no-record (rc=$rc, out=$out)"

R="$T/rec-pass"; write_record "$R" "$V" "$SHA" pass
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "PASS" && has "$out" "$SOURCE_SHA" && pass "gate: a passing record for this sha -> 0" || bad "gate pass (rc=$rc, out=$out)"

R="$T/rec-fail"; write_record "$R" "$V" "$SHA" fail
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "FAILED" && pass "gate: a failing record -> 1" || bad "gate fail (rc=$rc, out=$out)"

# A passing record for the OLD build is not a record for this one (one file per sha).
R="$T/rec-stale"; write_record "$R" "$V_OLD" "$OLD_SHA" pass
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 2 ] && pass "gate: a record for a different (older) build -> 2, never read as this one" || bad "gate stale record (rc=$rc, out=$out)"

R="$T/rec-wrongver"; write_record "$R" 9.9.9 "$SHA" pass
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "ambiguous" && pass "gate: a pass record whose version disagrees with the pointer -> 1 (ambiguous)" || bad "gate wrong version (rc=$rc, out=$out)"

R="$T/rec-garbage"; write_record "$R" - "$SHA" '{not json'
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "unreadable" && pass "gate: an unparseable record -> 1" || bad "gate garbage (rc=$rc, out=$out)"

R="$T/rec-nochecks"; write_record "$R" - "$SHA" "{\"version\":\"$V\",\"sha256\":\"$SHA\",\"source_sha\":\"$SOURCE_SHA\",\"checks\":[],\"at\":\"2026-09-12T16:10:00Z\",\"result\":\"pass\"}"
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "no checks" && pass "gate: a pass record listing no checks -> 1" || bad "gate no checks (rc=$rc, out=$out)"

R="$T/rec-maybe"; write_record "$R" "$V" "$SHA" maybe
out="$(KOSMOS_WIN_VERIFY_DIR="$R" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 1 ] && pass "gate: a result other than pass/fail -> 1" || bad "gate unknown result (rc=$rc, out=$out)"

# The default record location: %LOCALAPPDATA%\Kosmos\release-verify when LOCALAPPDATA is set,
# else $HOME/.local/state/kosmos/release-verify.
LAD="$T/localappdata"; write_record "$LAD/Kosmos/release-verify" "$V" "$SHA" pass
out="$(env -u KOSMOS_WIN_VERIFY_DIR LOCALAPPDATA="$LAD" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "gate: finds the record under %LOCALAPPDATA%/Kosmos/release-verify by default" || bad "gate LOCALAPPDATA default (rc=$rc, out=$out)"
FH="$T/home"; write_record "$FH/.local/state/kosmos/release-verify" "$V" "$SHA" pass
out="$(env -u KOSMOS_WIN_VERIFY_DIR -u LOCALAPPDATA HOME="$FH" bash "$GATE" "$P" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "gate: without LOCALAPPDATA it reads \$HOME/.local/state/kosmos/release-verify" || bad "gate HOME default (rc=$rc, out=$out)"

# ---- promote --family win: every refusal leaves prod byte-for-byte untouched -------------------
RPASS="$T/rec-pass"; RFAIL="$T/rec-fail"
S="$(make_site)"; SHA="$(jget "$S/dist/latest-win-staging.json" sha256)"; OLD_SHA="$(jget "$S/dist/latest-win.json" sha256)"
BEFORE="$(fingerprint "$S")"
write_record "$RPASS" "$V" "$SHA" pass    # the fixture builds are deterministic, so the sha repeats
write_record "$RFAIL" "$V" "$SHA" fail

promote "$S" "$RPASS"
[ "$rc" = 1 ] && has "$out" "Josh's go is required" && [ "$(fingerprint "$S")" = "$BEFORE" ] \
  && pass "promote: no approval -> refuses (Josh's go is required), even with a passing record; nothing written" || bad "promote no approval (rc=$rc, out=$out)"
has "$out" "$SHA" && bad "promote: the no-approval refusal printed the sha to paste (the approval must come from Josh, not the script)" || pass "promote: the no-approval refusal does not print a sha to paste"
[ ! -f "$KOSMOS_WIN_PROMOTE_LOG" ] && pass "promote: no approval -> nothing logged as approved" || bad "promote logged an approval that was never given"

promote "$S" "$RPASS" --approved-version "$V" --approved-sha "$OLD_SHA"
[ "$rc" = 1 ] && has "$out" "not the staged build" && [ "$(fingerprint "$S")" = "$BEFORE" ] \
  && pass "promote: an approval naming another build's sha -> refuses; nothing written" || bad "promote wrong sha (rc=$rc, out=$out)"

promote "$S" "$RPASS" --approved-version "$V_OLD" --approved-sha "$SHA"
[ "$rc" = 1 ] && has "$out" "names version $V_OLD" && [ "$(fingerprint "$S")" = "$BEFORE" ] \
  && pass "promote: an approval naming the wrong version -> refuses; nothing written" || bad "promote wrong version (rc=$rc, out=$out)"

promote "$S" "$T/rec-none" --approved-version "$V" --approved-sha "$SHA"
[ "$rc" = 2 ] && has "$out" "HOLDING" && [ "$(fingerprint "$S")" = "$BEFORE" ] \
  && pass "promote: approved but no verification record -> HOLD (2); nothing written" || bad "promote no record (rc=$rc, out=$out)"

promote "$S" "$RFAIL" --approved-version "$V" --approved-sha "$SHA"
[ "$rc" = 1 ] && has "$out" "Windows gate FAILED" && [ "$(fingerprint "$S")" = "$BEFORE" ] \
  && pass "promote: approved but the record says fail -> refuses; nothing written" || bad "promote failed record (rc=$rc, out=$out)"

promote "$S" "$T/rec-none" --approved-version "$V" --approved-sha "$SHA" --force
[ "$rc" = 1 ] && has "$out" "--force is refused" && [ "$(fingerprint "$S")" = "$BEFORE" ] \
  && pass "promote: --force is refused for the Windows family; nothing written" || bad "promote --force (rc=$rc, out=$out)"

# The staging pointer's artifact must be the alias the promote refreshes.
Sa="$(make_site)"; SHA_A="$(jget "$Sa/dist/latest-win-staging.json" sha256)"
node -e 'const f=process.argv[1],fs=require("node:fs");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.artifact="kosmos-other.zip";fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$Sa/dist/latest-win-staging.json"
BEFORE_A="$(fingerprint "$Sa")"
promote "$Sa" "$RPASS" --approved-version "$V" --approved-sha "$SHA_A"
[ "$rc" = 1 ] && has "$out" "is not the alias kosmos-win-x64.zip" && [ "$(fingerprint "$Sa")" = "$BEFORE_A" ] \
  && pass "promote: a staging pointer whose artifact is not the alias -> refuses before any write" || bad "promote non-alias artifact (rc=$rc, out=$out)"

# The same-bytes invariant holds for Windows too: bytes tampered after publish are refused.
St="$(make_site)"; SHA_T="$(jget "$St/dist/latest-win-staging.json" sha256)"
printf 'TAMPERED\n' >> "$St/dist/kosmos-$V-win-x64.zip"
promote "$St" "$RPASS" --approved-version "$V" --approved-sha "$SHA_T"
[ "$rc" = 1 ] && has "$out" "does not verify against its sidecar" && [ "$(jget "$St/dist/latest-win.json" version)" = "$V_OLD" ] \
  && pass "promote: a staged zip tampered after publish -> refuses (verify-in-place), prod stays on $V_OLD" || bad "promote tampered (rc=$rc, out=$out)"

# ---- the successful promote --------------------------------------------------------------------
[ "$(jget "$S/dist/latest-win.json" version)" = "$V_OLD" ] && pass "before promote: prod names $V_OLD" || bad "fixture: prod is not $V_OLD before the promote"
STAGING_BEFORE="$(shasum -a 256 "$S/dist/latest-win-staging.json" | awk '{print $1}')"
promote "$S" "$RPASS" --approved-version "$V" --approved-sha "$SHA"
[ "$rc" = 0 ] && has "$out" "PROMOTED $V to prod - latest-win.json" && pass "promote: approved + passing record -> exit 0" || bad "promote success (rc=$rc, out=$out)"
cmp -s "$S/dist/latest-win-staging.json" "$S/dist/latest-win.json" && pass "promote: latest-win.json is the staging pointer byte for byte" || bad "promote: latest-win.json differs from the staging pointer"
[ "$(shasum -a 256 "$S/dist/latest-win-staging.json" | awk '{print $1}')" = "$STAGING_BEFORE" ] && pass "promote: the staging pointer itself is unchanged" || bad "promote changed the staging pointer"
cmp -s "$S/dist/kosmos-win-x64.zip" "$S/dist/kosmos-$V-win-x64.zip" && pass "promote: the alias kosmos-win-x64.zip now holds the promoted $V bytes" || bad "promote: the alias does not hold the promoted bytes"
( cd "$S/dist" && shasum -a 256 --status -c kosmos-win-x64.zip.sha256 ) && grep -q ' kosmos-win-x64\.zip$' "$S/dist/kosmos-win-x64.zip.sha256" \
  && pass "promote: the alias sidecar verifies in place and names the alias" || bad "promote: the alias sidecar does not verify or names another file"
[ ! -e "$S/dist/latest.json" ] && pass "promote: the Mac pointer latest.json is not touched by a Windows promote" || bad "promote: a Windows promote wrote latest.json"
leftovers="$(ls -a "$S/dist" | grep -c '^\.latest' || true)"
[ "$leftovers" = 0 ] && pass "promote: no temp file left behind (atomic rename)" || bad "promote left $leftovers temp file(s)"
has "$out" "Josh's go recorded" && pass "promote: stdout records that Josh's go was given" || bad "promote: no approval line on stdout"
grep -Eq "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z family=win version=$V sha256=$SHA approval=given\$" "$KOSMOS_WIN_PROMOTE_LOG" 2>/dev/null \
  && pass "promote: the approval is logged with the version, the sha and a UTC time" || bad "promote: approval log line missing or malformed: $(cat "$KOSMOS_WIN_PROMOTE_LOG" 2>&1)"
WHO="$(id -un 2>/dev/null || true)"
if [ -n "$WHO" ] && grep -qi -- "$WHO" "$KOSMOS_WIN_PROMOTE_LOG" 2>/dev/null; then bad "promote: the approval log names a user ($WHO)"; else pass "promote: the approval log never names who typed it"; fi
grep -q "promoted=yes" "$KOSMOS_WIN_PROMOTE_LOG" 2>/dev/null && pass "promote: the log records the promote outcome" || bad "promote: no outcome line in the log"

# ---- argument shape ----------------------------------------------------------------------------
Sm="$(make_site)"
out="$(bash "$PROMOTE" "$Sm" --approved-sha "$SHA" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "for --family win only" && pass "promote: the approval flags are refused for the Mac family" || bad "promote mac + approval (rc=$rc, out=$out)"
out="$(bash "$PROMOTE" "$Sm" --family linux 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "must be 'mac' or 'win'" && pass "promote: an unknown family is refused" || bad "promote unknown family (rc=$rc, out=$out)"
out="$(bash "$PROMOTE" "$Sm" 17999 --family win --approved-version "$V" --approved-sha "$SHA" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "takes no [port]" && pass "promote: a [port] is refused for the Windows family" || bad "promote win + port (rc=$rc, out=$out)"

echo ""
if [ "$fail" = 0 ]; then echo "test-promote-channel-win: ALL PASS"; else echo "test-promote-channel-win: FAILURES above"; exit 1; fi
