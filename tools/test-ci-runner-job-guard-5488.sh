#!/usr/bin/env bash
# #5488 part b: tools/ci-runner-job-guard.sh, the self-hosted Mac's job-started hook, allows only this repo's
# own code and refuses everything else, failing closed. Real JSON payloads, read by the real guard, installed
# in a scratch home laid out as on the Mac (<home>/.kosmos-ci/job-guard.sh beside <home>/actions-runner/_work),
# because the guard derives the runner's event path from where it is installed, never from a variable.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
GUARD="$HERE/ci-runner-job-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

if [ ! -x /usr/bin/plutil ]; then echo "skip test-ci-runner-job-guard-5488: no /usr/bin/plutil (not macOS; the guard runs only on the Mac)"; exit 0; fi

mkdir -p "$T/home/.kosmos-ci" "$T/home/actions-runner/_work/_temp/_github_workflow" "$T/elsewhere"
cp "$GUARD" "$T/home/.kosmos-ci/job-guard.sh"; GUARD="$T/home/.kosmos-ci/job-guard.sh"
EV="$T/home/actions-runner/_work/_temp/_github_workflow/event.json"     # the runner's own file
put() { printf '%s' "$1" > "$EV"; }           # what the runner wrote for this job
REPOJ='"repository":{"full_name":"owner/kosmos"}'
run() { # <event> [repo] [payload path]
  GITHUB_EVENT_NAME="$1" GITHUB_REPOSITORY="${2-owner/kosmos}" GITHUB_EVENT_PATH="${3-$EV}" HOME="$T/elsewhere" \
    "$GUARD" >/dev/null 2>&1
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
deny "a missing payload file" push owner/kosmos "$T/home/actions-runner/_work/_temp/_github_workflow/nope.json"
ln -s "$T/elsewhere/event.json" "$T/home/actions-runner/_work/_temp/_github_workflow/link.json"
deny "a symlink in the runner's folder pointing at another file" push owner/kosmos "$T/home/actions-runner/_work/_temp/_github_workflow/link.json"
deny "no payload path" push owner/kosmos ""
# The guard finds the runner's file from where it is RUN FROM: a copy elsewhere, or a symlink to it from elsewhere
# (it resolves the folder, not the link), finds no runner and refuses. Fail-closed; the hooks call it by its real path.
put "{$REPOJ}"
mkdir -p "$T/stray"; cp "$GUARD" "$T/stray/job-guard.sh"
if GITHUB_EVENT_NAME=push GITHUB_REPOSITORY=owner/kosmos GITHUB_EVENT_PATH="$EV" "$T/stray/job-guard.sh" >/dev/null 2>&1; then
  fail "must REFUSE: a copy of the guard installed outside the runner's home"
else pass "refused: a copy of the guard installed outside the runner's home"; fi
ln -s "$GUARD" "$T/stray/linked-guard.sh"
if GITHUB_EVENT_NAME=push GITHUB_REPOSITORY=owner/kosmos GITHUB_EVENT_PATH="$EV" "$T/stray/linked-guard.sh" >/dev/null 2>&1; then
  fail "must REFUSE: the guard reached through a symlink from another folder"
else pass "refused: the guard reached through a symlink from another folder (fail-closed)"; fi
if GITHUB_EVENT_NAME=push GITHUB_REPOSITORY=owner/kosmos GITHUB_EVENT_PATH="$EV" "$GUARD" >/dev/null 2>&1; then
  pass "allowed: the same payload through the guard at its real path (CONTROL for the two refusals above)"
else fail "must allow: the guard at its real path"; fi

if [ "$fails" -eq 0 ]; then echo "test-ci-runner-job-guard-5488: 0 failures"; exit 0; fi
echo "test-ci-runner-job-guard-5488: $fails failure(s)"; exit 1
