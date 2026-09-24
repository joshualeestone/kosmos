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
# does not itself trigger the browser workflow. No network. Mostly static checks; the
# #2518 block also RUNS the two scripts embedded in browser-checks-full.yml, with gh
# stubbed. The workflows themselves are exercised end to end by their own runs.
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
# All six entries, not just the rendered surface: provision-pw.sh pins the runtime
# (a change there can alter what the checks see), test-support/ builds the board the
# checks assert against, and the self-path re-runs the job when the workflow itself
# changes (also how THIS PR triggers it). Pinning every entry means a dropped path
# reds here rather than silently narrowing the trigger.
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

# 7. It SCOPES CI to the DOM-state subset (#2445). The full 3b suite has timing/
#    animation/paint checks that flake on the slow, headless runner (false-RED-
#    prone + low-confidence). Without KOSMOS_BC_CI_ALLOWLIST the gate would run
#    the whole suite and false-red on real PRs, which is what un-shipped the first
#    cut of this gate. Assert the env is set AND names at least the keystone
#    install-flow check, so a silent drop back to the full suite is caught here.
# Anchor on the YAML env-KEY form (`KOSMOS_BC_CI_ALLOWLIST:` at an indent), not a
# bare name that the header comments also contain -- so dropping the actual env
# entry while leaving the prose cannot false-pass (the comment-false-pass class).
grep -qE "^[[:space:]]+KOSMOS_BC_CI_ALLOWLIST:" "$WF" \
  || fail "the workflow does not set the KOSMOS_BC_CI_ALLOWLIST env entry -- CI would run the full timing-fragile suite and false-red (the #2445 runner-flake defect)"
# The install-flow GATE class this card exists for (#2085): render-gated-next is
# the permission-gated Next on the install screens, a DOM-state check that PASSES
# headless (measured). It is the keystone the allowlist must keep. (click-first-run
# rejoined the allowlist in #2445-followup, now that advanceToAnchor clicks whichever
# control is forward; the earlier "headless-weak, the transition never paints"
# rationale was wrong -- #fr-next was deterministically HIDDEN by the not-connected
# Model step, see the workflow note.) Pin render-gated-next as a folded-scalar list
# item, tolerating leading space -- it is the keystone, so this stays pinned on it.
grep -qE '^[[:space:]]*render-gated-next([[:space:]]|$)' "$WF" \
  || fail "the CI allowlist does not name render-gated-next, the headless-robust install-flow gate check (the #2085 class this gate exists for)"
pass "the workflow scopes CI to the DOM-state allowlist, naming the install-flow gate keystone"

# 8. The gate script HONORS the allowlist AND refuses a green from zero checks.
#    A filter that matched nothing (a typo, an empty env) must HARD-FAIL, never
#    exit 0 having asserted nothing (test-filter-matching-nothing-exits-zero).
#    Pin both the filter and the zero-match guard, so removing either reds here.
# Anchor on the shell READ of the var (`${KOSMOS_BC_CI_ALLOWLIST...`), not a bare
# name the comments also contain -- so the filter can't be deleted while a comment
# keeps this green.
grep -qE '\$\{KOSMOS_BC_CI_ALLOWLIST' "$GATE" \
  || fail "browser-checks.sh does not read KOSMOS_BC_CI_ALLOWLIST -- the workflow env would do nothing and the full suite would run"
grep -q 'matched no checks at all' "$GATE" \
  || fail "browser-checks.sh has no zero-match guard -- a typo'd/empty allowlist could green from zero checks"
pass "the gate honors the allowlist and refuses a green from zero checks"

# #2518: pin each job by PARSED YAML, not by grepping the file. The greps above pass on
# any line in the file, so a second job there would satisfy them for the allowlist job
# (found in review: delete the allowlist job's run line and they stayed green).
# The full set runs in its OWN workflow, nightly + on demand, never on pull_request:
# a red check run on a PR stops /merge-on-green even under continue-on-error.
WF_FULL="$REPO/.github/workflows/browser-checks-full.yml"
[ -f "$WF_FULL" ] || fail "browser-checks-full.yml is missing (#2518: the full set's nightly run)"
if command -v ruby >/dev/null 2>&1; then
  jobs_out="$(ruby -ryaml -e '
    runs = ->(job) { (job["steps"] || []).map { |s| s["run"].to_s }.join("\n") }
    envs = ->(job) { [job["env"] || {}] + (job["steps"] || []).map { |s| s["env"] || {} } }
    d = YAML.load_file(ARGV[0]); g = (d["jobs"] || {})["browser-checks"] or abort "no browser-checks job"
    abort "the allowlist job is continue-on-error; its red must fail the run" if g["continue-on-error"]
    abort "the allowlist job sets no KOSMOS_BC_CI_ALLOWLIST" unless envs.(g).any? { |e| e.key?("KOSMOS_BC_CI_ALLOWLIST") }
    abort "the allowlist job does not run browser-checks.sh with the strict pin" unless runs.(g) =~ /KOSMOS_PW_STRICT_VERSION=1 bash tools\/browser-checks\.sh/
    abort "the allowlist job does not provision Playwright" unless runs.(g).include?("tools/provision-pw.sh")
    abort "the allowlist job is not on macos-latest" unless g["runs-on"] == "macos-latest"
    f = YAML.load_file(ARGV[1])
    on = f["on"] || f[true] || {}
    trig = on.is_a?(Hash) ? on.keys.map(&:to_s).sort : Array(on).map(&:to_s).sort
    abort "browser-checks-full.yml must trigger on exactly schedule + workflow_dispatch, got #{trig.inspect}" unless trig == ["schedule", "workflow_dispatch"]
    fj = (f["jobs"] || {})["browser-checks-full"] or abort "no browser-checks-full job"
    abort "browser-checks-full sets KOSMOS_BC_CI_ALLOWLIST, so it would not run the full set" if envs.(fj).any? { |e| e.key?("KOSMOS_BC_CI_ALLOWLIST") } || runs.(fj).include?("KOSMOS_BC_CI_ALLOWLIST")
    abort "browser-checks-full does not run browser-checks.sh with the strict pin" unless runs.(fj) =~ /KOSMOS_PW_STRICT_VERSION=1 bash tools\/browser-checks\.sh/
    abort "browser-checks-full does not provision Playwright" unless runs.(fj).include?("tools/provision-pw.sh")
    abort "browser-checks-full is not on macos-latest" unless fj["runs-on"] == "macos-latest"
    # The checks job holds contents: read only (third-party installs run there); the
    # separate card job alone holds issues: write, and only for a scheduled failure.
    abort "browser-checks-full.yml top-level permissions must be exactly contents: read, got #{f["permissions"].inspect}" unless f["permissions"] == { "contents" => "read" }
    abort "the checks job must not grant itself permissions" if fj.key?("permissions")
    cs = (fj["steps"] || []).find { |st| st["run"].to_s =~ /bash tools\/browser-checks\.sh/ } or abort "no checks step"
    abort "the checks step needs its own timeout below the job timeout" unless cs["timeout-minutes"].to_i > 0 && cs["timeout-minutes"].to_i < fj["timeout-minutes"].to_i
    cj = (f["jobs"] || {})["file-red-card"] or abort "no file-red-card job (nobody would see a nightly red)"
    abort "file-red-card must need browser-checks-full" unless Array(cj["needs"]).include?("browser-checks-full")
    # always(): it must run after a failed, timed-out or cancelled checks job too (a
    # cancelled job makes failure() false), and on success to close the card.
    abort "file-red-card must run on every scheduled run and nothing else, got if: #{cj["if"].inspect}" unless cj["if"].to_s.gsub(/\s+/, " ").strip == "always() && github.event_name == \x27schedule\x27"
    abort "file-red-card must hold exactly issues: write, got #{cj["permissions"].inspect}" unless cj["permissions"] == { "issues" => "write" }
    abort "browser-checks-full.yml must never cancel a nightly run in progress (concurrency cancel-in-progress false), got #{(f["concurrency"] || {}).inspect}" unless (f["concurrency"] || {})["cancel-in-progress"] == false
    abort "the card step has no GH_TOKEN, so gh cannot file anything" unless (cj["steps"] || []).any? { |st| (st["env"] || {})["GH_TOKEN"].to_s.include?("github.token") }
    # The PR workflow never holds issues: write, at the top or in any job.
    abort "the PR workflow must not hold issues: write" if ((d["permissions"] || {})["issues"]).to_s == "write" || (d["jobs"] || {}).values.any? { |jb| ((jb["permissions"] || {})["issues"]).to_s == "write" }
    puts "ok"
  ' "$WF" "$WF_FULL" 2>&1)" || fail "job invariants: $jobs_out"
  [ "$jobs_out" = ok ] || fail "job invariants did not report ok: $jobs_out"
  pass "each job pinned by parsed YAML: the allowlist job gates PRs; browser-checks-full runs every check, nightly/on demand only"
elif [ -n "${CI:-}" ]; then
  fail "ruby is missing under CI, so the per-job invariants cannot run"
else
  pass "SKIPPED per-job invariants (no ruby on this machine)"
fi

# #2518: the two embedded scripts are behavior, not shape, so RUN them: extracted from
# the parsed YAML and executed under -e and pipefail (the runner's default shell has -e;
# pipefail is the stricter case), with gh stubbed as a shell FUNCTION (never a freshly
# written executable).
if command -v ruby >/dev/null 2>&1; then
  BT="$(mktemp -d)"
  trap 'rm -rf "$BT"' EXIT
  ruby -ryaml -e '
    j = YAML.load_file(ARGV[0])["jobs"]
    File.write(ARGV[1], j["browser-checks-full"]["steps"].find { |s| s["id"] == "failed" }["run"])
    File.write(ARGV[2], j["file-red-card"]["steps"][0]["run"])
  ' "$WF_FULL" "$BT/collect.sh" "$BT/card.sh" || fail "could not extract the embedded scripts"
  # Collector, NO log (an earlier step failed): must reach its fallback, not abort.
  out="$(RUNNER_TEMP="$BT/nolog" GITHUB_OUTPUT="$BT/o1" bash -eo pipefail -c ': > "$GITHUB_OUTPUT"; . "$1"' _ "$BT/collect.sh" 2>&1)" \
    || fail "the label collector aborted with no log under -e/pipefail: $out"
  grep -q '^labels=(none captured' "$BT/o1" || fail "the collector wrote no fallback with no log: $(cat "$BT/o1")"
  # Collector WITH a log that also carries assertion-level FAIL lines: only the summary's labels.
  mkdir -p "$BT/log"; printf '  FAIL  an assertion line\nFAIL  render-fields (failed twice)\nFAILED:  render-fields regress-a-night (server did not boot)\nFAILED-LIST:  render-fields|regress-a-night (server did not boot)\n' > "$BT/log/browser-checks.log"
  RUNNER_TEMP="$BT/log" GITHUB_OUTPUT="$BT/o2" bash -eo pipefail -c ': > "$GITHUB_OUTPUT"; . "$1"' _ "$BT/collect.sh" >/dev/null 2>&1 || fail "the collector failed on a real log"
  [ "$(cat "$BT/o2")" = "labels=render-fields|regress-a-night (server did not boot)" ] || fail "the collector read the wrong labels: $(cat "$BT/o2")"
  pass "the label collector reads only the FAILED-LIST: summary (entries kept whole), and falls back without aborting when there is no log"
  # Card script. $1 = the checks job RESULT, $2 = what the stubbed issue list answers
  # (empty / 7 / null); the open card's last report named render-fields only.
  # Every stubbed gh read (label list, issue list, issue view) answers with fixture JSON run
  # through the script's OWN -q filter with real jq, so all three filters are exercised,
  # not bypassed. An empty issue list makes real jq print "null" for .[0].number, which is
  # the null path. VIEWFAIL=1 makes issue view fail, to check the unreadable-report path.
  command -v jq >/dev/null 2>&1 || fail "jq is required to run the card script's own filter"
  card() {
    VIEWFAIL="${VIEWFAIL:-}" RESULT="$1" OPEN="${2#null}" RED="render-fields|render-thread|regress-a-night (server did not boot)|render-list-row render-fields (rich board did not boot)" GITHUB_REPOSITORY=o/r GITHUB_SHA=abc RUN_URL=u bash -eo pipefail -c '
      qarg() { local prevarg="" a; for a in "$@"; do [ "$prevarg" = "-q" ] && { printf "%s" "$a"; return 0; }; prevarg="$a"; done; return 1; }
      gh() { case "$1 $2" in
        "label list") f=$(qarg "$@") || { echo "CALL unexpected label list without -q"; return 1; }
          printf "%s" "[]" | jq -r "$f" ;;
        "label create") echo "CALL label-create" ;;
        "issue list") f=$(qarg "$@") || { echo "CALL unexpected issue list without -q"; return 1; }
          if [ -n "$OPEN" ]; then printf "%s" "[{\"number\":$OPEN},{\"number\":3}]"; else printf "%s" "[]"; fi | jq -r "$f" ;;
        "issue view")
          [ -n "$VIEWFAIL" ] && { echo "HTTP 502" >&2; return 1; }
          f=$(qarg "$@") || { echo "CALL unexpected issue view without -q"; return 1; }
          printf "%s" "{\"body\":\"card body\\nRed checks: an old entry\",\"comments\":[{\"body\":\"Still not green (failure) at old: u\\nNEW since the last red night: none\\nRed checks: render-fields | regress-a-night (server did not boot)\"},{\"body\":\"a person commented\"}]}" | jq -r "$f" ;;
        "issue comment") echo "CALL comment $3 :: $*" ;;
        "issue create") echo "CALL create :: $*" ;;
        "issue close") echo "CALL close $3 :: $*" ;;
        *) echo "CALL unexpected $*"; return 1 ;;
      esac; }
      . "$1"' _ "$BT/card.sh" 2>&1
  }
  out="$(card failure "")" || fail "card script failed on a fresh streak: $out"
  case "$out" in *"CALL label-create"*"CALL create"*"Red checks: render-fields | render-thread | regress-a-night (server did not boot) | render-list-row render-fields (rich board did not boot)"*) ;; *) fail "a fresh red streak did not create the label and a card naming the red checks: $out" ;; esac
  case "$out" in *"CALL comment"*|*"CALL close"*) fail "a fresh red streak commented or closed: $out" ;; esac
  out="$(card failure 7)" || fail "card script failed with an open card: $out"
  # The NEW entries include a spaced composite that the last report did not name: it must
  # come through WHOLE (a whitespace split would leak "(rich" and "board" as fake checks).
  newline="$(printf '%s\n' "$out" | sed -n 's/^NEW since the last red night: //p')"
  [ "$newline" = "render-thread | render-list-row render-fields (rich board did not boot)" ] \
    || fail "the NEW line is not exactly the two new entries, whole: [$newline] in: $out"
  case "$out" in *"CALL comment 7"*) ;; *) fail "an open card did not get a comment: $out" ;; esac
  case "$out" in *"could not be read"*) fail "a readable previous report was reported unreadable: $out" ;; esac
  # The previous report cannot be read: say so, and list every entry as new.
  out="$(VIEWFAIL=1 card failure 7)" || fail "card script aborted when the previous report could not be read: $out"
  case "$out" in *"CALL comment 7"*"could not be read"*) ;; *) fail "an unreadable previous report was not stated: $out" ;; esac
  case "$out" in *"CALL create"*|*"CALL label-create"*) fail "an open-card streak created again: $out" ;; esac
  out="$(card cancelled "")" || fail "card script failed on a cancelled run: $out"
  case "$out" in *"CALL create"*"ended cancelled"*) ;; *) fail "a cancelled (e.g. timed-out) run did not file a card: $out" ;; esac
  out="$(card failure null)" || fail "card script failed on a null query result: $out"
  case "$out" in *"CALL create"*) ;; *) fail "a literal null from the issue query did not create a card: $out" ;; esac
  case "$out" in *"CALL comment null"*) fail "commented on issue 'null': $out" ;; esac
  out="$(card success 7)" || fail "card script failed on a green night with an open card: $out"
  case "$out" in *"CALL close 7"*) ;; *) fail "the first green night did not close the open card: $out" ;; esac
  case "$out" in *"CALL comment"*|*"CALL create"*) fail "a green night commented or created: $out" ;; esac
  out="$(card success "")" || fail "card script failed on a green night with no card: $out"
  case "$out" in *"CALL "*) fail "a green night with no open card did anything: $out" ;; esac
  pass "the card script: fresh red creates, open red comments leading with NEW checks, a timeout/cancel files, a null lookup is none, green closes, green with no card is a no-op"
elif [ -n "${CI:-}" ]; then
  fail "ruby is missing under CI, so the embedded scripts cannot be run"
else
  pass "SKIPPED running the embedded scripts (no ruby on this machine)"
fi

# An unquoted " #" inside a step name starts a YAML comment and silently truncates it
# (the allowlist step's name parsed as "... (tools/browser-checks.sh," until #2518).
# It also flags a trailing comment after an unquoted name: quote the name, or put the
# comment on its own line.
for wf in "$WF" "$WF_FULL"; do
  cut_short="$(grep -nE "^[[:space:]]*-?[[:space:]]*name:[[:space:]]*[^'\"[:space:]].*[[:space:]]#" "$wf" || true)"
  [ -z "$cut_short" ] || fail "an unquoted step name in $(basename "$wf") contains ' #' and is cut short by YAML: $cut_short"
done
pass "no step name is cut short by an unquoted ' #'"

printf 'all browser-checks-workflow invariants hold\n'
