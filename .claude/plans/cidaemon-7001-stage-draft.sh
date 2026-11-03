# daemon (kosmos#7001): run THIS runner as a LaunchDaemon in the system domain, as the CI user (UserName), so no logout
# and no WindowServer crash can take it down. On 2026-11-03 13:09 the old Agent1s Mac's WindowServer crashed, loginwindow
# logged out every GUI session, and the runner's LaunchAgent went with its gui/<uid> domain: KeepAlive restarts a job
# inside its domain, and the domain was gone. The daemon is built from the runner's own LaunchAgent (svc.sh's template
# already names UserName and SessionCreate), plus HOME and USER (a daemon is not given them) and the keepalive keys.
# The LaunchAgent is moved aside, not deleted, so a later login cannot start a second Listener and a rollback is one mv.
# A dry run reads only, as root or as the CI user (another user cannot read the CI user's home or its processes' argv).
DAEMON_DIR="${KOSMOS_CI_DAEMON_DIR:-/Library/LaunchDaemons}"   # a test seam; launchd reads only the real one
# daemon_set <plist>: the daemon plist has every key this stage writes, each typed as launchd reads it.
daemon_set() {
  [ "$(plutil -extract UserName raw -o - "$1" 2>/dev/null || true)" = "$CI_USER" ] \
    && [ "$(plutil -extract EnvironmentVariables.HOME raw -o - "$1" 2>/dev/null || true)" = "$CI_HOME" ] \
    && [ "$(plutil -extract EnvironmentVariables.USER raw -o - "$1" 2>/dev/null || true)" = "$CI_USER" ] \
    && [ "$(plutil -extract WorkingDirectory raw -o - "$1" 2>/dev/null || true)" = "$RUNNER_DIR" ] \
    && [ "$(plutil -extract ProgramArguments.0 raw -o - "$1" 2>/dev/null || true)" = "$RUNNER_DIR/runsvc.sh" ] \
    && case "$(plutil -extract RunAtLoad xml1 -o - "$1" 2>/dev/null || true)" in *"<true/>"*) true ;; *) false ;; esac \
    && ! plutil -extract LimitLoadToSessionType raw -o - "$1" >/dev/null 2>&1 \
    && keepalive_set "$1"
}
# build_daemon <from LaunchAgent plist> <to>: the agent's plist, made a daemon, written to <to> (a temp file).
build_daemon() {
  cp "$1" "$2" || return 1
  plutil -replace UserName -string "$CI_USER" "$2" \
    && plutil -remove LimitLoadToSessionType "$2" >/dev/null 2>&1 || true
  plutil -extract EnvironmentVariables raw -o - "$2" >/dev/null 2>&1 || plutil -insert EnvironmentVariables -dictionary "$2" || return 1
  plutil -replace EnvironmentVariables.HOME -string "$CI_HOME" "$2" \
    && plutil -replace EnvironmentVariables.USER -string "$CI_USER" "$2" \
    && plutil -replace RunAtLoad -bool true "$2" || return 1
  add_keepalive "$2" >/dev/null || return 1   # the same three keys, written the same way, as the keepalive stage
  plutil -lint "$2" >/dev/null && daemon_set "$2"
}
# ppid_chain_has <pid> <ancestor>: <ancestor> is <pid> or one of its parents.
ppid_chain_has() {
  local p="$1" n=0
  while [ -n "$p" ] && [ "$p" != 0 ] && [ "$p" != 1 ] && [ "$n" -lt 32 ]; do
    [ "$p" = "$2" ] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || true)"; n=$((n + 1))
  done
  return 1
}
daemon() {
  mode_line
  if [ "$APPLY" = 1 ] && [ "$(id -u)" != 0 ]; then
    echo "refused: --apply daemon writes $DAEMON_DIR and loads into the system domain: run it with sudo, as the machine owner; nothing was changed" >&2; exit 2
  fi
  if [ "$(id -u)" != 0 ] && [ "$(id -un)" != "$CI_USER" ]; then
    echo "note:   cannot read $CI_USER's runner as $(id -un) (its home and its processes' arguments are its own); run this with sudo, or as $CI_USER"; exit 3
  fi
  local ciuid; ciuid="$(id -u "$CI_USER" 2>/dev/null)" || { echo "refused: no user $CI_USER on this Mac" >&2; exit 1; }
  local label; label="actions.runner.$(printf '%s' "$REPO" | tr '/' '-').$NAME"
  local dplist="$DAEMON_DIR/$label.plist" agent="$CI_HOME/Library/LaunchAgents/$label.plist"
  local own_re worker_re; own_re="$(own_listener_re)"
  worker_re="^$(printf '%s' "$RUNNER_DIR" | sed 's/[.]/[.]/g')/bin[^/]*/Runner[.]Worker( |$)"
  local prc listeners workers
  prc=0; listeners="$(pgrep -u "$ciuid" -f "$own_re")" || prc=$?
  [ "$prc" -lt 2 ] || { echo "refused: could not list processes (pgrep exit $prc)" >&2; exit 1; }
  prc=0; workers="$(pgrep -u "$ciuid" -f "$worker_re")" || prc=$?
  [ "$prc" -lt 2 ] || { echo "refused: could not list processes (pgrep exit $prc)" >&2; exit 1; }
  # The daemon's own job and pid, when it is loaded; a Listener under it is the daemon's, any other is not.
  local dloaded=0 djob dpid="" foreign="" l
  djob="$(launchctl print "system/$label" 2>/dev/null)" && dloaded=1
  [ "$dloaded" = 1 ] && dpid="$(printf '%s\n' "$djob" | sed -n 's/^[[:space:]]pid = \([0-9][0-9]*\)$/\1/p' | head -n 1 || true)"
  for l in $listeners; do
    { [ -n "$dpid" ] && ppid_chain_has "$l" "$dpid"; } || foreign="${foreign:+$foreign }$l"
  done
  local aloaded=0; launchctl print "gui/$ciuid/$label" >/dev/null 2>&1 && aloaded=1
  # Done: the daemon plist is right, it is loaded and running a Listener, nothing else runs this runner, and no
  # LaunchAgent is left that a login would load beside it.
  if [ -f "$dplist" ] && daemon_set "$dplist" && [ "$dloaded" = 1 ] && [ -n "$dpid" ] && [ -n "$listeners" ] \
     && [ -z "$foreign" ] && [ "$aloaded" = 0 ] && [ ! -e "$agent" ]; then
    ok "$label runs as a LaunchDaemon (system domain, UserName $CI_USER, pid $dpid): a logout or a WindowServer crash does not stop it"
    return 0
  fi
  # Refusals, said the same way in a dry run (so it can tell an operator whether --apply would go now).
  local why=""
  [ -z "$workers" ] || why="a job is running (Runner.Worker $(printf '%s' "$workers" | tr '\n' ' ')); run this between jobs"
  [ -n "$why" ] || [ -z "$foreign" ] || why="this runner's Listener runs outside the daemon (pid $foreign: a manual runsvc.sh start or its LaunchAgent), and a daemon would start a second one for the same runner; stop it between jobs first (kill its runsvc.sh and Runner.Listener)"
  [ -n "$why" ] || [ "$aloaded" = 0 ] || why="its LaunchAgent is loaded in gui/$ciuid; between jobs: sudo launchctl bootout gui/$ciuid/$label"
  [ -n "$why" ] || [ "$dloaded" = 0 ] || why="system/$label is already loaded but not as this stage leaves it; to load it again: sudo launchctl bootout system/$label"
  local from=""
  if [ -e "$agent" ]; then
    from="$(runner_plist)"   # svc.sh's .service must name THIS runner's plist, WorkingDirectory the runner dir
    [ -n "$why" ] || [ "$from" = "$agent" ] || why="$RUNNER_DIR/.service does not name $agent (the plist svc.sh wrote for this runner, WorkingDirectory $RUNNER_DIR); nothing was changed"
    [ -n "$why" ] || [ "$(plutil -extract Label raw -o - "$agent" 2>/dev/null || true)" = "$label" ] || why="$agent has another Label; nothing was changed"
  elif [ -f "$dplist" ] && daemon_set "$dplist"; then
    from=""   # retired already, by an earlier run: only the load is left
  else
    [ -n "$why" ] || why="no LaunchAgent at $agent and no daemon plist at $dplist to load; install and register the runner first"
  fi
  if [ -n "$why" ]; then
    if [ "$APPLY" = 1 ]; then echo "refused: $why" >&2; else echo "refused: --apply would refuse now: $why" >&2; fi
    exit 1
  fi
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  if [ "$APPLY" != 1 ]; then
    [ -z "$from" ] || echo "WOULD: write $dplist from $agent (UserName $CI_USER, HOME and USER, KeepAlive {SuccessfulExit: false}, ThrottleInterval 10, ExitTimeOut 35), root:wheel 0644"
    [ -z "$from" ] || echo "WOULD: move $agent aside to $agent.retired-$stamp (kept, so a login cannot start a second Listener)"
    echo "WOULD: launchctl bootstrap system $dplist, then wait for a Runner.Listener of $RUNNER_DIR under it"
    return 0
  fi
  if [ -n "$from" ]; then
    build_daemon "$from" "$dplist.new" \
      && chown root:wheel "$dplist.new" && chmod 0644 "$dplist.new" && mv -f "$dplist.new" "$dplist" \
      || { rm -f "$dplist.new"; echo "FAILED: could not write $dplist; nothing else was changed" >&2; exit 1; }
    mv "$agent" "$agent.retired-$stamp" \
      || { echo "FAILED: wrote $dplist but could not move $agent aside; not loading it (a login would start a second Listener). Remove $dplist to go back" >&2; exit 1; }
  fi
  launchctl bootstrap system "$dplist" \
    || { echo "FAILED: launchctl bootstrap system $dplist. To go back: rm $dplist; mv $agent.retired-* $agent (the newest)" >&2; exit 1; }
  local w=0 lim="${KOSMOS_CI_START_WAIT_S:-30}" now
  while :; do
    prc=0; now="$(pgrep -u "$ciuid" -f "$own_re")" || prc=$?
    [ -n "$now" ] && break
    [ "$w" -lt "$lim" ] || { echo "FAILED: system/$label is loaded but no Runner.Listener of $RUNNER_DIR runs after ${w}s; see its StandardErrorPath. To go back: sudo launchctl bootout system/$label; rm $dplist; mv $agent.retired-* $agent (the newest)" >&2; exit 1; }
    sleep 1; w=$((w + 1))
  done
  ok "$label loaded as a LaunchDaemon (system domain, UserName $CI_USER), Listener pid $(printf '%s' "$now" | tr '\n' ' ')"
  echo "note:   keep $agent.retired-$stamp until one job has passed under the daemon (kosmos#7001: a daemon has no login session, so it cannot read the login keychain)"
  echo "note:   to go back: sudo launchctl bootout system/$label; sudo rm $dplist; mv $agent.retired-$stamp $agent; then log in as $CI_USER"
}
