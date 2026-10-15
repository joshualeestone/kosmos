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
#   - a site deploy run on main started less than KICK_GAP_S (14 minutes) ago, however it ended: nothing is asked, so
#     this is a backstop and never an extra tick (the job retries a failure once on the next tick and then parks it;
#     asking sooner would spend that retry within minutes, review 1);
#   - otherwise one dispatch. A tick the job skips (a cut still running) is asked again 15 minutes later.
# A run queued or running for over 45 minutes (the job's own timeout) gets one line per tick, so a stuck run that
# silences this backstop is seen in its log. Each tick writes the time to its heartbeat file, so a quiet log can be
# told apart from a job that never runs. The log grows by at most a line per tick (about 10 KB a day at worst).
#
# --check prints what a tick would do (main, last deployed, runs, the decision) and dispatches nothing.
# Env (tests point these at fakes): KOSMOS_SITE_REPO, KOSMOS_AUTODEPLOY_STATE, KOSMOS_GH, KOSMOS_KICK_HEARTBEAT,
# KOSMOS_KICK_NOW (epoch seconds, for tests).
set -u
REPO="${KOSMOS_SITE_REPO:-joshualeestone/chaoskosmos-site}"
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
GH="${KOSMOS_GH:-/opt/homebrew/bin/gh}"
BEAT="${KOSMOS_KICK_HEARTBEAT:-$HOME/.local/libexec/kosmos-site-deploy-kick/last-tick}"
KICK_GAP_S=840
STUCK_S=2700
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }
note() { [ "$CHECK" = 1 ] && say "check: $*"; return 0; }
epoch() { date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null || date -u -d "$1" +%s 2>/dev/null; }
NOW="${KOSMOS_KICK_NOW:-$(date +%s)}"
[ "$CHECK" = 1 ] || { mkdir -p "$(dirname "$BEAT")" 2>/dev/null; date '+%Y-%m-%d %H:%M:%S %Z' > "$BEAT" 2>/dev/null; }

if [ -e "$STATE/paused" ]; then note "paused ($STATE/paused): would ask nothing"; exit 0; fi
main="$("$GH" api "repos/$REPO/commits/main" --jq .sha 2>/dev/null)" || { say "could not read site main ($REPO); nothing asked"; exit 1; }
case "$main" in
  *[!0-9a-f]*|'') say "site main read as '${main:0:60}', not a sha; nothing asked"; exit 1 ;;
esac
[ "${#main}" -eq 40 ] || { say "site main read as '${main:0:60}', not a full sha; nothing asked"; exit 1; }
deployed="$(tr -d '[:space:]' 2>/dev/null < "$STATE/last-deployed" || true)"
note "site main ${main:0:9}, last deployed ${deployed:0:9}"
[ "$main" = "$deployed" ] && { note "main is deployed: would ask nothing"; exit 0; }
parked="$(tr -d '[:space:]' 2>/dev/null < "$STATE/parked" || true)"
[ "$main" = "$parked" ] && { note "main is parked: would ask nothing"; exit 0; }
# One line per run, newest first: "<status> <createdAt>".
runs="$("$GH" run list --repo "$REPO" --workflow site-deploy.yml --branch main --limit 20 --json status,createdAt --jq '.[] | "\(.status) \(.createdAt)"' 2>/dev/null)" \
  || { say "could not list site deploy runs; nothing asked"; exit 1; }
active=0; newest=""; stuck=""
while read -r status created; do
  [ -n "${status:-}" ] || continue
  t="$(epoch "$created")"
  case "$t" in ''|*[!0-9]*) say "site deploy run time read as '${created:0:40}'; nothing asked"; exit 1 ;; esac
  [ -n "$newest" ] || newest="$t"
  if [ "$status" != completed ]; then
    active=$((active + 1))
    [ $((NOW - t)) -gt "$STUCK_S" ] && stuck="$status since $created"
  fi
done <<< "$runs"
[ -n "$stuck" ] && say "a site deploy run has been $stuck (over 45 minutes); nothing asked while it holds the queue"
[ "$active" -gt 0 ] && { note "$active run(s) queued or running: would ask nothing"; exit 0; }
if [ -n "$newest" ] && [ $((NOW - newest)) -lt "$KICK_GAP_S" ]; then note "a run started $((NOW - newest)) s ago: would ask nothing"; exit 0; fi
if [ "$CHECK" = 1 ]; then note "would ask for a site deploy"; exit 0; fi
if "$GH" workflow run site-deploy.yml --repo "$REPO" --ref main >/dev/null 2>&1; then
  say "asked for a site deploy: main ${main:0:9}, last deployed ${deployed:0:9}"
else
  say "could not dispatch the site deploy for main ${main:0:9}"; exit 1
fi
