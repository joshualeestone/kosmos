#!/usr/bin/env bash
# #5488 part b: test.yml's scope job routes the macOS suite to the self-hosted Mac ONLY when the repo
# variable KOSMOS_CI_RUNNER is exactly `on` and the code is this repo's own (a push to main, or a PR whose
# head repo is this repo). A fork's code never reaches that machine. This runs the REAL decide step body,
# taken from the parsed workflow, with each input, and checks the suite's runs-on falls back when scope
# gave nothing.
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
  raise "suite runs-on" unless j["suite"]["runs-on"] == %q{${{ fromJSON(needs.scope.outputs.mac_runner || '"'"'"macos-latest"'"'"') }}}
  raise "test stays on ubuntu" unless j["test"]["runs-on"] == "ubuntu-latest" && j["scope"]["runs-on"] == "ubuntu-latest"
  tmux = j["suite"]["steps"].find { |x| x["name"].to_s.include?("tmux") }
  raise "tmux installed only when missing" unless tmux && tmux["run"].strip == "command -v tmux || brew install tmux"
  File.write(ARGV[1], d["run"])
' "$WF" "$T/decide.sh" 2>"$T/rb.err"; then
  fail "test.yml wiring: $(head -2 "$T/rb.err")"
else
  pass "test.yml wiring (parsed): scope picks the runner from vars and the head repo; suite falls back to macos-latest; scope and test stay on ubuntu"
fi

SELF='["self-hosted","macOS","arm64","kosmos-ci"]'
HOSTED='"macos-latest"'
route() { # <CI_RUNNER> <EVENT_NAME> <HEAD_REPO> -> the mac_runner the REAL body wrote
  : > "$T/out"; mkdir -p "$T/cwd" "$T/runner-temp"
  # RUNNER_TEMP is its own directory: the body writes its own decide.sh there, which must not be this copy.
  (cd "$T/cwd" && CI_RUNNER="$1" EVENT_NAME="$2" HEAD_REPO="$3" THIS_REPO=owner/kosmos BASE_REF=nope HEAD_SHA=x HEAD_REF=y \
    RUNNER_TEMP="$T/runner-temp" GITHUB_OUTPUT="$T/out" PATH="/usr/bin:/bin" bash -e "$T/decide.sh" >/dev/null 2>&1)
  sed -n 's/^mac_runner=//p' "$T/out"
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

# Both outputs must be JSON, or fromJSON fails the suite job before it starts.
for v in "$SELF" "$HOSTED"; do
  if printf '%s' "$v" | ruby -rjson -e 'JSON.parse(STDIN.read, quirks_mode: true)' >/dev/null 2>&1; then pass "valid JSON for fromJSON: $v"
  else fail "not valid JSON for fromJSON: $v"; fi
done

if [ "$fails" -eq 0 ]; then echo "test-ci-runner-route-5488: 0 failures"; exit 0; fi
echo "test-ci-runner-route-5488: $fails failure(s)"; exit 1
