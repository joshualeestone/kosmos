#!/bin/bash
# kosmos#6667: `kosmos board-revive`, the Linux pause check's command, decides from the real install/kosmos with a
# stub systemctl on PATH. It clears only a stranded update pause (#6651's kosmos_stranded_pause), only while the
# board's unit is enabled, then asks systemd to start the board; every other stop is left alone. The live run on real
# systemd is tools/test-linux-pause-check-live-6667.sh (CI, linux-systemd.yml); this one runs anywhere.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
KOSMOS="$REPO/install/kosmos"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test-board-revive-6667.XXXXXX")" || { echo "FAIL  no temp dir"; exit 1; }
[ -n "$ROOT" ] && [ -d "$ROOT" ] || { echo "FAIL  no temp dir"; exit 1; }
LIVE_PID=""
trap '[ -n "$LIVE_PID" ] && { kill "$LIVE_PID" 2>/dev/null; wait "$LIVE_PID" 2>/dev/null; }; rm -rf "${ROOT:?}"' EXIT

# The stub: records every call; is-enabled answers $STUB_ENABLED; start exits $STUB_START_RC.
mkdir -p "$ROOT/bin"
cat > "$ROOT/bin/systemctl" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$STUB_LOG"
case " $* " in
  *" is-enabled "*) printf '%s\n' "${STUB_ENABLED:-enabled}" ;;
  *" start "*) exit "${STUB_START_RC:-0}" ;;
esac
exit 0
SH
chmod +x "$ROOT/bin/systemctl"

# A pid that has provably ended: a child that exits at once, reaped.
sh -c 'exit 0' & DEAD_PID=$!; wait "$DEAD_PID" 2>/dev/null
# A pid that is running, with the token kosmos itself would record for it (install/kosmos is sourceable, #3079).
sleep 300 & LIVE_PID=$!
LIVE_TOK="$(KOSMOS_HOME="$ROOT/none" bash -c '. "$1" >/dev/null 2>&1; kosmos_start_token "$2"' _ "$KOSMOS" "$LIVE_PID")"
[ -n "$LIVE_TOK" ] || bad "premise: no start token for a live pid"

n=0
# fresh <name>: a home with the board started an hour ago and the marker present (a stop).
fresh() {
  n=$((n+1)); H="$ROOT/home$n-$1"; mkdir -p "$H/logs"
  : > "$H/board.started-at"; touch -t 202601010000 "$H/board.started-at"
  : > "$H/board.stopped"
  STUB_LOG="$ROOT/calls$n"; : > "$STUB_LOG"
}
revive() {
  PATH="$ROOT/bin:/usr/bin:/bin" KOSMOS_HOME="$H" STUB_LOG="$STUB_LOG" bash "$KOSMOS" board-revive >/dev/null 2>&1
}
started() { grep -q -- '--user start --no-block kosmos-board' "$STUB_LOG"; }

# 1. A killed update's pause, unit enabled: cleared (kept aside) and the board asked to start.
fresh stranded; : > "$H/board.stopped.by-install.$DEAD_PID.ps_12345"
STUB_ENABLED=enabled revive; rc=$?
if [ "$rc" = 0 ] && [ ! -e "$H/board.stopped" ] && ls "$H"/board.stopped.stranded.* >/dev/null 2>&1 && started; then
  ok "a killed update's pause is cleared and the board is started"
else
  bad "a killed update's pause: rc=$rc marker=$([ -e "$H/board.stopped" ] && echo kept || echo gone) calls=$(tr '\n' '|' < "$STUB_LOG")"
fi
grep -q 'pause-check: cleared a stranded update pause' "$H/logs/board-watchdog.log" 2>/dev/null \
  && ok "the clear is logged as the pause check's" || bad "the clear was not logged as the pause check's"

# 2. CONTROL: a person's stop (a marker, no update's name) stays, and nothing is started.
fresh person
STUB_ENABLED=enabled revive; rc=$?
[ "$rc" = 0 ] && [ -e "$H/board.stopped" ] && ! started && ok "a person's stop is left alone" \
  || bad "a person's stop: rc=$rc marker=$([ -e "$H/board.stopped" ] && echo kept || echo gone) calls=$(tr '\n' '|' < "$STUB_LOG")"

# 3. An update still running holds its pause.
fresh live; : > "$H/board.stopped.by-install.$LIVE_PID.$LIVE_TOK"
STUB_ENABLED=enabled revive
[ -e "$H/board.stopped" ] && ! started && ok "a running update's pause is left alone" || bad "a running update's pause was cleared"

# 4. A dead update's name older than the board's last start is a leftover: the stop beside it is a person's.
fresh leftover; : > "$H/board.stopped.by-install.$DEAD_PID.ps_12345"; touch -t 202501010000 "$H/board.stopped.by-install.$DEAD_PID.ps_12345"
STUB_ENABLED=enabled revive
[ -e "$H/board.stopped" ] && ! started && ok "a leftover name beside a later stop is left alone" || bad "a leftover name's stop was cleared"

# 5. A computer set not to run a board (mode other than run or both) keeps its stop.
fresh mode; : > "$H/board.stopped.by-install.$DEAD_PID.ps_12345"; printf 'agents\n' > "$H/mode"
STUB_ENABLED=enabled revive
[ -e "$H/board.stopped" ] && ! started && ok "a computer set not to run a board keeps its stop" || bad "mode was ignored"

# 6. The board's unit is not enabled (it is not supposed to start): nothing is cleared.
fresh disabled; : > "$H/board.stopped.by-install.$DEAD_PID.ps_12345"
STUB_ENABLED=disabled revive
[ -e "$H/board.stopped" ] && ! started && ok "with the board's unit not enabled, the pause is left alone" || bad "a disabled board's pause was cleared"

# 7. No marker: nothing to do, systemd is not asked anything.
fresh nomarker; rm -f "$H/board.stopped"
STUB_ENABLED=enabled revive; rc=$?
[ "$rc" = 0 ] && [ ! -s "$STUB_LOG" ] && ok "with no marker, systemd is not asked" || bad "no marker: rc=$rc calls=$(tr '\n' '|' < "$STUB_LOG")"

# 8. systemd refuses the start: exit 1 and a log line, never a quiet success.
fresh refused; : > "$H/board.stopped.by-install.$DEAD_PID.ps_12345"
STUB_ENABLED=enabled STUB_START_RC=1 revive; rc=$?
[ "$rc" = 1 ] && grep -q 'systemd would not start' "$H/logs/board-watchdog.log" 2>/dev/null \
  && ok "a refused start exits 1 and is logged" || bad "a refused start: rc=$rc"

# 9. setup.sh's uninstall names the pause check the way engine/linuxboard.js does, for the default home and another
# (the two helpers are lifted out of setup.sh, which cannot be sourced: it installs). The homes are already normalized,
# as setup.sh makes KOSMOS_HOME before these run (a doubled slash would hash differently there, by design).
fns="$(awk '/^_kosmos_linux_unit_name\(\) \{$/,/^\}$/; /^_kosmos_linux_pause_check_names\(\) \{$/,/^\}$/' "$REPO/install/setup.sh")"
[ "$(printf '%s\n' "$fns" | grep -c '() {$')" = 2 ] || bad "premise: both helpers were not found in setup.sh"
for kh in "$HOME/.local/share/kosmos" "/srv/kosmos other home"; do
  sh_names="$(KOSMOS_HOME="$kh" _kosmos_home_default="$HOME/.local/share/kosmos" bash -c "$fns"'
    _kosmos_linux_pause_check_names' 2>&1)"
  js_names="$(node -e 'const n = require(process.argv[1]).pauseCheckNames(process.argv[2]); console.log(n.timer + "\n" + n.service)' \
    "$REPO/engine/linuxboard.js" "$kh" 2>&1)"
  [ -n "$sh_names" ] && [ "$sh_names" = "$js_names" ] && ok "setup.sh and linuxboard.js name the pause check alike (${kh##*/})" \
    || bad "the pause check's names differ for ${kh##*/}: setup.sh [$sh_names] linuxboard.js [$js_names]"
done

[ "$fails" = 0 ] && echo "board-revive: 0 failures" || echo "board-revive: FAILURES"
exit "$fails"
