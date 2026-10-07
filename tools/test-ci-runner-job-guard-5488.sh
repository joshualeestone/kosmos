#!/usr/bin/env bash
# #5488 part b: tools/ci-runner-job-guard.sh, the self-hosted Mac's job-started hook, allows only this repo's
# own code and refuses everything else, failing closed. Real JSON payloads, read by the real guard.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
GUARD="$HERE/ci-runner-job-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

if [ ! -x /usr/bin/plutil ]; then echo "skip test-ci-runner-job-guard-5488: no /usr/bin/plutil (not macOS; the guard runs only on the Mac)"; exit 0; fi

pr() { printf '{"pull_request":{"head":{"repo":%s}}}' "$1" > "$T/$2.json"; }
pr '{"full_name":"owner/kosmos"}' same
pr '{"full_name":"someone/kosmos"}' fork
pr 'null' deleted
printf '{}' > "$T/empty.json"
printf 'not json' > "$T/bad.json"

run() { GITHUB_EVENT_NAME="$1" GITHUB_REPOSITORY="${3-owner/kosmos}" GITHUB_EVENT_PATH="$2" bash "$GUARD" >/dev/null 2>&1; }
allow() { if run "$2" "$3" "${4-owner/kosmos}"; then pass "allowed: $1"; else fail "must allow: $1"; fi; }
deny() { if run "$2" "$3" "${4-owner/kosmos}"; then fail "must REFUSE: $1"; else pass "refused: $1"; fi; }

allow "a pull_request from this repo" pull_request "$T/same.json"
allow "a push" push "$T/empty.json"
allow "a manual run" workflow_dispatch ""
allow "a scheduled run" schedule ""
deny "a pull_request from a FORK" pull_request "$T/fork.json"
deny "a pull_request whose head repo is gone (deleted fork)" pull_request "$T/deleted.json"
deny "a pull_request with no head in its payload" pull_request "$T/empty.json"
deny "a pull_request whose payload is not JSON" pull_request "$T/bad.json"
deny "a pull_request whose payload file is missing" pull_request "$T/nope.json"
deny "a pull_request with no payload path" pull_request ""
deny "pull_request_target (runs base code with fork input)" pull_request_target "$T/same.json"
deny "an event it does not know (workflow_run)" workflow_run "$T/same.json"
deny "no event name" "" "$T/same.json"
deny "no repository" pull_request "$T/same.json" ""
deny "a head repo that only CONTAINS this repo's name" pull_request "$T/fork.json" "kosmos"

if [ "$fails" -eq 0 ]; then echo "test-ci-runner-job-guard-5488: 0 failures"; exit 0; fi
echo "test-ci-runner-job-guard-5488: $fails failure(s)"; exit 1
