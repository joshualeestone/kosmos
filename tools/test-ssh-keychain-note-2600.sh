#!/bin/bash
# kosmos#2600: `kosmos start` / `kosmos restart` from a remote (SSH) session on a Mac say, in one sentence, that the
# board will not be able to read this Mac's Keychain (so Claude accounts would read as signed out), and go ahead.
# The CLI is SOURCED (it returns before its dispatch when sourced), so nothing here starts a board; the function under
# test is called directly. KOSMOS_UNAME stands in for the platform.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
# Run ssh_keychain_note in a clean shell: a sandbox HOME, no inherited SSH variables, only what the arm passes.
note() {  # <verb> [VAR=value...]
  local verb="$1"; shift
  env -i PATH=/usr/bin:/bin HOME="$T/home" "$@" bash -c '. "$1/install/kosmos" >/dev/null 2>&1; ssh_keychain_note "$2"; echo "rc=$?"' _ "$REPO" "$verb"
}
mkdir -p "$T/home"
SAID='cannot read this Mac'

out="$(note start KOSMOS_UNAME=Darwin SSH_CONNECTION='10.0.0.5 50123 10.0.0.9 22')"
case "$out" in *"$SAID"*) pass "a start from SSH on a Mac says the board will not read the Keychain" ;; *) fail "no note on a start from SSH: $out" ;; esac
case "$out" in *'kosmos start'*) pass "and names the command to run on the Mac itself" ;; *) fail "the note does not name the command: $out" ;; esac
case "$out" in *'rc=0'*) pass "and goes ahead (advice, never a refusal)" ;; *) fail "the note did not return 0: $out" ;; esac

out="$(note restart KOSMOS_UNAME=Darwin SSH_TTY=/dev/ttys004)"
case "$out" in *"$SAID"*'kosmos restart'*) pass "a restart with only SSH_TTY set says it too, naming restart" ;; *) fail "restart/SSH_TTY arm: $out" ;; esac

out="$(note start KOSMOS_UNAME=Darwin)"
case "$out" in *"$SAID"*) fail "CONTROL: a start on the Mac itself (no SSH variables) gave the note" ;; *) pass "CONTROL: a start on the Mac itself says nothing" ;; esac

out="$(note start KOSMOS_UNAME=Linux SSH_CONNECTION='10.0.0.5 50123 10.0.0.9 22')"
case "$out" in *"$SAID"*) fail "a non-Mac host gave the Keychain note" ;; *) pass "a non-Mac host says nothing (there is no login Keychain to miss)" ;; esac

# Sourcing the CLI must not touch the sandbox home (if a later change adds a top-level write, this test must say so,
# because every arm above relies on sourcing being inert).
if [ -z "$(find "$T/home" -mindepth 1 2>/dev/null | head -1)" ]; then pass "sourcing the CLI wrote nothing to HOME"; else fail "sourcing the CLI wrote to HOME: $(find "$T/home" -mindepth 1 | head -3 | tr '\n' ' ')"; fi

# The dispatch calls it on start and restart, after the agent guard and before the command.
grep -qE '^[[:space:]]*start\)[[:space:]]+agent_board_guard "\$@"; ssh_keychain_note start; cmd_start ;;' "$REPO/install/kosmos" \
  && pass "start dispatch calls the note before cmd_start" || fail "start dispatch does not call ssh_keychain_note start before cmd_start"
grep -qE '^[[:space:]]*restart\)[[:space:]]+agent_board_guard "\$@"; ssh_keychain_note restart; cmd_restart ;;' "$REPO/install/kosmos" \
  && pass "restart dispatch calls the note before cmd_restart" || fail "restart dispatch does not call ssh_keychain_note restart before cmd_restart"

if [ "$fails" -eq 0 ]; then echo "test-ssh-keychain-note-2600: all arms passed"; else echo "test-ssh-keychain-note-2600: $fails failed"; exit 1; fi
