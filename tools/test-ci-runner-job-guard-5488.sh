#!/usr/bin/env bash
# #5488 part b: tools/ci-runner-job-guard.sh, the self-hosted Mac's job-started hook, allows only this repo's
# own code and refuses everything else, failing closed. Real JSON payloads, read by the real guard, at the
# runner's fixed event path (KOSMOS_CI_EVENT_FILE points it into a scratch dir here).
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
GUARD="$HERE/ci-runner-job-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

if [ ! -x /usr/bin/plutil ]; then echo "skip test-ci-runner-job-guard-5488: no /usr/bin/plutil (not macOS; the guard runs only on the Mac)"; exit 0; fi

mkdir -p "$T/_temp/_github_workflow" "$T/elsewhere"
EV="$T/_temp/_github_workflow/event.json"     # the runner's own file
put() { printf '%s' "$1" > "$EV"; }           # what the runner wrote for this job
REPOJ='"repository":{"full_name":"owner/kosmos"}'
run() { # <event> [repo] [payload path]
  GITHUB_EVENT_NAME="$1" GITHUB_REPOSITORY="${2-owner/kosmos}" GITHUB_EVENT_PATH="${3-$EV}" KOSMOS_CI_EVENT_FILE="$EV" \
    bash "$GUARD" >/dev/null 2>&1
}
allow() { if run "${@:2}"; then pass "allowed: $1"; else fail "must allow: $1"; fi; }
deny() { if run "${@:2}"; then fail "must REFUSE: $1"; else pass "refused: $1"; fi; }

put "{$REPOJ,\"pull_request\":{\"head\":{\"repo\":{\"full_name\":\"owner/kosmos\"}}}}"
allow "a pull_request from this repo (CONTROL: plutil reads these payloads)" pull_request
deny "pull_request_target, even from this repo" pull_request_target
deny "an event it does not know (workflow_run)" workflow_run
deny "no event name" ""
deny "no repository" pull_request ""
deny "a repository variable that disagrees with the payload" pull_request someone/kosmos
put "{$REPOJ,\"pull_request\":{\"head\":{\"repo\":{\"full_name\":\"someone/kosmos\"}}}}"
deny "a pull_request from a FORK" pull_request
put "{$REPOJ,\"pull_request\":{\"head\":{\"repo\":null}}}"
deny "a pull_request whose head repo is gone (deleted fork)" pull_request
put "{$REPOJ}"
deny "a pull_request with no head in its payload" pull_request
allow "a push whose payload names this repo" push
allow "a manual run whose payload names this repo" workflow_dispatch
allow "a scheduled run whose payload names this repo" schedule
put '{"repository":{"full_name":"someone/kosmos"}}'
deny "a push whose payload names ANOTHER repo (a variable alone cannot claim it)" push
put '{}'
deny "a push whose payload names no repo" push
put 'not json'
deny "a payload that is not JSON" push
# The payload must be the runner's own file: a variable pointing elsewhere is refused even if that file is honest.
printf '%s' "{$REPOJ}" > "$T/elsewhere/event.json"
put "{$REPOJ}"
deny "GITHUB_EVENT_PATH pointing at another (even honest) file" push owner/kosmos "$T/elsewhere/event.json"
deny "a missing payload file" push owner/kosmos "$T/_temp/_github_workflow/nope.json"
deny "no payload path" push owner/kosmos ""

if [ "$fails" -eq 0 ]; then echo "test-ci-runner-job-guard-5488: 0 failures"; exit 0; fi
echo "test-ci-runner-job-guard-5488: $fails failure(s)"; exit 1
