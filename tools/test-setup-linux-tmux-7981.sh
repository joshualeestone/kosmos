#!/bin/bash
# kosmos#7981: run from the installed CLI, which puts $KOSMOS_HOME/tmux/bin first on PATH (install/kosmos), the Linux
# installer found Kosmos's own tmux link, removed it and linked it to itself, then aborted with the board paused.
# Runs the real setup_linux_tmux, cut out of install/setup.sh, under the shell the installer runs in.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SETUP="$HERE/../install/setup.sh"
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-setup-linux-tmux-7981.XXXXXXXXXX")"; trap 'rm -rf "$TMP"' EXIT

awk '/^setup_linux_tmux\(\) \{/{on=1} on{print} on&&/^}/{exit}' "$SETUP" > "$TMP/fn.sh"
grep -q 'setup_linux_tmux() {' "$TMP/fn.sh" && [ "$(tail -1 "$TMP/fn.sh")" = "}" ] && ok "the function was cut out of the installer" || bad "could not cut the function out of $SETUP"

# A system tmux, somewhere else on PATH, and only the tools the shell needs from the real system.
SYS="$TMP/usr-bin"; mkdir -p "$SYS"
printf '#!/bin/sh\necho system-tmux\n' > "$SYS/tmux"; chmod 755 "$SYS/tmux"
run() {  # <dest> <PATH>: the installer's function, under sh, with that PATH
  sh -c '. "$1/fn.sh"; info() { printf "%s\n" "$*"; }; PATH="$3"; setup_linux_tmux "$2"' _ "$TMP" "$1" "$2" 2>&1
}
fresh() { rm -rf "$TMP/home"; mkdir -p "$TMP/home/tmux/bin"; D="$TMP/home/tmux"; }
works() { [ "$("$D/bin/tmux" 2>/dev/null)" = system-tmux ]; }
BASE="$SYS:/usr/bin:/bin"
mkdir -p "$TMP/empty"

# CONTROL: a login shell's PATH, the case that always worked.
fresh; o="$(run "$D" "$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "CONTROL: a login shell's PATH links the system tmux"; else bad "login shell: rc=$rc $o"; fi

# The installed CLI's PATH, with the link already in place from the install before: the reported failure.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works && [ "$(readlink "$D/bin/tmux")" = "$SYS/tmux" ]; then ok "with Kosmos's own folder first on PATH, the link still points at the system tmux"; else bad "own folder first: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

# Its own folder anywhere on PATH, not only first.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$TMP/empty:$D/bin:$SYS:/usr/bin:/bin")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "with Kosmos's own folder in the middle of PATH, the same"; else bad "own folder in the middle: rc=$rc $o"; fi

# A board an earlier failed update left with the link pointing at itself gets repaired.
fresh; ln -s "$D/bin/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "a link an earlier update left pointing at itself is repaired"; else bad "self-link repair: rc=$rc $o"; fi

# No tmux anywhere else: refused, saying what to do, and the working link it could not replace is not destroyed.
NOTMUX="$TMP/empty"
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$NOTMUX")"; rc=$?
if [ "$rc" != 0 ] && printf '%s' "$o" | grep -q 'Kosmos needs tmux on Linux' && works; then ok "with no other tmux it refuses, says what to do, and leaves the link alone"; else bad "no other tmux: rc=$rc works=$(works && echo yes || echo no) $o"; fi

[ "$fails" -eq 0 ] && { echo "test-setup-linux-tmux-7981: all passed"; exit 0; }
echo "test-setup-linux-tmux-7981: $fails failed"; exit 1
