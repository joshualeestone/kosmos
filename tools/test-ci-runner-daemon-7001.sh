#!/bin/bash
# kosmos#7001: tools/ci-runner-setup.sh's daemon stage, against stand-ins (launchctl, pgrep, ps, id, stat, chown, mv,
# mkdir, tee, plutil, date, sudo, sleep) and a throwaway runner home. It never touches launchd, /Library or a real
# runner. What it checks:
#   - --apply as non-root is refused (exit 2); a dry run as a third user reads nothing (exit 3)
#   - a running job, a Listener outside the daemon (named by pid), a loaded LaunchAgent, a disabled label, a .service
#     naming another plist and an agent with a foreign Label each refuse, dry or --apply
#   - a dry run says what --apply would do and changes nothing
#   - --apply WRITES the daemon (it never copies the job-writable agent: a planted GroupName or Program does not reach
#     it), keeps the agent aside, bootstraps system, and waits for a Listener UNDER the daemon's pid
#   - a second run says it is done; a daemon plist with the agent already retired only loads, naming the retired file
#   - a daemon plist with any extra key, or not root-owned 0644, is not this stage's
#   - #7877: the re-check right before the move (a symlink swapped in after planning), an empty or short retired copy,
#     a FIFO or symlink at the plist .service names, signals while parked, the script's directory, no pid with and
#     without a Listener, and the printed move-aside and put-back: parsed, and pasted twice or over an agent
#   - a failed move, a login between the write and the bootstrap, a failed bootstrap and a Listener that never starts
#     each fail loud and say how to go back
#   - kosmos#8404: a second runner of the same user, named by KOSMOS_CI_REPO and KOSMOS_CI_RUNNER_DIR, becomes its own
#     daemon beside this repo's (control: without the dir it is not found); its own manual Listener still refuses; every
#     other stage refuses the two; a dir not directly in the CI home, and a repo not owner/name, are refused
set -u
_td="${TMPDIR:-/tmp}"; T="$(mktemp -d "${_td%/}/test-ci-runner-daemon-7001.XXXXXXXXXX")" || exit 1; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
HERE="$(cd "$(dirname "$0")" && pwd -P)"
# A copy with a known mode, in a directory with a known mode: --apply refuses a script (or its directory) that others
# can write, so the arms below must not depend on how this checkout was made (#7877).
mkdir -m 755 "$T/src"; cp "$HERE/ci-runner-setup.sh" "$T/src/ci-runner-setup.sh"; chmod 755 "$T/src/ci-runner-setup.sh"
SCRIPT="$T/src/ci-runner-setup.sh"
BIN="$T/bin"; mkdir -p "$BIN"; LOG="$T/calls.log"
LABEL=actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s
RA="$T/retired/$LABEL.plist"   # the retired agent, in the root-owned dir (KOSMOS_CI_RETIRED_DIR)
# uids from the runner of this test, never fixed: a fixed "other" uid can be the runner's own (its own checkout would
# then read as the CI user's, and every --apply arm would refuse).
ME="$(/usr/bin/id -u)"; CIU=$((ME + 1000)); OTU=$((ME + 1001))
# The process table the stand-ins read: "uid pid ppid argv...", one per line ($S/procs).
cat > "$BIN/_stub" <<'STUB'
#!/bin/bash
me="$(basename "$0")"; printf '%s %s\n' "$me" "$*" >> "$CALL_LOG"; S="$(dirname "$CALL_LOG")"
case "$me" in
  id) case "$*" in
        "-u") echo "${FX_EUID:-0}" ;; "-un") echo "${FX_WHO:-root}" ;;
        "-u kosmos-ci") echo "${FX_CIUID:-$FX_CIU}" ;; "-gn kosmos-ci") echo "${FX_GROUP:-staff}" ;; "-Gn kosmos-ci") echo "${FX_GROUPS:-staff everyone}" ;; *) /usr/bin/id "$@" ;; esac ;;
  launchctl) case "$1 $2" in
      "print system/"*) [ -f "$S/daemon-loaded" ] || exit 113; if [ "${FX_NO_DPID:-0}" = 1 ]; then printf 'system/x = {\n\tstate = waiting\n}\n'; else printf 'system/x = {\n\tstate = running\n\tpid = 7000\n}\n'; fi ;;
      "print gui/"*) if [ "${FX_GUI_LATE:-0}" = 1 ] && [ ! -f "$S/gui-seen" ]; then touch "$S/gui-seen"; exit 113; fi
        [ "${FX_AGENT_LOADED:-0}" = 1 ] || [ "${FX_GUI_LATE:-0}" = 1 ] || [ -f "$S/agent-loaded" ] || exit 113; printf 'gui/x = {\n\tstate = running\n}\n' ;;
      "print-disabled system") [ "${FX_PD_FAIL:-0}" = 1 ] && exit 1
        printf 'disabled services = {\n'; [ "${FX_DISABLED:-0}" = 1 ] && printf '\t"%s" => disabled\n' "$FX_LABEL"; printf '}\n' ;;
      "bootstrap system") [ "${FX_BOOTSTRAP_FAIL:-0}" = 1 ] && exit 5; touch "$S/daemon-loaded"
        [ "${FX_NO_LISTENER:-0}" = 1 ] || echo "$FX_CIU 7001 7000 $FX_R/bin/Runner.Listener run --startuptype service" >> "$S/procs" ;;
      *) exit 1 ;; esac ;;
  pgrep) u=""; pat=""; while [ $# -gt 0 ]; do case "$1" in -u) u="$2"; shift ;; -f) pat="$2"; shift ;; esac; shift; done
    [ "${FX_PGREP_FAIL:-0}" = 1 ] && exit 3
    [ "${FX_PGREP_FAIL_LOADED:-0}" = 1 ] && [ -f "$S/daemon-loaded" ] && exit 3
    [ "${FX_PGREP_FAIL_PARKED:-0}" = 1 ] && ls "$S"/retired/*.retired-* >/dev/null 2>&1 && exit 3
    out="$(while read -r pu pp ppp argv; do [ -z "$u" ] || [ "$pu" = "$u" ] || continue
             printf '%s\n' "$argv" | grep -E -e "$pat" >/dev/null && echo "$pp"; done < "$S/procs")"
    [ -n "$out" ] || exit 1; printf '%s\n' "$out" ;;
  ps) p="${*: -1}"; awk -v p="$p" '$2 == p { print $3; f = 1 } END { if (!f) print 1 }' "$S/procs" ;;
  stat) case "${*: -1}" in */otherown/*) echo "$((FX_CIU + 1)) $(/usr/bin/stat -f %Lp "${*: -1}")" ;; "$S/daemons/"*|"$S/retired"|"$S/retired/"*) echo "${FX_OWNER:-0} 0 $(/usr/bin/stat -f %Lp "${*: -1}")" ;; *) /usr/bin/stat "$@" ;; esac ;;
  mv) [ "${FX_MV_FAIL:-0}" = 1 ] && case "$2" in *.retired-*) exit 1 ;; esac
    [ "${FX_MV_PLIST_FAIL:-0}" = 1 ] && case "${*: -1}" in "$S/daemons/"*.plist) exit 1 ;; esac
    /bin/mv "$@" || exit $?
    [ "${FX_LOGIN_ON_MV:-0}" = 1 ] && case "$2" in *.retired-*) touch "$S/agent-loaded" ;; esac;
    [ "${FX_LINK_ON_MV:-0}" = 1 ] && case "$2" in *.retired-*) /bin/mv "$FX_H/Library/LaunchAgents" "$FX_H/LA.real"; ln -s "$FX_H/LA.real" "$FX_H/Library/LaunchAgents" ;; esac
    [ "${FX_LISTENER_ON_MV:-0}" = 1 ] && case "$2" in *.retired-*) echo "$FX_CIU 5300 1 $FX_R/bin/Runner.Listener run" >> "$S/procs" ;; esac
    # A hangup, ^C or TERM while the agent is parked and nothing is loaded: the stage must not die here.
    [ "${FX_TERM_ON_MV:-0}" = 1 ] && case "$2" in *.retired-*) kill -TERM "$PPID"; kill -INT "$PPID"; kill -HUP "$PPID" ;; esac; exit 0 ;;
  plutil) [ -p "${*: -1}" ] && exec /bin/sleep 300; exec /usr/bin/plutil "$@" ;;   # a plutil that blocks on a FIFO
  tee) if [ "${FX_TEE_SHORT:-0}" = 1 ]; then head -c 20 | /usr/bin/tee "$@"; cat > /dev/null; else exec /usr/bin/tee "$@"; fi ;;
  mkdir) /bin/mkdir "$@" || exit $?
    # FX_LINK_ON_MKDIR: LaunchAgents becomes a symlink as the retired dir is made, AFTER the planning check and BEFORE
    # the re-check right before the move (#7877): only that second agent_file_ok can see it.
    [ "${FX_LINK_ON_MKDIR:-0}" = 1 ] && case "${*: -1}" in "$S/retired") /bin/mv "$FX_H/Library/LaunchAgents" "$FX_H/LA.real"; ln -s "$FX_H/LA.real" "$FX_H/Library/LaunchAgents" ;; esac; exit 0 ;;
  date) echo "${FX_DATE:-20261103T000000Z}" ;;
  sudo) [ "$1" = -u ] && shift 2; exec "$@" ;;
  chown|sleep) : ;;
esac
STUB
chmod 755 "$BIN/_stub"; for c in id launchctl pgrep ps stat mv mkdir tee plutil date sudo chown sleep; do ln -s _stub "$BIN/$c"; done
fixture() {   # a runner as svc.sh install leaves it: .service names its LaunchAgent, WorkingDirectory the runner dir
  rm -rf "$T/home" "$T/daemons" "$T/retired" "$T/daemon-loaded" "$T/agent-loaded" "$T/gui-seen"; H="$T/home/kosmos-ci"; R="$H/actions-runner"
  mkdir -p "$R" "$H/Library/LaunchAgents" "$T/daemons"; AG="$H/Library/LaunchAgents/$LABEL.plist"
  # Always there, never this runner's: the relay's Listener (same user, #6245), and one of this path under another uid.
  printf '%s\n' "$CIU 4000 1 $H/actions-runner-relay/bin/Runner.Listener run" "$OTU 4100 1 $R/bin/Runner.Listener run" > "$T/procs"
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
listener() { echo "$CIU $1 ${2:-1} $R/bin/Runner.Listener run" >> "$T/procs"; }
run() {   # run <name> <env...> -- <args...>
  local n="$1"; shift; local e=(); while [ "$1" != -- ]; do e+=("$1"); shift; done; shift
  : > "$LOG"
  # alarm: a hang fails the arm instead of the suite. It ends the stage's bash only; a child blocked on a FIFO is left.
  perl -e 'alarm 60; exec @ARGV or die "exec: $!"' env -i PATH="$BIN:/usr/bin:/bin" HOME="$T/home/kosmos-ci" CALL_LOG="$LOG" KOSMOS_CI_HOME="$T/home/kosmos-ci" \
    KOSMOS_CI_DAEMON_DIR="$T/daemons" KOSMOS_CI_RETIRED_DIR="$T/retired" KOSMOS_CI_START_WAIT_S=2 FX_R="$R" FX_H="$H" FX_CIU="$CIU" SUDO_UID="$ME" FX_LABEL="$LABEL" ${e[@]+"${e[@]}"} \
    bash "${RUN_SCRIPT:-$SCRIPT}" "$@" > "$T/$n.out" 2>&1
  echo $? > "$T/$n.rc"
}
rc() { cat "$T/$1.rc"; }
has() { grep -q -F -- "$2" "$T/$1.out"; }
DP() { echo "$T/daemons/$LABEL.plist"; }
untouched() { [ ! -e "$(DP)" ] && [ -e "$AG" ] && ! grep -q '^launchctl bootstrap' "$LOG"; }

fixture; run nonroot FX_EUID=$CIU FX_WHO=kosmos-ci -- --apply daemon
[ "$(rc nonroot)" = 2 ] && has nonroot "run it with sudo" && untouched && pass "--apply as non-root is refused, nothing written" || fail "nonroot: rc $(rc nonroot) $(cat "$T/nonroot.out")"
fixture; run third FX_EUID=600 FX_WHO=someone -- daemon
[ "$(rc third)" = 3 ] && has third "cannot read kosmos-ci's runner" && pass "a dry run as a third user reads nothing (exit 3)" || fail "third: rc $(rc third) $(cat "$T/third.out")"
fixture; run asci FX_EUID=$CIU FX_WHO=kosmos-ci -- daemon
[ "$(rc asci)" = 0 ] && has asci "WOULD: write" && pass "a dry run as the CI user reads" || fail "asci: rc $(rc asci) $(cat "$T/asci.out")"
fixture; run dry -- daemon
[ "$(rc dry)" = 0 ] && has dry "WOULD: write $(DP)" && has dry "GroupName staff" && has dry "WOULD: move" && untouched \
  && pass "a dry run says what --apply would do and changes nothing" || fail "dry: rc $(rc dry) $(cat "$T/dry.out")"
fixture; echo "$CIU 6100 1 $R/bin/Runner.Worker spawnclient 1 2" >> "$T/procs"; run busy -- --apply daemon
[ "$(rc busy)" = 1 ] && has busy "a job is running (Runner.Worker 6100" && untouched && pass "a running job refuses" || fail "busy: rc $(rc busy) $(cat "$T/busy.out")"
fixture; echo "$CIU 6200 1 $H/actions-runner-relay/bin/Runner.Worker spawnclient" >> "$T/procs"; run relayjob -- --apply daemon
[ "$(rc relayjob)" = 0 ] && pass "a job on the relay's runner (same user) does not refuse this one" || fail "relayjob: rc $(rc relayjob) $(cat "$T/relayjob.out")"
fixture; listener 5018; run manual -- --apply daemon
[ "$(rc manual)" = 1 ] && has manual "runs outside the daemon (pid 5018" && ! has manual 4000 && ! has manual 4100 && untouched \
  && pass "a Listener outside the daemon (a manual runsvc.sh start) refuses, naming only its pid" || fail "manual: rc $(rc manual) $(cat "$T/manual.out")"
fixture; listener 5018; run manual-dry -- daemon
[ "$(rc manual-dry)" = 1 ] && has manual-dry "--apply would refuse now" && pass "and a dry run says --apply would refuse now" || fail "manual-dry: rc $(rc manual-dry) $(cat "$T/manual-dry.out")"
fixture; run pgfail FX_PGREP_FAIL=1 -- --apply daemon
[ "$(rc pgfail)" = 1 ] && has pgfail "could not list processes" && untouched && pass "a pgrep that cannot list refuses" || fail "pgfail: rc $(rc pgfail) $(cat "$T/pgfail.out")"
fixture; run agentloaded FX_AGENT_LOADED=1 -- --apply daemon
[ "$(rc agentloaded)" = 1 ] && has agentloaded "LaunchAgent is loaded in gui/$CIU" && untouched && pass "a loaded LaunchAgent refuses" || fail "agentloaded: rc $(rc agentloaded) $(cat "$T/agentloaded.out")"
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
if [ "$(rc apply)" = 0 ] && [ -f "$D" ] && [ ! -e "$AG" ] && ls "$RA".retired-* >/dev/null 2>&1 \
   && [ "$(plutil -extract UserName raw -o - "$D")" = kosmos-ci ] && [ "$(plutil -extract GroupName raw -o - "$D")" = staff ] \
   && ! plutil -extract Program raw -o - "$D" >/dev/null 2>&1 && ! plutil -extract MachServices xml1 -o - "$D" >/dev/null 2>&1 \
   && ! plutil -extract StandardOutPath raw -o - "$D" >/dev/null 2>&1 \
   && [ "$(plutil -extract EnvironmentVariables.HOME raw -o - "$D")" = "$H" ] \
   && [ "$(plutil -extract EnvironmentVariables.USER raw -o - "$D")" = kosmos-ci ] && [ "$(plutil -extract EnvironmentVariables.ACTIONS_RUNNER_SVC raw -o - "$D")" = 1 ] \
   && [ "$(plutil -extract KeepAlive.SuccessfulExit raw -o - "$D")" = false ] && [ "$(plutil -extract RunAtLoad raw -o - "$D")" = true ] \
   && [ "$(plutil -extract ExitTimeOut raw -o - "$D")" = 35 ] && [ "$(plutil -extract ProgramArguments.0 raw -o - "$D")" = "$R/runsvc.sh" ] \
   && grep -q "^launchctl bootstrap system $D" "$LOG" && grep -q "^chown root:wheel" "$LOG" && [ "$(/usr/bin/stat -f %Lp "$D")" = 644 ] \
   && has apply "Listener pid 7001 under pid 7000" && has apply "keep $RA.retired-"; then
  pass "--apply WRITES the daemon (planted GroupName, Program, MachServices do not reach it), keeps the agent aside, bootstraps system"
else fail "apply: rc $(rc apply) $(cat "$T/apply.out"); $(cat "$D" 2>/dev/null)"; fi
run again -- daemon
[ "$(rc again)" = 0 ] && has again "runs as a LaunchDaemon" && ! has again WOULD && pass "a second run says it is done" || fail "again: rc $(rc again) $(cat "$T/again.out")"
R0="$(ls "$RA".retired-*)"; cp "$R0" "$AG"; run agentback FX_DATE=20261103T000009Z -- daemon
[ "$(rc agentback)" = 1 ] && has agentback "is back" && has agentback "sudo -u kosmos-ci cat $AG | sudo tee $RA.retired-" && has agentback "&& sudo -u kosmos-ci cat $AG | sudo cmp -s - $RA.retired-" && has agentback "sudo -u kosmos-ci rm $AG && echo 'moved aside' || { if sudo -u kosmos-ci test -L $AG; then echo 'NOT finished; nothing was moved: $AG is a symlink, which a job could have put there: look at it as root before anything else: sudo ls -la $AG'; elif sudo -u kosmos-ci test -e $AG; then if [ -n \"\$(sudo -u kosmos-ci find $AG -prune -type f -size 0 2>/dev/null)\" ]; then echo 'NOT finished; $AG is empty, so there is nothing to move aside" && [ "$(tail -c 4 "$T/agentback.out")" = "; }" ] && ! has agentback "sudo cat $AG |" && ! has agentback "sudo cp" && ! has agentback bootout && pass "only the agent plist back: says move it aside, never a bootout" || fail "agentback: rc $(rc agentback) $(cat "$T/agentback.out")"
MV="$(sed -n 's/.*remove the daemon plist): //p' "$T/agentback.out")"
[ -n "$MV" ] && sh -n -c "$MV" 2>/dev/null && pass "the printed move-aside is the whole rest of its line and parses as one command" || fail "agentback paste: [$MV]"
# Pasted twice (sudo stripped): the first moves the agent aside, the second refuses and leaves the copy whole.
MVS="$(printf '%s' "$MV" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')"; D9="$RA.retired-20261103T000009Z"
O1="$(sh -c "$MVS" 2>&1)"; O2="$(sh -c "$MVS" 2>&1)"
[ "$O1" = "moved aside" ] && [ ! -e "$AG" ] && cmp -s "$R0" "$D9" && [ "$O2" = "nothing done: $AG is not there (already moved aside), or the check could not run" ] && cmp -s "$R0" "$D9" \
  && pass "the printed move-aside pasted twice: moved once, and the second paste leaves the copy whole" || fail "mvtwice: [$O1] [$O2] $(ls -l "$D9" 2>&1)"
rm -f "$D9" "$AG"
rm -f "$AG"; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; mv "$T/procs.x" "$T/procs"; run restarting -- daemon
[ "$(rc restarting)" = 1 ] && has restarting "run this again in a minute" && ! has restarting bootout && pass "loaded with no Listener: restarting or updating, run again" || fail "restarting: rc $(rc restarting) $(cat "$T/restarting.out")"
RET="$(ls "$RA".retired-*)"; rm -f "$T/daemon-loaded"; run loadonly -- --apply daemon
[ "$(rc loadonly)" = 0 ] && grep -q "^launchctl bootstrap system" "$LOG" && ! grep -q "^chown" "$LOG" && has loadonly "sudo cat $RET | sudo -u kosmos-ci tee $AG" \
  && pass "a daemon plist with the agent already retired is only loaded, naming the retired file" || fail "loadonly: rc $(rc loadonly) $(cat "$T/loadonly.out")"
rm -f "$T/daemon-loaded"; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; mv "$T/procs.x" "$T/procs"; chmod 664 "$D"; run mode -- --apply daemon
[ "$(rc mode)" = 1 ] && has mode "not exactly what this stage writes" && ! grep -q '^launchctl bootstrap' "$LOG" && pass "a daemon plist mode 0664 is not this stage's" || fail "mode: rc $(rc mode) $(cat "$T/mode.out")"
chmod 644 "$D"; run owner FX_OWNER=$OTU -- --apply daemon
[ "$(rc owner)" = 1 ] && has owner "not exactly what this stage writes" && ! grep -q '^launchctl bootstrap' "$LOG" && pass "a daemon plist not owned by root is not this stage's" || fail "owner: rc $(rc owner) $(cat "$T/owner.out")"
plutil -insert Sockets -xml '<dict/>' "$D"; run extra -- --apply daemon
[ "$(rc extra)" = 1 ] && has extra "not exactly what this stage writes" && pass "a daemon plist with one extra key is not this stage's" || fail "extra: rc $(rc extra) $(cat "$T/extra.out")"

fixture; run mvfail FX_MV_FAIL=1 -- --apply daemon
[ "$(rc mvfail)" = 1 ] && has mvfail "could not move" && [ ! -e "$(DP)" ] && [ ! -e "$(DP).new" ] && [ -e "$AG" ] && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a failed move of the agent writes no daemon plist and loads nothing" || fail "mvfail: rc $(rc mvfail) $(cat "$T/mvfail.out")"
fixture; run login FX_LOGIN_ON_MV=1 -- --apply daemon
[ "$(rc login)" = 1 ] && has login "put everything back" && [ -e "$AG" ] && [ ! -e "$(DP)" ] && ! ls "$RA".retired-* >/dev/null 2>&1 && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a login between the write and the bootstrap puts everything back" || fail "login: rc $(rc login) $(cat "$T/login.out")"
fixture; run bsfail FX_BOOTSTRAP_FAIL=1 -- --apply daemon
[ "$(rc bsfail)" = 1 ] && has bsfail "launchd tries" && has bsfail "sudo cat $RA.retired-" && ! has bsfail 'retired-*' \
  && pass "a failed bootstrap names the exact retired file and the next boot" || fail "bsfail: rc $(rc bsfail) $(cat "$T/bsfail.out")"
fixture; run nolistener FX_NO_LISTENER=1 -- --apply daemon
[ "$(rc nolistener)" = 1 ] && has nolistener "no Runner.Listener of" && has nolistener "sudo launchctl bootout system/$LABEL" \
  && pass "a Listener that never starts under the daemon fails after the wait" || fail "nolistener: rc $(rc nolistener) $(cat "$T/nolistener.out")"
fixture; run lstnwin FX_LISTENER_ON_MV=1 -- --apply daemon
[ "$(rc lstnwin)" = 1 ] && has lstnwin "pid 5300" && has lstnwin "put everything back" && [ -e "$AG" ] && [ ! -e "$(DP)" ] && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a Listener started between the write and the bootstrap puts everything back" || fail "lstnwin: rc $(rc lstnwin) $(cat "$T/lstnwin.out")"
fixture; mkdir -m 700 "$T/retired"; mkdir "$RA.retired-20261103T000000Z"; run taken -- --apply daemon
[ "$(rc taken)" = 1 ] && has taken "is something already there" && [ -f "$AG" ] && [ ! -e "$(DP)" ] && [ ! -e "$(DP).new" ] \
  && pass "a retired name already taken refuses before anything moves" || fail "taken: rc $(rc taken) $(cat "$T/taken.out")"
fixture; run order FX_LOGIN_ON_MV=1 -- --apply daemon
mvline="$(grep -n '^mv .*\.retired-' "$LOG" | head -n 1 | cut -d: -f1)"; dline="$(grep -n "^mv -f $(DP).new $(DP)" "$LOG" | head -n 1 | cut -d: -f1)"
[ -n "$mvline" ] && [ -n "$dline" ] && [ "$mvline" -lt "$dline" ] && pass "the agent is moved aside before the daemon plist appears at its path" || fail "order: agent mv line ${mvline:-none}, plist mv line ${dline:-none}"
fixture; run late1 -- --apply daemon; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; /bin/mv "$T/procs.x" "$T/procs"; rm -f "$T/daemon-loaded"
run latelo FX_GUI_LATE=1 -- --apply daemon
[ "$(rc latelo)" = 1 ] && has latelo "nothing was changed" && has latelo "loads it at the next boot" && [ -f "$(DP)" ] && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "load only: an agent loaded just before the load refuses, and says the daemon plist stays" || fail "latelo: rc $(rc latelo) $(cat "$T/latelo.out")"
run ka FX_EUID=$CIU FX_WHO=kosmos-ci -- keepalive
[ "$(rc ka)" = 1 ] && has ka "runs as a LaunchDaemon" && pass "keepalive after the daemon says it runs as a daemon, not register first" || fail "ka: rc $(rc ka) $(cat "$T/ka.out")"
# Round 3's blocker: a planted name in the retired dir is never printed into a sudo line (only stamp-shaped regular files count).
fixture; run plant0 -- --apply daemon; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; /bin/mv "$T/procs.x" "$T/procs"; rm -f "$T/daemon-loaded"
REAL="$(ls "$RA".retired-*)"; : > "$RA.retired-Zz;id;#"; mkdir "$RA.retired-29991231T000000Z"; ln -s /etc/hosts "$RA.retired-29991231T000001Z"
run plant -- --apply daemon
[ "$(rc plant)" = 0 ] && ! has plant ';id;' && ! has plant 29991231 && has plant "sudo cat $REAL | sudo -u kosmos-ci tee $AG" \
  && pass "a planted name, a directory or a symlink in the retired dir is never printed; the real retired file is" || fail "plant: rc $(rc plant) $(cat "$T/plant.out")"
fixture; mkdir -m 755 "$T/retired"; run rdmode -- --apply daemon
[ "$(rc rdmode)" = 1 ] && has rdmode "is not a root:wheel 0700 directory" && untouched && pass "a retired dir that is not root:wheel 0700 refuses" || fail "rdmode: rc $(rc rdmode) $(cat "$T/rdmode.out")"
fixture; /bin/mv "$H/Library/LaunchAgents" "$H/LA.real"; ln -s "$H/LA.real" "$H/Library/LaunchAgents"; run lalink -- --apply daemon
[ "$(rc lalink)" = 1 ] && has lalink "is a symlink" && [ ! -e "$(DP)" ] && [ -f "$H/LA.real/$LABEL.plist" ] && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a symlinked LaunchAgents dir refuses: root does not move through it" || fail "lalink: rc $(rc lalink) $(cat "$T/lalink.out")"
fixture; run fdone0 -- --apply daemon; listener 5400; run fdone -- daemon
[ "$(rc fdone)" = 1 ] && has fdone "runs outside the daemon (pid 5400:" && ! has fdone 7001 && pass "daemon running plus a Listener not under it refuses, naming only that pid" || fail "fdone: rc $(rc fdone) $(cat "$T/fdone.out")"
fixture; daemon_dir_plist="$(DP)"; printf '%s\n' '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>x</string></dict></plist>' > "$daemon_dir_plist"
touch "$T/daemon-loaded"; listener 7001 7000; run wrongloaded -- --apply daemon
[ "$(rc wrongloaded)" = 1 ] && has wrongloaded "is loaded but" && has wrongloaded "bootout system/$LABEL" && pass "a loaded daemon whose plist is not this stage's refuses, naming the bootout" || fail "wrongloaded: rc $(rc wrongloaded) $(cat "$T/wrongloaded.out")"
fixture; run admin FX_GROUP=admin -- --apply daemon
[ "$(rc admin)" = 1 ] && has admin "primary group is 'admin'" && untouched && pass "a CI user whose primary group is admin refuses" || fail "admin: rc $(rc admin) $(cat "$T/admin.out")"
fixture; run uid0 FX_CIUID=0 -- --apply daemon
[ "$(rc uid0)" = 1 ] && has uid0 "is root" && untouched && pass "a CI user with uid 0 refuses" || fail "uid0: rc $(rc uid0) $(cat "$T/uid0.out")"
fixture; run pgafter FX_PGREP_FAIL_LOADED=1 -- --apply daemon
[ "$(rc pgafter)" = 1 ] && has pgafter "could not list processes" && has pgafter "the daemon is loaded; to go back: sudo launchctl bootout system/$LABEL" \
  && pass "a pgrep failure after the bootstrap still says how to go back" || fail "pgafter: rc $(rc pgafter) $(cat "$T/pgafter.out")"
fixture; run plistmv FX_MV_PLIST_FAIL=1 -- --apply daemon
[ "$(rc plistmv)" = 1 ] && has plistmv "the LaunchAgent is back where it was" && [ -f "$AG" ] && [ ! -e "$(DP)" ] && [ ! -e "$(DP).new" ] && ! ls "$RA".retired-* >/dev/null 2>&1 \
  && pass "a failed write of the daemon plist puts the agent back" || fail "plistmv: rc $(rc plistmv) $(cat "$T/plistmv.out")"
fixture; mkdir -m 700 "$T/retired"; /bin/mv "$AG" "$RA.retired-20261103T000000Z"; run halfway -- --apply daemon
[ "$(rc halfway)" = 1 ] && has halfway "parked at $RA.retired-20261103T000000Z" && has halfway "sudo cat $RA.retired-20261103T000000Z | sudo -u kosmos-ci tee $AG" && ! has halfway "register the runner first" \
  && pass "a run stopped after parking the agent says to put it back, not to register again" || fail "halfway: rc $(rc halfway) $(cat "$T/halfway.out")"
# Round 5: "the agent is back" through a symlink to the daemon dir must print no move of the daemon plist.
fixture; run lk0 -- --apply daemon; /bin/mv "$H/Library/LaunchAgents" "$H/LA.gone"; ln -s "$T/daemons" "$H/Library/LaunchAgents"; run linkback -- daemon
[ "$(rc linkback)" = 1 ] && has linkback "no command is printed" && ! has linkback "sudo mv" && [ -f "$(DP)" ] \
  && pass "an agent path that is a symlink onto the daemon plist prints no move" || fail "linkback: rc $(rc linkback) $(cat "$T/linkback.out")"
fixture; run pgpark FX_PGREP_FAIL_PARKED=1 -- --apply daemon
[ "$(rc pgpark)" = 1 ] && has pgpark "could not list processes" && has pgpark "is written and the LaunchAgent is parked at $RA.retired-" && has pgpark "run this stage again" \
  && pass "a pgrep failure just before the bootstrap says what is written and parked, and how to go on or back" || fail "pgpark: rc $(rc pgpark) $(cat "$T/pgpark.out")"
fixture; run suppadmin FX_GROUPS="staff everyone admin" -- --apply daemon
[ "$(rc suppadmin)" = 1 ] && has suppadmin "is in the admin group" && untouched && pass "a CI user in admin (not as primary group) refuses" || fail "suppadmin: rc $(rc suppadmin) $(cat "$T/suppadmin.out")"
fixture; run linkput FX_MV_PLIST_FAIL=1 FX_LINK_ON_MV=1 -- --apply daemon
[ "$(rc linkput)" = 1 ] && has linkput "could not put $AG back (nothing was loaded): sudo -u kosmos-ci test ! -L $AG && sudo -u kosmos-ci test ! -e $AG && sudo test -f $RA.retired-" && ! has linkput "back where it was" && [ ! -e "$H/LA.real/$LABEL.plist" ] && ls "$RA".retired-* >/dev/null 2>&1 \
  && pass "a LaunchAgents dir swapped for a symlink mid-run: root does not write the agent back through it" || fail "linkput: rc $(rc linkput) $(cat "$T/linkput.out")"
fixture; printf 'x\n' > "$(DP)"; run replace -- --apply daemon
[ "$(rc replace)" = 0 ] && has replace "note:   replacing $(DP)" && pass "an unloaded wrong daemon plist is replaced, and said" || fail "replace: rc $(rc replace) $(cat "$T/replace.out")"
fixture; run plistmv2 FX_MV_PLIST_FAIL=1 -- --apply daemon
[ "$(rc plistmv2)" = 1 ] && [ -f "$AG" ] && [ "$(plutil -extract Label raw -o - "$AG")" = "$LABEL" ] && grep -q "^sudo -u kosmos-ci tee $AG" "$LOG" \
  && pass "the stage's own put-back writes the agent as the CI user (tee), with its content" || fail "plistmv2: rc $(rc plistmv2) $(cat "$T/plistmv2.out")"
fixture; run hl0 -- --apply daemon; ln "$(DP)" "$AG"; run hardlink -- daemon
[ "$(rc hardlink)" = 1 ] && has hardlink "no command is printed" && ! has hardlink "sudo mv" \
  && pass "an agent that is a hard link to the daemon plist (same file, no symlink) prints no move" || fail "hardlink: rc $(rc hardlink) $(cat "$T/hardlink.out")"
# Round 6: root never runs a copy a job can rewrite.
fixture; cp "$SCRIPT" "$H/ci-runner-setup.sh"; RUN_SCRIPT="$H/ci-runner-setup.sh" run copyhome -- --apply daemon
[ "$(rc copyhome)" = 2 ] && has copyhome "this is a copy in" && untouched && pass "--apply from a copy in the CI home refuses" || fail "copyhome: rc $(rc copyhome) $(cat "$T/copyhome.out")"
fixture; mkdir -p -m 755 "$T/gw"; cp "$SCRIPT" "$T/gw/ci-runner-setup.sh"; chmod 775 "$T/gw/ci-runner-setup.sh"; RUN_SCRIPT="$T/gw/ci-runner-setup.sh" run gw -- --apply daemon
[ "$(rc gw)" = 2 ] && has gw "$T/gw/ci-runner-setup.sh is not owned by root" && ! has gw "the directory of" && untouched && pass "--apply from a group-writable copy refuses" || fail "gw: rc $(rc gw) $(cat "$T/gw.out")"
fixture; cp "$SCRIPT" "$T/gw/ci-runner-setup.sh"; chmod 755 "$T/gw/ci-runner-setup.sh"; RUN_SCRIPT="$T/gw/ci-runner-setup.sh" run gwok -- daemon
[ "$(rc gwok)" = 0 ] && pass "a dry run from any copy still reads (the check is for --apply)" || fail "gwok: rc $(rc gwok) $(cat "$T/gwok.out")"
fixture; run np0 -- --apply daemon; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; /bin/mv "$T/procs.x" "$T/procs"; run nopid FX_NO_DPID=1 -- daemon
[ "$(rc nopid)" = 1 ] && has nopid "run this again in a minute" && has nopid "has no pid right now" && has nopid "sudo launchctl kickstart system/$LABEL" && ! has nopid "outside the daemon" && pass "a loaded daemon with no pid yet: restarting, its Listener not blamed" || fail "nopid: rc $(rc nopid) $(cat "$T/nopid.out")"
fixture; mkdir -m 700 "$T/retired"; /bin/mv "$AG" "$RA.retired-20261103T000000Z"; chmod 000 "$T/retired"   # as the CI user sees the root-only dir
run halfci FX_EUID=$CIU FX_WHO=kosmos-ci -- daemon; chmod 700 "$T/retired"
[ "$(rc halfci)" = 1 ] && has halfci "cannot look inside $T/retired (root only)" && ! has halfci "register the runner first" \
  && pass "a CI-user dry run that cannot see a parked agent says so, not register again" || fail "halfci: rc $(rc halfci) $(cat "$T/halfci.out")"
fixture; run dg0 -- --apply daemon; ln -s /nonexistent-7001 "$AG"; run dangling -- daemon
[ "$(rc dangling)" = 1 ] && ! has dangling "runs as a LaunchDaemon (system" && has dangling "no command is printed" && pass "a dangling symlink at the agent's path is not done" || fail "dangling: rc $(rc dangling) $(cat "$T/dangling.out")"
# Round 7.
fixture; listener 5018; run agentfirst FX_AGENT_LOADED=1 -- --apply daemon
[ "$(rc agentfirst)" = 1 ] && has agentfirst "sudo launchctl bootout gui/$CIU/$LABEL" && ! has agentfirst "kill its runsvc.sh" \
  && pass "a loaded agent with its Listener names the bootout, not a kill KeepAlive would undo" || fail "agentfirst: rc $(rc agentfirst) $(cat "$T/agentfirst.out")"
fixture; ln -s "$SCRIPT" "$T/link-setup.sh"; RUN_SCRIPT="$T/link-setup.sh" run selflink -- --apply daemon; rm -f "$T/link-setup.sh"
[ "$(rc selflink)" = 2 ] && has selflink "is a symlink" && untouched && pass "--apply through a symlinked script refuses" || fail "selflink: rc $(rc selflink) $(cat "$T/selflink.out")"
fixture; mkdir -p "$T/otherown"; cp "$SCRIPT" "$T/otherown/ci-runner-setup.sh"; RUN_SCRIPT="$T/otherown/ci-runner-setup.sh" run otherown -- --apply daemon
[ "$(rc otherown)" = 2 ] && has otherown "is not owned by root or by the sudo caller" && untouched && pass "--apply from a copy another user owns refuses" || fail "otherown: rc $(rc otherown) $(cat "$T/otherown.out")"
fixture; rm -f "$R/.service"; mkfifo "$R/.service"; run fifo -- --apply daemon
[ "$(rc fifo)" = 1 ] && has fifo ".service is not a regular file" && [ ! -e "$(DP)" ] && pass "a FIFO in place of .service refuses before root reads it" || fail "fifo: rc $(rc fifo) $(cat "$T/fifo.out")"
fixture; run rn0 -- --apply daemon; cp "$(ls "$RA".retired-*)" "$AG"; rm -f "$T/daemon-loaded"; grep -v ' 7001 ' "$T/procs" > "$T/procs.x"; /bin/mv "$T/procs.x" "$T/procs"
run noreplace FX_DATE=20261103T000001Z -- --apply daemon
[ "$(rc noreplace)" = 0 ] && ! has noreplace "note:   replacing" && pass "a right daemon plist written again is not called a replacement" || fail "noreplace: rc $(rc noreplace) $(cat "$T/noreplace.out")"
# #7877, round 8's warnings.
# 1: the re-check right before the move has its own arm (a symlink appears after planning, before the mv).
fixture; run mkdirlink FX_LINK_ON_MKDIR=1 -- --apply daemon
[ "$(rc mkdirlink)" = 1 ] && has mkdirlink "could not move $AG aside" && [ -f "$H/LA.real/$LABEL.plist" ] && [ ! -e "$(DP)" ] && [ ! -e "$(DP).new" ] \
  && ! grep -q '^mv .*\.retired-' "$LOG" && ! grep -q '^launchctl bootstrap' "$LOG" \
  && pass "a LaunchAgents dir swapped for a symlink just before the move refuses: root does not move through it" || fail "mkdirlink: rc $(rc mkdirlink) $(cat "$T/mkdirlink.out")"
# 2: an empty retired file (left by a printed move-aside whose copy failed) is never the one named or put back.
fixture; mkdir -m 700 "$T/retired"; /bin/mv "$AG" "$RA.retired-20261103T000000Z"; : > "$RA.retired-20261103T000001Z"; run emptyret -- --apply daemon
[ "$(rc emptyret)" = 1 ] && has emptyret "parked at $RA.retired-20261103T000000Z" && ! has emptyret 20261103T000001Z \
  && has emptyret "sudo -u kosmos-ci test ! -L $AG && sudo -u kosmos-ci test ! -e $AG && sudo test -f $RA.retired-20261103T000000Z && sudo test -s $RA.retired-20261103T000000Z && sudo cat $RA.retired-20261103T000000Z | sudo -u kosmos-ci tee $AG >/dev/null && sudo -u kosmos-ci test -s $AG && sudo cat $RA.retired-20261103T000000Z | sudo -u kosmos-ci cmp -s - $AG && sudo rm $RA.retired-20261103T000000Z && echo 'put back' || { if sudo test -f $RA.retired-20261103T000000Z; then if sudo -u kosmos-ci test -L $AG; then echo 'NOT finished; $RA.retired-20261103T000000Z is kept. $AG is a symlink" \
  && pass "an empty retired file is skipped, and the printed put-back removes the retired copy only after a compare" || fail "emptyret: rc $(rc emptyret) $(cat "$T/emptyret.out")"
# 2: the printed put-back, run in a shell with no pipefail, keeps the retired file when the copy fails. These arms run
# the printed text with sudo stripped (or a sudo shim): they pin the && / || flow; pbwho and pbwho2 pin who runs each probe.
PB="$(sed -n 's/.*put it back and run this again: //p' "$T/emptyret.out")"; RF="$RA.retired-20261103T000000Z"
mkdir -p "$T/pbbin"; printf '#!/bin/sh\n[ "$1" = -u ] && shift 2\n[ "$1" = cat ] && exit 1\nexec "$@"\n' > "$T/pbbin/sudo"; chmod 755 "$T/pbbin/sudo"
PBOUT="$(PATH="$T/pbbin:$PATH" sh -c "$PB" 2>&1)"
[ -n "$PB" ] && [ -s "$RF" ] && [ "$PBOUT" = "NOT finished; $RF is kept. $AG is empty (a copy that failed): remove it, then paste this again: sudo -u kosmos-ci rm $AG" ] && [ -f "$AG" ] && [ ! -s "$AG" ] && pass "the printed put-back, with a cat that fails, keeps the retired file" || fail "pbfail: [$PB] retired $(ls -l "$RF" 2>&1)"
rm -f "$AG"; PBOUT="$(sh -c "$(printf '%s' "$PB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$PBOUT" = "put back" ] && [ ! -e "$RF" ] && [ "$(plutil -extract Label raw -o - "$AG" 2>/dev/null)" = "$LABEL" ] && pass "and with a copy that works, the agent is back and the retired file gone" || fail "pbok: [$PB] agent $(ls -l "$AG" 2>&1)"
PBOUT="$(sh -c "$(printf '%s' "$PB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$PBOUT" = "nothing done: $RF is not there (already put back, or never parked), or the check could not run" ] && [ "$(plutil -extract Label raw -o - "$AG" 2>/dev/null)" = "$LABEL" ] \
  && pass "the printed put-back pasted again refuses and leaves the agent it put back" || fail "pbtwice: [$PBOUT] agent $(ls -l "$AG" 2>&1)"
# An agent already there (a svc.sh install) with the retired copy still parked: the put-back never writes over it.
cp "$AG" "$RF"; printf 'reinstalled\n' > "$AG"; PBOUT="$(sh -c "$(printf '%s' "$PB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$PBOUT" = "NOT finished; $RF is kept. $AG is there and not the same as it (a copy cut short, or a newer install); to put $RF back anyway, keep that one under another name first, then paste this again. If the rename says the name is taken, use another free name in place of $H/$LABEL.plist.newer-20261103T000000Z each time it appears in it. The rename: test ! -e $H/$LABEL.plist.newer-20261103T000000Z && test ! -L $H/$LABEL.plist.newer-20261103T000000Z && mv $AG $H/$LABEL.plist.newer-20261103T000000Z || echo not renamed: that name is taken or could not be checked" ] && [ "$(cat "$AG")" = reinstalled ] && [ -s "$RF" ] \
  && pass "the printed put-back refuses when an agent is already there, and keeps both files" || fail "pbover: [$PBOUT] agent $(cat "$AG" 2>&1)"
# kosmos#7887: and the advice works: keep the newer agent under the printed name, paste again, and both are kept.
NW="$H/$LABEL.plist.newer-20261103T000000Z"; ADV="$(printf '%s' "$PBOUT" | sed -n 's/.*The rename: //p')"; AOUT="$([ -n "$ADV" ] && sh -c "$ADV" 2>&1)"; PBOUT="$(sh -c "$(printf '%s' "$PB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$PBOUT" = "put back" ] && [ -z "$AOUT" ] && [ "$(cat "$NW")" = reinstalled ] && [ "$(plutil -extract Label raw -o - "$AG" 2>/dev/null)" = "$LABEL" ] && [ ! -e "$RF" ] \
  && pass "#7887: following the advice keeps the newer agent and puts the parked one back" || fail "pbfollow: [$PBOUT] [$AOUT] newer $(cat "$NW" 2>&1)"
printf 'other\n' > "$AG"; cp "$AG" "$T/other.bak"; echo x > "$RF"; PBOUT="$(sh -c "$(printf '%s' "$PB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
ADV2="$(printf '%s' "$PBOUT" | sed -n 's/.*The rename: //p')"; [ -n "$ADV2" ] && sh -c "$ADV2" >/dev/null; [ -n "$ADV2" ] && [ "$(cat "$NW")" = reinstalled ] && cmp -s "$AG" "$T/other.bak" \
  && pass "#7887: the printed rename never overwrites a name already taken" || fail "pbnoclobber: newer $(cat "$NW" 2>&1) agent $(cat "$AG" 2>&1)"
# kosmos#7899: that rename says so when its name is taken, and never replaces a symlink at that name (the CI home is
# writable by a job, so a dangling link there is a real state; test -e alone reads it as free).
PBTAKEN="not renamed: that name is taken or could not be checked"
AOUT="$(sh -c "$ADV2" 2>&1)"
[ -n "$ADV2" ] && [ "$AOUT" = "$PBTAKEN" ] && [ "$(cat "$NW")" = reinstalled ] && cmp -s "$AG" "$T/other.bak" \
  && pass "#7899: the put-back's rename says so when its name is taken" || fail "pbtaken: [$AOUT]"
/bin/mv "$NW" "$T/nw-7899.keep"; ln -s "$T/nowhere-7899/newer" "$NW"; AOUT="$(sh -c "$ADV2" 2>&1)"
[ "$AOUT" = "$PBTAKEN" ] && [ -L "$NW" ] && cmp -s "$AG" "$T/other.bak" \
  && pass "#7899: a dangling symlink at the put-back's rename name is not replaced" || fail "pbnamelink: [$AOUT] $(ls -l "$NW" 2>&1)"
rm -f "$NW"; /bin/mv "$T/nw-7899.keep" "$NW"
# kosmos#7887: a probe that could not run never reads as "the agent is empty": with the emptiness check failing, a
# non-empty different agent gets the rename advice, never the advice to remove it.
cp "$AG" "$T/ag.keep"; cp "$RF" "$T/rf.keep2" 2>/dev/null; printf 'other agent\n' > "$AG"; cp "$T/ag.keep" "$RF"
printf '#!/bin/sh\n[ "$1" = -u ] && shift 2\n[ "$1" = find ] && exit 1\n[ "$1 $2 $3" = "test -s %s" ] && exit 1\nexec "$@"\n' "$AG" > "$T/pbbin/sudo"
PBOUT="$(PATH="$T/pbbin:$PATH" sh -c "$PB" 2>&1)"
case "$PBOUT" in *"keep that one under another name first"*) ok7=1 ;; *) ok7=0 ;; esac
[ "$ok7" = 1 ] && [ "$(cat "$AG")" = "other agent" ] && pass "#7887: an emptiness probe that could not run never advises removing a non-empty agent" || fail "pbfindfail: [$PBOUT]"
cp "$T/ag.keep" "$AG"; [ -e "$T/rf.keep2" ] && cp "$T/rf.keep2" "$RF"; rm -f "$T/ag.keep" "$T/rf.keep2"
rm -f "$NW" "$T/other.bak"; cp "$RF" "$T/rf.keep" 2>/dev/null; printf 'reinstalled\n' > "$AG"; cp "$T/rf.keep" "$RF" 2>/dev/null; rm -f "$T/rf.keep"
# kosmos#7887: the printed put-back names what is actually there when it fails. Each arm builds the state, runs the
# printed text, and checks the last line and that no file was lost.
PBS="$(printf '%s' "$PB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')"
cp "$AG" "$T/agent.good"; rm -f "$AG"; : > "$RF"; PBOUT="$(sh -c "$PBS" 2>&1)"
[ "$PBOUT" = "NOT finished; nothing was written: $RF is kept, and is empty or could not be read (look at it: ls -l $RF)" ] && [ ! -e "$AG" ] && [ -e "$RF" ] \
  && pass "#7887: an empty retired file typed by hand says nothing was written, not that the agent is there" || fail "pbempty: [$PBOUT] agent $(ls -l "$AG" 2>&1)"
cp "$T/agent.good" "$RF"; rm -f "$AG"
printf '#!/bin/sh\n[ "$1" = -u ] && shift 2\n[ "$1" = rm ] && exit 1\nexec "$@"\n' > "$T/pbbin/sudo"
PBOUT="$(PATH="$T/pbbin:$PATH" sh -c "$PB" 2>&1)"
[ "$PBOUT" = "put back, but $RF was not removed: sudo rm $RF" ] && cmp -s "$AG" "$T/agent.good" && cmp -s "$RF" "$T/agent.good" \
  && pass "#7887: a good copy whose final rm fails says it is put back and names the rm, not a failed copy" || fail "pbrm: [$PBOUT]"
rm -f "$AG"; printf '#!/bin/sh\nexit 1\n' > "$T/pbbin/sudo"
PBOUT="$(PATH="$T/pbbin:$PATH" sh -c "$PB" 2>&1)"
[ "$PBOUT" = "nothing done: $RF is not there (already put back, or never parked), or the check could not run" ] && [ ! -e "$AG" ] && cmp -s "$RF" "$T/agent.good" \
  && pass "#7887: a sudo that does not run reads as could-not-check, never as already done, and nothing moves" || fail "pbnosudo: [$PBOUT]"
# A good retired file whose agent cannot be written (its folder is gone): the line says so, and does not blame R.
rm -f "$AG"; cp "$T/agent.good" "$RF"; /bin/mv "$H/Library/LaunchAgents" "$H/LA.away"; PBOUT="$(sh -c "$PBS" 2>&1 | tail -n 1)"; /bin/mv "$H/LA.away" "$H/Library/LaunchAgents"
[ "$PBOUT" = "NOT finished; $RF is kept and not empty, but $AG was not written: its folder is missing or not writable, or a step did not run (a refused password prompt); paste this again once that is fixed" ] && cmp -s "$RF" "$T/agent.good" \
  && pass "#7887: a good retired file whose agent cannot be written is not blamed for it" || fail "pbnofolder: [$PBOUT]"
# Round 7: a dangling symlink at the agent's path (a job can make one): the put-back writes nothing and says so.
cp "$T/agent.good" "$RF"; rm -f "$AG"; ln -s "$T/nowhere/agent.plist" "$AG"; PBOUT="$(sh -c "$PBS" 2>&1)"
[ "$PBOUT" = "NOT finished; $RF is kept. $AG is a symlink, which a job could have put there: look at it as root before anything else: ls -la $AG" ] && [ -L "$AG" ] && [ ! -e "$T/nowhere" ] && cmp -s "$RF" "$T/agent.good" \
  && pass "#7887: a symlink at the agent path is never written through, and is named" || fail "pbsymlink: [$PBOUT]"
rm -f "$AG"
# Who runs each probe is part of the text: the printed failure branch, as the operator sees it, with its sudo.
grep -q -F "elif sudo -u kosmos-ci test -s $AG && sudo cat $RF | sudo -u kosmos-ci cmp -s - $AG; then echo 'put back, but $RF was not removed: sudo rm $RF';" "$T/emptyret.out" \
  && pass "#7887: the printed failure branch reads the agent as the CI user and the retired file as root" || fail "pbwho: $(grep -o 'elif .\{0,160\}' "$T/emptyret.out" | head -1)"
# A directory typed as the retired file: the line says it is not a plain file, not that the agent could not be written.
rm -f "$AG"; mkdir -p "$T/notafile"; PBD="$(printf '%s' "$PBS" | sed "s#$RF#$T/notafile#g")"; PBOUT="$(sh -c "$PBD" 2>&1)"
[ "$PBOUT" = "nothing done: $T/notafile is not a plain file (a folder?): give the parked file itself" ] && [ ! -e "$AG" ] && [ -d "$T/notafile" ] \
  && pass "#7887: a folder given as the retired file says it is not a plain file" || fail "pbdir: [$PBOUT]"
rmdir "$T/notafile"
# And who runs the outer probes, as the operator sees them.
grep -q -F "|| { if sudo test -f $RF; then if sudo -u kosmos-ci test -L $AG; then echo" "$T/emptyret.out" \
  && pass "#7887: the outer probes of the printed failure branch run as root on the retired file and as the CI user on the agent" || fail "pbwho2: $(grep -o '|| { if .\{0,140\}' "$T/emptyret.out" | head -1)"
printf '#!/bin/sh\nexit 1\n' > "$T/pbbin/sudo"; cp "$T/agent.good" "$AG"; MVOUT="$(PATH="$T/pbbin:$PATH" sh -c "$MV" 2>&1)"
[ "$MVOUT" = "nothing done: $AG is not there (already moved aside), or the check could not run" ] && cmp -s "$AG" "$T/agent.good" && pass "#7887: the printed move-aside, with a sudo that does not run, says the check could not run" || fail "mvnosudo: [$MVOUT]"
# Round 3's BLOCKER: an empty retired file with a good agent in place never advises removing the agent.
cp "$T/agent.good" "$AG"; : > "$RF"; PBOUT="$(sh -c "$PBS" 2>&1)"
[ "$PBOUT" = "NOT finished; $RF is empty or could not be read, so nothing was put back: $AG is kept as it is" ] && cmp -s "$AG" "$T/agent.good" \
  && pass "#7887: an empty retired file with a good agent keeps the agent and never says to remove it" || fail "pbemptyagent: [$PBOUT]"
# The printed move-aside looks before it names a cause, as the put-back does. Its stamped name is D9.
rm -f "$D9"; cp "$T/agent.good" "$AG"; printf '#!/bin/sh\n[ "$1" = -u ] && shift 2\n[ "$1" = rm ] && exit 1\nexec "$@"\n' > "$T/pbbin/sudo"
MVOUT="$(PATH="$T/pbbin:$PATH" sh -c "$MV" 2>&1)"
[ "$MVOUT" = "moved aside, but $AG was not removed: sudo -u kosmos-ci rm $AG" ] && cmp -s "$AG" "$T/agent.good" && cmp -s "$D9" "$T/agent.good" \
  && pass "#7887: a move-aside whose final rm fails says it is moved aside and names the rm" || fail "mvrm: [$MVOUT]"
: > "$D9"; MVOUT="$(sh -c "$(printf '%s' "$MV" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$MVOUT" = "NOT finished; $AG is not removed. $D9 is there and not the same as it (a copy cut short, or an earlier parked copy); keep it under another name, then paste this again. If the rename says the name is taken, run the stage again for a new stamp. The rename: test ! -e $D9.earlier && test ! -L $D9.earlier && mv $D9 $D9.earlier || echo not renamed: that name is taken or could not be checked" ] && cmp -s "$AG" "$T/agent.good" \
  && pass "#7887: a move-aside onto a different file at its name keeps the agent and names that file" || fail "mvdiff: [$MVOUT]"
# kosmos#7887: and the advice works: keep that file under the printed name, paste again, and the agent moves aside.
ADV="$(printf '%s' "$MVOUT" | sed -n 's/.*The rename: //p')"; AOUT="$([ -n "$ADV" ] && sh -c "$ADV" 2>&1)"; MVOUT="$(sh -c "$(printf '%s' "$MV" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$MVOUT" = "moved aside" ] && [ -z "$AOUT" ] && [ ! -e "$AG" ] && cmp -s "$D9" "$T/agent.good" && [ -e "$D9.earlier" ] \
  && pass "#7887: following the move-aside advice keeps the earlier file and moves the agent aside" || fail "mvfollow: [$MVOUT] [$AOUT]"
printf 'third\n' > "$D9"; : > "$D9.earlier"; cp "$T/agent.good" "$AG"; MVOUT="$(sh -c "$(printf '%s' "$MV" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
ADV="$(printf '%s' "$MVOUT" | sed -n 's/.*The rename: //p')"; [ -n "$ADV" ] && sh -c "$ADV"
[ -n "$ADV" ] && [ "$(cat "$D9")" = third ] && [ ! -s "$D9.earlier" ] && pass "#7887: the printed rename never overwrites an earlier kept file" || fail "mvnoclobber: $(cat "$D9" 2>&1)"
# Round 7: an empty agent cannot be moved aside (nothing to copy); the line says so and to remove it, and following
# that leaves no agent and nothing wrongly parked.
rm -f "$D9" "$D9.earlier"; : > "$AG"; MVOUT="$(sh -c "$(printf '%s' "$MV" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ "$MVOUT" = "NOT finished; $AG is empty, so there is nothing to move aside: remove it: rm $AG" ] && sh -c "${MVOUT##*: }" && [ ! -e "$AG" ] \
  && pass "#7887: an empty agent is said to have nothing to move aside, and removing it works" || fail "mvempty: [$MVOUT]"
# kosmos#7899: a symlink at the agent's path, dangling or not, is named and nothing moves (a job can make one after
# the line was printed). Before, a dangling one read as "not there (already moved aside)".
MVS="$(printf '%s' "$MV" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')"
MVLINK="NOT finished; nothing was moved: $AG is a symlink, which a job could have put there: look at it as root before anything else: ls -la $AG"
rm -f "$D9" "$D9.earlier" "$AG"; ln -s "$T/nowhere-7899/agent.plist" "$AG"; MVOUT="$(sh -c "$MVS" 2>&1)"
[ "$MVOUT" = "$MVLINK" ] && [ -L "$AG" ] && [ ! -e "$D9" ] \
  && pass "#7899: a dangling symlink at the agent path is named, not called already moved aside" || fail "mvdangling: [$MVOUT]"
rm -f "$AG"; cp "$T/agent.good" "$T/linked-7899.plist"; ln -s "$T/linked-7899.plist" "$AG"; MVOUT="$(sh -c "$MVS" 2>&1)"
[ "$MVOUT" = "$MVLINK" ] && [ -L "$AG" ] && cmp -s "$T/linked-7899.plist" "$T/agent.good" && [ ! -e "$D9" ] \
  && pass "#7899: a symlink to a real file at the agent path is not moved through" || fail "mvlivelink: [$MVOUT]"
rm -f "$AG" "$T/linked-7899.plist"
# kosmos#7899: the .earlier rename says so when its name is taken, and never replaces a symlink at that name.
MVTAKEN="not renamed: that name is taken or could not be checked"
printf 'third\n' > "$D9"; printf 'kept\n' > "$D9.earlier"; cp "$T/agent.good" "$AG"; MVOUT="$(sh -c "$MVS" 2>&1)"
ADV="$(printf '%s' "$MVOUT" | sed -n 's/.*The rename: //p')"; AOUT="$(sh -c "$ADV" 2>&1)"
[ -n "$ADV" ] && [ "$AOUT" = "$MVTAKEN" ] && [ "$(cat "$D9")" = third ] && [ "$(cat "$D9.earlier")" = kept ] && cmp -s "$AG" "$T/agent.good" \
  && pass "#7899: the .earlier rename says so when its name is taken" || fail "mvearliertaken: [$AOUT] [$ADV]"
rm -f "$D9.earlier"; ln -s "$T/nowhere-7899/earlier" "$D9.earlier"; AOUT="$(sh -c "$ADV" 2>&1)"
[ -n "$ADV" ] && [ "$AOUT" = "$MVTAKEN" ] && [ -L "$D9.earlier" ] && [ "$(cat "$D9")" = third ] \
  && pass "#7899: a dangling symlink at the .earlier name is not replaced" || fail "mvearlierlink: [$AOUT]"
rm -f "$D9"
rm -f "$D9.earlier"
rm -f "$D9" "$AG"
rm -f "$RF" "$T/agent.good"
# 2: the stage's own put-back, when the copy comes out short, keeps the retired file and prints how to put it back.
fixture; run teeshort FX_MV_PLIST_FAIL=1 FX_TEE_SHORT=1 -- --apply daemon
[ "$(rc teeshort)" = 1 ] && has teeshort "could not put $AG back (nothing was loaded): sudo -u kosmos-ci test ! -L $AG && sudo -u kosmos-ci test ! -e $AG && sudo test -f $RA.retired-" && [ -s "$(ls "$RA".retired-* 2>/dev/null | head -n 1)" ] \
  && [ "$(wc -c < "$(ls "$RA".retired-* | head -n 1)")" -gt 20 ] && [ ! -e "$AG" ] && pass "a short copy on the stage's own put-back keeps the retired file and removes the short agent" || fail "teeshort: rc $(rc teeshort) $(cat "$T/teeshort.out")"
# kosmos#7887: and the put-back that line prints really puts the agent back from that state.
TPB="$(sed -n 's/.*could not put .* back (nothing was loaded): //p' "$T/teeshort.out")"
TOUT="$(sh -c "$(printf '%s' "$TPB" | sed 's/sudo -u kosmos-ci //g; s/sudo //g')" 2>&1)"
[ -n "$TPB" ] && [ "$TOUT" = "put back" ] && [ "$(plutil -extract Label raw -o - "$AG" 2>/dev/null)" = "$LABEL" ] && ! ls "$RA".retired-* >/dev/null 2>&1 \
  && pass "#7887: the put-back teeshort prints, pasted, puts the agent back" || fail "teeshortpaste: [$TOUT] [$TPB]"
# 3: a FIFO at the plist name .service gives refuses and does not hang (the alarm in run() fails a hang). The real plutil
# refuses a FIFO by itself (measured: rc 1, no hang); the plutil stand-in blocks on one, so only runner_plist's own -f
# check keeps this arm green.
fixture; RL="$H/Library/LaunchAgents/actions.runner.joshualeestone-kosmos-relay.x.plist"; mkfifo "$RL"; printf '%s\n' "$RL" > "$R/.service"
run plfifo -- --apply daemon
[ "$(rc plfifo)" = 1 ] && has plfifo ".service does not name" && untouched && pass "a FIFO at the plist .service names refuses, never read" || fail "plfifo: rc $(rc plfifo) $(cat "$T/plfifo.out")"
# runner_plist never has root parse a symlink at the plist name .service gives (it could point at any file).
fixture; RL="$H/Library/LaunchAgents/actions.runner.joshualeestone-kosmos-relay.y.plist"; cp "$AG" "$T/elsewhere.plist"; ln -s "$T/elsewhere.plist" "$RL"; printf '%s\n' "$RL" > "$R/.service"
run pllink -- --apply daemon
[ "$(rc pllink)" = 1 ] && has pllink ".service does not name" && ! grep -q -F "plutil -extract WorkingDirectory raw -o - $RL" "$LOG" && untouched \
  && pass "a symlink at the plist name .service gives is refused before plutil reads it" || fail "pllink: rc $(rc pllink) $(grep plutil "$LOG" | head -3)"
# kosmos#7887: the positive control for pllink: the same name as a regular file IS read by plutil, and the log records it.
fixture; RL="$H/Library/LaunchAgents/actions.runner.joshualeestone-kosmos-relay.y.plist"; cp "$AG" "$RL"; printf '%s\n' "$RL" > "$R/.service"
run pllinkctl -- --apply daemon
[ "$(rc pllinkctl)" = 1 ] && grep -q -F "plutil -extract WorkingDirectory raw -o - $RL" "$LOG" && pass "#7887: CONTROL for pllink: a regular plist at that name is read, and the log shows the read" || fail "pllinkctl: rc $(rc pllinkctl) $(grep plutil "$LOG" | head -3)"
# kosmos#7887: a retired dir with a quote in its name would turn printed text into code run as root: refused at once.
fixture; run quotedir "KOSMOS_CI_RETIRED_DIR=$T/it's" -- daemon
[ "$(rc quotedir)" = 2 ] && has quotedir "KOSMOS_CI_RETIRED_DIR" && has quotedir "may hold only letters" && pass "#7887: a retired dir with a quote in it is refused before anything" || fail "quotedir: rc $(rc quotedir) $(cat "$T/quotedir.out")"
fixture; run reldir "KOSMOS_CI_DAEMON_DIR=-x/y" -- daemon
[ "$(rc reldir)" = 2 ] && has reldir "KOSMOS_CI_DAEMON_DIR '-x/y' must be an absolute path" && pass "#7887: a dir seam that is not an absolute path is refused, named" || fail "reldir: rc $(rc reldir) $(cat "$T/reldir.out")"
fixture; run relhome "KOSMOS_CI_HOME=-x" -- daemon
[ "$(rc relhome)" = 2 ] && has relhome "must be an absolute path" && pass "#7887: a CI home that is not an absolute path is refused" || fail "relhome: rc $(rc relhome) $(cat "$T/relhome.out")"
# NIT: signals are ignored from the first write to the bootstrap.
fixture; run sigs FX_TERM_ON_MV=1 -- --apply daemon
[ "$(rc sigs)" = 0 ] && has sigs "Listener pid 7001 under pid 7000" && grep -q "^launchctl bootstrap system" "$LOG" \
  && pass "a TERM, ^C or hangup while the agent is parked does not stop the stage before the load" || fail "sigs: rc $(rc sigs) $(cat "$T/sigs.out")"
# NIT: a setuid script that is group-writable is still refused (%Lp is the low bits only: 4775 reads 775, measured).
fixture; mkdir -p -m 755 "$T/suid"; cp "$SCRIPT" "$T/suid/ci-runner-setup.sh"; chmod 4775 "$T/suid/ci-runner-setup.sh"; RUN_SCRIPT="$T/suid/ci-runner-setup.sh" run suid -- --apply daemon
[ "$(rc suid)" = 2 ] && has suid "$T/suid/ci-runner-setup.sh is not owned by root" && ! has suid "the directory of" && untouched && pass "--apply from a setuid group-writable copy refuses" || fail "suid: rc $(rc suid) $(cat "$T/suid.out")"
# NIT: a script in a directory others can write refuses (a rename replaces it).
fixture; mkdir -p "$T/gwdir"; chmod 775 "$T/gwdir"; cp "$SCRIPT" "$T/gwdir/ci-runner-setup.sh"; chmod 755 "$T/gwdir/ci-runner-setup.sh"; RUN_SCRIPT="$T/gwdir/ci-runner-setup.sh" run gwdir -- --apply daemon
[ "$(rc gwdir)" = 2 ] && has gwdir "the directory of" && untouched && pass "--apply from a directory others can write refuses" || fail "gwdir: rc $(rc gwdir) $(cat "$T/gwdir.out")"
# A loaded daemon with no pid while a Listener of this runner runs: name it, and never advise a kickstart (a second one).
fixture; run npl0 -- --apply daemon; run nopidlst FX_NO_DPID=1 -- daemon
[ "$(rc nopidlst)" = 1 ] && has nopidlst "a Listener of this runner runs (pid 7001" && ! has nopidlst "sudo launchctl kickstart" \
  && pass "no pid but a Listener running: names it, no kickstart" || fail "nopidlst: rc $(rc nopidlst) $(cat "$T/nopidlst.out")"
# kosmos#8404: another runner of the same user (Mortals has three, one per repo), named by its repo and its dir.
L2=actions.runner.joshualeestone-chaoskosmos-site.mortals-site
second() {   # a second runner beside this repo's, as svc.sh leaves it, and THIS repo's runner's Listener running (5018)
  fixture; R2="$H/actions-runner-site"; mkdir -p "$R2"; AG2="$H/Library/LaunchAgents/$L2.plist"
  sed -e "s|$LABEL|$L2|" -e "s|$R<|$R2<|g" "$AG" > "$AG2"; printf '%s\n' "$AG2" > "$R2/.service"; listener 5018
}
two=(KOSMOS_CI_REPO=joshualeestone/chaoskosmos-site KOSMOS_CI_RUNNER_NAME=mortals-site)
second; run two FX_R="$R2" FX_LABEL="$L2" "${two[@]}" "KOSMOS_CI_RUNNER_DIR=$R2" -- --apply daemon
D2="$T/daemons/$L2.plist"
[ "$(rc two)" = 0 ] && [ -f "$D2" ] && grep -q -F "<string>$R2/runsvc.sh</string>" "$D2" && grep -q -F "<key>WorkingDirectory</key><string>$R2</string>" "$D2" \
  && [ ! -e "$AG2" ] && [ -e "$AG" ] && [ ! -e "$(DP)" ] && ! has two "pid 5018" \
  && pass "#8404: a second runner, named by its repo and dir, becomes its own daemon; this repo's runner and its Listener are untouched" \
  || fail "#8404 two: rc $(rc two) $(cat "$T/two.out")"
# CONTROL: the same runner without the dir is looked for in actions-runner, where this repo's Listener runs, so it refuses.
second; run twonodir FX_R="$R2" FX_LABEL="$L2" "${two[@]}" -- --apply daemon
[ "$(rc twonodir)" = 1 ] && [ ! -e "$D2" ] && pass "#8404: CONTROL: without KOSMOS_CI_RUNNER_DIR the second runner is not found, and nothing is written" \
  || fail "#8404 twonodir: rc $(rc twonodir) $(cat "$T/twonodir.out")"
# A Listener of the second runner outside the daemon (the cron stopgap's runsvc.sh start) still refuses, named.
second; echo "$CIU 5300 1 $R2/bin/Runner.Listener run" >> "$T/procs"; run twoman FX_R="$R2" FX_LABEL="$L2" "${two[@]}" "KOSMOS_CI_RUNNER_DIR=$R2" -- --apply daemon
[ "$(rc twoman)" = 1 ] && has twoman "runs outside the daemon (pid 5300" && ! has twoman "5018" && [ ! -e "$D2" ] \
  && pass "#8404: the second runner's own manual Listener refuses, naming only its pid" || fail "#8404 twoman: rc $(rc twoman) $(cat "$T/twoman.out")"
# Jobs are told apart by runner too: a job on this repo's runner does not stop the second's daemon; the second's own does.
second; echo "$CIU 6100 1 $R/bin/Runner.Worker spawnclient 1 2" >> "$T/procs"; run twojobother FX_R="$R2" FX_LABEL="$L2" "${two[@]}" "KOSMOS_CI_RUNNER_DIR=$R2" -- --apply daemon
[ "$(rc twojobother)" = 0 ] && [ -f "$D2" ] && pass "#8404: a job on this repo's runner does not refuse the second runner's daemon" || fail "#8404 twojobother: rc $(rc twojobother) $(cat "$T/twojobother.out")"
second; echo "$CIU 6200 1 $R2/bin/Runner.Worker spawnclient 1 2" >> "$T/procs"; run twojob FX_R="$R2" FX_LABEL="$L2" "${two[@]}" "KOSMOS_CI_RUNNER_DIR=$R2" -- --apply daemon
[ "$(rc twojob)" = 1 ] && has twojob "a job is running (Runner.Worker 6200" && ! has twojob 6100 && [ ! -e "$D2" ] \
  && pass "#8404: the second runner's own job refuses its daemon, named" || fail "#8404 twojob: rc $(rc twojob) $(cat "$T/twojob.out")"
# The two settings are for the daemon stage only: every other stage refuses them before reading anything.
for st in preflight create-user verify register keepalive jq-programs "install 0123456789abcdef0123456789abcdef01234567 $(printf '0%.0s' $(seq 64))"; do
  # shellcheck disable=SC2086  # $st carries install's two arguments
  fixture; run "only-${st%% *}" "KOSMOS_CI_REPO=joshualeestone/chaoskosmos-site" -- $st; st="${st%% *}"
  [ "$(rc "only-$st")" = 2 ] && has "only-$st" "for the daemon stage only" && pass "#8404: $st refuses KOSMOS_CI_REPO" || fail "#8404 only-$st: rc $(rc "only-$st") $(cat "$T/only-$st.out")"
done
fixture; run onlydir "KOSMOS_CI_RUNNER_DIR=$H/actions-runner-site" -- verify
[ "$(rc onlydir)" = 2 ] && has onlydir "for the daemon stage only" && pass "#8404: verify refuses KOSMOS_CI_RUNNER_DIR" || fail "#8404 onlydir: rc $(rc onlydir) $(cat "$T/onlydir.out")"
# A dir that is not one plain directory directly in the CI home is refused, named, before anything.
i=0
for bad in "$H/../x" "/tmp/actions-runner" "$H/a/b" "$H/a b" "$H/.." "$H" "$H/" "actions-runner" "$H/x;y"; do
  i=$((i + 1)); fixture; run "baddir$i" "KOSMOS_CI_RUNNER_DIR=$bad" -- daemon
  [ "$(rc "baddir$i")" = 2 ] && has "baddir$i" "KOSMOS_CI_RUNNER_DIR" && has "baddir$i" "must be one directory directly in" \
    && pass "#8404: KOSMOS_CI_RUNNER_DIR '$bad' is refused" || fail "#8404 baddir '$bad': rc $(rc "baddir$i") $(cat "$T/baddir$i.out")"
done
# CONTROL: the default spelled out, with a trailing slash, is this repo's runner as before.
fixture; run okdir "KOSMOS_CI_RUNNER_DIR=$H/actions-runner/" -- daemon
[ "$(rc okdir)" = 0 ] && has okdir "WOULD: write $(DP)" && pass "#8404: CONTROL: the default dir spelled out is accepted and is this repo's runner" || fail "#8404 okdir: rc $(rc okdir) $(cat "$T/okdir.out")"
# A repo that is not owner/name is refused (it goes into the label, a jq string and a gh path).
i=0
for bad in kosmos "a/b/c" ".x/y" "x/.y" "/y" "x/" "x y/z" "x/y'z"; do
  i=$((i + 1)); fixture; run "badrepo$i" "KOSMOS_CI_REPO=$bad" -- daemon
  [ "$(rc "badrepo$i")" = 2 ] && has "badrepo$i" "must be owner/name" && pass "#8404: KOSMOS_CI_REPO '$bad' is refused" || fail "#8404 badrepo '$bad': rc $(rc "badrepo$i") $(cat "$T/badrepo$i.out")"
done
[ "$fails" = 0 ] && echo "test-ci-runner-daemon-7001: all passed" || { echo "test-ci-runner-daemon-7001: $fails failed"; exit 1; }
