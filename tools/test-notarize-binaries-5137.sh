#!/usr/bin/env bash
# Test for tools/lib/notarize-binaries.sh (#5137): the bundle's signed binaries are notarised,
# and the build refuses unless Apple's ticket lists each binary's own cdhash.
# Stubs are shell FUNCTIONS (as in test-cut-sign-preflight.sh), so no fresh executable is exec'd
# and the test runs on any box, CI's Linux included (ditto is stubbed too). Each stub records
# that it ran, so a pass cannot come from a path that never submitted anything.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$REPO/tools/lib/notarize-binaries.sh"

fails=0
passes=0
ok()  { echo "  PASS  $1"; passes=$((passes + 1)); }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unset KOSMOS_NOTARIZE KOSMOS_NOTARY_KEY_ID KOSMOS_NOTARY_ISSUER KOSMOS_NOTARY_PROBE_BIN NT_HISTORY NT_TAIL NT_FIRST_WAIT NT_RAWLOG NT_NOID_TIMES NT_LOG_FAIL NT_LOG_FAIL_TIMES NT_LOG_EMPTY_TIMES NT_ISSUE_HASH NT_MESSAGE   # an operator's export must not change the arms

HA=1111111111111111111111111111111111111111
HT=2222222222222222222222222222222222222222
mkdir -p "$WORK/bin"
printf 'app\n' > "$WORK/bin/kosmos-app"
printf 'tunnel\n' > "$WORK/bin/kosmos-tunnel"
printf 'unsigned\n' > "$WORK/bin/unsigned"
printf 'text\n' > "$WORK/bin/notmacho"
printf 'key\n' > "$WORK/notary.p8"

HX=4444444444444444444444444444444444444444
# lipo -archs: the tunnel is universal (as the real one is), the app is arm64 only.
lipo_stub() {
  case "$2" in
    *.app|*.app/) echo "lipo: can't map input file: $2 (Is a directory)" >&2; return 1 ;;
    */Contents/MacOS/Kosmos) echo "${LIPO_APP:-arm64}" ;;
    */kosmos-tunnel) echo "x86_64 arm64" ;;
    */notmacho) echo "lipo: can't figure out the architecture type of: $2" >&2; return 1 ;;
    *) echo arm64 ;;
  esac
}
# codesign -dvvv --arch <a> <file>: a cdhash per slice, none for the unsigned file.
# Real codesign prints to stderr.
cs_stub() {
  [ "$1" = -dvvv ] && [ "$2" = --arch ] || { echo "stub: wanted -dvvv --arch, got '$*'" >&2; return 2; }
  case "$4:$3" in
    */kosmos-app:arm64) echo "CDHash=$HA" >&2 ;;
    */kosmos-tunnel:arm64) echo "CDHash=$HT" >&2 ;;
    */kosmos-tunnel:x86_64) echo "CDHash=$HX" >&2 ;;
    *) echo "$4: code object is not signed at all" >&2; return 1 ;;
  esac
}
ditto() { echo "$*" >> "$WORK/ditto.ran"; [ -f "$4/Kosmos.app/Contents/MacOS/Kosmos" ] && echo bundle >> "$WORK/ditto.ran"; : > "${!#}"; }
sm_ok()   { [ "$1" = path ] && [ "$2" = "$KOSMOS_NOTARY_SECRET_TARGET" ] && echo "$WORK/notary.p8"; }
sm_none() { echo "secrets-map: no credential for target" >&2; return 1; }

# notarytool: submit answers with an id only (as the real one does without --wait); `wait` answers
# NT_STATUS, or NT_FIRST_WAIT for its first call. NT_HASHES for the log's ticketContents, NT_ISSUE_HASH for a
# hash named only in issues[]. NT_NOID_TIMES makes the first N submits come back with no id.
# NT_LOG_FAIL=1 makes `log` fail. The log is pretty-printed over several lines, as Apple's is.
nt_stub() {
  echo "$1" >> "$WORK/nt.ran"
  case "$1" in
    submit) printf '%s\n' "$*" > "$WORK/submit.argv"
            if [ "$(grep -c '^submit$' "$WORK/nt.ran")" -le "${NT_NOID_TIMES:-0}" ]; then
              echo "Error: HTTP status code: 503. Service Unavailable" >&2; return 1; fi
            echo "{\"id\":\"sub-1\",\"message\":\"Successfully uploaded file\"${NT_TAIL:-}}" ;;
    wait)   printf '%s\n' "$*" > "$WORK/wait.argv"
            if [ -n "${NT_FIRST_WAIT:-}" ] && [ "$(grep -c '^wait$' "$WORK/nt.ran")" = 1 ]; then
              echo "{\"status\":\"$NT_FIRST_WAIT\",\"id\":\"$2\"}"
            else echo "{\"status\":\"$NT_STATUS\",\"id\":\"$2\",\"message\":\"${NT_MESSAGE:-Processing complete}\"}"; fi ;;
    history) if [ -n "${NT_HISTORY:-}" ]; then echo "$NT_HISTORY"
             else echo '{"message":"Successfully received submission history.","history":[{"id":"x","status":"Accepted"}]}'; fi ;;
    log)    [ "${NT_LOG_FAIL:-0}" = 1 ] && { echo "Error: log unavailable" >&2; return 1; }
            [ "$(grep -c '^log$' "$WORK/nt.ran")" -le "${NT_LOG_FAIL_TIMES:-0}" ] && { echo "Error: connection reset" >&2; return 1; }
            [ "$(grep -c '^log$' "$WORK/nt.ran")" -le "${NT_LOG_EMPTY_TIMES:-0}" ] && { echo "<html>502 Bad Gateway</html>"; return 0; }
            [ -n "${NT_RAWLOG:-}" ] && { printf '%s\n' "$NT_RAWLOG"; return 0; }
            printf '{\n  "jobId": "sub-1",\n  "status": "%s",\n  "ticketContents": [\n' "$NT_STATUS"
            local h sep=""; for h in $NT_HASHES; do printf '%s    {\n      "cdhash": "%s"\n    }' "$sep" "$h"; sep=$',\n'; done
            printf '\n  ],\n  "issues": [%s]\n}\n' "${NT_ISSUE_HASH:+{\"cdhash\": \"$NT_ISSUE_HASH\"\}}" ;;
  esac
}
export KOSMOS_NOTARY_CODESIGN_CMD=cs_stub KOSMOS_NOTARYTOOL_CMD=nt_stub KOSMOS_SECRETS_MAP_BIN=sm_ok KOSMOS_NOTARY_LIPO_CMD=lipo_stub
export KOSMOS_NOTARY_RETRY_DELAYS="0 0"

run() { rm -f "$WORK/nt.ran" "$WORK/ditto.ran" "$WORK/submit.argv" "$WORK/wait.argv"; notarize_binaries "$@" > "$WORK/out" 2>&1; echo $?; }
# grep -c prints 0 AND exits 1 on no match, so a `|| echo 0` fallback would print a second 0.
ran() { local n; n="$(grep -c "^$1\$" "$WORK/nt.ran" 2>/dev/null)"; echo "${n:-0}"; }

# --- Accepted, and the ticket lists both cdhashes: passes, having really submitted ---
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX"; rc=$(run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel")
[ "$rc" = 0 ] && ok "accepted + both cdhashes ticketed passes" || bad "should pass (rc=$rc): $(cat "$WORK/out")"
[ "$(ran submit)" = 1 ] && ok "the pass came from a real submit" || bad "submit ran $(ran submit) times"
[ "$(grep -c '^==> notarised: ' "$WORK/out")" = 3 ] && ok "all three slices reported notarised (the tunnel is universal)" || bad "notarised lines: $(cat "$WORK/out")"
grep -q -- "--key $WORK/notary.p8 --key-id $KOSMOS_NOTARY_KEY_ID_DEFAULT --issuer $KOSMOS_NOTARY_ISSUER_DEFAULT --output-format json" "$WORK/submit.argv" \
  && ! grep -q -- '--wait' "$WORK/submit.argv" \
  && grep -q -- "^wait sub-1 --key $WORK/notary.p8 --key-id $KOSMOS_NOTARY_KEY_ID_DEFAULT --issuer $KOSMOS_NOTARY_ISSUER_DEFAULT --timeout 30m --output-format json" "$WORK/wait.argv" \
  && grep -q '^==> submitted: sub-1' "$WORK/out" \
  && ok "submit has no --wait, the id is printed before waiting, and the wait carries the credentials and its timeout" || bad "argv: submit=$(cat "$WORK/submit.argv" 2>/dev/null) wait=$(cat "$WORK/wait.argv" 2>/dev/null)"
[ -s "$WORK/ditto.ran" ] && ok "the binaries were zipped" || bad "ditto never ran"

# --- Accepted, but the ticket covers other bytes: refuses and names the one missing ---
NT_STATUS=Accepted NT_HASHES="$HA $HX 3333333333333333333333333333333333333333"; rc=$(run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel")
[ "$rc" = 1 ] && ok "a ticket missing a binary's cdhash refuses" || bad "should refuse (rc=$rc): $(cat "$WORK/out")"
grep -q "kosmos-tunnel/arm64($HT)" "$WORK/out" && ok "it names the binary the ticket does not cover" || bad "no name: $(cat "$WORK/out")"
grep -q "kosmos-app/arm64($HA)" "$WORK/out" && bad "it blamed the covered binary too" || ok "it does not blame the covered binary"

# --- Invalid: refuses, and prints Apple's log ---
NT_STATUS=Invalid NT_HASHES=""; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && ok "an Invalid submission refuses" || bad "Invalid should refuse (rc=$rc)"
[ "$(ran log)" = 1 ] && ok "it fetched Apple's log to show why" || bad "log ran $(ran log) times"
grep -q "status 'Invalid'" "$WORK/out" && ok "it says which status came back" || bad "status not named: $(cat "$WORK/out")"

# --- the word Accepted elsewhere in the answer is not acceptance ---
NT_STATUS=Invalid NT_MESSAGE="Accepted by nobody" NT_HASHES="$HA"; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && ok "\"Accepted\" in the message does not pass an Invalid status" || bad "a message mentioning Accepted passed (rc=$rc)"
unset NT_MESSAGE

# --- no key: refuses before submitting ---
NT_STATUS=Accepted NT_HASHES="$HA"; rc=$(KOSMOS_SECRETS_MAP_BIN=sm_none run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && ok "no notary key refuses" || bad "no key should refuse (rc=$rc)"
[ "$(ran submit)" = 0 ] && ok "nothing was submitted without a key" || bad "submitted without a key"
grep -q 'KOSMOS_NOTARIZE=0' "$WORK/out" && ok "it names the test-build opt-out" || bad "no opt-out named: $(cat "$WORK/out")"

# --- an unsigned binary: refuses before submitting ---
rc=$(run "$WORK/bin/kosmos-app" "$WORK/bin/unsigned")
[ "$rc" = 1 ] && ok "an unsigned binary refuses" || bad "unsigned should refuse (rc=$rc)"
[ "$(ran submit)" = 0 ] && ok "nothing was submitted for an unsigned binary" || bad "submitted an unsigned binary"

# --- KOSMOS_NOTARIZE=0: skips, loudly, and submits nothing ---
rc=$(KOSMOS_NOTARIZE=0 run "$WORK/bin/kosmos-app")
[ "$rc" = 0 ] && ok "KOSMOS_NOTARIZE=0 skips" || bad "the opt-out failed (rc=$rc)"
grep -q 'NOT NOTARISED' "$WORK/out" && ok "the skip says so" || bad "a silent skip: $(cat "$WORK/out")"
[ "$(ran submit)" = 0 ] && ok "the skip submitted nothing" || bad "the skip submitted"

# --- a universal binary: the slice that is NOT the host's is checked too ---
NT_STATUS=Accepted NT_HASHES="$HA $HT"; rc=$(run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel")
[ "$rc" = 1 ] && grep -q "kosmos-tunnel/x86_64($HX)" "$WORK/out" && ok "a ticket missing the x86_64 slice refuses and names it" || bad "x86_64 slice unchecked (rc=$rc): $(cat "$WORK/out")"

# --- a hash named only in issues[] is not a ticket ---
NT_STATUS=Accepted NT_HASHES="$HA" NT_ISSUE_HASH="$HT"; rc=$(run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel")
[ "$rc" = 1 ] && grep -q "kosmos-tunnel/arm64($HT)" "$WORK/out" && ok "a cdhash only in issues[] does not count as ticketed" || bad "issues[] counted as a ticket (rc=$rc): $(cat "$WORK/out")"
unset NT_ISSUE_HASH

# --- no submission id (a 503): tried again, and the second try's answer stands ---
NT_STATUS=Accepted NT_HASHES="$HA" NT_NOID_TIMES=1; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 0 ] && [ "$(ran submit)" = 2 ] && ok "a submit with no id is tried again, and passes on the retry" || bad "retry (rc=$rc, submits=$(ran submit)): $(cat "$WORK/out")"
NT_STATUS=Accepted NT_HASHES="$HA" NT_NOID_TIMES=9; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && [ "$(ran submit)" = 3 ] && ok "three submits with no id refuse, after exactly three tries" || bad "exhausted retry (rc=$rc, submits=$(ran submit))"
unset NT_NOID_TIMES

# --- an answer with an id is never resubmitted ---
NT_STATUS=Invalid NT_HASHES=""; rc=$(run "$WORK/bin/kosmos-app")
[ "$(ran submit)" = 1 ] && ok "an Invalid answer is not resubmitted" || bad "an Invalid answer was resubmitted $(ran submit) times"

# --- the log cannot be fetched after Accepted: refuses ---
NT_STATUS=Accepted NT_HASHES="$HA" NT_LOG_FAIL=1; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && grep -q 'could not fetch' "$WORK/out" && ok "an unfetchable log refuses" || bad "log failure passed (rc=$rc)"
unset NT_LOG_FAIL
NT_STATUS=Accepted NT_HASHES="$HA" NT_LOG_FAIL_TIMES=1; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 0 ] && [ "$(ran log)" = 2 ] && ok "a log fetch that fails once is tried again and passes" || bad "log retry (rc=$rc, log=$(ran log)): $(cat "$WORK/out")"
unset NT_LOG_FAIL_TIMES
NT_STATUS=Accepted NT_HASHES="$HA" NT_LOG_EMPTY_TIMES=1; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 0 ] && [ "$(ran log)" = 2 ] && ok "a log that exits 0 with no ticketContents is fetched again and passes" || bad "exit-0 log retry (rc=$rc, log=$(ran log)): $(cat "$WORK/out")"
unset NT_LOG_EMPTY_TIMES

# --- a missing binary and a non-Mach-O file refuse before submitting ---
rc=$(run "$WORK/bin/no-such-binary"); [ "$rc" = 1 ] && [ "$(ran submit)" = 0 ] && ok "a missing binary refuses before submitting" || bad "missing binary (rc=$rc)"
rc=$(run "$WORK/bin/notmacho"); [ "$rc" = 1 ] && [ "$(ran submit)" = 0 ] && ok "a non-Mach-O file refuses before submitting" || bad "non-Mach-O (rc=$rc)"

# --- no scratch copies are left behind ---
mkdir -p "$WORK/tmp"   # its own TMPDIR, so another notarisation on the box cannot move the count
NT_STATUS=Invalid NT_HASHES=""; rc=$(TMPDIR="$WORK/tmp" run "$WORK/bin/kosmos-app")
left="$(find "$WORK/tmp" -name 'kosmos-notarize.*' 2>/dev/null | wc -l | tr -d ' ')"
NT_STATUS=Accepted NT_HASHES="$HA"; rc2=$(TMPDIR="$WORK/tmp" run "$WORK/bin/kosmos-app")
left2="$(find "$WORK/tmp" -name 'kosmos-notarize.*' 2>/dev/null | wc -l | tr -d ' ')"
[ "$rc" = 1 ] && [ "$rc2" = 0 ] && [ "$left" = 0 ] && [ "$left2" = 0 ] && ok "the scratch copy is removed on a refusal and on a pass" || bad "scratch left: refusal rc=$rc left=$left, pass rc=$rc2 left=$left2"

# --- release.sh refuses to cut with the opt-out or a seam exported, before step 4 builds ---
R="$REPO/tools/release.sh"
guard="$(grep -n '^for _nv in KOSMOS_NOTARIZE KOSMOS_NOTARYTOOL_CMD KOSMOS_NOTARY_CODESIGN_CMD KOSMOS_NOTARY_LIPO_CMD KOSMOS_NOTARY_RETRY_DELAYS KOSMOS_STAPLER_CMD KOSMOS_STAPLER_RETRY_DELAYS KOSMOS_NOTARY_SPCTL_CMD KOSMOS_NOTARY_XATTR_CMD; do$' "$R" | head -1 | cut -d: -f1)"
build="$(grep -n 'bash tools/build-kosmos-bundle.sh dist' "$R" | head -1 | cut -d: -f1)"
[ -n "$guard" ] && [ -n "$build" ] && [ "$guard" -lt "$build" ] && ok "release.sh refuses the opt-out and every seam before step 4 ($guard < $build)" || bad "release.sh guard missing or after the build (guard=$guard build=$build)"
GUARD_SRC="$(sed -n "${guard},\$p" "$R" | sed '/^done$/q')"
case "$GUARD_SRC" in *done) ok "the guard loop was extracted whole, through its done" ;; *) bad "the guard loop has no done line to extract through" ;; esac
out="$(KOSMOS_NOTARIZE=0 bash -c "$GUARD_SRC" 2>&1)"; rc=$?
[ "$rc" = 1 ] && case "$out" in *"KOSMOS_NOTARIZE is set"*) true ;; *) false ;; esac && ok "the release.sh guard really refuses an exported KOSMOS_NOTARIZE" || bad "guard did not refuse (rc=$rc): $out"
out="$(env -u KOSMOS_NOTARIZE -u KOSMOS_NOTARY_CODESIGN_CMD -u KOSMOS_NOTARY_LIPO_CMD -u KOSMOS_NOTARY_RETRY_DELAYS KOSMOS_NOTARYTOOL_CMD= bash -c "$GUARD_SRC" 2>&1)"; rc=$?
[ "$rc" = 1 ] && case "$out" in *"KOSMOS_NOTARYTOOL_CMD is set"*) true ;; *) false ;; esac && ok "the guard refuses a seam exported EMPTY" || bad "an empty seam passed the guard (rc=$rc): $out"
out="$(env -u KOSMOS_NOTARIZE -u KOSMOS_NOTARYTOOL_CMD -u KOSMOS_NOTARY_CODESIGN_CMD -u KOSMOS_NOTARY_LIPO_CMD -u KOSMOS_NOTARY_RETRY_DELAYS bash -c "$GUARD_SRC" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "the guard passes a clean environment (control)" || bad "guard refused a clean env (rc=$rc): $out"

# --- the submission id is the FIRST one in the answer, not a later nested one ---
NT_STATUS=Accepted NT_HASHES="$HA" NT_TAIL=',"extra":{"id":"other-job"}'; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 0 ] && grep -q 'submission sub-1)' "$WORK/out" && ok "a later nested id does not replace the submission id" || bad "id parse (rc=$rc): $(cat "$WORK/out")"
unset NT_TAIL

# --- an id whose status is not final is waited on, not refused and not resubmitted ---
NT_FIRST_WAIT="In Progress" NT_STATUS=Accepted NT_HASHES="$HA"; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 0 ] && [ "$(ran wait)" = 2 ] && [ "$(ran submit)" = 1 ] && ok "an unfinished submission is waited on once more and then passes" || bad "in-progress wait (rc=$rc, wait=$(ran wait), submit=$(ran submit)): $(cat "$WORK/out")"
NT_FIRST_WAIT="In Progress" NT_STATUS="In Progress" NT_HASHES="$HA"; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && [ "$(ran log)" = 0 ] && ok "still unfinished after the wait refuses, without fetching a log that cannot exist yet" || bad "unfinished refusal (rc=$rc, log=$(ran log))"
unset NT_FIRST_WAIT   # VAR=x rc=$(...) is a plain assignment, so it persists into later arms
NT_STATUS=Invalid NT_HASHES=""; rc=$(run "$WORK/bin/kosmos-app")
[ "$(ran wait)" = 1 ] && ok "a final status is waited on only once" || bad "waited $(ran wait) times on a final status"

# --- a log whose ticketContents cannot be read is a parse failure, not "other bytes" ---
NT_STATUS=Accepted NT_HASHES="$HA" NT_RAWLOG='{"status":"Accepted","ticketContents":[]}'; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && grep -q 'could not read any cdhash from ticketContents' "$WORK/out" && ok "a ticket with no cdhash in it refuses as a parse failure" || bad "ticket parse (rc=$rc): $(cat "$WORK/out")"
unset NT_RAWLOG

# --- a nested array in a ticket entry cuts the read short, and that refuses, never passes ---
NT_STATUS=Accepted NT_HASHES="" NT_RAWLOG="{\"ticketContents\":[{\"cdhash\":\"$HA\",\"x\":[1]},{\"cdhash\":\"$HT\"},{\"cdhash\":\"$HX\"}]}"; rc=$(run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel")
[ "$rc" = 1 ] && ok "a nested array in the ticket refuses (fails closed)" || bad "nested array passed (rc=$rc)"
# --- the hash must be the value of a cdhash key, not any value in the ticket ---
NT_STATUS=Accepted NT_HASHES="" NT_RAWLOG="{\"ticketContents\":[{\"cdhash\":\"$HT\",\"other\":\"$HA\"}]}"; rc=$(run "$WORK/bin/kosmos-app")
[ "$rc" = 1 ] && ok "a hash that is not under a cdhash key does not count" || bad "a non-cdhash value counted (rc=$rc)"
unset NT_RAWLOG

# --- an EMPTY retry list means one try, and survives set -u (an empty array under bash 3.2) ---
NT_STATUS=Accepted NT_HASHES="$HA" NT_NOID_TIMES=9; rc=$( (set -u; KOSMOS_NOTARY_RETRY_DELAYS="" run "$WORK/bin/kosmos-app") )
[ "$rc" = 1 ] && [ "$(ran submit)" = 1 ] && grep -q 'no submission id after 1 tries' "$WORK/out" && ok "an empty retry list makes exactly one try under set -u" || bad "empty retry list (rc=$rc, submits=$(ran submit)): $(cat "$WORK/out")"
unset NT_NOID_TIMES

# --- called bare under set -euo pipefail (no ||), a refusal still says why ---
out="$( (set -euo pipefail; notarize_binaries "$WORK/bin/unsigned") 2>&1)"; rc=$?
[ "$rc" = 1 ] && case "$out" in *"could not read"*) true ;; *) false ;; esac && ok "a bare call under set -euo pipefail still prints why it refused" || bad "bare call (rc=$rc): $out"
out="$( (set -euo pipefail; notarize_binaries "$WORK/bin/notmacho") 2>&1)"; rc=$?
[ "$rc" = 1 ] && case "$out" in *"could not read the architectures"*) true ;; *) false ;; esac && ok "a bare call on a non-Mach-O file still prints why it refused" || bad "bare non-Mach-O (rc=$rc): $out"

# --- step 1c's probe: Apple's answer decides, not notarytool's exit status ---
out="$(notarize_probe_credentials 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(ran history)" -ge 1 ] && ok "the probe passes on an answer carrying history" || bad "probe pass (rc=$rc): $out"
out="$(NT_HISTORY='Error: invalidPEMDocument' notarize_probe_credentials 2>&1)"; rc=$?
[ "$rc" = 1 ] && case "$out" in *invalidPEMDocument*) true ;; *) false ;; esac && ok "the probe refuses an error answer, even with exit 0, and shows it" || bad "probe error (rc=$rc): $out"
out="$(NT_HISTORY='{"error":"unauthorized","resource":"history"}' notarize_probe_credentials 2>&1)"; rc=$?
[ "$rc" = 1 ] && ok "an error that merely mentions history does not pass the probe" || bad "a history-mentioning error passed the probe (rc=$rc): $out"
out="$(KOSMOS_SECRETS_MAP_BIN=sm_none notarize_probe_credentials 2>&1)"; rc=$?
[ "$rc" = 1 ] && ok "the probe refuses with no key" || bad "probe no key (rc=$rc)"
out="$(KOSMOS_NOTARY_PROBE_BIN=true notarize_probe_credentials 2>&1)"; rc=$?
[ "$rc" = 0 ] && case "$out" in *"NOT notarytool: the key was not probed"*) true ;; *) false ;; esac && ok "the probe seam passes and says nothing was probed" || bad "probe seam (rc=$rc): $out"
out="$(KOSMOS_NOTARY_PROBE_BIN=false notarize_probe_credentials 2>&1)"; rc=$?
[ "$rc" = 1 ] && ok "a failing probe seam refuses" || bad "failing probe seam passed"
probe="$(grep -n '^notarize_probe_credentials || exit 1$' "$REPO/tools/release.sh" | head -1 | cut -d: -f1)"
[ -n "$probe" ] && [ -n "$guard" ] && [ "$probe" -gt "$guard" ] && [ "$probe" -lt "$build" ] && ok "release.sh probes the notary key after the guard and before step 4 ($guard < $probe < $build)" || bad "probe call missing or misplaced (guard=$guard probe=$probe build=$build)"
# Every non-comment line that names the probe seam must sit inside notarize_probe_credentials, so
# no helper notarize_binaries calls can read it either.
_lib="$REPO/tools/lib/notarize-binaries.sh"
_all="$(grep -v '^[[:space:]]*#' "$_lib" | grep -c 'KOSMOS_NOTARY_PROBE_BIN')"
_inprobe="$(sed -n '/^notarize_probe_credentials() (/,/^)$/p' "$_lib" | grep -v '^[[:space:]]*#' | grep -c 'KOSMOS_NOTARY_PROBE_BIN')"
[ "$_all" -gt 0 ] && [ "$_all" = "$_inprobe" ] && ok "only notarize_probe_credentials reads the probe seam ($_inprobe lines)" || bad "the probe seam is read outside the probe ($_all lines in all, $_inprobe in the probe)"
# The build checks the key before it stages anything, so a keyless build fails in seconds.
_B="$REPO/tools/build-kosmos-bundle.sh"
_early="$(grep -n '_notarize_key >/dev/null ||' "$_B" | head -1 | cut -d: -f1)"
_stage="$(grep -n '^echo "==> staging the app"' "$_B" | head -1 | cut -d: -f1)"
[ -n "$_early" ] && [ -n "$_stage" ] && [ "$_early" -lt "$_stage" ] && ok "the build checks the notary key before staging ($_early < $_stage)" || bad "no early key check before staging (key=$_early stage=$_stage)"

# --- #5896 slice 3: the sealed Kosmos.app is submitted whole, stapled, validated, and a QUARANTINED copy assessed ---
HK=5555555555555555555555555555555555555555
APP="$WORK/apps/Kosmos.app"
mkdir -p "$APP/Contents/MacOS"
printf 'kosmos\n' > "$APP/Contents/MacOS/Kosmos"
# The shape setup.sh's heredoc really has (the build copies it): key and string on ONE line. A split layout is checked below.
printf '<plist version="1.0"><dict>\n  <key>CFBundleName</key><string>Kosmos</string>\n  <key>CFBundleExecutable</key><string>Kosmos</string>\n</dict></plist>\n' > "$APP/Contents/Info.plist"
HKX=6666666666666666666666666666666666666666
cs_app_stub() { if [ "$4" = "$APP" ] && [ "$3" = arm64 ]; then echo "CDHash=$HK" >&2
  elif [ "$4" = "$APP" ] && [ "$3" = x86_64 ]; then echo "CDHash=$HKX" >&2; else cs_stub "$@"; fi; }
# stapler: ST_STAPLE_FAIL_TIMES makes the first N staples fail; ST_VALIDATE=fail fails validate.
st_stub() {
  echo "$1 $2" >> "$WORK/st.ran"
  case "$1" in
    staple) [ "$(grep -c '^staple ' "$WORK/st.ran")" -le "${ST_STAPLE_FAIL_TIMES:-0}" ] && { echo "Could not validate ticket" >&2; return 65; }
            echo "The staple and validate action worked!" ;;
    validate) [ "${ST_VALIDATE:-ok}" = fail ] && { echo "does not have a ticket stapled to it" >&2; return 65; }
              echo "The validate action worked!" ;;
  esac
}
# spctl: SP_OUT is what it says, SP_RC its exit. It records the path, so the arm can prove it assessed the COPY.
sp_stub() { echo "${!#}" >> "$WORK/sp.ran"; echo "${!#}: ${SP_OUT:-accepted}"; echo "source=${SP_SOURCE:-Notarized Developer ID}"
  echo "origin=${SP_ORIGIN:-Developer ID Application: Stone Syndicate LLC (864QZ69GF2)}"; return "${SP_RC:-0}"; }
xa_stub() { echo "$*" >> "$WORK/xa.ran"; [ "${XA_FAIL:-0}" = 1 ] && return 1; return 0; }
runapp() { rm -f "$WORK/st.ran" "$WORK/sp.ran" "$WORK/xa.ran"; run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel" "$APP"; }
export KOSMOS_STAPLER_CMD=st_stub KOSMOS_NOTARY_SPCTL_CMD=sp_stub KOSMOS_NOTARY_XATTR_CMD=xa_stub KOSMOS_STAPLER_RETRY_DELAYS="0 0"
_cs_saved="$KOSMOS_NOTARY_CODESIGN_CMD"; export KOSMOS_NOTARY_CODESIGN_CMD=cs_app_stub

unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK"; rc=$(runapp)
[ "$rc" = 0 ] && ok "app: accepted, stapled, validated, quarantined copy accepted: passes" || bad "app should pass (rc=$rc): $(cat "$WORK/out")"
grep -q '^bundle$' "$WORK/ditto.ran" 2>/dev/null && ok "app: the submitted zip holds the bundle itself" || bad "the bundle was not in what was zipped: $(cat "$WORK/ditto.ran" 2>/dev/null)"
grep -qx "staple $APP" "$WORK/st.ran" 2>/dev/null && grep -qx "validate $APP" "$WORK/st.ran" && ok "app: the ORIGINAL bundle was stapled and validated" || bad "staple/validate did not run on the app: $(cat "$WORK/st.ran" 2>/dev/null)"
_q="$(cat "$WORK/sp.ran" 2>/dev/null)"
[ -n "$_q" ] && [ "$_q" != "$APP" ] && grep -q "com.apple.quarantine .*$_q\$" "$WORK/xa.ran" && ok "app: a COPY was quarantined and that copy assessed, not the shipped bundle" || bad "the assessment was not on a quarantined copy: sp=$_q xa=$(cat "$WORK/xa.ran" 2>/dev/null)"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX"; rc=$(runapp)
[ "$rc" = 1 ] && ok "app: a ticket without the app's cdhash refuses" || bad "a ticket missing the app passed"
[ ! -s "$WORK/st.ran" ] && ok "app: nothing is stapled when the ticket does not cover the app" || bad "stapled a bundle the ticket does not cover"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" ST_STAPLE_FAIL_TIMES=1; rc=$(runapp)
[ "$rc" = 0 ] && [ "$(grep -c '^staple ' "$WORK/st.ran")" = 2 ] && ok "app: a staple that lags acceptance is tried again" || bad "a lagging staple was not retried (rc=$rc)"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" ST_STAPLE_FAIL_TIMES=9; rc=$(runapp)
[ "$rc" = 1 ] && grep -q 'could not staple' "$WORK/out" && ok "app: a staple that never works refuses" || bad "an unstapled app passed (rc=$rc)"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" ST_VALIDATE=fail; rc=$(runapp)
[ "$rc" = 1 ] && ok "app: a staple that does not validate refuses" || bad "an invalid staple passed"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" SP_RC=3 SP_OUT=rejected SP_SOURCE="Unnotarized Developer ID"; rc=$(runapp)
[ "$rc" = 1 ] && grep -q 'told it is damaged' "$WORK/out" && ok "app: a quarantined copy Gatekeeper rejects refuses the build" || bad "a rejected quarantined copy passed (rc=$rc)"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" SP_SOURCE="Developer ID"; rc=$(runapp)
[ "$rc" = 1 ] && ok "app: accepted but not as Notarized Developer ID refuses" || bad "a non-notarised acceptance passed"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" XA_FAIL=1; rc=$(runapp)
[ "$rc" = 1 ] && ok "app: a copy that could not be quarantined refuses (an unquarantined pass proves nothing)" || bad "assessed without quarantine"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK $HKX" LIPO_APP="x86_64 arm64"; rc=$(runapp)
[ "$rc" = 0 ] && ok "app: a universal app with both slices ticketed passes" || bad "universal app refused (rc=$rc): $(cat "$WORK/out")"
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK"; rc=$(runapp)
[ "$rc" = 1 ] && grep -q "Kosmos.app/x86_64($HKX)" "$WORK/out" && ok "app: a universal app missing one slice's cdhash refuses, naming it" || bad "a missing x86_64 slice passed (rc=$rc)"
unset LIPO_APP
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" SP_ORIGIN="Developer ID Application: Someone Else (ABCDE12345)"; rc=$(runapp)
[ "$rc" = 1 ] && ok "app: notarised under ANOTHER team refuses" || bad "another team's notarisation passed"
unset SP_ORIGIN
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" SP_SOURCE="Unnotarized Developer ID" SP_OUT="accepted source=Notarized Developer ID"; rc=$(runapp)
[ "$rc" = 1 ] && ok "app: the words appearing inside another line (the echoed path) do not pass" || bad "a substring of the first line passed"
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK" ST_STAPLE_FAIL_TIMES=9; rc=$(runapp)
grep -q 'Apple accepted submission sub-1' "$WORK/out" && ok "app: a staple that never works names the accepted submission for a by-hand staple" || bad "the staple failure did not name the submission: $(cat "$WORK/out")"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES SP_SOURCE SP_OUT
NT_STATUS=Accepted NT_HASHES="$HA $HT $HX $HK"; rc=$(rm -f "$WORK/st.ran" "$WORK/sp.ran" "$WORK/xa.ran"; run "$WORK/bin/kosmos-app" "$WORK/bin/kosmos-tunnel" "$APP/")
[ "$rc" = 0 ] && grep -qx "staple $APP" "$WORK/st.ran" && ok "app: a trailing slash on the bundle is the same bundle" || bad "trailing slash (rc=$rc): $(cat "$WORK/out")"
cp "$APP/Contents/Info.plist" "$WORK/plist.oneline"
printf '<plist><dict>\n<key>CFBundleExecutable</key>\n<string>Kosmos</string>\n</dict></plist>\n' > "$APP/Contents/Info.plist"
rc=$(runapp)
[ "$rc" = 0 ] && ok "app: a plist with the key and string on separate lines is read too" || bad "split-layout plist refused (rc=$rc): $(cat "$WORK/out")"
cp "$WORK/plist.oneline" "$APP/Contents/Info.plist"
_real="$(awk '/cat > "\$target\/Info.plist" <<PLIST/ { f = 1; next } f && /^PLIST$/ { exit } f' "$REPO/install/setup.sh" | grep -c '<key>CFBundleExecutable</key><string>')"
[ "$_real" = 1 ] && ok "app: the fixture's one-line layout is setup.sh's real one (the plist the build copies)" || bad "setup.sh's Info.plist no longer has CFBundleExecutable on one line ($_real); re-check the fixture"
rm -f "$APP/Contents/Info.plist"; rc=$(runapp)
[ "$rc" = 1 ] && grep -q 'main executable' "$WORK/out" && ok "app: a bundle with no readable main executable refuses before submitting" || bad "an app with no executable passed (rc=$rc)"
[ "$(ran submit)" = 0 ] && ok "app: and nothing was submitted for it" || bad "submitted an app with no executable"
unset NT_STATUS NT_HASHES ST_STAPLE_FAIL_TIMES ST_VALIDATE SP_RC SP_OUT SP_SOURCE XA_FAIL   # plain assignments persist (see above)
export KOSMOS_NOTARY_CODESIGN_CMD="$_cs_saved"
unset KOSMOS_STAPLER_CMD KOSMOS_NOTARY_SPCTL_CMD KOSMOS_NOTARY_XATTR_CMD KOSMOS_STAPLER_RETRY_DELAYS

# --- the build calls it, on both binaries, after the last self-test and before packing ---
B="$REPO/tools/build-kosmos-bundle.sh"
call="$(grep -n '^notarize_binaries "\$STAGE/app/bin/kosmos-app" "\$STAGE/app/bin/kosmos-tunnel" "\$STAGE/app/Kosmos.app" ||' "$B" | head -1 | cut -d: -f1)"
[ -n "$call" ] && ok "build-kosmos-bundle.sh notarises both binaries and the sealed Kosmos.app (#5896), failing the build on refusal" || bad "build-kosmos-bundle.sh does not call notarize_binaries on both binaries and Kosmos.app with ||"
sealed_sign="$(grep -n '^codesign_ts_retry .*"\$_sealed"' "$B" | head -1 | cut -d: -f1)"
[ -n "$call" ] && [ -n "$sealed_sign" ] && [ "$call" -gt "$sealed_sign" ] && ok "the app is notarised after it is sealed ($sealed_sign < $call)" || bad "the app is not notarised after sealing (seal=$sealed_sign notarise=$call)"
for _seam in KOSMOS_STAPLER_CMD KOSMOS_STAPLER_RETRY_DELAYS KOSMOS_NOTARY_SPCTL_CMD KOSMOS_NOTARY_XATTR_CMD; do
  grep -qE "^for _nv in .*\b$_seam\b" "$REPO/tools/release.sh" && ok "release.sh refuses to cut with $_seam set" || bad "release.sh does not refuse $_seam"
done
grep -qE '^\. "\$REPO/tools/lib/notarize-binaries\.sh"' "$B" && ok "build-kosmos-bundle.sh sources notarize-binaries.sh" || bad "not sourced"
last_selftest="$(grep -n 'kosmos-app" --kosmos-app-' "$B" | tail -1 | cut -d: -f1)"
last_sign="$(grep -n '^codesign_ts_retry ' "$B" | tail -1 | cut -d: -f1)"
pack="$(grep -n '^echo "==> packing"' "$B" | head -1 | cut -d: -f1)"
[ -n "$call" ] && [ -n "$last_selftest" ] && [ -n "$last_sign" ] && [ -n "$pack" ] \
  && [ "$call" -gt "$last_selftest" ] && [ "$call" -gt "$last_sign" ] && [ "$call" -lt "$pack" ] \
  && ok "it notarises after the last sign and self-test ($last_sign, $last_selftest) and before packing ($pack)" \
  || bad "order wrong: notarise=$call last-sign=$last_sign last-selftest=$last_selftest pack=$pack"

echo "test-notarize-binaries-5137: $passes passed, $fails failed"
EXPECTED=85   # the number of ok lines above; a skipped arm must not read as green
[ "$passes" = "$EXPECTED" ] || echo "test-notarize-binaries-5137: $passes passes, expected $EXPECTED (an arm was skipped or added without updating EXPECTED)"
[ "$fails" = 0 ] && [ "$passes" = "$EXPECTED" ]
