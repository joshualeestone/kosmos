#!/usr/bin/env bash
# #5488 part b: test.yml's scope job routes the macOS suite to the self-hosted Mac ONLY when the repo
# variable KOSMOS_CI_RUNNER is exactly `on` and the code is this repo's own (a push to main, or a PR whose
# head repo is this repo). (This is the honest path only; the machine's job guard is what refuses fork code:
# tools/test-ci-runner-job-guard-5488.sh.) This runs the REAL decide step body, under GitHub's own shell flags,
# taken from the parsed workflow, with each input, and checks the suite's runs-on falls back when scope
# gave nothing. #4601: and that a shell shard follows the node part there only when KOSMOS_CI_SHELL_SHARDS names it.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WF="$HERE/../.github/workflows/test.yml"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

if ! command -v ruby >/dev/null 2>&1; then
  echo "skip test-ci-runner-route-5488: no ruby to parse YAML (tools.shell-shard-4317.test.js skips the same way)"; exit 0
fi
if ! ruby -ryaml -e '
  j = YAML.load_file(ARGV[0])["jobs"]
  d = j["scope"]["steps"].find { |x| x["id"] == "decide" }
  raise "scope outputs mac_runner" unless j["scope"]["outputs"]["mac_runner"] == "${{ steps.decide.outputs.mac_runner }}"
  raise "the switch is read from vars" unless d["env"]["CI_RUNNER"] == "${{ vars.KOSMOS_CI_RUNNER }}"
  raise "head repo from the PR" unless d["env"]["HEAD_REPO"] == "${{ github.event.pull_request.head.repo.full_name }}"
  raise "this repo" unless d["env"]["THIS_REPO"] == "${{ github.repository }}"
  raise "suite runs-on: node takes scope'"'"'s choice, a shell shard its own (#4601)" unless j["suite"]["runs-on"] == %q{${{ fromJSON(matrix.part == '"'"'node'"'"' && needs.scope.outputs.mac_runner || matrix.shard == '"'"'1/2'"'"' && needs.scope.outputs.shell1_runner || matrix.shard == '"'"'2/2'"'"' && needs.scope.outputs.shell2_runner || '"'"'"macos-latest"'"'"') }}}
  raise "the shard list is read from vars" unless d["env"]["CI_SHELL_SHARDS"] == "${{ vars.KOSMOS_CI_SHELL_SHARDS }}"
  raise "scope outputs a runner for each shard" unless j["scope"]["outputs"]["shell1_runner"] == "${{ steps.decide.outputs.shell1_runner }}" && j["scope"]["outputs"]["shell2_runner"] == "${{ steps.decide.outputs.shell2_runner }}"
  raise "test stays on ubuntu" unless j["test"]["runs-on"] == "ubuntu-latest" && j["scope"]["runs-on"] == "ubuntu-latest"
  tmux = j["suite"]["steps"].find { |x| x["name"].to_s.include?("tmux") }
  raise "tmux installed only when missing, and never by brew on the self-hosted runner" unless tmux && tmux["run"].strip == %q{command -v tmux || { [ "$RUNNER_ENVIRONMENT" != self-hosted ] || { echo "::error::tmux is missing on the self-hosted runner (or not on its PATH); not installing into the machine owner'"'"'s Homebrew, card 5488"; exit 1; }; brew install tmux; }}
  File.write(ARGV[1], d["run"])
  File.write(ARGV[2], tmux["run"])
' "$WF" "$T/decide.sh" "$T/tmux.sh" 2>"$T/rb.err"; then
  fail "test.yml wiring: $(head -2 "$T/rb.err")"
else
  pass "test.yml wiring (parsed): scope picks the runner from vars and the head repo; the node part takes scope's choice, a shell shard only when KOSMOS_CI_SHELL_SHARDS names it (#4601); tmux never brew-installs on self-hosted; scope and test stay on ubuntu"
fi

SELF='["self-hosted","macOS","arm64","kosmos-ci"]'
HOSTED='"macos-latest"'
route() { # <CI_RUNNER> <EVENT_NAME> <HEAD_REPO> [<CI_SHELL_SHARDS>] [<output name>] -> that output, as the REAL body wrote it
  : > "$T/out"; mkdir -p "$T/cwd" "$T/runner-temp"
  # RUNNER_TEMP is its own directory: the body writes its own decide.sh there, which must not be this copy.
  (cd "$T/cwd" && CI_SHELL_SHARDS="${4:-}" CI_RUNNER="$1" EVENT_NAME="$2" HEAD_REPO="$3" THIS_REPO=owner/kosmos BASE_REF=nope HEAD_SHA=x HEAD_REF=y \
    RUNNER_TEMP="$T/runner-temp" GITHUB_OUTPUT="$T/out" PATH="/usr/bin:/bin" bash --noprofile --norc -eo pipefail "$T/decide.sh" >/dev/null 2>&1)
  sed -n "s/^${5:-mac_runner}=//p" "$T/out"
}
expect() { # <label> <want> <CI_RUNNER> <EVENT_NAME> <HEAD_REPO>
  local got; got="$(route "$3" "$4" "$5")"
  [ "$got" = "$2" ] && pass "$1" || fail "$1: want $2, got '$got'"
}
expect "switch on, push to main: the self-hosted Mac" "$SELF" on push ""
expect "switch on, a PR from this repo: the self-hosted Mac" "$SELF" on pull_request owner/kosmos
expect "switch on, a FORK PR: macos-latest (fork code never reaches the Mac)" "$HOSTED" on pull_request someone/kosmos
expect "switch on, a PR with no head repo (a deleted fork): macos-latest" "$HOSTED" on pull_request ""
expect "switch on, another event: macos-latest" "$HOSTED" on workflow_dispatch ""
expect "switch unset, push: macos-latest (the default, before the Mac exists)" "$HOSTED" "" push ""
expect "switch off, a PR from this repo: macos-latest (the kill switch)" "$HOSTED" off pull_request owner/kosmos
expect "switch 'On' (not exactly on): macos-latest" "$HOSTED" On pull_request owner/kosmos
expect "switch 'true': macos-latest" "$HOSTED" true push ""

# #4601: a shell shard follows the node part to the self-hosted Mac only when KOSMOS_CI_SHELL_SHARDS names it.
shard() { # <label> <want> <CI_RUNNER> <EVENT_NAME> <HEAD_REPO> <CI_SHELL_SHARDS> <shell1_runner|shell2_runner>
  local got; got="$(route "$3" "$4" "$5" "$6" "$7")"
  [ "$got" = "$2" ] && pass "$1" || fail "$1: want $2, got '$got'"
}
shard "shards unset: shell 1/2 on macos-latest" "$HOSTED" on push "" "" shell1_runner
shard "shards unset: shell 2/2 on macos-latest" "$HOSTED" on push "" "" shell2_runner
shard "shards 1/2: shell 1/2 on the self-hosted Mac" "$SELF" on push "" "1/2" shell1_runner
shard "shards 1/2: shell 2/2 stays on macos-latest" "$HOSTED" on push "" "1/2" shell2_runner
shard "shards 1/2,2/2: shell 2/2 on the self-hosted Mac" "$SELF" on pull_request owner/kosmos "1/2,2/2" shell2_runner
shard "shards 1/2,2/2 but a FORK PR: macos-latest (follows the node rule)" "$HOSTED" on pull_request someone/kosmos "1/2,2/2" shell1_runner
shard "shards 1/2,2/2 but the switch off: macos-latest" "$HOSTED" off push "" "1/2,2/2" shell1_runner
shard "shards '1/22' (not a listed shard): macos-latest" "$HOSTED" on push "" "1/22" shell1_runner
shard "shards 2/2 alone: shell 1/2 stays on macos-latest (the two case lines not swapped)" "$HOSTED" on push "" "2/2" shell1_runner
shard "shards '1/2, 2/2' (a space): shell 2/2 on the self-hosted Mac" "$SELF" on push "" "1/2, 2/2" shell2_runner
shard "shards 'all' (not a shard name): macos-latest" "$HOSTED" on push "" "all" shell1_runner
shard "shards '1/2;2/2' (a wrong separator): macos-latest" "$HOSTED" on push "" "1/2;2/2" shell2_runner
shard "shards with a tab and a newline: still read" "$SELF" on push "" "$(printf '1/2,\t\n2/2')" shell2_runner

# Both outputs must be JSON, or fromJSON fails the suite job before it starts.
for v in "$SELF" "$HOSTED"; do
  if printf '%s' "$v" | ruby -rjson -e 'JSON.parse(STDIN.read, quirks_mode: true)' >/dev/null 2>&1; then pass "valid JSON for fromJSON: $v"
  else fail "not valid JSON for fromJSON: $v"; fi
done

# #5488 part c: the REAL tmux step body, under GitHub's shell flags, on a PATH with no tmux and a stub brew
# that records being called. A self-hosted runner must refuse WITHOUT calling brew (its Homebrew is the
# machine owner's); a GitHub-hosted one installs as before. Controls: with tmux present, neither calls brew.
# PATH is ONLY the stub directory: the step body uses shell builtins plus brew and tmux, so no system tmux
# can make a no-tmux arm vacuous. bash itself is named by absolute path, never looked up on that PATH.
tmux_step() { # <RUNNER_ENVIRONMENT> <with-tmux: 0|1> -> prints "rc=<n> brew=<called|not> err=<yes|no>"
  rm -rf "$T/bin"; mkdir -p "$T/bin"; : > "$T/brew.log"
  printf '#!/bin/sh\necho called >> "%s"\n' "$T/brew.log" > "$T/bin/brew"; chmod +x "$T/bin/brew"
  if [ "$2" = 1 ]; then printf '#!/bin/sh\nexit 0\n' > "$T/bin/tmux"; chmod +x "$T/bin/tmux"; fi
  local rc=0 err=no
  RUNNER_ENVIRONMENT="$1" PATH="$T/bin" /bin/bash --noprofile --norc -eo pipefail "$T/tmux.sh" > "$T/step.out" 2>&1 || rc=$?
  grep -q '^::error::tmux is missing on the self-hosted runner (or not on its PATH)' "$T/step.out" && err=yes
  if [ -s "$T/brew.log" ]; then echo "rc=$rc brew=called err=$err"; else echo "rc=$rc brew=not err=$err"; fi
}
# Without the step body (the wiring parse failed above), every arm here would pass or fail for the wrong reason.
if [ ! -s "$T/tmux.sh" ]; then
  fail "the tmux step body was not extracted from test.yml, so its behaviour arms cannot run"
else
  got="$(tmux_step self-hosted 0)"
  [ "$got" = "rc=1 brew=not err=yes" ] && pass "self-hosted, no tmux: exits 1 with the ::error:: line and never calls brew" || fail "self-hosted, no tmux: want rc=1 brew=not err=yes, got $got"
  got="$(tmux_step github-hosted 0)"
  [ "$got" = "rc=0 brew=called err=no" ] && pass "github-hosted, no tmux: brew install as before" || fail "github-hosted, no tmux: want rc=0 brew=called err=no, got $got"
  got="$(tmux_step "" 0)"
  [ "$got" = "rc=0 brew=called err=no" ] && pass "RUNNER_ENVIRONMENT empty (older runners leave it unset; the step treats both alike): brew install as before" || fail "empty env, no tmux: want rc=0 brew=called err=no, got $got"
  got="$(tmux_step self-hosted 1)"
  [ "$got" = "rc=0 brew=not err=no" ] && pass "CONTROL self-hosted, tmux present: passes, no brew" || fail "control self-hosted with tmux: got $got"
  got="$(tmux_step github-hosted 1)"
  [ "$got" = "rc=0 brew=not err=no" ] && pass "CONTROL github-hosted, tmux present: passes, no brew" || fail "control github-hosted with tmux: got $got"
fi

if [ "$fails" -eq 0 ]; then echo "test-ci-runner-route-5488: 0 failures"; exit 0; fi
echo "test-ci-runner-route-5488: $fails failure(s)"; exit 1
