#!/bin/bash
# kosmos#8761: a kosmos-ci runner that takes no job while ANOTHER user's machine claim is live (Mortals: a release cut
# holds the box; a queued heavy turn writes the same file, "queued run", and pauses it too, which is wanted: the box is
# busy either way). One tick: run it every minute from its own LaunchAgent (how, below under "Installing it").
# Why not wait inside the job: tools/run-tests.sh does wait on the claim, but inside a job whose suite times out at 45
# minutes, so during a two-hour cut the runner would take queued jobs and time each one out red. Why not refuse in
# the job-started hook: a hook that exits non-zero fails the job red too. So the runner is stopped between jobs.
#
# Each tick:
#   - claim live, runner running with its Listener up, no job (no Runner.Worker of this user): stop it as the keepalive
#     stage does, `launchctl kill SIGTERM`, so the Listener ends its GitHub session. Its KeepAlive {SuccessfulExit:
#     false} does not restart a clean exit. A marker records that THIS pause stopped it. Refused before any stop: a
#     loaded KeepAlive true (it would restart at once). Waited on: a job running, or no Listener (restarting or
#     self-updating).
#   - no live claim on two ticks in a row, marker present: `launchctl kickstart` the runner and remove the marker
#     (once the pid it stopped has ended; the marker holds that pid).
#   - no live claim, no marker: nothing, and nothing logged. A runner someone stopped by hand is never started here.
#   - the claim cannot be read (its folder closed, not a file, no read permission): nothing changes, exit 1 every tick.
#
# A live claim, read as tools/lib/cut-guard.sh writes it: "<cookie> <pid> <expiry-epoch> <host> <label...>", at least
# five fields, numeric pid and expiry, expiry in the future, and the holder alive. A garbled or stale file is no claim
# (fail open, as cut-guard does: it must never park the runner). Two differences from cut-guard, both because this
# runs as a DIFFERENT user from the claim's holder:
#   - alive is `ps -p <pid>`, not `kill -0`: across users kill -0 says "operation not permitted" (rc 1) for a live
#     process, the same rc as a dead one, so it would read every live cut as crashed (measured 11-19, pid 1);
#   - the claim file is never removed here, live or stale: it is the holder's.
#
# Not closed, said so: a job the Listener has accepted but not yet handed to a Runner.Worker is not seen, and the SIGTERM
# cancels it (a red job, re-run by hand). How long that window is has NOT been measured (it spans the Listener's own
# round trips to GitHub), and it is armed at the start of every cut, not once by an operator as in the keepalive stage.
# Also open: if the runner comes back as a new pid during a claim (by hand, or launchd after an unclean exit), the
# pause refuses to stop it again and so stops pausing for the rest of that claim (exit 1, said every tick).
# A box that has never had a cut may have no marker folder yet: each tick then exits 1 ("cannot read") until the first
# cut creates it. The runner dir goes into an ERE with only its dots escaped (as ci-runner-setup.sh's own_listener_re):
# a dir with + ( or [ in its name would match no Listener, so the pause would wait forever (safe, but no pause).
# Not handled: a runner run as a LaunchDaemon (the daemon stage) is in the system domain, which this user cannot stop:
# refused, exit 1, every tick. Out of scope: a kosmos-relay runner under the same user is never stopped (its jobs do
# delay the pause, since pgrep cannot tell the two runners' Workers apart).
# Trust boundary: the runner's home is writable by its jobs, so a trusted job (ci-runner-job-guard.sh's model) can
# rewrite .service or the marker; a rewritten .service must still name a LaunchAgent directly in this home whose
# WorkingDirectory is the runner dir (as ci-runner-setup.sh's runner_plist), and a planted marker only makes a tick
# refuse loudly. A job that rewrites both .service and another runner's plist could aim the SIGTERM at that runner;
# that gains it nothing, since a job of this user can already run launchctl itself.
#
# Installing it (kosmos#8761: the Mortals install is PigeonPete's half, after this lands): as the runner user, a copy
# fetched and checked exactly as ci-runner-setup.sh's header "HOW kosmos-ci GETS THIS SCRIPT" says (curl the file at a
# main <commit>, compare its shasum -a 256 with the owner's `git show <commit>:<path>`), and a LaunchAgent ~/Library/LaunchAgents/
# com.kosmos.ci-claim-pause.plist with ProgramArguments [/bin/bash, <that copy>], StartInterval 60, RunAtLoad true,
# EnvironmentVariables KOSMOS_CI_CLAIM_FILE=<the claim>, StandardOutPath ~/.kosmos-ci/claim-pause.log; then
# `launchctl bootstrap gui/$(id -u) <plist>`. A ci-runner-setup.sh stage that writes it is not part of this change.
# Usage: ci-runner-claim-pause.sh            one tick; prints one line saying what it saw and did
# Settings: KOSMOS_CI_CLAIM_FILE (required: the claim to watch, e.g.
#   /Users/mortalkombat/.cache/kosmos-run-markers/machine-claim), KOSMOS_CI_RUNNER_DIR (default ~/actions-runner),
#   KOSMOS_CI_PAUSE_STATE (default ~/.kosmos-ci/claim-pause, holds the marker).
# Test seams: KOSMOS_CI_LAUNCHCTL, KOSMOS_CI_PGREP, KOSMOS_CI_PS, KOSMOS_CI_NOW, KOSMOS_CI_UID, KOSMOS_CI_DAEMON_DIR.
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
MARK="$STATE/paused-by-claim"      # holds the pid this pause stopped
CLEARED="$STATE/claim-cleared-once" # the claim was gone on the last tick

say() { printf 'claim-pause %s: %s\n' "$(date '+%F %T %Z')" "$*"; }
[ -n "$CLAIM" ] || { say "not set up: KOSMOS_CI_CLAIM_FILE is empty"; exit 2; }

# The claim, or nothing. Prints "<pid> <expiry> <label>" when live.
claim_live() {
  local line pid exp label now
  [ -f "$CLAIM" ] && [ -r "$CLAIM" ] || return 1
  line="$(cat "$CLAIM" 2>/dev/null)" || return 1
  # One count per line of the whole file, as cut-guard: more than one line is not a number, so no claim (there too).
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
AGENTS="$HOME/Library/LaunchAgents"
case "${plist#"$AGENTS"/}" in */*) say "not set up: $svc names $plist, not a LaunchAgent directly in $AGENTS"; exit 2 ;; esac
case "$plist" in "$AGENTS"/actions.runner.*.plist) ;; *) say "not set up: $svc names $plist, not an actions.runner LaunchAgent"; exit 2 ;; esac
label="$(basename "$plist" .plist)"
# The daemon stage moves the agent plist away and leaves .service naming it, so a daemon is found by its own plist or
# by launchd's system domain, never by .service.
if [ -e "${KOSMOS_CI_DAEMON_DIR:-/Library/LaunchDaemons}/$label.plist" ] || "$LAUNCHCTL" print "system/$label" >/dev/null 2>&1; then
  say "refused: $label runs as a LaunchDaemon (system domain), which this user cannot stop; the pause does nothing for it"; exit 1
fi
[ -f "$plist" ] && [ ! -L "$plist" ] || { say "not set up: $plist is not a regular file"; exit 2; }
wd="$(/usr/bin/plutil -extract WorkingDirectory raw -o - "$plist" 2>/dev/null)"
[ "$wd" = "$RUNNER_DIR" ] || { say "not set up: $plist runs in ${wd:-?}, not $RUNNER_DIR (another runner's?)"; exit 2; }
dom="gui/$uid"

printed="$("$LAUNCHCTL" print "$dom/$label" 2>/dev/null)"; prc=$?
rpid="$(printf '%s\n' "$printed" | sed -n 's/^[[:space:]]pid = \([0-9][0-9]*\)$/\1/p' | head -n 1)"

if live="$(claim_live)"; then
  rm -f "$CLEARED"   # the claim is live: a "gone once" from an earlier tick no longer counts
  hexp="$(printf '%s' "$live" | awk '{print $2}')"
  why="a live claim ($(printf '%s' "$live" | cut -d' ' -f3-), until $(date -r "$hexp" '+%H:%M' 2>/dev/null || echo "$hexp"))"
  [ "$prc" = 0 ] || { say "$why, but $label is not loaded in $dom: nothing to pause"; exit 0; }
  [ -n "$rpid" ] || { say "$why; $label is already stopped"; exit 0; }
  # A loaded KeepAlive true restarts even a clean exit, so a SIGTERM would only cut the Listener's GitHub session and
  # bring a new one up. Read as ci-runner-setup.sh's loaded_always does (measured there on macOS 27): a "keepalive"
  # property and no "successful exit => 0" semaphore.
  if printf '%s\n' "$printed" | sed -n 's/^[[:space:]]properties = //p' | tr '|' '\n' | grep -x -E '[[:space:]]*keepalive[[:space:]]*' >/dev/null \
     && ! printf '%s\n' "$printed" | grep -x -E '[[:space:]]*successful exit => 0' >/dev/null; then
    say "$why, but $label is loaded with KeepAlive true, which restarts a stopped runner: not stopping (run ci-runner-setup.sh keepalive)"; exit 1
  fi
  # Stopped by an earlier tick and still showing a pid under the same claim. The marker holds the pid this pause
  # stopped: the same pid is that process still ending (however long it takes); a different one is a NEW start (by
  # hand, or launchd after an unclean exit), and stopping again could loop, so refuse, loudly. That refusal lasts for
  # the rest of the claim: the pause stops pausing for that cut, said every tick (see "Not closed" above).
  if [ -f "$MARK" ]; then
    stopped="$(head -n 1 "$MARK" 2>/dev/null)"
    [ "$stopped" != "$rpid" ] || { say "$why; $label (pid $rpid) was told to stop and is still ending"; exit 0; }
    say "$why, but $label runs again as pid $rpid after this pause stopped pid ${stopped:-?} (started by hand, or by launchd after an unclean exit): not stopping it again this claim; remove $MARK to let the pause act"; exit 1
  fi
  # The service runs but no Listener of THIS runner does: between Listeners, or self-updating (it moves bin/ while
  # none runs). A SIGTERM now could end the updater half way (ci-runner-setup.sh's keepalive refuses the same state).
  # Matched as setup's own_listener_re: this runner dir's bin*/Runner.Listener by its argv start, not the relay's.
  lre="^$(printf '%s' "$RUNNER_DIR" | sed 's/[.]/[.]/g')/bin[^/]*/Runner[.]Listener( |\$)"
  lrc=0; "$PGREP" -u "$uid" -f "$lre" >/dev/null 2>&1 || lrc=$?
  [ "$lrc" -lt 2 ] || { say "$why, but pgrep failed (exit $lrc), so the Listener cannot be checked: not stopping"; exit 1; }
  [ "$lrc" = 0 ] || { say "$why; $label runs but no Listener of $RUNNER_DIR does (restarting or self-updating): waiting for the next tick"; exit 0; }
  wrc=0; "$PGREP" -u "$uid" -x Runner.Worker >/dev/null 2>&1 || wrc=$?
  [ "$wrc" -lt 2 ] || { say "$why, but pgrep failed (exit $wrc), so a job cannot be ruled out: not stopping"; exit 1; }
  [ "$wrc" = 1 ] || { say "$why; a job is running, so the runner is left to finish it"; exit 0; }
  mkdir -p "$STATE" 2>/dev/null && printf '%s\n' "$rpid" > "$MARK" || { say "$why, but the marker $MARK cannot be written: not stopping (it could not be restarted)"; exit 1; }
  "$LAUNCHCTL" kill SIGTERM "$dom/$label" >/dev/null 2>&1 || { rm -f "$MARK"; say "$why, but launchctl kill SIGTERM $dom/$label failed"; exit 1; }
  say "$why; no job running, so $label was stopped (SIGTERM); it starts again when the claim clears"
  exit 0
fi

# A claim this user cannot read: change nothing and say so, every tick (exit 1). Not "no claim": that would restart a
# runner this pause stopped while the cut may still hold the box, and would log all is well. The claim's folder must
# exist (on Mortals the marker dir is there between cuts, mode 755, measured on kosmos#8761); a folder that cannot be
# entered, a claim that is not a file, or one that cannot be read counts here.
cdir="$(dirname "$CLAIM")"
if [ ! -d "$cdir" ] || [ ! -x "$cdir" ] || { [ -e "$CLAIM" ] && { [ ! -f "$CLAIM" ] || [ ! -r "$CLAIM" ]; }; }; then
  say "cannot read $CLAIM (missing or closed folder, not a file, or no read permission): nothing changed, the runner stays $([ -f "$MARK" ] && echo paused || echo as it is)"
  exit 1
fi
if [ -f "$MARK" ] && [ -n "$rpid" ]; then
  # The claim cleared while the runner still shows a pid. The pid this pause stopped is still ending: a kickstart now
  # would do nothing to a running service, and its clean exit would then leave it down with no marker to bring it back,
  # so keep the marker and wait. A different pid was started some other way: nothing to undo.
  stopped="$(head -n 1 "$MARK" 2>/dev/null)"
  [ "$stopped" != "$rpid" ] || { say "no live claim; $label (pid $rpid) is still ending: starting it once it has"; exit 0; }
  rm -f "$MARK" "$CLEARED"; say "no live claim; $label is already running as pid $rpid (started another way)"; exit 0
fi
if [ -f "$MARK" ] && [ ! -f "$CLEARED" ]; then
  # Absent on two ticks in a row before starting it: a cut can release its claim and claim again between phases, and
  # a start in that gap could take a job a minute before the next tick pauses it again.
  : > "$CLEARED" 2>/dev/null || { say "no live claim, but $CLEARED cannot be written: not starting $label yet"; exit 1; }
  say "no live claim; starting $label next tick if the claim is still gone"; exit 0
fi
if [ -f "$MARK" ]; then
  "$LAUNCHCTL" kickstart "$dom/$label" >/dev/null 2>&1 || { say "no live claim, but launchctl kickstart $dom/$label failed (if it is not loaded: launchctl bootstrap $dom $plist); the marker stays, so the next tick tries again"; exit 1; }
  rm -f "$MARK" "$CLEARED"
  say "no live claim; $label was started again (this pause had stopped it)"
  exit 0
fi
# Nothing to do is the common case, every minute: say nothing, so the log holds only what changed or went wrong.
[ -z "${KOSMOS_CI_PAUSE_VERBOSE:-}" ] || say "no live claim; nothing to do"
exit 0
