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
# it adds no destructive action of its own, with ONE exception (#4466): past
# BUSY_GRACE it runs `KOSMOS_RECLAIM_BUSY=1 kosmos start --force`, which authorises
# the #3079 reclaim (a kill) of this user's own Kosmos that holds the port and has
# not answered for BUSY_GRACE. `kosmos start` still does the kill; the watchdog
# grants it. See the busy-grace block below.
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

# The board's launchd label (derived from its plist name), and the launchctl to
# drive it. Used only for the wedged-port escalation below. The seam lets the test
# point launchctl at a stub; production uses the real one.
BOARD_LABEL="$(basename "$BOARD_PLIST" .plist)"
LAUNCHCTL="${KOSMOS_WATCHDOG_LAUNCHCTL:-/bin/launchctl}"

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
# A non-numeric override falls back to the default rather than feeding junk into the
# arithmetic (the persisted state values get the same treatment via num() below).
numdef() { case "$1" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
GRACE="$(numdef "${KOSMOS_WATCHDOG_GRACE:-}" 45)"
THROTTLE="$(numdef "${KOSMOS_WATCHDOG_THROTTLE:-}" 180)"
MAX_FAILS="$(numdef "${KOSMOS_WATCHDOG_MAX_FAILS:-}" 5)"
COOLDOWN="$(numdef "${KOSMOS_WATCHDOG_COOLDOWN:-}" 3600)"
# #4466: `kosmos status` exits 4 when the board holds its port but did not answer within its busy wait
# (20 s). That is usually a board BUSY with many agents, and restarting it is what turned slow answers
# into minute-long blackouts on an external tester's 25-agent board. It can also be a wedged board (#2955), which
# still needs recovering. So a busy reading counts toward the same down streak, but with this much
# longer grace before the first restart: a board that has not answered once in five minutes is wedged.
# (#4636: exit 5 is different: this shell cannot connect at all, so it tells nothing about the board and
# kicks nothing; see its branch below.)
BUSY_GRACE="$(numdef "${KOSMOS_WATCHDOG_BUSY_GRACE:-}" 300)"

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

# Atomic rewrite of the tracked keys. busy_since (#4466) is when the board was first seen BUSY in this
# streak (empty when it is not busy), so the busy grace runs from the busy reading, not from the start of
# a down streak it may have followed.
state_put() { # $1 down_since  $2 last_kickstart  $3 fail_count  [$4 busy_since]
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  local tmp="$STATE.tmp.$$"
  { printf 'down_since=%s\n' "$1"; printf 'last_kickstart=%s\n' "$2"; printf 'fail_count=%s\n' "$3"; printf 'busy_since=%s\n' "${4:-}"; } > "$tmp" 2>/dev/null \
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
BUSY_SINCE_RAW="$(state_get busy_since)"

# --- reboot reset: discard state from before this boot ----------------------
# The state file survives reboots. If down_since predates the current boot it is
# stale: on the first post-boot run the elapsed time would look huge (defeating the
# grace window) and a pre-reboot crash streak would carry over. A reboot is a fresh
# chance, so reset the whole streak. (If boot time cannot be read -- essentially
# never on stock macOS -- the reset is skipped and a pre-reboot down_since can carry
# in: the worst case is one redundant, idempotent kosmos start on the first post-boot
# run, since cmd_start no-ops when the board is already answering.)
BOOT="$(boot_epoch)"
UNREACH_MARK="$STATE_DIR/board-watchdog.unreachable"   # #4636: an exit-5 spell, logged once per 6 hours (see below)
if [ -n "$BOOT" ] && [ -n "$DOWN_SINCE_RAW" ] && [ "$(num "$DOWN_SINCE_RAW")" -lt "$BOOT" ]; then
  DOWN_SINCE_RAW=""; BUSY_SINCE_RAW=""; LAST_KICK=0; FAILS=0
  # A reboot is a fresh chance, so a pre-reboot crash-loop alert should not survive
  # into it (it would otherwise suppress the re-log and could surface a stale "keeps
  # crashing" state); a real new crash loop raises it again.
  rm -f "$ALERT" 2>/dev/null || true
fi

# --- healthy? then recovery took (or it never failed) -----------------------
# `kosmos status` exits 0 only when the board answers on its own port -- the CLI's
# own authoritative health check, so the watchdog cannot drift from it.
STATUS_RC=0
bash "$KOSMOS_BIN" status >/dev/null 2>&1 || STATUS_RC=$?
if [ "$STATUS_RC" -eq 0 ]; then
  [ -f "$ALERT" ] && { rm -f "$ALERT" 2>/dev/null || true; log "board healthy again; cleared crash-loop alert"; }
  rm -f "$UNREACH_MARK" 2>/dev/null || true   # #4636: an unreachable spell ends here too
  state_put "" "$LAST_KICK" 0             # clear the down streak and the fail count
  exit 0
fi

# #4636: status exit 5 is "a listener is there, but this shell cannot connect to it" (a sandbox, a network
# rule, a local network fault). The watchdog cannot tell anything about the board from here, and restarting
# it would not help, so it kicks nothing and ends any down streak and busy clock (a later down or busy reading
# starts a fresh grace). Accepted, like the busy/down flap below: a board whose status flips between 5 and 4 (or
# 1) on every tick restarts a clock each time and so is never recovered by the watchdog; under launchd, 5 comes
# only from a real local network fault, where a restart could not fix the kernel's state anyway.
if [ "$STATUS_RC" -eq 5 ]; then
  # Logged when the spell starts, and again every 6 hours while it lasts, so a long one is not silent. Any other
  # status reading ends the spell (its marker is removed; the gates above exit before reading one), so only an
  # unbroken run of exit-5 readings, across a reboot or a deliberate stop too, stays quiet between lines. If the marker cannot be written, this logs on every tick instead.
  if [ ! -f "$UNREACH_MARK" ] || [ "$(( $(now) - $(num "$(/usr/bin/stat -f %m "$UNREACH_MARK" 2>/dev/null)") ))" -ge 21600 ]; then
    log "cannot reach the board from this shell (status exit 5); leaving it alone until it can"
    : > "$UNREACH_MARK" 2>/dev/null || true
  fi
  state_put "" "$LAST_KICK" "$FAILS"
  exit 0
fi
rm -f "$UNREACH_MARK" 2>/dev/null || true

# --- board is down ----------------------------------------------------------
NOW="$(now)"
if [ -z "$DOWN_SINCE_RAW" ]; then
  # first observation: start the grace clock (and the busy one, if it is busy)
  if [ "$STATUS_RC" -eq 4 ]; then state_put "$NOW" "$LAST_KICK" "$FAILS" "$NOW"; else state_put "$NOW" "$LAST_KICK" "$FAILS"; fi
  exit 0
fi
DOWN_SINCE="$(num "$DOWN_SINCE_RAW")"

# #4466: a busy board (status exit 4) gets BUSY_GRACE, counted from when it was first seen BUSY. A board
# that was down for a while and has just come back slow is busy for the first time now: timing its grace
# from the down streak would reclaim (kill) it on its first busy reading.
# The cost, accepted: a truly wedged board (#2955, holds the port and never answers) now reads as busy and
# waits BUSY_GRACE (300 s) for its first recovery, not GRACE (45 s). A busy board is never killed before BUSY_GRACE.
if [ "$STATUS_RC" -eq 4 ]; then
  if [ -z "$BUSY_SINCE_RAW" ]; then state_put "$DOWN_SINCE" "$LAST_KICK" "$FAILS" "$NOW"; exit 0; fi
  [ "$((NOW - $(num "$BUSY_SINCE_RAW")))" -lt "$BUSY_GRACE" ] && exit 0
elif [ -n "$BUSY_SINCE_RAW" ]; then
  # Busy, now plainly down: the process that held the port is gone and launchd may be relaunching it.
  # That is a NEW down streak, so the busy clock stops and the down clock restarts (a fresh GRACE):
  # the old down_since would kick at once and kickstart -k could kill the board mid-boot.
  # Accepted: a board that alternates busy and down on EVERY tick resets a clock each time and so is
  # never restarted and never raises the crash-loop alert, the same as the up/down flap before it (a
  # healthy reading clears everything). It is taking connections, so it is alive at least half the time.
  BUSY_SINCE_RAW=""; state_put "$NOW" "$LAST_KICK" "$FAILS"; exit 0
fi

# still within grace: a legit start may be mid-boot
[ "$((NOW - DOWN_SINCE))" -lt "$GRACE" ] && exit 0

# --- crash-loop guard -------------------------------------------------------
# Once we have restarted MAX_FAILS times without the board becoming healthy, it is
# crash-looping rather than merely down. Stop restarting, raise the alert, and hold
# off for a long COOLDOWN before trying the burst again (the cause may have cleared
# by then, or a healthy board will reset us first).
if [ "$FAILS" -ge "$MAX_FAILS" ]; then
  if [ ! -f "$ALERT" ]; then
    # #4466: busy reclaims count toward MAX_FAILS too, and a board that holds the port without answering
    # is not "exiting", so the log says which of the two it was.
    if [ "$STATUS_RC" -eq 4 ]; then _why="board holds the port and does not answer"; else _why="board keeps exiting"; fi
    printf 'crash-loop: %s restarts did not hold; auto-restart paused for %ss\n' "$FAILS" "$COOLDOWN" > "$ALERT" 2>/dev/null || true
    log "crash-loop after $FAILS restarts; pausing auto-restart for ${COOLDOWN}s ($_why)"
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
# First attempt: a plain `kosmos start`. It is idempotent, needs no launchd, and
# handles the primary #2955 case (board cleanly dead, port free) without touching
# the fragile stop/start path.
#
# Escalation (a prior restart did not hold -> FAILS >= 1): the port is likely held
# by a wedged board process that exited "clean" from launchd's view but whose
# detached child still serves 16180 (observed on the Mortals box: job state
# not-running, last exit 0, yet a node listener persists). `kosmos start` refuses a
# held port, so instead `launchctl kickstart -k` the board's own login job -- that
# kills the job and the child launchd still tracks, then re-runs its `kosmos start`.
# This is the recovery that cleared Josh's box. It falls back to `kosmos start` if
# launchctl cannot drive the job (e.g. the job is not loaded), which is the case
# `kosmos start` is better at anyway.
#
# #4466: EXCEPT a board that is busy (status exit 4) past the busy grace. Every attempt on it is the
# reclaim-flagged start: the #3079 reclaim kills OUR listener on the port whoever tracks it, which
# covers what kickstart covers and also the detached holder kickstart cannot reach. Falling back to
# kickstart after one failed reclaim would leave that holder wedged until the cooldown.
if [ "$STATUS_RC" -ne 4 ] && [ "$FAILS" -ge 1 ] && "$LAUNCHCTL" kickstart -k "gui/$(/usr/bin/id -u)/$BOARD_LABEL" >> "$LOG" 2>&1; then
  log "board unanswering for $((NOW - DOWN_SINCE))s (failure $((FAILS + 1))); kickstart -k $BOARD_LABEL (port may be wedged)"
else
  log "board unanswering for $((NOW - DOWN_SINCE))s (failure $((FAILS + 1))); running kosmos start"
  # #4466: a board that has not answered for the whole busy grace (status exit 4) is wedged, so let
  # `kosmos start` reclaim a silent holder of our port instead of calling it "already running".
  # --force on both: the watchdog is not an agent, so the #4466 agent guard must not refuse it (the guard
  # reads the environment, and a watchdog launched from an agent's shell would otherwise inherit its markers).
  if [ "$STATUS_RC" -eq 4 ]; then
    KOSMOS_RECLAIM_BUSY=1 bash "$KOSMOS_BIN" start --force >> "$LOG" 2>&1 || true
  else
    bash "$KOSMOS_BIN" start --force >> "$LOG" 2>&1 || true
  fi
fi
# Count the attempt for the backoff/crash-loop guard; keep the down streak (the next
# run clears it, the fail count, and the alert if the restart took hold and the
# board now answers).
# A reclaim attempt ends that busy spell: if what comes up is busy too, it gets its own full grace, rather
# than relying on the throttle (THROTTLE x 2) happening to outlast BUSY_GRACE.
if [ "$STATUS_RC" -eq 4 ]; then BUSY_SINCE_RAW=""; fi
state_put "$DOWN_SINCE" "$NOW" "$((FAILS + 1))" "$BUSY_SINCE_RAW"
exit 0
