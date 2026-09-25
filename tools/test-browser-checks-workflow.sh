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
    abort "file-red-card must hold exactly issues: write (it makes issue and label calls only), got #{cj["permissions"].inspect}" unless cj["permissions"] == { "issues" => "write" }
    fsteps = fj["steps"] || []
    col = fsteps.find { |st| st["id"] == "failed" }
    abort "the label collector must run after a failed, timed-out or cancelled checks step (if: always())" unless col && col["if"].to_s.strip == "always()"
    abort "browser-checks-full or one of its steps is continue-on-error; a red full run must not report success" if fj["continue-on-error"] || fsteps.any? { |st| st["continue-on-error"] }
    abort "browser-checks-full.yml must run steps as bash -eo pipefail (defaults.run.shell: bash); without it a pipeline reports its last command, got #{f["defaults"].inspect}" unless ((f["defaults"] || {})["run"] || {})["shell"] == "bash"
    abort "the concurrency group must separate triggers (github.ref AND github.event_name), or a dispatch can supersede a pending nightly, got #{(f["concurrency"] || {})["group"].inspect}" unless (f["concurrency"] || {})["group"].to_s.gsub(/\s+/, "") == "browser-checks-full-${{github.ref}}-${{github.event_name}}"
    abort "browser-checks-full.yml must never cancel a nightly run in progress (concurrency cancel-in-progress false), got #{(f["concurrency"] || {}).inspect}" unless (f["concurrency"] || {})["cancel-in-progress"] == false
    # The red-check list crosses jobs: collector step (id failed) -> job output "failed" ->
    # RED in the card step. A break anywhere turns every card into "(none captured)".
    di = fsteps.index { |st| st["run"].to_s.strip == "git checkout --detach" }
    ci = fsteps.index(cs)
    fi = fsteps.index { |st| st["id"] == "failed" }
    abort "the detach step must come BEFORE the checks step (else the checks run on a branch)" unless di && ci && di < ci
    abort "the label collector must come AFTER the checks step (else it reads no log)" unless fi && ci && fi > ci
    abort "the checks step must force KOSMOS_SKIP_BROWSER_CHECKS=0 (a skipped run exits 0 and would close the card)" unless cs["run"].to_s.include?("KOSMOS_SKIP_BROWSER_CHECKS=0")
    abort "browser-checks-full must detach HEAD before the checks (the cut runs from a detached, frozen tree; on a branch browser-checks.sh takes a re-exec path the cut never does)" unless fsteps.any? { |st| st["run"].to_s.strip == "git checkout --detach" }
    abort "no collector step with id failed" unless (fj["steps"] || []).any? { |st| st["id"] == "failed" && st["run"].to_s.include?("labels=") }
    abort "browser-checks-full must export steps.failed.outputs.labels as outputs.failed, got #{fj["outputs"].inspect}" unless (fj["outputs"] || {})["failed"].to_s.gsub(/\s+/, "") == "${{steps.failed.outputs.labels}}"
    abort "the card step must read RED from needs.browser-checks-full.outputs.failed" unless (cj["steps"] || []).any? { |st| (st["env"] || {})["RED"].to_s.gsub(/\s+/, "") == "${{needs.browser-checks-full.outputs.failed}}" }
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
# the parsed YAML and executed under -eo pipefail, which is exactly what the steps get
# (the invariants above pin defaults.run.shell: bash, i.e. bash -eo pipefail), with gh
# stubbed as a shell FUNCTION (never a freshly written executable).
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
  # The card's retry wrapper, extracted from the card script itself: two failures then a
  # success must go through; three failures must raise ::error:: and return non-zero.
  sed -n '/^ghr() {/,/return 1; }$/p' "$BT/card.sh" > "$BT/ghr.sh"
  grep -q 'ghr()' "$BT/ghr.sh" || fail "could not extract ghr from the card script"
  # The attempts run in a subshell (ghr buffers each one), so the counter lives in a file.
  rm -f "$BT/flaky.n"
  out=$(GH_RETRY_SECONDS=0 RUN_URL=u F="$BT/flaky.n" bash -c '. "$1"; flaky() { n=$(( $(cat "$F" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F"; [ "$n" -ge 3 ]; }; ghr flaky a b && echo "ok after $(cat "$F")"' _ "$BT/ghr.sh" 2>&1) || true
  [ "$out" = "ok after 3" ] || fail "ghr did not retry through two failures: $out"
  # A failed attempt that printed part of its output first: only the successful attempt's
  # output is emitted, so a paged read cannot list a card twice.
  rm -f "$BT/flaky.n"
  out=$(GH_RETRY_SECONDS=0 RUN_URL=u F="$BT/flaky.n" bash -c '. "$1"; paged() { n=$(( $(cat "$F" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F"; echo 42; [ "$n" -ge 2 ] && echo 43; [ "$n" -ge 2 ]; }; ghr paged' _ "$BT/ghr.sh" 2>&1) || true
  [ "$out" = "$(printf '42\n43')" ] || fail "ghr emitted a failed attempt's partial output: [$out]"
  out=$(GH_RETRY_SECONDS=0 RUN_URL=u bash -c '. "$1"; ghr false issue list; echo "rc=$?"' _ "$BT/ghr.sh" 2>&1) || true
  printf '%s' "$out" | grep -q '::error::false issue list failed 3 times' && printf '%s' "$out" | grep -q 'rc=1' || fail "ghr did not report a final failure: $out"
  # FAILED-LIST splits on "|", so no FAILED entry may contain one.
  if grep -vE '^[[:space:]]*#' "$REPO/tools/browser-checks.sh" | grep -E 'FAILED\+=\(' | grep -qF '|'; then fail "a FAILED+=() entry in browser-checks.sh contains '|', which FAILED-LIST would split into fake checks"; fi
  # The driver's OWN FAILED-LIST line, run on a fixture with a spaced entry, must split back
  # into the same entries on "|" (a separator change would turn a spaced entry into fake checks).
  fl_line=$(grep -E '^[[:space:]]*log "FAILED-LIST:' "$REPO/tools/browser-checks.sh" | head -1)
  fl_out=$(bash -c 'log() { printf "%s\n" "$*"; }; FAILED=("render-fields" "render-list-row render-fields (rich board did not boot)"); '"$fl_line" 2>&1)
  fl_back=$(printf '%s' "${fl_out#FAILED-LIST:}" | sed 's/^[[:space:]]*//' | tr '|' '\n')
  [ "$fl_back" = "$(printf 'render-fields\nrender-list-row render-fields (rich board did not boot)')" ] || fail "the driver's FAILED-LIST line does not split back into its entries on '|': [$fl_out]"
  # A cut-short run: a log that never reached the summary has no FAILED-LIST line.
  mkdir -p "$BT/cut"; printf 'PASS  render-a\nFAIL  render-b (failed twice)\n' > "$BT/cut/browser-checks.log"
  RUNNER_TEMP="$BT/cut" GITHUB_OUTPUT="$BT/o3" bash -eo pipefail -c ': > "$GITHUB_OUTPUT"; . "$1"' _ "$BT/collect.sh" >/dev/null 2>&1 || fail "the collector aborted on a cut-short log"
  grep -q '^labels=(none captured' "$BT/o3" || fail "a cut-short log did not fall back: $(cat "$BT/o3")"
  # The token the collector reads is the one the driver writes (the two are separate files).
  grep -qE '^[[:space:]]*log "FAILED-LIST:' "$REPO/tools/browser-checks.sh" || fail "browser-checks.sh no longer writes a FAILED-LIST: line, so every card would carry no labels"
  pass "the label collector reads only the FAILED-LIST: summary (entries kept whole), and falls back without aborting when there is no log"
  # Card script. $1 = the checks job RESULT, $2 = the open card the REST list holds (empty
  # or a number); the open card's last report names render-fields and regress-a-night.
  # Every stubbed gh read (the paginated REST issues list, label list, issue view) answers
  # with fixture JSON run through the script's OWN -q filter with real jq, so the filters are
  # exercised, not bypassed. VIEWFAIL=1 makes issue view fail (the unreadable-report path).
  if ! command -v jq >/dev/null 2>&1; then
    [ -n "${CI:-}" ] && fail "jq is missing under CI, so the card's filters cannot be run"
    pass "SKIPPED the card script (no jq on this machine)"; HAVE_JQ=""
  else HAVE_JQ=1; fi
  if [ -n "$HAVE_JQ" ]; then
  # The REAL gh is authenticated on dev machines: the child gets a poisoned gh first on its
  # PATH, an invalid token and an empty config, so an edit that bypasses the stub (command
  # gh, a full path) fails loudly here instead of reaching GitHub.
  mkdir -p "$BT/poison" "$BT/ghcfg"; printf '#!/bin/sh\necho "REAL gh REACHED: $*" >&2; exit 99\n' > "$BT/poison/gh"; chmod +x "$BT/poison/gh"
  card() {
    PATH="$BT/poison:$PATH" GH_TOKEN=invalid GH_CONFIG_DIR="$BT/ghcfg" GH_RETRY_SECONDS=0 \
    CLOSEFAIL="${CLOSEFAIL:-}" LISTFAIL="${LISTFAIL:-}" LABELFAIL="${LABELFAIL:-}" LCFAIL="${LCFAIL:-}" CREATEFAIL="${CREATEFAIL:-}" FLAGDIR="$BT/flags" GITHUB_RUN_ATTEMPT="${ATTEMPT:-1}" COMMENTFILE="${COMMENTFILE:-}" \
    VIEWFAIL="${VIEWFAIL:-}" BODYFILE="${BODYFILE:-}" VIEWBODY="${VIEWBODY:-}" LABEL="${LABEL:-}" RESULT="$1" OPEN="$2" RED="${REDV-render-fields|render-thread|regress-a-night (server did not boot)|render-list-row render-fields (rich board did not boot)}" GITHUB_REPOSITORY=o/r GITHUB_SHA=abc RUN_URL=https://example.test/actions/runs/4242 bash -eo pipefail -c '
      qarg() { local prevarg="" a; for a in "$@"; do [ "$prevarg" = "-q" ] && { printf "%s" "$a"; return 0; }; prevarg="$a"; done; return 1; }
      gh() { case "$1 $2" in
        "label list") [ -n "$LABELFAIL" ] && { echo "HTTP 502" >&2; return 1; }
          f=$(qarg "$@") || { echo "CALL unexpected label list without -q"; return 1; }
          if [ -n "$LABEL" ]; then printf "%s" "[{\"name\":\"nightly-browser-checks-red\"}]"; else printf "%s" "[]"; fi | jq -r "$f" ;;
        "label create") [ -n "$LCFAIL" ] && { echo "HTTP 502" >&2; return 1; }; echo "CALL label-create" ;;
        "api --paginate")
          # (every lookup pages through the list: gh api --paginate <url>)
          case "$3" in repos/o/r/issues\?*) ;; *) echo "CALL unexpected api $3"; return 1 ;; esac
          # The REST issues list the script now uses for every lookup. Fixture issues: the open
          # card (OPEN) and #3 carry the label; the ghost card (#9, made by a create that
          # reported an error) exists once its flag is set; #5 is an unrelated issue; #6 is a PR
          # with the card title (the REST list returns PRs too). The -q filter of the script is
          # applied with real jq, so every lookup filter is exercised.
          # LISTFAIL=1 fails every list; LISTFAIL=first fails the FIRST lookup (its 3 retried
          # attempts), then answers.
          if [ "$LISTFAIL" = first ]; then c=$(cat "$FLAGDIR/listfail" 2>/dev/null || echo 0)
            if [ "$c" -lt 3 ]; then echo $((c + 1)) > "$FLAGDIR/listfail"; echo "HTTP 502" >&2; return 1; fi
          elif [ -n "$LISTFAIL" ]; then echo "HTTP 502" >&2; return 1; fi
          f=$(qarg "$@") || { echo "CALL unexpected api list without -q"; return 1; }
          T="Nightly full browser-check run is not green on main"
          lab="[{\"name\":\"nightly-browser-checks-red\"}]"
          bot="{\"login\":\"github-actions[bot]\"}"
          # #8: an OUTSIDER opened an issue with the card title (the repo is public).
          items="{\"number\":5,\"title\":\"something else\",\"labels\":[],\"user\":$bot},{\"number\":6,\"title\":\"$T\",\"labels\":[],\"pull_request\":{},\"user\":$bot},{\"number\":8,\"title\":\"$T\",\"labels\":[],\"user\":{\"login\":\"mallory\"}}"
          [ -f "$FLAGDIR/ghost" ] && items="{\"number\":9,\"title\":\"$T\",\"labels\":$lab,\"user\":$bot},$items"
          case "$OPEN" in ""|null) ;; *) items="{\"number\":$OPEN,\"title\":\"$T\",\"labels\":$lab,\"user\":$bot},{\"number\":3,\"title\":\"$T\",\"labels\":$lab,\"user\":$bot},$items" ;; esac
          all="[$items]"
          case "$3" in *labels=*) all=$(printf "%s" "$all" | jq -c "map(select(any(.labels[]; .name == \"nightly-browser-checks-red\")))") ;; esac
          printf "%s" "$all" | jq -r "$f" ;;
        "issue view")
          [ -n "$VIEWFAIL" ] && { echo "HTTP 502" >&2; return 1; }
          f=$(qarg "$@") || { echo "CALL unexpected issue view without -q"; return 1; }
          if [ -n "$VIEWBODY" ]; then jq -n --arg b "$VIEWBODY" "{author: {login: \"app/github-actions\"}, body: \$b, comments: []}" | jq -r "$f"; return; fi
          # The ghost card (#9) is the one THIS run made: its body names this run.
          if [ "$3" = 9 ]; then jq -n --arg b "The nightly full page-layer run ended failure: $RUN_URL" "{author: {login: \"app/github-actions\"}, body: \$b, comments: []}" | jq -r "$f"; return; fi
          printf "%s" "{\"author\":{\"login\":\"app/github-actions\"},\"body\":\"The nightly full page-layer run failed\\n\\nRed checks: an old entry\",\"comments\":[{\"author\":{\"login\":\"github-actions\"},\"body\":\"Still not green (failure) at old: u\\nNEW since the last red night: none\\nRed checks: render-fields | regress-a-night (server did not boot)\"},{\"author\":{\"login\":\"someone\"},\"body\":\"a person quoting it: Red checks: something else entirely\"},{\"author\":{\"login\":\"mallory\"},\"body\":\"Still not green (failure) at spoof: u\\nRed checks: render-thread | render-list-row render-fields (rich board did not boot)\"}]}" | jq -r "$f" ;;
        "issue comment") echo "CALL comment $3 :: $*"
          [ -n "$COMMENTFILE" ] && { prevarg=""; for a in "$@"; do [ "$prevarg" = "--body" ] && printf "%s" "$a" > "$COMMENTFILE"; prevarg="$a"; done; }; true ;;
        "issue create")
          # CREATEFAIL=ghost: fails but GitHub made it. CREATEFAIL=once: fails the first time only.
          if [ "$CREATEFAIL" = ghost ] && [ ! -f "$FLAGDIR/ghost" ]; then : > "$FLAGDIR/ghost"; echo "HTTP 502" >&2; return 1; fi
          if [ "$CREATEFAIL" = once ] && [ ! -f "$FLAGDIR/once" ]; then : > "$FLAGDIR/once"; echo "HTTP 502" >&2; return 1; fi
          echo "CALL create :: $*"
          # keep the real body, so a later arm can read back what this job wrote
          [ -n "$BODYFILE" ] && { prevarg=""; for a in "$@"; do [ "$prevarg" = "--body" ] && printf "%s" "$a" > "$BODYFILE"; prevarg="$a"; done; }; true ;;
        "issue close") [ -n "$CLOSEFAIL" ] && { echo "HTTP 502" >&2; return 1; }; echo "CALL close $3 :: $*" ;;
        *) echo "CALL unexpected $*"; return 1 ;;
      esac; }
      . "$1"' _ "$BT/card.sh" > "$BT/arm.out" 2>&1
    local rc=$?
    # Every arm's output is kept, so "never reached the real gh" is checked across all of them.
    cat "$BT/arm.out" >> "$BT/all-arms.out"; cat "$BT/arm.out"; return "$rc"
  }
  out="$(card failure "")" || fail "card script failed on a fresh streak: $out"
  case "$out" in *"CALL label-create"*"CALL create"*"Red checks: render-fields | render-thread | regress-a-night (server did not boot) | render-list-row render-fields (rich board did not boot)"*) ;; *) fail "a fresh red streak did not create the label and a card naming the red checks: $out" ;; esac
  case "$out" in *"CALL comment"*|*"CALL close"*) fail "a fresh red streak commented or closed: $out" ;; esac
  out="$(LABEL=1 card failure "")" || fail "card script failed on a fresh streak with the label present: $out"
  case "$out" in *"CALL label-create"*) fail "the label already exists but was created again: $out" ;; *"CALL create"*) ;; *) fail "a fresh streak with the label present filed no card: $out" ;; esac
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
  out="$(card success 7)" || fail "card script failed on a green night with an open card: $out"
  case "$out" in *"CALL close 7"*) ;; *) fail "the first green night did not close the open card: $out" ;; esac
  case "$out" in *"CALL create"*) fail "a green night created a card: $out" ;; esac
  printf '%s\n' "$out" | grep 'CALL comment' | grep -qv 'Green again' && fail "a green night posted a comment other than the closing note: $out"
  out="$(card success "")" || fail "card script failed on a green night with no card: $out"
  case "$out" in *"CALL "*) fail "a green night with no open card did anything: $out" ;; esac
  # Round trip: the card this job CREATES is what the next night reads back. Feed the real
  # created body (not a hand-written fixture) into issue view, so a reworded opening line
  # or "Red checks:" format breaks this arm instead of silently making everything NEW.
  : > "$BT/created-body"
  out="$(BODYFILE="$BT/created-body" REDV="render-fields|regress-a-night (server did not boot)" card failure "")" || fail "round trip: create failed: $out"
  [ -s "$BT/created-body" ] || fail "round trip: the created card body was not captured: $out"
  out="$(VIEWBODY="$(cat "$BT/created-body")" REDV="render-fields|regress-a-night (server did not boot)|render-thread" card failure 7)" || fail "round trip: comment failed: $out"
  newline="$(printf '%s\n' "$out" | sed -n 's/^NEW since the last red night: //p')"
  [ "$newline" = "render-thread" ] || fail "round trip: reading back the card this job created, NEW should be exactly render-thread, got [$newline]: $out"
  # Round trip, the COMMENT this job writes (the report every later night reads).
  : > "$BT/comment-body"
  out="$(COMMENTFILE="$BT/comment-body" REDV="render-fields|render-thread" card failure 7)" || fail "comment round trip: comment failed: $out"
  [ -s "$BT/comment-body" ] || fail "comment round trip: the comment body was not captured: $out"
  out="$(VIEWBODY="$(cat "$BT/comment-body")" REDV="render-fields|render-thread|render-push-718" card failure 7)" || fail "comment round trip: second night failed: $out"
  newline="$(printf '%s\n' "$out" | sed -n 's/^NEW since the last red night: //p')"
  [ "$newline" = "render-push-718" ] || fail "comment round trip: reading back this job's own comment, NEW should be exactly render-push-718, got [$newline]: $out"
  # Green closes only on a first attempt, and closes EVERY open card.
  out="$(card success 7)" || fail "green close failed: $out"
  case "$out" in *"CALL close 7"*"CALL close 3"*) ;; *) fail "a green night did not close every open card: $out" ;; esac
  [ "$(printf '%s\n' "$out" | grep -c 'CALL comment 7')" -eq 1 ] || fail "the closing note was not posted exactly once on card 7: $out"
  out="$(ATTEMPT=2 card success 7)" || fail "green re-run failed: $out"
  case "$out" in *"CALL close"*) fail "a RE-RUN of an older night closed the card: $out" ;; esac
  case "$out" in *"CALL comment 7"*"re-run"*) ;; *) fail "a green re-run did not say on the card why it did not close: $out" ;; esac
  # Every way a red night with no open card could end with NO card.
  mkdir -p "$BT/flags"
  out="$(LABELFAIL=1 card failure "")" || fail "a failed label lookup aborted the red report: $out"
  case "$out" in *"CALL create"*) ;; *) fail "a failed label lookup filed no card: $out" ;; esac
  out="$(LCFAIL=1 card failure "")" || fail "a label that could not be created aborted the red report: $out"
  case "$out" in *"CALL create"*"Filed without"*) ;; *) fail "a missing label filed no card, or did not say so: $out" ;; esac
  case "$out" in *"--label"*) fail "a card was created with a label that does not exist: $out" ;; esac
  rm -f "$BT/flags/"*; out="$(LABEL=1 CREATEFAIL=once card failure "")" || fail "a create that failed once was not retried: $out"
  [ "$(printf '%s\n' "$out" | grep -c 'CALL create')" -eq 1 ] || fail "a truly failed create did not end with exactly one card: $out"
  rm -f "$BT/flags/"*; out="$(LABEL=1 CREATEFAIL=ghost card failure "")" || fail "a create that GitHub did despite the error aborted: $out"
  case "$out" in *"CALL create"*) fail "a create that GitHub had done was repeated (a duplicate card): $out" ;; esac
  rm -f "$BT/flags/"*; out="$(LCFAIL=1 CREATEFAIL=ghost card failure "")" || fail "no label + a create GitHub did despite an error aborted: $out"
  case "$out" in *"CALL create"*) fail "with no label, a create GitHub had done was repeated (a duplicate card): $out" ;; esac
  # No label and a create that TRULY failed: the title lookup must skip the PR carrying the
  # card title (#6) and the unrelated #5, find nothing, and create exactly once.
  rm -f "$BT/flags/"*; out="$(LCFAIL=1 CREATEFAIL=once card failure "")" || fail "no label + a real create failure aborted: $out"
  [ "$(printf '%s\n' "$out" | grep -c 'CALL create')" -eq 1 ] || fail "no label + a real create failure did not end with exactly one card (the PR with the card title must not count): $out"
  # The first lookup fails and the create fails while card 7 is open: the report goes on 7.
  rm -f "$BT/flags/"*; out="$(LISTFAIL=first CREATEFAIL=once LABEL=1 card failure 7)" || fail "lookup+create failure aborted: $out"
  case "$out" in *"CALL comment 7"*"not computed"*) ;; *) fail "a night whose lookup and create both failed left no report on the open card: $out" ;; esac
  rm -f "$BT/flags/"*
  # After a night with no captured labels, the next real reds are ALL listed as NEW, never
  # "none" (which would hide a first-time regression).
  out="$(VIEWBODY="$(printf 'Still not green (failure) at x: u\nNEW since the last red night: none\nRed checks: (none captured; see the run log)')" REDV="render-fields|render-thread" card failure 7)" || fail "placeholder report: $out"
  case "$(printf '%s\n' "$out" | sed -n 's/^NEW since the last red night: //p')" in
    "render-fields | render-thread"*) ;;
    *) fail "after a no-labels night, the real reds were not all listed as NEW: $out" ;;
  esac
  # The first lookup fails AND the create was a ghost (GitHub made #9, whose body names this
  # run): the report goes on the card that was already open (7), not on #9.
  rm -f "$BT/flags/"*; out="$(LISTFAIL=first CREATEFAIL=ghost LABEL=1 card failure 7)" || fail "lookup failure + ghost create aborted: $out"
  case "$out" in *"CALL comment 9"*) fail "the report went on the card this run had just made: $out" ;; esac
  case "$out" in *"CALL comment 7"*) ;; *) fail "lookup failure + ghost create left no report on the already-open card: $out" ;; esac
  rm -f "$BT/flags/"*
  # THIS run captured no labels: the placeholder is never listed as a NEW check.
  out="$(REDV="" card failure 7)" || fail "a run with no captured labels: $out"
  case "$(printf '%s\n' "$out" | sed -n 's/^NEW since the last red night: //p')" in
    "(not computed"*) ;;
    *) fail "a run with no captured labels listed the placeholder as a NEW check: $out" ;;
  esac
  # No card open, the first lookup fails, and the create is a ghost: the card exists and holds
  # the report, so the job ends GREEN with no extra comment (it used to end with status 1).
  rm -f "$BT/flags/"*; out="$(LISTFAIL=first CREATEFAIL=ghost LABEL=1 card failure "")" && rc=0 || rc=$?   # (a bare rc=$? would abort under -e)
  [ "$rc" -eq 0 ] || fail "a correctly filed ghost card ended the card job non-zero: $out"
  case "$out" in *"CALL comment"*) fail "a ghost card got an extra comment: $out" ;; esac
  rm -f "$BT/flags/"*
  # A close that fails (3 tries) leaves the card open on a green main: the job ends NON-ZERO,
  # and no closing note is posted for a card that did not close.
  out="$(CLOSEFAIL=1 card success 7)" && rc=0 || rc=$?
  [ "$rc" -ne 0 ] || fail "a failed close ended the card job green: $out"
  case "$out" in *"Green again"*) fail "a closing note was posted for a card that did not close: $out" ;; esac
  # CRLF from a web edit must not make every check NEW.
  out="$(VIEWBODY="$(printf 'Still not green (failure) at x: u\r\nNEW since the last red night: none\r\nRed checks: render-fields | render-thread\r')" REDV="render-fields|render-thread" card failure 7)" || fail "CRLF report: $out"
  [ "$(printf '%s\n' "$out" | sed -n 's/^NEW since the last red night: //p')" = "none" ] || fail "a CRLF previous report made entries NEW: $out"
  # The open-card lookup itself fails (3 tries): a red night still files a card, a green does nothing.
  out="$(LISTFAIL=1 LABEL=1 card failure 7)" || fail "a failed lookup aborted the red report: $out"
  case "$out" in *"CALL create"*) ;; *) fail "a red night with a failed card lookup filed nothing: $out" ;; esac
  # A green night that cannot list the cards acts on nothing and ends NON-ZERO (the run list
  # shows it; the next night retries).
  out="$(LISTFAIL=1 card success 7)" && rc=0 || rc=$?
  [ "$rc" -ne 0 ] || fail "a green night with a failed lookup ended green: $out"
  case "$out" in *"CALL "*) fail "a green night with a failed lookup acted: $out" ;; esac
  [ -s "$BT/all-arms.out" ] || fail "no card arm output was collected, so the real-gh check below would see nothing"
  grep -q "REAL gh REACHED" "$BT/all-arms.out" && fail "the card script reached the real gh in some arm: $(grep -m1 'REAL gh REACHED' "$BT/all-arms.out")"
  pass "the card script: fresh red creates, open red comments leading with NEW checks, a timeout/cancel files, green closes, green with no card is a no-op"
  fi
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
