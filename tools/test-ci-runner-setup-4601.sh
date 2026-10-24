#!/usr/bin/env bash
# #4601: tools/ci-runner-setup.sh turns a fleet Mac into the self-hosted CI runner, and its DRY RUN (the default)
# must change nothing. Every command it could reach that changes something (sudo, sysadminctl, curl downloads, tar,
# config.sh, svc.sh) and every machine read (launchctl, crontab, pgrep, df, fdesetup, pmset, id, ps, gh) is a stub
# on PATH that logs its argv, under a sandbox HOME. A dry run must leave the log free of every changing call and the
# HOME byte-identical; the CONTROL is the same stage with --apply, which must reach the stubs, so this test can see
# a call when one happens.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
S="$HERE/ci-runner-setup.sh"
# Several cases make a dir mode 000 and expect it unreadable, which root ignores: say so rather than red for that.
if [ "$(id -u)" = 0 ]; then echo "skip test-ci-runner-setup-4601: run as root, where mode 000 does not block reads"; exit 0; fi
T="$(mktemp -d "${TMPDIR:-/tmp}/test-ci-runner-setup-4601.XXXXXXXXXX")" || exit 1; [ -d "$T" ] || exit 1; trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT   # chmod: some cases make dirs 000
fails=0
# The test's own errors (a helper used before it is defined) print and pass on; keep them and fail on them at the end.
exec 2> >(tee "$T/test-stderr" >&2)
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

BIN="$T/bin"; mkdir -p "$BIN"
LOG="$T/calls.log"
# One stub body for every command: log, then answer from the fixture variables.
cat > "$BIN/_stub" <<'STUB'
#!/bin/bash
me="$(basename "$0")"
printf '%s' "$me" >> "$CALL_LOG"; printf ' %s' "$@" >> "$CALL_LOG"; printf '\n' >> "$CALL_LOG"
case "$me" in
  launchctl)   # `launchctl print gui/<uid>`, in the shape measured on Agent1s 2026-10-14
    [ "${FX_LAUNCHCTL_FAIL:-0}" = 1 ] && exit 1
    [ "$1" = managername ] && { echo "${FX_MANAGER:-Aqua}"; exit 0; }
    [ "$1" = manageruid ] && { echo "${FX_MANAGERUID:-777}"; exit 0; }
    # kosmos#7001: one service by name (gui/<uid>/<label>) is listed until a bootout; a bootstrap starts the runner as
    # svc.sh start does (cwd is the runner dir), so wait_for_listener sees a new Listener.
    out="$(dirname "$CALL_LOG")/booted-out"
    case "$1" in
      kill) [ "${FX_KILL_FAIL:-0}" = 1 ] && exit 3; exit 0 ;;
      bootout) # Whether the old job's process (FX_JOB_PID) was still alive when the bootout came: the test asserts it.
        [ -z "${FX_JOB_PID:-}" ] || { kill -0 "$FX_JOB_PID" 2>/dev/null && echo "bootout-while-alive" >> "$CALL_LOG" || echo "bootout-after-exit" >> "$CALL_LOG"; }
        [ "${FX_BOOTOUT_FAIL:-0}" = 1 ] && exit 5; [ "${FX_BOOTOUT_STUCK:-0}" = 1 ] && exit 0; touch "$out"; exit 0 ;;
      bootstrap) [ "${FX_BOOTSTRAP_FAIL:-0}" = 1 ] && exit 5; rm -f "$out"; touch "$(dirname "$CALL_LOG")/bootstrapped"
        [ "${FX_LISTENER:-1}" = 1 ] && echo started > .svc-state
        # The loaded job has KeepAlive exactly when the plist it was loaded from does (state kept across runs). The printed
        # shape is copied from a real capture (runner 1, macOS 27.0.1, 2026-10-23): "\tsemaphores = {" /
        # "\t\tsuccessful exit => 0" / "\t}" and "\texit timeout = 5" for a job that does not set ExitTimeOut.
        if [ "${FX_BOOTSTRAP_NO_KA:-0}" != 1 ] && [ "$(plutil -extract KeepAlive.SuccessfulExit raw -o - "$3" 2>/dev/null)" = false ]; then
          plutil -extract ExitTimeOut raw -o - "$3" 2>/dev/null > "$(dirname "$CALL_LOG")/loaded-ka" || echo 5 > "$(dirname "$CALL_LOG")/loaded-ka"
        else rm -f "$(dirname "$CALL_LOG")/loaded-ka"; fi
        echo $(( $(cat .svc-pid 2>/dev/null || echo 4343) + 1 )) > .svc-pid; exit 0 ;;
    esac
    case "$1 $2" in "print gui/"*/*) { [ -f "$out" ] || [ "${FX_NOT_LOADED:-0}" = 1 ]; } && exit 113
        printf '%s = {\n\tstate = %s\n' "$2" "${FX_JOB_STATE:-running}"
        # A running job shows its pid (999999 by default: a pid that cannot exist, so a wait on it ends at once).
        [ "${FX_NO_PID:-0}" = 1 ] || printf '\tpid = %s\n' "${FX_JOB_PID:-999999}"
        lk="$(dirname "$CALL_LOG")/loaded-ka"
        [ -f "$lk" ] && printf '\tsemaphores = {\n\t\tsuccessful exit => 0\n\t}\n'
        printf '\texit timeout = %s\n' "$( [ -s "$lk" ] && cat "$lk" || echo 5)"
        printf '}\n'; exit 0 ;; esac
    [ "$1 ${2%%/*}" = "print gui" ] || exit 1
    [ "${FX_NO_SERVICES:-0}" = 1 ] && { printf 'gui/501 = {\n\ttype = login\n\tservices = {\n\t}\n}\n'; exit 0; }
    printf 'gui/501 = {\n\ttype = login\n\tservices = {\n'
    printf '\t\t     %s      - \t%s\n' 874 com.apple.Finder 471 application.com.apple.Terminal.1234.5678 612 com.openssh.ssh-agent
    [ -z "${FX_JOBS:-}" ] || printf '%s\n' "$FX_JOBS" | sed 's/^/\t\t     -      0 \t/'
    printf '\t}\n\n\tunmanaged processes = {\n\t\tcom.example.notajob = {\n\t\t}\n\t}\n}\n' ;;
  crontab)
    [ "${FX_CRON_FAIL:-0}" = 1 ] && { echo "crontab: tmp/tmp.123: Operation not permitted" >&2; exit 1; }
    [ -z "${FX_CRON:-}" ] && { echo "crontab: no crontab for ${FX_WHO:-agent1}" >&2; exit 1; }; printf '%s\n' "$FX_CRON" ;;
  pgrep)
    [ "${FX_PGREP_FAIL:-0}" = 1 ] && exit 3
    # A Listener runs while this runner dir's svc state is "started" (cwd is the runner dir), with the pid start gave it.
    # kosmos#7001: a -f pattern is matched (ERE) against this runner's Listener argv and the relay's (#6245), so a pattern
    # that cannot tell the two apart is seen. The relay's pid changes once anything was bootstrapped (a respawn).
    case "$*" in *"-f "*Runner.Listener*)
      [ "${FX_LISTENER_PGREP_FAIL:-0}" = 1 ] && exit 3
      pat="${*: -1}"; own="${KOSMOS_CI_HOME:-/Users/kosmos-ci}/actions-runner/bin/Runner.Listener run --startuptype service"
      rel="${KOSMOS_CI_HOME:-/Users/kosmos-ci}/actions-runner-relay/bin/Runner.Listener run --startuptype service"; hit=1
      if [ "${FX_LISTENER:-1}" = 1 ] && [ "$(cat .svc-state 2>/dev/null)" = started ] && printf '%s\n' "$own" | grep -q -E -e "$pat"; then cat .svc-pid 2>/dev/null || echo 4343; hit=0; fi
      if [ "${FX_RELAY_LISTENER:-0}" = 1 ] && printf '%s\n' "$rel" | grep -q -E -e "$pat"; then
        [ -f "$(dirname "$CALL_LOG")/bootstrapped" ] && echo 5556 || echo 5555; hit=0; fi
      exit "$hit" ;; esac
    case "$*" in *Runner.Listener*) [ "${FX_LISTENER_PGREP_FAIL:-0}" = 1 ] && [ "$(cat .svc-state 2>/dev/null)" = started ] && [ -e .svc-pid ] && exit 3; # FX_OLD_TOO: another Listener (an old one, or one started by hand) listed first whatever the service's state.
      if [ "${FX_LISTENER:-1}" = 1 ] && [ "$(cat .svc-state 2>/dev/null)" = started ]; then [ -z "${FX_OLD_TOO:-}" ] || echo "$FX_OLD_TOO"; cat .svc-pid 2>/dev/null || echo 4343; exit 0; fi
      [ -n "${FX_OLD_TOO:-}" ] && { echo "$FX_OLD_TOO"; exit 0; }; exit 1 ;; esac
    # A self-updated runner's Worker runs from bin.<version>/Runner.Worker: a name match (-x) sees it, bin/Runner.Worker does not.
    case "$*" in *Runner.Worker*) [ "${FX_WORKER:-0}" = 1 ] || exit 1; case "$*" in *"-x Runner.Worker"*) echo 4242; exit 0 ;; esac; exit 1 ;; esac
    [ -z "${FX_LIVE:-}" ] && exit 1; printf '%s\n' "$FX_LIVE" ;;
  df) [ "${FX_DF_NOROW:-0}" = 1 ] && { echo "Filesystem 1024-blocks Used Available Capacity Mounted"; exit 0; }
    printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk3s1 239362496 1 %s 50%% /\n' "${FX_FREE_KIB-31457280}" ;;
  fdesetup) echo "${FX_FV:-FileVault is Off.}" ;;
  pmset) printf 'System-wide power settings:\nCurrently in use:\n standby              0\n sleep                %s\n autorestart          %s\n displaysleep         10\n' "${FX_SLEEP:-0}" "${FX_AUTORESTART:-1}" ;;
  id)
    case "$1" in
      -un) echo "${FX_WHO:-agent1}" ;;
      -Gn) [ "${FX_GROUPS_FAIL:-0}" = 1 ] && exit 1; echo "${FX_GROUPS:-staff everyone}" ;;
      -u)   # per user: agent1 501, kosmos-ci 777 once it exists (or 501 with FX_SAME_UID), anyone else 900
        u="${2:-${FX_WHO:-agent1}}"
        case "$u" in
          agent1) echo 501 ;;
          kosmos-ci) if [ -z "${2:-}" ] || [ "${FX_CI_EXISTS:-0}" = 1 ] || [ -f "$(dirname "$CALL_LOG")/user-created" ]; then
                       [ "${FX_SAME_UID:-0}" = 1 ] && echo 501 || echo 777
                     else exit 1; fi ;;
          *) echo 900 ;;
        esac ;;
      *) [ "${FX_CI_EXISTS:-0}" = 1 ] || [ -f "$(dirname "$CALL_LOG")/user-created" ] || { echo "id: $1: no such user" >&2; exit 1; }; echo "uid=777($1)" ;;
    esac ;;
  xcode-select) [ "${FX_NO_CLT:-0}" = 1 ] && exit 2; echo /Library/Developer/CommandLineTools ;;
  ps) [ "${FX_PS_FAIL:-0}" = 1 ] && exit 1
    # An idle runner as svc.sh starts it (actions/runner runsvc.sh): its service host is node.
    printf '%s\n' "/bin/bash /Users/kosmos-ci/actions-runner/runsvc.sh" "./externals/node24/bin/node ./bin/RunnerService.js" \
      "/Users/kosmos-ci/actions-runner/bin/Runner.Listener run --startuptype service"
    [ -z "${FX_PS:-}" ] || printf '%s\n' "$FX_PS" ;;
  gh)
    [ "${FX_GH_FAIL:-0}" = 1 ] && exit 1
    [ "${FX_GH_500:-0}" = 1 ] && { echo "gh: Server Error (HTTP 500)" >&2; exit 1; }
    case "$*" in
      *"actions/variables?per_page=1"*) [ "${FX_VARLIST_FAIL:-0}" = 1 ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }; echo '{}' ;;
      *actions/variables/KOSMOS_CI_SHELL_SHARDS*) [ -n "${FX_SHARDS+set}" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }; [ -z "${FX_GH_STDERR:-}" ] || echo "$FX_GH_STDERR" >&2; printf '=%s' "$FX_SHARDS" ;;
      *actions/variables/KOSMOS_CI_RUNNER*) printf '=%s' "${FX_RUNNER_VAR-on}" ;;
      *"| .busy"*) [ "${FX_BUSY2_FAIL:-0}" = 1 ] && exit 1; row="${FX_RUNNER_ROW-online false x}"; set -- $row; printf '%s\n' "${FX_BUSY2:-$2}" ;;
      *actions/runners*) printf '%s\n' "${FX_RUNNER_ROW-online false arm64,kosmos-ci,macos,self-hosted}" ;;
    esac ;;
  curl)
    out=""; big=0; prev=""
    for a in "$@"; do [ "$prev" = -o ] && out="$a"; case "$a" in -*O*) big=1 ;; esac; prev="$a"; done
    url="${*: -1}"
    if [ -n "$out" ]; then printf '%s' "${FX_GUARD_BODY:-guard}" > "$out"
    elif [ "$big" = 1 ]; then
      if [ "${FX_DL_PARTIAL:-0}" = 1 ]; then printf 'runner-pa' > "$(basename "$url")"; exit 18; fi
      printf 'runner-package' > "$(basename "$url")"
    else case "$url" in
      */compare/*) printf '{\n  "status": "%s",\n' "${FX_COMPARE:-ahead}" ;;
      */releases/latest) printf '{"tag_name": "v2.999.0", "body": "<!-- BEGIN SHA osx-arm64 -->%s<!-- END SHA osx-arm64 -->"}' "${FX_RELEASE_SHA:-$(printf 'runner-package' | shasum -a 256 | cut -d' ' -f1)}" ;;
    esac; fi ;;
  sudo) case "$*" in *"sysadminctl -addUser"*) [ "${FX_SYSADMIN_NOOP:-0}" = 1 ] || : > "$(dirname "$CALL_LOG")/user-created" ;; esac ;;
  tar) [ "${FX_TAR_FAIL:-0}" = 1 ] && exit 1 ;;
  config.sh)   # as actions/runner: refuses once configured (.runner), else configures and writes .path from env.sh
    [ -f "$(dirname "$0")/.runner" ] && { echo "Cannot configure the runner because it is already configured." >&2; exit 1; }
    printf 'token-in-env=%s\n' "${ACTIONS_RUNNER_INPUT_TOKEN:-}" >> "$CALL_LOG"
    echo '{"agentName":"x"}' > "$(dirname "$0")/.runner"
    echo "/login/shell/path:/usr/bin" > "$(dirname "$0")/.path" ;;
  svc.sh)
    st="$(dirname "$0")/.svc-state"
    case "$1" in
      # As actions/runner's svc.sh: a LaunchAgent with RunAtLoad and NO KeepAlive (kosmos#7001).
      install) [ "${FX_SVC_NO_PLIST:-0}" = 1 ] && exit 0; mkdir -p "$HOME/Library/LaunchAgents"
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
          '<plist version="1.0"><dict><key>Label</key><string>actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s</string>' \
          '<key>ProgramArguments</key><array><string>runsvc.sh</string></array><key>RunAtLoad</key><true/></dict></plist>' \
          > "$HOME/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist"
        echo "$HOME/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist" > "$(dirname "$0")/.service" ;;
      # FX_SVC_STOP_LAG=N: a stop still in progress reads Started for N more status calls (kosmos#7001).
      status) lag="$(dirname "$0")/.svc-lag"; n="$(cat "$lag" 2>/dev/null || echo 0)"
        if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$lag"; echo "Started"
        elif [ "${FX_SVC_STUCK:-0}" = 1 ] || [ "$(cat "$st" 2>/dev/null)" = started ]; then echo "Started"; else echo "Stopped"; fi ;;
      stop) echo stopped > "$st"; [ -z "${FX_SVC_STOP_LAG:-}" ] || echo "$FX_SVC_STOP_LAG" > "$(dirname "$0")/.svc-lag" ;;
      start) [ "${FX_SVC_START_FAIL:-0}" = 1 ] && exit 1; echo started > "$st"
        [ "${FX_SAME_PID:-0}" = 1 ] || echo $(( $(cat "$(dirname "$0")/.svc-pid" 2>/dev/null || echo 4343) + 1 )) > "$(dirname "$0")/.svc-pid" ;;
    esac ;;
esac
exit 0
STUB
chmod +x "$BIN/_stub"
for c in launchctl crontab pgrep df fdesetup pmset id ps gh curl sudo sysadminctl tar xcode-select pkill defaults; do ln -s _stub "$BIN/$c"; done
mkdir -p "$T/ownerhome"; chmod 700 "$T/ownerhome"
mkdir -p "$T/sysagents"; : > "$T/sysagents/com.openssh.ssh-agent.plist"   # Apple ships it under /System/Library
BREWD="$T/brew"; mkdir -p "$BREWD/bin"
printf '#!/bin/bash\necho "${FX_TMUX_V:-tmux 3.6a}"\n' > "$BREWD/bin/tmux"; printf '#!/bin/bash\n' > "$BREWD/bin/pwsh"; chmod +x "$BREWD/bin/"*

snap() { (cd "$1" && find . -print | LC_ALL=C sort && find . -type f -exec cksum {} + | LC_ALL=C sort); }
# run <name> <home> [env...] -- <script args...>: rc to $T/<name>.rc, output to $T/<name>.out, a fresh call log.
run() {
  local name="$1" home="$2"; shift 2
  local envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done; shift
  : > "$LOG"; rm -f "$T/user-created" "$T/booted-out" "$T/bootstrapped"
  env -i PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$home" CALL_LOG="$LOG" KOSMOS_CI_BREW="$BREWD" KOSMOS_CI_SYSTEM_AGENTS="$T/sysagents" KOSMOS_CI_OWNER_HOME="$T/ownerhome" \
    ${envs[@]+"${envs[@]}"} bash "$S" "$@" > "$T/$name.out" 2>&1 < "${STDIN_FILE:-/dev/null}"
  echo $? > "$T/$name.rc"
  cp "$LOG" "$T/$name.calls"
}
rc() { cat "$T/$1.rc"; }
has() { grep -q -F -- "$2" "$T/$1.out"; }
# A changing call: anything but a read. curl counts only with -o or -O (a download); gh only with -X.
changed() { grep -E '^(sudo|sysadminctl|tar|config\.sh|svc\.sh|pkill|defaults) |^crontab -r|^pmset -[ac]|^launchctl (bootstrap|kickstart|setenv|kill|enable)|^curl .*(-o |-[a-zA-Z]*O|--output|--remote-name| -X | -T | -d |--data)|^gh .*-X|^launchctl (bootout|disable|load|unload)' "$T/$1.calls"; }

H="$T/home"; mkdir -p "$H"

# --- preflight -------------------------------------------------------------------------------------------------
run pf-clear "$H" -- preflight
[ "$(rc pf-clear)" = 0 ] && has pf-clear "preflight: clear" && pass "preflight: clear on a Mac the agents have left" \
  || fail "preflight clear: rc $(rc pf-clear): $(tail -3 "$T/pf-clear.out")"
refuse() {  # refuse <case> <expected REFUSE text> <env...>
  local name="$1" want="$2"; shift 2
  run "pf-$name" "$H" "$@" -- preflight
  if [ "$(rc "pf-$name")" = 1 ] && has "pf-$name" "REFUSE: " && has "pf-$name" "$want"; then pass "preflight refuses: $name"
  else fail "preflight $name: rc $(rc "pf-$name"), wanted '$want': $(grep REFUSE "$T/pf-$name.out" | head -2)"; fi
}
refuse launchd "non-Apple launchd job(s) still loaded" FX_JOBS=com.kosmos.board
refuse crontab "crontab still has lines" "FX_CRON=*/10 * * * * mcp-sweep-alert.sh"
refuse suite "a suite looks live on this Mac" "FX_LIVE=123 bash tools/run-tests.sh"
refuse disk "under the 20 GiB floor" FX_FREE_KIB=10485760
refuse filevault "FileVault is not plainly off" "FX_FV=FileVault is On."
refuse filevault-deferred "FileVault is not plainly off" "FX_FV=FileVault is Off, but will be enabled after the next restart."
refuse no-clt "no Command Line Tools" FX_NO_CLT=1
chmod 750 "$T/ownerhome"
refuse owner-home-open "is mode 750: CI jobs could read it" FX_NONE=1
chmod 700 "$T/ownerhome"
refuse sleep "system sleep is not 'never'" FX_SLEEP=10
refuse autorestart "autorestart is not 1" FX_AUTORESTART=0
refuse launchctl-unreadable "could not read launchctl print gui/" FX_LAUNCHCTL_FAIL=1
refuse tmux35a "is 3.5a" "FX_TMUX_V=tmux 3.5a"
refuse admin "kosmos-ci is an admin" FX_CI_EXISTS=1 "FX_GROUPS=staff admin"
refuse shards "KOSMOS_CI_SHELL_SHARDS is '1/2'" FX_SHARDS=1/2
refuse shards-pair "could route shell shard(s) 1/2 2/2" FX_SHARDS=1/2,2/2
refuse gh "could not read the repo variables" FX_GH_FAIL=1
refuse gh-not-404 "could not read the repo variables" FX_GH_500=1
refuse gh-404-unseen "could not read the repo variables" FX_VARLIST_FAIL=1
refuse df-garbage "could not read free disk" FX_FREE_KIB=abc
refuse df-empty "could not read free disk" FX_DF_NOROW=1
refuse no-services "listed no services at all" FX_NO_SERVICES=1
for n in df-garbage df-empty; do ! has "pf-$n" "GiB free" && pass "preflight $n: no false 'GiB free' line beside the refusal" || fail "preflight $n printed a GiB line though df could not be read"; done
! has pf-no-services "no non-Apple launchd jobs loaded" && pass "preflight: an empty services block is not read as 'no jobs'" || fail "empty services block read as no jobs"
refuse pgrep-fails "could not list processes (pgrep exit 3)" FX_PGREP_FAIL=1
refuse crontab-unreadable "could not read the crontab" FX_CRON_FAIL=1
refuse allow-keeps-others "1 non-Apple launchd job(s) still loaded" "FX_JOBS=io.tailscale.ipn.helper
com.kosmos.board" KOSMOS_CI_ALLOW_JOBS='^io\.tailscale\.'
has pf-allow-keeps-others "com.kosmos.board" && ! grep REFUSE "$T/pf-allow-keeps-others.out" | grep -q tailscale \
  && pass "preflight: the allow list keeps only what it matches" || fail "allow list: $(grep REFUSE "$T/pf-allow-keeps-others.out")"
for v in "" off; do
  run pf-shards-off "$H" FX_SHARDS="$v" -- preflight
  [ "$(rc pf-shards-off)" = 0 ] && has pf-shards-off "set to '$v', which names no shard" && pass "preflight: KOSMOS_CI_SHELL_SHARDS='$v' routes no shard and is said so" \
    || fail "shards '$v': rc $(rc pf-shards-off): $(grep -i shards "$T/pf-shards-off.out")"
done
refuse bad-allow-ere "KOSMOS_CI_ALLOW_JOBS is not a valid ERE" FX_JOBS=com.kosmos.board "KOSMOS_CI_ALLOW_JOBS=(unbalanced"
for n in launchctl-unreadable bad-allow-ere; do
  ! has "pf-$n" "no non-Apple launchd jobs loaded" && pass "preflight $n: no false 'no jobs loaded' line beside the refusal" || fail "preflight $n printed 'no non-Apple launchd jobs loaded' though it could not tell"
done
run pf-allow-kosmos "$H" FX_JOBS=com.kosmos.board KOSMOS_CI_ALLOW_JOBS='kosmos' -- preflight
[ "$(rc pf-allow-kosmos)" = 0 ] && has pf-allow-kosmos "allowed to stay loaded (KOSMOS_CI_ALLOW_JOBS): com.kosmos.board" && pass "preflight: a narrow allow list (kosmos) is not taken for match-everything" || fail "allow kosmos: $(grep REFUSE "$T/pf-allow-kosmos.out")"
for pat in '.*' '^' '^io\.tailscale\.|'; do
  run pf-allow-all "$H" FX_JOBS=com.kosmos.board "KOSMOS_CI_ALLOW_JOBS=$pat" -- preflight
  # A grep that rejects a trailing "|" refuses it as invalid instead; either refusal is right, a clear is not.
  [ "$(rc pf-allow-all)" = 1 ] && { has pf-allow-all "matches any label" || has pf-allow-all "is not a valid ERE"; } && ! has pf-allow-all "no non-Apple launchd jobs loaded" \
    && pass "preflight refuses an allow list that matches every label: '$pat'" || fail "allow-all '$pat': rc $(rc pf-allow-all): $(grep -E 'REFUSE|ok:.*launchd' "$T/pf-allow-all.out" | head -2)"
done
has pf-allow-keeps-others "allowed to stay loaded (KOSMOS_CI_ALLOW_JOBS): io.tailscale.ipn.helper" && pass "preflight names each job the allow list keeps" || fail "allow list kept jobs not named"
run pf-allow-dash "$H" FX_JOBS=io.tailscale.ipn.helper KOSMOS_CI_ALLOW_JOBS='-nomatch|^io\.tailscale\.' -- preflight
[ "$(rc pf-allow-dash)" = 0 ] && pass "preflight: an allow list starting with '-' is a pattern, not a grep option" || fail "allow list with '-': $(grep REFUSE "$T/pf-allow-dash.out")"
run pf-allow "$H" FX_JOBS=io.tailscale.ipn.helper KOSMOS_CI_ALLOW_JOBS='^io\.tailscale\.' -- preflight
[ "$(rc pf-allow)" = 0 ] && pass "preflight: an allowed job (KOSMOS_CI_ALLOW_JOBS) does not refuse" || fail "allow-list: $(grep REFUSE "$T/pf-allow.out")"
mv "$BREWD/bin/pwsh" "$T/pwsh.away"
run pf-nopwsh "$H" -- preflight
mv "$T/pwsh.away" "$BREWD/bin/pwsh"
[ "$(rc pf-nopwsh)" = 1 ] && has pf-nopwsh "no $BREWD/bin/pwsh" && pass "preflight refuses: no pwsh" || fail "no pwsh: $(grep REFUSE "$T/pf-nopwsh.out")"
pf_changed=0
for n in pf-clear pf-launchd pf-suite; do
  if out="$(changed "$n")"; then fail "preflight $n changed something: $out"; pf_changed=1; fi
done
[ "$pf_changed" = 0 ] && pass "preflight made no changing call (checked on clear, launchd, suite)"

# The jq programs gh --jq runs, executed by the real jq against canned API JSON (the gh stub never runs them).
if command -v jq >/dev/null 2>&1; then
  jq_prog() { env -i PATH="$BIN:/usr/bin:/bin" HOME="$T/home" CALL_LOG="$T/jq-calls.log" bash "$S" jq-programs | sed -n "${1}p"; }
  printf '{"name":"KOSMOS_CI_SHELL_SHARDS","value":""}' > "$T/var.json"
  printf '{"total_count":2,"runners":[{"name":"other","status":"offline","busy":false,"labels":[{"name":"x"}]},{"name":"kosmos-ci-agent1s","status":"online","busy":true,"labels":[{"name":"self-hosted"},{"name":"macOS"},{"name":"ARM64"},{"name":"kosmos-ci"}]}]}' > "$T/runners.json"
  [ "$(jq -r "$(jq_prog 1)" "$T/var.json")" = "=" ] && pass "jq: a set-but-empty variable reads '='" || fail "jq var: $(jq -r "$(jq_prog 1)" "$T/var.json" 2>&1)"
  [ "$(jq -r "$(jq_prog 2)" "$T/runners.json")" = "true" ] && pass "jq: busy is read from the named runner only" || fail "jq busy: $(jq -r "$(jq_prog 2)" "$T/runners.json" 2>&1)"
  [ "$(jq -r "$(jq_prog 3)" "$T/runners.json")" = "online true arm64,kosmos-ci,macos,self-hosted" ] && pass "jq: the runner row is status, busy, sorted lower-case labels" || fail "jq row: $(jq -r "$(jq_prog 3)" "$T/runners.json" 2>&1)"
else
  fail "no jq to run the script's jq programs (macOS ships /usr/bin/jq)"
fi

# shards_check is a second copy of test.yml's shard parse: run the REAL decide step body (as
# test-ci-runner-route-5488.sh extracts it) on each value, and preflight must refuse exactly when it routes a shard.
if command -v ruby >/dev/null 2>&1 && ruby -ryaml -e '
    d = YAML.load_file(ARGV[0])["jobs"]["scope"]["steps"].find { |x| x["id"] == "decide" }
    File.write(ARGV[1], d["run"])' "$HERE/../.github/workflows/test.yml" "$T/decide.sh" 2>/dev/null; then
  for v in "1/2" "2/2" "1/2,2/2" "1/2 2/2" " 2/2 " "" "off" "all" "1/3" "2/2,," "*" "1/2x"; do
    : > "$T/gh-out"; mkdir -p "$T/dcwd" "$T/drt"
    (cd "$T/dcwd" && CI_SHELL_SHARDS="$v" CI_RUNNER=on EVENT_NAME=push HEAD_REPO="" THIS_REPO=o/k BASE_REF=x HEAD_SHA=x HEAD_REF=y \
      RUNNER_TEMP="$T/drt" GITHUB_OUTPUT="$T/gh-out" PATH="/usr/bin:/bin" bash --noprofile --norc -eo pipefail "$T/decide.sh" >/dev/null 2>&1)
    routed=no; grep -q -E '^shell[12]_runner=\[' "$T/gh-out" && routed=yes
    run pf-shard-parity "$H" FX_SHARDS="$v" -- preflight
    refused=no; has pf-shard-parity "could route shell shard" && refused=yes
    [ "$routed" = "$refused" ] && pass "shards '$v': test.yml routes=$routed, preflight refuses=$refused" || fail "shards '$v': test.yml routes=$routed but preflight refuses=$refused"
  done
else
  echo "skip shard parity: no ruby to parse test.yml (tools.shell-shard-4317.test.js skips the same way)"
fi

# --- create-user ------------------------------------------------------------------------------------------------
before="$(snap "$H")"
run cu-dry "$H" -- create-user
if [ "$(rc cu-dry)" = 0 ] && has cu-dry "DRY RUN of create-user" && has cu-dry "WOULD: sudo sysadminctl -addUser kosmos-ci" \
   && ! changed cu-dry >/dev/null && [ "$(snap "$H")" = "$before" ]; then pass "create-user dry run: prints the sysadminctl line, calls nothing, HOME unchanged"
else fail "create-user dry run: rc $(rc cu-dry), changing calls: $(changed cu-dry | head -2)"; fi
sl="$(grep '^WOULD: sudo sysadminctl' "$T/cu-dry.out")"
[ -n "$sl" ] && ! printf '%s\n' "$sl" | grep -q -w -- -admin && pass "create-user's user is standard (no -admin)" || fail "create-user admin check: '$sl'"
grep '^WOULD: sudo sysadminctl' "$T/cu-dry.out" | grep -q -- '-password -$' && pass "create-user: the password is prompted, never in argv" || fail "create-user password: $(grep sysadminctl "$T/cu-dry.out")"
# CONTROL: the same stage with --apply reaches the stub, so the dry-run assertion above can see a call.
run cu-apply "$H" -- --apply create-user
if [ "$(rc cu-apply)" = 0 ] && grep -q '^sudo sysadminctl -addUser kosmos-ci' "$T/cu-apply.calls"; then pass "CONTROL: create-user --apply reaches sudo sysadminctl"
else fail "CONTROL create-user --apply: rc $(rc cu-apply), calls: $(head -3 "$T/cu-apply.calls")"; fi
run cu-blocked "$H" FX_JOBS=com.kosmos.board -- --apply create-user
[ "$(rc cu-blocked)" = 1 ] && ! changed cu-blocked >/dev/null && pass "create-user --apply refuses, and calls nothing, while preflight refuses" \
  || fail "create-user while blocked: rc $(rc cu-blocked), calls: $(changed cu-blocked)"
# preflight runs inside `||` here, where set -e is off: an unreadable launchctl must still refuse.
run cu-nolaunchctl "$H" FX_LAUNCHCTL_FAIL=1 -- --apply create-user
[ "$(rc cu-nolaunchctl)" = 1 ] && ! changed cu-nolaunchctl >/dev/null && has cu-nolaunchctl "could not read launchctl print gui/" \
  && pass "create-user --apply refuses when launchctl cannot be read (no fail-open under ||)" || fail "create-user, launchctl unreadable: rc $(rc cu-nolaunchctl)"
run cu-noop "$H" FX_SYSADMIN_NOOP=1 -- --apply create-user
[ "$(rc cu-noop)" = 1 ] && has cu-noop "was not created" && pass "create-user --apply stops when sysadminctl made no user" || fail "create-user no-op: rc $(rc cu-noop)"
run cu-admin "$H" "FX_GROUPS=staff admin" -- --apply create-user
[ "$(rc cu-admin)" = 1 ] && has cu-admin "came out an admin" && pass "create-user --apply stops when the new user is an admin" || fail "create-user admin: rc $(rc cu-admin)"
run pf-ghwarn "$H" FX_SHARDS=off "FX_GH_STDERR=A new release of gh is available: 1/2" -- preflight
[ "$(rc pf-ghwarn)" = 0 ] && has pf-ghwarn "set to 'off', which names no shard" && pass "a gh warning on stderr is not read as the variable's value" || fail "gh stderr warning: rc $(rc pf-ghwarn): $(grep -i shards "$T/pf-ghwarn.out")"
run cu-groups "$H" FX_GROUPS_FAIL=1 -- --apply create-user
[ "$(rc cu-groups)" = 1 ] && has cu-groups "could not read kosmos-ci's groups" && pass "create-user stops when the new user's groups cannot be read" || fail "create-user groups unreadable: rc $(rc cu-groups): $(tail -1 "$T/cu-groups.out")"
run pf-groups "$H" FX_CI_EXISTS=1 FX_GROUPS_FAIL=1 -- preflight
[ "$(rc pf-groups)" = 1 ] && has pf-groups "could not read kosmos-ci's groups" && pass "preflight: unreadable groups refuse rather than read as standard" || fail "preflight groups: rc $(rc pf-groups)"
for st in preflight create-user verify; do
  run wrong-$st "$H" FX_WHO=kosmos-ci FX_CI_EXISTS=1 -- $st
  [ "$(rc wrong-$st)" = 2 ] && has wrong-$st "run it as agent1" && ! has wrong-$st "clear" && pass "$st as another account refuses rather than judging that account's state" || fail "$st as kosmos-ci: rc $(rc wrong-$st): $(tail -1 "$T/wrong-$st.out")"
done
run same-name "$H" KOSMOS_CI_USER=agent1 -- preflight
[ "$(rc same-name)" = 2 ] && has same-name "both 'agent1'" && ! has same-name "==" && pass "every stage refuses a CI user named as the owner, before any check" || fail "same name: rc $(rc same-name)"
run same-uid "$H" FX_CI_EXISTS=1 FX_SAME_UID=1 -- create-user
[ "$(rc same-uid)" = 2 ] && has same-uid "the same account (uid 501)" && ! has same-uid "WOULD" && pass "every stage refuses a CI user that is the owner's uid" || fail "same uid: rc $(rc same-uid): $(tail -1 "$T/same-uid.out")"
run cu-exists "$H" FX_CI_EXISTS=1 -- --apply create-user
[ "$(rc cu-exists)" = 1 ] && ! changed cu-exists >/dev/null && pass "create-user refuses when kosmos-ci exists" || fail "create-user exists: rc $(rc cu-exists)"

# --- install ----------------------------------------------------------------------------------------------------
C=0123456789abcdef0123456789abcdef01234567
G="$(printf 'guard' | shasum -a 256 | cut -d' ' -f1)"
CH="$T/cihome"; mkdir -p "$CH"
before="$(snap "$CH")"
run in-dry "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install "$C" "$G"
if [ "$(rc in-dry)" = 0 ] && has in-dry "WOULD: fetch tools/ci-runner-job-guard.sh at $C" && grep -q '^curl .*/compare/' "$T/in-dry.calls" && ! changed in-dry >/dev/null && [ "$(snap "$CH")" = "$before" ]; then
  pass "install dry run: checks the commit is on main, downloads nothing, HOME unchanged"
else fail "install dry run: rc $(rc in-dry), changing calls: $(changed in-dry | head -2), $(tail -2 "$T/in-dry.out")"; fi
run in-noargs "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install
[ "$(rc in-noargs)" = 2 ] && has in-noargs "install needs <main commit>" && pass "install refuses with no commit and sha" || fail "install no args: rc $(rc in-noargs)"
run in-shortsha "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install 0123456 "$G"
[ "$(rc in-shortsha)" = 2 ] && has in-shortsha "full 40-character sha" && ! grep -q '^curl' "$T/in-shortsha.calls" && pass "install refuses a short commit before any network call" || fail "install short commit: rc $(rc in-shortsha)"
run in-badpin "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install "$C" "not-a-sha"
[ "$(rc in-badpin)" = 2 ] && has in-badpin "64 hex characters" && ! grep -q '^curl' "$T/in-badpin.calls" && pass "install refuses a guard pin that is not 64 hex" || fail "install bad pin: rc $(rc in-badpin)"
run in-extra "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install "$C" "$G" extra
[ "$(rc in-extra)" = 2 ] && has in-extra "nothing more" && pass "install refuses arguments past the commit and sha256" || fail "install extra args: rc $(rc in-extra)"
run in-fork "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" FX_COMPARE=diverged -- install "$C" "$G"
[ "$(rc in-fork)" = 1 ] && has in-fork "is not on main" && pass "install refuses a commit not on main" || fail "install off-main: rc $(rc in-fork)"
run in-who "$CH" -- --apply install "$C" "$G"
[ "$(rc in-who)" = 2 ] && has in-who "runs as kosmos-ci" && ! changed in-who >/dev/null && pass "install --apply refuses as any user but kosmos-ci" || fail "install as agent1: rc $(rc in-who)"
mkdir -p "$CH/actions-runner"; printf 'LANG=C\nexport KOSMOS_NO_WAIT=1\n' > "$CH/actions-runner/.env"
run in-env-export "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install "$C" "$G"
[ "$(rc in-env-export)" = 1 ] && has in-env-export "KOSMOS_NO_WAIT" && pass "install refuses an 'export KOSMOS_' line in the runner .env (inert to the runner, refused as a meant override)" || fail "install export KOSMOS_: rc $(rc in-env-export)"
printf 'LANG=C\nKOSMOS_TESTS_IGNORE_SUITE=1\n' > "$CH/actions-runner/.env"
run in-env "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install "$C" "$G"
[ "$(rc in-env)" = 1 ] && has in-env "KOSMOS_TESTS_IGNORE_SUITE" && pass "install refuses a runner .env with a KOSMOS_ wait control (the suite lock)" \
  || fail "install .env override: rc $(rc in-env): $(tail -1 "$T/in-env.out")"
# CONTROL and the real path: --apply, with the downloads stubbed. An existing .env key the install does not own survives.
printf 'LANG=C\nRUNNER_KEEP=1\nexport PATH=/stale\n' > "$CH/actions-runner/.env"; chmod 640 "$CH/actions-runner/.env"
run in-apply "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply install "$C" "$G"
e="$CH/actions-runner/.env"
if [ "$(rc in-apply)" = 0 ] && grep -q '^tar xzf actions-runner-osx-arm64-2.999.0.tar.gz' "$T/in-apply.calls" \
   && grep -qx 'RUNNER_KEEP=1' "$e" && grep -qx "ACTIONS_RUNNER_HOOK_JOB_STARTED=$CH/.kosmos-ci/job-started.sh" "$e" \
   && ! grep -q 'PATH=/stale' "$e" && grep -qx 'LANG=en_US.UTF-8' "$e" && [ "$(grep -c '^LANG=' "$e")" = 1 ] && ! grep -q '^KOSMOS_' "$e" \
   && [ "$(stat -f %Lp "$e")" = 640 ] && [ -x "$CH/.kosmos-ci/job-started.sh" ] && [ -x "$CH/.kosmos-ci/job-cleanup.sh" ] && [ -x "$CH/.kosmos-ci/job-guard.sh" ] \
   && head -1 "$CH/.kosmos-ci/job-cleanup.sh" | grep -qx '#!/bin/bash'; then
  pass "CONTROL: install --apply unpacks, installs the guard and hooks, merges .env keeping other keys"
else fail "install --apply: rc $(rc in-apply): $(tail -3 "$T/in-apply.out")"; fi
run in-badsha "$T/cihome2" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$T/cihome2" FX_GUARD_BODY=tampered -- --apply install "$C" "$G"
[ "$(rc in-badsha)" = 1 ] && ! grep -q '^tar ' "$T/in-badsha.calls" && pass "install --apply refuses a guard whose sha256 differs, before unpacking" \
  || fail "install bad guard: rc $(rc in-badsha)"

# The installed job-started hook must run the guard and stop on its refusal. Run it against stand-ins: the guard
# exits as told, and job-cleanup.sh is replaced by a marker FIRST, because the real one ends this user's tmux and node.
# hookrun [VAR=value...] <hook>: the hook under the stub PATH and a sandbox HOME, never the tester's environment, and
# it must reach no pkill (job-cleanup.sh is a marker here; a hook that inlined the real cleanup would show up).
: > "$T/hook-calls.log"
hookrun() { env -i PATH="$BIN:/usr/bin:/bin" HOME="$T/hookhome" CALL_LOG="$T/hook-calls.log" "$@"; }
HK="$T/hookcheck"; mkdir -p "$HK"; cp "$CH/.kosmos-ci/job-started.sh" "$HK/"
printf '#!/bin/bash\n: > "$(dirname "$0")/cleanup-ran"\n' > "$HK/job-cleanup.sh"
printf '#!/bin/bash\nexit 1\n' > "$HK/job-guard.sh"; chmod 755 "$HK/"*
[ -x "$HK/job-started.sh" ] || fail "install --apply wrote no job-started.sh to test"
hookrun "$HK/job-started.sh" >/dev/null 2>&1; hrc=$?
[ -x "$HK/job-started.sh" ] && [ "$hrc" != 0 ] && [ ! -e "$HK/cleanup-ran" ] && pass "job-started stops on a guard refusal, before cleanup" || fail "job-started with a refusing guard: rc $hrc, cleanup ran: $([ -e "$HK/cleanup-ran" ] && echo yes || echo no)"
printf '#!/bin/bash\nexit 0\n' > "$HK/job-guard.sh"
hookrun "$HK/job-started.sh" >/dev/null 2>&1; hrc=$?
[ "$hrc" = 0 ] && [ -e "$HK/cleanup-ran" ] && pass "job-started runs cleanup once the guard admits the job" || fail "job-started with an admitting guard: rc $hrc"

# job-completed empties the job's temp only when RUNNER_TEMP is that dir: run it against a sandbox runner layout.
HC="$T/hookdone"; mkdir -p "$HC/.kosmos-ci" "$HC/actions-runner/_work/_temp"; cp "$CH/.kosmos-ci/job-completed.sh" "$HC/.kosmos-ci/"
printf '#!/bin/bash\n: > "$(dirname "$0")/cleanup-ran"\n' > "$HC/.kosmos-ci/job-cleanup.sh"; chmod 755 "$HC/.kosmos-ci/"*
TMPD_REAL="$(cd "$HC/actions-runner/_work/_temp" && pwd -P)"
: > "$HC/actions-runner/_work/_temp/payload"; : > "$HC/actions-runner/_work/keep"
hookrun RUNNER_TEMP="/somewhere/else" "$HC/.kosmos-ci/job-completed.sh"
[ -e "$HC/actions-runner/_work/_temp/payload" ] && [ -e "$HC/.kosmos-ci/cleanup-ran" ] && pass "job-completed runs cleanup and leaves the temp alone when RUNNER_TEMP is elsewhere" || fail "job-completed with a foreign RUNNER_TEMP"
: > "$HC/actions-runner/_work/_temp/.hidden"
hookrun RUNNER_TEMP="$TMPD_REAL" "$HC/.kosmos-ci/job-completed.sh"
[ ! -e "$HC/actions-runner/_work/_temp/payload" ] && [ ! -e "$HC/actions-runner/_work/_temp/.hidden" ] && [ -d "$HC/actions-runner/_work/_temp" ] && [ -e "$HC/actions-runner/_work/keep" ] \
  && pass "job-completed empties exactly the job's temp when RUNNER_TEMP is it" || fail "job-completed with the matching RUNNER_TEMP: $(ls -a "$HC/actions-runner/_work/_temp" "$HC/actions-runner/_work" | tr '\n' ' ')"

! grep -q '^pkill' "$T/hook-calls.log" && pass "no hook run by the test reached pkill" || fail "a hook reached pkill: $(grep '^pkill' "$T/hook-calls.log")"

# A running runner: stopped, unpacked over, started again. A job in flight, or a stop that does not take, refuses.
svc_home() {   # an installed runner: svc.sh, its .service marker, and (as the new package would bring) bin/runsvc.sh
  mkdir -p "$1/actions-runner/bin"; cp "$BIN/_stub" "$1/actions-runner/svc.sh"; chmod +x "$1/actions-runner/svc.sh"
  echo started > "$1/actions-runner/.svc-state"; echo "actions.runner.x" > "$1/actions-runner/.service"
  echo "# runsvc old" > "$1/actions-runner/runsvc.sh"; echo "# runsvc new" > "$1/actions-runner/bin/runsvc.sh"
}
# A hook write that fails partway leaves the old hook whole (put writes beside it and renames).
R16="$T/run16"; svc_home "$R16"; mkdir -p "$R16/.kosmos-ci/job-started.sh.new"; echo "# old hook" > "$R16/.kosmos-ci/job-started.sh"
run in-hookfail "$R16" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R16" -- --apply install "$C" "$G"
[ "$(rc in-hookfail)" != 0 ] && grep -qx '# old hook' "$R16/.kosmos-ci/job-started.sh" && grep -q '^svc.sh stop' "$T/in-hookfail.calls" && grep -q '^svc.sh start' "$T/in-hookfail.calls" && pass "install --apply that cannot write a hook leaves the old one whole" || fail "hook write failure: rc $(rc in-hookfail), job-started.sh: $(head -1 "$R16/.kosmos-ci/job-started.sh")"
R1="$T/run1"; svc_home "$R1"
run in-restart "$R1" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R1" -- --apply install "$C" "$G"
[ "$(rc in-restart)" = 0 ] && grep -q '^svc.sh stop' "$T/in-restart.calls" && grep -q '^tar ' "$T/in-restart.calls" && has in-restart "runner started again" \
  && grep -qx '# runsvc new' "$R1/actions-runner/runsvc.sh" && [ "$(grep -c '^svc.sh start' "$T/in-restart.calls")" = 1 ] \
  && pass "install --apply stops a running runner, unpacks, starts it again" || fail "install restart: rc $(rc in-restart): $(tail -2 "$T/in-restart.out")"
R2="$T/run2"; svc_home "$R2"
run in-job "$R2" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R2" FX_WORKER=1 -- --apply install "$C" "$G"
[ "$(rc in-job)" = 1 ] && has in-job "a job is running" && ! grep -q -E '^(svc.sh stop|tar )' "$T/in-job.calls" \
  && pass "install --apply refuses while a job runs, before stopping anything" || fail "install with a job: rc $(rc in-job): $(cat "$T/in-job.calls" | tail -3)"
R3="$T/run3"; svc_home "$R3"
run in-stuck "$R3" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R3" FX_SVC_STUCK=1 KOSMOS_CI_UNLOAD_WAIT_S=1 -- --apply install "$C" "$G"
[ "$(rc in-stuck)" = 1 ] && has in-stuck "did not stop" && has in-stuck "./svc.sh start brings it back" && ! grep -q '^tar ' "$T/in-stuck.calls" \
  && pass "install --apply refuses to unpack when the runner did not stop" || fail "install stuck stop: rc $(rc in-stuck)"
R5="$T/run5"; svc_home "$R5"
# A stop still in progress (Started for 2 more reads): install waits for it rather than refusing (kosmos#7001: with
# ExitTimeOut 35 a stop can take up to ~30 s).
R7="$T/r7"; svc_home "$R7"; echo started > "$R7/actions-runner/.svc-state"
run in-slowstop "$R7" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R7" FX_SVC_STOP_LAG=2 KOSMOS_CI_UNLOAD_WAIT_S=10 -- --apply install "$C" "$G"
[ "$(rc in-slowstop)" = 0 ] && ! has in-slowstop "did not stop" && grep -q '^tar ' "$T/in-slowstop.calls" \
  && pass "install --apply waits for a stop that is still in progress, then unpacks" || fail "install slow stop: rc $(rc in-slowstop): $(tail -1 "$T/in-slowstop.out")"
# The inputs checked at the top, for every stage.
run top-home "$H" "KOSMOS_CI_HOME=/Users/kosmos ci" -- verify
[ "$(rc top-home)" = 2 ] && has top-home "the CI home may hold only" && pass "every stage refuses a CI home with a character a pgrep pattern would read" || fail "top home: rc $(rc top-home): $(cat "$T/top-home.out")"
run top-wait "$H" KOSMOS_CI_UNLOAD_WAIT_S=abc -- verify
[ "$(rc top-wait)" = 2 ] && has top-wait "KOSMOS_CI_UNLOAD_WAIT_S is 'abc', not a number of seconds" && pass "every stage refuses a wait that is not a number" || fail "top wait: rc $(rc top-wait): $(cat "$T/top-wait.out")"
run in-tarfail "$R5" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R5" FX_TAR_FAIL=1 -- --apply install "$C" "$G"
[ "$(rc in-tarfail)" != 0 ] && grep -q '^svc.sh stop' "$T/in-tarfail.calls" && grep -q '^svc.sh start' "$T/in-tarfail.calls" \
  && pass "install --apply starts the runner again when it fails after stopping it" || fail "install fail after stop: rc $(rc in-tarfail), calls: $(grep svc "$T/in-tarfail.calls" | tr '\n' ' ')"
mkdir -p "$T/closed-ci"; chmod 000 "$T/closed-ci"
run in-closed "$H" KOSMOS_CI_HOME="$T/closed-ci" -- install "$C" "$G"
chmod 755 "$T/closed-ci"
[ "$(rc in-closed)" = 0 ] && has in-closed "its .env KOSMOS_ check runs at --apply" && pass "install dry run as the owner says when it cannot look inside kosmos-ci's home" || fail "install dry closed home: rc $(rc in-closed)"
run bad-name "$H" "KOSMOS_CI_RUNNER_NAME=bad\"name" -- verify
[ "$(rc bad-name)" = 2 ] && has bad-name "may hold only letters" && pass "a runner name that would need escaping in jq is refused" || fail "bad runner name: rc $(rc bad-name)"
run in-owner "$H" KOSMOS_CI_HOME="$T/ci-home-elsewhere" -- install "$C" "$G"
[ "$(rc in-owner)" = 0 ] && has in-owner "unpack into $T/ci-home-elsewhere/actions-runner" && ! has in-owner "$H/" \
  && pass "install dry run as the owner names kosmos-ci's paths, not the owner's" || fail "install dry as owner: $(grep WOULD "$T/in-owner.out" | head -2)"
R6="$T/run6"; svc_home "$R6"
run in-nostart "$R6" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R6" FX_SVC_START_FAIL=1 -- --apply install "$C" "$G"
[ "$(rc in-nostart)" = 1 ] && has in-nostart "FAILED to start the runner again" && ! has in-nostart "runner started again" \
  && pass "install --apply says so, and fails, when the runner does not start again" || fail "install start fails: rc $(rc in-nostart): $(tail -2 "$T/in-nostart.out")"
[ ! -e "$R1/actions-runner/actions-runner-osx-arm64-2.999.0.tar.gz" ] && pass "install --apply removes the package after unpacking it" || fail "the runner package was left in $R1/actions-runner"
RG="$T/rg-unwired"; mkdir -p "$RG/actions-runner"; cp "$BIN/_stub" "$RG/actions-runner/config.sh"; chmod +x "$RG/actions-runner/config.sh"
printf 'LANG=C\n' > "$RG/actions-runner/.env"
run rg-unwired "$RG" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$RG" -- --apply register
[ "$(rc rg-unwired)" = 1 ] && has rg-unwired "does not wire ACTIONS_RUNNER_HOOK_JOB_STARTED" && ! grep -q '^config\.sh' "$T/rg-unwired.calls" \
  && pass "register --apply refuses a runner whose job guard is not wired" || fail "register unwired: rc $(rc rg-unwired): $(tail -1 "$T/rg-unwired.out")"
mkdir -p "$RG/.kosmos-ci"; printf 'ACTIONS_RUNNER_HOOK_JOB_STARTED=%s\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' "$RG/.kosmos-ci/job-started.sh" "$RG/.kosmos-ci/job-completed.sh" > "$RG/actions-runner/.env"
for f in job-started.sh job-completed.sh job-cleanup.sh; do printf '#!/bin/bash\n' > "$RG/.kosmos-ci/$f"; chmod 755 "$RG/.kosmos-ci/$f"; done
run rg-noguard "$RG" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$RG" -- --apply register
[ "$(rc rg-noguard)" = 1 ] && has rg-noguard "job-guard.sh is missing or not executable" && ! grep -q '^config\.sh' "$T/rg-noguard.calls" \
  && pass "register --apply refuses when a hook file is missing though .env is wired" || fail "register no guard file: rc $(rc rg-noguard): $(tail -1 "$T/rg-noguard.out")"
printf 'KOSMOS_NO_WAIT=1\n' >> "$RG/actions-runner/.env"; chmod 755 "$RG/.kosmos-ci/"*; printf '#!/bin/bash\n' > "$RG/.kosmos-ci/job-guard.sh"; chmod 755 "$RG/.kosmos-ci/job-guard.sh"
run rg-kosmos "$RG" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$RG" -- --apply register
[ "$(rc rg-kosmos)" = 1 ] && has rg-kosmos "sets a KOSMOS_ variable" && ! grep -q '^config\.sh' "$T/rg-kosmos.calls" && pass "register --apply refuses a .env with a KOSMOS_ key" || fail "register KOSMOS_: rc $(rc rg-kosmos): $(tail -1 "$T/rg-kosmos.out")"
run rg-noinstall "$T/empty-ci" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$T/empty-ci" -- --apply register
[ "$(rc rg-noinstall)" = 1 ] && has rg-noinstall "run install first" && pass "register --apply before install says so" || fail "register before install: rc $(rc rg-noinstall): $(tail -1 "$T/rg-noinstall.out")"
R7="$T/run7"; svc_home "$R7"
run in-pgrepfail "$R7" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R7" FX_PGREP_FAIL=1 -- --apply install "$C" "$G"
[ "$(rc in-pgrepfail)" = 1 ] && has in-pgrepfail "could not list processes" && ! grep -q -E '^(svc.sh stop|tar )' "$T/in-pgrepfail.calls" \
  && pass "install --apply refuses when pgrep cannot say whether a job runs" || fail "install pgrep failure: rc $(rc in-pgrepfail)"
R8="$T/run8"; svc_home "$R8"
run in-pkgsha "$R8" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R8" FX_RELEASE_SHA=deadbeef -- --apply install "$C" "$G"
[ "$(rc in-pkgsha)" = 1 ] && has in-pkgsha "is not the published 'deadbeef'" && ! grep -q -E '^(tar |svc.sh stop)' "$T/in-pkgsha.calls" \
  && [ ! -e "$R8/actions-runner/actions-runner-osx-arm64-2.999.0.tar.gz" ] \
  && pass "install --apply refuses a runner package whose sha256 is not the published one, and removes it" || fail "install package sha: rc $(rc in-pkgsha): $(tail -1 "$T/in-pkgsha.out")"
R9="$T/run9"; svc_home "$R9"
run in-ssh "$R9" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R9" FX_MANAGER=Background -- --apply install "$C" "$G"
[ "$(rc in-ssh)" = 2 ] && has in-ssh "Screen Sharing session" && ! changed in-ssh >/dev/null && pass "install --apply refuses outside the GUI session (svc.sh would misread)" || fail "install over ssh: rc $(rc in-ssh)"
R10="$T/run10"; svc_home "$R10"
run in-nolistener "$R10" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R10" FX_LISTENER=0 KOSMOS_CI_START_WAIT_S=1 -- --apply install "$C" "$G"
[ "$(rc in-nolistener)" = 1 ] && has in-nolistener "no new Runner.Listener is running" && ! has in-nolistener "runner started again" \
  && pass "install --apply fails when the runner loads but no Listener comes up" || fail "install no listener: rc $(rc in-nolistener): $(tail -1 "$T/in-nolistener.out")"
R11="$T/run11"; svc_home "$R11"; echo 5000 > "$R11/actions-runner/.svc-pid"
run in-oldlistener "$R11" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R11" FX_SAME_PID=1 KOSMOS_CI_START_WAIT_S=1 -- --apply install "$C" "$G"
[ "$(rc in-oldlistener)" = 1 ] && has in-oldlistener "no new Runner.Listener is running" && pass "install --apply does not take the old Listener for a restarted one" || fail "install old listener: rc $(rc in-oldlistener): $(tail -1 "$T/in-oldlistener.out")"
R12="$T/run12"; svc_home "$R12"
run in-sudo-iu "$R12" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R12" FX_MANAGERUID=501 -- --apply install "$C" "$G"
[ "$(rc in-sudo-iu)" = 2 ] && has in-sudo-iu "belongs to another user" && ! changed in-sudo-iu >/dev/null && pass "install --apply refuses inside another user's GUI session (sudo -iu)" || fail "install sudo -iu: rc $(rc in-sudo-iu)"
R13="$T/run13"; svc_home "$R13"
run in-partial "$R13" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R13" FX_DL_PARTIAL=1 -- --apply install "$C" "$G"
[ "$(rc in-partial)" = 1 ] && [ ! -e "$R13/actions-runner/actions-runner-osx-arm64-2.999.0.tar.gz" ] && pass "install --apply removes a partly downloaded package" || fail "install partial download: rc $(rc in-partial), left: $(ls "$R13/actions-runner" | tr '\n' ' ')"
R14="$T/run14"; svc_home "$R14"; echo 5000 > "$R14/actions-runner/.svc-pid"
run in-bothlisteners "$R14" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R14" FX_OLD_TOO=4999 KOSMOS_CI_START_WAIT_S=2 -- --apply install "$C" "$G"
[ "$(rc in-bothlisteners)" = 0 ] && has in-bothlisteners "runner started again" && pass "install --apply accepts the new Listener while the old one is still listed first" || fail "install old+new listeners: rc $(rc in-bothlisteners): $(tail -1 "$T/in-bothlisteners.out")"
R15="$T/run15"; svc_home "$R15"
run in-pgrepdead "$R15" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R15" FX_LISTENER_PGREP_FAIL=1 -- --apply install "$C" "$G"
[ "$(rc in-pgrepdead)" = 1 ] && has in-pgrepdead "could not list processes (pgrep exit" && pass "install --apply says pgrep failed rather than timing out on it" || fail "install pgrep failure in the wait: rc $(rc in-pgrepdead): $(tail -1 "$T/in-pgrepdead.out")"
R4="$T/run4"; mkdir -p "$R4/actions-runner"; printf 'RUNNER_KEEP=1\n' > "$R4/actions-runner/.env"; chmod 000 "$R4/actions-runner/.env"
run in-unread "$R4" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R4" -- --apply install "$C" "$G"
chmod 600 "$R4/actions-runner/.env"
[ "$(rc in-unread)" = 1 ] && grep -qx 'RUNNER_KEEP=1' "$R4/actions-runner/.env" && pass "install --apply leaves an unreadable .env unchanged rather than rewriting it" \
  || fail "install unreadable .env: rc $(rc in-unread), .env: $(cat "$R4/actions-runner/.env")"
run late-apply "$H" -- preflight --apply
[ "$(rc late-apply)" = 2 ] && has late-apply "--apply goes first" && [ ! -s "$T/late-apply.calls" ] && pass "a late --apply refuses before anything runs" || fail "late --apply: rc $(rc late-apply)"

# --- register ---------------------------------------------------------------------------------------------------
printf 'tok-SECRET-123\n' > "$T/token"
STDIN_FILE="$T/token" run rg-dry "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- register
if [ "$(rc rg-dry)" = 0 ] && has rg-dry "--name kosmos-ci-agent1s" && tr -d '\\' < "$T/rg-dry.out" | grep -q -F -- '--labels self-hosted,macOS,arm64,kosmos-ci' \
   && ! grep -q SECRET "$T/rg-dry.out" "$T/rg-dry.calls" && ! changed rg-dry >/dev/null; then pass "register dry run: name and labels printed, token neither read nor printed, nothing called"
else fail "register dry run: rc $(rc rg-dry): $(cat "$T/rg-dry.out")"; fi
for x in config.sh svc.sh; do cp "$BIN/_stub" "$CH/actions-runner/$x"; chmod +x "$CH/actions-runner/$x"; done
STDIN_FILE="$T/token" run rg-apply "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply register
if [ "$(rc rg-apply)" = 0 ] && grep -qx 'token-in-env=tok-SECRET-123' "$T/rg-apply.calls" \
   && grep '^config\.sh ' "$T/rg-apply.calls" | grep -q -- '--labels self-hosted,macOS,arm64,kosmos-ci' \
   && ! grep '^config\.sh ' "$T/rg-apply.calls" | grep -q SECRET \
   && [ "$(cat "$CH/actions-runner/.path")" = "/usr/bin:/bin:/usr/sbin:/sbin:$BREWD/bin:/usr/local/bin:$CH/.local/bin" ] \
   && grep -qx "PATH=$(cat "$CH/actions-runner/.path")" "$CH/actions-runner/.env"; then pass "CONTROL: register --apply passes the token in the environment, never in argv, and makes .path the PATH .env sets"
else fail "register --apply: rc $(rc rg-apply), calls: $(cat "$T/rg-apply.calls")"; fi
# kosmos#7001: svc.sh's plist (the stub writes actions/runner's template: RunAtLoad, no KeepAlive) gains KeepAlive.
KP="$CH/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist"
ka_of() { plutil -extract KeepAlive.SuccessfulExit raw -o - "$1" 2>/dev/null; }
[ "$(ka_of "$KP")" = false ] && [ "$(plutil -extract ThrottleInterval raw -o - "$KP" 2>/dev/null)" = 10 ] \
  && [ "$(plutil -extract ExitTimeOut raw -o - "$KP" 2>/dev/null)" = 35 ] \
  && [ "$(plutil -extract RunAtLoad raw -o - "$KP" 2>/dev/null)" = true ] && [ ! -e "$KP.new" ] \
  && pass "register --apply adds KeepAlive {SuccessfulExit: false} to the LaunchAgent svc.sh wrote, and keeps the rest (kosmos#7001)" \
  || fail "register KeepAlive: $(plutil -p "$KP" 2>&1 | tr '\n' ' ')"
has rg-dry "WOULD: add KeepAlive {SuccessfulExit: false}" && pass "register dry run says it would add KeepAlive" || fail "register dry run: no KeepAlive line"
echo stopped > "$CH/actions-runner/.svc-state"
rm -f "$CH/actions-runner/.runner" "$CH/actions-runner/.service"   # rg-apply configured and registered it; this case is about the Listener
STDIN_FILE="$T/token" run rg-nolistener "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" FX_LISTENER=0 KOSMOS_CI_START_WAIT_S=1 -- --apply register
[ "$(rc rg-nolistener)" = 1 ] && has rg-nolistener "no new Runner.Listener is running" && pass "register --apply fails when no Listener comes up" || fail "register no listener: rc $(rc rg-nolistener): $(tail -1 "$T/rg-nolistener.out")"
RS="$T/rg-service"; svc_home "$RS"; cp "$BIN/_stub" "$RS/actions-runner/config.sh"; chmod +x "$RS/actions-runner/config.sh"
mkdir -p "$RS/.kosmos-ci"; printf 'ACTIONS_RUNNER_HOOK_JOB_STARTED=%s\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' "$RS/.kosmos-ci/job-started.sh" "$RS/.kosmos-ci/job-completed.sh" > "$RS/actions-runner/.env"
for f in job-guard.sh job-started.sh job-completed.sh job-cleanup.sh; do printf '#!/bin/bash\n' > "$RS/.kosmos-ci/$f"; chmod 755 "$RS/.kosmos-ci/$f"; done
STDIN_FILE="$T/token" run rg-twice "$RS" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$RS" -- --apply register
[ "$(rc rg-twice)" = 1 ] && has rg-twice "registered as a service already" && ! grep -q '^config\.sh' "$T/rg-twice.calls" \
  && pass "register --apply refuses a runner already registered as a service, before config.sh" || fail "register twice: rc $(rc rg-twice): $(tail -1 "$T/rg-twice.out")"
run rg-sudo "$CH" FX_WHO=kosmos-ci -- --apply register
[ "$(rc rg-sudo)" = 2 ] && has rg-sudo "not /Users/kosmos-ci" && ! grep -q '^config\.sh' "$T/rg-sudo.calls" && pass "register --apply refuses when HOME is not kosmos-ci's (sudo -u keeps HOME)" || fail "register HOME check: rc $(rc rg-sudo)"
rm -f "$CH/actions-runner/.service" "$CH/actions-runner/.runner"   # rg-apply registered it; the next cases are about other refusals
echo stopped > "$CH/actions-runner/.svc-state"
STDIN_FILE="$T/token" run rg-handrun "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" FX_OLD_TOO=3333 FX_LISTENER=0 KOSMOS_CI_START_WAIT_S=1 -- --apply register
[ "$(rc rg-handrun)" = 1 ] && has rg-handrun "no new Runner.Listener" && pass "register --apply does not take a hand-started Listener for the service's" || fail "register hand-run listener: rc $(rc rg-handrun): $(tail -1 "$T/rg-handrun.out")"
rm -f "$CH/actions-runner/.service"; echo '{}' > "$CH/actions-runner/.runner"
STDIN_FILE="$T/token" run rg-configured "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply register
[ "$(rc rg-configured)" = 1 ] && has rg-configured "configured already" && ! grep -q '^config\.sh' "$T/rg-configured.calls" \
  && pass "register --apply refuses a runner configured already, before config.sh" || fail "register configured: rc $(rc rg-configured): $(tail -1 "$T/rg-configured.out")"
rm -f "$CH/actions-runner/.runner" "$CH/actions-runner/.service"
run rg-none "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply register
[ "$(rc rg-none)" = 1 ] && has rg-none "no registration token" && ! grep -q '^config\.sh' "$T/rg-none.calls" && pass "register --apply refuses with no token" || fail "register no token: rc $(rc rg-none)"
# svc.sh install that writes no plist: register fails before svc.sh start rather than starting a runner without KeepAlive.
rm -f "$KP" "$CH/actions-runner/.runner" "$CH/actions-runner/.service"; echo stopped > "$CH/actions-runner/.svc-state"
STDIN_FILE="$T/token" run rg-noplist "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" FX_SVC_NO_PLIST=1 -- --apply register
[ "$(rc rg-noplist)" = 1 ] && has rg-noplist "wrote no actions.runner LaunchAgent" && ! grep -q '^svc\.sh start' "$T/rg-noplist.calls" \
  && pass "register --apply fails, and starts nothing, when svc.sh install writes no LaunchAgent" || fail "register no plist: rc $(rc rg-noplist): $(tail -1 "$T/rg-noplist.out")"

# --- keepalive (kosmos#7001) ------------------------------------------------------------------------------------
KH="$T/ka-home"; KA="$KH/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist"
KR="$KH/Library/LaunchAgents/actions.runner.joshualeestone-kosmos-relay.agent1s-relay.plist"
ka_fresh() {   # an installed runner as svc.sh leaves it: started, its plist without KeepAlive
  rm -rf "$KH"; rm -f "$T/loaded-ka"; mkdir -p "$KH/actions-runner" "$KH/Library/LaunchAgents"
  cp "$BIN/_stub" "$KH/actions-runner/svc.sh"; chmod +x "$KH/actions-runner/svc.sh"
  (cd "$KH/actions-runner" && HOME="$KH" CALL_LOG=/dev/null ./svc.sh install && echo started > .svc-state && echo 4343 > .svc-pid)
  # The kosmos-relay runner under the same user (#6245): its plist sorts BEFORE this repo's ('-' before '.').
  sed 's/joshualeestone-kosmos\.kosmos-ci-agent1s/joshualeestone-kosmos-relay.agent1s-relay/' "$KA" > "$KR"
  cp "$KA" "$T/ka.before"; cp "$KR" "$T/kr.before"
}
ka_fresh
[ -f "$KA" ] && [ -z "$(ka_of "$KA")" ] && [ "$(ls "$KH"/Library/LaunchAgents/actions.runner.*.plist | head -n 1)" = "$KR" ] \
  && pass "control: the keepalive fixture starts with no KeepAlive, and the relay's plist sorts first" || fail "keepalive fixture: $(ls -la "$KH/Library/LaunchAgents" 2>&1)"
run ka-dry "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- keepalive
[ "$(rc ka-dry)" = 0 ] && has ka-dry "lacks KeepAlive {SuccessfulExit: false}" && has ka-dry "WOULD: launchctl bootout gui/777/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s" \
  && ! changed ka-dry >/dev/null && cmp -s "$KA" "$T/ka.before" \
  && pass "keepalive dry run: says KeepAlive is missing and what it would do, changes nothing" || fail "keepalive dry run: rc $(rc ka-dry): $(cat "$T/ka-dry.out")"
# Over ssh (launchctl managername reads Background there): allowed, as it names gui/<uid> and does not use svc.sh.
run ka-apply "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_MANAGER=Background -- --apply keepalive
if [ "$(rc ka-apply)" = 0 ] && [ "$(ka_of "$KA")" = false ] && [ "$(plutil -extract ThrottleInterval raw -o - "$KA")" = 10 ] \
   && grep -n '^launchctl bootout gui/777/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s$' "$T/ka-apply.calls" | head -1 | cut -d: -f1 > "$T/ka.o" \
   && [ "$(grep -n "^launchctl bootstrap gui/777 $KA\$" "$T/ka-apply.calls" | head -1 | cut -d: -f1)" -gt "$(cat "$T/ka.o")" ] \
   && has ka-apply "the runner is running again" && cmp -s "$KR" "$T/kr.before" && ! grep -q 'kosmos-relay' "$T/ka-apply.calls"; then
  pass "keepalive --apply over ssh: THIS runner's plist (from .service, not the relay's) gains KeepAlive, bootout before bootstrap, a new Listener"; cp "$KA" "$T/ka.after"
else fail "keepalive --apply: rc $(rc ka-apply): $(tail -2 "$T/ka-apply.out") calls: $(grep '^launchctl' "$T/ka-apply.calls" | tr '\n' ';')"; fi
run ka-again "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- keepalive
[ "$(rc ka-again)" = 0 ] && has ka-again "restarts after a kill" && has ka-again "and is running" && ! has ka-again "WOULD" && pass "keepalive dry run on a runner that has it: says so, would do nothing" || fail "keepalive again: $(cat "$T/ka-again.out")"
# Loaded with KeepAlive but not running (it exited 0): DOWN, not "done".
run ka-loadeddown "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_JOB_STATE=waiting KOSMOS_CI_STATE_WAIT_S=1 -- keepalive
[ "$(rc ka-loadeddown)" = 1 ] && has ka-loadeddown "has KeepAlive loaded but has not been running" && has ka-loadeddown "(state = waiting)" && ! has ka-loadeddown "restarts after a kill" \
  && pass "keepalive: KeepAlive loaded on a job that is not running is DOWN, not done" || fail "keepalive loaded down: rc $(rc ka-loadeddown): $(cat "$T/ka-loadeddown.out")"
ka_fresh; run ka-job "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_WORKER=1 -- --apply keepalive
[ "$(rc ka-job)" = 1 ] && has ka-job "a job is running" && [ "$(ka_of "$KA")" = false ] && ! grep -q '^launchctl boot' "$T/ka-job.calls" \
  && pass "keepalive --apply does not reload while a job runs (seen by name, as after a self-update); the plist keeps KeepAlive for the next start" || fail "keepalive job: rc $(rc ka-job): $(tail -1 "$T/ka-job.out")"
# The rerun its refusal asks for: the plist has KeepAlive now, the loaded job does not, so it must reload, not stop at
# the file (the plist alone does not make a killed runner come back).
run ka-rerun "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- --apply keepalive
[ "$(rc ka-rerun)" = 0 ] && grep -q '^launchctl bootout gui/777/' "$T/ka-rerun.calls" && grep -q '^launchctl bootstrap gui/777 ' "$T/ka-rerun.calls" \
  && has ka-rerun "with KeepAlive loaded" && ! has ka-rerun "KeepAlive added" \
  && pass "keepalive --apply, rerun after a refused reload: the plist already has it, the loaded job does not, so it reloads" || fail "keepalive rerun: rc $(rc ka-rerun): $(tail -2 "$T/ka-rerun.out")"
ka_fresh; cp "$T/ka.after" "$KA"; run ka-oldjob "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- keepalive
[ "$(rc ka-oldjob)" = 0 ] && has ka-oldjob "the LOADED actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s does not" && has ka-oldjob "WOULD: launchctl bootout" \
  && ! has ka-oldjob "restarts after a kill" && pass "keepalive dry run: a plist with KeepAlive under a loaded job without it is not called done" || fail "keepalive old job: $(cat "$T/ka-oldjob.out")"
ka_fresh; run ka-elsewhere "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_NOT_LOADED=1 -- --apply keepalive
[ "$(rc ka-elsewhere)" = 1 ] && has ka-elsewhere "Listener runs but" && [ "$(ka_of "$KA")" = false ] && ! grep -q '^launchctl boot' "$T/ka-elsewhere.calls" \
  && pass "keepalive --apply: its Listener runs but the job is not in gui/<uid> (started another way): refuses, starts no second copy" || fail "keepalive elsewhere: rc $(rc ka-elsewhere): $(tail -1 "$T/ka-elsewhere.out")"
ka_fresh; echo stopped > "$KH/actions-runner/.svc-state"; run ka-stopped "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_NOT_LOADED=1 -- --apply keepalive
[ "$(rc ka-stopped)" = 1 ] && [ "$(ka_of "$KA")" = false ] && has ka-stopped "DOWN: actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s is not loaded" && ! grep -q '^launchctl boot' "$T/ka-stopped.calls" \
  && pass "keepalive --apply on a runner that is not loaded: KeepAlive in the plist, NOT started, and said loudly as DOWN (exit 1, not ok)" || fail "keepalive stopped: rc $(rc ka-stopped): $(tail -1 "$T/ka-stopped.out")"
# The relay's Listener (its own dir, #6245) is not this runner's: it neither counts as "running elsewhere" ...
ka_fresh; echo stopped > "$KH/actions-runner/.svc-state"; run ka-relayonly "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_NOT_LOADED=1 FX_RELAY_LISTENER=1 -- --apply keepalive
[ "$(rc ka-relayonly)" = 1 ] && has ka-relayonly "DOWN:" && ! has ka-relayonly "Listener runs but" \
  && pass "keepalive --apply: the relay's Listener is not taken for this runner's (DOWN, not 'loaded elsewhere')" || fail "keepalive relay only: rc $(rc ka-relayonly): $(tail -1 "$T/ka-relayonly.out")"
# ... nor, respawning during the reload, as this runner having come back.
ka_fresh; run ka-relayrespawn "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_RELAY_LISTENER=1 FX_LISTENER=0 KOSMOS_CI_START_WAIT_S=1 -- --apply keepalive
[ "$(rc ka-relayrespawn)" = 1 ] && has ka-relayrespawn "no new Listener of $KH/actions-runner" \
  && pass "keepalive --apply: a relay Listener respawning during the reload is not taken for this runner coming back" || fail "keepalive relay respawn: rc $(rc ka-relayrespawn): $(tail -1 "$T/ka-relayrespawn.out")"
# A bootout that reports failure while the job is still listed may still be unloading: it waits, and says both outcomes.
ka_fresh; run ka-bootoutfail "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_BOOTOUT_FAIL=1 FX_NO_PID=1 FX_LISTENER=0 KOSMOS_CI_UNLOAD_WAIT_S=1 -- --apply keepalive
[ "$(rc ka-bootoutfail)" = 1 ] && has ka-bootoutfail "(exit 5) had not unloaded it" && has ka-bootoutfail "may still be unloading" && has ka-bootoutfail "the runner is DOWN" \
  && ! has ka-bootoutfail "runs on" && ! grep -q '^launchctl bootstrap' "$T/ka-bootoutfail.calls" \
  && pass "keepalive --apply: a failed bootout with the job still listed is not called running: it may be unloading, both outcomes named" || fail "keepalive bootout fail: rc $(rc ka-bootoutfail): $(tail -1 "$T/ka-bootoutfail.out")"
ka_fresh; run ka-baselinefail "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_LISTENER_PGREP_FAIL=1 -- --apply keepalive
[ "$(rc ka-baselinefail)" = 1 ] && has ka-baselinefail "to note the running Listener" && ! grep -q '^launchctl boot' "$T/ka-baselinefail.calls" \
  && pass "keepalive --apply refuses before the bootout when it cannot note the running Listener" || fail "keepalive baseline pgrep fail: rc $(rc ka-baselinefail): $(tail -1 "$T/ka-baselinefail.out")"
# A runner patched by hand with KeepAlive only (no ExitTimeOut), loaded that way: not done; --apply completes it and reloads.
ka_fresh; plutil -insert KeepAlive -xml '<dict><key>SuccessfulExit</key><false/></dict>' "$KA"; echo 5 > "$T/loaded-ka"
run ka-partial "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- keepalive
run ka-partial-apply "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- --apply keepalive
[ "$(rc ka-partial)" = 0 ] && ! has ka-partial "restarts after a kill" && has ka-partial "lacks ExitTimeOut 35 (it has KeepAlive)" && has ka-partial "WOULD: add KeepAlive" \
  && [ "$(rc ka-partial-apply)" = 0 ] && [ "$(plutil -extract ExitTimeOut raw -o - "$KA")" = 35 ] && grep -q '^launchctl bootstrap' "$T/ka-partial-apply.calls" \
  && pass "keepalive: KeepAlive without ExitTimeOut is not done; --apply adds ExitTimeOut 35 and reloads" || fail "keepalive partial: rc $(rc ka-partial)/$(rc ka-partial-apply): $(tail -2 "$T/ka-partial.out") / $(tail -1 "$T/ka-partial-apply.out")"
# The plist has all three keys but the LOADED job still has the old 5 s exit timeout: not done, it needs a reload.
ka_fresh; cp "$T/ka.after" "$KA"; echo 5 > "$T/loaded-ka"
run ka-oldtimeout "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- keepalive
[ "$(rc ka-oldtimeout)" = 0 ] && ! has ka-oldtimeout "restarts after a kill" && has ka-oldtimeout "WOULD: launchctl bootout" \
  && pass "keepalive dry run: a loaded job with KeepAlive but launchd's 5 s exit timeout is not done" || fail "keepalive old timeout: $(cat "$T/ka-oldtimeout.out")"
# The old job is stopped with SIGTERM before the bootout (it may still have launchd's 5 s exit timeout). 999999 is a pid
# that does not exist, so the wait for it ends at once and touches no real process.
ka_fresh; run ka-sigterm "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_JOB_PID=999999 -- --apply keepalive
k="$(grep -n '^launchctl kill SIGTERM gui/777/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s$' "$T/ka-sigterm.calls" | head -n 1 | cut -d: -f1)"
b="$(grep -n '^launchctl bootout ' "$T/ka-sigterm.calls" | head -n 1 | cut -d: -f1)"
[ "$(rc ka-sigterm)" = 0 ] && [ -n "$k" ] && [ -n "$b" ] && [ "$k" -lt "$b" ] \
  && pass "keepalive --apply stops the old job with SIGTERM, then boots it out (a bootout alone runs under the old 5 s exit timeout)" || fail "keepalive sigterm: rc $(rc ka-sigterm): kill at ${k:-none}, bootout at ${b:-none}"
# The wait itself: a real process the test owns stands in for the old runsvc.sh. It ends by itself in 2 s, and the
# bootout must come after that, not at once (under the old 5 s exit timeout an early bootout would SIGKILL the Listener).
sleep 2 & sp=$!
ka_fresh; run ka-waits "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_JOB_PID="$sp" -- --apply keepalive
wait "$sp" 2>/dev/null
[ "$(rc ka-waits)" = 0 ] && grep -qx 'bootout-after-exit' "$T/ka-waits.calls" && ! has ka-waits "had not ended" \
  && pass "keepalive --apply waits for the old runner to end after SIGTERM before booting it out" || fail "keepalive waits: rc $(rc ka-waits): $(grep bootout- "$T/ka-waits.calls")"
# Outlives the wait: it goes on (refusing would leave a SIGTERMed runner under its old definition) and says so.
sleep 30 & sp=$!
ka_fresh; run ka-outlives "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_JOB_PID="$sp" KOSMOS_CI_UNLOAD_WAIT_S=1 -- --apply keepalive
kill "$sp" 2>/dev/null; wait "$sp" 2>/dev/null
[ "$(rc ka-outlives)" = 0 ] && has ka-outlives "had not ended 1s after SIGTERM" && grep -qx 'bootout-while-alive' "$T/ka-outlives.calls" \
  && pass "keepalive --apply: an old runner that outlives the wait is booted out with a note naming the risk" || fail "keepalive outlives: rc $(rc ka-outlives): $(tail -2 "$T/ka-outlives.out")"
ka_fresh; run ka-killfail "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_JOB_PID=999999 FX_KILL_FAIL=1 -- --apply keepalive
[ "$(rc ka-killfail)" = 1 ] && has ka-killfail "launchctl kill SIGTERM" && ! grep -q '^launchctl boot' "$T/ka-killfail.calls" \
  && pass "keepalive --apply: a failed SIGTERM refuses before the bootout" || fail "keepalive kill fail: rc $(rc ka-killfail): $(tail -1 "$T/ka-killfail.out")"
ka_fresh; echo stopped > "$KH/actions-runner/.svc-state"; run ka-downdry "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_NOT_LOADED=1 -- keepalive
[ "$(rc ka-downdry)" = 1 ] && has ka-downdry "DOWN:" && ! changed ka-downdry >/dev/null && pass "keepalive dry run on a runner that is not loaded: DOWN, exit 1, nothing changed" || fail "keepalive down dry: rc $(rc ka-downdry): $(cat "$T/ka-downdry.out")"
ka_fresh; run ka-stucksent "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_JOB_PID=999999 FX_BOOTOUT_STUCK=1 KOSMOS_CI_UNLOAD_WAIT_S=1 -- --apply keepalive
[ "$(rc ka-stucksent)" = 1 ] && has ka-stucksent "the runner is STOPPED (SIGTERM ended it" && ! has ka-stucksent "it runs the OLD definition" \
  && pass "keepalive --apply: a stuck bootout after SIGTERM says the runner is STOPPED, not running" || fail "keepalive stuck after sigterm: rc $(rc ka-stucksent): $(tail -1 "$T/ka-stucksent.out")"
ka_fresh; run ka-nopid "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_NO_PID=1 -- --apply keepalive
[ "$(rc ka-nopid)" = 1 ] && has ka-nopid "shows no pid" && ! grep -q '^launchctl \(kill\|bootout\)' "$T/ka-nopid.calls" \
  && pass "keepalive --apply: no pid in launchd's print while its Listener runs refuses before stopping anything" || fail "keepalive no pid: rc $(rc ka-nopid): $(tail -1 "$T/ka-nopid.out")"
# The HUP/PIPE trap is in place for the whole stop: after the job check, before the SIGTERM (a source-order check; a
# hang-up cannot be staged here).
tl="$(grep -n "^  trap '' HUP PIPE\$" "$S" | cut -d: -f1)"; wl="$(grep -n -- '-x Runner.Worker >/dev/null || prc' "$S" | tail -n 1 | cut -d: -f1)"
kl="$(grep -n 'launchctl kill SIGTERM "\$dom/\$label"' "$S" | head -n 1 | cut -d: -f1)"
[ -n "$tl" ] && [ -n "$wl" ] && [ -n "$kl" ] && [ "$wl" -lt "$tl" ] && [ "$tl" -lt "$kl" ] \
  && pass "keepalive: SIGHUP and SIGPIPE are ignored from after the job check to before the SIGTERM" || fail "keepalive trap order: job $wl, trap $tl, kill $kl"
ka_fresh; run ka-noka "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_BOOTSTRAP_NO_KA=1 -- --apply keepalive
[ "$(rc ka-noka)" = 1 ] && has ka-noka "shows no 'successful exit => 0' semaphore" \
  && pass "keepalive --apply: a reload that leaves no KeepAlive in the loaded job fails" || fail "keepalive no ka loaded: rc $(rc ka-noka): $(tail -1 "$T/ka-noka.out")"
ka_fresh; run ka-stuck "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_BOOTOUT_STUCK=1 FX_NO_PID=1 FX_LISTENER=0 KOSMOS_CI_UNLOAD_WAIT_S=1 -- --apply keepalive
[ "$(rc ka-stuck)" = 1 ] && has ka-stuck "had not unloaded it" && has ka-stuck "may still be unloading" && ! grep -q '^launchctl bootstrap' "$T/ka-stuck.calls" \
  && pass "keepalive --apply: a bootout that does not unload says so and does not bootstrap" || fail "keepalive stuck: rc $(rc ka-stuck): $(tail -1 "$T/ka-stuck.out")"
ka_fresh; chmod 000 "$KH/actions-runner/.service"; run ka-other "$KH" FX_CI_EXISTS=1 KOSMOS_CI_HOME="$KH" -- keepalive; chmod 644 "$KH/actions-runner/.service"
[ "$(rc ka-other)" = 0 ] && has ka-other "cannot read kosmos-ci's runner" && ! has ka-other "register first" \
  && pass "keepalive dry run as another user that cannot read the runner: says so, not \"register first\"" || fail "keepalive as other: rc $(rc ka-other): $(cat "$T/ka-other.out")"
ka_fresh; run ka-pgrepfail "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_PGREP_FAIL=1 -- --apply keepalive
[ "$(rc ka-pgrepfail)" = 1 ] && has ka-pgrepfail "could not list processes" && ! grep -q '^launchctl boot' "$T/ka-pgrepfail.calls" \
  && pass "keepalive --apply refuses when it cannot rule out a job" || fail "keepalive pgrep fail: rc $(rc ka-pgrepfail): $(tail -1 "$T/ka-pgrepfail.out")"
ka_fresh; run ka-loggedout "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_LAUNCHCTL_FAIL=1 -- --apply keepalive
[ "$(rc ka-loggedout)" = 1 ] && has ka-loggedout "is not logged in" && cmp -s "$KA" "$T/ka.before" \
  && pass "keepalive --apply refuses when the user's GUI domain does not exist" || fail "keepalive logged out: rc $(rc ka-loggedout): $(tail -1 "$T/ka-loggedout.out")"
ka_fresh; run ka-bootfail "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" FX_BOOTSTRAP_FAIL=1 -- --apply keepalive
[ "$(rc ka-bootfail)" = 1 ] && has ka-bootfail "the runner is STOPPED" && pass "keepalive --apply says the runner is stopped when bootstrap fails" || fail "keepalive bootstrap fail: rc $(rc ka-bootfail): $(tail -1 "$T/ka-bootfail.out")"
ka_fresh; rm -f "$KA" "$KH/actions-runner/.service"; run ka-none "$KH" FX_CI_EXISTS=1 FX_WHO=kosmos-ci KOSMOS_CI_HOME="$KH" -- --apply keepalive
[ "$(rc ka-none)" = 1 ] && has ka-none "register first" && ! grep -q '^launchctl boot' "$T/ka-none.calls" && pass "keepalive --apply refuses with no LaunchAgent" || fail "keepalive none: rc $(rc ka-none)"
ka_fresh; run ka-owner "$KH" FX_CI_EXISTS=1 KOSMOS_CI_HOME="$KH" -- --apply keepalive
[ "$(rc ka-owner)" = 2 ] && has ka-owner "runs as kosmos-ci" && cmp -s "$KA" "$T/ka.before" && pass "keepalive --apply refuses as anyone but kosmos-ci" || fail "keepalive as owner: rc $(rc ka-owner)"

# --- verify -----------------------------------------------------------------------------------------------------
VCI="$T/vci"; mkdir -p "$VCI/actions-runner" "$VCI/.kosmos-ci"
printf 'LANG=en_US.UTF-8\nACTIONS_RUNNER_HOOK_JOB_STARTED=%s\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' "$VCI/.kosmos-ci/job-started.sh" "$VCI/.kosmos-ci/job-completed.sh" > "$VCI/actions-runner/.env"
# The hooks install really wrote (in-apply above), so verify's byte comparison has the true bodies to match.
printf '#!/bin/bash\n' > "$VCI/.kosmos-ci/job-guard.sh"
for f in job-started.sh job-completed.sh job-cleanup.sh; do cp "$CH/.kosmos-ci/$f" "$VCI/.kosmos-ci/$f"; done
chmod 755 "$VCI/.kosmos-ci/"*
GS="$(shasum -a 256 "$VCI/.kosmos-ci/job-guard.sh" | cut -d' ' -f1)"
vcase() {  # vcase <name> <want rc> <want text> <env...>
  local name="$1" want="$2" text="$3"; shift 3
  run "v-$name" "$H" FX_CI_EXISTS=1 KOSMOS_CI_HOME="$VCI" KOSMOS_CI_GUARD_SHA="$GS" "$@" -- verify
  [ "$(rc "v-$name")" = "$want" ] && has "v-$name" "$text" && pass "verify: $name" || fail "verify $name: rc $(rc "v-$name"): $(grep -E 'PROBLEM|UNCHECKED|clear' "$T/v-$name.out" | head -2)"
}
vcase clear 0 "verify: clear"
vcase labels 1 "labels are 'arm64,macos,self-hosted'" "FX_RUNNER_ROW=online false arm64,macos,self-hosted"
vcase offline 1 "kosmos-ci-agent1s is offline" "FX_RUNNER_ROW=offline false arm64,kosmos-ci,macos,self-hosted"
vcase missing 1 "no runner named kosmos-ci-agent1s" FX_RUNNER_ROW=
vcase switchoff 1 "KOSMOS_CI_RUNNER is 'off'" FX_RUNNER_VAR=off
vcase shards 1 "KOSMOS_CI_SHELL_SHARDS is '2/2'" FX_SHARDS=2/2
vcase leftover 1 "kosmos-ci still runs" "FX_PS=/opt/homebrew/bin/tmux -L t new-session -d"
vcase leftover-tmux-server 1 "kosmos-ci still runs" "FX_PS=tmux: server (/private/tmp/tmux-777/default) (tmux)"
vcase leftover-node 1 "kosmos-ci still runs" "FX_PS=node server.js --port 16190"
vcase leftover-busy 0 "while a job is in flight (busy=true)" "FX_PS=node server.js" "FX_RUNNER_ROW=online true arm64,kosmos-ci,macos,self-hosted"
vcase raced 1 "went busy or idle during verify" FX_BUSY2=true
vcase reread-fails 1 "could not read the runners API a second time" FX_BUSY2_FAIL=1
vcase nolabels 1 "labels are '', not" "FX_RUNNER_ROW=online false"
vcase guard-unpinned 3 "the job guard's integrity" KOSMOS_CI_GUARD_SHA=
chmod 000 "$VCI/actions-runner/.env"; vcase env-unreadable 3 "cannot read $VCI/actions-runner/.env"; chmod 644 "$VCI/actions-runner/.env"
chmod 000 "$VCI/.kosmos-ci"; vcase cidir-unreadable 3 "cannot read $VCI/.kosmos-ci"; chmod 755 "$VCI/.kosmos-ci"
mv "$VCI/.kosmos-ci" "$VCI/.kosmos-ci.away"; vcase cidir-missing 1 "no $VCI/.kosmos-ci: the job guard and its hooks are not installed"; mv "$VCI/.kosmos-ci.away" "$VCI/.kosmos-ci"
mkdir -p "$VCI/actions-runner/_work/_temp"; : > "$VCI/actions-runner/_work/_temp/left"
vcase temp-left 0 "_work/_temp is not empty while idle"
rm -f "$VCI/actions-runner/_work/_temp/left"
cp "$VCI/.kosmos-ci/job-started.sh" "$T/started.good"; printf '#!/bin/bash\nexit 0\n' > "$VCI/.kosmos-ci/job-started.sh"
vcase hook-rewritten 1 "job-started.sh differs from what install writes"
cp "$T/started.good" "$VCI/.kosmos-ci/job-started.sh"
vcase guard-pin 0 "job guard sha256 is the install pin" KOSMOS_CI_GUARD_SHA="$GS"
vcase guard-drift 1 "something rewrote it" KOSMOS_CI_GUARD_SHA=0000000000000000000000000000000000000000000000000000000000000000
vcase psfail 1 "kosmos-ci runs no processes" FX_PS_FAIL=1
# kosmos#7001: the LaunchAgent, when verify can read it (as the owner it usually cannot: ~/Library is mode 700).
grep -q "no $VCI/actions-runner/.service: the runner is not registered as a service" "$T/v-clear.out" && pass "verify: no .service is a note naming that, and leaves verify clear" || fail "verify LaunchAgent note: $(grep -i -E 'launchagent|service' "$T/v-clear.out")"
mkdir -p "$VCI/Library/LaunchAgents"; cp "$T/ka.before" "$VCI/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist"
echo "$VCI/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist" > "$VCI/actions-runner/.service"
vcase no-keepalive 1 "lacks KeepAlive {SuccessfulExit: false}"
cp "$T/ka.after" "$VCI/Library/LaunchAgents/actions.runner.joshualeestone-kosmos.kosmos-ci-agent1s.plist"
vcase keepalive 0 "has KeepAlive SuccessfulExit false"
rm -rf "$VCI/Library" "$VCI/actions-runner/.service"
grep -q 'no tmux or node left' "$T/v-clear.out" && pass "verify: an idle runner's own node (RunnerService.js) is not a leftover" || fail "verify idle runner: $(grep -E 'REFUSE|ok' "$T/v-clear.out" | tail -2)"
cp "$VCI/actions-runner/.env" "$T/vci.env"
grep -v HOOK_JOB_STARTED "$T/vci.env" > "$VCI/actions-runner/.env"
vcase unwired 1 "the job guard is not wired"
{ cat "$T/vci.env"; echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/tmp/elsewhere.sh"; } > "$VCI/actions-runner/.env"
vcase hook-twice 1 "sets ACTIONS_RUNNER_HOOK_JOB_STARTED more than once"
cp "$T/vci.env" "$VCI/actions-runner/.env"; chmod 000 "$VCI/actions-runner"
vcase home-hidden 3 "check(s) could not be made"
chmod 000 "$VCI"; vcase home-closed 3 "but 1 check(s) could not be made"; chmod 755 "$VCI"
grep -q 'but 1 check(s) could not be made' "$T/v-home-hidden.out" && pass "verify counts a hidden runner dir once" || fail "hidden runner dir counted: $(grep 'could not be made' "$T/v-home-hidden.out")"
chmod 755 "$VCI/actions-runner"
! has v-home-hidden "install has not run here" && ! has v-home-hidden "no $VCI/actions-runner/.path here" && pass "verify: a runner dir it cannot enter is not called missing" || fail "verify hidden dir read as missing"
cp "$T/vci.env" "$VCI/actions-runner/.env"; chmod 644 "$VCI/.kosmos-ci/job-guard.sh"
vcase guard-not-executable 1 "job-guard.sh is missing or not executable"
chmod 755 "$VCI/.kosmos-ci/job-guard.sh"
printf '%s\n' "/usr/bin:/bin:/usr/sbin:/sbin:$BREWD/bin:/usr/local/bin:$VCI/.local/bin" > "$VCI/actions-runner/.path"
vcase path-agrees 0 ".path is the PATH .env sets"
echo "/login/shell/path" > "$VCI/actions-runner/.path"
vcase path-login 0 ".path is not"
rm -f "$VCI/actions-runner/.path"
printf 'export KOSMOS_TESTS_IGNORE_SUITE=1\n' >> "$VCI/actions-runner/.env"
vcase env-kosmos 1 "sets a KOSMOS_ variable: remove it"
run v-nouser "$H" -- verify
[ "$(rc v-nouser)" = 1 ] && has v-nouser "no user kosmos-ci on this Mac" && pass "verify: no CI user here is a problem, not a clean 'nothing left'" || fail "verify no user: rc $(rc v-nouser)"
for n in v-clear v-leftover; do if out="$(changed "$n")"; then fail "verify $n changed something: $out"; fi; done

sleep 0.2   # let tee flush the last of stderr
if grep -q 'command not found' "$T/test-stderr" 2>/dev/null; then fail "the test itself hit 'command not found': $(grep 'command not found' "$T/test-stderr" | head -2)"; fi
if [ "$fails" -gt 0 ]; then echo "test-ci-runner-setup-4601: $fails failure(s)"; exit 1; fi
echo "test-ci-runner-setup-4601: all passed"
