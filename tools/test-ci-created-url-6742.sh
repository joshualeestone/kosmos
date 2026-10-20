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
# A bare `grep AGENT_WORKFORCE_CREATED_URL` would false-pass on a file that has no
# top-level env at all. So the check loads the YAML and reads the TOP-LEVEL `env:`
# key specifically (d["env"]), which is structurally distinct from job env
# (d["jobs"][j]["env"]) and step env. Part B proves it reds on exactly those shapes.
#
# RUNS IN test:shell (package.json) via .github/workflows/test.yml's `suite (shell)`
# matrix on every pull_request and push to main. No network.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WFDIR="$REPO/.github/workflows"
URL="http://127.0.0.1:9/api/created"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

# ruby ships on dev Macs and the macos-latest runner the shell shards use; it is the
# repo's house YAML parser (see tools/test-browser-checks-workflow.sh). Hard-fail if
# it is missing under CI (a silent skip there would disarm this guard); skip locally.
if ! command -v ruby >/dev/null 2>&1; then
  [ -n "${CI:-}" ] && fail "ruby is missing under CI, so the top-level env check cannot run"
  pass "SKIPPED (no ruby on this machine; GitHub still rejects malformed YAML)"
  exit 0
fi

# Per-file check: exit 0 iff the file's TOP-LEVEL env: holds the exact dead address.
# ARGV[0] the workflow file, ARGV[1] the required URL. load_file also fails loudly on
# a file that is not parseable YAML, which is itself a reason to red.
RUBY_CHECK='
d = YAML.load_file(ARGV[0])
v = (d.is_a?(Hash) && d["env"].is_a?(Hash)) ? d["env"]["AGENT_WORKFORCE_CREATED_URL"] : nil
exit(v == ARGV[1] ? 0 : 1)
'
check_one() { ruby -ryaml -e "$RUBY_CHECK" "$1" "$URL" 2>/dev/null; }

# --- Part A: every workflow file carries it at the top level ------------------------
shopt -s nullglob
files=( "$WFDIR"/*.yml "$WFDIR"/*.yaml )
[ "${#files[@]}" -ge 1 ] || fail "no workflow files under $WFDIR (glob matched nothing; the check would pass vacuously)"
# Cross-check the glob against the on-disk count so a dialect/glob slip cannot silently
# check a subset and green (fleet: test-filter-matching-nothing-exits-zero).
disk=$(find "$WFDIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | wc -l | tr -d ' ')
[ "${#files[@]}" -eq "$disk" ] || fail "glob saw ${#files[@]} workflow files but $disk exist under $WFDIR (glob is not seeing every file)"
pass "found ${#files[@]} workflow file(s) under .github/workflows to check"

missing=()
for f in "${files[@]}"; do
  check_one "$f" || missing+=( "$(basename "$f")" )
done
[ "${#missing[@]}" -eq 0 ] \
  || fail "these workflows lack AGENT_WORKFORCE_CREATED_URL=$URL in their TOP-LEVEL env: block: ${missing[*]}. Add it (a bare top-level env:) so a board started by the workflow cannot send a real install ping; for a systemd/launchd service board, engine/linuxboard.js injects this top-level value into the unit."
pass "all ${#files[@]} workflows carry AGENT_WORKFORCE_CREATED_URL=$URL at the top-level env"

# --- Part B: red-capability. Prove the check reds on the shapes it must reject and ---
# greens on the right one, so Part A's clean run is a real result, not a vacuous one.
tmp="$(mktemp -d "${TMPDIR:-/tmp}/test-ci-created-url-6742.XXXXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT

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
check_one "$tmp/good.yml" || fail "Part B positive control: a correct top-level env was REJECTED (the check itself is broken)"
pass "Part B: a correct top-level env passes (positive control)"

cat > "$tmp/none.yml" <<'YML'
name: none
on: [push]
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
YML
check_one "$tmp/none.yml" && fail "Part B: a workflow with NO top-level env PASSED (the check is vacuous)"
pass "Part B: no top-level env reds"

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
check_one "$tmp/step.yml" && fail "Part B: the var only inside a STEP env PASSED (a grep false-passes this; the parse must not)"
pass "Part B: var only in a step env reds"

cat > "$tmp/run.yml" <<'YML'
name: run
on: [push]
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo "AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created" >> "$GITHUB_ENV"
YML
check_one "$tmp/run.yml" && fail "Part B: the var only inside a run: block PASSED (a grep false-passes this; the parse must not)"
pass "Part B: var only in a run: block reds"

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
check_one "$tmp/wrong.yml" && fail "Part B: a WRONG top-level value (the live endpoint) PASSED (the check must pin the dead address, not any value)"
pass "Part B: wrong top-level value reds"

echo "ci-created-url-6742: PASS"
