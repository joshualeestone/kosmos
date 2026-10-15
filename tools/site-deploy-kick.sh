#!/bin/bash
# kosmos#6266: the reliable 15-minute trigger for chaoskosmos-site's "site deploy" workflow.
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
#   - a site deploy run is already queued or running on main: nothing is asked (it deploys main as it is by then);
#   - otherwise one dispatch. A tick the job skips (a cut still running) is asked again 15 minutes later.
# It prints only when it dispatches or cannot read something, so its log stays short.
#
# Env (tests point these at fakes): KOSMOS_SITE_REPO, KOSMOS_AUTODEPLOY_STATE, KOSMOS_GH.
set -u
REPO="${KOSMOS_SITE_REPO:-joshualeestone/chaoskosmos-site}"
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
GH="${KOSMOS_GH:-/opt/homebrew/bin/gh}"
say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }

if [ -e "$STATE/paused" ]; then exit 0; fi
main="$("$GH" api "repos/$REPO/commits/main" --jq .sha 2>/dev/null)" || { say "could not read site main ($REPO); nothing asked"; exit 1; }
case "$main" in
  *[!0-9a-f]*|'') say "site main read as '${main:0:60}', not a sha; nothing asked"; exit 1 ;;
esac
[ "${#main}" -eq 40 ] || { say "site main read as '${main:0:60}', not a full sha; nothing asked"; exit 1; }
deployed="$(tr -d '[:space:]' 2>/dev/null < "$STATE/last-deployed" || true)"
[ "$main" = "$deployed" ] && exit 0
parked="$(tr -d '[:space:]' 2>/dev/null < "$STATE/parked" || true)"
[ "$main" = "$parked" ] && exit 0
active="$("$GH" run list --repo "$REPO" --workflow site-deploy.yml --branch main --limit 20 --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null)" \
  || { say "could not list site deploy runs; nothing asked"; exit 1; }
case "$active" in
  0) ;;
  ''|*[!0-9]*) say "site deploy runs read as '${active:0:40}'; nothing asked"; exit 1 ;;
  *) exit 0 ;;
esac
if "$GH" workflow run site-deploy.yml --repo "$REPO" --ref main >/dev/null 2>&1; then
  say "asked for a site deploy: main ${main:0:9}, last deployed ${deployed:0:9}"
else
  say "could not dispatch the site deploy for main ${main:0:9}"; exit 1
fi
