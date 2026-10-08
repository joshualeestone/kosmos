#!/usr/bin/env bash
# #5488: tools/ci-plans-only-reuse.sh reuses a green verdict ONLY for a plain plan-file change, and
# prints nothing (= run the suite) on every other shape, including every way it could fail to find out.
# A real git repo; `gh` is a stub on PATH that refuses unless it was asked for green pull_request
# test.yml runs of this branch, then prints "<run id> <head sha> <age s>" lines as --jq would.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SUBJECT="$HERE/ci-plans-only-reuse.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

mkdir -p "$T/bin" "$T/repo"
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
[ -n "${STUB_GH_FAIL:-}" ] && exit 1
a=" $* "
if [ "$1 $2" = "run view" ]; then
  # Suite job conclusions for run $3: "skipped" for ids in STUB_REUSED_IDS (a run that itself reused a
  # verdict), a failure for STUB_VIEW_FAIL, else three successes.
  [ -n "${STUB_VIEW_FAIL:-}" ] && exit 1
  case " ${STUB_REUSED_IDS:-} " in *" $3 "*) printf 'skipped\nskipped\nskipped\n'; exit 0 ;; esac
  case "$a" in *" --json jobs "*) ;; *) echo "gh stub: run view without --json jobs: $*" >&2; exit 3 ;; esac
  printf 'success\nsuccess\nsuccess\n'; exit 0
fi
for want in " run list " " --workflow test.yml " " --branch br " " --event pull_request " " --status success " "createdAt"; do
  case "$a" in *"$want"*) ;; *) echo "gh stub: missing '$want' in: $*" >&2; exit 3 ;; esac
done
printf '%s' "${STUB_GH_OUT:-}"
EOF
chmod +x "$T/bin/gh"

R="$T/repo"
g() { git -C "$R" -c user.name=t -c user.email=t@t "$@" >/dev/null 2>&1; }
g init -q; mkdir -p "$R/.claude/plans" "$R/docs" "$R/tools"
echo a > "$R/tools/x.sh"; echo p > "$R/.claude/plans/b-pre-challenge.md"; echo d > "$R/docs/d.md"
g add -A; g commit -qm base; BASE="$(git -C "$R" rev-parse HEAD)"

commit_change() { # <path> -> prints the new sha, on a fresh branch from BASE
  g checkout -q -B "c$RANDOM$RANDOM" "$BASE"; mkdir -p "$R/$(dirname "$1")"; echo "$RANDOM" >> "$R/$1"; g add -A; g commit -qm change
  git -C "$R" rev-parse HEAD
}
decide() { # <head> <gh output> -> stdout of the subject
  (cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="$2" bash "$SUBJECT" "$1" br 2>/dev/null)
}
expect_run() { # <label> <head> <gh output>
  local out; out="$(decide "$2" "$3")"
  [ -z "$out" ] && pass "$1: the suite runs" || fail "$1: must run the suite, got '$out'"
}

# CONTROL FOR EVERY "the suite runs" ARM BELOW: these two reuse, so the stub accepted the script's real
# gh arguments (they are the same in every arm). Without them, a stub that refused everything would make
# every "runs the suite" arm pass for the wrong reason.
H="$(commit_change .claude/plans/b-pre-challenge.md)"
out="$(decide "$H" "77 $BASE 60")"
[ "$out" = 77 ] && pass "a proof-only change since a green run reuses that run (77)" || fail "plans-only must reuse 77, got '$out'"
out="$(decide "$H" "90 $H 30
77 $BASE 60")"
[ "$out" = 77 ] && pass "a green run at this same sha is skipped over; the older green one is reused" || fail "same-sha skip-over: got '$out'"
expect_run "the newest green run is older than six hours" "$H" "77 $BASE 21601"
out="$(cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="77 $BASE 100" KOSMOS_REUSE_MAX_AGE_S=99 bash "$SUBJECT" "$H" br 2>/dev/null)"
[ -z "$out" ] && pass "KOSMOS_REUSE_MAX_AGE_S lowers the cap (100s old, cap 99): the suite runs" || fail "age override: got '$out'"
expect_run "a non-numeric age in the listing" "$H" "77 $BASE soon"
expect_run "no age in the listing at all (an output shape change)" "$H" "77 $BASE"
expect_run "no earlier green run" "$H" ""
expect_run "the only green run is at this same sha" "$H" "90 $H 30"
expect_run "the green run's sha is not in the clone (force-pushed)" "$H" "77 0123456789abcdef0123456789abcdef01234567 60"
out="$(cd "$R" && PATH="$T/bin:$PATH" STUB_GH_FAIL=1 bash "$SUBJECT" "$H" br 2>/dev/null)"; rc=$?
[ -z "$out" ] && [ "$rc" -eq 0 ] && pass "gh failing: nothing printed, exit 0 (the suite runs)" || fail "gh failure must print nothing and exit 0, got '$out' rc=$rc"
out="$(cd "$R" && PATH="$T/bin:$PATH" bash "$SUBJECT" "" "" 2>/dev/null)"
[ -z "$out" ] && pass "no sha or branch given: the suite runs" || fail "missing args must run the suite, got '$out'"

expect_run "a code change" "$(commit_change tools/x.sh)" "77 $BASE 60"
expect_run "a docs change (the brand and name scans read docs/)" "$(commit_change docs/d.md)" "77 $BASE 60"
expect_run "a goldencard-2519 plan (render-talk-goldencard-2519 reads it)" "$(commit_change .claude/plans/goldencard-2519-2026-09-01.md)" "77 $BASE 60"
expect_run "a plan in a subdirectory" "$(commit_change .claude/plans/sub/x.md)" "77 $BASE 60"
expect_run "a .test.js file under plans (no-phone-home reads every tracked *.test.js)" "$(commit_change .claude/plans/x.test.js)" "77 $BASE 60"
expect_run "a plan name with a colon (fixture-discipline rejects 'foo:' segments)" "$(commit_change '.claude/plans/http:.md')" "77 $BASE 60"

# A MOVE of a code file into plans: plain `git diff` would list only the new path (rename detection).
g checkout -q -B mv "$BASE"; g mv tools/x.sh .claude/plans/x.md; g commit -qm move
expect_run "a code file MOVED into .claude/plans/ (both sides of the rename count)" "$(git -C "$R" rev-parse HEAD)" "77 $BASE 60"

# A chain of reuses must not reset the age cap: run 88 reused a verdict (its suite was skipped), so it is
# no source; the real run 77 behind it is used, and only if IT is within the cap.
H="$(commit_change .claude/plans/b-pre-challenge.md)"
out="$(cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="88 $BASE 60
77 $BASE 600" STUB_REUSED_IDS=88 bash "$SUBJECT" "$H" br 2>/dev/null)"
[ "$out" = 77 ] && pass "a run that itself reused a verdict is skipped; the real green run behind it (77) is used" || fail "chain: must use 77, got '$out'"
out="$(cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="88 $BASE 60
77 $BASE 30000" STUB_REUSED_IDS=88 bash "$SUBJECT" "$H" br 2>/dev/null)"
[ -z "$out" ] && pass "a fresh reuse in front of a real run past the cap: the suite runs (no chaining past six hours)" || fail "chain past the cap must run the suite, got '$out'"
out="$(cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="77 $BASE 60" STUB_VIEW_FAIL=1 bash "$SUBJECT" "$H" br 2>/dev/null)"
[ -z "$out" ] && pass "the run's jobs cannot be read: the suite runs" || fail "unreadable jobs must run the suite, got '$out'"

# A plan file whose MODE changes is not a plan change: a symlink, or an executable bit.
g checkout -q -B lnk "$BASE"; ln -s ../../tools/x.sh "$R/.claude/plans/l.md"; g add -A; g commit -qm link
expect_run "a symlink added under .claude/plans/" "$(git -C "$R" rev-parse HEAD)" "77 $BASE 60"
g checkout -q -B xbit "$BASE"; chmod +x "$R/.claude/plans/b-pre-challenge.md"; g add -A; g commit -qm xbit
expect_run "an executable bit on a plan file" "$(git -C "$R" rev-parse HEAD)" "77 $BASE 60"

g checkout -q -B empty "$BASE"; g commit -q --allow-empty -m empty
expect_run "nothing changed since the green run (a deliberate re-run)" "$(git -C "$R" rev-parse HEAD)" "77 $BASE 60"

# The workflow wiring, parsed as YAML (as tools.shell-shard-4317.test.js does), not grepped.
WF="$HERE/../.github/workflows/test.yml"
if command -v ruby >/dev/null 2>&1; then
  if ruby -ryaml -e '
    j = YAML.load_file(ARGV[0])["jobs"]
    s = j.fetch("scope"); d = s["steps"].find { |x| x["id"] == "decide" }
    raise "scope must read actions" unless s["permissions"]["actions"] == "read"
    raise "scope output" unless s["outputs"]["reuse"] == "${{ steps.decide.outputs.reuse }}"
    raise "values through env" unless d["env"]["HEAD_REF"] == "${{ github.head_ref }}" && d["env"]["HEAD_SHA"] == "${{ github.event.pull_request.head.sha }}"
    raise "no pasted head_ref" if d["run"].include?("${{")
    raise "decides on pull_request only" unless d["run"].include?(%q{if [ "$EVENT_NAME" = pull_request ]})
    raise "decider from the base branch" unless d["run"].include?(%q{git show "origin/$BASE_REF:tools/ci-plans-only-reuse.sh"}) && d["env"]["BASE_REF"] == "${{ github.base_ref }}"
    raise "never the PR checkout copy" if d["run"].include?("bash tools/ci-plans-only-reuse.sh")
    raise "suite needs scope" unless j["suite"]["needs"] == "scope"
    raise "suite if" unless j["suite"]["if"] == %q{${{ !cancelled() && needs.scope.outputs.reuse == '"'"''"'"' }}}
    t = j["test"]["steps"].find { |x| x["env"] && x["env"]["REUSE"] }
    raise "test reads REUSE" unless t && t["env"]["REUSE"] == "${{ needs.scope.outputs.reuse }}"
    raise "test reads the scope result" unless t["env"]["SCOPE_RESULT"] == "${{ needs.scope.result }}"
    File.write(ARGV[1], t["run"]); File.write(ARGV[2], d["run"])
  ' "$WF" "$T/test-step.sh" "$T/decide-step.sh" 2>"$T/rb.err"; then
    pass "test.yml wiring (parsed): decider from the base branch via env, suite skips only on a named run"
    # Run the REAL `test` step body with each input: a skip passes only with scope success and a numeric id.
    step() { SUITE_RESULT="$1" SCOPE_RESULT="$2" REUSE="$3" RUN_BASE=x bash "$T/test-step.sh" >/dev/null 2>&1; }
    step skipped success 77 && pass "test step: suite skipped, scope ok, run 77 named: green" || fail "test step: a named reuse must pass"
    for c in "skipped success " "skipped success 7x" "skipped failure 77" "failure success 77" "cancelled success 77"; do
      set -- $c
      if step "$1" "$2" "${3:-}"; then fail "test step must stay red for suite=$1 scope=$2 reuse='${3:-}'"
      else pass "test step stays red: suite=$1 scope=$2 reuse='${3:-}'"; fi
    done
    step success success "" && pass "test step: suite success is green" || fail "test step: success must pass"
    # Run the REAL decide body in the scratch repo, with origin/main holding this branch's decider: a
    # broken ref or path there would leave the feature silently dead (it fails toward running).
    H="$(commit_change .claude/plans/b-pre-challenge.md)"
    dcommit="$(cd "$R" && \
      blob="$(git hash-object -w "$SUBJECT")" && \
      tree="$(printf '100644 blob %s\tci-plans-only-reuse.sh\n' "$blob" | git mktree)" && \
      top="$(printf '040000 tree %s\ttools\n' "$tree" | git mktree)" && \
      git -c user.name=t -c user.email=t@t commit-tree "$top" -m decider)"
    git -C "$R" update-ref refs/remotes/origin/main "$dcommit"
    decide_step() { # <base ref> -> the reuse= value the body wrote
      : > "$T/gho"
      (cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="77 $BASE 60" EVENT_NAME="${2:-pull_request}" HEAD_SHA="$H" HEAD_REF=br \
        BASE_REF="$1" RUNNER_TEMP="$T" GITHUB_OUTPUT="$T/gho" bash "$T/decide-step.sh" >/dev/null 2>&1)
      sed -n 's/^reuse=//p' "$T/gho"
    }
    out="$(decide_step main)"
    [ "$out" = 77 ] && pass "decide step (real body): base main holds the decider, plans-only change: reuse=77" || fail "decide step must write reuse=77, got '$out'"
    out="$(decide_step nope)"
    [ -z "$out" ] && pass "decide step: no decider on the base ref: reuse empty (the suite runs)" || fail "missing base copy must leave reuse empty, got '$out'"
    out="$(decide_step main push)"
    [ -z "$out" ] && pass "decide step: on push it never decides (main always runs)" || fail "push must leave reuse empty, got '$out'"
  else
    fail "test.yml wiring: $(cat "$T/rb.err" | head -2)"
  fi
else
  echo "skip test.yml wiring: no ruby to parse YAML (tools.shell-shard-4317.test.js skips the same way)"
fi

if [ "$fails" -eq 0 ]; then echo "test-ci-plans-only-reuse-5488: 0 failures"; exit 0; fi
echo "test-ci-plans-only-reuse-5488: $fails failure(s)"; exit 1
