#!/bin/bash
# kosmos#2600: a Kosmos launched DIRECTLY (cmd_start's nohup path) from a session that cannot use the login Keychain
# (a remote SSH session is the usual one) says so in one sentence, with the fix, and goes ahead. A supervised start
# (launchd, the person's desktop session) and an already-running board say nothing.
# The CLI is SOURCED (it returns before its dispatch when sourced), so nothing here starts a board; the function is
# called directly. KOSMOS_UNAME stands in for the platform and KOSMOS_KEYCHAIN_PROBE for the Keychain question.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/kh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
# A clean shell: sandbox HOME and KOSMOS_HOME (every path the CLI writes hangs off KOSMOS_HOME), nothing inherited.
note() {  # [VAR=value...]
  env -i PATH=/usr/bin:/bin HOME="$T/home" KOSMOS_HOME="$T/kh" "$@" \
    bash -c '. "$1/install/kosmos" >/dev/null 2>&1; keychain_note; echo "rc=$?"' _ "$REPO"
}
SAID="cannot read this Mac's Keychain"

out="$(note KOSMOS_UNAME=Darwin KOSMOS_KEYCHAIN_PROBE=false)"
case "$out" in *"$SAID"*) pass "a direct start in a session that cannot read the Keychain says so" ;; *) fail "no note when the Keychain cannot be read: $out" ;; esac
case "$out" in *'kosmos restart'*'on the Mac itself'*) pass "and names the fix: kosmos restart on the Mac itself" ;; *) fail "the note does not name the fix: $out" ;; esac
case "$out" in *'rc=0'*) pass "and goes ahead (advice, never a refusal)" ;; *) fail "the note did not return 0: $out" ;; esac

out="$(note KOSMOS_UNAME=Darwin KOSMOS_KEYCHAIN_PROBE=true)"
case "$out" in *"$SAID"*) fail "CONTROL: a session that CAN read the Keychain got the note" ;; *) pass "CONTROL: a session that can read the Keychain says nothing" ;; esac

out="$(note KOSMOS_UNAME=Linux KOSMOS_KEYCHAIN_PROBE=false)"
case "$out" in *"$SAID"*) fail "a non-Mac host got the Keychain note" ;; *) pass "a non-Mac host says nothing (there is no login Keychain)" ;; esac

out="$(note KOSMOS_UNAME=Darwin KOSMOS_KEYCHAIN_PROBE=false KOSMOS_AGENT_SESSION=some-agent)"
case "$out" in *'Tell the person who runs this computer'*) pass "an agent is told to ask the person, not to run it" ;; *) fail "agent wording: $out" ;; esac

# Sourcing the CLI must touch neither HOME nor KOSMOS_HOME (every arm relies on that). Control first: the check
# itself goes red on a written file, or a green answer would mean nothing.
empty() { [ -z "$(find "$T/home" "$T/kh" -mindepth 1 2>/dev/null | head -1)" ]; }
: > "$T/kh/probe-file"; if empty; then fail "CONTROL: the emptiness check missed a written file"; else pass "CONTROL: the emptiness check sees a written file"; fi
rm -f "$T/kh/probe-file"
empty && pass "sourcing the CLI wrote nothing to HOME or KOSMOS_HOME" || fail "sourcing wrote: $(find "$T/home" "$T/kh" -mindepth 1 | head -3 | tr '\n' ' ')"

# Placement: called inside cmd_start, AFTER the supervised branch returns, right before the direct launch; and not
# from the dispatch (where it would also fire on an already-running board and on a supervised start).
K="$REPO/install/kosmos"
body="$(awk '/^cmd_start\(\) \{/{f=1} f{print} f&&/^}$/{exit}' "$K")"
sup="$(printf '%s\n' "$body" | grep -n '_kosmos_board_supervised; then' | head -1 | cut -d: -f1)"
call="$(printf '%s\n' "$body" | grep -nE '^[[:space:]]*keychain_note([[:space:]]|$)' | head -1 | cut -d: -f1)"
launch="$(printf '%s\n' "$body" | grep -n 'say "Bringing the board up."' | head -1 | cut -d: -f1)"
[ -n "$sup" ] && [ -n "$call" ] && [ -n "$launch" ] && [ "$sup" -lt "$call" ] && [ "$call" -lt "$launch" ] \
  && pass "cmd_start calls it after the supervised branch and before the direct launch" \
  || fail "placement in cmd_start (supervised=$sup call=$call launch=$launch)"
grep -qE '^[[:space:]]*(start|restart)\).*keychain_note' "$K" && fail "the dispatch still calls it (would fire on a running board)" \
  || pass "the dispatch does not call it"

if [ "$fails" -eq 0 ]; then echo "test-ssh-keychain-note-2600: all arms passed"; else echo "test-ssh-keychain-note-2600: $fails failed"; exit 1; fi
