#!/usr/bin/env bash
# #4601: turn a fleet Mac (Agent1s, once the agents have moved to the new Mac) into the self-hosted CI runner, as the
# runbook on #5488 (comment 6154688503, part 2) says. It stands alone: it began as Baron's ci-mini-setup.sh (#5488 part
# b, kept outside the repo, history only), with the same install plus the checks and the user the runbook adds.
#
# 🛑 DRY RUN IS THE DEFAULT. Nothing changes unless --apply is given: a change either goes through act(), which
# otherwise prints "WOULD: <command>", or sits after a stage's own dry-run return (install, register, keepalive).
# Reads always run, dry or not: launchctl print, crontab -l, pgrep, ps, id, df, stat, shasum, fdesetup, pmset,
# xcode-select, plutil -extract, gh api GETs, and install's unauthenticated compare GET to api.github.com (with
# --apply, also launchctl managername and manageruid). A temp file for gh's stderr comes and goes in TMPDIR.
#
# Usage: tools/ci-runner-setup.sh [--apply] <stage> [args]
#   preflight                 as the machine owner. Reads only. Refuses while the agents' launchd jobs, crontab
#                             or a suite are live (runbook part 3, step 0), and checks disk, FileVault, sleep,
#                             power restore, tmux, pwsh, the Command Line Tools, the owner's home mode, the CI
#                             user and the repo variables. KOSMOS_CI_ALLOW_JOBS (an ERE) lets named launchd jobs stay
#                             loaded. KOSMOS_CI_SYSTEM_AGENTS, KOSMOS_CI_OWNER_HOME and KOSMOS_CI_BREW are test seams.
#   create-user               as the machine owner (an admin). Runs preflight first, then creates kosmos-ci as a STANDARD user
#   install <commit> <sha256> as kosmos-ci, in its Screen Sharing session (svc.sh, which stops and starts the
#                             runner, needs the GUI session, not ssh). The runner, the hooks and the job guard
#                             from THAT main commit
#   register                  as kosmos-ci, in its Screen Sharing session, for the same reason. Reads the
#                             registration token from stdin, so it is never in any argv
#   keepalive                 as kosmos-ci, over ssh or in its session (kosmos#7001; for another runner user, set
#                             KOSMOS_CI_USER, e.g. kosmos-ci2). Adds KeepAlive, ThrottleInterval and ExitTimeOut to an
#                             installed runner's LaunchAgent and reloads it while idle; a dry run says whether it is
#                             set and loaded (exit 1 when the runner is not running as it should). This repo's runner
#                             only ($CI_HOME/actions-runner); a kosmos-relay runner under the same user is not touched.
#                             Waits, in seconds: KOSMOS_CI_UNLOAD_WAIT_S (45), KOSMOS_CI_START_WAIT_S (30),
#                             KOSMOS_CI_STATE_WAIT_S (12)
#   verify                    as the machine owner. Reads only. The runner is online with exactly its labels.
#                             Give KOSMOS_CI_GUARD_SHA (the install pin), or the guard counts as unchecked.
#                             Exit 0 clear, 1 a problem, 3 a check it could not make (neither pass nor fail)
#   machine-settings          prints the settings that need an admin in System Settings
#   jq-programs               prints the jq programs handed to gh --jq; reads nothing (the test runs them through jq)
#
# HOW kosmos-ci GETS THIS SCRIPT, since the owner's home is closed to it (mode 700): pinned like the guard. As kosmos-ci,
#   curl -fsSL https://raw.githubusercontent.com/joshualeestone/kosmos/<commit>/tools/ci-runner-setup.sh -o ~/ci-runner-setup.sh
# with the same main <commit> you give install, and check `shasum -a 256 ~/ci-runner-setup.sh` against what the owner
# gets from `git show <commit>:tools/ci-runner-setup.sh | shasum -a 256`. Run that copy only if the two match.
#
# The one-suite-per-Mac lock (#4574) needs nothing new here, only nothing switched OFF: a CI job runs
# tools/run-tests.sh, whose name arm is pgrep (`-fl` on macOS) with no -u (tools/lib/cut-guard.sh), so it sees a suite of ANY
# user on this Mac and waits. The run markers are per-HOME and do not cross users; the name arm does. So the
# runner's .env must never set a KOSMOS_ variable (KOSMOS_TESTS_IGNORE_SUITE, KOSMOS_NO_WAIT and the other wait
# controls would turn the lock off for every job): install and register refuse one, verify flags one. That file is the only
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
OWNER_HOME="${KOSMOS_CI_OWNER_HOME:-/Users/$OWNER}"
# The jq programs this script hands to gh --jq, in one place so the test can run each against canned API JSON.
JQ_VAR='"=" + .value'                                  # "=" tells set-but-empty from no output
jq_busy() { printf '.runners[] | select(.name == "%s") | .busy' "$NAME"; }
jq_row() { printf '.runners[] | select(.name == "%s") | "\(.status) \(.busy) \([.labels[].name | ascii_downcase] | sort | join(","))"' "$NAME"; }
NAME="${KOSMOS_CI_RUNNER_NAME:-kosmos-ci-agent1s}"
# NAME goes into a jq string literal (jq_busy, jq_row): only characters that need no escaping there.
case "$NAME" in ''|*[!A-Za-z0-9._-]*) echo "refused: KOSMOS_CI_RUNNER_NAME '$NAME' may hold only letters, digits, '.', '_' and '-'" >&2; exit 2 ;; esac
# CI_HOME goes into pgrep patterns (keepalive): no character there can do more than widen a match ('.').
case "${KOSMOS_CI_HOME:-/Users/${KOSMOS_CI_USER:-kosmos-ci}}" in ''|*[!A-Za-z0-9/._-]*) echo "refused: the CI home may hold only letters, digits, '/', '.', '_' and '-'" >&2; exit 2 ;; esac
for _w in KOSMOS_CI_UNLOAD_WAIT_S KOSMOS_CI_START_WAIT_S KOSMOS_CI_STATE_WAIT_S; do
  eval "_v=\${$_w-}"
  [ -z "$_v" ] || case "$_v" in *[!0-9]*) echo "refused: $_w is '$_v', not a number of seconds" >&2; exit 2 ;; esac
done
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
# put <path> <mode>: stdin becomes the file, written beside it and renamed in, so a write that fails partway (a full
# disk) leaves the old file whole rather than a truncated hook a restarted runner would run. Only used past a stage's
# dry-run return.
put() { cat > "$1.new" && chmod "$2" "$1.new" && mv -f "$1.new" "$1" || { rm -f "$1.new"; return 1; }; }
# hook_body <cleanup|completed|started>: the text of each job hook, in one place, so install writes it and verify
# can compare the installed file byte for byte (a job could rewrite a hook to skip the guard; see the header).
hook_body() {
  case "$1" in
    cleanup) cat <<'HOOK'
#!/bin/bash
# Ends what a job left running. kosmos-ci is a DEDICATED user and no step runs while a hook does, so every tmux
# server and node process of this user is a leftover. The runner's own service host IS node (RunnerService.js), but
# it is this hook's ancestor, and is spared as pkill spared its own ancestors.
# kosmos#6245: ONE exception. The kosmos-relay repo's runner also lives under this user, in ~/actions-runner-relay,
# and its service host is node too: a plain pkill ended it (and any relay job mid-run) every time a kosmos job did.
# A process whose ancestry reaches a command in that folder is the relay runner's, running now, and is spared. A
# leftover that detached (its parent is launchd) is ended, whoever started it. Two limits, accepted on this single-tenant
# runner: a kosmos job could get a leftover spared by naming that folder in its command line, and a relay job's own
# detached process (a tmux server always detaches) is ended like any other, so relay jobs must not rely on one.
# --list prints what would be ended and ends nothing (the test reads it; it never kills on the machine it runs on).
RELAY_DIR="$HOME/actions-runner-relay/"
mine=" $$ "; p=$$
while p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ') && [ -n "$p" ] && [ "$p" -gt 1 ]; do mine="$mine$p "; done
spared() {
  local p=$1 n=0 c
  case "$mine" in *" $p "*) return 0 ;; esac
  while [ -n "$p" ] && [ "$p" -gt 1 ] && [ "$n" -lt 64 ]; do
    c=$(ps -ww -o command= -p "$p" 2>/dev/null) || return 1
    case "$c" in *"$RELAY_DIR"*) return 0 ;; esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); n=$((n + 1))
  done
  return 1
}
victims() { local name p; for name in tmux node; do for p in $(pgrep -u "$(id -u)" -x "$name" 2>/dev/null); do spared "$p" || echo "$p"; done; done; }
if [ "${1:-}" = --list ]; then victims; exit 0; fi
for p in $(victims); do kill "$p" 2>/dev/null || true; done
HOOK
      ;;
    completed) cat <<'HOOK'
#!/bin/bash
# Located by its own path: the hooks live beside each other. The job's temp is emptied AFTER a job only: at job
# start it holds the event payload the guard reads.
D="$(cd "$(/usr/bin/dirname "$0")" && pwd -P)" || exit 1
"$D/job-cleanup.sh"
TMPD="$(cd "$D/../actions-runner/_work/_temp" 2>/dev/null && pwd -P)" || exit 0
# Only when RUNNER_TEMP is that resolved path: one that differs (a symlinked home) skips the sweep, safely and silently.
case "${RUNNER_TEMP:-}" in "$TMPD") find "${TMPD:?}" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true ;; esac   # dotfiles too
HOOK
      ;;
    started) cat <<'HOOK'
#!/bin/bash
# Guard first: a refused job fails here, before cleanup and before any of its steps.
D="$(cd "$(/usr/bin/dirname "$0")" && pwd -P)" || exit 1
"$D/job-guard.sh" || exit 1
exec "$D/job-cleanup.sh"
HOOK
      ;;
  esac
}
mode_line() { if [ "$APPLY" = 1 ]; then say "APPLYING $STAGE"; else say "DRY RUN of $STAGE (nothing changes; --apply to do it)"; fi; }
# kosmos#7001: svc.sh writes the runner's LaunchAgent with RunAtLoad and no KeepAlive, so a runner that is killed stays
# offline until someone logs in (10-23: SIGKILLed mid-job, offline 29 minutes). add_keepalive adds three keys:
# - KeepAlive {SuccessfulExit: false}: restart after a kill or a crash, never after exit 0, which is how the service ends
#   on purpose (a stop, a removed registration, a session conflict: node drains its event loop and exits 0; its only
#   process.exit is the unsupported-platform 1 at start; runsvc.sh exits with node's status). A self-update never ends
#   the job: RunnerService.js relaunches the listener itself. Exit 0 measured for a SIGTERM stop (10-23); for the
#   listener's own 0/1/5 exits it is read from RunnerService.js, not measured.
# - ThrottleInterval 10: launchd's default, written down. A runner that keeps crashing restarts at most every 10 s;
#   `launchctl bootout gui/<uid>/<label>` stops it.
# - ExitTimeOut 35: launchd SIGKILLs a stopping job after its exit timeout, shown here as `exit timeout = 5`, but
#   RunnerService.js gives the Listener 30 s to end its GitHub session; a stop cut short leaves that session behind.
# What still stays down: a SIGTERM or SIGINT (any kill tool's default signal) to runsvc.sh or node, which they handle as
# a stop (exit 0), so only a SIGKILL or a crash is restarted (10-23 was a SIGKILL); a Listener that crashes is RunnerService.js's to retry (every 5 s, forever, unless
# GITHUB_ACTIONS_SERVICE_EXIT_AFTER_N_FAILURES is set); 10 consecutive retryable exits (2, 3, 4) stop the service
# (exit 0); and a killed Listener leaves its session on GitHub's side, which, if it outlasts the restarted Listener's
# session-conflict retries, ends in exit 5 and a stop. The 10-23 restart came back in about 2 minutes; the liveness
# page is the backstop.
#
# This runner's LaunchAgent, as svc.sh install recorded it in $RUNNER_DIR/.service, or nothing; never fails (set -e and
# pipefail are on). Not a glob: the kosmos-relay runner (#6245) can live under the same user, and its
# actions.runner.joshualeestone-kosmos-relay.* plist sorts before this repo's.
runner_plist() {
  local f=""
  [ -r "$RUNNER_DIR/.service" ] && f="$(head -n 1 "$RUNNER_DIR/.service" 2>/dev/null || true)"
  case "${f#"$CI_HOME"/Library/LaunchAgents/}" in */*) return 0 ;; esac   # directly in that dir, no further path
  case "$f" in "$CI_HOME"/Library/LaunchAgents/actions.runner.*.plist) [ -e "$f" ] && printf '%s\n' "$f" ;; esac
  return 0
}
keepalive_set() {
  [ "$(plutil -extract KeepAlive.SuccessfulExit raw -o - "$1" 2>/dev/null)" = false ] || return 1
  local t; t="$(plutil -extract ExitTimeOut raw -o - "$1" 2>/dev/null || true)"
  case "$t" in ''|*[!0-9]*) return 1 ;; esac; [ "$t" -ge 35 ]
}
# keepalive_missing <plist>: what keepalive_set found missing, in words.
keepalive_missing() {
  local m=""
  [ "$(plutil -extract KeepAlive.SuccessfulExit raw -o - "$1" 2>/dev/null)" = false ] || m="KeepAlive {SuccessfulExit: false}"
  keepalive_set "$1" || [ -n "$m" ] || m="ExitTimeOut 35 (it has KeepAlive)"
  printf '%s' "${m:-nothing}"
}
# loaded_keepalive <domain/label>: the LOADED job has it (launchd prints KeepAlive {SuccessfulExit: false} as the
# semaphore "successful exit => 0", and ExitTimeOut as "exit timeout = N"; measured on macOS 27.0.1, the old Agent1s
# Mac's). The plist on disk can have it while the loaded job
# does not, after a reload that was refused or failed.
loaded_keepalive() {
  local out t; out="$(launchctl print "$1" 2>/dev/null)" || return 1
  printf '%s\n' "$out" | grep -x -E '[[:space:]]*successful exit => 0' >/dev/null || return 1
  t="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*exit timeout = \([0-9][0-9]*\)$/\1/p' | head -n 1)"
  [ -n "$t" ] && [ "$t" -ge 35 ]
}
# add_keepalive <plist>: written beside it and renamed in, as put does, so a failure leaves the old file whole.
add_keepalive() {
  local et old
  # An operator's own KeepAlive (true, or a dict with other keys) is replaced: said, not silent.
  old="$(plutil -extract KeepAlive xml1 -o - "$1" 2>/dev/null | tr -d '\n\t' | sed -e 's/.*<plist[^>]*>//' -e 's#</plist>.*##' || true)"
  case "$old" in ''|'<dict><key>SuccessfulExit</key><false/></dict>') : ;;
    *) echo "note:   replacing KeepAlive $old in $1 with {SuccessfulExit: false}" || true ;; esac
  cp -p "$1" "$1.new" || return 1
  plutil -remove KeepAlive "$1.new" >/dev/null 2>&1 || true
  if plutil -insert KeepAlive -xml '<dict><key>SuccessfulExit</key><false/></dict>' "$1.new" \
     && { et="$(plutil -extract ThrottleInterval raw -o - "$1.new" 2>/dev/null || true)"
          case "$et" in ''|*[!0-9]*) plutil -replace ThrottleInterval -integer 10 "$1.new" ;;
            *) [ "$et" -ge 10 ] || plutil -replace ThrottleInterval -integer 10 "$1.new" ;; esac; } \
     && { et="$(plutil -extract ExitTimeOut raw -o - "$1.new" 2>/dev/null || true)"
          case "$et" in ''|*[!0-9]*) plutil -replace ExitTimeOut -integer 35 "$1.new" ;;
            *) [ "$et" -ge 35 ] || plutil -replace ExitTimeOut -integer 35 "$1.new" ;; esac; } \
     && plutil -lint "$1.new" >/dev/null && mv -f "$1.new" "$1"; then
    return 0
  fi
  rm -f "$1.new"; return 1
}
need_user() {
  if [ "$(id -un)" = "$1" ]; then
    # sudo keeps HOME on macOS, so `sudo -u kosmos-ci` would aim RUNNER_DIR at the caller's home.
    if [ "$APPLY" = 1 ] && [ "$1" = "$CI_USER" ] && [ "$HOME" != "$CI_HOME" ]; then
      echo "refused: HOME is $HOME, not $CI_HOME (log in as $CI_USER rather than sudo -u)" >&2; exit 2
    fi
    # svc.sh reads and drives the CALLER's launchd session: over ssh it reads a running runner as stopped, and under
    # sudo -iu or su from the owner's GUI it acts on the OWNER's session (Aqua, but managed for another uid).
    if [ "$APPLY" = 1 ] && [ "$1" = "$CI_USER" ] && [ "${2:-}" != ssh-ok ]; then
      if [ "$(launchctl managername 2>/dev/null || true)" != Aqua ]; then
        echo "refused: run this in $CI_USER's Screen Sharing session (launchctl managername is not Aqua here; a tmux pane reads Background)" >&2; exit 2
      fi
      if [ "$(launchctl manageruid 2>/dev/null || true)" != "$(id -u)" ]; then
        echo "refused: this GUI session belongs to another user (sudo -iu or su?); log in to Screen Sharing as $CI_USER" >&2; exit 2
      fi
    fi
    return 0
  fi
  if [ "$APPLY" = 1 ]; then echo "refused: $STAGE runs as $1, not $(id -un)" >&2; exit 2; fi
  # The owner's stages READ the caller's own launchd domain, crontab and gh: as anyone else there is no harmless dry run,
  # only a verdict about the wrong account.
  if [ "$1" = "$OWNER" ]; then echo "refused: $STAGE reads $OWNER's own launchd jobs, crontab and gh; run it as $OWNER, not $(id -un)" >&2; exit 2; fi
  echo "note: $STAGE runs as $1 (this is $(id -un)); a dry run only prints"
}

# is_admin <user>: groups read whole first, never piped into an early-exiting grep under pipefail.
# Returns 0 admin, 1 not, 2 could not read the groups (never read as "not").
is_admin() { local g; g="$(id -Gn "$1")" || return 2; case " $g " in *" admin "*) return 0 ;; *) return 1 ;; esac; }

PROBLEMS=0
problem() { if [ "$STAGE" = verify ]; then printf 'PROBLEM: %s\n' "$*"; else printf 'REFUSE: %s\n' "$*"; fi; PROBLEMS=$((PROBLEMS + 1)); }
ok() { printf 'ok:     %s\n' "$*"; }
UNCHECKED=0
unchecked() { printf 'UNCHECKED: %s\n' "$*"; UNCHECKED=$((UNCHECKED + 1)); }

# repo_variable <name>: prints its value ("" when set but empty), "<unset>" on a 404, or fails when it cannot tell.
# One variable by name, so no listing page can hide it.
# Repo level only: test.yml's scope job uses no environment, so an environment-scoped value cannot reach it today.
repo_variable() {
  local out rc=0
  local errf err
  errf="$(mktemp)" || return 1
  # stderr apart: a warning gh prints on success must not become part of the value.
  out="$(gh api "repos/$REPO/actions/variables/$1" --jq "$JQ_VAR" 2>"$errf")" || rc=$?
  err="$(cat "$errf")"; rm -f "$errf"
  if [ "$rc" = 0 ]; then printf '%s' "${out#=}"; return 0; fi
  case "$out$err" in *"HTTP 404"*) ;; *) return 1 ;; esac
  # GitHub also answers 404 for a repo the token cannot see: trust it only if the variables list itself reads.
  gh api "repos/$REPO/actions/variables?per_page=1" >/dev/null 2>&1 || return 1
  printf '<unset>'
}

# shards_check <value>: test.yml's scope job routes a shell shard only for the tokens 1/2 and 2/2 (split on commas and
# whitespace), and only while the node part routes here too, so
# any other value, empty included, routes none. Refuse whenever a token could route (whatever KOSMOS_CI_RUNNER is).
shards_check() {
  local v="$1" tok routed=""
  if [ "$v" = "<unset>" ]; then ok "KOSMOS_CI_SHELL_SHARDS unset"; return; fi
  set -f   # as test.yml's parse: a "*" stays literal
  for tok in $(printf '%s' "$v" | tr ',' ' '); do case "$tok" in 1/2|2/2) routed="$routed $tok" ;; esac; done
  set +f
  if [ -n "$routed" ]; then problem "KOSMOS_CI_SHELL_SHARDS is '$v', which could route shell shard(s)$routed here: one runner cannot carry a shell shard (#4601); unset it first"
  else ok "KOSMOS_CI_SHELL_SHARDS is set to '$v', which names no shard (test.yml routes none)"; fi
}

preflight() {
  [ "${1:-}" = --from-create ] || need_user "$OWNER"   # create-user has already said who it runs as
  [ -z "${KOSMOS_CI_SYSTEM_AGENTS:-}${KOSMOS_CI_OWNER_HOME:-}${KOSMOS_CI_BREW:-}" ] || echo "note:   a test seam is set (KOSMOS_CI_SYSTEM_AGENTS, KOSMOS_CI_OWNER_HOME or KOSMOS_CI_BREW): these checks are not this Mac's own"
  say "runbook part 3, step 0: the agents have left this Mac"
  # Explicit status checks throughout: create-user calls preflight inside `||`, where set -e is off, and a failed
  # read must refuse there too rather than read as empty.
  # application.* labels are the owner's open GUI apps (Terminal among them), not jobs.
  local jobs raw
  local unknown=0
  # The owner's GUI domain by name: a bare `launchctl list` reads the caller's session, which over ssh is not it.
  if ! raw="$(launchctl print "gui/$(id -u)")"; then problem "could not read launchctl print gui/$(id -u)"; raw=""; unknown=1; fi
  # A GUI domain always lists Apple's own services: an empty services block means the format changed, not "no jobs".
  if [ "$unknown" = 0 ] && [ -z "$(printf '%s\n' "$raw" | awk '/^\tservices = \{/ { f = 1; next } f && /^\t\}/ { f = 0 } f { print $NF }')" ]; then
    problem "launchctl print gui/$(id -u) listed no services at all (has its format changed?)"; unknown=1
  fi
  jobs="$(printf '%s\n' "$raw" | awk '/^\tservices = \{/ { f = 1; next } f && /^\t\}/ { f = 0 } f { print $NF }' \
    | awk '$1 !~ /^com\.apple\./ && $1 !~ /^application\./' \
    | while IFS= read -r l; do [ -f "$SYSTEM_AGENTS/$l.plist" ] || printf '%s\n' "$l"; done)"   # com.openssh.ssh-agent
  if [ -n "$ALLOW_JOBS" ]; then
    # grep exits 2 on a bad pattern and prints nothing, which would clear every job.
    printf 'x\n' | grep -E -e "$ALLOW_JOBS" >/dev/null 2>&1 || [ $? = 1 ] || { problem "KOSMOS_CI_ALLOW_JOBS is not a valid ERE: $ALLOW_JOBS"; jobs=""; unknown=1; }
    # A heuristic for the match-everything class (".*", "^", a trailing "|"): a probe no real label contains. A broad
    # pattern can still miss it, which is why every job the list keeps is printed below.
    if [ "$unknown" = 0 ] && printf 'Qz7xK4.wV2pR9\n' | grep -q -E -e "$ALLOW_JOBS"; then
      problem "KOSMOS_CI_ALLOW_JOBS matches any label (it matched the probe Qz7xK4.wV2pR9): $ALLOW_JOBS"; jobs=""; unknown=1
    fi
    if [ "$unknown" = 0 ] && [ -n "$jobs" ]; then
      printf '%s\n' "$jobs" | grep -E -e "$ALLOW_JOBS" | sed 's/^/note:   allowed to stay loaded (KOSMOS_CI_ALLOW_JOBS): /' || true
      jobs="$(printf '%s\n' "$jobs" | grep -v -E -e "$ALLOW_JOBS" || true)"
    fi
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
  case "$free_kib:$MIN_FREE_GIB" in
    :*|*:|*[!0-9:]*) problem "could not read free disk (df gave '$free_kib', floor '$MIN_FREE_GIB')" ;;
    *) if [ "$((free_kib / 1048576))" -lt "$MIN_FREE_GIB" ]; then problem "$((free_kib / 1048576)) GiB free, under the ${MIN_FREE_GIB} GiB floor"
       else ok "$((free_kib / 1048576)) GiB free"; fi ;;
  esac
  # The exact line: "FileVault is Off, but will be enabled after the next restart." is not off for long.
  case "$(fdesetup status 2>&1)" in
    "FileVault is Off.") ok "FileVault off (auto-login is possible)" ;;
    *) problem "FileVault is not plainly off ($(fdesetup status 2>&1 | head -1)): auto-login, which the runner's LaunchAgent needs after a restart, is impossible" ;;
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
      "tmux 3.5a") problem "$BREW/bin/tmux is 3.5a, which #2955's test refuses (as the owner of $BREW: brew upgrade tmux)" ;;
      *) ok "$BREW/bin/tmux ($tv)" ;;
    esac
  else problem "no $BREW/bin/tmux (the engine looks there by fixed path; as the owner of $BREW: brew install tmux)"; fi
  # Jobs check out with git; without the Command Line Tools /usr/bin/git is only a stub that asks to install them.
  if xcode-select -p >/dev/null 2>&1; then ok "Command Line Tools present (git)"
  else problem "no Command Line Tools (xcode-select -p fails): /usr/bin/git cannot run for jobs; xcode-select --install"; fi
  if [ -x "$BREW/bin/pwsh" ]; then ok "$BREW/bin/pwsh"
  else problem "no $BREW/bin/pwsh (as the owner of $BREW: brew install --cask powershell)"; fi

  say "the owner's home ($CI_USER is in group staff, so a group-readable home is readable by every CI job)"
  local om
  if ! om="$(stat -f %Lp "$OWNER_HOME" 2>/dev/null)"; then problem "could not read the mode of $OWNER_HOME"
  elif [ $(( 8#$om & 8#077 )) != 0 ]; then problem "$OWNER_HOME is mode $om: CI jobs could read it; as $OWNER: chmod 700 $OWNER_HOME"
  else ok "$OWNER_HOME is mode $om (closed to other users)"; fi

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
  if v="$(repo_variable KOSMOS_CI_RUNNER)"; then
    if [ "$v" = on ]; then ok "KOSMOS_CI_RUNNER is on (read only; the runbook keeps it on)"
    else echo "note:   KOSMOS_CI_RUNNER is $v: no job routes to a self-hosted Mac until it is on (verify requires it)"; fi
  else echo "note:   could not read KOSMOS_CI_RUNNER (verify checks it)"; fi

  if [ "$PROBLEMS" -gt 0 ]; then say "preflight: $PROBLEMS refusal(s)"; return 1; fi
  say "preflight: clear"
}

create_user() {
  need_user "$OWNER"
  if id "$CI_USER" >/dev/null 2>&1; then echo "refused: $CI_USER already exists (preflight says whether it is standard)" >&2; exit 1; fi
  preflight --from-create || { echo "refused: preflight did not pass, nothing created" >&2; exit 1; }
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
  [ $# -le 3 ] || { echo "install takes <commit> <sha256> and nothing more" >&2; exit 2; }
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
  if [ "$APPLY" != 1 ] && [ -d "$CI_HOME" ] && [ ! -x "$CI_HOME" ]; then
    echo "note:   cannot look inside $RUNNER_DIR as $(id -un); its .env KOSMOS_ check runs at --apply, as $CI_USER"
  fi
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
    echo "WOULD: write $CI_DIR/job-cleanup.sh, job-completed.sh, job-started.sh (Baron's #5488 hooks, with the dotfile sweep and comments revised here)"
    echo "WOULD: merge into $RUNNER_DIR/.env: ACTIONS_RUNNER_HOOK_JOB_STARTED, ACTIONS_RUNNER_HOOK_JOB_COMPLETED, LANG, PATH (no KOSMOS_ key)"
    return 0
  fi
  # The only change before the checks below: their two directories. "Nothing changed" in a refusal means nothing else.
  mkdir -p "$RUNNER_DIR" "$CI_DIR"; cd "$RUNNER_DIR"
  # Every download and read before the runner is touched, so a refusal never leaves it stopped; after the stop, an
  # EXIT trap starts it again on any failure.
  local newg="$CI_DIR/job-guard.sh.new" got rel ver tgz pub have was_running=0 sv old_listener=""
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$commit/tools/ci-runner-job-guard.sh" -o "$newg" \
    || { rm -f "$newg"; echo "could not fetch the job guard at $commit: nothing changed" >&2; exit 1; }
  got="$(shasum -a 256 "$newg" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { rm -f "$newg"; echo "guard sha256 $got is not $want: refused, nothing changed" >&2; exit 1; }
  rel="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest || true)"
  # Reads the pretty-printed release JSON; any other shape gives no version and refuses below.
  ver="$(printf '%s' "$rel" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1 || true)"
  [ -n "$ver" ] || { rm -f "$newg"; echo "could not read the runner version: nothing changed" >&2; exit 1; }
  tgz="actions-runner-osx-arm64-$ver.tar.gz"
  [ -f "$tgz" ] || curl -fsSLO "https://github.com/actions/runner/releases/download/v$ver/$tgz" || { rm -f "$newg" "$tgz"; echo "could not fetch $tgz: nothing changed" >&2; exit 1; }
  pub="$(printf '%s' "$rel" | grep -o 'BEGIN SHA osx-arm64 -->[0-9a-f]*' | head -1 | sed 's/.*-->//' || true)"
  have="$(shasum -a 256 "$tgz" | cut -d' ' -f1)"
  [ -n "$pub" ] && [ "$pub" = "$have" ] || { rm -f "$tgz" "$newg"; echo "runner package sha256 $have is not the published '${pub:-none}': refused, nothing changed" >&2; exit 1; }
  # MERGE into .env (config.sh writes keys there): keep every key this does not set. Read now, before the stop.
  # grep exits 1 when no line is left (fine) and 2 when it could not read .env, which must not drop config.sh's keys.
  local env_keep=""
  if [ -f "$RUNNER_DIR/.env" ]; then
    if env_keep="$(grep -v -E '^[[:space:]]*(export[[:space:]]+)?(ACTIONS_RUNNER_HOOK_JOB_STARTED|ACTIONS_RUNNER_HOOK_JOB_COMPLETED|PATH|LANG)=' "$RUNNER_DIR/.env")"; then :
    else [ $? = 1 ] || { rm -f "$newg"; echo "could not read $RUNNER_DIR/.env; nothing changed" >&2; exit 1; }; fi   # $? is grep's: an assignment carries its substitution's status
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
    # The Listener that runs now, so the wait after the restart can require a new one.
    old_listener="$(pgrep -u "$(id -u)" -x Runner.Listener || true)"
    case "$sv" in *Started*) was_running=1; ./svc.sh stop >/dev/null 2>&1 || true ;; esac
    if [ "$was_running" = 1 ]; then
      # kosmos#7001: with ExitTimeOut 35 a stop can take up to ~30 s (the Listener ends its GitHub session), so it is
      # polled, not read once.
      local sw=0 slim="${KOSMOS_CI_UNLOAD_WAIT_S:-45}"   # a number: checked at the top
      while case "$(./svc.sh status 2>&1 || true)" in *Started*) true ;; *) false ;; esac && [ "$sw" -lt "$slim" ]; do
        sleep 1; sw=$((sw + 1))
      done
      case "$(./svc.sh status 2>&1 || true)" in
        *Started*) rm -f "$newg"; echo "refused: the runner did not stop in ${sw}s; nothing unpacked. It was told to stop and may still be stopping: ./svc.sh start brings it back" >&2; exit 1 ;;
      esac
      # A tar that fails partway leaves old and new files mixed; the runner is started on that, and says so. A failure
      # after the unpack but before the hooks and .env are rewritten starts the new release on the OLD .env and hooks,
      # which still wire the old guard; the package stays on disk and the next install reuses it after its sha check.
      trap 'echo "install failed after stopping the runner: starting it again on whatever was unpacked; install again" >&2; ./svc.sh start >/dev/null 2>&1 || true' EXIT
    fi
  fi
  # Unpacked over the old release. A runner that updated itself has bin and externals as symlinks to versioned
  # dirs (actions/runner update.sh); tar replaces those with plain dirs of this release. svc.sh install copied
  # bin/runsvc.sh to ./runsvc.sh, naming its node version, so refresh that copy below as svc.sh install would.
  # The old versioned dirs (bin.<ver>, externals.<ver>) stay beside them; prune them by hand when disk runs low.
  tar xzf "$tgz"
  [ ! -f .service ] || cp bin/runsvc.sh runsvc.sh
  chmod +x "$newg"
  mv -f "$newg" "$CI_DIR/job-guard.sh"
  echo "runner $ver unpacked in $RUNNER_DIR; job guard installed from $commit, sha256 $got"
  # Job hooks. NOT a fresh VM: the checkout and ~ persist between jobs. They end what a previous job left running,
  # and only THIS user's: the agents' processes (another user) are never touched.
  for h in cleanup completed started; do hook_body "$h" | put "$CI_DIR/job-$h.sh" 755; done
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
    wait_for_listener "$old_listener"
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
    printf 'WOULD: %q install\n' ./svc.sh
    echo "WOULD: add KeepAlive {SuccessfulExit: false}, ThrottleInterval 10 and ExitTimeOut 35 to the LaunchAgent svc.sh writes (kosmos#7001)"
    printf 'WOULD: %q start\n' ./svc.sh
    return 0
  fi
  [ -x "$RUNNER_DIR/config.sh" ] || { echo "refused: no runner in $RUNNER_DIR; run install first" >&2; exit 1; }
  # Registered already: config.sh would replace the registration and then svc.sh install would fail on its plist.
  [ ! -f "$RUNNER_DIR/.service" ] || { echo "refused: $RUNNER_DIR is registered as a service already; to register again, as $CI_USER: ./svc.sh uninstall and ./config.sh remove (with a removal token), then register" >&2; exit 1; }
  # Configured already (.runner): config.sh refuses to configure again until ./config.sh remove, whatever --replace says.
  [ ! -f "$RUNNER_DIR/.runner" ] || { echo "refused: $RUNNER_DIR is configured already; to register again, as $CI_USER: ./config.sh remove (with a removal token), then register" >&2; exit 1; }
  # The job guard is the boundary on a public repo: never register a runner that would take jobs without it, nor one
  # whose .env would turn the suite lock off.
  if grep -q -E '^[[:space:]]*(export[[:space:]]+)?KOSMOS_' "$RUNNER_DIR/.env" 2>/dev/null; then
    echo "refused: $RUNNER_DIR/.env sets a KOSMOS_ variable (a wait control there turns the suite lock off); remove it" >&2; exit 1
  fi
  local k f
  for k in STARTED COMPLETED; do
    f="job-$(printf '%s' "$k" | tr '[:upper:]' '[:lower:]').sh"
    [ "$(grep -c "^ACTIONS_RUNNER_HOOK_JOB_$k=" "$RUNNER_DIR/.env" 2>/dev/null || true)" = 1 ] \
      && grep -q -F -x "ACTIONS_RUNNER_HOOK_JOB_$k=$CI_DIR/$f" "$RUNNER_DIR/.env" \
      || { echo "refused: $RUNNER_DIR/.env does not wire ACTIONS_RUNNER_HOOK_JOB_$k to $CI_DIR/$f once; run install" >&2; exit 1; }
  done
  for f in job-guard.sh job-started.sh job-completed.sh job-cleanup.sh; do
    [ -x "$CI_DIR/$f" ] || { echo "refused: $CI_DIR/$f is missing or not executable; run install" >&2; exit 1; }
  done
  cd "$RUNNER_DIR"
  local token=""
  if [ -t 0 ]; then printf 'registration token: ' >&2; IFS= read -r -s token || true; echo >&2; else IFS= read -r token || true; fi
  [ -n "$token" ] || { echo "refused: no registration token on stdin" >&2; exit 1; }
  # The runner reads ACTIONS_RUNNER_INPUT_<ARG> for a config argument it is not given, so the token stays out of argv.
  ACTIONS_RUNNER_INPUT_TOKEN="$token" ./config.sh --unattended --url "$REPO_URL" --name "$NAME" --labels "$LABELS" --work _work --replace
  printf '%s\n' "$RUNNER_PATH" > .path
  ./svc.sh install   # a LaunchAgent for this user (starts at login)
  local plist; plist="$(runner_plist)"
  [ -n "$plist" ] || { echo "FAILED: svc.sh install wrote no actions.runner LaunchAgent under $CI_HOME/Library/LaunchAgents" >&2; exit 1; }
  add_keepalive "$plist" || { echo "FAILED: could not add KeepAlive to $plist (a killed runner would stay offline); the runner is registered but not started: as $CI_USER, tools/ci-runner-setup.sh --apply keepalive, then ./svc.sh start" >&2; exit 1; }
  # A Listener already running (a runner started by hand with ./run.sh) must not count as the service's.
  local before_start; before_start="$(pgrep -u "$(id -u)" -x Runner.Listener || true)"
  ./svc.sh start
  wait_for_listener "$before_start"
  ./svc.sh status
}

# wait_for_listener <pid before>: svc.sh start is a launchctl load, which succeeds for a service that dies at once.
# A Listener other than <pid before> (the old one may still be shutting down) must appear, or this fails.
# <pids before> may hold several (one per line): the old Listener can outlive the stop, so any pid not among them counts.
wait_for_listener() {
  local before="$1" now waited=0 limit="${KOSMOS_CI_START_WAIT_S:-30}"
  case "$limit" in ''|*[!0-9]*) echo "FAILED: KOSMOS_CI_START_WAIT_S is '$limit', not a number of seconds" >&2; exit 1 ;; esac
  local prc
  while prc=0; now="$(pgrep -u "$(id -u)" -x Runner.Listener)" || prc=$?
        [ "$prc" -lt 2 ] || { echo "FAILED: could not list processes (pgrep exit $prc) to see whether the runner started" >&2; exit 1; }
        [ -z "$(printf '%s\n' "$now" | grep -v -x -F -e "${before:-none}" || true)" ]; do
    [ "$waited" -lt "$limit" ] || { echo "FAILED: the runner was loaded but no new Runner.Listener is running after ${waited}s; see ~/Library/Logs/actions.runner.*/stderr.log" >&2; exit 1; }
    sleep 1; waited=$((waited + 1))
  done
}

# runner_busy: prints true or false; fails when the API could not say.
runner_busy() {
  gh api --paginate "repos/$REPO/actions/runners" --jq "$(jq_busy)" 2>/dev/null
}

# keepalive: as the CI user, over ssh or in its session. Adds KeepAlive to an installed runner's LaunchAgent and reloads
# it while the runner is idle (the reload stops it, and a job in flight would fail). It names the GUI domain, gui/<uid>,
# so unlike svc.sh it works over ssh (measured on the old Agent1s Mac, 2026-10-23); the user must be logged in. A dry
# run says whether KeepAlive is already set, which is how to check a runner whose home the owner cannot read.
keepalive() {
  need_user "$CI_USER" ssh-ok
  mode_line
  local plist label dom; plist="$(runner_plist)"
  if [ -z "$plist" ]; then
    # Another user (the owner, say) cannot read the CI user's runner: say that, not "register first", which is the CI
    # user's own answer when .service names no plist.
    if [ "$(id -un)" != "$CI_USER" ]; then echo "note:   cannot read $CI_USER's runner as $(id -un); run this as $CI_USER"; return 0; fi
    echo "refused: $RUNNER_DIR/.service names no LaunchAgent under $CI_HOME/Library/LaunchAgents; register first" >&2; exit 1
  fi
  label="$(plutil -extract Label raw -o - "$plist" 2>/dev/null)" && [ -n "$label" ] \
    || { echo "refused: cannot read the Label of $plist" >&2; exit 1; }
  local ciuid; ciuid="$(id -u "$CI_USER" 2>/dev/null)" || { echo "refused: no user $CI_USER on this Mac" >&2; exit 1; }
  dom="gui/$ciuid"   # the CI user's domain, whoever reads it (a dry run may be someone else's)
  cd "$RUNNER_DIR" || { echo "refused: no runner in $RUNNER_DIR" >&2; exit 1; }
  local limit="${KOSMOS_CI_UNLOAD_WAIT_S:-45}"   # over the old job's own exit timeout; a number: checked at the top
  launchctl print "$dom" >/dev/null 2>&1 || { echo "refused: no $dom domain ($CI_USER is not logged in, so its runner cannot run); log in, then run this again" >&2; exit 1; }
  # Three facts: the plist has it, the job is loaded, the LOADED job has it. Only all three mean a kill is survived.
  local in_file=0 loaded=0 in_job=0
  keepalive_set "$plist" && in_file=1
  launchctl print "$dom/$label" >/dev/null 2>&1 && loaded=1
  [ "$loaded" = 1 ] && loaded_keepalive "$dom/$label" && in_job=1
  if [ "$in_file" = 1 ] && [ "$in_job" = 1 ]; then
    # Loaded is not running: a job that exited 0 (a stop of the service, a session conflict) stays loaded and down.
    # Re-read for a while first: between a crash and launchd's restart (its throttle, up to 10 s) a job is not running.
    local jo st w3=0 lim3="${KOSMOS_CI_STATE_WAIT_S:-12}"   # a number: checked at the top
    while :; do
      jo="$(launchctl print "$dom/$label" 2>/dev/null || true)"
      st="$(printf '%s\n' "$jo" | sed -n 's/^[[:space:]]state = //p' | head -n 1)"
      [ "$st" = running ] && { ok "$label restarts after a SIGKILL or a crash (KeepAlive SuccessfulExit false, in the plist and loaded), and is running"; return 0; }
      [ "$w3" -lt "$lim3" ] || break
      sleep 1; w3=$((w3 + 1))
    done
    echo "DOWN: $label has KeepAlive loaded but has not been running for ${w3}s (state = ${st:-unknown}): if it exited 0 (a stop of the service, a session conflict), KeepAlive leaves it down. To start it: launchctl kickstart $dom/$label" >&2; exit 1
  fi
  # Not loaded, yet THIS runner's Listener runs (not the relay's: its dir is actions-runner-relay): it was loaded some
  # other way (svc.sh over ssh, by hand), and a bootstrap here would start a second copy.
  local own=0 prc=0
  if [ "$loaded" = 0 ]; then
    pgrep -u "$(id -u)" -f "$RUNNER_DIR/bin[^/]*/Runner.Listener" >/dev/null || prc=$?
    [ "$prc" -lt 2 ] || { echo "refused: could not list processes (pgrep exit $prc) to tell whether this runner runs" >&2; exit 1; }
    [ "$prc" = 0 ] && own=1
  fi
  if [ "$APPLY" != 1 ]; then
    [ "$in_file" = 1 ] || echo "note:   $plist lacks $(keepalive_missing "$plist"): a killed runner may stay offline"
    [ "$in_file" = 1 ] && [ "$loaded" = 1 ] && echo "note:   $plist has KeepAlive but the LOADED $label does not show it (this reads launchctl print's 'successful exit => 0' and 'exit timeout' lines): it needs a reload"
    [ "$in_file" = 1 ] || echo "WOULD: add KeepAlive {SuccessfulExit: false}, ThrottleInterval 10 and ExitTimeOut 35 to $plist"
    # Exit 1 for a runner that is not running as it should (as --apply does), 0 for a change it would make.
    if [ "$own" = 1 ]; then echo "refused: its Listener runs but $label is not loaded in $dom: reload it there by hand" >&2; exit 1
    elif [ "$loaded" = 1 ]; then
      # Loaded but not running (it exited 0, a stop or a session conflict): the reload's RunAtLoad starts it, which is
      # the point here (KeepAlive would not), so this is a change to make (exit 0), unlike a runner that is not loaded.
      local js; js="$(launchctl print "$dom/$label" 2>/dev/null | sed -n 's/^[[:space:]]state = //p' | head -n 1 || true)"
      [ "$js" = running ] || echo "note:   $label is loaded but not running now (state = ${js:-unknown}): the reload below starts it"
      echo "WOULD: only while no job runs: stop $label with SIGTERM, then reload it"
      printf 'WOULD: launchctl kill SIGTERM %s\nWOULD: launchctl bootout %s\nWOULD: launchctl bootstrap %s %s\n' "$dom/$label" "$dom/$label" "$dom" "$plist"
    else echo "DOWN: $label is not loaded, so the runner is not running; --apply puts KeepAlive in the plist and does not start it" >&2; exit 1; fi
    return 0
  fi
  if [ "$in_file" = 0 ]; then
    add_keepalive "$plist" || { echo "FAILED: could not add KeepAlive to $plist; nothing reloaded" >&2; exit 1; }
    ok "KeepAlive added to $plist"
  fi
  if [ "$loaded" = 0 ]; then
    if [ "$own" = 1 ]; then
      echo "refused: this runner's Listener runs but $label is not loaded in $dom (started another way?); KeepAlive is in the plist; stop it, then: launchctl bootstrap $dom $plist" >&2; exit 1
    fi
    # Not started here: a stop on purpose (svc.sh stop unloads it, without -w, so no disabled override blocks the
    # bootstrap this message suggests) must stay a stop. But this cannot be told from a
    # runner this stage left down (a bootout that finished late, a failed bootstrap), so it is said loudly and is not ok.
    echo "DOWN: $label is not loaded, so the runner is not running; KeepAlive is in its plist. To start it: launchctl bootstrap $dom $plist (or ./svc.sh start in $CI_USER's session)" >&2; exit 1
  fi
  # Checked last, just before the bootout, to keep the window short: a job the Listener accepted but has not yet handed
  # to a Worker is not seen and would be cancelled by the reload (as install's stop accepts too). -x, as install's check:
  # after a self-update the Worker runs from bin.<version>, so a path match on bin/Runner.Worker would miss it.
  prc=0; pgrep -u "$(id -u)" -x Runner.Worker >/dev/null || prc=$?
  [ "$prc" -lt 2 ] || { echo "refused: could not list processes (pgrep exit $prc) to rule out a running job; KeepAlive is in the plist, not yet loaded: run this again" >&2; exit 1; }
  # Any Worker of this user, this runner's or the relay's (#6245): a name match cannot tell them apart, and a path match
  # could miss a Worker started with a relative path, whose job the reload would then cancel. Refusing is the safe side.
  [ "$prc" = 1 ] || { echo "refused: a job is running under $CI_USER (Runner.Worker is up, on this runner or the relay's); KeepAlive is in the plist, not yet loaded: run this again when both are idle" >&2; exit 1; }
  local own_re="$RUNNER_DIR/bin[^/]*/Runner.Listener" before; prc=0; before="$(pgrep -u "$(id -u)" -f "$own_re")" || prc=$?
  [ "$prc" -lt 2 ] || { echo "refused: could not list processes (pgrep exit $prc) to note the running Listener; KeepAlive is in the plist, not yet loaded: run this again" >&2; exit 1; }
  # Stop it with SIGTERM first and wait for it to end by itself: the LOADED job may still carry launchd's default 5 s exit
  # timeout, and a bootout alone would SIGKILL the Listener before it ends its GitHub session (the reload would then
  # cause the very session conflict ExitTimeOut is there to prevent). The exit is 0 (a stop), which a loaded
  # KeepAlive {SuccessfulExit: false} does not restart; the bootout after it finds nothing left to kill.
  # A disabled override would let the bootout below succeed and the bootstrap fail (5: Input/output error), leaving the
  # runner stopped. launchctl print-disabled lists it as "<label>" => disabled (or true): refuse before stopping anything.
  local dis; dis="$(launchctl print-disabled "$dom" 2>/dev/null || true)"
  if printf '%s\n' "$dis" | grep -F "\"$label\"" | grep -q -E '=> (disabled|true)'; then
    echo "refused: $label is disabled in $dom, so it could be stopped but not loaded again; nothing was stopped. Enable it first: launchctl enable $dom/$label" >&2; exit 1
  fi
  # From here to the bootstrap the runner is being stopped: a dropped ssh session must not end the script in the middle.
  # SIGHUP and SIGPIPE are ignored and the window's one message cannot fail it; the launchctl calls' own output to a
  # gone terminal is the residual. For a session you may lose, run the stage under nohup.
  trap '' HUP PIPE
  # An interrupt (Ctrl-C, a kill of this script) in the window says what state it may have left, then exits 130.
  trap 'echo "INTERRUPTED while reloading $label: the runner may be stopped. If launchctl print $dom/$label lists it: launchctl kickstart $dom/$label; if not: launchctl bootstrap $dom $plist" >&2 || true; trap - EXIT; exit 130' INT TERM
  local sent=0 outlived=0
  local jo2 opid w4=0; jo2="$(launchctl print "$dom/$label" 2>/dev/null || true)"
  opid="$(printf '%s\n' "$jo2" | sed -n 's/^[[:space:]]pid = \([0-9][0-9]*\)$/\1/p' | head -n 1)"
  # No pid in launchd's print while this runner's Listener runs: the print format may have changed. Booting out then
  # would run under the old exit timeout, the cut this step prevents: refuse before anything is stopped.
  if [ -z "$opid" ] && [ -n "$before" ]; then
    echo "refused: launchctl print shows no pid for $label, though a Listener of $RUNNER_DIR runs (started another way, by hand or orphaned, or launchd's print format changed); nothing was stopped, KeepAlive is in the plist, not yet loaded" >&2; exit 1
  fi
  # The service runs but no Listener of this runner does: it is between Listeners (RunnerService.js relaunches one 5 s
  # after an exit, and a self-update moves bin/ while none runs). A SIGTERM now could end the updater half way and leave
  # the install without bin/: refuse.
  if [ -n "$opid" ] && [ -z "$before" ]; then
    echo "refused: $label runs but no Listener of $RUNNER_DIR does (restarting or self-updating); nothing was stopped, KeepAlive is in the plist, not yet loaded: run this again in a minute" >&2; exit 1
  fi
  [ -n "$opid" ] || echo "note:   $label has no process, so no SIGTERM first" || true
  if [ -n "$opid" ]; then
    launchctl kill SIGTERM "$dom/$label" \
      || { echo "refused: launchctl kill SIGTERM $dom/$label failed; nothing was stopped, KeepAlive is in the plist, not yet loaded: run this again" >&2; exit 1; }
    sent=1
    while kill -0 "$opid" 2>/dev/null && [ "$w4" -lt "$limit" ]; do sleep 1; w4=$((w4 + 1)); done
    # Still alive: it was told to stop, so going on is the lesser harm (refusing now would leave a runner that may yet
    # stop under its OLD definition, with nothing to restart it). Said, so an offline runner afterwards has a reason.
    if kill -0 "$opid" 2>/dev/null; then
      outlived=1
      echo "note:   the old runner (pid $opid) had not ended ${w4}s after SIGTERM; the bootout may cut its GitHub session short, and if it then reads offline (a session conflict), start it again with: launchctl kickstart $dom/$label" || true
    fi
  fi
  local bo=0; launchctl bootout "$dom/$label" || bo=$?
  # A failed bootout still waits: launchd can report an error while the job is still shutting down (the Listener ends
  # its GitHub session first), so "still loaded" cannot be told from "still unloading" at once.
  local waited=0
  while launchctl print "$dom/$label" >/dev/null 2>&1 && [ "$waited" -lt "$limit" ]; do sleep 1; waited=$((waited + 1)); done
  if launchctl print "$dom/$label" >/dev/null 2>&1; then
    if [ "$sent" = 1 ] && [ "$outlived" = 0 ]; then
      echo "FAILED: launchctl bootout $dom/$label (exit $bo) had not unloaded it after ${waited}s; the runner is STOPPED (SIGTERM ended it; still loaded from the OLD definition, or unloading). Run this again: it boots out and bootstraps. If it is no longer listed: launchctl bootstrap $dom $plist" >&2; exit 1
    fi
    echo "FAILED: launchctl bootout $dom/$label (exit $bo) had not unloaded it after ${waited}s; it may still be unloading. Check: launchctl print $dom/$label. Loaded: it runs the OLD definition, without KeepAlive (run this again). Not loaded: the runner is DOWN (launchctl bootstrap $dom $plist)" >&2; exit 1
  fi
  # Up to three tries: a bootstrap right after a bootout can fail once (5: Input/output error).
  local ba=1 bok=0
  while :; do
    if launchctl bootstrap "$dom" "$plist"; then bok=1; break; fi
    launchctl print "$dom/$label" >/dev/null 2>&1 && { bok=1; break; }   # an error, yet loaded: that load stands
    [ "$ba" -lt 3 ] || break
    ba=$((ba + 1)); sleep 1
  done
  if [ "$bok" = 0 ]; then
    if launchctl print "$dom/$label" >/dev/null 2>&1; then
      echo "FAILED: launchctl bootstrap $dom $plist reported an error, but $label is loaded; check it runs (launchctl print $dom/$label), then run this again" >&2; exit 1
    fi
    echo "FAILED: launchctl bootstrap $dom $plist; the runner is STOPPED (not loaded): launchctl bootstrap $dom $plist, or ./svc.sh start in $CI_USER's session" >&2; exit 1
  fi
  trap - INT TERM   # loaded again: an interrupt from here on leaves a runner launchd keeps alive
  # A new Listener of THIS runner (its own dir), not any Listener of the user: the relay's can respawn meanwhile. The
  # argv is RunnerService.js's spawn of an absolute path, measured with ps on the old Agent1s Mac (10-23):
  # /Users/kosmos-ci/actions-runner/bin/Runner.Listener run --startuptype service (it joins ../bin, so bin/ even after a
  # self-update; bin[^/]* is only broader than needed and still excludes actions-runner-relay).
  local now w2=0 lim2="${KOSMOS_CI_START_WAIT_S:-30}"   # a number: checked at the top
  while prc=0; now="$(pgrep -u "$(id -u)" -f "$own_re")" || prc=$?
        [ "$prc" -lt 2 ] || { echo "FAILED: could not list processes (pgrep exit $prc) to see whether the runner started; $label was loaded" >&2; exit 1; }
        [ -z "$(printf '%s\n' "$now" | grep -v -x -F -e "${before:-none}" | grep . || true)" ]; do
    [ "$w2" -lt "$lim2" ] || { echo "FAILED: $label was loaded but no new Listener of $RUNNER_DIR is running after ${w2}s; see ~/Library/Logs/$label/stdout.log. If it crashed, launchd restarts it (KeepAlive is loaded); if it exited 0: launchctl kickstart $dom/$label" >&2; exit 1; }
    sleep 1; w2=$((w2 + 1))
  done
  if ! loaded_keepalive "$dom/$label"; then
    local lo; lo="$(launchctl print "$dom/$label" 2>/dev/null || true)"
    if printf '%s\n' "$lo" | grep -x -E '[[:space:]]*successful exit => 0' >/dev/null; then
      echo "FAILED: $label was reloaded and runs with KeepAlive, but launchctl print shows its exit timeout under 35 ($(printf '%s\n' "$lo" | sed -n 's/^[[:space:]]*exit timeout = //p' | head -n 1)): check ExitTimeOut in $plist" >&2; exit 1
    fi
    echo "FAILED: $label was reloaded and runs, but launchctl print shows no 'successful exit => 0' semaphore, the wording this check keys on (measured on macOS 2026-10). If launchctl print $dom/$label shows KeepAlive some other way, the check is what is wrong, not the runner" >&2; exit 1
  fi
  ok "the runner is running again, with KeepAlive loaded; it reads online on GitHub within a few minutes (verify, as $OWNER, checks)" || true
}

verify() {
  need_user "$OWNER"
  say "the runner, from the API"
  local row
  row="$(gh api --paginate "repos/$REPO/actions/runners" --jq "$(jq_row)")" \
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
    if [ "$status" = online ]; then ok "$NAME online (busy=$busy)"; else problem "$NAME is $status"; fi
    if [ "${labels:-}" = "$want_labels" ]; then ok "labels exactly $want_labels"; else problem "labels are '${labels:-}', not $want_labels"; fi
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
  # -e cannot see into a home the caller may not traverse, so a hidden .env is "cannot read", not "missing".
  local hidden=0
  if [ -d "$CI_HOME" ] && { [ ! -x "$CI_HOME" ] || { [ -d "$RUNNER_DIR" ] && [ ! -x "$RUNNER_DIR" ]; }; }; then
    hidden=1; unchecked "cannot look inside $RUNNER_DIR as $(id -un); its .env, hooks and KOSMOS_ keys"
  elif [ ! -e "$RUNNER_DIR/.env" ]; then problem "no $RUNNER_DIR/.env: install has not run here, so no job guard is wired"
  elif [ ! -r "$RUNNER_DIR/.env" ]; then unchecked "cannot read $RUNNER_DIR/.env as $(id -un); its hooks and KOSMOS_ keys"
  else
    if grep -q -E '^[[:space:]]*(export[[:space:]]+)?KOSMOS_' "$RUNNER_DIR/.env"; then problem "$RUNNER_DIR/.env sets a KOSMOS_ variable: remove it"
    else ok "$RUNNER_DIR/.env sets no KOSMOS_ variable"; fi
    for k in STARTED COMPLETED; do
      f="job-$(printf '%s' "$k" | tr '[:upper:]' '[:lower:]').sh"
      # The runner sets .env lines in order, so a second line for the key would override the first.
      if [ "$(grep -c "^ACTIONS_RUNNER_HOOK_JOB_$k=" "$RUNNER_DIR/.env")" -gt 1 ]; then problem "$RUNNER_DIR/.env sets ACTIONS_RUNNER_HOOK_JOB_$k more than once: the last one wins"
      elif grep -q -F -x "ACTIONS_RUNNER_HOOK_JOB_$k=$CI_DIR/$f" "$RUNNER_DIR/.env"; then ok "the $f hook is wired"
      else problem "$RUNNER_DIR/.env does not set ACTIONS_RUNNER_HOOK_JOB_$k=$CI_DIR/$f: the job guard is not wired"; fi
    done
  fi
  if [ "$hidden" = 0 ] && [ ! -e "$CI_DIR" ]; then problem "no $CI_DIR: the job guard and its hooks are not installed"
  elif [ "$hidden" = 1 ]; then :   # counted once above
  elif [ -r "$CI_DIR" ] && [ -x "$CI_DIR" ]; then
    for f in job-guard.sh job-started.sh job-completed.sh job-cleanup.sh; do
      [ -x "$CI_DIR/$f" ] || problem "$CI_DIR/$f is missing or not executable"
    done
    # The hooks around the guard, byte for byte: rewriting job-started.sh to skip the guard would leave the guard pinned.
    for h in cleanup completed started; do
      if [ -r "$CI_DIR/job-$h.sh" ]; then
        if hook_body "$h" | cmp -s - "$CI_DIR/job-$h.sh"; then ok "job-$h.sh is what install writes"
        else problem "$CI_DIR/job-$h.sh differs from what install writes: something rewrote it"; fi
      fi
    done
    # A job the guard admits could rewrite it (the header): KOSMOS_CI_GUARD_SHA, the install pin, makes drift a problem.
    if [ -r "$CI_DIR/job-guard.sh" ]; then
      local gs; gs="$(shasum -a 256 "$CI_DIR/job-guard.sh" | cut -d' ' -f1)"
      if [ -z "${KOSMOS_CI_GUARD_SHA:-}" ]; then unchecked "the job guard's integrity: its sha256 is $gs; set KOSMOS_CI_GUARD_SHA to the install pin"
      elif [ "$gs" = "$KOSMOS_CI_GUARD_SHA" ]; then ok "job guard sha256 is the install pin"
      else problem "job guard sha256 $gs is not the install pin $KOSMOS_CI_GUARD_SHA: something rewrote it"; fi
    fi
  else unchecked "cannot read $CI_DIR as $(id -un); the hook files"; fi
  # .env's PATH wins for jobs (see RUNNER_PATH), so a different .path is a note, not a problem. config.sh refills it
  # from its own shell, so a re-register (./svc.sh uninstall and ./config.sh remove first) can undo register's.
  if [ "$hidden" = 1 ]; then :
  elif [ ! -e "$RUNNER_DIR/.path" ]; then ok "no $RUNNER_DIR/.path here"
  elif [ ! -r "$RUNNER_DIR/.path" ]; then echo "note:   cannot read $RUNNER_DIR/.path as $(id -un)"
  elif [ "$(cat "$RUNNER_DIR/.path")" = "$RUNNER_PATH" ]; then ok ".path is the PATH .env sets"
  else echo "note:   $RUNNER_DIR/.path is not $RUNNER_PATH (config.sh's own shell PATH?). Jobs use .env's PATH; to tidy it, write that line to .path"; fi
  # job-completed sweeps the job's temp only when RUNNER_TEMP matches its path; leftovers while idle say it did not.
  if [ "$hidden" = 0 ] && [ -d "$RUNNER_DIR/_work/_temp" ] && [ -r "$RUNNER_DIR/_work/_temp" ] && [ "$busy" != true ] \
     && [ -n "$(ls -A "$RUNNER_DIR/_work/_temp" 2>/dev/null)" ]; then
    echo "note:   $RUNNER_DIR/_work/_temp is not empty while idle: the job-completed sweep may not be running"
  fi
  say "the runner's LaunchAgent (a killed runner must come back by itself: kosmos#7001)"
  local plist; plist="$(runner_plist)"
  if [ "$hidden" = 1 ]; then
    echo "note:   cannot look inside $RUNNER_DIR as $(id -un); as $CI_USER, tools/ci-runner-setup.sh keepalive (a dry run) says whether KeepAlive is set and loaded"
  elif [ -n "$plist" ] && [ -r "$plist" ]; then
    if keepalive_set "$plist"; then ok "$plist has KeepAlive SuccessfulExit false (whether the LOADED runner has it: as $CI_USER, tools/ci-runner-setup.sh keepalive)"
    else problem "$plist lacks $(keepalive_missing "$plist"): a killed runner may stay offline; as $CI_USER: tools/ci-runner-setup.sh --apply keepalive"; fi
  elif [ -r "$RUNNER_DIR/.service" ] && [ -z "$plist" ]; then
    echo "note:   $RUNNER_DIR/.service names no LaunchAgent under $CI_HOME/Library/LaunchAgents that $(id -un) can see (its ~/Library is closed to other users); as $CI_USER, tools/ci-runner-setup.sh keepalive (a dry run) says whether KeepAlive is set and loaded"
  elif [ -e "$RUNNER_DIR/.service" ]; then
    echo "note:   cannot read $RUNNER_DIR/.service as $(id -un); as $CI_USER, tools/ci-runner-setup.sh keepalive (a dry run) says whether KeepAlive is set and loaded"
  else
    echo "note:   no $RUNNER_DIR/.service: the runner is not registered as a service here, so there is no LaunchAgent to check"
  fi
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
    # was started with, measured 05:12 CDT 10-14, but some builds retitle it "tmux: server"). The runner's own service host is node running RunnerService.js.
    left="$(printf '%s\n' "$left" | awk '{ n = $1; sub(/.*\//, "", n); sub(/:$/, "", n) } (n == "tmux" || n == "node") && !/\/bin\/RunnerService\.js/ { print n }')"
    if [ -z "$left" ]; then ok "no tmux or node left under $CI_USER"
    elif [ "$busy" = true ]; then ok "tmux or node running under $CI_USER, while a job is in flight (busy=true)"
    else problem "$CI_USER still runs: $(printf '%s\n' "$left" | sort | uniq -c | tr -s ' ' | tr '\n' ' ')with no job in flight"; fi
  fi
  if [ "$PROBLEMS" -gt 0 ]; then say "verify: $PROBLEMS problem(s)"; return 1; fi
  # Whether the job guard is wired is what verify exists to say; a check it could not make is not a pass.
  if [ "$UNCHECKED" -gt 0 ]; then say "verify: no problem found, but $UNCHECKED check(s) could not be made (see the UNCHECKED lines: set KOSMOS_CI_GUARD_SHA, or give the owner read access to $CI_USER's home)"; return 3; fi
  say "verify: clear"
}

machine_settings() {
  cat <<EOF
# Settings that need an admin, in System Settings (printed, never run):
#  1. Users & Groups: automatic login as $CI_USER. The runner is a LaunchAgent of $CI_USER, so after a restart it is
#     offline until $CI_USER is logged in. Needs FileVault off (preflight checks it).
#  2. Energy: keep "prevent automatic sleeping" and "start up after a power failure" (preflight checks both).
#  3. Log in as $CI_USER once in Screen Sharing before install: its home and GUI session come with that login.
#  4. Keep $OWNER_HOME at mode 700 (preflight checks it). If $CI_USER's own home is closed too, verify run as
#     $OWNER cannot see the runner's files and exits 3 (unchecked). Keep $CI_USER's home at the macOS default 750
#     (group staff) so $OWNER can read it. Do NOT sign $CI_USER in to gh to run verify itself: verify's API half needs a
#     token that could read the repo's runners and variables, and every CI job admitted could read it from there.
#  5. $CI_USER cannot read this script in $OWNER_HOME: fetch it at the install commit and match its sha256 (see the
#     header, "HOW kosmos-ci GETS THIS SCRIPT").
EOF
}

# The CI user must never be the owner: job-cleanup.sh ends every tmux and node process of the CI user, which would be the
# agents' own (the runbook's reason for a dedicated user). Refused for every stage, dry or not, by name and by uid.
if [ "$CI_USER" = "$OWNER" ]; then echo "refused: KOSMOS_CI_USER and KOSMOS_CI_OWNER are both '$OWNER'; the CI user must be its own account" >&2; exit 2; fi
if ci_uid="$(id -u "$CI_USER" 2>/dev/null)" && owner_uid="$(id -u "$OWNER" 2>/dev/null)" && [ "$ci_uid" = "$owner_uid" ]; then
  echo "refused: $CI_USER and $OWNER are the same account (uid $ci_uid); the CI user must be its own account" >&2; exit 2
fi

case "$STAGE" in
  preflight) preflight ;;
  create-user) create_user ;;
  install) install_runner "$@" ;;
  register) register ;;
  verify) verify ;;
  keepalive) keepalive ;;
  machine-settings) machine_settings ;;
  jq-programs) printf '%s\n' "$JQ_VAR" "$(jq_busy)" "$(jq_row)" ;;   # changes nothing; for the test
  *) echo "usage: tools/ci-runner-setup.sh [--apply] preflight | create-user | install <commit> <sha256> | register | keepalive | verify | machine-settings | jq-programs" >&2; exit 2 ;;
esac
