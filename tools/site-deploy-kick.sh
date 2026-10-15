#!/bin/bash
# kosmos#6266: the reliable 15-minute backstop for chaoskosmos-site's "site deploy" workflow.
#
# Why: the workflow deploys on every push to site main and, as a backstop, on a 15-minute GitHub schedule. On
# 2026-10-15 the push run skipped because the 0.7.51 cut was running ("main waits for the next tick"), the cut then
# failed and published nothing, and GitHub fired the 15-minute schedule only six times that day (00:32, 05:15, 10:12,
# 15:05, 19:08, 22:19 UTC), so the change waited until a person dispatched the workflow by hand. GitHub documents
# scheduled workflows as best effort, delayed or dropped under load, so the backstop cannot rest on it.
#
# What: run every 15 minutes by launchd on Mortals (tools/install-site-deploy-kick.sh), this asks the workflow to run
# (workflow_dispatch, ref main) only when site main is ahead of what the deploy job last published, using the job's
# own state folder. Everything else stays the job's: the cut check, the lock, retries and parking, the reports. So:
#   - paused (a person made ~/.kosmos-site-autodeploy/paused): nothing is asked;
#   - main equals last-deployed, or main is the parked sha: nothing is asked (the job reports a parked sha itself);
#   - a site deploy run on main is queued or running: nothing is asked. A queued one deploys main as it is when it
#     starts; a merge made while one is already running waits for the next tick;
#   - a site deploy run on main was created, or (one that FAILED) ended, less than KICK_GAP_S (14 minutes) ago:
#     nothing is asked (review 6: only a failure's end counts, so a slow green run, a skip behind a cut or a retry exit
#     does not push the next ask to 30 minutes), so this backstop never adds a tick of its own beside a recent run (the job
#     retries a failure once on the next tick and then parks it; asking sooner would spend that retry within minutes,
#     reviews 1 and 3). GitHub's push and schedule triggers still fire on their own, as before;
#   - otherwise one dispatch. A tick the job skips (a cut still running) is asked again 15 minutes later.
# A STUCK run is not counted as active (review 2: one would otherwise silence this backstop for good): one not finished
# 3 hours after it was created. One limit from creation, because GitHub stamps a run's startedAt at creation too
# (measured on chaoskosmos-site 2026-10-15: equal on every run), so queue time and running time cannot be told apart;
# 3 hours is the job's 45-minute timeout plus a long wait behind CI on the shared runner (reviews 3 and 4). It gets a
# line, the tick still asks (a new dispatch replaces a stuck pending run; behind a stuck queued one it waits its turn),
# and the tick exits 1 so launchctl's last exit code shows it. A run that really waited near 3 hours behind CI and is
# now inside its own 45 minutes is called stuck too (one misleading line and one extra pending dispatch): the cost of
# not being able to see when a run started. While a release cut runs, each tick's run is skipped by the job in
# seconds: one short run per 15 minutes on the shared runner, the pace the schedule was meant to have.
# Each tick writes the time to its heartbeat file (it proves launchd STARTED the tick, not that gh worked; the log
# says what the tick did), so a quiet log can be told apart from a job that never runs. A tick prints only when it asks, cannot read something, or sees a stuck run
# (at most two lines); the log is not rotated (about 10 KB a day at worst, a line a tick; kept by --uninstall).
#
# Fails closed (review 5): with no state folder (the job has never run here, or this looks in the wrong place), the
# pause, the parked sha and last-deployed cannot be read, so it asks nothing, says so, and exits 1.
# --check prints what a tick would do (main, last deployed, runs, the decision) and dispatches nothing, and the kosmos
# commit the installer copied it from.
# Env (tests point these at fakes): KOSMOS_SITE_REPO, KOSMOS_AUTODEPLOY_STATE, KOSMOS_GH, KOSMOS_KICK_HEARTBEAT,
# KOSMOS_KICK_NOW (epoch seconds, for tests).
set -u
REPO="${KOSMOS_SITE_REPO:-joshualeestone/chaoskosmos-site}"
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
GH="${KOSMOS_GH:-/opt/homebrew/bin/gh}"
BEAT="${KOSMOS_KICK_HEARTBEAT:-$HOME/.local/libexec/kosmos-site-deploy-kick/last-tick}"
KICK_GAP_S=840
STUCK_S=10800   # not finished 3 hours after creation
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
LAST_LINE=""
say() { LAST_LINE="$*"; printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }
note() { [ "$CHECK" = 1 ] && say "check: $*"; return 0; }
# BSD date on macOS (Mortals); GNU date's -d on Linux, where the tests also run.
epoch() { date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null || date -u -d "$1" +%s 2>/dev/null; }
ERR="$(mktemp -t kick-err.XXXXXX 2>/dev/null)" || { say "could not make a temporary file; nothing asked"; exit 1; }
# Review 6: every tick leaves its result (exit code and its last line) in last-result, beside the heartbeat, so a
# failing backstop is one file to look at, and --check shows it.
RESULT="$(dirname "$BEAT")/last-result"
trap 'rc_=$?; rm -f "$ERR"; [ "$CHECK" = 1 ] || printf "%s rc=%s %s\n" "$(date "+%Y-%m-%d %H:%M:%S %Z")" "$rc_" "${LAST_LINE:-(quiet)}" > "$RESULT" 2>/dev/null' EXIT
why() { local l; l="$(head -n 1 "$ERR" 2>/dev/null | cut -c1-160)"; [ -n "$l" ] && printf ' (gh: %s)' "$l"; }
NOW="${KOSMOS_KICK_NOW:-$(date +%s)}"
[ "$CHECK" = 1 ] || { mkdir -p "$(dirname "$BEAT")" 2>/dev/null; date '+%Y-%m-%d %H:%M:%S %Z' > "$BEAT" 2>/dev/null; }

if [ "$CHECK" = 1 ] && [ -r "$(dirname "$BEAT")/source" ]; then note "installed from kosmos $(head -n 1 "$(dirname "$BEAT")/source")"; fi
if [ "$CHECK" = 1 ] && [ -r "$RESULT" ]; then note "last tick: $(head -n 1 "$RESULT")"; fi
if [ ! -d "$STATE" ]; then say "no deploy state folder at $STATE (the deploy job has not run here, or it keeps its state elsewhere); nothing asked"; exit 1; fi
if [ -e "$STATE/paused" ]; then note "paused ($STATE/paused): would ask nothing"; exit 0; fi
main="$("$GH" api "repos/$REPO/commits/main" --jq .sha 2>"$ERR")" || { say "could not read site main ($REPO)$(why); nothing asked"; exit 1; }
case "$main" in
  *[!0-9a-f]*|'') say "site main read as '${main:0:60}', not a sha; nothing asked"; exit 1 ;;
esac
[ "${#main}" -eq 40 ] || { say "site main read as '${main:0:60}', not a full sha; nothing asked"; exit 1; }
deployed="$(tr -d '[:space:]' 2>/dev/null < "$STATE/last-deployed" || true)"
note "site main ${main:0:9}, last deployed ${deployed:0:9}"
[ "$main" = "$deployed" ] && { note "main is deployed: would ask nothing"; exit 0; }
parked="$(tr -d '[:space:]' 2>/dev/null < "$STATE/parked" || true)"
[ "$main" = "$parked" ] && { note "main is parked: would ask nothing"; exit 0; }
# One line per run: "<status> <conclusion or -> <createdAt> <updatedAt>".
runs="$("$GH" run list --repo "$REPO" --workflow site-deploy.yml --branch main --limit 20 --json status,conclusion,createdAt,updatedAt --jq '.[] | "\(.status) \(.conclusion // "-") \(.createdAt) \(.updatedAt)"' 2>"$ERR")" \
  || { say "could not list site deploy runs$(why); nothing asked"; exit 1; }
active=0; newest=""; stuck=""
# Its own line goes to stderr: stamp runs inside $( ), whose stdout is the value (launchd logs both).
stamp() { local v; v="$(epoch "$1")"; case "$v" in ''|*[!0-9]*) say "site deploy run time read as '${1:0:40}'; nothing asked" >&2; exit 1 ;; esac; printf '%s' "$v"; }
while read -r status concl created updated; do
  [ -n "${status:-}" ] || continue
  c="$(stamp "$created")" || exit 1
  u="$(stamp "$updated")" || exit 1
  this_stuck=""
  if [ "$status" != completed ]; then
    [ $((NOW - c)) -gt "$STUCK_S" ] && this_stuck="$status since $created"
    if [ -n "$this_stuck" ]; then stuck="$this_stuck"; else active=$((active + 1)); fi
  fi
  # When it was made; for a run that FAILED, when it ended (reviews 3 and 6: the job's one retry keeps its 15-minute
  # pace; a green run's length does not delay the next ask). Newest by time. A stuck run does not count.
  if [ -z "$this_stuck" ]; then
    last=$c
    case "$concl" in failure|timed_out|startup_failure) [ "$u" -gt "$last" ] && last=$u ;; esac
    { [ -z "$newest" ] || [ "$last" -gt "$newest" ]; } && newest="$last"
  fi
done <<< "$runs"
rc=0
if [ -n "$stuck" ]; then say "a site deploy run has been $stuck, past its limit; not waiting on it"; rc=1; fi
[ "$active" -gt 0 ] && { note "$active run(s) queued or running: would ask nothing"; exit "$rc"; }
if [ -n "$newest" ] && [ $((NOW - newest)) -lt "$KICK_GAP_S" ]; then note "a run started $((NOW - newest)) s ago: would ask nothing"; exit "$rc"; fi
if [ "$CHECK" = 1 ]; then note "would ask for a site deploy"; exit "$rc"; fi
if "$GH" workflow run site-deploy.yml --repo "$REPO" --ref main >/dev/null 2>"$ERR"; then
  say "asked for a site deploy: main ${main:0:9}, last deployed ${deployed:0:9}"
else
  say "could not dispatch the site deploy for main ${main:0:9}$(why)"; exit 1
fi
exit "$rc"
