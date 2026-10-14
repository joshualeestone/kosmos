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
#   preflight                 as the machine owner. Reads only. Refuses while the agents' launchd jobs, crontab
#                             or a suite are live (runbook part 3, step 0), and checks disk, FileVault, sleep,
#                             power restore, tmux, pwsh, the CI user. KOSMOS_CI_ALLOW_JOBS (an ERE) lets named
#                             launchd jobs stay
#   create-user               as the machine owner (an admin). Runs preflight first. A STANDARD user kosmos-ci
#   install <commit> <sha256> as kosmos-ci, in its Screen Sharing session (svc.sh, which stops and starts the
#                             runner, needs the GUI session, not ssh). The runner, the hooks and the job guard
#                             from THAT main commit
#   register                  as kosmos-ci, in its Screen Sharing session, for the same reason. Reads the
#                             registration token from stdin, so it is never in any argv
#   verify                    as the machine owner. Reads only. The runner is online with exactly its labels
#   machine-settings          prints the settings that need an admin in System Settings
#
# The one-suite-per-Mac lock (#4574) needs nothing new here, only nothing switched OFF: a CI job runs
# tools/run-tests.sh, whose name arm is `pgrep -fl` with no -u (tools/lib/cut-guard.sh), so it sees a suite of ANY
# user on this Mac and waits. The run markers are per-HOME and do not cross users; the name arm does. So the
# runner's .env must never set a KOSMOS_ variable (KOSMOS_TESTS_IGNORE_SUITE, KOSMOS_NO_WAIT and the other wait
# controls would turn the lock off for every job): install refuses one and verify flags one. That file is the only
# place this script reads; a `launchctl setenv` or a shell profile in kosmos-ci's session would reach jobs too.
# The runner package is the latest actions/runner release, checked against the sha256 that same release publishes:
# that catches a damaged download, not a compromised release (trust on first fetch, as Baron's script had it).
# The job guard is pinned harder, by a main commit and a sha256 the operator supplies, but only at install: it lives
# in kosmos-ci's own home, so a job the guard admits could rewrite it for later jobs (a persistent runner, as on the
# mini). Likewise the runner's PATH ends with kosmos-ci's ~/.local/bin (the fallback for a tmux built from source),
# which a job can write. The guard refuses everything but this repo's own code; that is the boundary.
# KOSMOS_CI_RUNNER (the kill switch) is READ here, never written. KOSMOS_CI_SHELL_SHARDS must route no shard here
# (#4601: one runner cannot carry a shell shard): preflight and verify refuse when it names one test.yml would route.
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
OWNER="${KOSMOS_CI_OWNER:-agent1}"                 # Agent1s' only user today (runbook part 2); override elsewhere
NAME="${KOSMOS_CI_RUNNER_NAME:-kosmos-ci-agent1s}"
LABELS="self-hosted,macOS,arm64,kosmos-ci"
BREW="${KOSMOS_CI_BREW:-/opt/homebrew}"            # the engine's fixed tmux fallback is /opt/homebrew/bin/tmux
MIN_FREE_GIB="${KOSMOS_CI_MIN_FREE_GIB:-20}"       # the fleet's disk floor
ALLOW_JOBS="${KOSMOS_CI_ALLOW_JOBS:-}"             # an ERE of non-Apple launchd labels that may stay loaded
SYSTEM_AGENTS="${KOSMOS_CI_SYSTEM_AGENTS:-/System/Library/LaunchAgents}"   # Apple's own, whatever their label
# From CI_HOME, not HOME: a dry run rehearsed as the owner then names and checks kosmos-ci's own paths. With --apply,
# need_user refuses unless HOME is CI_HOME, so the two agree.
RUNNER_DIR="$CI_HOME/actions-runner"
# The jobs' PATH. .env carries it, and .env wins: runsvc.sh exports .path, then Runner.Listener's LoadAndSetEnv
# (Program.cs) sets every .env line over it. register still writes .path to match, so the two never disagree.
RUNNER_PATH="/usr/bin:/bin:/usr/sbin:/sbin:$BREW/bin:/usr/local/bin:$CI_HOME/.local/bin"
CI_DIR="$CI_HOME/.kosmos-ci"

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
    # svc.sh reads and drives the CALLER's launchd session: over ssh it reads a running runner as stopped.
    if [ "$APPLY" = 1 ] && [ "$1" = "$CI_USER" ] && [ "$(launchctl managername 2>/dev/null || true)" != Aqua ]; then
      echo "refused: run this in $CI_USER's Screen Sharing session (launchctl managername is not Aqua here)" >&2; exit 2
    fi
    return 0
  fi
  if [ "$APPLY" = 1 ]; then echo "refused: $STAGE runs as $1, not $(id -un)" >&2; exit 2; fi
  echo "note: $STAGE runs as $1 (this is $(id -un)); a dry run only prints"
}

# is_admin <user>: groups read whole first, never piped into an early-exiting grep under pipefail.
# Returns 0 admin, 1 not, 2 could not read the groups (never read as "not").
is_admin() { local g; g="$(id -Gn "$1")" || return 2; case " $g " in *" admin "*) return 0 ;; *) return 1 ;; esac; }

PROBLEMS=0
problem() { if [ "$STAGE" = verify ]; then printf 'PROBLEM: %s\n' "$*"; else printf 'REFUSE: %s\n' "$*"; fi; PROBLEMS=$((PROBLEMS + 1)); }
ok() { printf 'ok:     %s\n' "$*"; }

# repo_variable <name>: prints its value ("" when set but empty), "<unset>" on a 404, or fails when it cannot tell.
# One variable by name, so no listing page can hide it.
# Repo level only: test.yml's scope job uses no environment, so an environment-scoped value cannot reach it today.
repo_variable() {
  local out rc=0
  local errf err
  errf="$(mktemp)" || return 1
  # stderr apart: a warning gh prints on success must not become part of the value.
  out="$(gh api "repos/$REPO/actions/variables/$1" --jq '"=" + .value' 2>"$errf")" || rc=$?
  err="$(cat "$errf")"; rm -f "$errf"
  if [ "$rc" = 0 ]; then printf '%s' "${out#=}"; return 0; fi
  case "$out$err" in *"HTTP 404"*) ;; *) return 1 ;; esac
  # GitHub also answers 404 for a repo the token cannot see: trust it only if the variables list itself reads.
  gh api "repos/$REPO/actions/variables?per_page=1" >/dev/null 2>&1 || return 1
  printf '<unset>'
}

# shards_check <value>: test.yml's scope job routes a shell shard only for the tokens 1/2 and 2/2 (comma separated), so
# any other value, empty included, routes none. Refuse exactly when one would route.
shards_check() {
  local v="$1" tok routed=""
  if [ "$v" = "<unset>" ]; then ok "KOSMOS_CI_SHELL_SHARDS unset"; return; fi
  set -f   # as test.yml's parse: a "*" stays literal
  for tok in $(printf '%s' "$v" | tr ',' ' '); do case "$tok" in 1/2|2/2) routed="$routed $tok" ;; esac; done
  set +f
  if [ -n "$routed" ]; then problem "KOSMOS_CI_SHELL_SHARDS is '$v', which routes shell shard(s)$routed here: one runner cannot carry a shell shard (#4601); unset it first"
  else ok "KOSMOS_CI_SHELL_SHARDS is set to '$v', which names no shard (test.yml routes none)"; fi
}

preflight() {
  need_user "$OWNER"
  say "runbook part 3, step 0: the agents have left this Mac"
  # Explicit status checks throughout: create-user calls preflight inside `||`, where set -e is off, and a failed
  # read must refuse there too rather than read as empty.
  # application.* labels are the owner's open GUI apps (Terminal among them), not jobs.
  local jobs raw
  local unknown=0
  # The owner's GUI domain by name: a bare `launchctl list` reads the caller's session, which over ssh is not it.
  if ! raw="$(launchctl print "gui/$(id -u)")"; then problem "could not read launchctl print gui/$(id -u)"; raw=""; unknown=1; fi
  jobs="$(printf '%s\n' "$raw" | awk '/^\tservices = \{/ { f = 1; next } f && /^\t\}/ { f = 0 } f { print $NF }' \
    | awk '$1 !~ /^com\.apple\./ && $1 !~ /^application\./' \
    | while IFS= read -r l; do [ -f "$SYSTEM_AGENTS/$l.plist" ] || printf '%s\n' "$l"; done)"   # com.openssh.ssh-agent
  if [ -n "$ALLOW_JOBS" ]; then
    # grep exits 2 on a bad pattern and prints nothing, which would clear every job.
    printf 'x\n' | grep -E "$ALLOW_JOBS" >/dev/null 2>&1 || [ $? = 1 ] || { problem "KOSMOS_CI_ALLOW_JOBS is not a valid ERE: $ALLOW_JOBS"; jobs=""; unknown=1; }
    [ -z "$jobs" ] || jobs="$(printf '%s\n' "$jobs" | grep -v -E "$ALLOW_JOBS" || true)"
  fi
  if [ -n "$jobs" ]; then
    problem "$(printf '%s\n' "$jobs" | grep -c .) non-Apple launchd job(s) still loaded for $(id -un) (bootout + disable each, runbook part 3 step 0): $(printf '%s\n' "$jobs" | head -5 | tr '\n' ' ')(KOSMOS_CI_ALLOW_JOBS=<ERE> keeps one deliberately)"
  elif [ "$unknown" = 0 ]; then ok "no non-Apple launchd jobs loaded for $(id -un) (its own domain; the system domain is not read)"; fi
  # crontab -l fails with "no crontab for <user>" when there is none, which is the clear case; any other failure is not.
  local cron cron_err="" rc=0
  cron="$(crontab -l 2>&1)" || rc=$?
  if [ "$rc" != 0 ]; then case "$cron" in *"no crontab"*) cron="" ;; *) cron_err="$cron" ;; esac; fi
  if [ -n "$cron_err" ]; then problem "could not read the crontab: $cron_err"
  elif [ -n "$(printf '%s\n' "$cron" | grep -v -E '^[[:space:]]*(#|$)' || true)" ]; then problem "crontab still has lines (crontab -r, runbook part 3 step 0)"
  else ok "crontab empty"; fi
  local live
  # Any command line naming either script (a tail of its log too): a false refusal is the safe side, and it is printed.
  # pgrep exits 1 for no match and 2 or more when it failed, which must not read as "none".
  rc=0; live="$(pgrep -fl 'run-tests\.sh|queued-heavy\.sh')" || rc=$?
  if [ "$rc" -ge 2 ]; then problem "could not list processes (pgrep exit $rc): cannot rule out a live suite"
  elif [ -n "$live" ]; then problem "a suite looks live on this Mac (a process of any user names run-tests.sh or queued-heavy.sh): $(printf '%s\n' "$live" | head -3 | tr '\n' ' ')"
  else ok "no suite live (any user)"; fi

  say "the machine"
  local free_kib
  free_kib="$(df -k / | awk 'NR == 2 { print $4 }')" || free_kib=""
  case "$free_kib$MIN_FREE_GIB" in ''|*[!0-9]*) problem "could not read free disk (df gave '$free_kib', floor '$MIN_FREE_GIB')"; free_kib=0; MIN_FREE_GIB=0 ;; esac
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
    local ia=0; is_admin "$CI_USER" || ia=$?
    case "$ia" in
      0) problem "$CI_USER is an admin; it must be a standard user" ;;
      1) ok "$CI_USER exists, standard user" ;;
      *) problem "could not read $CI_USER's groups" ;;
    esac
  else ok "$CI_USER does not exist yet (create-user makes it)"; fi

  say "repo variables"
  local v
  if v="$(repo_variable KOSMOS_CI_SHELL_SHARDS)"; then
    shards_check "$v"
  else problem "could not read the repo variables (gh): cannot rule out KOSMOS_CI_SHELL_SHARDS"; fi
  if v="$(repo_variable KOSMOS_CI_RUNNER)"; then ok "KOSMOS_CI_RUNNER is $v (read only; the runbook keeps it on)"
  else echo "note:   could not read KOSMOS_CI_RUNNER (verify checks it)"; fi

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
  if [ "$APPLY" = 1 ] && ! id "$CI_USER" >/dev/null 2>&1; then
    echo "STOP: $CI_USER was not created (sysadminctl gave no error); look at System Settings, Users & Groups" >&2; exit 1
  fi
  local ia=1
  if [ "$APPLY" = 1 ]; then ia=0; is_admin "$CI_USER" || ia=$?; fi
  case "$ia" in
    0) echo "STOP: $CI_USER came out an admin; remove it (sudo sysadminctl -deleteUser $CI_USER) and report" >&2; exit 1 ;;
    2) echo "STOP: could not read $CI_USER's groups; confirm it is a standard user before going on" >&2; exit 1 ;;
  esac
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
  # The sed reads GitHub's pretty-printed JSON (two-space top-level indent); any other shape reads unknown and refuses.
  local st
  st="$(curl -fsSL "https://api.github.com/repos/$REPO/compare/$commit...main" | sed -n 's/^  "status": "\([a-z]*\)".*/\1/p' | head -1 || true)"
  case "$st" in ahead|identical) ok "$commit is on main ($st)" ;; *) echo "refused: commit $commit is not on main (compare status '${st:-unknown}'; unknown can also be a GitHub rate limit or no network), nothing changed" >&2; exit 1 ;; esac
  if [ -e "$RUNNER_DIR/.env" ] && [ ! -r "$RUNNER_DIR/.env" ]; then
    echo "refused: cannot read $RUNNER_DIR/.env (run as $CI_USER), so its KOSMOS_ keys cannot be ruled out; nothing changed" >&2; exit 1
  fi
  # The runner names each .env variable by the text before "=" (Program.cs LoadAndSetEnv), so "export KOSMOS_X=1" is
  # inert to it; that line is refused anyway, as a lock override somebody meant to set.
  if [ -f "$RUNNER_DIR/.env" ] && grep -q -E '^[[:space:]]*(export[[:space:]]+)?KOSMOS_' "$RUNNER_DIR/.env"; then
    echo "refused: $RUNNER_DIR/.env sets a KOSMOS_ variable ($(grep -E '^[[:space:]]*(export[[:space:]]+)?KOSMOS_' "$RUNNER_DIR/.env" | cut -d= -f1 | tr '\n' ' ')); a wait control there turns the suite lock off for every job. Remove it first." >&2
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
  # Every download and read before the runner is touched, so a refusal never leaves it stopped; after the stop, an
  # EXIT trap starts it again on any failure.
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
  # MERGE into .env (config.sh writes keys there): keep every key this does not set. Read now, before the stop.
  # grep exits 1 when no line is left (fine) and 2 when it could not read .env, which must not drop config.sh's keys.
  local env_keep=""
  if [ -f "$RUNNER_DIR/.env" ]; then
    if env_keep="$(grep -v -E '^(ACTIONS_RUNNER_HOOK_JOB_STARTED|ACTIONS_RUNNER_HOOK_JOB_COMPLETED|PATH|LANG)=' "$RUNNER_DIR/.env")"; then :
    else [ $? = 1 ] || { rm -f "$newg"; echo "could not read $RUNNER_DIR/.env; nothing changed" >&2; exit 1; }; fi
  fi
  # A Runner.Worker of this user is a job in flight: refuse rather than kill it. A job that starts between this check
  # and the stop below is still killed; that window is accepted for a step an operator runs by hand.
  local wrc=0
  pgrep -u "$(id -u)" -x Runner.Worker >/dev/null || wrc=$?
  if [ "$wrc" = 0 ]; then
    rm -f "$newg"; echo "refused: a job is running on this runner; install again when it is idle. Nothing changed" >&2; exit 1
  elif [ "$wrc" -ge 2 ]; then
    rm -f "$newg"; echo "refused: could not list processes (pgrep exit $wrc), so a job in flight cannot be ruled out. Nothing changed" >&2; exit 1
  fi
  # Running is read from svc.sh only: a runner started by hand with ./run.sh reads as stopped and is unpacked over.
  if [ -x ./svc.sh ]; then
    sv="$(./svc.sh status 2>&1 || true)"
    case "$sv" in *Started*) was_running=1; ./svc.sh stop >/dev/null 2>&1 || true ;; esac
    if [ "$was_running" = 1 ]; then
      case "$(./svc.sh status 2>&1 || true)" in
        *Started*) rm -f "$newg"; echo "refused: the runner did not stop; nothing unpacked" >&2; exit 1 ;;
      esac
      # A tar that fails partway leaves old and new files mixed; the runner is started on that, and says so.
      trap 'echo "install failed after stopping the runner: starting it again on whatever was unpacked; install again" >&2; ./svc.sh start >/dev/null 2>&1 || true' EXIT
    fi
  fi
  # Unpacked over the old release. A runner that updated itself has bin and externals as symlinks to versioned
  # dirs (actions/runner update.sh); tar replaces those with plain dirs of this release. svc.sh install copied
  # bin/runsvc.sh to ./runsvc.sh, naming its node version, so refresh that copy below as svc.sh install would.
  tar xzf "$tgz"
  [ ! -f .service ] || cp bin/runsvc.sh runsvc.sh
  chmod +x "$newg"
  mv -f "$newg" "$CI_DIR/job-guard.sh"
  echo "runner $ver unpacked in $RUNNER_DIR; job guard installed from $commit, sha256 $got"
  # Job hooks. NOT a fresh VM: the checkout and ~ persist between jobs. They end what a previous job left running,
  # and only THIS user's: the agents' processes (another user) are never touched.
  act_write "$CI_DIR/job-cleanup.sh" 755 <<'HOOK'
#!/bin/bash
# Ends what a job left running. kosmos-ci is a DEDICATED user and no step runs while a hook does, so every tmux
# server and node process of this user is a leftover. The runner's own service host IS node (RunnerService.js), but
# it is this hook's ancestor, and pkill leaves its own ancestors alone unless given -a (man pkill).
pkill -u "$(id -u)" -x tmux 2>/dev/null || true
pkill -u "$(id -u)" -x node 2>/dev/null || true
HOOK
  act_write "$CI_DIR/job-completed.sh" 755 <<'HOOK'
#!/bin/bash
# Located by its own path: the hooks live beside each other. The job's temp is emptied AFTER a job only: at job
# start it holds the event payload the guard reads.
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
  { [ -z "$env_keep" ] || printf '%s\n' "$env_keep"
    echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=$CI_DIR/job-started.sh"
    echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$CI_DIR/job-completed.sh"
    echo "LANG=en_US.UTF-8"   # launchd gives none; the tmux tests need it
    echo "PATH=$RUNNER_PATH"; } > "$RUNNER_DIR/.env.new"
  # A rename takes the new file's mode, not the old one's: carry the old mode over (a first .env takes the umask).
  [ ! -e "$RUNNER_DIR/.env" ] || chmod "$(stat -f %Lp "$RUNNER_DIR/.env")" "$RUNNER_DIR/.env.new"
  mv -f "$RUNNER_DIR/.env.new" "$RUNNER_DIR/.env"
  echo "hooks and .env written (merged)"
  trap - EXIT
  rm -f "$tgz"
  if [ "$was_running" = 1 ]; then
    ./svc.sh start || { echo "FAILED to start the runner again (./svc.sh start in $RUNNER_DIR): it is stopped" >&2; exit 1; }
    # svc.sh start is a launchctl load: it succeeds for a service that dies at once. A Listener must appear.
    local waited=0
    until pgrep -u "$(id -u)" -x Runner.Listener >/dev/null; do
      [ "$waited" -lt "${KOSMOS_CI_START_WAIT_S:-30}" ] || { echo "FAILED: the runner was loaded but no Runner.Listener is running after ${waited}s; see ~/Library/Logs/actions.runner.*/stderr.log" >&2; exit 1; }
      sleep 1; waited=$((waited + 1))
    done
    echo "runner started again"
  fi
}

register() {
  need_user "$CI_USER"
  mode_line
  if [ "$APPLY" != 1 ]; then
    echo "WOULD: write $RUNNER_DIR/.path as $RUNNER_PATH after config.sh (config.sh writes its own shell's PATH there)"
    echo "WOULD: read a registration token from stdin (mint it as $OWNER: gh api -X POST repos/$REPO/actions/runners/registration-token --jq .token)"
    printf 'WOULD: ACTIONS_RUNNER_INPUT_TOKEN=<token>'; printf ' %q' ./config.sh --unattended --url "$REPO_URL" --name "$NAME" --labels "$LABELS" --work _work --replace; printf '\n'
    printf 'WOULD: %q install\nWOULD: %q start\n' ./svc.sh ./svc.sh
    return 0
  fi
  [ -x "$RUNNER_DIR/config.sh" ] || { echo "refused: no runner in $RUNNER_DIR; run install first" >&2; exit 1; }
  cd "$RUNNER_DIR"
  local token=""
  if [ -t 0 ]; then printf 'registration token: ' >&2; IFS= read -r -s token || true; echo >&2; else IFS= read -r token || true; fi
  [ -n "$token" ] || { echo "refused: no registration token on stdin" >&2; exit 1; }
  # The runner reads ACTIONS_RUNNER_INPUT_<ARG> for a config argument it is not given, so the token stays out of argv.
  ACTIONS_RUNNER_INPUT_TOKEN="$token" ./config.sh --unattended --url "$REPO_URL" --name "$NAME" --labels "$LABELS" --work _work --replace
  printf '%s\n' "$RUNNER_PATH" > .path
  ./svc.sh install   # a LaunchAgent for this user (starts at login)
  ./svc.sh start
  ./svc.sh status
}

# runner_busy: prints true or false; fails when the API could not say.
runner_busy() {
  gh api --paginate "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$NAME\") | .busy" 2>/dev/null
}

verify() {
  need_user "$OWNER"
  say "the runner, from the API"
  local row
  row="$(gh api --paginate "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$NAME\") | \"\(.status) \(.busy) \([.labels[].name | ascii_downcase] | sort | join(\",\"))\"")" \
    || { problem "could not read the runners API"; row="?"; }
  local want_labels
  want_labels="$(printf '%s\n' "$LABELS" | tr ',' '\n' | tr '[:upper:]' '[:lower:]' | LC_ALL=C sort | paste -sd, -)"
  local busy=false
  if [ "$row" = "?" ]; then row=""
  elif [ -z "$row" ]; then problem "no runner named $NAME"
  else
    local status labels
    read -r status busy labels <<EOF
$row
EOF
    [ "$status" = online ] && ok "$NAME online (busy=$busy)" || problem "$NAME is $status"
    [ "${labels:-}" = "$want_labels" ] && ok "labels exactly $want_labels" || problem "labels are '${labels:-}', not $want_labels"
  fi
  say "repo variables"
  local v
  if v="$(repo_variable KOSMOS_CI_RUNNER)"; then
    [ "$v" = on ] && ok "KOSMOS_CI_RUNNER on" || problem "KOSMOS_CI_RUNNER is '$v': jobs do not route to the runner"
  else problem "could not read KOSMOS_CI_RUNNER"; fi
  if v="$(repo_variable KOSMOS_CI_SHELL_SHARDS)"; then
    shards_check "$v"
  else problem "could not read KOSMOS_CI_SHELL_SHARDS"; fi
  say "the job guard and the runner's .env (a KOSMOS_ key there would turn the suite lock off for every job)"
  local k f
  if [ ! -e "$RUNNER_DIR/.env" ]; then problem "no $RUNNER_DIR/.env: install has not run here, so no job guard is wired"
  elif [ ! -r "$RUNNER_DIR/.env" ]; then echo "note:   cannot read $RUNNER_DIR/.env as $(id -un); its hooks and KOSMOS_ keys are unchecked"
  else
    if grep -q -E '^[[:space:]]*(export[[:space:]]+)?KOSMOS_' "$RUNNER_DIR/.env"; then problem "$RUNNER_DIR/.env sets a KOSMOS_ variable: remove it"
    else ok "$RUNNER_DIR/.env sets no KOSMOS_ variable"; fi
    for k in STARTED COMPLETED; do
      f="job-$(printf '%s' "$k" | tr '[:upper:]' '[:lower:]').sh"
      if grep -q -F -x "ACTIONS_RUNNER_HOOK_JOB_$k=$CI_DIR/$f" "$RUNNER_DIR/.env"; then ok "the $f hook is wired"
      else problem "$RUNNER_DIR/.env does not set ACTIONS_RUNNER_HOOK_JOB_$k=$CI_DIR/$f: the job guard is not wired"; fi
    done
  fi
  if [ -r "$CI_DIR" ] && [ -x "$CI_DIR" ]; then
    for f in job-guard.sh job-started.sh job-completed.sh job-cleanup.sh; do
      [ -x "$CI_DIR/$f" ] || problem "$CI_DIR/$f is missing or not executable"
    done
    [ ! -r "$CI_DIR/job-guard.sh" ] || echo "note:   job guard sha256 $(shasum -a 256 "$CI_DIR/job-guard.sh" | cut -d' ' -f1) (compare with the install pin)"
  else echo "note:   cannot read $CI_DIR as $(id -un); the hook files are unchecked"; fi
  # .env's PATH wins for jobs (see RUNNER_PATH), so a different .path is a note, not a problem. config.sh refills it
  # from its own shell, so a re-register (./svc.sh uninstall and ./config.sh remove first) can undo register's.
  if [ ! -e "$RUNNER_DIR/.path" ]; then ok "no $RUNNER_DIR/.path here"
  elif [ ! -r "$RUNNER_DIR/.path" ]; then echo "note:   cannot read $RUNNER_DIR/.path as $(id -un)"
  elif [ "$(cat "$RUNNER_DIR/.path")" = "$RUNNER_PATH" ]; then ok ".path is the PATH .env sets"
  else echo "note:   $RUNNER_DIR/.path is not $RUNNER_PATH (config.sh's own shell PATH?). Jobs use .env's PATH; to tidy it, write that line to .path"; fi
  say "what a job left behind (between jobs, $CI_USER should run no tmux or node but the runner's own)"
  local left busy2
  # ps reads THIS Mac only, and an unknown user makes it fail with no lines, which must not read as "nothing left".
  if ! id "$CI_USER" >/dev/null 2>&1; then problem "no user $CI_USER on this Mac: run verify on the runner's own Mac"
  # macOS ps -U exits 1 for a user with no processes, which here means the user is not logged in.
  elif ! left="$(ps -U "$CI_USER" -o args=)"; then problem "$CI_USER runs no processes (not logged in? the runner needs auto-login), or ps failed"
  # The busy flag was read before ps: read it again, and a job that started or ended in between is a rerun.
  elif [ -n "$row" ] && ! busy2="$(runner_busy)"; then problem "could not read the runners API a second time"
  elif [ -n "$row" ] && [ -z "$busy2" ]; then problem "the runner left the API during verify; run verify again"
  elif [ -n "$row" ] && [ "$busy2" != "$busy" ]; then problem "the runner went busy or idle during verify; run verify again"
  else
    # By program name (first word, path and any trailing colon stripped: on macOS a tmux server keeps the argv it
    # was started with, measured 05:12 10-14, but some builds retitle it "tmux: server"). The runner's own service host is node running RunnerService.js.
    left="$(printf '%s\n' "$left" | awk '{ n = $1; sub(/.*\//, "", n); sub(/:$/, "", n) } (n == "tmux" || n == "node") && !/\/bin\/RunnerService\.js/ { print n }')"
    if [ -z "$left" ]; then ok "no tmux or node left under $CI_USER"
    elif [ "$busy" = true ]; then ok "tmux or node running under $CI_USER, while a job is in flight (busy=true)"
    else problem "$CI_USER still runs: $(printf '%s\n' "$left" | sort | uniq -c | tr -s ' ' | tr '\n' ' ')with no job in flight"; fi
  fi
  if [ "$PROBLEMS" -gt 0 ]; then say "verify: $PROBLEMS problem(s)"; return 1; fi
  say "verify: clear"
}

machine_settings() {
  cat <<EOF
# Settings that need an admin, in System Settings (printed, never run):
#  1. Users & Groups: automatic login as $CI_USER. The runner is a LaunchAgent of $CI_USER, so after a restart it is
#     offline until $CI_USER is logged in. Needs FileVault off (preflight checks it).
#  2. Energy: keep "prevent automatic sleeping" and "start up after a power failure" (preflight checks both).
#  3. Log in as $CI_USER once in Screen Sharing before install: its home and GUI session come with that login.
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
