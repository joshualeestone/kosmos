#!/usr/bin/env bash
# Test for tools/lib/codesign-retry.sh (kosmos#5149): a codesign that fails with Apple's
# "The timestamp service is not available" is tried again; any other failure stops at once.
# Stub codesigns are shell FUNCTIONS (as in test-cut-sign-preflight.sh), so no fresh executable is
# exec'd, and each records every call, so a pass cannot come from a retry that never ran codesign.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$REPO/tools/lib/codesign-retry.sh"

fails=0
passes=0
ok()  { echo "  PASS  $1"; passes=$((passes + 1)); }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export KOSMOS_CODESIGN_TS_DELAYS="0 0 0"

calls() { [ -f "$WORK/calls" ] && wc -l < "$WORK/calls" | tr -d ' ' || echo 0; }
TS="$WORK/x/kosmos-tunnel: The timestamp service is not available."

# Fails with the timestamp message until call N, then succeeds.
cs_blip() { echo "$*" >> "$WORK/calls"; [ "$(calls)" -ge "${BLIP_OK_AT:-3}" ] && { echo "$WORK/x: replacing existing signature"; return 0; }; echo "$TS" >&2; return 1; }
cs_ts_always() { echo "$*" >> "$WORK/calls"; echo "$TS" >&2; return 1; }
cs_locked() { echo "$*" >> "$WORK/calls"; echo "$WORK/x: errSecInternalComponent" >&2; return 3; }
cs_ok() { echo "$*" >> "$WORK/calls"; return 0; }
cs_argv() { printf '%s\n' "$@" > "$WORK/argv"; echo x >> "$WORK/calls"; return 0; }

run() { rm -f "$WORK/calls"; KOSMOS_CODESIGN_CMD="$1" codesign_ts_retry --force --timestamp -s "Developer ID Application: Test" "$WORK/x" > "$WORK/out" 2> "$WORK/err"; echo $?; }

# 1. Two blips, then it answers: the sign goes through on the third try, and each retry is printed.
rc=$(BLIP_OK_AT=3 run cs_blip)
[ "$rc" = 0 ] && ok "two timestamp blips then success: exit 0" || bad "two timestamp blips then success: exit $rc, want 0"
[ "$(calls)" = 3 ] && ok "two timestamp blips then success: codesign ran 3 times" || bad "two blips: codesign ran $(calls) times, want 3"
n=$(grep -c 'trying again in 0s (kosmos#5149)' "$WORK/err")
[ "$n" = 2 ] && ok "two timestamp blips: two retry lines printed" || bad "two blips: $n retry lines, want 2"
grep -q '^    .*replacing existing signature' "$WORK/out" && ok "codesign's own output is printed, indented four spaces" || bad "codesign's output was not printed indented: $(cat "$WORK/out")"

# 2. Any other failure stops at once, with codesign's own exit status, and no retry.
rc=$(run cs_locked)
[ "$rc" = 3 ] && ok "a locked keychain fails at once with codesign's exit 3" || bad "locked keychain: exit $rc, want 3"
[ "$(calls)" = 1 ] && ok "a locked keychain: codesign ran once (no retry)" || bad "locked keychain: codesign ran $(calls) times, want 1"
grep -q 'kosmos#5149' "$WORK/err" && bad "a locked keychain printed a retry line" || ok "a locked keychain prints no retry line"
grep -q 'errSecInternalComponent' "$WORK/out" && ok "a locked keychain's message is still shown" || bad "the locked keychain's message was swallowed"

# 3. The service never answers: four tries (three delays), then it fails as before, saying so.
rc=$(run cs_ts_always)
[ "$rc" = 1 ] && ok "timestamp never answers: fails with codesign's exit 1" || bad "timestamp never answers: exit $rc, want 1"
[ "$(calls)" = 4 ] && ok "timestamp never answers: codesign ran 4 times" || bad "timestamp never answers: codesign ran $(calls) times, want 4"
grep -q 'did not answer (tries: 4)' "$WORK/err" && ok "timestamp never answers: the give-up line names the 4 tries" || bad "no give-up line: $(cat "$WORK/err")"

# 4. Success on the first try: one call, nothing printed about retries.
rc=$(run cs_ok)
{ [ "$rc" = 0 ] && [ "$(calls)" = 1 ] && [ ! -s "$WORK/err" ]; } && ok "first-try success: one call, no retry output" || bad "first-try success: exit $rc, $(calls) calls, err: $(cat "$WORK/err")"

# 5. Arguments reach codesign verbatim, a path with a space included.
rm -f "$WORK/calls"
KOSMOS_CODESIGN_CMD=cs_argv codesign_ts_retry --force --entitlements "$WORK/a b.plist" -s "Developer ID Application: Test" "$WORK/x" >/dev/null 2>&1
want="$(printf '%s\n' --force --entitlements "$WORK/a b.plist" -s "Developer ID Application: Test" "$WORK/x")"
[ "$(cat "$WORK/argv")" = "$want" ] && ok "arguments pass through verbatim" || bad "arguments changed: $(cat "$WORK/argv")"

# 5b. A recapitalised timestamp message is still retried (the match is case-insensitive).
cs_ts_caps() { echo "$*" >> "$WORK/calls"; [ "$(calls)" -ge 2 ] && return 0; echo "x: THE TIMESTAMP SERVICE IS NOT AVAILABLE." >&2; return 1; }
rc=$(run cs_ts_caps)
{ [ "$rc" = 0 ] && [ "$(calls)" = 2 ]; } && ok "an upper-case timestamp message is retried" || bad "upper-case message: exit $rc, $(calls) calls, want 0 and 2"
# Called DIRECTLY, not in $(...): a subshell would discard any shopt change and this could never fail.
rm -f "$WORK/calls"; shopt -u nocasematch
KOSMOS_CODESIGN_CMD=cs_ts_caps codesign_ts_retry -s x y >/dev/null 2>&1
shopt -q nocasematch && bad "codesign_ts_retry turned nocasematch on in its caller" || ok "nocasematch off in the caller stays off"
rm -f "$WORK/calls"; shopt -s nocasematch
KOSMOS_CODESIGN_CMD=cs_ts_caps codesign_ts_retry -s x y >/dev/null 2>&1
shopt -q nocasematch && ok "nocasematch on in the caller stays on" || bad "codesign_ts_retry turned the caller's nocasematch off"
shopt -u nocasematch

# 5c. Delays are words, never globs: a "*" stays a "*" (sleep refuses it), it does not become file names.
rm -f "$WORK/calls"; ( cd "$WORK" && KOSMOS_CODESIGN_TS_DELAYS='*' KOSMOS_CODESIGN_CMD=cs_ts_always codesign_ts_retry -s x y >/dev/null 2>"$WORK/err" )
grep -q 'trying again in \*s' "$WORK/err" && ok "a '*' delay is not glob-expanded" || bad "a '*' delay was expanded: $(head -2 "$WORK/err")"

# 5d. The status is codesign's own even when the caller has no pipefail (the tee | sed pipe must not hide it),
#     and a caller's IFS does not change how the delays split.
rc=$(bash -c 'set -eu; set +o pipefail; . "$1/tools/lib/codesign-retry.sh"; cs(){ echo "x: errSecInternalComponent" >&2; return 3; }; KOSMOS_CODESIGN_CMD=cs codesign_ts_retry -s x y >/dev/null 2>&1 && echo 0 || echo $?' _ "$REPO")
[ "$rc" = 3 ] && ok "no pipefail in the caller: codesign's exit 3 still comes back" || bad "no pipefail in the caller: got $rc, want 3"
cs_ts_one() { echo x >> "$WORK/calls"; echo "$TS" >&2; return 1; }   # one line per call whatever IFS joins "$*" with
rm -f "$WORK/calls"; rc=$(IFS=$'\n'; run cs_ts_one)
[ "$(calls)" = 4 ] && ok "a newline-only IFS in the caller still gives 4 tries" || bad "newline-only IFS: codesign ran $(calls) times, want 4"

# 6. An empty delay list means one try and no retry, so the behaviour can be turned off.
rc=$(KOSMOS_CODESIGN_TS_DELAYS="" run cs_ts_always)
{ [ "$rc" = 1 ] && [ "$(calls)" = 1 ]; } && ok "KOSMOS_CODESIGN_TS_DELAYS empty: one try" || bad "empty delays: exit $rc, $(calls) calls, want 1 and 1"

# 7. The two Developer ID signs in the bundle build go through the retry, and no bare
#    timestamped codesign is left there (a new one added later would not be retried).
B="$REPO/tools/build-kosmos-bundle.sh"
n=$(grep -cE '^codesign_ts_retry --force --options runtime --timestamp' "$B")
[ "$n" = 2 ] && ok "build-kosmos-bundle.sh signs both binaries through codesign_ts_retry" || bad "build-kosmos-bundle.sh: $n codesign_ts_retry signs, want 2"
grep -qE '^\. "\$REPO/tools/lib/codesign-retry\.sh"' "$B" && ok "build-kosmos-bundle.sh sources codesign-retry.sh" || bad "build-kosmos-bundle.sh does not source codesign-retry.sh"
n=$(grep -E '(^|[^_[:alnum:]])codesign [^|]*--timestamp( |=|$)' "$B" | grep -vc 'timestamp=none')
[ "$n" = 0 ] && ok "no bare timestamped codesign left in build-kosmos-bundle.sh" || bad "$n bare timestamped codesign line(s) in build-kosmos-bundle.sh"

echo "test-codesign-retry-5149: $passes passed, $fails failed"
[ "$fails" = 0 ] && [ "$passes" = 23 ]
