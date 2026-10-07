#!/usr/bin/env bash
# #5488 part b: the self-hosted Mac's JOB-STARTED hook (ACTIONS_RUNNER_HOOK_JOB_STARTED). It runs on the
# machine before any step of a job, and a non-zero exit fails the job before any of its code runs.
#
# WHY IT EXISTS: the repo is public, and a pull_request run takes its workflow file from the PR itself, so a
# fork can rewrite `runs-on` to target this machine. test.yml's own routing only stops the honest path. This
# hook is installed on the machine from a pinned main commit (never from a job's checkout).
#
# It allows a job only when ALL of these hold:
#   - the event payload is the RUNNER'S OWN file at its fixed path (KOSMOS_CI_EVENT_FILE, default
#     ~/actions-runner/_work/_temp/_github_workflow/event.json), not any file a variable points at;
#   - the payload names this repo (repository.full_name), so a variable alone cannot claim it;
#   - the event is push, workflow_dispatch or schedule (only someone with write access causes these), or a
#     pull_request whose head repo is this repo.
# Everything else is refused, including pull_request_target and any event it does not know, and a missing or
# unreadable payload: it fails closed. Reads JSON with plutil, which ships with macOS.
set -u
EVENT="${GITHUB_EVENT_NAME:-}"
REPO="${GITHUB_REPOSITORY:-}"
PAYLOAD="${GITHUB_EVENT_PATH:-}"
EXPECTED="${KOSMOS_CI_EVENT_FILE:-$HOME/actions-runner/_work/_temp/_github_workflow/event.json}"
refuse() { echo "kosmos-ci job guard: REFUSED ($*). This machine runs only this repo's own code (#5488)." >&2; exit 1; }
field() { /usr/bin/plutil -extract "$1" raw -o - "$PAYLOAD" 2>/dev/null; }

[ -n "$EVENT" ] && [ -n "$REPO" ] || refuse "no event name or repository in the job's environment"
[ -n "$PAYLOAD" ] && [ -r "$PAYLOAD" ] || refuse "the event payload is missing or unreadable"
# The runner's own file, by its real path: a variable pointing at a planted or stale file is refused.
real="$(cd "$(dirname "$PAYLOAD")" 2>/dev/null && pwd -P)/$(basename "$PAYLOAD")"
want="$(cd "$(dirname "$EXPECTED")" 2>/dev/null && pwd -P)/$(basename "$EXPECTED")"
[ "$real" = "$want" ] || refuse "the event payload is not the runner's own file ($PAYLOAD)"
named="$(field repository.full_name)" || named=""
[ "$named" = "$REPO" ] || refuse "the payload names '${named:-nothing}', not $REPO"
case "$EVENT" in
  push|workflow_dispatch|schedule) echo "kosmos-ci job guard: allowed ($EVENT on $REPO)"; exit 0 ;;
  pull_request) ;;
  *) refuse "event '$EVENT' is not one this machine runs" ;;
esac
head="$(field pull_request.head.repo.full_name)" || head=""
[ -n "$head" ] || refuse "the pull request has no head repo (a deleted fork?)"
[ "$head" = "$REPO" ] || refuse "the pull request comes from $head, not $REPO"
echo "kosmos-ci job guard: allowed (pull_request from $REPO)"
