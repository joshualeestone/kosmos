#!/bin/bash
# #3011: control + regression guard for the real-LaunchAgents leak guard.
#
# status.codex-observed-2413.test.js leaked five real com.kosmos.agent.* plists into
# ~/Library/LaunchAgents because it never set AGENT_WORKFORCE_LAUNCH into its sandbox,
# so create.js's agentsDir() fell back to the real home and launchd showed the fixtures
# as phantom agents on the board. The fix is (1) the per-test sandbox env and (2) a
# suite-level guard in run-tests.sh (tools/lib/launchagent-leak-guard.sh) that refuses
# a run which created or modified a real com.kosmos.agent.* plist.
#
# This test has two legs, like tools/test-run-tests-codexhome-2858.sh:
#   SOURCE-INVARIANT: run-tests.sh sources the guard lib, snapshots before the suite,
#     and calls the leak check after it (an unwired guard catches nothing).
#   BEHAVIORAL: the lib actually fires on a NEW or MODIFIED com.kosmos.agent.* plist and
#     stays clean when nothing changed -- exercised against a TEMP dir, never the real
#     ~/Library/LaunchAgents, because running the unfixed suite to see the guard fire is
#     the very leak this guards.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RT="$HERE/run-tests.sh"
LIB="$HERE/lib/launchagent-leak-guard.sh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=1; }

[ -f "$RT" ]  || { echo "FAIL  run-tests.sh not found at $RT"; exit 1; }
[ -f "$LIB" ] || { echo "FAIL  guard lib not found at $LIB"; exit 1; }

# --- source-invariant legs: the guard is actually wired into the runner ---------
# Grep a COMMENT-STRIPPED view of run-tests.sh (drop full-line comments) so a comment that
# merely mentions these names -- or a commented-out reference lingering after the wiring is
# removed -- cannot satisfy these legs. The sibling test-run-tests-codexhome-2858.sh pins to
# statement syntax for the same reason; stripping comments achieves it without coupling to the
# exact call shape.
RT_CODE="$(grep -vE '^[[:space:]]*#' "$RT")"
printf '%s\n' "$RT_CODE" | grep -qE '(\.|source)[[:space:]]+.*lib/launchagent-leak-guard\.sh' \
  && pass "run-tests.sh sources the launchagent-leak-guard lib" \
  || fail "run-tests.sh does not source tools/lib/launchagent-leak-guard.sh (guard unwired)"
printf '%s\n' "$RT_CODE" | grep -qE 'launchagent_snapshot' \
  && pass "run-tests.sh takes a pre-suite snapshot (launchagent_snapshot)" \
  || fail "run-tests.sh never calls launchagent_snapshot (no baseline -> guard cannot diff)"
printf '%s\n' "$RT_CODE" | grep -qE 'launchagent_leak_check' \
  && pass "run-tests.sh runs the post-suite leak check (launchagent_leak_check)" \
  || fail "run-tests.sh never calls launchagent_leak_check (guard cannot fire)"

# The snapshot must precede the node suite -- the FIRST test invocation, so it also
# precedes `yarn -s test:shell` which runs after it. Pin the node pattern to the real
# invocation so a comment mentioning `node --test` cannot false-pass this.
# `^[[:space:]]*[^#[:space:]]` skips full-line comments (the first non-space char must not
# be `#`), so a commented-out snapshot line cannot set the ordering line number.
sln="$(grep -nE '^[[:space:]]*[^#[:space:]].*launchagent_snapshot.*_la_guard_before' "$RT" | head -1 | cut -d: -f1)"
[ -z "$sln" ] && sln="$(grep -nE '^[[:space:]]*[^#[:space:]].*launchagent_snapshot' "$RT" | head -1 | cut -d: -f1)"
nln="$(grep -nE 'node --test.*KOSMOS_TEST_FILES' "$RT" | head -1 | cut -d: -f1)"
if [ -n "$sln" ] && [ -n "$nln" ] && [ "$sln" -lt "$nln" ]; then
  pass "the snapshot (line $sln) precedes the node suite (line $nln), so it also precedes test:shell"
else
  fail "the launchagent snapshot does not precede the node suite (snapshot=$sln node=$nln)"
fi

# --- behavioral legs: exercise the lib against a TEMP dir (no real-home touch) ---
# shellcheck source=/dev/null
. "$LIB"

D="$(mktemp -d "${TMPDIR:-/tmp}/la-guard-test.XXXXXXXXXX")"
BEFORE="$(mktemp "${TMPDIR:-/tmp}/la-guard-before.XXXXXXXXXX")"
cleanup() { rm -rf "$D" "$BEFORE"; }
trap cleanup EXIT

# Baseline: a PRE-EXISTING real fleet plist (in the snapshot) must NOT trip the guard
# when the run leaves it untouched -- this is what stops the guard false-firing on a
# machine that runs genuine fleet agents.
printf 'pre-existing\n' > "$D/com.kosmos.agent.realfleet.plist"
launchagent_snapshot "$D" > "$BEFORE"
if launchagent_leak_check "$D" "$BEFORE" 2>/dev/null; then
  pass "clean run: a pre-existing com.kosmos.agent.* plist left untouched does NOT trip the guard"
else
  fail "false positive: an untouched pre-existing plist tripped the guard (real fleet agents would red every run)"
fi

# RED CONTROL: a NEW com.kosmos.agent.* plist created after the snapshot must fire.
printf 'leaked\n' > "$D/com.kosmos.agent.codexphantom.plist"
if launchagent_leak_check "$D" "$BEFORE" 2>/dev/null; then
  fail "the guard did NOT fire on a newly-created com.kosmos.agent.* plist (it cannot catch the #3011 leak)"
else
  pass "red control: the guard fires on a newly-created com.kosmos.agent.* plist"
fi
# ...and names the leaked plist on stderr.
if launchagent_leak_check "$D" "$BEFORE" 2>&1 1>/dev/null | grep -q 'com.kosmos.agent.codexphantom.plist'; then
  pass "the guard names the leaked plist on stderr"
else
  fail "the guard fired but did not name the leaked plist (an operator cannot find what to move)"
fi

# MODIFY CONTROL: an EXISTING plist whose mtime changes during the run must fire too
# (a re-install rewrites the same name). Re-snapshot the current state as the baseline,
# then bump the pre-existing file's mtime.
rm -f "$D/com.kosmos.agent.codexphantom.plist"
launchagent_snapshot "$D" > "$BEFORE"
touch -t 203701010000 "$D/com.kosmos.agent.realfleet.plist"
if launchagent_leak_check "$D" "$BEFORE" 2>/dev/null; then
  fail "the guard did NOT fire on a MODIFIED com.kosmos.agent.* plist (a re-install of the same name would slip through)"
else
  pass "modify control: the guard fires when an existing com.kosmos.agent.* plist is modified during the run"
fi

# SCOPE CONTROL: a NON-matching file created during the run must NOT fire -- the guard
# is scoped to com.kosmos.agent.*, not any file that appears in LaunchAgents.
launchagent_snapshot "$D" > "$BEFORE"
printf 'unrelated\n' > "$D/com.apple.something.plist"
printf 'unrelated\n' > "$D/com.kosmos.board.plist"
if launchagent_leak_check "$D" "$BEFORE" 2>/dev/null; then
  pass "scope control: a non-com.kosmos.agent.* file created during the run does NOT trip the guard"
else
  fail "false positive: an unrelated file (com.apple.* / com.kosmos.board) tripped the agent-leak guard"
fi

# #4392: a post-promote live check's agent (the reserved zz-livecheck- prefix) created during the run is NOT a
# leak; a zz-test-* agent, the prefix those checks used to use, still is (the skip is exactly the reserved prefix).
launchagent_snapshot "$D" > "$BEFORE"
printf 'live check\n' > "$D/com.kosmos.agent.zz-livecheck-4039-grok-1302.plist"
if launchagent_leak_check "$D" "$BEFORE" 2>/dev/null; then
  pass "#4392: a zz-livecheck- agent made during the run (a live check on the real board) does NOT trip the guard"
else
  fail "#4392: a live check's zz-livecheck- agent tripped the guard, so every concurrent suite reds on it"
fi
launchagent_snapshot "$D" > "$BEFORE"
printf 'leaked\n' > "$D/com.kosmos.agent.zz-test-4039-grok-1302.plist"
printf 'leaked\n' > "$D/com.kosmos.agent.zz-livecheckX.plist"
out="$(launchagent_leak_check "$D" "$BEFORE" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'zz-test-4039' && printf '%s' "$out" | grep -q 'zz-livecheckX'; then
  pass "#4392 control: a zz-test-* agent and a near-miss name (zz-livecheckX) still trip the guard"
else
  fail "#4392: the skip is wider than the reserved prefix (rc=$rc, out=[$out])"
fi
# #4392: no TEST may use the reserved prefix, or a real test leak under it would go unseen. Every tracked file is
# searched except the two that define and pin the skip.
# It catches LITERAL use only: a name built at runtime ('zz-live' + 'check') evades it. That is accepted because the
# count guards against accidental reuse, and #3605 (launch-guard.js) already refuses any test's write to the real
# LaunchAgents under node --test, whatever the name.
# git grep: 0 = found, 1 = found nothing, anything else = it could not search (which must not read as clean).
REPO_ROOT="$(cd -- "$HERE/.." && pwd -P)"
ctl="$(git -C "$REPO_ROOT" grep -l 'launchagent_snapshot' -- 'tools/run-tests.sh' 2>/dev/null)"; ctl_rc=$?
if [ "$ctl_rc" -eq 0 ] && [ -n "$ctl" ]; then
  pass "#4392 control: the search finds a string that is there (run-tests.sh calls launchagent_snapshot)"
else
  fail "#4392 control: the search could not find a string that is there (rc=$ctl_rc), so its zero below would mean nothing"
fi
used="$(git -C "$REPO_ROOT" grep -l 'zz-livecheck' -- . ':!tools/lib/launchagent-leak-guard.sh' ':!tools/test-launchagent-leak-guard-3011.sh' ':!.claude/plans/' 2>/dev/null)"; used_rc=$?
if [ "$used_rc" -gt 1 ]; then
  fail "#4392: the reserved-prefix search could not run (git grep exit $used_rc)"
elif [ -z "$used" ]; then
  pass "#4392: no tracked file other than the guard and this test uses the reserved zz-livecheck- prefix"
else
  fail "#4392: the reserved live-check prefix appears in $used (a test must never name an agent with it)"
fi

# #5092: the machine's LIVE Kosmos rewriting one of its OWN agents' plists during the run is not a leak, but only
# for a plist that already existed (MODIFIED) and whose WorkingDirectory is <live_root>/<name>. Every other shape
# still fires. LIVE is a temp stand-in for the live workers root, passed as the 4th argument.
LIVE="$D/live-workers"
NOTES="$(mktemp "${TMPDIR:-/tmp}/la-guard-notes.XXXXXXXXXX")"
plist_wd() { printf '  <key>Label</key><string>com.kosmos.agent.%s</string>\n  <key>WorkingDirectory</key><string>%s</string>\n' "$2" "$3" > "$1"; }
rm -f "$D"/com.kosmos.agent.*.plist
plist_wd "$D/com.kosmos.agent.liukang.plist" liukang "$LIVE/liukang"
launchagent_snapshot "$D" > "$BEFORE"
touch -t 203701010000 "$D/com.kosmos.agent.liukang.plist"
: > "$NOTES"
if launchagent_leak_check "$D" "$BEFORE" "$NOTES" "$LIVE" 2>/dev/null; then
  pass "#5092: a pre-existing live-install plist (WorkingDirectory <live>/liukang) rewritten during the run does NOT trip the guard"
else
  fail "#5092: the live install restarting its own agent still reds the suite"
fi
grep -qxF "$D/com.kosmos.agent.liukang.plist" "$NOTES" \
  && pass "#5092: the skipped plist is written to the notes file, so the runner says so" \
  || fail "#5092: the skip was silent (notes: [$(cat "$NOTES")])"
# CONTROL (Splinter's): a NEW plist pointing at the live workers root is the leak shape and still fires.
launchagent_snapshot "$D" > "$BEFORE"
plist_wd "$D/com.kosmos.agent.newcomer.plist" newcomer "$LIVE/newcomer"
out="$(launchagent_leak_check "$D" "$BEFORE" "$NOTES" "$LIVE" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'com.kosmos.agent.newcomer.plist'; then
  pass "#5092 control: a NEW plist pointing at the live workers root still trips the guard"
else
  fail "#5092: a new plist under the live root was skipped (rc=$rc, out=[$out])"
fi
rm -f "$D/com.kosmos.agent.newcomer.plist"
# CONTROLS: modified plists whose WorkingDirectory is NOT exactly <live_root>/<name> still fire.
for shape in "sandbox:/tmp/kosmos-test-AbC/workers/x" "nested:$LIVE/x/deeper" "root:$LIVE" "lookalike:${LIVE}-evil/x" "dotdot:$LIVE/.." "trailingslash:$LIVE/x/"; do
  nm="${shape%%:*}"; wd="${shape#*:}"
  plist_wd "$D/com.kosmos.agent.m-$nm.plist" "m-$nm" "$wd"
  launchagent_snapshot "$D" > "$BEFORE"
  touch -t 203801010000 "$D/com.kosmos.agent.m-$nm.plist"
  out="$(launchagent_leak_check "$D" "$BEFORE" "$NOTES" "$LIVE" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "com.kosmos.agent.m-$nm.plist"; then
    pass "#5092 control: a MODIFIED plist with WorkingDirectory '$nm' ($wd) still trips the guard"
  else
    fail "#5092: a modified plist with WorkingDirectory '$nm' was skipped (rc=$rc, out=[$out])"
  fi
  rm -f "$D/com.kosmos.agent.m-$nm.plist"
done
# The default live root is $HOME/work/workers (store.workersRootFor's default) when no 4th argument is given.
HOME_SAVED="$HOME"; HOME="$D/fakehome"
plist_wd "$D/com.kosmos.agent.homeagent.plist" homeagent "$D/fakehome/work/workers/homeagent"
launchagent_snapshot "$D" > "$BEFORE"
touch -t 203901010000 "$D/com.kosmos.agent.homeagent.plist"
if launchagent_leak_check "$D" "$BEFORE" "" 2>/dev/null; then
  pass "#5092: with no live root given, \$HOME/work/workers is the live root"
else
  fail "#5092: the default live root is not \$HOME/work/workers"
fi
HOME="$HOME_SAVED"
# A live root containing "&" is written XML-escaped in the plist ("&amp;"); the raw root does not match it, so the
# guard reds (a false red, the safe direction). Pinned so a later "loosening" of the match is a decision.
plist_wd "$D/com.kosmos.agent.ampagent.plist" ampagent "$D/live&amp;root/ampagent"
launchagent_snapshot "$D" > "$BEFORE"
touch -t 204101010000 "$D/com.kosmos.agent.ampagent.plist"
if launchagent_leak_check "$D" "$BEFORE" "" "$D/live&root" 2>/dev/null; then
  fail "#5092: an XML-escaped root (&amp;) matched the raw root, so the match is looser than pinned"
else
  pass "#5092: an XML-escaped root does not match the raw one (reds, the safe direction)"
fi
rm -f "$D/com.kosmos.agent.ampagent.plist"
# A live root of "/" turns the skip off (run-tests.sh passes it when it has no notes file, so no skip is silent).
plist_wd "$D/com.kosmos.agent.offagent.plist" offagent "$LIVE/offagent"
launchagent_snapshot "$D" > "$BEFORE"
touch -t 204001010000 "$D/com.kosmos.agent.offagent.plist"
if launchagent_leak_check "$D" "$BEFORE" "" "/" 2>/dev/null; then
  fail "#5092: a live root of / still skipped (a skip with no notes file would be silent)"
else
  pass "#5092: a live root of / turns the skip off"
fi
rm -f "$D/com.kosmos.agent.offagent.plist"
rm -f "$D/com.kosmos.agent.homeagent.plist" "$D/com.kosmos.agent.liukang.plist" "$NOTES"
printf '%s\n' "$RT_CODE" | grep -qE 'launchagent_leak_check[^)]*_la_live_notes' \
  && pass "#5092: run-tests.sh passes a notes file to the leak check" \
  || fail "#5092: run-tests.sh does not pass the notes file, so a live skip would be silent"

# FAIL-SOFT: an empty/absent dir or missing baseline returns clean rather than reddening
# the suite on its own bookkeeping. Both arms of the guard clause are exercised.
if launchagent_leak_check "$D/does-not-exist" "$BEFORE" 2>/dev/null; then
  pass "fail-soft: a non-existent dir is treated as clean"
else
  fail "the guard reddened on a non-existent dir (should fail-soft clean)"
fi
# Missing baseline file: the `[ -f "$before" ]` half of the short-circuit.
if launchagent_leak_check "$D" "$D/no-such-before-snapshot" 2>/dev/null; then
  pass "fail-soft: a missing baseline snapshot file is treated as clean"
else
  fail "the guard reddened on a missing baseline file (should fail-soft clean)"
fi

# #3605 ORIGIN: the report names the sandbox each leaked plist points into, read from
# the plist's WorkingDirectory, in the one-line form create.js's plistFor writes it.
cat > "$D/com.kosmos.agent.origintest.plist" <<'PLIST'
  <key>Label</key><string>com.kosmos.agent.origintest</string>
  <key>WorkingDirectory</key><string>/tmp/kosmos-codex-observed-2413-AbC123/workers/origintest</string>
  <key>StandardOutPath</key><string>/tmp/other/start.log</string>
PLIST
got="$(launchagent_leak_origin "$D/com.kosmos.agent.origintest.plist")"
if [ "$got" = "/tmp/kosmos-codex-observed-2413-AbC123/workers/origintest" ]; then
  pass "origin: the leaked plist's sandbox is read from its WorkingDirectory"
else
  fail "origin: expected the WorkingDirectory sandbox, got [$got]"
fi
# Fail-soft: an unreadable path or a plist with no WorkingDirectory prints nothing.
got="$(launchagent_leak_origin "$D/no-such.plist")"
[ -z "$got" ] && pass "origin fail-soft: a missing plist prints nothing" || fail "origin printed [$got] for a missing plist"
printf '<key>Label</key><string>x</string>\n' > "$D/com.kosmos.agent.nowd.plist"
got="$(launchagent_leak_origin "$D/com.kosmos.agent.nowd.plist")"
[ -z "$got" ] && pass "origin fail-soft: a plist with no WorkingDirectory prints nothing" || fail "origin printed [$got] with no WorkingDirectory"

[ "$fails" -eq 0 ] && echo "test-launchagent-leak-guard-3011: all PASS" || echo "test-launchagent-leak-guard-3011: FAILURES above"
exit "$fails"
