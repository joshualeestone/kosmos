#!/usr/bin/env bash
# #4601: turn a fleet Mac (Agent1s, once the agents have moved to the new Mac) into the self-hosted CI runner, as the
# runbook on #5488 (comment 6154688503, part 2) says. Baron's ci-mini-setup.sh (#5488 part b) generalised: the same
# install, plus the checks and the user the runbook adds.
#
# 🛑 DRY RUN IS THE DEFAULT. Nothing changes unless --apply is given: a change either goes through act(), which
# otherwise prints "WOULD: <command>", or sits after a stage's own dry-run return (install, register).
# Reads (pgrep, df, gh api GETs) always run.
#
# Usage: tools/ci-runner-setup.sh [--apply] <stage> [args]
#   preflight                 as the machine owner. Reads only. Refuses unless the agents have left this Mac
#                             (runbook part 3, step 0), and checks disk, FileVault, sleep, power restore, tmux,
#                             pwsh, the CI user. KOSMOS_CI_ALLOW_JOBS (an ERE) lets named launchd jobs stay
#   create-user               as the machine owner (an admin). Runs preflight first. A STANDARD user kosmos-ci
#   install <commit> <sha256> as kosmos-ci. The runner, the hooks and the job guard from THAT main commit
#   register                  as kosmos-ci, in its Screen Sharing session (svc.sh needs the GUI session, not ssh).
#                             Reads the registration token from stdin, so it is never in any argv
#   verify                    as the machine owner. Reads only. The runner is online with exactly its labels
#   machine-settings          prints the settings that need an admin in System Settings
#
# The one-suite-per-Mac lock (#4574) needs nothing new here, only nothing switched OFF: a CI job runs
# tools/run-tests.sh, whose name arm is `pgrep -fl` with no -u (tools/lib/cut-guard.sh), so it sees a suite of ANY
# user on this Mac and waits. The run markers are per-HOME and do not cross users; the name arm does. So the
# runner's .env must never set a KOSMOS_ variable (KOSMOS_TESTS_IGNORE_SUITE, KOSMOS_NO_WAIT and the other wait
# controls would turn the lock off for every job), and install refuses one.
# The runner package is the latest actions/runner release, checked against the sha256 that same release publishes:
# that catches a damaged download, not a compromised release (trust on first fetch, as Baron's script had it).
# The job guard is pinned harder, by a main commit and a sha256 the operator supplies.
# KOSMOS_CI_RUNNER (the kill switch) is READ here, never written. KOSMOS_CI_SHELL_SHARDS must stay unset (#4601:
# one runner cannot carry a shell shard), and preflight and verify refuse when it is set.
set -euo pipefail

APPLY=0
if [ "${1:-}" = --apply ]; then APPLY=1; shift; fi
for a in "$@"; do
  [ "$a" != --apply ] || { echo "refused: --apply goes first (tools/ci-runner-setup.sh --apply <stage> ...); nothing ran" >&2; exit 2; }
done
STAGE="${1:-}"
REPO="joshualeestone/kosmos"
REPO_URL="https://github.com/$REPO"
CI_USER="${KOSMOS_CI_USER:-kosmos-ci}"
CI_HOME="${KOSMOS_CI_HOME:-/Users/$CI_USER}"
OWNER="${KOSMOS_CI_OWNER:-agent1}"
NAME="${KOSMOS_CI_RUNNER_NAME:-kosmos-ci-agent1s}"
LABELS="self-hosted,macOS,arm64,kosmos-ci"
BREW="${KOSMOS_CI_BREW:-/opt/homebrew}"            # the engine's fixed tmux fallback is /opt/homebrew/bin/tmux
MIN_FREE_GIB="${KOSMOS_CI_MIN_FREE_GIB:-20}"       # the fleet's disk floor
ALLOW_JOBS="${KOSMOS_CI_ALLOW_JOBS:-}"             # an ERE of non-Apple launchd labels that may stay loaded
RUNNER_DIR="$HOME/actions-runner"
CI_DIR="$HOME/.kosmos-ci"

say() { printf '== %s\n' "$*"; }
# act <command...>: runs it with --apply, else prints it.
act() {
  if [ "$APPLY" = 1 ]; then "$@"; else printf 'WOULD:'; printf ' %q' "$@"; printf '\n'; fi
}
# act_write <path> <mode>: stdin becomes the file, or is described.
act_write() {
  if [ "$APPLY" = 1 ]; then cat > "$1"; chmod "$2" "$1"; else printf 'WOULD: write %s (mode %s):\n' "$1" "$2"; sed 's/^/    | /'; fi
}
mode_line() { if [ "$APPLY" = 1 ]; then say "APPLYING $STAGE"; else say "DRY RUN of $STAGE (nothing changes; --apply to do it)"; fi; }
need_user() {
  if [ "$(id -un)" = "$1" ]; then
    # sudo keeps HOME on macOS, so `sudo -u kosmos-ci` would aim RUNNER_DIR at the caller's home.
    if [ "$APPLY" = 1 ] && [ "$1" = "$CI_USER" ] && [ "$HOME" != "$CI_HOME" ]; then
      echo "refused: HOME is $HOME, not $CI_HOME (log in as $CI_USER rather than sudo -u)" >&2; exit 2
    fi
    return 0
  fi
  if [ "$APPLY" = 1 ]; then echo "refused: $STAGE runs as $1, not $(id -un)" >&2; exit 2; fi
  echo "note: $STAGE runs as $1 (this is $(id -un)); a dry run only prints"
}

# is_admin <user>: groups read whole first, never piped into an early-exiting grep under pipefail.
is_admin() { local g; g="$(id -Gn "$1")" || return 1; case " $g " in *" admin "*) return 0 ;; *) return 1 ;; esac; }

PROBLEMS=0
problem() { printf 'REFUSE: %s\n' "$*"; PROBLEMS=$((PROBLEMS + 1)); }
ok() { printf 'ok:     %s\n' "$*"; }

# repo_variable <name>: prints its value, "<unset>", or fails when it cannot tell.
repo_variable() {
  local out
  out="$(gh variable list --repo "$REPO" --json name,value --jq ".[] | select(.name == \"$1\") | .value")" || return 1
  if [ -n "$out" ]; then printf '%s' "$out"; else printf '<unset>'; fi
}

preflight() {
  need_user "$OWNER"
  say "runbook part 3, step 0: the agents have left this Mac"
  # Explicit status checks throughout: create-user calls preflight inside `||`, where set -e is off, and a failed
  # read must refuse there too rather than read as empty.
  # application.* labels are the owner's open GUI apps (Terminal among them), not jobs.
  local jobs raw
  if ! raw="$(launchctl list)"; then problem "could not read launchctl list"; raw=""; fi
  jobs="$(printf '%s\n' "$raw" | awk 'NR > 1 && $3 !~ /^com\.apple\./ && $3 !~ /^application\./ { print $3 }')"
  [ -z "$ALLOW_JOBS" ] || jobs="$(printf '%s\n' "$jobs" | grep -v -E "$ALLOW_JOBS" || true)"
  if [ -n "$jobs" ]; then
    problem "$(printf '%s\n' "$jobs" | grep -c .) non-Apple launchd job(s) still loaded for $(id -un) (bootout + disable each, runbook part 3 step 0): $(printf '%s\n' "$jobs" | head -5 | tr '\n' ' ')(KOSMOS_CI_ALLOW_JOBS=<ERE> keeps one deliberately)"
  else ok "no non-Apple launchd jobs loaded"; fi
  # crontab -l fails when there is no crontab at all, which is the clear case.
  local cron
  cron="$(crontab -l 2>/dev/null || true)"
  if [ -n "$(printf '%s\n' "$cron" | grep -v -E '^[[:space:]]*(#|$)' || true)" ]; then problem "crontab still has lines (crontab -r, runbook part 3 step 0)"
  else ok "crontab empty"; fi
  local live
  live="$(pgrep -fl 'run-tests\.sh|queued-heavy\.sh' || true)"
  if [ -n "$live" ]; then problem "a suite is live on this Mac (any user): $(printf '%s\n' "$live" | head -3 | tr '\n' ' ')"
  else ok "no suite live (any user)"; fi

  say "the machine"
  local free_kib
  free_kib="$(df -k / | awk 'NR == 2 { print $4 }')"
  if [ "$((free_kib / 1048576))" -lt "$MIN_FREE_GIB" ]; then problem "$((free_kib / 1048576)) GiB free, under the ${MIN_FREE_GIB} GiB floor"
  else ok "$((free_kib / 1048576)) GiB free"; fi
  case "$(fdesetup status 2>&1)" in
    *"FileVault is Off"*) ok "FileVault off (auto-login is possible)" ;;
    *) problem "FileVault is not off: auto-login, which the runner's LaunchAgent needs after a restart, is impossible" ;;
  esac
  local pm
  pm="$(pmset -g 2>&1 || true)"
  if printf '%s\n' "$pm" | grep -E '^[[:space:]]*sleep[[:space:]]+0([[:space:]]|$)' >/dev/null; then ok "system sleep never"
  else problem "system sleep is not 'never' (pmset -g): the runner goes offline when the Mac sleeps"; fi
  if printf '%s\n' "$pm" | grep -E '^[[:space:]]*autorestart[[:space:]]+1([[:space:]]|$)' >/dev/null; then ok "starts up after a power failure"
  else problem "autorestart is not 1 (pmset -g): after a power cut the runner stays off (System Settings, Energy)"; fi

  say "tools the runner's PATH reaches ($BREW/bin)"
  local tv
  if [ -x "$BREW/bin/tmux" ]; then
    tv="$("$BREW/bin/tmux" -V 2>&1 || true)"
    case "$tv" in   # a literal match: 3.5a is the one version #2955's test refuses
      "tmux 3.5a") problem "$BREW/bin/tmux is 3.5a, which #2955's test refuses (build one: baron-jobs/ci-mini-build-tmux.sh)" ;;
      *) ok "$BREW/bin/tmux ($tv)" ;;
    esac
  else problem "no $BREW/bin/tmux (the engine's fixed fallback; build one: baron-jobs/ci-mini-build-tmux.sh)"; fi
  if [ -x "$BREW/bin/pwsh" ]; then ok "$BREW/bin/pwsh"
  else problem "no $BREW/bin/pwsh (install one: baron-jobs/ci-mini-install-pwsh.sh)"; fi

  say "the CI user"
  if id "$CI_USER" >/dev/null 2>&1; then
    if is_admin "$CI_USER"; then problem "$CI_USER is an admin; it must be a standard user"
    else ok "$CI_USER exists, standard user"; fi
  else ok "$CI_USER does not exist yet (create-user makes it)"; fi

  say "repo variables"
  local v
  if v="$(repo_variable KOSMOS_CI_SHELL_SHARDS)"; then
    if [ "$v" = "<unset>" ]; then ok "KOSMOS_CI_SHELL_SHARDS unset"
    else problem "KOSMOS_CI_SHELL_SHARDS is '$v': one runner cannot carry a shell shard (#4601); unset it first"; fi
  else problem "could not read the repo variables (gh): cannot rule out KOSMOS_CI_SHELL_SHARDS"; fi
  if v="$(repo_variable KOSMOS_CI_RUNNER)"; then ok "KOSMOS_CI_RUNNER is $v (read only; the runbook keeps it on)"; fi

  if [ "$PROBLEMS" -gt 0 ]; then say "preflight: $PROBLEMS refusal(s)"; return 1; fi
  say "preflight: clear"
}

create_user() {
  need_user "$OWNER"
  if id "$CI_USER" >/dev/null 2>&1; then echo "refused: $CI_USER already exists (preflight says whether it is standard)" >&2; exit 1; fi
  preflight || { echo "refused: preflight did not pass, nothing created" >&2; exit 1; }
  mode_line
  # A STANDARD user: no -admin. `-password -` prompts, so the password is never in an argv or this log.
  act sudo sysadminctl -addUser "$CI_USER" -fullName "Kosmos CI" -shell /bin/zsh -home "$CI_HOME" -password -
  if [ "$APPLY" = 1 ] && is_admin "$CI_USER"; then
    echo "STOP: $CI_USER came out an admin; remove it (sudo sysadminctl -deleteUser $CI_USER) and report" >&2; exit 1
  fi
  machine_settings
}

install_runner() {
  local commit="${2:-}" want="${3:-}"
  [ -n "$commit" ] && [ -n "$want" ] || { echo "install needs <main commit> <sha256 of tools/ci-runner-job-guard.sh there>" >&2; exit 2; }
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "the commit must be a full 40-character sha" >&2; exit 2; }
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "the guard sha256 must be 64 hex characters" >&2; exit 2; }
  need_user "$CI_USER"
  mode_line
  # Reads first, in both modes: the guard's commit must be ON main (raw.githubusercontent.com serves commits from any
  # fork in the network). compare/<commit>...main: "ahead" = main contains it, "identical" = it is main's tip.
  local st
  st="$(curl -fsSL "https://api.github.com/repos/$REPO/compare/$commit...main" | sed -n 's/^  "status": "\([a-z]*\)".*/\1/p' | head -1 || true)"
  case "$st" in ahead|identical) ok "$commit is on main ($st)" ;; *) echo "refused: commit $commit is not on main (compare status '${st:-unknown}'), nothing changed" >&2; exit 1 ;; esac
  if [ -f "$RUNNER_DIR/.env" ] && grep -q -E '^KOSMOS_' "$RUNNER_DIR/.env"; then
    echo "refused: $RUNNER_DIR/.env sets a KOSMOS_ variable ($(grep -E '^KOSMOS_' "$RUNNER_DIR/.env" | cut -d= -f1 | tr '\n' ' ')); a wait control there turns the suite lock off for every job. Remove it first." >&2
    exit 1
  fi
  if [ "$APPLY" != 1 ]; then
    echo "WOULD: fetch tools/ci-runner-job-guard.sh at $commit and refuse unless its sha256 is $want"
    echo "WOULD: fetch the latest actions/runner osx-arm64 package and refuse unless its sha256 is the published one"
    echo "WOULD: stop the runner if it is running, unpack into $RUNNER_DIR, install the guard as $CI_DIR/job-guard.sh"
    echo "WOULD: write $CI_DIR/job-cleanup.sh, job-completed.sh, job-started.sh (Baron's #5488 hooks, unchanged)"
    echo "WOULD: merge into $RUNNER_DIR/.env: ACTIONS_RUNNER_HOOK_JOB_STARTED, ACTIONS_RUNNER_HOOK_JOB_COMPLETED, LANG, PATH (no KOSMOS_ key)"
    return 0
  fi
  mkdir -p "$RUNNER_DIR" "$CI_DIR"; cd "$RUNNER_DIR"
  # Every download and check before the runner is touched, so a failure never leaves it stopped.
  local newg="$CI_DIR/job-guard.sh.new" got rel ver tgz pub have was_running=0 sv
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$commit/tools/ci-runner-job-guard.sh" -o "$newg" \
    || { rm -f "$newg"; echo "could not fetch the job guard at $commit: nothing changed" >&2; exit 1; }
  got="$(shasum -a 256 "$newg" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { rm -f "$newg"; echo "guard sha256 $got is not $want: refused, nothing changed" >&2; exit 1; }
  rel="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest || true)"
  ver="$(printf '%s' "$rel" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1 || true)"
  [ -n "$ver" ] || { rm -f "$newg"; echo "could not read the runner version: nothing changed" >&2; exit 1; }
  tgz="actions-runner-osx-arm64-$ver.tar.gz"
  [ -f "$tgz" ] || curl -fsSLO "https://github.com/actions/runner/releases/download/v$ver/$tgz" || { rm -f "$newg"; echo "could not fetch $tgz: nothing changed" >&2; exit 1; }
  pub="$(printf '%s' "$rel" | grep -o 'BEGIN SHA osx-arm64 -->[0-9a-f]*' | head -1 | sed 's/.*-->//' || true)"
  have="$(shasum -a 256 "$tgz" | cut -d' ' -f1)"
  [ -n "$pub" ] && [ "$pub" = "$have" ] || { rm -f "$tgz" "$newg"; echo "runner package sha256 $have is not the published '${pub:-none}': refused, nothing changed" >&2; exit 1; }
  # A Runner.Worker of this user is a job in flight: stopping the runner now would kill it.
  if pgrep -u "$(id -u)" -x Runner.Worker >/dev/null; then
    rm -f "$newg"; echo "refused: a job is running on this runner; install again when it is idle. Nothing changed" >&2; exit 1
  fi
  if [ -x ./svc.sh ]; then
    sv="$(./svc.sh status 2>&1 || true)"
    case "$sv" in *Started*) was_running=1; ./svc.sh stop >/dev/null 2>&1 || true ;; esac
    if [ "$was_running" = 1 ]; then
      case "$(./svc.sh status 2>&1 || true)" in
        *Started*) rm -f "$newg"; echo "refused: the runner did not stop; nothing unpacked" >&2; exit 1 ;;
      esac
    fi
  fi
  tar xzf "$tgz"
  chmod +x "$newg" && mv -f "$newg" "$CI_DIR/job-guard.sh"
  echo "runner $ver unpacked in $RUNNER_DIR; job guard installed from $commit, sha256 $got"
  # Job hooks. NOT a fresh VM: the checkout and ~ persist between jobs. They end what a previous job left running,
  # and only THIS user's: the agents' processes (another user) are never touched.
  act_write "$CI_DIR/job-cleanup.sh" 755 <<'HOOK'
#!/usr/bin/env bash
# Ends what a job left running. kosmos-ci is a DEDICATED user and no step runs while a hook does, so every tmux
# server and node process of this user is a leftover. The runner itself is not node.
pkill -u "$(id -u)" -x tmux 2>/dev/null || true
pkill -u "$(id -u)" -x node 2>/dev/null || true
HOOK
  act_write "$CI_DIR/job-completed.sh" 755 <<'HOOK'
#!/bin/bash
# Located by its own path: the hooks live beside each other. The job's temp is emptied AFTER a job only.
D="$(cd "$(/usr/bin/dirname "$0")" && pwd -P)" || exit 1
"$D/job-cleanup.sh"
TMPD="$(cd "$D/../actions-runner/_work/_temp" 2>/dev/null && pwd -P)" || exit 0
case "${RUNNER_TEMP:-}" in "$TMPD") rm -rf "${TMPD:?}"/* 2>/dev/null || true ;; esac
HOOK
  act_write "$CI_DIR/job-started.sh" 755 <<'HOOK'
#!/bin/bash
# Guard first: a refused job fails here, before cleanup and before any of its steps.
D="$(cd "$(/usr/bin/dirname "$0")" && pwd -P)" || exit 1
"$D/job-guard.sh" || exit 1
exec "$D/job-cleanup.sh"
HOOK
  # MERGE into .env (config.sh writes keys there): replace only the keys this sets.
  touch "$RUNNER_DIR/.env"
  # grep exits 1 when no line is left (fine) and 2 when it could not read .env, which must not drop config.sh's keys.
  if grep -v -E '^(ACTIONS_RUNNER_HOOK_JOB_STARTED|ACTIONS_RUNNER_HOOK_JOB_COMPLETED|PATH|LANG)=' "$RUNNER_DIR/.env" > "$RUNNER_DIR/.env.new"; then :
  else [ $? = 1 ] || { rm -f "$RUNNER_DIR/.env.new"; echo "could not read $RUNNER_DIR/.env; it is unchanged" >&2; exit 1; }; fi
  { echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=$CI_DIR/job-started.sh"
    echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$CI_DIR/job-completed.sh"
    echo "LANG=en_US.UTF-8"   # launchd gives none; the tmux tests need it
    echo "PATH=/usr/bin:/bin:/usr/sbin:/sbin:$BREW/bin:/usr/local/bin:$HOME/.local/bin"; } >> "$RUNNER_DIR/.env.new"
  mv -f "$RUNNER_DIR/.env.new" "$RUNNER_DIR/.env"
  echo "hooks and .env written (merged)"
  if [ "$was_running" = 1 ]; then ./svc.sh start && echo "runner started again"; fi
}

register() {
  need_user "$CI_USER"
  mode_line
  if [ "$APPLY" != 1 ]; then
    echo "WOULD: read a registration token from stdin (mint it as $OWNER: gh api -X POST repos/$REPO/actions/runners/registration-token --jq .token)"
    printf 'WOULD: ACTIONS_RUNNER_INPUT_TOKEN=<token>'; printf ' %q' ./config.sh --unattended --url "$REPO_URL" --name "$NAME" --labels "$LABELS" --work _work --replace; printf '\n'
    printf 'WOULD: %q install\nWOULD: %q start\n' ./svc.sh ./svc.sh
    return 0
  fi
  cd "$RUNNER_DIR"
  local token=""
  if [ -t 0 ]; then printf 'registration token: ' >&2; IFS= read -r -s token; echo >&2; else IFS= read -r token || true; fi
  [ -n "$token" ] || { echo "refused: no registration token on stdin" >&2; exit 1; }
  # The runner reads ACTIONS_RUNNER_INPUT_<ARG> for a config argument it is not given, so the token stays out of argv.
  ACTIONS_RUNNER_INPUT_TOKEN="$token" ./config.sh --unattended --url "$REPO_URL" --name "$NAME" --labels "$LABELS" --work _work --replace
  ./svc.sh install   # a LaunchAgent for this user (starts at login)
  ./svc.sh start
  ./svc.sh status
}

# runner_busy: true, false, or "unknown" when the API could not say.
runner_busy() {
  gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$NAME\") | .busy" 2>/dev/null || echo unknown
}

verify() {
  need_user "$OWNER"
  say "the runner, from the API"
  local row
  row="$(gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$NAME\") | \"\(.status) \(.busy) \([.labels[].name | ascii_downcase] | sort | join(\",\"))\"")" \
    || { problem "could not read the runners API"; row=""; }
  local want_labels
  want_labels="$(printf '%s\n' "$LABELS" | tr ',' '\n' | tr '[:upper:]' '[:lower:]' | sort | paste -sd, -)"
  local busy=false
  if [ -z "$row" ]; then problem "no runner named $NAME"
  else
    set -- $row
    busy="$2"
    [ "$1" = online ] && ok "$NAME online (busy=$2)" || problem "$NAME is $1"
    [ "$3" = "$want_labels" ] && ok "labels exactly $want_labels" || problem "labels are $3, not $want_labels"
  fi
  say "repo variables"
  local v
  if v="$(repo_variable KOSMOS_CI_RUNNER)"; then
    [ "$v" = on ] && ok "KOSMOS_CI_RUNNER on" || problem "KOSMOS_CI_RUNNER is '$v': jobs do not route to the runner"
  else problem "could not read KOSMOS_CI_RUNNER"; fi
  if v="$(repo_variable KOSMOS_CI_SHELL_SHARDS)"; then
    [ "$v" = "<unset>" ] && ok "KOSMOS_CI_SHELL_SHARDS unset" || problem "KOSMOS_CI_SHELL_SHARDS is '$v' (#4601: unset it)"
  else problem "could not read KOSMOS_CI_SHELL_SHARDS"; fi
  say "what a job left behind (between jobs, $CI_USER should run no tmux or node)"
  local left
  # ps reads THIS Mac only, and an unknown user makes it fail with no lines, which must not read as "nothing left".
  if ! id "$CI_USER" >/dev/null 2>&1; then problem "no user $CI_USER on this Mac: run verify on the runner's own Mac"
  # macOS ps -U exits 1 for a user with no processes, which here means the user is not logged in.
  elif ! left="$(ps -U "$CI_USER" -o comm=)"; then problem "$CI_USER runs no processes (not logged in? the runner needs auto-login), or ps failed"
  # The busy flag was read before ps: read it again, and a job that started or ended in between is a rerun.
  elif [ -n "$row" ] && [ "$(runner_busy)" != "$busy" ]; then problem "the runner went busy or idle during verify; run verify again"
  elif left="$(printf '%s\n' "$left" | awk -F/ '{ print $NF }' | grep -x -E 'tmux|node' || true)"; [ -n "$left" ] && [ "$busy" != true ]; then problem "$CI_USER still runs: $(printf '%s\n' "$left" | sort | uniq -c | tr -s ' ' | tr '\n' ' ')(fine only while a job runs)"
  else ok "no tmux or node left under $CI_USER"; fi
  if [ "$PROBLEMS" -gt 0 ]; then say "verify: $PROBLEMS problem(s)"; return 1; fi
  say "verify: clear"
}

machine_settings() {
  cat <<EOF
# Settings that need an admin, in System Settings (printed, never run):
#  1. Users & Groups: automatic login as $CI_USER. The runner is a LaunchAgent of $CI_USER, so after a restart it is
#     offline until $CI_USER is logged in. Needs FileVault off (preflight checks it).
#  2. Energy: keep "prevent automatic sleeping" and "start up after a power failure" (preflight checks sleep).
EOF
}

case "$STAGE" in
  preflight) preflight ;;
  create-user) create_user ;;
  install) install_runner "$@" ;;
  register) register ;;
  verify) verify ;;
  machine-settings) machine_settings ;;
  *) echo "usage: tools/ci-runner-setup.sh [--apply] preflight | create-user | install <commit> <sha256> | register | verify | machine-settings" >&2; exit 2 ;;
esac
