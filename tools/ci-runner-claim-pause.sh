#!/bin/bash
# kosmos#8761: a kosmos-ci runner that takes no job while ANOTHER user's machine claim is live (Mortals: a release cut
# holds the box). One tick: run it every minute from its own LaunchAgent (tools/ci-runner-setup.sh claim-pause installs
# that). Why not wait inside the job: tools/run-tests.sh does wait on the claim, but inside a job whose suite times out
# at 45 minutes, so during a two-hour cut the runner would take queued jobs and time each one out red. Why not refuse in
# the job-started hook: a hook that exits non-zero fails the job red too. So the runner is stopped between jobs.
#
# Each tick:
#   - claim live, runner running, no job (no Runner.Worker of this user): stop it the way the keepalive stage does,
#     `launchctl kill SIGTERM`, so the Listener ends its GitHub session. Its KeepAlive {SuccessfulExit: false} does not
#     restart a clean exit. A marker records that THIS pause stopped it.
#   - claim live, a job running: leave it; the job finishes and a later tick stops the runner.
#   - no live claim, marker present: `launchctl kickstart` the runner and remove the marker.
#   - no live claim, no marker: nothing. A runner someone stopped by hand is never started here.
#
# A live claim, read as tools/lib/cut-guard.sh writes it: "<cookie> <pid> <expiry-epoch> <host> <label...>", at least
# five fields, numeric pid and expiry, expiry in the future, and the holder alive. Anything else is no claim (fail
# open, as cut-guard does: a garbled file must never park the runner). Two differences from cut-guard, both because
# this runs as a DIFFERENT user from the claim's holder:
#   - alive is `ps -p <pid>`, not `kill -0`: across users kill -0 says "operation not permitted" (rc 1) for a live
#     process, the same rc as a dead one, so it would read every live cut as crashed (measured 11-19, pid 1);
#   - the claim file is never removed here, live or stale: it is the holder's.
#
# Not closed, said so: a job the Listener accepts between the Runner.Worker check and the SIGTERM is cancelled and
# needs a re-run (the keepalive stage accepts the same window). A runner run as a LaunchDaemon (the daemon stage) is in
# the system domain, which this user cannot stop: refused, exit 1.
#
# Installing it (kosmos#8761: the Mortals install is PigeonPete's half, after this lands): as the runner user, a copy
# pinned like ci-runner-setup.sh (same <commit>, shasum checked), and a LaunchAgent ~/Library/LaunchAgents/
# com.kosmos.ci-claim-pause.plist with ProgramArguments [/bin/bash, <that copy>], StartInterval 60, RunAtLoad true,
# EnvironmentVariables KOSMOS_CI_CLAIM_FILE=<the claim>, StandardOutPath ~/.kosmos-ci/claim-pause.log; then
# `launchctl bootstrap gui/$(id -u) <plist>`. A ci-runner-setup.sh stage that writes it is not part of this change.
# Usage: ci-runner-claim-pause.sh            one tick; prints one line saying what it saw and did
# Settings: KOSMOS_CI_CLAIM_FILE (required: the claim to watch, e.g.
#   /Users/mortalkombat/.cache/kosmos-run-markers/machine-claim), KOSMOS_CI_RUNNER_DIR (default ~/actions-runner),
#   KOSMOS_CI_PAUSE_STATE (default ~/.kosmos-ci/claim-pause, holds the marker).
# Test seams: KOSMOS_CI_LAUNCHCTL, KOSMOS_CI_PGREP, KOSMOS_CI_PS, KOSMOS_CI_NOW, KOSMOS_CI_UID.
# Exit: 0 a tick done (whatever it did), 1 it could not act (said why), 2 not set up (no claim file setting, no runner).
PATH=/usr/bin:/bin
set -u
LAUNCHCTL="${KOSMOS_CI_LAUNCHCTL:-/bin/launchctl}"
PGREP="${KOSMOS_CI_PGREP:-/usr/bin/pgrep}"
PS="${KOSMOS_CI_PS:-/bin/ps}"
CLAIM="${KOSMOS_CI_CLAIM_FILE:-}"
RUNNER_DIR="${KOSMOS_CI_RUNNER_DIR:-$HOME/actions-runner}"
STATE="${KOSMOS_CI_PAUSE_STATE:-$HOME/.kosmos-ci/claim-pause}"
uid="${KOSMOS_CI_UID:-$(id -u)}"
MARK="$STATE/paused-by-claim"

say() { printf 'claim-pause %s: %s\n' "$(date '+%H:%M:%S')" "$*"; }
[ -n "$CLAIM" ] || { say "not set up: KOSMOS_CI_CLAIM_FILE is empty"; exit 2; }

# The claim, or nothing. Prints "<pid> <expiry> <label>" when live.
claim_live() {
  local line pid exp label now
  [ -f "$CLAIM" ] && [ -r "$CLAIM" ] || return 1
  line="$(head -n 1 "$CLAIM" 2>/dev/null)" || return 1
  [ "$(printf '%s' "$line" | awk '{print NF}')" -ge 5 ] 2>/dev/null || return 1
  pid="$(printf '%s' "$line" | awk '{print $2}')"
  exp="$(printf '%s' "$line" | awk '{print $3}')"
  label="$(printf '%s' "$line" | awk '{$1=$2=$3=$4=""; sub(/^ +/,""); print}')"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  case "$exp" in ''|*[!0-9]*) return 1 ;; esac
  now="${KOSMOS_CI_NOW:-$(date +%s)}"
  [ "$exp" -gt "$now" ] || return 1
  "$PS" -p "$pid" -o pid= >/dev/null 2>&1 || return 1
  printf '%s %s %s' "$pid" "$exp" "$label"
}

# The runner's LaunchAgent label, as svc.sh install recorded it (the keepalive stage reads the same file).
svc="$RUNNER_DIR/.service"
[ -f "$svc" ] && [ ! -L "$svc" ] || { say "not set up: no $svc (is the runner installed with svc.sh?)"; exit 2; }
plist="$(head -n 1 "$svc")"
label="$(basename "$plist" .plist)"
case "$label" in actions.runner.*) ;; *) say "not set up: $svc names $plist, not an actions.runner LaunchAgent"; exit 2 ;; esac
case "$plist" in /Library/LaunchDaemons/*) say "refused: $label is a LaunchDaemon (system domain), which this user cannot stop"; exit 1 ;; esac
dom="gui/$uid"

printed="$("$LAUNCHCTL" print "$dom/$label" 2>/dev/null)"; prc=$?
rpid="$(printf '%s\n' "$printed" | sed -n 's/^[[:space:]]pid = \([0-9][0-9]*\)$/\1/p' | head -n 1)"

if live="$(claim_live)"; then
  hexp="$(printf '%s' "$live" | awk '{print $2}')"
  why="a live claim ($(printf '%s' "$live" | cut -d' ' -f3-), until $(date -r "$hexp" '+%H:%M' 2>/dev/null || echo "$hexp"))"
  [ "$prc" = 0 ] || { say "$why, but $label is not loaded in $dom: nothing to pause"; exit 0; }
  [ -n "$rpid" ] || { say "$why; $label is already stopped"; exit 0; }
  # Stopped by an earlier tick and running again under the same claim: launchd restarted it (a loaded KeepAlive true,
  # not the {SuccessfulExit: false} the keepalive stage writes) or someone started it. Stopping again would loop.
  [ ! -f "$MARK" ] || { say "$why, but $label runs again after this pause stopped it (KeepAlive true, or started by hand): not stopping it again"; exit 1; }
  wrc=0; "$PGREP" -u "$uid" -x Runner.Worker >/dev/null 2>&1 || wrc=$?
  [ "$wrc" -lt 2 ] || { say "$why, but pgrep failed (exit $wrc), so a job cannot be ruled out: not stopping"; exit 1; }
  [ "$wrc" = 1 ] || { say "$why; a job is running, so the runner is left to finish it"; exit 0; }
  mkdir -p "$STATE" 2>/dev/null && : > "$MARK" || { say "$why, but the marker $MARK cannot be written: not stopping (it could not be restarted)"; exit 1; }
  "$LAUNCHCTL" kill SIGTERM "$dom/$label" >/dev/null 2>&1 || { rm -f "$MARK"; say "$why, but launchctl kill SIGTERM $dom/$label failed"; exit 1; }
  say "$why; no job running, so $label was stopped (SIGTERM); it starts again when the claim clears"
  exit 0
fi

if [ -f "$MARK" ]; then
  "$LAUNCHCTL" kickstart "$dom/$label" >/dev/null 2>&1 || { say "no live claim, but launchctl kickstart $dom/$label failed; the marker stays, so the next tick tries again"; exit 1; }
  rm -f "$MARK"
  say "no live claim; $label was started again (this pause had stopped it)"
  exit 0
fi
say "no live claim; nothing to do"
exit 0
