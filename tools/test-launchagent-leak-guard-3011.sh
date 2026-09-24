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
