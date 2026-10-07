#!/bin/bash
# #5488 part b: the self-hosted Mac's JOB-STARTED hook (ACTIONS_RUNNER_HOOK_JOB_STARTED). It runs on the
# machine before any step of a job, and a non-zero exit fails the job before any of its code runs.
#
# WHY IT EXISTS: the repo is public, and a pull_request run takes its workflow file from the PR itself, so a
# fork can rewrite `runs-on` to target this machine. test.yml's own routing only stops the honest path. This
# hook is installed on the machine from a pinned main commit (never from a job's checkout).
#
# THE TRUST MODEL: only this repo's own code may run on the machine. Same-repo writers are trusted (they can
# already edit the workflows). This guard keeps everyone else's code from running at all; it does not, and on
# a machine where jobs run as the runner's own user cannot, defend the machine from a trusted job.
#
# It allows a job only when ALL of these hold:
#   - the event payload is the RUNNER'S OWN file at its fixed path, derived from where this guard is installed
#     (<home>/.kosmos-ci/job-guard.sh -> <home>/actions-runner/_work/_temp/_github_workflow/event.json), never
#     from a variable a job could set;
#   - the payload names this repo (repository.full_name), so a variable alone cannot claim it;
#   - the event is push, workflow_dispatch or schedule (only someone with write access causes these), or a
#     pull_request whose head repo is this repo.
# Everything else is refused, including pull_request_target and any event it does not know, and a missing or
# unreadable payload: it fails closed. Reads JSON with plutil, which ships with macOS.
PATH=/usr/bin:/bin
set -u
EVENT="${GITHUB_EVENT_NAME:-}"
REPO="${GITHUB_REPOSITORY:-}"
PAYLOAD="${GITHUB_EVENT_PATH:-}"
refuse() { echo "kosmos-ci job guard: REFUSED ($*). This machine runs only this repo's own code (#5488)." >&2; exit 1; }
field() { /usr/bin/plutil -extract "$1" raw -o - "$PAYLOAD" 2>/dev/null; }
# A path with its directory resolved (pwd -P) and its file name kept, or nothing if the directory is missing.
resolved() { local d; d="$(cd "$(/usr/bin/dirname "$1")" 2>/dev/null && pwd -P)" || return 1; printf '%s/%s' "$d" "$(/usr/bin/basename "$1")"; }

self_dir="$(cd "$(/usr/bin/dirname "$0")" 2>/dev/null && pwd -P)" || refuse "cannot tell where the guard is installed"
# The runner is configured with `--work _work` in ~/actions-runner (ci-mini-setup.sh). If that ever changes,
# every job is REFUSED here (the file is not found), never allowed: change this line with it.
EXPECTED="$self_dir/../actions-runner/_work/_temp/_github_workflow/event.json"

[ -n "$EVENT" ] && [ -n "$REPO" ] || refuse "no event name or repository in the job's environment"
[ -n "$PAYLOAD" ] && [ -f "$PAYLOAD" ] && [ ! -L "$PAYLOAD" ] && [ -r "$PAYLOAD" ] || refuse "the event payload is missing, unreadable or a link"
real="$(resolved "$PAYLOAD")" || refuse "the event payload's folder cannot be resolved"
want="$(resolved "$EXPECTED")" || refuse "the runner's own event folder does not exist"
[ "$real" = "$want" ] || refuse "the event payload is not the runner's own file ($PAYLOAD)"
named="$(field repository.full_name)" || named=""
[ "$named" = "$REPO" ] || refuse "the payload names '${named:-nothing}', not $REPO"
# The event TYPE is read from the payload too, not only from the variable: a fork PR's payload names this repo
# (repository is the base), so the variable alone must never be what makes it a push.
has() { /usr/bin/plutil -extract "$1" raw -o - "$PAYLOAD" >/dev/null 2>&1 || /usr/bin/plutil -extract "$1" json -o - "$PAYLOAD" >/dev/null 2>&1; }
if has pull_request && [ "$EVENT" != pull_request ]; then refuse "the payload is a pull request but the event says '$EVENT'"; fi
case "$EVENT" in
  push) has ref && has pusher || refuse "a push payload without ref and pusher" ;;
  workflow_dispatch) has workflow || refuse "a workflow_dispatch payload without its workflow" ;;
  schedule) has schedule || refuse "a schedule payload without its schedule" ;;
  pull_request) ;;
  *) refuse "event '$EVENT' is not one this machine runs" ;;
esac
[ "$EVENT" = pull_request ] || { echo "kosmos-ci job guard: allowed ($EVENT on $REPO)"; exit 0; }
head="$(field pull_request.head.repo.full_name)" || head=""
[ -n "$head" ] || refuse "the pull request has no head repo (a deleted fork?)"
[ "$head" = "$REPO" ] || refuse "the pull request comes from $head, not $REPO"
echo "kosmos-ci job guard: allowed (pull_request from $REPO)"
