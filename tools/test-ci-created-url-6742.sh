#!/usr/bin/env bash
# kosmos#6742: every GitHub workflow must dead-address the install "created" ping.
#
# WHY. Kosmos CI runs on fresh hosted runners. engine/createdbeacon.js sends a real
# install ping to installkosmos.com unless the board process's own environment sets
# AGENT_WORKFORCE_CREATED_URL (createdbeacon.js:73 reads it at ping time; :157 POSTs
# there). It is suppressed only under `node --test` (NODE_TEST_CONTEXT). So any CI
# step that boots a board OUTSIDE node --test adds a silent install to the public
# data unless the dead address http://127.0.0.1:9/api/created is in that board's env.
# A top-level workflow `env:` reaches step shells and in-process node (and children
# they spawn, which inherit env by default), and for a board started as a systemd
# service engine/linuxboard.js reads this var and injects it into the unit, so the
# top-level env reaches service boards too. This test pins that every workflow carries
# it, so a new or edited workflow cannot quietly start phoning home again.
#
# WHY A TOP-LEVEL PARSE, NOT A GREP. test-linux-setup-4920.yml mentions the variable
# only inside `run:` blocks (a `$GITHUB_ENV` export and systemd `Environment=` lines).
# A bare `grep AGENT_WORKFORCE_CREATED_URL` would false-pass a file that has no
# top-level env at all. So the check loads the YAML and reads the TOP-LEVEL `env:`
# key specifically (d["env"]), which is structurally distinct from job env
# (d["jobs"][j]["env"]) and step env. It ALSO fails a job-level or step-level `env:`
# that sets the var to a DIFFERENT value (which would shadow the top-level one for that
# job/step and let the ping out again). Part B proves it reds on exactly those shapes.
#
# WHAT THIS DOES NOT CHECK. It inspects the DECLARED env (the top-level env: and every
# job/step env: mapping), NOT `run:` script bodies. A step that re-sets the var at runtime
# to a different value (`echo "AGENT_WORKFORCE_CREATED_URL=<other>" >> "$GITHUB_ENV"`) or
# unsets it would pass here and reopen the leak for later steps. That is left to review on
# purpose: parsing shell inside every `run:` is fragile, and test-linux-setup-4920.yml
# legitimately exports the SAME dead value via `$GITHUB_ENV` (and injects it into a systemd
# unit), so a run:-body scan would have to tell a benign dead-value export from a malicious
# live-value one. This guard pins the declared env; a run-time mutation is a visible,
# deliberate act for a human reviewer to catch.
#
# RUNS IN test:shell (package.json) via .github/workflows/test.yml's `suite (shell)`
# matrix on every pull_request and push to main. No network.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WFDIR="$REPO/.github/workflows"
URL="http://127.0.0.1:9/api/created"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

# ruby ships on dev Macs and on the runners the shell shards use (ubuntu-latest and macos-latest, #6791); it is the
# repo's house YAML parser (see tools/test-browser-checks-workflow.sh). Hard-fail if
# it is missing under CI (a silent skip there would disarm this guard); skip locally.
if ! command -v ruby >/dev/null 2>&1; then
  [ -n "${CI:-}" ] && fail "ruby is missing under CI, so the top-level env check cannot run"
  pass "SKIPPED (no ruby on this machine; GitHub still rejects malformed YAML)"
  exit 0
fi

# Per-file verdict, printed on one line (never fails the ruby process itself, so a
# parse error is reported as data, not confused with a missing var):
#   OK                 top-level env has the exact dead address, no bad override
#   PARSE_ERROR        not loadable as YAML
#   NOT_MAPPING        loads but the document is not a mapping
#   TOP_MISSING        top-level env: lacks the var entirely
#   TOP_WRONG:<value>  top-level env: has the var but holds a value other than the dead address
#   OVERRIDE:<where>   a job/step env: sets the var to a value other than the dead address
# load_file is passed aliases:true so a workflow that legitimately uses a YAML anchor/alias
# (GitHub Actions supports them) is NOT rejected: under Psych 4 (Ruby 3.1+, the macos-latest
# runner) a bare load_file safe-loads with aliases:false and would raise on an anchor. The
# inner rescue falls back for an older Psych whose load_file lacks the keyword.
RUBY_VERDICT='
require "yaml"
begin
  begin
    d = YAML.load_file(ARGV[0], aliases: true)
  rescue ArgumentError
    d = YAML.load_file(ARGV[0])
  end
rescue Exception
  puts "PARSE_ERROR"; exit 0
end
url = ARGV[1]
unless d.is_a?(Hash); puts "NOT_MAPPING"; exit 0; end
top = d["env"].is_a?(Hash) ? d["env"]["AGENT_WORKFORCE_CREATED_URL"] : nil
bad = []
(d["jobs"].is_a?(Hash) ? d["jobs"] : {}).each do |jn, j|
  next unless j.is_a?(Hash)
  if j["env"].is_a?(Hash) && j["env"].key?("AGENT_WORKFORCE_CREATED_URL") && j["env"]["AGENT_WORKFORCE_CREATED_URL"] != url
    bad << "job #{jn}"
  end
  (j["steps"].is_a?(Array) ? j["steps"] : []).each_with_index do |s, i|
    next unless s.is_a?(Hash) && s["env"].is_a?(Hash)
    if s["env"].key?("AGENT_WORKFORCE_CREATED_URL") && s["env"]["AGENT_WORKFORCE_CREATED_URL"] != url
      bad << "job #{jn} step #{i}"
    end
  end
end
if top.nil?; puts "TOP_MISSING"; exit 0; end
if top != url; puts "TOP_WRONG:" + top.to_s; exit 0; end
unless bad.empty?; puts "OVERRIDE:" + bad.join(","); exit 0; end
puts "OK"
'
verdict() { ruby -e "$RUBY_VERDICT" "$1" "$URL" 2>/dev/null || echo "PARSE_ERROR"; }

# --- Part A: every workflow file carries it at the top level, none overrides it -----
shopt -s nullglob
files=( "$WFDIR"/*.yml "$WFDIR"/*.yaml )
[ "${#files[@]}" -ge 1 ] || fail "no workflow files under $WFDIR (glob matched nothing; the check would pass vacuously)"
# Cross-check the glob against the on-disk count so a dialect/glob slip cannot silently
# check a subset and green (fleet: test-filter-matching-nothing-exits-zero).
disk=$(find "$WFDIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | wc -l | tr -d ' ')
[ "${#files[@]}" -eq "$disk" ] || fail "glob saw ${#files[@]} workflow files but $disk exist under $WFDIR (glob is not seeing every file)"
pass "found ${#files[@]} workflow file(s) under .github/workflows to check"

missing=(); wrong=(); overrides=()
for f in "${files[@]}"; do
  v="$(verdict "$f")"; b="$(basename "$f")"
  case "$v" in
    OK) ;;
    PARSE_ERROR) fail "$b is not parseable YAML (fix it; a malformed workflow would also fail at GitHub)" ;;
    NOT_MAPPING) fail "$b did not load as a YAML mapping" ;;
    TOP_MISSING) missing+=( "$b" ) ;;
    TOP_WRONG:*) wrong+=( "$b (${v#TOP_WRONG:})" ) ;;
    OVERRIDE:*) overrides+=( "$b (${v#OVERRIDE:})" ) ;;
    *) fail "$b produced an unrecognized verdict: $v" ;;
  esac
done
[ "${#missing[@]}" -eq 0 ] \
  || fail "these workflows lack AGENT_WORKFORCE_CREATED_URL in their TOP-LEVEL env: block: ${missing[*]}. Add it (a bare top-level env: holding $URL) so a board started by the workflow cannot send a real install ping; for a systemd service board, engine/linuxboard.js injects this top-level value into the unit."
[ "${#wrong[@]}" -eq 0 ] \
  || fail "these workflows have AGENT_WORKFORCE_CREATED_URL in their TOP-LEVEL env: but set to a value OTHER than $URL (present but wrong, likely a typo): ${wrong[*]}"
[ "${#overrides[@]}" -eq 0 ] \
  || fail "these workflows override AGENT_WORKFORCE_CREATED_URL at a job/step env: with a value other than $URL (that would let the ping out again for that job/step): ${overrides[*]}"
pass "all ${#files[@]} workflows carry AGENT_WORKFORCE_CREATED_URL=$URL at the top-level env, with no job/step override to a different value"

# --- Part B: red-capability. Prove the check reds on the shapes it must reject and ---
# greens on the right one, so Part A's clean run is a real result, not a vacuous one.
tmp="$(mktemp -d "${TMPDIR:-/tmp}/test-ci-created-url-6742.XXXXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
expect() { # $1 fixture, $2 expected verdict (exact, or OVERRIDE/TOP_WRONG prefix), $3 label
  local got; got="$(verdict "$1")"
  case "$2" in
    OVERRIDE|TOP_WRONG) case "$got" in "$2":*) : ;; *) fail "Part B ($3): expected a $2 verdict, got '$got'";; esac ;;
    *) [ "$got" = "$2" ] || fail "Part B ($3): expected '$2', got '$got'" ;;
  esac
  pass "Part B: $3 -> $got"
}

cat > "$tmp/good.yml" <<'YML'
name: good
on: [push]
env:
  AGENT_WORKFORCE_CREATED_URL: http://127.0.0.1:9/api/created
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
YML
expect "$tmp/good.yml" OK "a correct top-level env passes (positive control)"

cat > "$tmp/none.yml" <<'YML'
name: none
on: [push]
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
YML
expect "$tmp/none.yml" TOP_MISSING "no top-level env reds"

cat > "$tmp/step.yml" <<'YML'
name: step
on: [push]
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - env:
          AGENT_WORKFORCE_CREATED_URL: http://127.0.0.1:9/api/created
        run: echo hi
YML
expect "$tmp/step.yml" TOP_MISSING "var only in a step env (no top-level) reds -- a grep would false-pass this"

cat > "$tmp/run.yml" <<'YML'
name: run
on: [push]
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo "AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created" >> "$GITHUB_ENV"
YML
expect "$tmp/run.yml" TOP_MISSING "var only in a run: block reds -- a grep would false-pass this"

cat > "$tmp/wrong.yml" <<'YML'
name: wrong
on: [push]
env:
  AGENT_WORKFORCE_CREATED_URL: https://installkosmos.com/api/created
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
YML
expect "$tmp/wrong.yml" TOP_WRONG "a wrong top-level value reds distinctly as TOP_WRONG (the check pins the dead address)"

cat > "$tmp/override.yml" <<'YML'
name: override
on: [push]
env:
  AGENT_WORKFORCE_CREATED_URL: http://127.0.0.1:9/api/created
jobs:
  j:
    runs-on: ubuntu-latest
    env:
      AGENT_WORKFORCE_CREATED_URL: https://installkosmos.com/api/created
    steps:
      - run: echo hi
YML
expect "$tmp/override.yml" OVERRIDE "a job-level override to a different value reds even with a correct top-level env"

cat > "$tmp/stepoverride.yml" <<'YML'
name: step-override
on: [push]
env:
  AGENT_WORKFORCE_CREATED_URL: http://127.0.0.1:9/api/created
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - env:
          AGENT_WORKFORCE_CREATED_URL: https://installkosmos.com/api/created
        run: echo hi
YML
expect "$tmp/stepoverride.yml" OVERRIDE "a STEP-level override to a different value reds even with a correct top-level env"

cat > "$tmp/notmapping.yml" <<'YML'
- this document
- is a sequence
- not a mapping
YML
expect "$tmp/notmapping.yml" NOT_MAPPING "a workflow that loads but is not a mapping reds distinctly"

cat > "$tmp/anchored.yml" <<'YML'
name: anchored
on: [push]
_addr: &addr http://127.0.0.1:9/api/created
env:
  AGENT_WORKFORCE_CREATED_URL: *addr
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
YML
expect "$tmp/anchored.yml" OK "a YAML anchor/alias in a correct top-level env is accepted, not rejected as PARSE_ERROR (GitHub Actions supports anchors)"

cat > "$tmp/badyaml.yml" <<'YML'
name: broken
on: [push]
env:
  AGENT_WORKFORCE_CREATED_URL: http://127.0.0.1:9/api/created
   bad-indent: oops
jobs: [
YML
expect "$tmp/badyaml.yml" PARSE_ERROR "an unparseable workflow reds distinctly (not reported as a missing var)"

echo "ci-created-url-6742: PASS"
