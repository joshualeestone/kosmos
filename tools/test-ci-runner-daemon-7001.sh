#!/bin/bash
# kosmos#7001: tools/ci-runner-setup.sh's daemon stage, against stand-ins (launchctl, pgrep, ps, id, stat, chown, mv,
# sleep) and a throwaway runner home. It never touches launchd, /Library or a real runner. What it checks:
#   - --apply as non-root is refused (exit 2); a dry run as a third user reads nothing (exit 3)
#   - a running job, a Listener outside the daemon (named by pid), a loaded LaunchAgent, a disabled label, a .service
#     naming another plist and an agent with a foreign Label each refuse, dry or --apply
#   - a dry run says what --apply would do and changes nothing
#   - --apply WRITES the daemon (it never copies the job-writable agent: a planted GroupName or Program does not reach
#     it), keeps the agent aside, bootstraps system, and waits for a Listener UNDER the daemon's pid
#   - a second run says it is done; a daemon plist with the agent already retired only loads, naming the retired file
#   - a daemon plist with any extra key, or not root-owned 0644, is not this stage's
#   - a failed move, a login between the write and the bootstrap, a failed bootstrap and a Listener that never starts
#     each fail loud and say how to go back
set -u
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
HERE="$(cd "$(dirname "$0")" && pwd -P)"; SCRIPT="$HERE/ci-runner-setup.sh"
BIN="$T/bin"; mkdir -p "$BIN"; LOG="$T/calls.log"
LABEL=actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s
# The process table the stand-ins read: "uid pid ppid argv...", one per line ($S/procs).
cat > "$BIN/_stub" <<'STUB'
#!/bin/bash
me="$(basename "$0")"; printf '%s %s\n' "$me" "$*" >> "$CALL_LOG"; S="$(dirname "$CALL_LOG")"
case "$me" in
  id) case "$*" in
        "-u") echo "${FX_EUID:-0}" ;; "-un") echo "${FX_WHO:-root}" ;;
        "-u kosmos-ci") echo 502 ;; "-gn kosmos-ci") echo "${FX_GROUP:-staff}" ;; *) /usr/bin/id "$@" ;; esac ;;
  launchctl) case "$1 $2" in
      "print system/"*) [ -f "$S/daemon-loaded" ] || exit 113; printf 'system/x = {\n\tstate = running\n\tpid = 7000\n}\n' ;;
      "print gui/"*) [ "${FX_AGENT_LOADED:-0}" = 1 ] || [ -f "$S/agent-loaded" ] || exit 113; printf 'gui/x = {\n\tstate = running\n}\n' ;;
      "print-disabled system") [ "${FX_PD_FAIL:-0}" = 1 ] && exit 1
        printf 'disabled services = {\n'; [ "${FX_DISABLED:-0}" = 1 ] && printf '\t"%s" => disabled\n' "$FX_LABEL"; printf '}\n' ;;
      "bootstrap system") [ "${FX_BOOTSTRAP_FAIL:-0}" = 1 ] && exit 5; touch "$S/daemon-loaded"
        [ "${FX_NO_LISTENER:-0}" = 1 ] || echo "502 7001 7000 $FX_R/bin/Runner.Listener run --startuptype service" >> "$S/procs" ;;
      *) exit 1 ;; esac ;;
  pgrep) u=""; pat=""; while [ $# -gt 0 ]; do case "$1" in -u) u="$2"; shift ;; -f) pat="$2"; shift ;; esac; shift; done
    [ "${FX_PGREP_FAIL:-0}" = 1 ] && exit 3
    out="$(while read -r pu pp ppp argv; do [ -z "$u" ] || [ "$pu" = "$u" ] || continue
             printf '%s\n' "$argv" | grep -E -e "$pat" >/dev/null && echo "$pp"; done < "$S/procs")"
    [ -n "$out" ] || exit 1; printf '%s\n' "$out" ;;
  ps) p="${*: -1}"; awk -v p="$p" '$2 == p { print $3; f = 1 } END { if (!f) print 1 }' "$S/procs" ;;
  stat) case "${*: -1}" in "$S/daemons/"*) echo "${FX_OWNER:-0} $(/usr/bin/stat -f %Lp "${*: -1}")" ;; *) /usr/bin/stat "$@" ;; esac ;;
  mv) [ "${FX_MV_FAIL:-0}" = 1 ] && case "$2" in *.retired-*) exit 1 ;; esac
    /bin/mv "$@" || exit $?
    [ "${FX_LOGIN_ON_MV:-0}" = 1 ] && case "$2" in *.retired-*) touch "$S/agent-loaded" ;; esac; exit 0 ;;
  chown|sleep) : ;;
esac
STUB
chmod 755 "$BIN/_stub"; for c in id launchctl pgrep ps stat mv chown sleep; do ln -s _stub "$BIN/$c"; done
fixture() {   # a runner as svc.sh install leaves it: .service names its LaunchAgent, WorkingDirectory the runner dir
  rm -rf "$T/home" "$T/daemons" "$T/daemon-loaded" "$T/agent-loaded"; H="$T/home/kosmos-ci"; R="$H/actions-runner"
  mkdir -p "$R" "$H/Library/LaunchAgents" "$T/daemons"; AG="$H/Library/LaunchAgents/$LABEL.plist"
  # Always there, never this runner's: the relay's Listener (same user, #6245), and one of this path under another uid.
  printf '%s\n' "502 4000 1 $H/actions-runner-relay/bin/Runner.Listener run" "501 4100 1 $R/bin/Runner.Listener run" > "$T/procs"
  cat > "$AG" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${1:-$LABEL}</string>
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
listener() { echo "502 $1 ${2:-1} $R/bin/Runner.Listener run" >> "$T/procs"; }
run() {   # run <name> <env...> -- <args...>
  local n="$1"; shift; local e=(); while [ "$1" != -- ]; do e+=("$1"); shift; done; shift
  : > "$LOG"
  env -i PATH="$BIN:/usr/bin:/bin" HOME="$T/home/kosmos-ci" CALL_LOG="$LOG" KOSMOS_CI_HOME="$T/home/kosmos-ci" \
    KOSMOS_CI_DAEMON_DIR="$T/daemons" KOSMOS_CI_START_WAIT_S=2 FX_R="$R" FX_LABEL="$LABEL" ${e[@]+"${e[@]}"} \
    bash "$SCRIPT" "$@" > "$T/$n.out" 2>&1
  echo $? > "$T/$n.rc"
}
rc() { cat "$T/$1.rc"; }
has() { grep -q -F -- "$2" "$T/$1.out"; }
DP() { echo "$T/daemons/$LABEL.plist"; }
untouched() { [ ! -e "$(DP)" ] && [ -e "$AG" ] && ! grep -q '^launchctl bootstrap' "$LOG"; }

fixture; run nonroot FX_EUID=502 FX_WHO=kosmos-ci -- --apply daemon
[ "$(rc nonroot)" = 2 ] && has nonroot "run it with sudo" && untouched && pass "--apply as non-root is refused, nothing written" || fail "nonroot: rc $(rc nonroot) $(cat "$T/nonroot.out")"
fixture; run third FX_EUID=600 FX_WHO=someone -- daemon
[ "$(rc third)" = 3 ] && has third "cannot read kosmos-ci's runner" && pass "a dry run as a third user reads nothing (exit 3)" || fail "third: rc $(rc third) $(cat "$T/third.out")"
fixture; run asci FX_EUID=502 FX_WHO=kosmos-ci -- daemon
[ "$(rc asci)" = 0 ] && has asci "WOULD: write" && pass "a dry run as the CI user reads" || fail "asci: rc $(rc asci) $(cat "$T/asci.out")"
fixture; run dry -- daemon
[ "$(rc dry)" = 0 ] && has dry "WOULD: write $(DP)" && has dry "GroupName staff" && has dry "WOULD: move" && untouched \
  && pass "a dry run says what --apply would do and changes nothing" || fail "dry: rc $(rc dry) $(cat "$T/dry.out")"
fixture; echo "502 6100 1 $R/bin/Runner.Worker spawnclient 1 2" >> "$T/procs"; run busy -- --apply daemon
[ "$(rc busy)" = 1 ] && has busy "a job is running (Runner.Worker 6100" && untouched && pass "a running job refuses" || fail "busy: rc $(rc busy) $(cat "$T/busy.out")"
fixture; echo "502 6200 1 $H/actions-runner-relay/bin/Runner.Worker spawnclient" >> "$T/procs"; run relayjob -- --apply daemon
[ "$(rc relayjob)" = 0 ] && pass "a job on the relay's runner (same user) does not refuse this one" || fail "relayjob: rc $(rc relayjob) $(cat "$T/relayjob.out")"
fixture; listener 5018; run manual -- --apply daemon
[ "$(rc manual)" = 1 ] && has manual "runs outside the daemon (pid 5018" && ! has manual 4000 && ! has manual 4100 && untouched \
  && pass "a Listener outside the daemon (a manual runsvc.sh start) refuses, naming only its pid" || fail "manual: rc $(rc manual) $(cat "$T/manual.out")"
fixture; listener 5018; run manual-dry -- daemon
[ "$(rc manual-dry)" = 1 ] && has manual-dry "--apply would refuse now" && pass "and a dry run says --apply would refuse now" || fail "manual-dry: rc $(rc manual-dry) $(cat "$T/manual-dry.out")"
fixture; run pgfail FX_PGREP_FAIL=1 -- --apply daemon
[ "$(rc pgfail)" = 1 ] && has pgfail "could not list processes" && untouched && pass "a pgrep that cannot list refuses" || fail "pgfail: rc $(rc pgfail) $(cat "$T/pgfail.out")"
fixture; run agentloaded FX_AGENT_LOADED=1 -- --apply daemon
[ "$(rc agentloaded)" = 1 ] && has agentloaded "LaunchAgent is loaded in gui/502" && untouched && pass "a loaded LaunchAgent refuses" || fail "agentloaded: rc $(rc agentloaded) $(cat "$T/agentloaded.out")"
fixture; run disabled FX_DISABLED=1 -- --apply daemon
[ "$(rc disabled)" = 1 ] && has disabled "disabled in the system domain" && untouched && pass "a label disabled in system refuses before anything moves" || fail "disabled: rc $(rc disabled) $(cat "$T/disabled.out")"
fixture; run pdfail FX_PD_FAIL=1 -- --apply daemon
[ "$(rc pdfail)" = 1 ] && has pdfail "could not read launchctl print-disabled" && untouched && pass "an unreadable print-disabled refuses" || fail "pdfail: rc $(rc pdfail) $(cat "$T/pdfail.out")"
fixture; printf '%s\n' "$H/Library/LaunchAgents/actions.runner.joshualeestone-kosmos-relay.x.plist" > "$R/.service"; run service -- --apply daemon
[ "$(rc service)" = 1 ] && has service ".service does not name" && untouched && pass "a .service naming another plist refuses" || fail "service: rc $(rc service) $(cat "$T/service.out")"
fixture actions.runner.someone-else.x; run foreign -- --apply daemon
[ "$(rc foreign)" = 1 ] && has foreign "has another Label" && untouched && pass "an agent with a foreign Label refuses" || fail "foreign: rc $(rc foreign) $(cat "$T/foreign.out")"
fixture; run wheel FX_GROUP=wheel -- --apply daemon
[ "$(rc wheel)" = 1 ] && has wheel "primary group is 'wheel'" && untouched && pass "a CI user whose primary group is wheel refuses" || fail "wheel: rc $(rc wheel) $(cat "$T/wheel.out")"

# THE round-1 blocker: keys a job planted in the agent (it can write that home) never reach the root-loaded daemon.
fixture; plutil -insert GroupName -string wheel "$AG"; plutil -insert Program -string /bin/sh "$AG"
plutil -insert MachServices -xml '<dict><key>x.y</key><true/></dict>' "$AG"
run apply -- --apply daemon
D="$(DP)"
if [ "$(rc apply)" = 0 ] && [ -f "$D" ] && [ ! -e "$AG" ] && ls "$AG".retired-* >/dev/null 2>&1 \
   && [ "$(plutil -extract UserName raw -o - "$D")" = kosmos-ci ] && [ "$(plutil -extract GroupName raw -o - "$D")" = staff ] \
   && ! plutil -extract Program raw -o - "$D" >/dev/null 2>&1 && ! plutil -extract MachServices xml1 -o - "$D" >/dev/null 2>&1 \
   && ! plutil -extract StandardOutPath raw -o - "$D" >/dev/null 2>&1 \
   && [ "$(plutil -extract EnvironmentVariables.HOME raw -o - "$D")" = "$H" ] \
   && [ "$(plutil -extract EnvironmentVariables.USER raw -o - "$D")" = kosmos-ci ] && [ "$(plutil -extract EnvironmentVariables.ACTIONS_RUNNER_SVC raw -o - "$D")" = 1 ] \
   && [ "$(plutil -extract KeepAlive.SuccessfulExit raw -o - "$D")" = false ] && [ "$(plutil -extract RunAtLoad raw -o - "$D")" = true ] \
   && [ "$(plutil -extract ExitTimeOut raw -o - "$D")" = 35 ] && [ "$(plutil -extract ProgramArguments.0 raw -o - "$D")" = "$R/runsvc.sh" ] \
   && grep -q "^launchctl bootstrap system $D" "$LOG" && grep -q "^chown root:wheel" "$LOG" && [ "$(/usr/bin/stat -f %Lp "$D")" = 644 ] \
   && has apply "Listener pid 7001 under pid 7000" && has apply "keep $AG.retired-"; then
  pass "--apply WRITES the daemon (planted GroupName, Program, MachServices do not reach it), keeps the agent aside, bootstraps system"
else fail "apply: rc $(rc apply) $(cat "$T/apply.out"); $(cat "$D" 2>/dev/null)"; fi
run again -- daemon
[ "$(rc again)" = 0 ] && has again "runs as a LaunchDaemon" && ! has again WOULD && pass "a second run says it is done" || fail "again: rc $(rc again) $(cat "$T/again.out")"
cp "$(ls "$AG".retired-*)" "$AG"; run agentback -- daemon
[ "$(rc agentback)" = 1 ] && has agentback "is back" && ! has agentback bootout && pass "only the agent plist back: says move it aside, never a bootout" || fail "agentback: rc $(rc agentback) $(cat "$T/agentback.out")"
rm -f "$AG"; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; mv "$T/procs.x" "$T/procs"; run restarting -- daemon
[ "$(rc restarting)" = 1 ] && has restarting "run this again in a minute" && ! has restarting bootout && pass "loaded with no Listener: restarting or updating, run again" || fail "restarting: rc $(rc restarting) $(cat "$T/restarting.out")"
RET="$(ls "$AG".retired-*)"; rm -f "$T/daemon-loaded"; run loadonly -- --apply daemon
[ "$(rc loadonly)" = 0 ] && grep -q "^launchctl bootstrap system" "$LOG" && ! grep -q "^chown" "$LOG" && has loadonly "sudo mv $RET $AG" \
  && pass "a daemon plist with the agent already retired is only loaded, naming the retired file" || fail "loadonly: rc $(rc loadonly) $(cat "$T/loadonly.out")"
rm -f "$T/daemon-loaded"; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; mv "$T/procs.x" "$T/procs"; chmod 664 "$D"; run mode -- --apply daemon
[ "$(rc mode)" = 1 ] && has mode "not exactly what this stage writes" && ! grep -q '^launchctl bootstrap' "$LOG" && pass "a daemon plist mode 0664 is not this stage's" || fail "mode: rc $(rc mode) $(cat "$T/mode.out")"
chmod 644 "$D"; run owner FX_OWNER=502 -- --apply daemon
[ "$(rc owner)" = 1 ] && ! grep -q '^launchctl bootstrap' "$LOG" && pass "a daemon plist not owned by root is not this stage's" || fail "owner: rc $(rc owner) $(cat "$T/owner.out")"
plutil -insert Sockets -xml '<dict/>' "$D"; run extra -- --apply daemon
[ "$(rc extra)" = 1 ] && has extra "not exactly what this stage writes" && pass "a daemon plist with one extra key is not this stage's" || fail "extra: rc $(rc extra) $(cat "$T/extra.out")"

fixture; run mvfail FX_MV_FAIL=1 -- --apply daemon
[ "$(rc mvfail)" = 1 ] && has mvfail "could not move" && has mvfail "sudo rm $(DP)" && [ -e "$AG" ] && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a failed move of the agent does not load, and says how to go back" || fail "mvfail: rc $(rc mvfail) $(cat "$T/mvfail.out")"
fixture; run login FX_LOGIN_ON_MV=1 -- --apply daemon
[ "$(rc login)" = 1 ] && has login "put everything back" && [ -e "$AG" ] && [ ! -e "$(DP)" ] && ! ls "$AG".retired-* >/dev/null 2>&1 && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a login between the write and the bootstrap puts everything back" || fail "login: rc $(rc login) $(cat "$T/login.out")"
fixture; run bsfail FX_BOOTSTRAP_FAIL=1 -- --apply daemon
[ "$(rc bsfail)" = 1 ] && has bsfail "stays down until kosmos-ci logs in" && has bsfail "sudo mv $AG.retired-" && ! has bsfail 'retired-*' \
  && pass "a failed bootstrap names the exact retired file and the console login" || fail "bsfail: rc $(rc bsfail) $(cat "$T/bsfail.out")"
fixture; run nolistener FX_NO_LISTENER=1 -- --apply daemon
[ "$(rc nolistener)" = 1 ] && has nolistener "no Runner.Listener of" && has nolistener "sudo launchctl bootout system/$LABEL" \
  && pass "a Listener that never starts under the daemon fails after the wait" || fail "nolistener: rc $(rc nolistener) $(cat "$T/nolistener.out")"
[ "$fails" = 0 ] && echo "test-ci-runner-daemon-7001: all passed" || { echo "test-ci-runner-daemon-7001: $fails failed"; exit 1; }
