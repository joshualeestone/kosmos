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
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
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
  launchctl) [ "${FX_LAUNCHCTL_FAIL:-0}" = 1 ] && exit 1; printf 'PID\tStatus\tLabel\n-\t0\tcom.apple.Finder\n123\t0\tapplication.com.apple.Terminal.1234.5678\n'; [ -z "${FX_JOBS:-}" ] || printf '%s\n' "$FX_JOBS" | sed 's/^/-\t0\t/' ;;
  crontab) [ -z "${FX_CRON:-}" ] && exit 1; printf '%s\n' "$FX_CRON" ;;
  pgrep)
    case "$*" in *Runner.Worker*) [ "${FX_WORKER:-0}" = 1 ] || exit 1; echo 4242; exit 0 ;; esac
    [ -z "${FX_LIVE:-}" ] && exit 1; printf '%s\n' "$FX_LIVE" ;;
  df) printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk3s1 239362496 1 %s 50%% /\n' "${FX_FREE_KIB:-31457280}" ;;
  fdesetup) echo "${FX_FV:-FileVault is Off.}" ;;
  pmset) printf 'System-wide power settings:\nCurrently in use:\n standby              0\n sleep                %s\n autorestart          %s\n displaysleep         10\n' "${FX_SLEEP:-0}" "${FX_AUTORESTART:-1}" ;;
  id)
    case "$1" in
      -un) echo "${FX_WHO:-agent1}" ;;
      -Gn) echo "${FX_GROUPS:-staff everyone}" ;;
      -u) echo 777 ;;
      *) [ "${FX_CI_EXISTS:-0}" = 1 ] || [ -f "$(dirname "$CALL_LOG")/user-created" ] || { echo "id: $1: no such user" >&2; exit 1; }; echo "uid=777($1)" ;;
    esac ;;
  ps) [ "${FX_PS_FAIL:-0}" = 1 ] && exit 1; [ -z "${FX_PS:-}" ] || printf '%s\n' "$FX_PS" ;;
  gh)
    [ "${FX_GH_FAIL:-0}" = 1 ] && exit 1
    case "$*" in
      *"variable list"*KOSMOS_CI_SHELL_SHARDS*) printf '%s' "${FX_SHARDS:-}" ;;
      *"variable list"*KOSMOS_CI_RUNNER*) printf '%s' "${FX_RUNNER_VAR-on}" ;;
      *"| .busy"*) row="${FX_RUNNER_ROW-online false x}"; set -- $row; printf '%s\n' "${FX_BUSY2:-$2}" ;;
      *actions/runners*) printf '%s\n' "${FX_RUNNER_ROW-online false arm64,kosmos-ci,macos,self-hosted}" ;;
    esac ;;
  curl)
    out=""; big=0; prev=""
    for a in "$@"; do [ "$prev" = -o ] && out="$a"; case "$a" in -*O*) big=1 ;; esac; prev="$a"; done
    url="${*: -1}"
    if [ -n "$out" ]; then printf '%s' "${FX_GUARD_BODY:-guard}" > "$out"
    elif [ "$big" = 1 ]; then printf 'runner-package' > "$(basename "$url")"
    else case "$url" in
      */compare/*) printf '{\n  "status": "%s",\n' "${FX_COMPARE:-ahead}" ;;
      */releases/latest) printf '{"tag_name": "v2.999.0", "body": "<!-- BEGIN SHA osx-arm64 -->%s<!-- END SHA osx-arm64 -->"}' "$(printf 'runner-package' | shasum -a 256 | cut -d' ' -f1)" ;;
    esac; fi ;;
  sudo) case "$*" in *"sysadminctl -addUser"*) [ "${FX_SYSADMIN_NOOP:-0}" = 1 ] || : > "$(dirname "$CALL_LOG")/user-created" ;; esac ;;
  tar) [ "${FX_TAR_FAIL:-0}" = 1 ] && exit 1 ;;
  config.sh) printf 'token-in-env=%s\n' "${ACTIONS_RUNNER_INPUT_TOKEN:-}" >> "$CALL_LOG" ;;
  svc.sh)
    st="$(dirname "$0")/.svc-state"
    case "$1" in
      status) if [ "${FX_SVC_STUCK:-0}" = 1 ] || [ "$(cat "$st" 2>/dev/null)" = started ]; then echo "Started"; else echo "Stopped"; fi ;;
      stop) echo stopped > "$st" ;;
      start) echo started > "$st" ;;
    esac ;;
esac
exit 0
STUB
chmod +x "$BIN/_stub"
for c in launchctl crontab pgrep df fdesetup pmset id ps gh curl sudo sysadminctl tar; do ln -s _stub "$BIN/$c"; done
BREWD="$T/brew"; mkdir -p "$BREWD/bin"
printf '#!/bin/bash\necho "${FX_TMUX_V:-tmux 3.6a}"\n' > "$BREWD/bin/tmux"; printf '#!/bin/bash\n' > "$BREWD/bin/pwsh"; chmod +x "$BREWD/bin/"*

snap() { (cd "$1" && find . -print | LC_ALL=C sort && find . -type f -exec cksum {} + | LC_ALL=C sort); }
# run <name> <home> [env...] -- <script args...>: rc to $T/<name>.rc, output to $T/<name>.out, a fresh call log.
run() {
  local name="$1" home="$2"; shift 2
  local envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done; shift
  : > "$LOG"; rm -f "$T/user-created"
  env -i PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$home" CALL_LOG="$LOG" KOSMOS_CI_BREW="$BREWD" \
    ${envs[@]+"${envs[@]}"} bash "$S" "$@" > "$T/$name.out" 2>&1 < "${STDIN_FILE:-/dev/null}"
  echo $? > "$T/$name.rc"
  cp "$LOG" "$T/$name.calls"
}
rc() { cat "$T/$1.rc"; }
has() { grep -q -F -- "$2" "$T/$1.out"; }
# A changing call: anything but a read. curl counts only with -o or -O (a download); gh only with -X.
changed() { grep -E '^(sudo|sysadminctl|tar|config\.sh|svc\.sh) |^curl .*(-o |-[a-zA-Z]*O)|^gh .*-X|^launchctl (bootout|disable|load|unload)' "$T/$1.calls"; }

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
refuse suite "a suite is live on this Mac" "FX_LIVE=123 bash tools/run-tests.sh"
refuse disk "under the 20 GiB floor" FX_FREE_KIB=10485760
refuse filevault "FileVault is not off" "FX_FV=FileVault is On."
refuse sleep "system sleep is not 'never'" FX_SLEEP=10
refuse autorestart "autorestart is not 1" FX_AUTORESTART=0
refuse launchctl-unreadable "could not read launchctl list" FX_LAUNCHCTL_FAIL=1
refuse tmux35a "is 3.5a" "FX_TMUX_V=tmux 3.5a"
refuse admin "kosmos-ci is an admin" FX_CI_EXISTS=1 "FX_GROUPS=staff admin"
refuse shards "KOSMOS_CI_SHELL_SHARDS is '1/2'" FX_SHARDS=1/2
refuse gh "could not read the repo variables" FX_GH_FAIL=1
refuse bad-allow-ere "KOSMOS_CI_ALLOW_JOBS is not a valid ERE" FX_JOBS=com.kosmos.board "KOSMOS_CI_ALLOW_JOBS=(unbalanced"
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
[ "$(rc cu-nolaunchctl)" = 1 ] && ! changed cu-nolaunchctl >/dev/null && has cu-nolaunchctl "could not read launchctl list" \
  && pass "create-user --apply refuses when launchctl cannot be read (no fail-open under ||)" || fail "create-user, launchctl unreadable: rc $(rc cu-nolaunchctl)"
run cu-noop "$H" FX_SYSADMIN_NOOP=1 -- --apply create-user
[ "$(rc cu-noop)" = 1 ] && has cu-noop "was not created" && pass "create-user --apply stops when sysadminctl made no user" || fail "create-user no-op: rc $(rc cu-noop)"
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
run in-fork "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" FX_COMPARE=diverged -- install "$C" "$G"
[ "$(rc in-fork)" = 1 ] && has in-fork "is not on main" && pass "install refuses a commit not on main" || fail "install off-main: rc $(rc in-fork)"
run in-who "$CH" -- --apply install "$C" "$G"
[ "$(rc in-who)" = 2 ] && has in-who "runs as kosmos-ci" && ! changed in-who >/dev/null && pass "install --apply refuses as any user but kosmos-ci" || fail "install as agent1: rc $(rc in-who)"
mkdir -p "$CH/actions-runner"; printf 'LANG=C\nKOSMOS_TESTS_IGNORE_SUITE=1\n' > "$CH/actions-runner/.env"
run in-env "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- install "$C" "$G"
[ "$(rc in-env)" = 1 ] && has in-env "KOSMOS_TESTS_IGNORE_SUITE" && pass "install refuses a runner .env with a KOSMOS_ wait control (the suite lock)" \
  || fail "install .env override: rc $(rc in-env): $(tail -1 "$T/in-env.out")"
# CONTROL and the real path: --apply, with the downloads stubbed. An existing .env key the install does not own survives.
printf 'LANG=C\nRUNNER_KEEP=1\n' > "$CH/actions-runner/.env"
run in-apply "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply install "$C" "$G"
e="$CH/actions-runner/.env"
if [ "$(rc in-apply)" = 0 ] && grep -q '^tar xzf actions-runner-osx-arm64-2.999.0.tar.gz' "$T/in-apply.calls" \
   && grep -qx 'RUNNER_KEEP=1' "$e" && grep -qx "ACTIONS_RUNNER_HOOK_JOB_STARTED=$CH/.kosmos-ci/job-started.sh" "$e" \
   && grep -qx 'LANG=en_US.UTF-8' "$e" && [ "$(grep -c '^LANG=' "$e")" = 1 ] && ! grep -q '^KOSMOS_' "$e" \
   && [ -x "$CH/.kosmos-ci/job-started.sh" ] && [ -x "$CH/.kosmos-ci/job-cleanup.sh" ] && [ -x "$CH/.kosmos-ci/job-guard.sh" ]; then
  pass "CONTROL: install --apply unpacks, installs the guard and hooks, merges .env keeping other keys"
else fail "install --apply: rc $(rc in-apply): $(tail -3 "$T/in-apply.out")"; fi
run in-badsha "$T/cihome2" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$T/cihome2" FX_GUARD_BODY=tampered -- --apply install "$C" "$G"
[ "$(rc in-badsha)" = 1 ] && ! grep -q '^tar ' "$T/in-badsha.calls" && pass "install --apply refuses a guard whose sha256 differs, before unpacking" \
  || fail "install bad guard: rc $(rc in-badsha)"

# A running runner: stopped, unpacked over, started again. A job in flight, or a stop that does not take, refuses.
svc_home() { mkdir -p "$1/actions-runner"; cp "$BIN/_stub" "$1/actions-runner/svc.sh"; chmod +x "$1/actions-runner/svc.sh"; echo started > "$1/actions-runner/.svc-state"; }
R1="$T/run1"; svc_home "$R1"
run in-restart "$R1" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R1" -- --apply install "$C" "$G"
[ "$(rc in-restart)" = 0 ] && grep -q '^svc.sh stop' "$T/in-restart.calls" && grep -q '^tar ' "$T/in-restart.calls" && has in-restart "runner started again" \
  && pass "install --apply stops a running runner, unpacks, starts it again" || fail "install restart: rc $(rc in-restart): $(tail -2 "$T/in-restart.out")"
R2="$T/run2"; svc_home "$R2"
run in-job "$R2" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R2" FX_WORKER=1 -- --apply install "$C" "$G"
[ "$(rc in-job)" = 1 ] && has in-job "a job is running" && ! grep -q -E '^(svc.sh stop|tar )' "$T/in-job.calls" \
  && pass "install --apply refuses while a job runs, before stopping anything" || fail "install with a job: rc $(rc in-job): $(cat "$T/in-job.calls" | tail -3)"
R3="$T/run3"; svc_home "$R3"
run in-stuck "$R3" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R3" FX_SVC_STUCK=1 -- --apply install "$C" "$G"
[ "$(rc in-stuck)" = 1 ] && has in-stuck "did not stop" && ! grep -q '^tar ' "$T/in-stuck.calls" \
  && pass "install --apply refuses to unpack when the runner did not stop" || fail "install stuck stop: rc $(rc in-stuck)"
R5="$T/run5"; svc_home "$R5"
run in-tarfail "$R5" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R5" FX_TAR_FAIL=1 -- --apply install "$C" "$G"
[ "$(rc in-tarfail)" != 0 ] && grep -q '^svc.sh stop' "$T/in-tarfail.calls" && grep -q '^svc.sh start' "$T/in-tarfail.calls" \
  && pass "install --apply starts the runner again when it fails after stopping it" || fail "install fail after stop: rc $(rc in-tarfail), calls: $(grep svc "$T/in-tarfail.calls" | tr '\n' ' ')"
run in-owner "$H" -- install "$C" "$G"
[ "$(rc in-owner)" = 0 ] && has in-owner "unpack into /Users/kosmos-ci/actions-runner" && ! has in-owner "$H/" \
  && pass "install dry run as the owner names kosmos-ci's paths, not the owner's" || fail "install dry as owner: $(grep WOULD "$T/in-owner.out" | head -2)"
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
   && ! grep '^config\.sh ' "$T/rg-apply.calls" | grep -q SECRET; then pass "CONTROL: register --apply passes the token in the environment, never in config.sh's argv"
else fail "register --apply: rc $(rc rg-apply), calls: $(cat "$T/rg-apply.calls")"; fi
run rg-none "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply register
run rg-sudo "$CH" FX_WHO=kosmos-ci -- --apply register
[ "$(rc rg-sudo)" = 2 ] && has rg-sudo "not /Users/kosmos-ci" && ! grep -q '^config\.sh' "$T/rg-sudo.calls" && pass "register --apply refuses when HOME is not kosmos-ci's (sudo -u keeps HOME)" || fail "register HOME check: rc $(rc rg-sudo)"
[ "$(rc rg-none)" = 1 ] && has rg-none "no registration token" && ! grep -q '^config\.sh' "$T/rg-none.calls" && pass "register --apply refuses with no token" || fail "register no token: rc $(rc rg-none)"

# --- verify -----------------------------------------------------------------------------------------------------
vcase() {  # vcase <name> <want rc> <want text> <env...>
  local name="$1" want="$2" text="$3"; shift 3
  run "v-$name" "$H" FX_CI_EXISTS=1 "$@" -- verify
  [ "$(rc "v-$name")" = "$want" ] && has "v-$name" "$text" && pass "verify: $name" || fail "verify $name: rc $(rc "v-$name"): $(grep -E 'REFUSE|clear' "$T/v-$name.out" | head -2)"
}
vcase clear 0 "verify: clear"
vcase labels 1 "labels are arm64,macos,self-hosted" "FX_RUNNER_ROW=online false arm64,macos,self-hosted"
vcase offline 1 "kosmos-ci-agent1s is offline" "FX_RUNNER_ROW=offline false arm64,kosmos-ci,macos,self-hosted"
vcase missing 1 "no runner named kosmos-ci-agent1s" FX_RUNNER_ROW=
vcase switchoff 1 "KOSMOS_CI_RUNNER is 'off'" FX_RUNNER_VAR=off
vcase shards 1 "KOSMOS_CI_SHELL_SHARDS is '2/2'" FX_SHARDS=2/2
vcase leftover 1 "kosmos-ci still runs" "FX_PS=/opt/homebrew/bin/tmux"
vcase leftover-busy 0 "verify: clear" "FX_PS=node" "FX_RUNNER_ROW=online true arm64,kosmos-ci,macos,self-hosted"
vcase raced 1 "went busy or idle during verify" FX_BUSY2=true
vcase psfail 1 "kosmos-ci runs no processes" FX_PS_FAIL=1
run v-nouser "$H" -- verify
[ "$(rc v-nouser)" = 1 ] && has v-nouser "no user kosmos-ci on this Mac" && pass "verify: no CI user here is a problem, not a clean 'nothing left'" || fail "verify no user: rc $(rc v-nouser)"
for n in v-clear v-leftover; do if out="$(changed "$n")"; then fail "verify $n changed something: $out"; fi; done

if [ "$fails" -gt 0 ]; then echo "test-ci-runner-setup-4601: $fails failure(s)"; exit 1; fi
echo "test-ci-runner-setup-4601: all passed"
