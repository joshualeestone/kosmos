#!/usr/bin/env bash
# #5488 part b: the self-hosted Mac's JOB-STARTED hook (ACTIONS_RUNNER_HOOK_JOB_STARTED). It runs on the
# machine before any step of a job, and a non-zero exit fails the job before any of its code runs.
#
# WHY IT EXISTS: the repo is public, and a pull_request run takes its workflow file from the PR itself, so a
# fork can rewrite `runs-on` to target this machine. test.yml's own routing only stops the honest path. This
# hook is installed on the machine from main (never from a job's checkout), so a fork cannot change it.
#
# It allows a job only when its event is:
#   push, workflow_dispatch or schedule (only someone with write access can cause these), or
#   pull_request whose head repo is this repo (the same check test.yml makes, now enforced by the machine).
# Everything else is refused, including pull_request_target and any event this does not know. A missing or
# unreadable event file is refused too: it fails closed.
#
# Reads the payload with plutil (it ships with macOS and reads JSON), so it needs nothing installed.
set -u
EVENT="${GITHUB_EVENT_NAME:-}"
REPO="${GITHUB_REPOSITORY:-}"
PAYLOAD="${GITHUB_EVENT_PATH:-}"
refuse() { echo "kosmos-ci job guard: REFUSED ($*). This machine runs only this repo's own code (#5488)." >&2; exit 1; }

[ -n "$EVENT" ] && [ -n "$REPO" ] || refuse "no event name or repository in the job's environment"
case "$EVENT" in
  push|workflow_dispatch|schedule) echo "kosmos-ci job guard: allowed ($EVENT on $REPO)"; exit 0 ;;
  pull_request) ;;
  *) refuse "event '$EVENT' is not one this machine runs" ;;
esac
[ -n "$PAYLOAD" ] && [ -r "$PAYLOAD" ] || refuse "the event payload is missing or unreadable"
head="$(/usr/bin/plutil -extract pull_request.head.repo.full_name raw -o - "$PAYLOAD" 2>/dev/null)" || head=""
[ -n "$head" ] || refuse "the pull request has no head repo (a deleted fork?)"
[ "$head" = "$REPO" ] || refuse "the pull request comes from $head, not $REPO"
echo "kosmos-ci job guard: allowed (pull_request from $REPO)"
