#!/usr/bin/env bash
# #5488: tools/ci-plans-only-reuse.sh reuses a green verdict ONLY for a plans-only change, and prints
# nothing (= run the suite) on every other shape, including every way it could fail to find out.
# A real git repo; `gh` is a stub on PATH that prints "<run id> <head sha>" lines as --jq would.
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
printf '%s' "${STUB_GH_OUT:-}"
EOF
chmod +x "$T/bin/gh"

R="$T/repo"
g() { git -C "$R" -c user.name=t -c user.email=t@t "$@" >/dev/null 2>&1; }
g init -q; mkdir -p "$R/.claude/plans" "$R/docs" "$R/tools"
echo a > "$R/tools/x.sh"; echo p > "$R/.claude/plans/b-pre-challenge.md"; echo d > "$R/docs/d.md"
g add -A; g commit -qm base; BASE="$(git -C "$R" rev-parse HEAD)"

commit_change() { # <path> -> prints the new sha, on a fresh branch from BASE
  g checkout -q -B "c$RANDOM" "$BASE"; mkdir -p "$R/$(dirname "$1")"; echo "$RANDOM" >> "$R/$1"; g add -A; g commit -qm change
  git -C "$R" rev-parse HEAD
}
decide() { # <head> <gh output> [extra env] -> stdout of the subject
  (cd "$R" && PATH="$T/bin:$PATH" STUB_GH_OUT="$2" bash "$SUBJECT" "$1" br 2>/dev/null)
}

H="$(commit_change .claude/plans/b-pre-challenge.md)"
out="$(decide "$H" "77 $BASE")"
[ "$out" = 77 ] && pass "a proof-only change since a green run reuses that run (77)" || fail "plans-only must reuse 77, got '$out'"

out="$(decide "$H" "90 $H
77 $BASE")"
[ "$out" = 77 ] && pass "a green run at this same sha is skipped over; the older green one is reused" || fail "same-sha skip-over: got '$out'"

H="$(commit_change tools/x.sh)"
out="$(decide "$H" "77 $BASE")"
[ -z "$out" ] && pass "a code change runs the suite" || fail "code change must run the suite, got '$out'"

H="$(commit_change docs/d.md)"
out="$(decide "$H" "77 $BASE")"
[ -z "$out" ] && pass "a docs change runs the suite (the brand and name scans read docs/)" || fail "docs change must run the suite, got '$out'"

H="$(commit_change .claude/plans/goldencard-2519-2026-09-01.md)"
out="$(decide "$H" "77 $BASE")"
[ -z "$out" ] && pass "a goldencard-2519 plan runs the suite (render-talk-goldencard-2519 reads it)" || fail "goldencard plan must run the suite, got '$out'"

H="$(commit_change .claude/plans/b-pre-challenge.md)"
out="$(decide "$H" "")"
[ -z "$out" ] && pass "no earlier green run: the suite runs" || fail "no green run must run the suite, got '$out'"

out="$(decide "$H" "90 $H")"
[ -z "$out" ] && pass "the only green run is at this same sha: the suite runs" || fail "same-sha-only must run the suite, got '$out'"

out="$(decide "$H" "77 0123456789abcdef0123456789abcdef01234567")"
[ -z "$out" ] && pass "the green run's sha is not in the clone (force-pushed): the suite runs" || fail "missing sha must run the suite, got '$out'"

out="$(cd "$R" && PATH="$T/bin:$PATH" STUB_GH_FAIL=1 bash "$SUBJECT" "$H" br 2>/dev/null)"; rc=$?
[ -z "$out" ] && [ "$rc" -eq 0 ] && pass "gh failing: nothing printed, exit 0 (the suite runs)" || fail "gh failure must print nothing and exit 0, got '$out' rc=$rc"

g checkout -q -B empty "$BASE"; g commit -q --allow-empty -m empty; E="$(git -C "$R" rev-parse HEAD)"
out="$(decide "$E" "77 $BASE")"
[ -z "$out" ] && pass "nothing changed since the green run (a deliberate re-run): the suite runs" || fail "empty diff must run the suite, got '$out'"

out="$(cd "$R" && PATH="$T/bin:$PATH" bash "$SUBJECT" "" "" 2>/dev/null)"
[ -z "$out" ] && pass "no sha or branch given: the suite runs" || fail "missing args must run the suite, got '$out'"

# The workflow wiring the script depends on.
WF="$HERE/../.github/workflows/test.yml"
grep -q 'bash tools/ci-plans-only-reuse.sh' "$WF" && pass "test.yml's scope job calls the script" || fail "test.yml does not call the script"
grep -q "if: \${{ !cancelled() && needs.scope.outputs.reuse == '' }}" "$WF" \
  && pass "suite runs unless scope named a run (and still runs if scope failed)" || fail "suite's if is not the fail-toward-testing form"
grep -q 'if \[ "\${{ needs.suite.result }}" = skipped \] && \[ -n "\$reuse" \]' "$WF" \
  && pass "test accepts a skipped suite only with a named run to reuse" || fail "test's reuse arm is missing or looser"
grep -q 'if \[ "\${{ github.event_name }}" = pull_request \]' "$WF" \
  && pass "scope decides only on pull_request (main always runs)" || fail "scope is not gated to pull_request"

if [ "$fails" -eq 0 ]; then echo "test-ci-plans-only-reuse-5488: 0 failures"; exit 0; fi
echo "test-ci-plans-only-reuse-5488: $fails failure(s)"; exit 1
