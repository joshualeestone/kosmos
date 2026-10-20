#!/bin/bash
# kosmos#6756: a cut and a queued heavy turn wait for a relay pre-push build (its kernel lock on
# ~/.cache/prepush/machine.lock), bounded and said, and a lock nobody holds any more blocks nothing.
# The lock arms use a real /usr/bin/lockf on a temporary file and are skipped (said, not passed) where it does not exist.
# Every stand-in holder is long and is let go by this test at a known point, so no arm races a timer against a loaded box.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$HERE/lib/cut-guard.sh"
unset $KOSMOS_WAIT_CONTROL_VARS KOSMOS_CUT_LOCKF_BIN KOSMOS_PREPUSH_RECHECK_S KOSMOS_CUT_IGNORE_PREPUSH KOSMOS_CUT_PREPUSH_WAIT_S
unset KOSMOS_MACHINE_CLAIM_COOKIE KOSMOS_MACHINE_CLAIM_MINUTES KOSMOS_CLAIM_LABEL KOSMOS_CLAIM_KEEP_LABEL
T="$(mktemp -d "${TMPDIR:-/tmp}/test-prepush-wait-6756.XXXXXXXXXX")"
HOLDERS=""
# Stops only this test's own holders, by the pids it started (and each one's children).
cleanup() { local h c; for h in $HOLDERS; do for c in $(pgrep -P "$h" 2>/dev/null); do kill "$c" 2>/dev/null; done; kill "$h" 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT
export KOSMOS_RUN_MARKER_DIR="$T/markers"; mkdir -p "$KOSMOS_RUN_MARKER_DIR"
export KOSMOS_PREPUSH_MACHINE_LOCK="$T/prepush/machine.lock"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
rel="$REPO/tools/release.sh"
qhs="$REPO/tools/queued-heavy.sh"

# 9. Wiring, read from the scripts (they claim the real machine, so they are not run whole here). Text only, so these
# run on any machine, before the lock arms that need a Mac.
lc="$(grep -n '^kosmos_claim_machine ' "$rel" | head -1 | cut -d: -f1)"
lw="$(grep -n 'kosmos_wait_until_clear "this cut" _rel_prepush || exit 1' "$rel" | head -1 | cut -d: -f1)"
[ -n "$lc" ] && [ -n "$lw" ] && [ "$lc" -lt "$lw" ] && pass "9 release.sh waits AFTER it claims the machine (so the build starts no further step)" || fail "9 release.sh: claim line ${lc:-none}, wait line ${lw:-none}"
grep -q 'KOSMOS_WAIT_MAX_S="${KOSMOS_CUT_PREPUSH_WAIT_S:-6000}" kosmos_wait_until_clear "this cut" _rel_prepush || exit 1' "$rel" \
  && pass "9 release.sh's wait is bounded (100 minutes by default) and stops the cut when it gives up" || fail "9 release.sh's wait is not the bounded prepush wait"
grep -q 'if \[ "${KOSMOS_CUT_IGNORE_PREPUSH:-0}" != 1 \] && command -v kosmos_refuse_if_prepush_build_live' "$rel" \
  && pass "9 release.sh skips the wait only for KOSMOS_CUT_IGNORE_PREPUSH=1" || fail "9 release.sh's override guard is not the one its refusal names"
# The two functions, as the scripts define them, run below against this test's own marker dir and lock.
RELFN="$(awk '/^  _rel_prepush\(\) \{/{f=1} f{print} f&&/^  \}$/{exit}' "$rel")"
QHFN="$(awk '/^_qh_clear\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$qhs")"
[ -n "$RELFN" ] && pass "9 release.sh defines _rel_prepush" || fail "9 release.sh has no _rel_prepush to run"
[ -n "$QHFN" ] && pass "9 queued-heavy.sh defines _qh_clear" || fail "9 queued-heavy.sh has no _qh_clear to run"
eval "$RELFN"; eval "$QHFN"
# The other checks _qh_clear makes read the real box (its suites, harnesses, claim); this file tests only its new
# check, so they answer go here.
kosmos_refuse_if_machine_claimed() { return 0; }; kosmos_refuse_if_light_side_live() { return 0; }
kosmos_refuse_if_suite_live() { return 0; }; kosmos_refuse_if_harness_live() { return 0; }

LOCKF=/usr/bin/lockf
if [ ! -x "$LOCKF" ]; then
  [ "$fails" = 0 ] || { echo "test-prepush-wait-6756: $fails FAILED"; exit 1; }
  echo "SKIP  test-prepush-wait-6756: no $LOCKF on this machine (not a Mac), the lock arms were not run (the wiring arms above were)"; exit 0
fi
# hold: a stand-in for one build step, holding the lock with lockf until this test lets it go.
# Waits until the lock reads held, or fails by name, so no arm runs against a holder that has not taken it yet.
hold() {
  mkdir -p "$(dirname "$KOSMOS_PREPUSH_MACHINE_LOCK")"; : >> "$KOSMOS_PREPUSH_MACHINE_LOCK"
  "$LOCKF" -k -s -t 5 "$KOSMOS_PREPUSH_MACHINE_LOCK" sleep 600 & H=$!; HOLDERS="$HOLDERS $H"
  local j rc; for j in $(seq 1 100); do rc=0; "$LOCKF" -k -s -t 0 "$KOSMOS_PREPUSH_MACHINE_LOCK" true 2>/dev/null || rc=$?; [ "$rc" = 75 ] && return 0; sleep 0.1; done
  fail "FIXTURE: the stand-in holder $H never took the lock, so the arms after it cannot be trusted"; return 1
}
# finish: the step ends normally (its command exits, lockf exits after it). kill_holder: the build is killed outright.
finish() { local c; for c in $(pgrep -P "$H" 2>/dev/null); do kill "$c" 2>/dev/null; done; wait "$H" 2>/dev/null; }
kill_holder() { local c; for c in $(pgrep -P "$H" 2>/dev/null); do kill -KILL "$c" 2>/dev/null; done; kill -KILL "$H" 2>/dev/null; wait "$H" 2>/dev/null; }

# 1. No file: not a build, and asking never creates it.
kosmos_prepush_build_live && fail "1 no lock file reads as a build" || pass "1 no lock file is not a build"
out="$(kosmos_refuse_if_prepush_build_live "this cut" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && pass "1 nothing refused, nothing said" || fail "1 refused with no lock file: rc=$rc $out"
[ ! -e "$KOSMOS_PREPUSH_MACHINE_LOCK" ] && pass "1 asking did not create the file" || fail "1 asking created $KOSMOS_PREPUSH_MACHINE_LOCK"

# 2. A build holds it: live, refused, holder named by pid and program only.
hold || exit 1
kosmos_prepush_build_live && pass "2 a held lock is a build" || fail "2 a held lock reads as no build"
out="$(kosmos_refuse_if_prepush_build_live "this cut" "KOSMOS_CUT_IGNORE_PREPUSH=1 cuts anyway" 2>&1)"; rc=$?
[ "$rc" = 1 ] && pass "2 refused while held" || fail "2 not refused while held: rc=$rc"
has "$out" "a relay pre-push build is running on this machine" && has "$out" "this cut would share the box" \
  && pass "2 the refusal says what and who waits" || fail "2 refusal wording: $out"
has "$out" "pid $H: lockf" && pass "2 it names the holder (lsof): pid $H, lockf" || fail "2 holder not named: $out"
has "$out" "sleep 600" && fail "2 the message prints the holder's command line (a command line does not belong in logs)" || pass "2 the message names the program, never its command line"
has "$out" "KOSMOS_CUT_IGNORE_PREPUSH=1 cuts anyway." && pass "2 it names the override" || fail "2 override not named: $out"
kill -0 "$H" 2>/dev/null && pass "2 asking did not disturb the holder" || fail "2 the holder died while being asked"

# 2b. The new checks in the scripts' own functions, against the held lock.
out="$(WHAT="a heavy run" KOSMOS_QUEUE_CLASS=heavy _qh_clear 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "a heavy run would share the box" && pass "2b queued-heavy: a heavy turn waits while a build holds the lock" || fail "2b queued-heavy heavy turn: rc=$rc $out"
out="$(WHAT="a light run" KOSMOS_QUEUE_CLASS=light _qh_clear 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "2b queued-heavy: a light turn is not held back" || fail "2b queued-heavy light turn refused: rc=$rc $out"
out="$(_rel_prepush 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "this cut would share the box" && has "$out" "KOSMOS_CUT_IGNORE_PREPUSH=1 cuts anyway" \
  && pass "2b release.sh's check refuses while held, naming its override" || fail "2b release.sh's check: rc=$rc $out"

# 2c. Each poll of the cut's wait renews a claim that is still the cut's (it lasts 30 minutes; the wait can last 100),
# and never one with another cookie.
cf="$(_kosmos_machine_claim_file)"
( KOSMOS_MACHINE_CLAIM_MINUTES=1 kosmos_claim_machine ) >/dev/null 2>&1   # a claim one minute from lapsing, the cut's
ck=""; exp1=0; read -r ck _ exp1 _ < "$cf" 2>/dev/null
[ -n "$ck" ] && [ "$exp1" -gt 0 ] && pass "2c CONTROL: the cut's claim is written" || fail "2c FIXTURE: no claim written, so the renewal arms prove nothing"
out="$(KOSMOS_MACHINE_CLAIM_COOKIE="$ck" _rel_prepush 2>&1)"
exp2=0; read -r _ _ exp2 _ < "$cf" 2>/dev/null
[ "$exp2" -ge $(( $(date +%s) + 25 * 60 )) ] && pass "2c a poll renews the cut's own claim to 30 minutes (it was a minute from lapsing)" || fail "2c not renewed: expiry $exp2, before $exp1"
printf 'someone-else %s %s otherhost queued run (not a cut): theirs\n' "$$" "$(( $(date +%s) + 120 ))" > "$cf"
before="$(cat "$cf")"
out="$(KOSMOS_MACHINE_CLAIM_COOKIE="$ck" _rel_prepush 2>&1)"
[ "$(cat "$cf")" = "$before" ] && pass "2c a claim with another cookie is left alone" || fail "2c another holder's claim was overwritten: $(cat "$cf")"
has "$out" "the machine claim is held by someone else now, so this cut is not renewing it" && pass "2c and the cut says it lost its claim" || fail "2c a cut that lost its claim says nothing: $out"
rm -f "$cf"

# 3. The holder is KILLED (a crashed build): the same file stays and blocks nothing.
kill_holder
[ -e "$KOSMOS_PREPUSH_MACHINE_LOCK" ] && pass "3 the file is left behind (-k)" || fail "3 FIXTURE: the file went with its holder, so this arm proves nothing"
kosmos_prepush_build_live && fail "3 a file whose holder was killed still reads as a build" || pass "3 a killed holder's file is not a build"
kosmos_refuse_if_prepush_build_live "this cut" 2>/dev/null && pass "3 nothing refused behind a dead holder" || fail "3 refused behind a dead holder"

# 4. The step FINISHES: the same.
hold || exit 1
kosmos_prepush_build_live && pass "4 CONTROL: held while it runs" || fail "4 CONTROL: not held while it runs"
finish
kosmos_prepush_build_live && fail "4 a finished step's file still reads as a build" || pass "4 a finished step's file is not a build"

# 5. A free lock: the probe holds it only for the instant `true` runs; another lockf -t 0 right after gets it.
"$LOCKF" -k -s -t 0 "$KOSMOS_PREPUSH_MACHINE_LOCK" true 2>/dev/null && pass "5 a free lock is free again after the probe" || fail "5 the probe left the lock held"

# 5b. A lock let go between the two looks (another probe's instant hold) is not a build.
hold || exit 1
rc=0; "$LOCKF" -k -s -t 0 "$KOSMOS_PREPUSH_MACHINE_LOCK" true 2>/dev/null || rc=$?
[ "$rc" = 75 ] && pass "5b CONTROL: the first look finds it held" || fail "5b CONTROL: not held at the first look (rc $rc), so this arm proves nothing"
( sleep 0.5; for c in $(pgrep -P "$H" 2>/dev/null); do kill "$c" 2>/dev/null; done ) & R=$!
KOSMOS_PREPUSH_RECHECK_S=3 kosmos_prepush_build_live && fail "5b a lock let go between the looks reads as a build" || pass "5b a lock let go between the looks is not a build"
wait "$R" 2>/dev/null; wait "$H" 2>/dev/null

# 6. No lockf (another OS, a broken path): not a build, even while held.
KOSMOS_CUT_LOCKF_BIN="$T/no-such-lockf" kosmos_prepush_build_live && fail "6 a missing lockf reads as a build" || pass "6 a missing lockf is not a build"
hold || exit 1
KOSMOS_CUT_LOCKF_BIN="$T/no-such-lockf" kosmos_prepush_build_live && fail "6 a missing lockf reads as a build while held" || pass "6 a missing lockf is not a build, even while held"

# 7. A cut WAITS for a step to end, then starts (the wait release.sh makes, through its own check).
( sleep 3; for c in $(pgrep -P "$H" 2>/dev/null); do kill "$c" 2>/dev/null; done ) & R=$!
start=$(date +%s)
out="$(KOSMOS_WAIT_EVERY_S=1 KOSMOS_WAIT_MAX_S=300 kosmos_wait_until_clear "this cut" _rel_prepush 2>&1)"; rc=$?
took=$(( $(date +%s) - start ))
[ "$rc" = 0 ] && pass "7 the cut starts once the step ends (rc 0)" || fail "7 the cut did not start after the step ended: rc=$rc $out"
[ "$took" -ge 2 ] && pass "7 it waited (${took}s), not started beside the step" || fail "7 it did not wait: ${took}s"
has "$out" "a relay pre-push build is running" && has "$out" "starts now" && pass "7 the wait says why and when it starts" || fail "7 wait wording: $out"
wait "$R" 2>/dev/null; wait "$H" 2>/dev/null
rm -f "$(_kosmos_machine_claim_file)"

# 8. The bound: a step that outlasts it makes the cut give up, said, never silently. On a test clock that moves 10 s a
# look, so the bound is reached on a known pass however loaded the box is.
hold || exit 1
printf '%s\n' "$(date +%s)" > "$T/clock"
printf '#!/bin/sh\nt=$(cat "%s"); t=$((t + 10)); echo "$t" > "%s"; echo "$t"\n' "$T/clock" "$T/clock" > "$T/clock.sh"; chmod +x "$T/clock.sh"
out="$(KOSMOS_WAIT_NOW="$T/clock.sh" KOSMOS_WAIT_SLEEP=true KOSMOS_WAIT_EVERY_S=10 KOSMOS_WAIT_MAX_S=35 kosmos_wait_until_clear "this cut" _rel_prepush 2>&1)"; rc=$?
[ "$rc" = 1 ] && pass "8 past the bound the cut refuses (rc 1)" || fail "8 past the bound: rc=$rc"
has "$out" "gave up after waiting" && has "$out" "a relay pre-push build is running" && pass "8 it says it gave up, and why" || fail "8 bound wording: $out"
finish

echo
[ "$fails" = 0 ] && { echo "test-prepush-wait-6756: all passed"; exit 0; }
echo "test-prepush-wait-6756: $fails FAILED"; exit 1
