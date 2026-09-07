#!/usr/bin/env bash
# kosmos#2445: the per-PR page-layer gate. The cut's browser checks (step 3b) must
# ALSO run at PR time, or a rendered-behavior change passes its own PR and only
# fails weeks later at cut (measured: #2085 flaked the 0.6.47 cut twice). This test
# pins the invariants that make .github/workflows/browser-checks.yml actually GATE:
# if the path filter loses the rendered surface, or the browser-checks.sh call goes,
# the workflow keeps existing and silently stops catching the thing it exists for.
#
# It runs in test:shell (test.yml) on EVERY PR, including ones that do not touch the
# rendered surface -- so a PR that breaks this workflow file is caught even though it
# does not itself trigger the browser workflow. Static checks only (no run, no
# network); the workflow is exercised end to end by its own PR run.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WF="$REPO/.github/workflows/browser-checks.yml"
GATE="$REPO/tools/browser-checks.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

[ -f "$WF" ] || fail "browser-checks.yml is missing"
pass "browser-checks.yml exists"

# 0. It is PARSEABLE YAML. The string greps below catch a silent mis-scoping (valid
#    YAML, wrong config); a broken-indentation edit is a DIFFERENT un-gating this
#    guard would otherwise miss (it reds only at GitHub's own parser on the PR run).
#    ruby ships on macOS (dev Macs + the macos-latest runner test:shell runs on); if
#    it is somehow absent, skip -- GitHub still catches malformed YAML loudly.
if command -v ruby >/dev/null 2>&1; then
  ruby -ryaml -e "YAML.load_file(ARGV[0])" "$WF" >/dev/null 2>&1 \
    || fail "browser-checks.yml is not parseable YAML (a broken-indentation edit would un-gate it silently in test:shell)"
  pass "browser-checks.yml parses as YAML"
fi

# CONTROL: the grep instrument works, so a clean run below means the assertion
# found a populated line rather than an empty file. A known-present string must hit.
grep -q '^name: browser-checks' "$WF" || fail "the workflow is not named browser-checks (or the file is empty; the grep instrument is dead)"
grep -q 'this-string-must-never-appear-in-the-workflow-xyzzy' "$WF" && fail "CONTROL: a string that should be absent was found; the grep matches too much"
pass "the grep instrument discriminates (present hits, absent misses)"

# 1. It RUNS the page gate itself, with the SAME strict-version enforcement the cut
#    uses -- so a drifted Playwright runtime is a hard stop here too, not a lie.
grep -qE 'bash[[:space:]]+tools/browser-checks\.sh' "$WF" \
  || fail "the workflow does not run tools/browser-checks.sh -- it gates nothing"
grep -q 'KOSMOS_PW_STRICT_VERSION=1' "$WF" \
  || fail "the workflow does not enforce KOSMOS_PW_STRICT_VERSION=1 (a drifted runtime would pass a green that means nothing)"
pass "the workflow runs browser-checks.sh with the cut's strict version pin"

# 2. It PROVISIONS the pinned runtime the blessed way, or browser-checks.sh finds no
#    Playwright and the job fails loud instead of gating.
grep -qE 'bash[[:space:]]+tools/provision-pw\.sh' "$WF" \
  || fail "the workflow does not provision Playwright via tools/provision-pw.sh"
pass "the workflow provisions Playwright via provision-pw.sh"

# 3. It is a PER-PR gate: triggered on pull_request. Without this it is not the
#    thing the card asked for.
grep -qE '^[[:space:]]*pull_request:' "$WF" || fail "the workflow is not triggered on pull_request"
pass "the workflow triggers on pull_request"

# 4. The PATHS FILTER covers the rendered surface, so a page change TRIGGERS the
#    gate. This is the load control (only these PRs pay the cost) AND the coverage
#    guarantee: drop web/index.html or docs/browser-checks/ from the filter and a
#    #2085-shaped change sails past the gate again -- the exact defect this closes.
#    🔑 MATCH THE LIST-ITEM FORM (`- 'path'`), NOT THE BARE STRING. The header
#    comment also NAMES these paths in prose, so `grep -F web/index.html` would pass
#    on the comment even with the path dropped from the filter (measured: that exact
#    false pass survived a perturbation). A quoted YAML list item is the filter entry
#    and prose is not, so this asserts the entry, not a mention of it.
grep -qE "^[[:space:]]*paths:" "$WF" || fail "the workflow has no paths filter"
# All five entries, not just the rendered surface: provision-pw.sh pins the runtime
# (a change there can alter what the checks see), and the self-path re-runs the job
# when the workflow itself changes (also how THIS PR triggers it). Pinning every
# entry means a dropped path reds here rather than silently narrowing the trigger.
for p in 'web/index\.html' 'docs/browser-checks/' 'tools/browser-checks\.sh' 'tools/provision-pw\.sh' 'test-support/' '\.github/workflows/browser-checks\.yml'; do
  grep -qE "^[[:space:]]*-[[:space:]]*'${p}" "$WF" \
    || fail "the paths filter has no list entry for '${p}'; a change there would not trigger the gate (the #2445 defect)"
done
pass "the paths filter LISTS every trigger surface (rendered page, checks, driver, runtime pin, test-support deps, self)"

# 5. It runs where a green means what a green 3b means: macos-latest, matching
#    test.yml and the cut's own 3b environment.
grep -qE 'runs-on:[[:space:]]*macos-latest' "$WF" \
  || fail "the workflow does not run on macos-latest (it must match the cut's 3b environment)"
pass "the workflow runs on macos-latest, matching the cut"

# 6. Sanity: the gate the workflow calls actually exists and parses, so a green
#    workflow is not calling a missing/broken script.
[ -f "$GATE" ] || fail "tools/browser-checks.sh is missing, so the workflow calls nothing"
bash -n "$GATE" || fail "tools/browser-checks.sh does not parse"
pass "the gate script the workflow calls exists and parses"

printf 'all browser-checks-workflow invariants hold\n'
