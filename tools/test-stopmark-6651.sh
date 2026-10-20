#!/bin/bash
# kosmos#6651: an update's pause is named by an empty file beside board.stopped (board.stopped.by-install.<pid>.<token>),
# so a pause whose update was killed (or died under a full disk) no longer keeps the board off for good. A person's
# stop, a board the mode keeps off, and a live update's pause are unchanged.
#
# 0. The shared block is byte-identical in install/setup.sh, install/kosmos and bin/board-watchdog.sh.
# 1. Its functions, against real processes (a live one, one that has ended, a live pid with another start time),
#    with the mode file, TZ, a ps that cannot run, and a FULL DISK (a small disk image, filled: the name must still
#    be written there, which is the point of using a name).
# 2. The clear: moves the marker and names aside (kept), logs, and puts a person's marker back if their stop raced it.
# 3. The real bin/board-watchdog.sh against a stub CLI.
# 4. The callers, by the order of their lines (the real CLI is never run here: its stop reaches this Mac's own
#    launchd job): a person's stop removes the names before it writes the marker, board-run and an agent's start
#    clear a stranded pause, setup.sh names only the pause it makes and its EXIT trap removes the name.
set -u
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-stopmark-6651.XXXXXXXXXX")"
DISK=""
cleanup() {
  [ -n "${LIVE:-}" ] && kill "$LIVE" 2>/dev/null
  [ -n "$DISK" ] && hdiutil detach -quiet "$DISK" >/dev/null 2>&1
  rm -rf "${TMP:?}"
}
trap cleanup EXIT

block() { awk '/^# BEGIN kosmos#6651 shared block/ { on=1 } on { print } /^# END kosmos#6651 shared block/ { exit }' "$1"; }
B_SETUP="$(block install/setup.sh)"; B_CLI="$(block install/kosmos)"; B_WD="$(block bin/board-watchdog.sh)"
{ [ -n "$B_CLI" ] && [ "$B_CLI" = "$B_SETUP" ] && [ "$B_CLI" = "$B_WD" ]; } \
  && ok "the shared block is the same in setup.sh, the CLI and the watchdog" || bad "the shared block differs between files (or is missing)"

# --- 1. the functions -------------------------------------------------------------------------------------------
eval "$B_CLI"
export KOSMOS_HOME="$TMP/home"; mkdir -p "$KOSMOS_HOME"
M="$KOSMOS_HOME/board.stopped"
sleep 300 & LIVE=$!; disown "$LIVE" 2>/dev/null || true
LTOK="$(kosmos_start_token "$LIVE")"
[ -n "$LTOK" ] || bad "fixture: no start token for a live process"
case "$LTOK" in *" "*) bad "the token holds a space (it must fit a file name)" ;; *) ok "the token fits a file name ($LTOK)" ;; esac
( exit 0 ) & DEAD=$!; wait "$DEAD" 2>/dev/null
OTHER="Mon_Jan_1_00:00:00_2001"
reset() { rm -f "$M" "$KOSMOS_HOME"/board.stopped.* "$KOSMOS_HOME/mode"; }
name() { : > "$KOSMOS_HOME/board.stopped.by-install.$1.$2"; }
verdict() { if kosmos_stranded_pause >/dev/null; then echo stranded; else echo stands; fi; }
check() { # $1 expected, $2 label
  [ "$(verdict)" = "$1" ] && ok "$2" || bad "$2 (got $(verdict))"
}

reset; : > "$M";                                 check stands   "a person's stop (marker, no names) stands"
reset; : > "$M"; name "$LIVE" "$LTOK";           check stands   "a running update's pause stands"
reset; : > "$M"; name "$DEAD" "$LTOK";           check stranded "an update that has ended: stranded"
reset; : > "$M"; name "$LIVE" "$OTHER";          check stranded "a reused pid (another start time): stranded"
reset; : > "$M"; name "$DEAD" "$LTOK"; name "$LIVE" "$LTOK"; check stands "one gone and one live update: the live one's pause stands"
reset; name "$DEAD" "$LTOK";                     check stands   "a name with no marker (the board was started since): nothing to clear"
for bogus in "abc.$LTOK" "$DEAD" "$DEAD.has space" "$DEAD.semi;colon" "$DEAD."; do
  reset; : > "$M"; : > "$KOSMOS_HOME/board.stopped.by-install.$bogus"
  check stands "an unreadable name stands: '$bogus'"
done
for m in connect "" garbage; do
  reset; : > "$M"; name "$DEAD" "$LTOK"; printf '%s\n' "$m" > "$KOSMOS_HOME/mode"
  check stands "mode '$m' keeps a stranded pause in place (the board must stay off)"
done
for m in run both; do
  reset; : > "$M"; name "$DEAD" "$LTOK"; printf '%s\n' "$m" > "$KOSMOS_HOME/mode"
  check stranded "mode '$m': a stranded pause is stranded"
done
[ "$(TZ=Asia/Tokyo kosmos_start_token "$LIVE")" = "$(TZ=America/Chicago kosmos_start_token "$LIVE")" ] \
  && ok "the token is the same in any TZ" || bad "the token depends on TZ"
reset; : > "$M"; name "$LIVE" "$(TZ=Asia/Tokyo kosmos_start_token "$LIVE")"
[ "$(TZ=UTC verdict)" = stands ] && ok "a live pause named in one zone stands when read in another" || bad "a TZ change cleared a live pause"
mkdir -p "$TMP/badps"; printf '#!/bin/sh\nexit 126\n' > "$TMP/badps/ps"; chmod +x "$TMP/badps/ps"
reset; : > "$M"; name "$LIVE" "$LTOK"
[ "$(PATH="$TMP/badps:$PATH" verdict)" = stands ] && ok "ps cannot run, update alive: the pause stands" || bad "a broken ps cleared a live pause"
reset; : > "$M"; name "$DEAD" "$LTOK"
[ "$(PATH="$TMP/badps:$PATH" verdict)" = stranded ] && ok "ps cannot run, update gone (kill: no such process): stranded" || bad "a broken ps kept a dead update's pause"

# A full disk: the card's own case. A name is an empty file, so it needs no data block.
if command -v hdiutil >/dev/null 2>&1 && hdiutil create -quiet -size 8m -fs APFS -volname s6651 "$TMP/full.dmg" >/dev/null 2>&1 \
   && DISK="$(hdiutil attach -nobrowse "$TMP/full.dmg" 2>/dev/null | awk '/s6651/ { print $NF }')" && [ -n "$DISK" ]; then
  dd if=/dev/zero of="$DISK/fill" bs=1m 2>/dev/null; dd if=/dev/zero of="$DISK/fill2" bs=4k 2>/dev/null
  ( printf 'x\n' > "$DISK/probe" ) >/dev/null 2>&1
  if [ -s "$DISK/probe" ]; then
    bad "fixture: the disk image is not full, so this proves nothing"
  else
    : > "$DISK/board.stopped" 2>/dev/null; : > "$DISK/board.stopped.by-install.$DEAD.$LTOK" 2>/dev/null
    { [ -e "$DISK/board.stopped" ] && [ -e "$DISK/board.stopped.by-install.$DEAD.$LTOK" ]; } \
      && ok "on a FULL disk the marker and the pause's name are still written" || bad "the marker or the name could not be written on a full disk"
    [ "$(KOSMOS_HOME="$DISK" verdict)" = stranded ] && ok "and read there as stranded once that update is gone" || bad "a full-disk pause read as stands"
  fi
else
  echo "SKIP  full-disk case: hdiutil could not make a disk image here (macOS only)"
fi

# --- 2. the clear -----------------------------------------------------------------------------------------------
reset; : > "$M"; name "$DEAD" "$LTOK"; mkdir -p "$KOSMOS_HOME/logs"
kosmos_clear_stranded_pause test-clear
aside="$(ls "$KOSMOS_HOME"/board.stopped.stranded.* 2>/dev/null | grep -v by-install | head -1)"
{ [ ! -e "$M" ] && [ -n "$aside" ] && [ -z "$(ls "$KOSMOS_HOME"/board.stopped.by-install.* 2>/dev/null)" ] \
  && [ -n "$(ls "$KOSMOS_HOME"/board.stopped.stranded.*.by-install.* 2>/dev/null)" ] \
  && grep -q "test-clear: cleared a stranded update pause (board.stopped.by-install.$DEAD" "$KOSMOS_HOME/logs/board-watchdog.log"; } \
  && ok "the clear moves the marker and its name aside (kept) and logs it" || bad "the clear: $(ls "$KOSMOS_HOME")"
reset; : > "$M"; name "$LIVE" "$LTOK"
kosmos_clear_stranded_pause test-clear; rc=$?
{ [ "$rc" -ne 0 ] && [ -e "$M" ]; } && ok "CONTROL: a live update's pause is not cleared" || bad "a live pause was cleared"
# A person's stop racing the clear: it removes the names between the check and the move. Modelled by a check that
# names a file which is already gone.
reset; : > "$M"
( kosmos_stranded_pause() { printf '%s\n' "$KOSMOS_HOME/board.stopped.by-install.$DEAD.$LTOK"; }
  kosmos_clear_stranded_pause test-race; echo "rc=$?" > "$TMP/race" )
{ grep -q 'rc=1' "$TMP/race" && [ -e "$M" ]; } && ok "a person's stop racing the clear: their marker is put back" || bad "a raced clear lost a person's marker"

# --- 3. the real watchdog ---------------------------------------------------------------------------------------
new_home() {
  local h; h="$(mktemp -d "$TMP/wd.XXXXXX")"; mkdir -p "$h/bin" "$h/logs"
  cat > "$h/bin/kosmos" <<'STUB'
#!/bin/bash
H="$(cd "$(dirname "$0")/.." && pwd)"
case "$1" in
  status) [ -f "$H/.stub-healthy" ] && exit 0; exit 1 ;;
  start)  echo start >> "$H/.stub-start-calls"; : > "$H/.stub-healthy"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$h/bin/kosmos"; : > "$h/board.plist"
  printf '#!/bin/bash\nexit 0\n' > "$h/bin/launchctl"; chmod +x "$h/bin/launchctl"
  # A down streak already past grace, so a run that gets past the marker gate starts the board.
  printf 'down_since=%s\nlast_kickstart=0\nfail_count=0\nbusy_since=\n' "$(( $(date +%s) - 100 ))" > "$h/logs/board-watchdog.state"
  printf '%s' "$h"
}
run_wd() { env -u KOSMOS_HOME KOSMOS_WATCHDOG_GRACE=45 KOSMOS_WATCHDOG_THROTTLE=180 KOSMOS_WATCHDOG_MAX_FAILS=5 KOSMOS_WATCHDOG_COOLDOWN=3600 \
  KOSMOS_WATCHDOG_LAUNCHCTL="$1/bin/launchctl" bash "$REPO/bin/board-watchdog.sh" "$1" "$1/board.plist" >/dev/null 2>&1; }
starts() { [ -f "$1/.stub-start-calls" ] && wc -l < "$1/.stub-start-calls" | tr -d ' ' || echo 0; }
H="$(new_home)"; : > "$H/board.stopped"; : > "$H/board.stopped.by-install.$DEAD.$LTOK"; run_wd "$H"
{ [ ! -e "$H/board.stopped" ] && grep -q 'watchdog: cleared a stranded update pause' "$H/logs/board-watchdog.log" && [ "$(starts "$H")" -ge 1 ]; } \
  && ok "watchdog: a stranded pause is cleared, logged, and the board comes back" || bad "watchdog: stranded pause not cleared (starts=$(starts "$H"))"
H="$(new_home)"; : > "$H/board.stopped"; run_wd "$H"
{ [ -e "$H/board.stopped" ] && [ "$(starts "$H")" = 0 ]; } && ok "watchdog CONTROL: a person's stop still keeps it off" || bad "watchdog overrode a person's stop"
H="$(new_home)"; : > "$H/board.stopped"; : > "$H/board.stopped.by-install.$LIVE.$LTOK"; run_wd "$H"
{ [ -e "$H/board.stopped" ] && [ "$(starts "$H")" = 0 ]; } && ok "watchdog: a running update's pause is left alone" || bad "watchdog broke a live update's pause"
H="$(new_home)"; : > "$H/board.stopped"; : > "$H/board.stopped.by-install.$DEAD.$LTOK"; printf 'connect\n' > "$H/mode"; run_wd "$H"
{ [ -e "$H/board.stopped" ] && [ "$(starts "$H")" = 0 ]; } && ok "watchdog: a connect computer's stranded pause is left alone" || bad "watchdog started a connect computer's board"
H="$(new_home)"; : > "$H/board.stopped"; : > "$H/board.stopped.by-install.$DEAD.$LTOK"; rm -f "$H/board.plist"; run_wd "$H"
[ -e "$H/board.stopped" ] && ok "watchdog: with auto-restart off (no board job) it clears nothing" || bad "watchdog cleared a pause it would not restart"

# --- 4. the callers ---------------------------------------------------------------------------------------------
fnbody() { awk -v n="$2" '$0 ~ "^"n"\\(\\) \\{" { on=1 } on { print } on && /^}$/ { exit }' "$1"; }
# a person's stop: both of cmd_stop's marker writes are right after the name removal, which only an update skips
cnt="$(fnbody install/kosmos cmd_stop | awk '/KOSMOS_STOP_BY_INSTALL:-}" = 1 \] \|\| rm -f "\$STOP_MARKER".by-install/ { r = NR } /^ *: > "\$STOP_MARKER"/ { if (r && NR == r + 1) n++ } END { print n + 0 }')"
[ "$cnt" = 2 ] && ok "a person's stop removes an update's names just before each marker write ($cnt of 2)" || bad "cmd_stop's marker writes are not each preceded by the name removal ($cnt of 2)"
fnbody install/kosmos cmd_board_run | awk '/kosmos_clear_stranded_pause board-run/ { c = NR } /Kosmos was deliberately stopped; not starting/ { exit !(c) }' \
  && ok "board-run clears a stranded pause before it refuses" || bad "board-run does not clear a stranded pause first"
fnbody install/kosmos agent_board_guard | awk '/local _claim=/ { l = NR } /kosmos_clear_stranded_pause agent-start/ { n++; if (!l || NR < l) bad = 1 } END { exit !(n == 2 && !bad) }' \
  && ok "an agent's start clears a stranded pause only after the cooldown and claim pass (both success returns)" \
  || bad "an agent's start clears a stranded pause before its cooldown or claim (or not on both success returns)"
awk '/^  _kosmos_pause_name=""$/ { if (!a) a = NR } /if \[ "\$_kosmos_was_running" = yes \]; then/ { if (a && !w) w = NR }
     /: > "\$_kosmos_pause_name"/ { n = NR } /^  _kosmos_marker_ours="\$_kosmos_was_running"/ { m = NR }
     END { exit !(a && w > a && n > w && m > n) }' install/setup.sh \
  && ok "setup.sh names its pause only when pausing a running board, before the stop" || bad "setup.sh's pause name is not where it should be"
awk '/^_kosmos_on_exit\(\) \{/ { on = 1 } on && /rm -f "\$_kosmos_pause_name"/ { f = 1 } on && /^}/ { exit !f }' install/setup.sh \
  && ok "setup.sh's EXIT trap removes its own pause name" || bad "setup.sh's EXIT trap does not remove its pause name"
grep -q 'elif ! _kosmos_mode_keeps_board_off && kosmos_stranded_pause >/dev/null; then' install/setup.sh \
  && ok "a later update adopts a stranded pause (its own put-back covers it)" || bad "a later update does not adopt a stranded pause"

echo
[ "$fails" -eq 0 ] && echo "test-stopmark-6651: all passed" || { echo "test-stopmark-6651: FAILED"; exit 1; }
