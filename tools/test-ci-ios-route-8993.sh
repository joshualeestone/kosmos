#!/usr/bin/env bash
# kosmos#8993: ios.yml's route job sends `build` (logic tests + simulator build) to the self-hosted Mac ONLY when the repo
# variable KOSMOS_CI_IOS_JOBS names "build", test.yml's kill switch KOSMOS_CI_RUNNER is exactly `on`, and the code is this
# repo's own (a push, or a PR whose head repo is this repo). Everything else is macos-latest, as before. This runs the
# REAL decide step body, taken from the parsed workflow, under GitHub's own shell flags, with each input; and pins the
# wiring: route on ubuntu, build needing route and taking its choice, the UI jobs still on macos-latest.
# Modelled on tools/test-ci-runner-route-5488.sh (test.yml's routing).
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WF="$HERE/../.github/workflows/ios.yml"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-ci-ios-route-8993.XXXXXXXXXX")"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

if ! command -v ruby >/dev/null 2>&1; then
  echo "skip test-ci-ios-route-8993: no ruby to parse YAML (test-ci-runner-route-5488 skips the same way)"; exit 0
fi
if ! ruby -ryaml -e '
  j = YAML.load_file(ARGV[0])["jobs"]
  r = j["route"] or raise "a route job"
  raise "route runs on ubuntu" unless r["runs-on"] == "ubuntu-latest"
  raise "route outputs build_runner" unless r["outputs"]["build_runner"] == "${{ steps.decide.outputs.build_runner }}"
  d = r["steps"].find { |x| x["id"] == "decide" } or raise "a decide step"
  {"CI_RUNNER" => "${{ vars.KOSMOS_CI_RUNNER }}", "CI_IOS_JOBS" => "${{ vars.KOSMOS_CI_IOS_JOBS }}",
   "EVENT_NAME" => "${{ github.event_name }}", "HEAD_REPO" => "${{ github.event.pull_request.head.repo.full_name }}",
   "THIS_REPO" => "${{ github.repository }}"}.each { |k, v| raise "decide reads #{k} from #{v}" unless d["env"][k] == v }
  raise "decide never pastes a variable into its script" if d["run"].include?("${{")
  b = j["build"]
  raise "build needs route" unless Array(b["needs"]) == ["route"]
  raise "build takes route'"'"'s choice, macos-latest if route gave none" unless b["runs-on"] == %q{${{ fromJSON(needs.route.outputs.build_runner || '"'"'"macos-latest"'"'"') }}}
  raise "build runs even when route failed (it then falls back), never when the run is cancelled" unless b["if"] == "${{ !cancelled() }}"
  pre = b["steps"].find { |x| x["name"].to_s.include?("self-hosted Mac can build") } or raise "a self-hosted preflight step"
  raise "the preflight runs only on a self-hosted runner" unless pre["if"] == "${{ runner.environment == '"'"'self-hosted'"'"' }}"
  %w[xcodebuild\ -version -checkFirstLaunchStatus simctl\ list\ runtimes KOSMOS_CI_IOS_JOBS].each { |w| raise "the preflight checks #{w}" unless pre["run"].include?(w.delete("\\")) }
  raise "build state of the archive stays in RUNNER_TEMP" unless b["steps"].any? { |x| x["run"].to_s.include?("archive") && x["run"].to_s.include?(%q{-derivedDataPath "$RUNNER_TEMP/archive-dd"}) }
  %w[uibuild ui uikit].each { |n| raise "#{n} stays on macos-latest" unless j[n] && j[n]["runs-on"] == "macos-latest" }
  File.write(ARGV[1], d["run"])
' "$WF" "$T/decide.sh" 2>"$T/rb.err"; then
  fail "ios.yml wiring: $(head -2 "$T/rb.err")"
else
  pass "ios.yml wiring (parsed): route on ubuntu reads both variables and the head repo through env; build needs it and takes its choice; uibuild, ui and uikit stay on macos-latest"
fi

SELF='["self-hosted","macOS","arm64","kosmos-ci"]'
HOSTED='"macos-latest"'
route() { # <CI_RUNNER> <CI_IOS_JOBS> <EVENT_NAME> <HEAD_REPO> -> build_runner, as the REAL body wrote it
  : > "$T/out"; mkdir -p "$T/cwd"
  (cd "$T/cwd" && CI_RUNNER="$1" CI_IOS_JOBS="$2" EVENT_NAME="$3" HEAD_REPO="$4" THIS_REPO=owner/kosmos \
    GITHUB_OUTPUT="$T/out" PATH="/usr/bin:/bin" bash --noprofile --norc -eo pipefail "$T/decide.sh" >/dev/null 2>&1) || echo "EXIT $?" >> "$T/out"
  sed -n 's/^build_runner=//p' "$T/out"; grep '^EXIT' "$T/out" || true
}
expect() { # <label> <want> <CI_RUNNER> <CI_IOS_JOBS> <EVENT_NAME> <HEAD_REPO>
  local got; got="$(route "$3" "$4" "$5" "$6")"
  if [ "$got" = "$2" ]; then pass "$1"; else fail "$1: got [$got], want [$2]"; fi
}
OWN=owner/kosmos
expect "a push to main, both switches on: the self-hosted Mac"                   "$SELF"   on build   push         ""
expect "this repo's own PR, both on: the self-hosted Mac"                        "$SELF"   on build   pull_request "$OWN"
expect "a fork's PR, both on: macos-latest (the job guard backs this)"           "$HOSTED" on build   pull_request someone/kosmos
expect "a PR with no head repo (deleted fork): macos-latest"                     "$HOSTED" on build   pull_request ""
expect "KOSMOS_CI_IOS_JOBS unset: macos-latest, as before"                       "$HOSTED" on ""      push         ""
expect "the kill switch off: macos-latest even when build is named"              "$HOSTED" off build  push         ""
expect "the kill switch unset: macos-latest"                                     "$HOSTED" ""  build  push         ""
expect "the kill switch spelled On: macos-latest (exactly on)"                   "$HOSTED" On  build  push         ""
expect "a list naming build among others: the self-hosted Mac"                   "$SELF"   on "uibuild, build" push    ""
expect "a comma list with no space: the self-hosted Mac"                         "$SELF"   on "uibuild,build"  push    ""
expect "whole tokens only: builds names nothing"                                 "$HOSTED" on builds  push         ""
expect "whole tokens only: xbuild names nothing"                                 "$HOSTED" on xbuild  push         ""
touch "$T/cwd/build"   # a file named build where the body runs: an unquoted * would expand to it without set -f
expect "a glob is kept literal (set -f), even beside a file named build"          "$HOSTED" on '*'     push         ""
rm -f "$T/cwd/build"
expect "another event (workflow_dispatch): macos-latest"                         "$HOSTED" on build   workflow_dispatch ""
expect "shell syntax in the list runs nothing: macos-latest"                     "$HOSTED" on '$(touch pwned);build;x' push ""
[ -e "$T/cwd/pwned" ] && fail "the list's text was run as a command" || pass "the list's text is never run"

# CONTROL: a body that never routes makes each self-hosted case above give the wrong answer, so they can fail.
printf 'echo "build_runner=\\"macos-latest\\"" >> "$GITHUB_OUTPUT"\n' > "$T/decide.sh"
wrong=0
for args in "on build push x" "on build pull_request owner/kosmos" "on uibuild,build push x"; do
  set -- $args; [ "$4" = x ] && h="" || h="$4"
  [ "$(route "$1" "$2" "$3" "$h")" = "$SELF" ] || wrong=$((wrong + 1))
done
[ "$wrong" = 3 ] && pass "CONTROL: with a body that never routes, all 3 self-hosted cases come out wrong" \
  || fail "CONTROL: a never-routing body still passed $((3 - wrong)) of the 3 self-hosted cases"

# CONTROL, the dangerous direction (review round 2): a body that ALWAYS routes to the self-hosted Mac makes every
# macos-latest case wrong, so the cases that keep a fork, a switched-off machine or another event off it can fail.
printf '%s\n' "echo 'build_runner=$SELF' >> \"\$GITHUB_OUTPUT\"" > "$T/decide.sh"
wrong=0
for args in "on build pull_request someone/kosmos" "on build pull_request x" "off build push x" "x build push x" "on x push x" "on build workflow_dispatch x"; do
  set -- $args; c="$1"; [ "$c" = x ] && c=""; j="$2"; [ "$j" = x ] && j=""; h="$4"; [ "$h" = x ] && h=""
  [ "$(route "$c" "$j" "$3" "$h")" = "$HOSTED" ] || wrong=$((wrong + 1))
done
[ "$wrong" = 6 ] && pass "CONTROL: with a body that always routes, all 6 macos-latest cases (fork, no head, off, unset, no list, dispatch) come out wrong" \
  || fail "CONTROL: an always-routing body still passed $((6 - wrong)) of the 6 macos-latest cases"

if [ "$fails" -ne 0 ]; then echo "test-ci-ios-route-8993: $fails failed"; exit 1; fi
echo "test-ci-ios-route-8993: all passed"
