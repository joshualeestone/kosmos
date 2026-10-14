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
T="$(mktemp -d)" || exit 1; [ -d "$T" ] || exit 1; trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT   # chmod: some cases make dirs 000
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
  launchctl)   # `launchctl print gui/<uid>`, in the shape measured on Agent1s 2026-10-14
    [ "${FX_LAUNCHCTL_FAIL:-0}" = 1 ] && exit 1
    [ "$1" = managername ] && { echo "${FX_MANAGER:-Aqua}"; exit 0; }
    [ "$1" = manageruid ] && { echo "${FX_MANAGERUID:-777}"; exit 0; }
    [ "$1 ${2%%/*}" = "print gui" ] || exit 1
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
    case "$*" in *Runner.Listener*) [ "${FX_LISTENER:-1}" = 1 ] && [ "$(cat .svc-state 2>/dev/null)" = started ] || exit 1; cat .svc-pid 2>/dev/null || echo 4343; exit 0 ;; esac
    case "$*" in *Runner.Worker*) [ "${FX_WORKER:-0}" = 1 ] || exit 1; echo 4242; exit 0 ;; esac
    [ -z "${FX_LIVE:-}" ] && exit 1; printf '%s\n' "$FX_LIVE" ;;
  df) [ "${FX_DF_NOROW:-0}" = 1 ] && { echo "Filesystem 1024-blocks Used Available Capacity Mounted"; exit 0; }
    printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk3s1 239362496 1 %s 50%% /\n' "${FX_FREE_KIB-31457280}" ;;
  fdesetup) echo "${FX_FV:-FileVault is Off.}" ;;
  pmset) printf 'System-wide power settings:\nCurrently in use:\n standby              0\n sleep                %s\n autorestart          %s\n displaysleep         10\n' "${FX_SLEEP:-0}" "${FX_AUTORESTART:-1}" ;;
  id)
    case "$1" in
      -un) echo "${FX_WHO:-agent1}" ;;
      -Gn) [ "${FX_GROUPS_FAIL:-0}" = 1 ] && exit 1; echo "${FX_GROUPS:-staff everyone}" ;;
      -u) echo 777 ;;
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
  config.sh) printf 'token-in-env=%s\n' "${ACTIONS_RUNNER_INPUT_TOKEN:-}" >> "$CALL_LOG"
    echo "/login/shell/path:/usr/bin" > "$(dirname "$0")/.path" ;;   # as actions/runner env.sh does
  svc.sh)
    st="$(dirname "$0")/.svc-state"
    case "$1" in
      status) if [ "${FX_SVC_STUCK:-0}" = 1 ] || [ "$(cat "$st" 2>/dev/null)" = started ]; then echo "Started"; else echo "Stopped"; fi ;;
      stop) echo stopped > "$st" ;;
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
  : > "$LOG"; rm -f "$T/user-created"
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
  jq_prog() { bash "$S" jq-programs | sed -n "${1}p"; }
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
run cu-note "$H" FX_WHO=someone -- create-user
[ "$(grep -c 'runs as agent1' "$T/cu-note.out")" = 1 ] && pass "create-user dry run by another user says who it runs as once" || fail "create-user note count: $(grep -c 'runs as agent1' "$T/cu-note.out")"
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
HK="$T/hookcheck"; mkdir -p "$HK"; cp "$CH/.kosmos-ci/job-started.sh" "$HK/"
printf '#!/bin/bash\n: > "$(dirname "$0")/cleanup-ran"\n' > "$HK/job-cleanup.sh"
printf '#!/bin/bash\nexit 1\n' > "$HK/job-guard.sh"; chmod 755 "$HK/"*
[ -x "$HK/job-started.sh" ] || fail "install --apply wrote no job-started.sh to test"
"$HK/job-started.sh" >/dev/null 2>&1; hrc=$?
[ -x "$HK/job-started.sh" ] && [ "$hrc" != 0 ] && [ ! -e "$HK/cleanup-ran" ] && pass "job-started stops on a guard refusal, before cleanup" || fail "job-started with a refusing guard: rc $hrc, cleanup ran: $([ -e "$HK/cleanup-ran" ] && echo yes || echo no)"
printf '#!/bin/bash\nexit 0\n' > "$HK/job-guard.sh"
"$HK/job-started.sh" >/dev/null 2>&1; hrc=$?
[ "$hrc" = 0 ] && [ -e "$HK/cleanup-ran" ] && pass "job-started runs cleanup once the guard admits the job" || fail "job-started with an admitting guard: rc $hrc"

# job-completed empties the job's temp only when RUNNER_TEMP is that dir: run it against a sandbox runner layout.
HC="$T/hookdone"; mkdir -p "$HC/.kosmos-ci" "$HC/actions-runner/_work/_temp"; cp "$CH/.kosmos-ci/job-completed.sh" "$HC/.kosmos-ci/"
printf '#!/bin/bash\n: > "$(dirname "$0")/cleanup-ran"\n' > "$HC/.kosmos-ci/job-cleanup.sh"; chmod 755 "$HC/.kosmos-ci/"*
TMPD_REAL="$(cd "$HC/actions-runner/_work/_temp" && pwd -P)"
: > "$HC/actions-runner/_work/_temp/payload"; : > "$HC/actions-runner/_work/keep"
RUNNER_TEMP="/somewhere/else" "$HC/.kosmos-ci/job-completed.sh"
[ -e "$HC/actions-runner/_work/_temp/payload" ] && [ -e "$HC/.kosmos-ci/cleanup-ran" ] && pass "job-completed runs cleanup and leaves the temp alone when RUNNER_TEMP is elsewhere" || fail "job-completed with a foreign RUNNER_TEMP"
: > "$HC/actions-runner/_work/_temp/.hidden"
RUNNER_TEMP="$TMPD_REAL" "$HC/.kosmos-ci/job-completed.sh"
[ ! -e "$HC/actions-runner/_work/_temp/payload" ] && [ ! -e "$HC/actions-runner/_work/_temp/.hidden" ] && [ -d "$HC/actions-runner/_work/_temp" ] && [ -e "$HC/actions-runner/_work/keep" ] \
  && pass "job-completed empties exactly the job's temp when RUNNER_TEMP is it" || fail "job-completed with the matching RUNNER_TEMP: $(ls -a "$HC/actions-runner/_work/_temp" "$HC/actions-runner/_work" | tr '\n' ' ')"

# A running runner: stopped, unpacked over, started again. A job in flight, or a stop that does not take, refuses.
svc_home() {   # an installed runner: svc.sh, its .service marker, and (as the new package would bring) bin/runsvc.sh
  mkdir -p "$1/actions-runner/bin"; cp "$BIN/_stub" "$1/actions-runner/svc.sh"; chmod +x "$1/actions-runner/svc.sh"
  echo started > "$1/actions-runner/.svc-state"; echo "actions.runner.x" > "$1/actions-runner/.service"
  echo "# runsvc old" > "$1/actions-runner/runsvc.sh"; echo "# runsvc new" > "$1/actions-runner/bin/runsvc.sh"
}
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
run in-stuck "$R3" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R3" FX_SVC_STUCK=1 -- --apply install "$C" "$G"
[ "$(rc in-stuck)" = 1 ] && has in-stuck "did not stop" && ! grep -q '^tar ' "$T/in-stuck.calls" \
  && pass "install --apply refuses to unpack when the runner did not stop" || fail "install stuck stop: rc $(rc in-stuck)"
R5="$T/run5"; svc_home "$R5"
run in-tarfail "$R5" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$R5" FX_TAR_FAIL=1 -- --apply install "$C" "$G"
[ "$(rc in-tarfail)" != 0 ] && grep -q '^svc.sh stop' "$T/in-tarfail.calls" && grep -q '^svc.sh start' "$T/in-tarfail.calls" \
  && pass "install --apply starts the runner again when it fails after stopping it" || fail "install fail after stop: rc $(rc in-tarfail), calls: $(grep svc "$T/in-tarfail.calls" | tr '\n' ' ')"
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
echo stopped > "$CH/actions-runner/.svc-state"
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
rm -f "$CH/actions-runner/.service"   # rg-apply registered it; this case is about the token
run rg-none "$CH" FX_WHO=kosmos-ci KOSMOS_CI_HOME="$CH" -- --apply register
[ "$(rc rg-none)" = 1 ] && has rg-none "no registration token" && ! grep -q '^config\.sh' "$T/rg-none.calls" && pass "register --apply refuses with no token" || fail "register no token: rc $(rc rg-none)"

# --- verify -----------------------------------------------------------------------------------------------------
VCI="$T/vci"; mkdir -p "$VCI/actions-runner" "$VCI/.kosmos-ci"
printf 'LANG=en_US.UTF-8\nACTIONS_RUNNER_HOOK_JOB_STARTED=%s\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' "$VCI/.kosmos-ci/job-started.sh" "$VCI/.kosmos-ci/job-completed.sh" > "$VCI/actions-runner/.env"
for f in job-guard.sh job-started.sh job-completed.sh job-cleanup.sh; do printf '#!/bin/bash\n' > "$VCI/.kosmos-ci/$f"; chmod 755 "$VCI/.kosmos-ci/$f"; done
vcase() {  # vcase <name> <want rc> <want text> <env...>
  local name="$1" want="$2" text="$3"; shift 3
  run "v-$name" "$H" FX_CI_EXISTS=1 KOSMOS_CI_HOME="$VCI" "$@" -- verify
  [ "$(rc "v-$name")" = "$want" ] && has "v-$name" "$text" && pass "verify: $name" || fail "verify $name: rc $(rc "v-$name"): $(grep -E 'REFUSE|clear' "$T/v-$name.out" | head -2)"
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
GS="$(shasum -a 256 "$VCI/.kosmos-ci/job-guard.sh" | cut -d' ' -f1)"
vcase guard-pin 0 "job guard sha256 is the install pin" KOSMOS_CI_GUARD_SHA="$GS"
vcase guard-drift 1 "something rewrote it" KOSMOS_CI_GUARD_SHA=0000000000000000000000000000000000000000000000000000000000000000
vcase psfail 1 "kosmos-ci runs no processes" FX_PS_FAIL=1
grep -q 'no tmux or node left' "$T/v-clear.out" && pass "verify: an idle runner's own node (RunnerService.js) is not a leftover" || fail "verify idle runner: $(grep -E 'REFUSE|ok' "$T/v-clear.out" | tail -2)"
cp "$VCI/actions-runner/.env" "$T/vci.env"
grep -v HOOK_JOB_STARTED "$T/vci.env" > "$VCI/actions-runner/.env"
vcase unwired 1 "the job guard is not wired"
{ cat "$T/vci.env"; echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/tmp/elsewhere.sh"; } > "$VCI/actions-runner/.env"
vcase hook-twice 1 "sets ACTIONS_RUNNER_HOOK_JOB_STARTED more than once"
cp "$T/vci.env" "$VCI/actions-runner/.env"; chmod 000 "$VCI/actions-runner"
vcase home-hidden 3 "check(s) could not be made"
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

if [ "$fails" -gt 0 ]; then echo "test-ci-runner-setup-4601: $fails failure(s)"; exit 1; fi
echo "test-ci-runner-setup-4601: all passed"
