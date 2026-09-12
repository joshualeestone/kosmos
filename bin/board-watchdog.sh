#!/bin/bash
# com.kosmos.board.watchdog -- bring the Kosmos board back when it has died and
# the user did not deliberately stop it.
#
# WHY THIS EXISTS (kosmos#2955). The board's own login job (com.kosmos.board) is
# RunAtLoad + NO KeepAlive, deliberately: `kosmos start` daemonises and exits, so
# launchd fires it once at login and never supervises the real detached board
# process. If that process fails to start on boot (a zombie holding port 16180
# after an unclean power-down, a not-yet-ready dependency) or dies later (a
# crash), NOTHING relaunches it and the app is stuck on "could not refresh"
# forever. Josh hit exactly this after a restart on live 0.6.59. This watchdog is
# the missing supervision, done ADDITIVELY so it never touches the fragile
# stop/start/updater path that a foreground-mode rewrite would (that is Baron
# Draxum's separate done-right follow-up).
#
# It is cause-agnostic: it does not care WHY the board is down, only that it is
# down, has been down past a grace window, and was not stopped on purpose.
#
# SAFE TO RUN BLIND every interval. `kosmos start` is idempotent (no-ops when the
# board is already answering, refuses cleanly when a stranger holds the port), so
# the worst case of a spurious run is one no-op.

set -u

# KOSMOS_HOME is baked absolute into the plist's ProgramArguments at install time
# (setup.sh writes `... board-watchdog.sh <KOSMOS_HOME>`), so the watchdog never
# has to self-locate across the default/non-default (#883 hash-suffixed) installs.
# The env fallback covers a hand-run; the literal default is the last resort.
KOSMOS_HOME="${1:-${KOSMOS_HOME:-$HOME/.local/share/kosmos}}"
KOSMOS_BIN="$KOSMOS_HOME/bin/kosmos"

# The deliberate-stop marker. `kosmos stop` writes it (before it kills), `kosmos
# start` clears it (at the very top, before any bind that can fail). While it is
# present the user has chosen "stopped" and the watchdog must not fight that.
STOP_MARKER="$KOSMOS_HOME/board.stopped"

# Cross-run state: when the board first went unanswering, and when we last acted.
# One key=value file rather than several touch-files so a single read/write keeps
# it consistent. Lives beside the board log.
STATE_DIR="$KOSMOS_HOME/logs"
STATE="$STATE_DIR/board-watchdog.state"
LOG="$STATE_DIR/board-watchdog.log"

# The board must be unanswering for at least GRACE seconds before the first
# kickstart, so a legitimately in-flight start's bind time (cmd_start waits up to
# ~15s for the board to answer) is never mistaken for a failure and kickstarted.
# Kickstarts are then at most one per THROTTLE seconds, so a board that crashes on
# every start cannot thrash. Conservative defaults; tunable once the real
# post-reboot board.log is in hand (they do not change the logic).
GRACE="${KOSMOS_WATCHDOG_GRACE:-45}"
THROTTLE="${KOSMOS_WATCHDOG_THROTTLE:-180}"

now() { date +%s; }

# Read one key out of the state file; empty if absent/unset. The file is our own
# simple `key=value` lines, so a grep+cut is enough and cannot run anything.
state_get() {
  [ -f "$STATE" ] || return 0
  local line
  line="$(grep "^$1=" "$STATE" 2>/dev/null | tail -1)" || return 0
  printf '%s' "${line#*=}"
}

# Rewrite the state file with the two keys we track. Atomic (temp then rename) so
# a run reading it never sees a half-written file.
state_put() { # $1 down_since  $2 last_kickstart
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  local tmp="$STATE.tmp.$$"
  { printf 'down_since=%s\n' "$1"; printf 'last_kickstart=%s\n' "$2"; } > "$tmp" 2>/dev/null \
    && mv -f "$tmp" "$STATE" 2>/dev/null
  rm -f "$tmp" 2>/dev/null || true
}

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$1" >> "$LOG" 2>/dev/null || true; }

# Nothing to supervise if the CLI is not there (a partial/broken install); a
# watchdog that cannot start the board should do nothing rather than error-loop.
[ -f "$KOSMOS_BIN" ] || exit 0

# 1. Deliberate stop wins over everything. Do not even look at the port.
if [ -f "$STOP_MARKER" ]; then
  exit 0
fi

LAST_KICK="$(state_get last_kickstart)"; LAST_KICK="${LAST_KICK:-0}"

# 2. Answering? Then it is healthy -- clear any down streak and leave it alone.
#    `kosmos status` exits 0 only when the board answers on its own port, which is
#    the CLI's own authoritative health check, so the watchdog cannot drift from
#    it.
if bash "$KOSMOS_BIN" status >/dev/null 2>&1; then
  # Preserve last_kickstart (for the throttle), reset the down streak.
  state_put "" "$LAST_KICK"
  exit 0
fi

# 3. Down, and not deliberately stopped. Apply grace, then throttle, then act.
NOW="$(now)"
DOWN_SINCE="$(state_get down_since)"
if [ -z "$DOWN_SINCE" ]; then
  # First observation of this outage: start the grace clock and wait.
  state_put "$NOW" "$LAST_KICK"
  exit 0
fi

# Still within the grace window: a legit start may be mid-boot. Do not kickstart.
if [ "$((NOW - DOWN_SINCE))" -lt "$GRACE" ]; then
  exit 0
fi

# Throttled: we kickstarted recently and it is still down. Wait out the backoff
# rather than thrash a board that fails to come up on every attempt.
if [ "$((NOW - LAST_KICK))" -lt "$THROTTLE" ]; then
  exit 0
fi

# Down past the grace window and not throttled: bring it back. `kosmos start` is
# idempotent and refuses cleanly on a stranger port, so this is safe to run blind.
log "board unanswering for $((NOW - DOWN_SINCE))s; running 'kosmos start'"
bash "$KOSMOS_BIN" start >> "$LOG" 2>&1 || true
# Record the attempt for the throttle; keep the down streak (the next run clears
# it if the start took hold and the board now answers).
state_put "$DOWN_SINCE" "$NOW"
exit 0
