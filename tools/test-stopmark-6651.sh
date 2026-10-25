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
DECOY=""
# The device holding one of THIS run's images, by the image file's path in hdiutil's own list (matched on the temp
# folder's random name, since hdiutil prints /private/var/... and $TMP is /var/...): a device node is reused once its
# image goes, so cleanup detaches only nodes it can tie to its own file, never a bare remembered one.
img_dev() { hdiutil info 2>/dev/null | awk -v want="$(basename "$TMP")/$1" '/^image-path/ { on = (index($0, want) > 0) } on && /^\/dev\/disk[0-9]+[[:space:]]/ { print $1; exit }'; }
cleanup() {
  [ -n "${LIVE:-}" ] && kill "$LIVE" 2>/dev/null
  command -v hdiutil >/dev/null 2>&1 || { rm -rf "${TMP:?}"; return; }
  # Each image is found by its own file, so one that attached but never mounted is detached too; a busy one is forced.
  for img in full.dmg decoy.dmg; do
    dev="$(img_dev "$img")"
    [ -n "$dev" ] && { hdiutil detach -quiet "$dev" || hdiutil detach -quiet -force "$dev"; } >/dev/null 2>&1
  done
  # Never delete a folder that still backs an attached image, or through a live mount.
  still=""; for img in full.dmg decoy.dmg; do dev="$(img_dev "$img")"; [ -n "$dev" ] && still="$still $img=$dev"; done
  # And by device number, which does not depend on hdiutil answering: an hdiutil that fails or prints something
  # unexpected must not read as "nothing attached".
  [ -d "$TMP/mnt" ] && [ "$(stat -f %d "$TMP/mnt" 2>/dev/null)" != "$(stat -f %d "$TMP" 2>/dev/null)" ] && still="$still mnt"
  if [ -n "$still" ]; then
    echo "NOTE  still attached after detach:$still; left $TMP in place (detach by hand, then remove it)" >&2
  else
    rm -rf "${TMP:?}"
  fi
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
perl -e 'select(undef, undef, undef, 300)' & LIVE=$!; disown "$LIVE" 2>/dev/null || true
LTOK="$(kosmos_start_token "$LIVE")"
[ -n "$LTOK" ] || bad "fixture: no start token for a live process"
case "$LTOK" in *" "*) bad "the token holds a space (it must fit a file name)" ;; *) ok "the token fits a file name ($LTOK)" ;; esac
( exit 0 ) & DEAD=$!; wait "$DEAD" 2>/dev/null
OTHER="Mon_Jan_1_00:00:00_2001"
reset() { rm -f "$M" "$KOSMOS_HOME"/board.stopped.* "$KOSMOS_HOME/mode" "$KOSMOS_HOME/board.started-at"; }
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

# A leftover: a gone update's name older than the board's last start (board.started-at) supports nothing, so a
# later stop beside it (a person's, even through an older kosmos that leaves names) stands.
SA="$KOSMOS_HOME/board.started-at"
reset; name "$DEAD" "$LTOK"; touch -t 202001010000 "$KOSMOS_HOME/board.stopped.by-install.$DEAD.$LTOK"; date +%s > "$SA"; : > "$M"
check stands "a gone update's name older than the board's last start (a leftover) supports nothing"
reset; date +%s > "$SA"; touch -t 202001010000 "$SA"; : > "$M"; name "$DEAD" "$LTOK"
check stranded "a gone update's name newer than the board's last start: stranded"
reset; date +%s > "$SA"; touch -t 202001010000 "$SA"; name "$DEAD" "$LTOK"; sleep 1; : > "$M"
check stranded "an update killed during its own stop (the marker written after its name): still stranded"
reset; name "$LIVE" "$LTOK"; touch -t 202001010000 "$KOSMOS_HOME/board.stopped.by-install.$LIVE.$LTOK"; date +%s > "$SA"; : > "$M"
check stands "a LIVE update's name older than the board's last start still holds the pause"
reset; name "$DEAD" "x1"; touch -t 202001010000 "$KOSMOS_HOME/board.stopped.by-install.$DEAD.x1"; date +%s > "$SA"; touch -t 202101010000 "$SA"; : > "$M"; name "$DEAD" "$LTOK"
check stranded "an old leftover beside a newer gone update's name: stranded"
rm -f "$SA"
# "unknown": an update that could not read its own start time (ps refused). Gone only when that pid has ended.
reset; : > "$M"; name "$LIVE" unknown;  check stands   "an 'unknown' name whose pid is running holds the pause"
reset; : > "$M"; name "$DEAD" unknown;  check stranded "an 'unknown' name whose pid has ended: stranded"
livep() { if kosmos_live_pause; then echo live; else echo not; fi; }
reset; : > "$M"; name "$LIVE" "$LTOK"
[ "$(livep)" = live ] && ok "kosmos_live_pause: a running update's name is a live pause" || bad "a running update's pause not seen as live"
reset; : > "$M"; name "$DEAD" "$LTOK"
[ "$(livep)" = not ] && ok "kosmos_live_pause: only a gone update's name is not live" || bad "a gone update's name read as live"
reset; : > "$M"; : > "$KOSMOS_HOME/board.stopped.by-install.junk"
[ "$(livep)" = not ] && ok "kosmos_live_pause: an unreadable name is not live" || bad "an unreadable name read as live"
reset; name "$LIVE" "$LTOK"
[ "$(livep)" = not ] && ok "kosmos_live_pause: no marker, no pause" || bad "a live name without a marker read as a live pause"

# Tokens of two kinds cannot be compared: a proc: token read where there is no /proc (this Mac) stands.
reset; : > "$M"; name "$LIVE" "proc:12345"
if [ -d /proc/self ]; then echo "SKIP  cross-kind token case: this host has /proc"; else check stands "a token of another kind (proc: read through ps) stands"; fi

# The block under dash (Debian's /bin/sh), and setup.sh's own name-create line there: under dash a failed
# redirection on ":" ends the script unless it is in a subshell, which is the full-disk case.
if [ -x /bin/dash ]; then
  printf '%s\n' "$B_CLI" > "$TMP/block.sh"
  reset; : > "$M"; name "$DEAD" "$LTOK"
  out="$(KOSMOS_HOME="$KOSMOS_HOME" /bin/dash -c 'set -eu; . "$1"; if kosmos_stranded_pause >/dev/null; then echo stranded; else echo stands; fi' sh "$TMP/block.sh" 2>&1)"
  [ "$out" = stranded ] && ok "under dash (set -eu): a gone update's pause is stranded" || bad "under dash: $out"
  reset; : > "$M"; name "$LIVE" "$LTOK"
  out="$(KOSMOS_HOME="$KOSMOS_HOME" /bin/dash -c 'set -eu; . "$1"; if kosmos_stranded_pause >/dev/null; then echo stranded; else echo stands; fi' sh "$TMP/block.sh" 2>&1)"
  [ "$out" = stands ] && ok "under dash (set -eu): a live update's pause stands" || bad "under dash, live: $out"
  line="$(grep -n 'if ( : > "\$_kosmos_pause_name" ) 2>/dev/null; then :; else _kosmos_pause_name=""; fi' install/setup.sh | head -1 | cut -d: -f2-)"
  [ -n "$line" ] || bad "setup.sh's name-create line is not the subshell form"
  out="$(/bin/dash -c 'set -eu; _kosmos_pause_name=/nonexistent/dir/name; '"$line"'; echo "carried on: [$_kosmos_pause_name]"' 2>&1)"
  [ "$out" = "carried on: []" ] && ok "under dash, a name that cannot be made does not end the installer" || bad "under dash, a failed name create: $out"
  out="$(/bin/dash -c 'set -eu; x=/nonexistent/dir/name; : > "$x" 2>/dev/null || x=""; echo "carried on"' 2>&1)"
  case "$out" in *"carried on"*) bad "CONTROL: the plain form survived under dash, so the case above proves nothing" ;;
    *) ok "CONTROL: the plain form (: > f || ...) does end a dash script, so the subshell form matters" ;; esac
else
  echo "SKIP  dash cases: no /bin/dash here"
fi

# A full disk: the card's own case. A name is an empty file, so it needs no data block.
# kosmos#7127: this run's own volume name and its own mount point inside $TMP, so nothing is read back from hdiutil's
# output to decide where this run writes. A run stopped with kill -KILL never runs the EXIT trap, so its images stay
# mounted; with a fixed name macOS mounted the next as "/Volumes/s6651 1", and the old parse sent the writes to ./1/.
# The private mount point makes a collision harmless on its own. A same-named decoy, mounted the default way first,
# guards only against a future return to reading the mount point from hdiutil's output: with it in place, that would
# give "/Volumes/s6651-<pid> 1" and fail the full-disk case on every run.
# It is optional: if it cannot be mounted, a SKIP line says so and the full-disk case and the #7127 check still run,
# without the collision. (A killed run leaks the decoy at /Volumes/s6651-<pid> as well as its own image; neither can
# affect where a later run writes.)
if command -v hdiutil >/dev/null 2>&1; then
  # The same name as the image below on purpose: it is what WOULD collide if the mount point were parsed again.
  if hdiutil create -quiet -size 4m -fs APFS -volname "s6651-$$" "$TMP/decoy.dmg" >/dev/null 2>&1; then
    # $DECOY only records THAT the decoy mounted (the SKIP line and the PASS wording); cleanup finds and detaches it by
    # its own file (img_dev), never by this node, which macOS can reuse once the image goes.
    DECOY="$(hdiutil attach -nobrowse "$TMP/decoy.dmg" 2>/dev/null | awk 'NR == 1 { print $1 }')"
    # Anything but a device node means the output was not what this expects: treat the decoy as not mounted.
    case "$DECOY" in /dev/disk*) ;; *) DECOY="" ;; esac
  fi
  [ -n "$DECOY" ] || echo "SKIP  #7127 collision check: the decoy volume could not be mounted"
fi
# What the old parse may have left in this checkout before this run ("N/board.stopped", N being macOS's suffix): named
# in a NOTE below, never counted against this run. The #7127 check's new-file arm only flags an N/ file this run newly
# creates; the device-number arm beside it is what catches a write that lands anywhere but this run's image.
# Keyed on what the old flow always leaves: its fill, the logs/ it made, or any board.stopped* (the clear moves
# board.stopped aside, and a run killed mid-fill never wrote it).
is_debris() { [ -e "$1/fill" ] || [ -e "$1/logs" ] || ls "$1"/board.stopped* >/dev/null 2>&1; }
debris_before=""; for n in 1 2 3 4 5 6 7 8 9; do is_debris "$n" && debris_before="$debris_before $n"; done
if command -v hdiutil >/dev/null 2>&1 && mkdir -p "$TMP/mnt" \
   && hdiutil create -quiet -size 8m -fs APFS -volname "s6651-$$" "$TMP/full.dmg" >/dev/null 2>&1 \
   && hdiutil attach -quiet -nobrowse -mountpoint "$TMP/mnt" "$TMP/full.dmg" >/dev/null 2>&1 && DISK="$TMP/mnt"; then
  # Bounded (twice the 8 MB image), never "until the disk is full": if DISK were ever the wrong path, an unbounded dd
  # fills the real disk (kosmos#7127: a wrong mount-point parse once pointed it at a folder named "1").
  dd if=/dev/zero of="$DISK/fill" bs=1m count=16 2>/dev/null; dd if=/dev/zero of="$DISK/fill2" bs=4k count=4096 2>/dev/null
  ( printf 'x\n' > "$DISK/probe" ) >/dev/null 2>&1
  if [ -s "$DISK/probe" ]; then
    bad "fixture: the disk image is not full, so this proves nothing"
  else
    : > "$DISK/board.stopped" 2>/dev/null; : > "$DISK/board.stopped.by-install.$DEAD.$LTOK" 2>/dev/null
    { [ -e "$DISK/board.stopped" ] && [ -e "$DISK/board.stopped.by-install.$DEAD.$LTOK" ]; } \
      && ok "on a FULL disk the marker and the pause's name are still written" || bad "the marker or the name could not be written on a full disk"
    [ "$(KOSMOS_HOME="$DISK" verdict)" = stranded ] && ok "and read there as stranded once that update is gone" || bad "a full-disk pause read as stands"
    mkdir -p "$DISK/logs" 2>/dev/null
    out="$(KOSMOS_HOME="$DISK" kosmos_clear_stranded_pause full-disk 2>/dev/null)"
    { [ ! -e "$DISK/board.stopped" ] && [ -z "$out" ]; } && ok "the clear works on a full disk, and its failed log line does not leak to stdout" \
      || bad "full-disk clear: marker $( [ -e "$DISK/board.stopped" ] && echo left || echo gone ), stdout '$out'"
    # kosmos#7127: the writes went to this run's own image, a filesystem of its own, and not to ./1/ (where the old
    # parse sent them). The device check fails if the attach left $TMP/mnt a plain folder.
    new_debris=""; for n in 1 2 3 4 5 6 7 8 9; do
      is_debris "$n" && case " $debris_before " in *" $n "*) ;; *) new_debris="$new_debris $n" ;; esac
    done
    { [ "$(stat -f %d "$DISK")" != "$(stat -f %d "$TMP")" ] && [ -e "$DISK/fill" ] && [ -z "$new_debris" ]; } \
      && ok "the full-disk case writes to its own image$( [ -n "$DECOY" ] && echo ', not where a parsed mount point would put it') (#7127)" \
      || bad "the full-disk case wrote somewhere other than its own image (#7127)${new_debris:+: it wrote into${new_debris}}"
  fi
else
  echo "SKIP  full-disk case: hdiutil could not make or attach a disk image here (macOS only)"
fi
# Not this run's doing: an older run with the old parse wrote here, possibly a huge N/fill. Named whether or not this
# Mac could mount an image, and never failed on.
for n in $debris_before; do
  echo "NOTE  ./$n/ in $(pwd) is left over from an older run of this test (#7127): $(du -sh "$n" 2>/dev/null | awk '{ print $1 }'); remove it by hand"
done

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

# Evidence is kept, but only the newest ten clears.
reset; : > "$M"; name "$DEAD" "$LTOK"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do : > "$KOSMOS_HOME/board.stopped.stranded.10000000$i.1"; : > "$KOSMOS_HOME/board.stopped.stranded.10000000$i.1.by-install.$DEAD.x"; touch -t "2001010101$(printf %02d $i)" "$KOSMOS_HOME/board.stopped.stranded.10000000$i.1" "$KOSMOS_HOME/board.stopped.stranded.10000000$i.1.by-install.$DEAD.x"; done
kosmos_clear_stranded_pause test-prune
kept="$(ls -1 "$KOSMOS_HOME"/board.stopped.stranded.* | grep -vc by-install)"
[ "$kept" = 10 ] && ok "only the newest ten cleared pauses are kept as evidence" || bad "kept $kept cleared pauses"
[ ! -e "$KOSMOS_HOME/board.stopped.stranded.100000001.1.by-install.$DEAD.x" ] && ok "an old clear's names go with it" || bad "an old clear's names were left behind"

# The CLI's restore after a refused start puts an update's names back with the marker.
eval "$(awk '/^restore_stop_marker\(\) \{/ { on=1 } on { print } on && /^}$/ { exit }' install/kosmos)"
reset; STOP_MARKER="$M"; _had_stop_names="$KOSMOS_HOME/board.stopped.by-install.$DEAD.$LTOK"
restore_stop_marker
{ [ -e "$M" ] && [ -e "$_had_stop_names" ]; } && ok "a refused start puts the marker and the update's names back" || bad "restore lost the names"
_had_stop_names="$TMP/no-such-dir/name.x
$KOSMOS_HOME/board.stopped.by-install.$DEAD.$LTOK"; reset
out="$(set -euo pipefail; restore_stop_marker; echo carried-on)"
{ [ "$out" = carried-on ] && [ -e "$KOSMOS_HOME/board.stopped.by-install.$DEAD.$LTOK" ]; } \
  && ok "under pipefail, a name that cannot be put back does not end the CLI, and the rest are" || bad "restore under pipefail: '$out'"
_had_stop_names=""; reset; restore_stop_marker
{ [ -e "$M" ] && [ -z "$(ls "$KOSMOS_HOME"/board.stopped.by-install.* 2>/dev/null)" ]; } && ok "CONTROL: a person's marker is restored with no names" || bad "restore invented names"

# An agent's start whose clear backs off (a person's stop came in) refuses rather than starting over the stop.
eval "$(awk '/^agent_clear_stranded_or_refuse\(\) \{/ { on=1 } on { print } on && /^}$/ { exit }' install/kosmos)"
say() { printf '%s\n' "$*"; }
reset; : > "$M"   # the person's marker; the names are gone, so the clear backs off
out="$( _agent_clears_stranded=yes; agent_clear_stranded_or_refuse; echo went-ahead )"; rc=$?
case "$out" in *"stopped on purpose"*) ok "an agent's start whose clear backs off refuses (a person's stop came in)" ;; *) bad "agent clear backed off and went ahead: $out" ;; esac
reset; : > "$M"; name "$DEAD" "$LTOK"
out="$( _agent_clears_stranded=yes; agent_clear_stranded_or_refuse; echo went-ahead )"
{ [ "$out" = went-ahead ] && [ ! -e "$M" ]; } && ok "CONTROL: an agent's start with a stranded pause clears it and goes ahead" || bad "agent clear: $out"

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

# --- 3b. setup.sh's own decision lines, run under dash set -eu ---------------------------------------------------
FRAG="$(awk '/^  if ! _kosmos_mode_keeps_board_off && \[ ! -e "\$KOSMOS_HOME\/board.stopped" \]; then/ { on = 1 } /^  _kosmos_marker_ours="\$_kosmos_was_running"/ { exit } on { print }' install/setup.sh)"
[ -n "$FRAG" ] || bad "setup.sh's decision lines were not found"
printf '%s\n' "$B_CLI" > "$TMP/block.sh"; printf '%s\n' "$FRAG" > "$TMP/frag.sh"
SH=/bin/sh; [ -x /bin/dash ] && SH=/bin/dash
decide() { # $1 marker yes/no, $2 names none|live|gone|leftover, $3 mode none|run|connect, [$4 PATH prefix for the updater] -> "was join adopted named"
  reset
  [ "$1" = yes ] && : > "$M"
  case "$2" in
    live) name "$LIVE" "$LTOK" ;;
    gone) touch -t 202001010000 "$M" 2>/dev/null; name "$DEAD" "$LTOK" ;;
    leftover) name "$DEAD" "$LTOK"; touch -t 202001010000 "$KOSMOS_HOME/board.stopped.by-install.$DEAD.$LTOK"; date +%s > "$KOSMOS_HOME/board.started-at" ;;
  esac
  case "$3" in run) printf 'run\n' > "$KOSMOS_HOME/mode" ;; connect) printf 'connect\n' > "$KOSMOS_HOME/mode" ;; esac
  KOSMOS_HOME="$KOSMOS_HOME" PATH="${4:-}${4:+:}$PATH" "$SH" -c 'set -eu
    . "$1"
    _kosmos_mode_file=no; _kosmos_mode_word=""
    if [ -e "$KOSMOS_HOME/mode" ]; then _kosmos_mode_file=yes; _kosmos_mode_word="$(cat "$KOSMOS_HOME/mode")"; fi
    _kosmos_mode_keeps_board_off() { [ "$_kosmos_mode_file" = yes ] || return 1; case "$_kosmos_mode_word" in run|both) return 1 ;; esac; return 0; }
    _kosmos_linux_unit_killmode() { :; }
    _kosmos_was_running=no; _kosmos_join_pause=no; _kosmos_adopted_names=""
    . "$2"
    named=no; [ -n "$_kosmos_pause_name" ] && [ -e "$_kosmos_pause_name" ] && named=yes
    case "$_kosmos_pause_name" in *.unknown) named="$named(unknown)" ;; esac
    adopted=no; [ -n "$_kosmos_adopted_names" ] && adopted=yes
    echo "$_kosmos_was_running $_kosmos_join_pause $adopted $named"' sh "$TMP/block.sh" "$TMP/frag.sh" 2>&1
}
row() { # $1 marker $2 names $3 mode $4 expected $5 label [$6 PATH prefix for the updater]
  got="$(decide "$1" "$2" "$3" "${6:-}")"
  [ "$got" = "$4" ] && ok "setup.sh ($SH): $5" || bad "setup.sh ($SH): $5: got '$got', want '$4'"
}
row no  none none    "yes no no yes" "a running board: paused and named"
row no  none connect "no no no no"   "a connect computer: neither paused-running nor named"
row yes none run     "no no no no"   "a person's stop: left alone, no name"
row yes gone run     "yes no yes yes" "a stranded pause: adopted and named"
row yes gone connect "no no no no"   "a stranded pause on a connect computer: left alone"
row yes live run     "no yes no yes"  "another update's live pause: joined (named) but not adopted"
row yes leftover run "no no no no"    "a person's stop beside only a leftover name: neither joined nor adopted, no name"
row yes gone run "yes no yes yes(unknown)" "ps refused in the updater: adopting a stranded pause still names itself ('unknown')" "$TMP/badps"
row yes live run "no yes no yes(unknown)"  "ps refused in the updater: joining a live pause still names itself ('unknown')" "$TMP/badps"

# --- 4. the callers ---------------------------------------------------------------------------------------------
fnbody() { awk -v n="$2" '$0 ~ "^"n"\\(\\) \\{" { on=1 } on { print } on && /^}$/ { exit }' "$1"; }
# a person's stop: both of cmd_stop's marker writes are right after the name removal, which only an update skips
cnt="$(fnbody install/kosmos cmd_stop | awk '/KOSMOS_STOP_BY_INSTALL:-}" = 1 \] \|\| rm -f "\$STOP_MARKER".by-install/ { r = NR } /^ *: > "\$STOP_MARKER"/ { if (r && NR == r + 1) n++ } END { print n + 0 }')"
[ "$cnt" = 2 ] && ok "a person's stop removes an update's names just before each marker write ($cnt of 2)" || bad "cmd_stop's marker writes are not each preceded by the name removal ($cnt of 2)"
fnbody install/kosmos cmd_board_run | awk '/kosmos_clear_stranded_pause board-run/ { c = NR } /Kosmos was deliberately stopped; not starting/ { exit !(c) }' \
  && ok "board-run clears a stranded pause before it refuses" || bad "board-run does not clear a stranded pause first"
fnbody install/kosmos agent_board_guard | awk '/local _claim=/ { l = NR } /agent_clear_stranded_or_refuse/ { n++; if (!l || NR < l) bad = 1 } END { exit !(n == 2 && !bad) }' \
  && ok "an agent's start clears a stranded pause only after the cooldown and claim pass (both success returns)" \
  || bad "an agent's start clears a stranded pause before its cooldown or claim (or not on both success returns)"
! grep -q 'touch "\$_kosmos_pause_name"' install/setup.sh \
  && ok "setup.sh never touches its name after the stop (a touch would re-create a name a person's stop removed)" || bad "setup.sh touches its name after the stop"
awk '/^  _kosmos_pause_name=""$/ { if (!a) a = NR } /if \[ "\$_kosmos_was_running" = yes \] \|\| \[ "\$\{_kosmos_join_pause:-no\}" = yes \]; then/ { if (a && !w) w = NR }
     /: > "\$_kosmos_pause_name"/ { n = NR } /^  _kosmos_marker_ours="\$_kosmos_was_running"/ { m = NR }
     END { exit !(a && w > a && n > w && m > n) }' install/setup.sh \
  && ok "setup.sh names its pause only when pausing a running board, before the stop" || bad "setup.sh's pause name is not where it should be"
awk '/^_kosmos_on_exit\(\) \{/ { on = 1 } on && /rm -f "\$_kosmos_pause_name"/ { f = 1 } on && /_kosmos_adopted_names/ { g = 1 } on && /^}/ { exit !(f && g) }' install/setup.sh \
  && ok "setup.sh's EXIT trap removes its own pause name and the names it adopted" || bad "setup.sh's EXIT trap does not remove its own and adopted names"
awk '/_kosmos_join_pause=yes$/ { j = 1 } /if \[ "\$_kosmos_was_running" = yes \] \|\| \[ "\$\{_kosmos_join_pause:-no\}" = yes \]; then/ { if (j) w = 1 } END { exit !w }' install/setup.sh \
  && ok "an update that finds another update's live pause names itself too (it holds if that update is killed)" || bad "a second update does not name itself on a live pause"
fnbody install/kosmos cmd_start | grep -q '\[ "\$BOARD_STARTED_AT" -nt "\$_n" \] && continue' \
  && ok "a start does not save leftover names to put back (fresh, they would count again)" || bad "a start saves leftover names for its restore"
fnbody install/kosmos cmd_start | grep -q 'rm -f "$STOP_MARKER" "$STOP_MARKER".by-install.\* 2>/dev/null || true' \
  && ok "a start removes an update's names with the marker" || bad "a start leaves an update's names behind"
awk '/elif ! _kosmos_mode_keeps_board_off && kosmos_stranded_pause >\/dev\/null; then/ { on = 1; next } on && /^  fi$/ { exit } on && /rm -f/ { bad = 1 } END { exit bad }' install/setup.sh \
  && ok "adopting a stranded pause removes no names before this run's own exists" || bad "adoption removes the old names early"
grep -q 'if \[ -n "\$_kosmos_adopted_names" \] && \[ -z "\$_kosmos_pause_name" \]; then' install/setup.sh \
  && ok "an adopted pause this run could not name has its old names moved aside" || bad "an unnamed adoption keeps the old names"
grep -q 'elif ! _kosmos_mode_keeps_board_off && kosmos_stranded_pause >/dev/null; then' install/setup.sh \
  && ok "a later update adopts a stranded pause (its own put-back covers it)" || bad "a later update does not adopt a stranded pause"

echo
[ "$fails" -eq 0 ] && echo "test-stopmark-6651: all passed" || { echo "test-stopmark-6651: FAILED"; exit 1; }
