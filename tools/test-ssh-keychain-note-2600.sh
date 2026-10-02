#!/bin/bash
# kosmos#2600: a Kosmos launched DIRECTLY (cmd_start's nohup path) from a session that cannot use the login Keychain
# (a remote SSH session is the usual one) says so in one sentence, with the fix, and goes ahead. A supervised start
# (launchd, the person's desktop session) and an already-running board say nothing.
# The CLI is SOURCED (it returns before its dispatch when sourced), so nothing here starts a board; the function is
# called directly. KOSMOS_UNAME stands in for the platform and KOSMOS_SECURITY_BIN for `security`.
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
SAID="cannot read this computer's Keychain"
# A stand-in `security`: records its arguments, then answers with the code asked for (or hangs).
stub() {  # <name> <exit code | hang>
  local f="$T/$1"
  if [ "$2" = hang ]; then printf '#!/bin/sh\necho "$@" > "%s.args"\nsleep 10\n' "$f" > "$f"
  else printf '#!/bin/sh\necho "$@" > "%s.args"\nexit %s\n' "$f" "$2" > "$f"; fi
  chmod +x "$f"; printf '%s' "$f"
}

out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$(stub s36 36)")"
case "$out" in *"$SAID"*) pass "rc 36 (no interaction allowed: the SSH case) gives the note" ;; *) fail "no note on rc 36: $out" ;; esac
case "$out" in *'kosmos restart'*'on the Mac itself'*) pass "and names the fix: kosmos restart on the Mac itself" ;; *) fail "the note does not name the fix: $out" ;; esac
case "$out" in *'SSH session is the usual reason'*) case "$out" in *'Tell the person who runs this computer'*) fail "a person got the agent's wording: $out" ;; *) pass "a person gets the person's wording, not the agent's" ;; esac ;; *) fail "the person's wording is missing: $out" ;; esac
case "$out" in *'rc=0'*) pass "and goes ahead (advice, never a refusal)" ;; *) fail "the note did not return 0: $out" ;; esac
[ "$(cat "$T/s36.args" 2>/dev/null)" = "show-keychain-info" ] && pass "it asks exactly 'security show-keychain-info' (the default keychain, the one claude reads)" \
  || fail "the probe was asked: '$(cat "$T/s36.args" 2>/dev/null)'"

out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$(stub s0 0)")"
case "$out" in *"$SAID"*) fail "CONTROL: rc 0 (the Keychain answers) gave the note" ;; *) pass "CONTROL: rc 0 (the Keychain answers) says nothing" ;; esac
out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$(stub s50 50)")"
case "$out" in *"$SAID"*) fail "rc 50 (no keychain) gave the note" ;; *) pass "rc 50 (no keychain found) is not this cause: no note" ;; esac
t0=$(date +%s); out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$(stub shang hang)" 2>&1)"; t1=$(date +%s)
case "$out" in *"$SAID"*) fail "a hung probe gave the note" ;; *) pass "a probe that hangs (a dialog nobody answers) says nothing" ;; esac
[ $((t1 - t0)) -le 6 ] && pass "and is cut within the 3 s bound (took $((t1 - t0)) s)" || fail "a hung probe held the start for $((t1 - t0)) s"
case "$out" in *[Aa]larm*) fail "the cut printed the shell's signal report to the terminal: $out" ;; *) pass "and the cut prints nothing (no Alarm clock line)" ;; esac
# Covers the OUTCOME (no note), not the command -v guard alone: perl's failed exec also exits 0, so the guard is a
# belt, and either way a missing security says nothing.
out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$T/no-such-security")"
case "$out" in *"$SAID"*) fail "a missing security gave the note" ;; *) pass "no security binary: no note" ;; esac
out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$(stub s36b 36)" KOSMOS_NO_KEYCHAIN_NOTE=1)"
case "$out" in *"$SAID"*) fail "KOSMOS_NO_KEYCHAIN_NOTE=1 did not silence it" ;; *) pass "KOSMOS_NO_KEYCHAIN_NOTE=1 (the installer) silences it" ;; esac
out="$(note KOSMOS_UNAME=Linux KOSMOS_SECURITY_BIN="$(stub s36c 36)")"
case "$out" in *"$SAID"*) fail "a non-Mac host got the Keychain note" ;; *) pass "a non-Mac host says nothing (there is no login Keychain)" ;; esac
out="$(note KOSMOS_UNAME=Darwin KOSMOS_SECURITY_BIN="$(stub s36d 36)" KOSMOS_AGENT_SESSION=some-agent)"
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
supfi="$(printf '%s\n' "$body" | awk -v from="$sup" 'NR>from && /^  fi$/{print NR; exit}')"
call="$(printf '%s\n' "$body" | grep -nE '^[[:space:]]*keychain_note([[:space:]]|$)' | head -1 | cut -d: -f1)"
launch="$(printf '%s\n' "$body" | grep -n 'say "Bringing the board up."' | head -1 | cut -d: -f1)"
[ -n "$supfi" ] && [ -n "$call" ] && [ -n "$launch" ] && [ "$supfi" -lt "$call" ] && [ "$call" -lt "$launch" ] \
  && pass "cmd_start calls it after the supervised block CLOSES and before the direct launch" \
  || fail "placement in cmd_start (supervised block ends=$supfi call=$call launch=$launch)"
grep -qE 'KOSMOS_NO_KEYCHAIN_NOTE=1 [^|]*"\$KOSMOS_HOME/bin/kosmos" start --force \|\| die' "$REPO/install/setup.sh" \
  && pass "the installer's direct start passes KOSMOS_NO_KEYCHAIN_NOTE=1 and still dies on failure" \
  || fail "the installer's start does not pass the opt-out (or lost its || die)"
grep -qE '^[[:space:]]*(start|restart)\).*keychain_note' "$K" && fail "the dispatch still calls it (would fire on a running board)" \
  || pass "the dispatch does not call it"

if [ "$fails" -eq 0 ]; then echo "test-ssh-keychain-note-2600: all arms passed"; else echo "test-ssh-keychain-note-2600: $fails failed"; exit 1; fi
