#!/usr/bin/env bash
# test-start-after-install-4408.sh - kosmos#4408 (Ben on prod, 2026-09-28: "Kosmos changed on disk" after
# an update, and reopening did not clear it).
#
# The installer pauses the board, swaps the files, then starts it. If anything started the board again
# before the swap (the app window's reload runs `kosmos start`), that board runs the OLD code, and a plain
# `kosmos start` finds it healthy and keeps it. This runs the installer's own start_board_after_install
# block (read out of install/setup.sh between its markers) against a fake `kosmos` that behaves like the
# real one on this point: `start` leaves a healthy board alone, `restart` is stop then start.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
fail=0
pass() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }

BLOCK="$(sed -n '/^# >>> start_board_after_install/,/^# <<< start_board_after_install/p' "$SETUP")"
[ -n "$BLOCK" ] || { echo "FAIL  the start_board_after_install block is gone from install/setup.sh"; exit 1; }
grep -q '^start_board_after_install ||' "$SETUP" || bad 'the installer no longer calls start_board_after_install for its start step'

TMP="$(mktemp -d "${TMPDIR:-/tmp}/start4408.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home/bin"
# The fake CLI. running = the code version the live board booted; ondisk = the files installed now.
cat > "$TMP/home/bin/kosmos" <<'FAKE'
#!/usr/bin/env bash
S="$(dirname "$0")/.."
case "$1" in
  start)   if [ -s "$S/running" ]; then echo "Kosmos is already running"; else cp "$S/ondisk" "$S/running"; fi ;;
  stop)    : > "$S/running" ;;
  restart) : > "$S/running"; cp "$S/ondisk" "$S/running" ;;
esac
echo "$1" >> "$S/calls"
FAKE
chmod +x "$TMP/home/bin/kosmos"

run() {  # $1 = FRESH_INSTALL, $2 = what the live board is running before the step ("" = nothing)
  printf '%s' "$2" > "$TMP/home/running"; echo new > "$TMP/home/ondisk"; : > "$TMP/home/calls"
  ( KOSMOS_HOME="$TMP/home"; FRESH_INSTALL="$1"; eval "$BLOCK"; start_board_after_install )
  cat "$TMP/home/running"
}

got="$(run no old)"
[ "$got" = new ] && pass 'an update whose board was started mid-update on the OLD code ends on the NEW code' \
  || bad "an update left the board on '$got' (the stale board survived: #4408)"
got="$(run no '')"
[ "$got" = new ] && pass 'an update with no board running ends with the new board up' || bad "update with no board: '$got'"
got="$(run yes '')"
[ "$got" = new ] && pass 'a fresh install starts the board' || bad "fresh install: '$got'"
grep -qx start "$TMP/home/calls" && pass 'CONTROL: a fresh install uses start (nothing to restart)' || bad 'a fresh install did not use start'
# CONTROL: the fake really does reproduce the bug, so the first row can fail.
printf old > "$TMP/home/running"; echo new > "$TMP/home/ondisk"
"$TMP/home/bin/kosmos" start >/dev/null
[ "$(cat "$TMP/home/running")" = old ] && pass 'CONTROL: a plain start keeps a healthy stale board (the bug the first row catches)' \
  || bad 'CONTROL: the fake start replaced a healthy board, so this test cannot see the bug'

[ "$fail" -eq 0 ] && { echo "test-start-after-install-4408: all passed"; exit 0; }
echo "test-start-after-install-4408: $fail failed"; exit 1
