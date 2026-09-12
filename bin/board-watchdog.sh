#!/bin/bash
# com.kosmos.board.watchdog -- bring the Kosmos board back when it has died, the
# user wants it running, and it is not merely crash-looping.
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
# It delegates recovery entirely to `kosmos start` (idempotent: no-ops when the
# board is already answering, refuses cleanly when a stranger holds the port), so
# it adds no destructive action of its own.
#
# THREE things gate a recovery, and all three must hold:
#   1. the user has NOT deliberately stopped the board (no stop-marker), AND
#   2. the board is SUPPOSED to auto-start (its login job is installed) -- this is
#      the existing "they come back after a restart" control (engine/machine.js
#      restartCheck / boardAutostartCheck), not a new toggle, AND
#   3. the board has been unanswering past a grace window and is not crash-looping.
#
# Josh's board.log showed 23 "server exited unexpectedly" in a burst: the board
# CRASHES, it does not merely fail to start once. So a bare "restart whenever 16180
# is dead" would thrash a crash-looping board forever. The crash-loop guard bounds
# the restarts, backs off, and raises an alert.

set -u

# Baked into the plist at install time (setup.sh): $1 = KOSMOS_HOME, $2 = the
# board's own login-job plist path (whichever #883 label this install uses). The
# fallbacks cover a hand-run.
KOSMOS_HOME="${1:-${KOSMOS_HOME:-$HOME/.local/share/kosmos}}"
BOARD_PLIST="${2:-$HOME/Library/LaunchAgents/com.kosmos.board.plist}"
KOSMOS_BIN="$KOSMOS_HOME/bin/kosmos"

# The deliberate-stop marker (`kosmos stop` writes it, `kosmos start` clears it).
STOP_MARKER="$KOSMOS_HOME/board.stopped"

STATE_DIR="$KOSMOS_HOME/logs"
STATE="$STATE_DIR/board-watchdog.state"
LOG="$STATE_DIR/board-watchdog.log"
# Raised when the board has crash-looped past MAX_FAILS: a marker the board/UI can
# later surface ("Kosmos keeps crashing"). Cleared the moment the board is healthy.
ALERT="$STATE_DIR/board-watchdog.alert"

# The board must be unanswering for GRACE seconds before the first restart, so a
# legitimately in-flight start's bind time (cmd_start waits ~15s) is not treated as
# a failure. Then at most one restart per THROTTLE seconds, growing with the
# consecutive-failure count (backoff). After MAX_FAILS restarts that never took, we
# stop and alert, and only try again after COOLDOWN -- so a board that dies on every
# start cannot thrash. Conservative defaults, tunable via the env; they change the
# pace, never the logic.
GRACE="${KOSMOS_WATCHDOG_GRACE:-45}"
THROTTLE="${KOSMOS_WATCHDOG_THROTTLE:-180}"
MAX_FAILS="${KOSMOS_WATCHDOG_MAX_FAILS:-5}"
COOLDOWN="${KOSMOS_WATCHDOG_COOLDOWN:-3600}"

now() { date +%s; }

# The machine's boot time, epoch seconds, or empty if it cannot be read. Used to
# discard state left over from before a reboot (see below).
boot_epoch() {
  local b
  b="$(/usr/sbin/sysctl -n kern.boottime 2>/dev/null)" || return 0
  # "{ sec = 1699999999, usec = 123456 } Tue ..." -> 1699999999
  b="${b#*sec = }"; b="${b%%,*}"
  case "$b" in ''|*[!0-9]*) return 0 ;; *) printf '%s' "$b" ;; esac
}

# A state value, defaulted to 0 and forced numeric so a truncated/hand-edited file
# can never feed a non-number into the arithmetic below (it just reads as 0 and the
# run self-corrects next tick).
num() { case "$1" in ''|*[!0-9]*) printf '0' ;; *) printf '%s' "$1" ;; esac; }

state_get() {
  [ -f "$STATE" ] || return 0
  local line
  line="$(grep "^$1=" "$STATE" 2>/dev/null | tail -1)" || return 0
  printf '%s' "${line#*=}"
}

# Atomic rewrite of the three tracked keys.
state_put() { # $1 down_since  $2 last_kickstart  $3 fail_count
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  local tmp="$STATE.tmp.$$"
  { printf 'down_since=%s\n' "$1"; printf 'last_kickstart=%s\n' "$2"; printf 'fail_count=%s\n' "$3"; } > "$tmp" 2>/dev/null \
    && mv -f "$tmp" "$STATE" 2>/dev/null
  rm -f "$tmp" 2>/dev/null || true
}

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$1" >> "$LOG" 2>/dev/null || true; }

# --- gate 1: nothing to supervise / user turned it off ----------------------
[ -f "$KOSMOS_BIN" ] || exit 0            # broken/partial install: do nothing
[ -f "$STOP_MARKER" ] && exit 0           # deliberate stop: stay out
# gate 2: the board is SUPPOSED to auto-start. If its login job is gone the user
# has auto-restart off (or is mid-uninstall), so the watchdog must not resurrect it.
[ -f "$BOARD_PLIST" ] || exit 0

LAST_KICK="$(num "$(state_get last_kickstart)")"
FAILS="$(num "$(state_get fail_count)")"
DOWN_SINCE_RAW="$(state_get down_since)"

# --- reboot reset: discard state from before this boot ----------------------
# The state file survives reboots. If down_since predates the current boot it is
# stale: on the first post-boot run the elapsed time would look huge (defeating the
# grace window) and a pre-reboot crash streak would carry over. A reboot is a fresh
# chance, so reset the whole streak. (If boot time cannot be read we simply skip
# this and rely on grace as before.)
BOOT="$(boot_epoch)"
if [ -n "$BOOT" ] && [ -n "$DOWN_SINCE_RAW" ] && [ "$(num "$DOWN_SINCE_RAW")" -lt "$BOOT" ]; then
  DOWN_SINCE_RAW=""; LAST_KICK=0; FAILS=0
fi

# --- healthy? then recovery took (or it never failed) -----------------------
# `kosmos status` exits 0 only when the board answers on its own port -- the CLI's
# own authoritative health check, so the watchdog cannot drift from it.
if bash "$KOSMOS_BIN" status >/dev/null 2>&1; then
  [ -f "$ALERT" ] && { rm -f "$ALERT" 2>/dev/null || true; log "board healthy again; cleared crash-loop alert"; }
  state_put "" "$LAST_KICK" 0             # clear the down streak and the fail count
  exit 0
fi

# --- board is down ----------------------------------------------------------
NOW="$(now)"
if [ -z "$DOWN_SINCE_RAW" ]; then
  state_put "$NOW" "$LAST_KICK" "$FAILS"  # first observation: start the grace clock
  exit 0
fi
DOWN_SINCE="$(num "$DOWN_SINCE_RAW")"

# still within grace: a legit start may be mid-boot
[ "$((NOW - DOWN_SINCE))" -lt "$GRACE" ] && exit 0

# --- crash-loop guard -------------------------------------------------------
# Once we have restarted MAX_FAILS times without the board becoming healthy, it is
# crash-looping rather than merely down. Stop restarting, raise the alert, and hold
# off for a long COOLDOWN before trying the burst again (the cause may have cleared
# by then, or a healthy board will reset us first).
if [ "$FAILS" -ge "$MAX_FAILS" ]; then
  if [ ! -f "$ALERT" ]; then
    printf 'crash-loop: %s restarts did not hold; auto-restart paused for %ss\n' "$FAILS" "$COOLDOWN" > "$ALERT" 2>/dev/null || true
    log "crash-loop after $FAILS restarts; pausing auto-restart for ${COOLDOWN}s (board keeps exiting)"
  fi
  [ "$((NOW - LAST_KICK))" -lt "$COOLDOWN" ] && exit 0
  FAILS=0                                  # cooldown elapsed: try one more burst
fi

# --- backoff throttle -------------------------------------------------------
# Wait longer between attempts as failures accumulate, so even within a burst we do
# not hammer. Bounded by COOLDOWN.
WAIT="$((THROTTLE * (FAILS + 1)))"
[ "$WAIT" -gt "$COOLDOWN" ] && WAIT="$COOLDOWN"
[ "$((NOW - LAST_KICK))" -lt "$WAIT" ] && exit 0

# --- restart ----------------------------------------------------------------
log "board unanswering for $((NOW - DOWN_SINCE))s (failure $((FAILS + 1))); running 'kosmos start'"
bash "$KOSMOS_BIN" start >> "$LOG" 2>&1 || true
# Count the attempt for the backoff/crash-loop guard; keep the down streak (the next
# run clears it, the fail count, and the alert if the start took hold and the board
# now answers).
state_put "$DOWN_SINCE" "$NOW" "$((FAILS + 1))"
exit 0
