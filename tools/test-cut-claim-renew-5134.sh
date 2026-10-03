#!/bin/bash
# #5134: the cut's machine claim must outlive a step longer than the claim.
#
# WHY: release.sh renewed the claim only at step boundaries. Step 3+3b runs about 67 minutes and the claim lasts 30,
# so in the 0.7.20 cut (2026-10-03) the claim lapsed about 04:50, the next consult deleted it, and a queued suite
# started beside the cut. Each step now runs a background renewer. This test lifts the REAL step/record block from
# release.sh and drives it against the REAL tools/lib/cut-guard.sh in a sandboxed marker dir, with a 1-second renew
# interval so a "long step" takes seconds. Arm 1 is red without the renewer (measured: remove the
# `_cut_renew_start` call in step()).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

SRC="$HERE/release.sh"
blk="$(awk '/^_STEP="before step 1"$/{g=1} g{print} /^cut_record_done\(\)/{r=1} r&&/^}$/{exit}' "$SRC")"
for need in '_cut_renew_start() {' '_cut_renew_stop() {' 'step() {' 'cut_record_done() {'; do
  printf '%s\n' "$blk" | grep -qF "$need" || { echo "FAIL  the lifted block has no '$need'; this test would check nothing"; exit 1; }
done

T="$(mktemp -d "${TMPDIR:-/tmp}/cutrenew5134.XXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.claude/logs" "$T/markers"
CLAIM="$T/markers/machine-claim"
exp_of() { awk '{print $3}' "$CLAIM" 2>/dev/null; }

# One cut, as a child bash under release.sh's own shell options. $1 = what to do after the block is defined.
# It writes its pid to $T/cut.pid and the renewer's pid to $T/renewer.pid when asked.
cut_run() {
  HOME="$T/home" KOSMOS_RUN_MARKER_DIR="$T/markers" KOSMOS_CUT_RENEW_SECS="${RENEW_SECS:-1}" \
    KOSMOS_CUT_RENEW_MAX="${RENEW_MAX:-12}" bash -c "
    set -euo pipefail
    . '$REPO/tools/lib/cut-guard.sh'
    _CUT_DONE_WRITTEN=0
    V=9.9.9
    $blk
    echo \$\$ > '$T/cut.pid'
    kosmos_claim_machine >/dev/null 2>&1 || true
    $1
  " >/dev/null 2>&1
}

# Arm 1 (the defect) and arm 2: during ONE step that lasts longer than several renew intervals, the claim's expiry
# moves forward, and the renewal is still the cut's own (same cookie, same pid).
rm -f "$CLAIM"
cut_run '
  step "== 3+3b. long =="
  e0=$(awk "{print \$3}" "'"$CLAIM"'"); c0=$(awk "{print \$1}" "'"$CLAIM"'")
  sleep 3.5
  e1=$(awk "{print \$3}" "'"$CLAIM"'"); c1=$(awk "{print \$1}" "'"$CLAIM"'"); p1=$(awk "{print \$2}" "'"$CLAIM"'")
  echo "$e0 $e1 $c0 $c1 $p1 $$" > "'"$T"'/arm1"
  cut_record_done 0
  kosmos_release_machine
'
read -r e0 e1 c0 c1 p1 cutpid < "$T/arm1" 2>/dev/null || true
if [ -n "${e1:-}" ] && [ "${e1:-0}" -ge $(( ${e0:-0} + 2 )) ]; then pass "a claim is renewed DURING a long step (expiry $e0 -> $e1)"
else fail "the claim was not renewed during a long step (expiry ${e0:-none} -> ${e1:-none}): it would lapse mid-step"; fi
if [ -n "${c1:-}" ] && [ "$c0" = "$c1" ] && [ "$p1" = "$cutpid" ]; then pass "the renewal is the cut's own claim (same cookie, pid $p1)"
else fail "the renewal is not the cut's claim (cookie ${c0:-?} -> ${c1:-?}, pid ${p1:-?} vs cut ${cutpid:-?})"; fi

# Arm 3: the next step REPLACES the renewer (one at a time; the old one is gone).
rm -f "$CLAIM"
cut_run '
  step "== A =="
  a=$_CUT_RENEWER
  step "== B =="
  b=$_CUT_RENEWER
  kill -0 "$a" 2>/dev/null && olda=alive || olda=gone
  kill -0 "$b" 2>/dev/null && newb=alive || newb=gone
  echo "$a $b $olda $newb" > "'"$T"'/arm3"
  cut_record_done 0
  kosmos_release_machine
'
read -r ra rb olda newb < "$T/arm3" 2>/dev/null || true
if [ -n "${ra:-}" ] && [ "$ra" != "$rb" ] && [ "$olda" = gone ] && [ "$newb" = alive ]; then pass "each step replaces the renewer (old $ra gone, new $rb alive)"
else fail "renewers are not replaced per step (old ${ra:-?} ${olda:-?}, new ${rb:-?} ${newb:-?})"; fi

# Arm 4: at exit the renewer is stopped BEFORE the release, so nothing re-creates the claim afterwards.
rm -f "$CLAIM"
cut_run '
  step "== last =="
  sleep 1.5
  cut_record_done 0
  kosmos_release_machine
  echo "$_CUT_RENEWER" > "'"$T"'/arm4"
'
sleep 2.5
if [ ! -f "$CLAIM" ]; then pass "after the cut ends and releases, no renewal brings the claim back (2.5 s later)"
else fail "the claim came back after the release: $(cat "$CLAIM")"; fi
if [ -z "$(cat "$T/arm4" 2>/dev/null)" ]; then pass "cut_record_done clears the renewer"
else fail "cut_record_done left a renewer recorded: $(cat "$T/arm4")"; fi

# Arm 5: a hung step still frees the fleet: renewals stop after KOSMOS_CUT_RENEW_MAX in one step.
rm -f "$CLAIM"
RENEW_MAX=2 cut_run '
  step "== hung =="
  sleep 3.5
  e2=$(awk "{print \$3}" "'"$CLAIM"'")
  sleep 2
  e3=$(awk "{print \$3}" "'"$CLAIM"'")
  echo "$e2 $e3" > "'"$T"'/arm5"
  cut_record_done 0
  kosmos_release_machine
'
read -r e2 e3 < "$T/arm5" 2>/dev/null || true
if [ -n "${e3:-}" ] && [ "$e2" = "$e3" ]; then pass "renewals stop after KOSMOS_CUT_RENEW_MAX in one step (expiry held at $e3)"
else fail "renewals did not stop at the cap (expiry ${e2:-?} -> ${e3:-?}): a hung step would hold the box for ever"; fi

# Arm 6: the cut process dies without its traps (kill -9): the renewer sees it gone and stops renewing.
rm -f "$CLAIM"
( cut_run '
  step "== killed =="
  echo "$_CUT_RENEWER" > "'"$T"'/arm6r"
  sleep 30 & echo $! > "'"$T"'/arm6s"; wait
' ) 2>/dev/null &
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$T/arm6r" ] && break; sleep 0.3; done
kill -9 "$(cat "$T/cut.pid")" 2>/dev/null || true
sleep 1.5
e4=$(exp_of)
sleep 2.5
e5=$(exp_of)
r6="$(cat "$T/arm6r" 2>/dev/null)"
if [ -n "${e4:-}" ] && [ "$e4" = "$e5" ]; then pass "a killed cut's renewer stops renewing (expiry held at $e5)"
else fail "the renewer kept renewing after its cut was killed (expiry ${e4:-?} -> ${e5:-?})"; fi
if [ -n "$r6" ] && ! kill -0 "$r6" 2>/dev/null; then pass "and the renewer process is gone"
else fail "the renewer ${r6:-?} is still running after its cut was killed"; kill "$r6" 2>/dev/null || true; fi
kill "$(cat "$T/arm6s" 2>/dev/null)" 2>/dev/null || true   # the killed cut's own sleep, orphaned by the kill -9
wait 2>/dev/null || true

if [ "$fails" -eq 0 ]; then echo "test-cut-claim-renew-5134: all passed"; else echo "test-cut-claim-renew-5134: $fails failed"; fi
[ "$fails" -eq 0 ]
