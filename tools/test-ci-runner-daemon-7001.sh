#!/bin/bash
# kosmos#7001: tools/ci-runner-setup.sh's daemon stage, against stand-ins (launchctl, pgrep, ps, id, chown, sleep) and a
# throwaway runner home. It never touches launchd, /Library or a real runner. What it checks:
#   - --apply as non-root is refused (exit 2); a dry run as a third user reads nothing (exit 3)
#   - a running job, a Listener outside the daemon (named by pid) and a loaded LaunchAgent each refuse, dry or --apply
#   - a dry run says what --apply would do and changes nothing
#   - --apply writes the daemon (UserName, HOME and USER, KeepAlive, RunAtLoad), keeps the agent aside, bootstraps system
#   - a second run says it is done; a daemon plist with the agent already retired only loads
set -u
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
HERE="$(cd "$(dirname "$0")" && pwd -P)"; SCRIPT="$HERE/ci-runner-setup.sh"
BIN="$T/bin"; mkdir -p "$BIN"; LOG="$T/calls.log"
LABEL=actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s
cat > "$BIN/_stub" <<'STUB'
#!/bin/bash
me="$(basename "$0")"; printf '%s %s\n' "$me" "$*" >> "$CALL_LOG"; S="$(dirname "$CALL_LOG")"
case "$me" in
  id) case "$*" in
        "-u") echo "${FX_EUID:-0}" ;; "-un") echo "${FX_WHO:-root}" ;;
        "-u kosmos-ci") echo 502 ;; "-u agent1") echo 501 ;; *) /usr/bin/id "$@" ;; esac ;;
  launchctl) case "$1 $2" in
      "print system/"*) [ -f "$S/daemon-loaded" ] || exit 113; printf 'system/x = {\n\tstate = running\n\tpid = 7000\n}\n' ;;
      "print gui/"*) [ "${FX_AGENT_LOADED:-0}" = 1 ] || exit 113; printf 'gui/x = {\n\tstate = running\n}\n' ;;
      "bootstrap system") [ "${FX_BOOTSTRAP_FAIL:-0}" = 1 ] && exit 5; touch "$S/daemon-loaded"; echo 7001 >> "$S/listeners" ;;
      *) exit 1 ;; esac ;;
  pgrep) case "$*" in
      *Runner*Listener*) [ -s "$S/listeners" ] || exit 1; cat "$S/listeners" ;;
      *Runner*Worker*) [ -n "${FX_WORKER:-}" ] || exit 1; echo "$FX_WORKER" ;;
      *) exit 1 ;; esac ;;
  ps) p="${*: -1}"; case "$p" in 7001) echo 7000 ;; *) echo 1 ;; esac ;;   # 7001 is the daemon's (pid 7000) child
  chown|sleep) : ;;
esac
STUB
chmod 755 "$BIN/_stub"; for c in id launchctl pgrep ps chown sleep; do ln -s _stub "$BIN/$c"; done
fixture() {   # a runner as svc.sh install leaves it: .service names its LaunchAgent, WorkingDirectory the runner dir
  rm -rf "$T/home" "$T/daemons" "$T/listeners" "$T/daemon-loaded"; H="$T/home/kosmos-ci"; R="$H/actions-runner"
  mkdir -p "$R" "$H/Library/LaunchAgents" "$T/daemons"; AG="$H/Library/LaunchAgents/$LABEL.plist"
  cat > "$AG" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$R/runsvc.sh</string></array>
<key>UserName</key><string>kosmos-ci</string>
<key>WorkingDirectory</key><string>$R</string>
<key>RunAtLoad</key><true/>
<key>SessionCreate</key><true/>
<key>EnvironmentVariables</key><dict><key>ACTIONS_RUNNER_SVC</key><string>1</string></dict>
</dict></plist>
EOF
  printf '%s\n' "$AG" > "$R/.service"
}
run() {   # run <name> <env...> -- <args...>
  local n="$1"; shift; local e=(); while [ "$1" != -- ]; do e+=("$1"); shift; done; shift
  : > "$LOG"
  env -i PATH="$BIN:/usr/bin:/bin" HOME="$T/home/kosmos-ci" CALL_LOG="$LOG" KOSMOS_CI_HOME="$T/home/kosmos-ci" \
    KOSMOS_CI_DAEMON_DIR="$T/daemons" KOSMOS_CI_START_WAIT_S=2 ${e[@]+"${e[@]}"} bash "$SCRIPT" "$@" > "$T/$n.out" 2>&1
  echo $? > "$T/$n.rc"
}
rc() { cat "$T/$1.rc"; }
has() { grep -q -F -- "$2" "$T/$1.out"; }
DP() { echo "$T/daemons/$LABEL.plist"; }

fixture; run nonroot FX_EUID=502 FX_WHO=kosmos-ci -- --apply daemon
[ "$(rc nonroot)" = 2 ] && has nonroot "run it with sudo" && [ ! -e "$(DP)" ] && pass "--apply as non-root is refused, nothing written" || fail "nonroot: rc $(rc nonroot) $(cat "$T/nonroot.out")"
fixture; run third FX_EUID=600 FX_WHO=someone -- daemon
[ "$(rc third)" = 3 ] && has third "cannot read kosmos-ci's runner" && pass "a dry run as a third user reads nothing (exit 3)" || fail "third: rc $(rc third) $(cat "$T/third.out")"
fixture; run dry -- daemon
[ "$(rc dry)" = 0 ] && has dry "WOULD: write $(DP)" && has dry "WOULD: move" && [ ! -e "$(DP)" ] && [ -e "$AG" ] && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a dry run says what --apply would do and changes nothing" || fail "dry: rc $(rc dry) $(cat "$T/dry.out")"
fixture; run busy FX_WORKER=6100 -- --apply daemon
[ "$(rc busy)" = 1 ] && has busy "a job is running (Runner.Worker 6100" && [ ! -e "$(DP)" ] && pass "a running job refuses" || fail "busy: rc $(rc busy) $(cat "$T/busy.out")"
fixture; echo 5018 > "$T/listeners"; run manual -- --apply daemon
[ "$(rc manual)" = 1 ] && has manual "runs outside the daemon (pid 5018" && [ ! -e "$(DP)" ] && [ -e "$AG" ] && pass "a Listener outside the daemon (a manual runsvc.sh start) refuses, naming its pid" || fail "manual: rc $(rc manual) $(cat "$T/manual.out")"
fixture; echo 5018 > "$T/listeners"; run manual-dry -- daemon
[ "$(rc manual-dry)" = 1 ] && has manual-dry "--apply would refuse now" && pass "and a dry run says --apply would refuse now" || fail "manual-dry: rc $(rc manual-dry) $(cat "$T/manual-dry.out")"
fixture; run agentloaded FX_AGENT_LOADED=1 -- --apply daemon
[ "$(rc agentloaded)" = 1 ] && has agentloaded "LaunchAgent is loaded in gui/502" && [ ! -e "$(DP)" ] && pass "a loaded LaunchAgent refuses" || fail "agentloaded: rc $(rc agentloaded) $(cat "$T/agentloaded.out")"
fixture; run apply -- --apply daemon
D="$(DP)"
if [ "$(rc apply)" = 0 ] && [ -f "$D" ] && [ ! -e "$AG" ] && ls "$AG".retired-* >/dev/null 2>&1 \
   && [ "$(plutil -extract UserName raw -o - "$D")" = kosmos-ci ] && [ "$(plutil -extract EnvironmentVariables.HOME raw -o - "$D")" = "$T/home/kosmos-ci" ] \
   && [ "$(plutil -extract EnvironmentVariables.USER raw -o - "$D")" = kosmos-ci ] && [ "$(plutil -extract EnvironmentVariables.ACTIONS_RUNNER_SVC raw -o - "$D")" = 1 ] \
   && [ "$(plutil -extract KeepAlive.SuccessfulExit raw -o - "$D")" = false ] && [ "$(plutil -extract RunAtLoad raw -o - "$D")" = true ] \
   && [ "$(plutil -extract ExitTimeOut raw -o - "$D")" = 35 ] && grep -q "^launchctl bootstrap system $D" "$LOG" && grep -q "^chown root:wheel" "$LOG" \
   && has apply "Listener pid 7001"; then
  pass "--apply writes the daemon with the agent's keys plus UserName, HOME, USER, KeepAlive and RunAtLoad, keeps the agent aside, bootstraps system"
else fail "apply: rc $(rc apply) $(cat "$T/apply.out")"; fi
run again -- daemon
[ "$(rc again)" = 0 ] && has again "runs as a LaunchDaemon" && ! has again WOULD && pass "a second run says it is done" || fail "again: rc $(rc again) $(cat "$T/again.out")"
rm -f "$T/daemon-loaded" "$T/listeners"; run loadonly -- --apply daemon
[ "$(rc loadonly)" = 0 ] && grep -q "^launchctl bootstrap system" "$LOG" && ! grep -q "^chown" "$LOG" && pass "a daemon plist with the agent already retired is only loaded" || fail "loadonly: rc $(rc loadonly) $(cat "$T/loadonly.out")"
fixture; run bsfail FX_BOOTSTRAP_FAIL=1 -- --apply daemon
[ "$(rc bsfail)" = 1 ] && has bsfail "To go back" && pass "a failed bootstrap says how to go back" || fail "bsfail: rc $(rc bsfail) $(cat "$T/bsfail.out")"
[ "$fails" = 0 ] && echo "test-ci-runner-daemon-7001: all passed" || { echo "test-ci-runner-daemon-7001: $fails failed"; exit 1; }
