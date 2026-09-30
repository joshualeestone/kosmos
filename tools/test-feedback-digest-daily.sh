#!/usr/bin/env bash
# Functional test for tools/feedback-digest-daily.sh (kosmos#4415 slice 2): the daily #admin post of new reports.
# Runs the real script against the repo's engine with its three seams stubbed (reports folder, card list, post),
# so no network, no store token and no bot token are touched. Every arm that decides whether #admin hears
# anything is driven: nothing new, new and posted, a failed post, a dry run, and the "since" watermark.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SELF_DIR/.." && pwd)"
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then echo "SKIP: no node on PATH"; exit 0; fi
command -v jq >/dev/null 2>&1 || { echo "SKIP: no jq on PATH"; exit 0; }

fail() { echo "FAIL: $1"; exit 1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/reports" "$T/state"
export KOSMOS_ENGINE="$REPO/engine" KOSMOS_NODE="$NODE_BIN" FEEDBACK_DIGEST_STATE="$T/state"
export FEEDBACK_DIGEST_PULL_DIR="$T/reports" FEEDBACK_DIGEST_ADMIN_URL="https://example.test/admin"
printf '#1 An unrelated open card\n' > "$T/cards.txt"
printf '#!/bin/bash\ncat "%s/cards.txt"\n' "$T" > "$T/cards.sh"; chmod +x "$T/cards.sh"
export FEEDBACK_DIGEST_CARDS_CMD="$T/cards.sh"
# The post stub records what it was handed and answers with the code in $T/code.
# It also notes when it was called and, when asked ($T/arrive exists), writes a report that ARRIVES during the post.
cat > "$T/post.sh" <<EOF
#!/bin/bash
cp "\$1" "$T/posted.json"; date +%s > "$T/post-at"
[ -f "$T/steal" ] && { cat "$T/steal" > "$T/state/lock/pid"; rm -f "$T/steal"; }   # another run takes the lock mid-post
if [ -f "$T/arrive" ]; then
  at=\$(date +%s); printf -- '---\\ndate: x\\ninstall: x\\ngenerated_at: %s\\n---\\n- %s\\n' "\$(date -u -r "\$at" '+%Y-%m-%dT%H:%M:%SZ')" 'The settings page freezes and is broken when a provider is added.' > "$T/reports/2026-09-29-during.md"
  rm -f "$T/arrive"
fi
cat "$T/code"
EOF
chmod +x "$T/post.sh"
export FEEDBACK_DIGEST_POST_CMD="$T/post.sh"
run() { bash "$REPO/tools/feedback-digest-daily.sh"; }

now=$(date +%s)
iso() { date -u -r "$1" '+%Y-%m-%dT%H:%M:%SZ'; }   # BSD date (macOS, where the suite runs)
report() {   # <file> <epoch> <line>
  printf -- '---\ndate: %s\ninstall: x\ngenerated_at: %s\n---\n- %s\n' "${1:0:10}" "$(iso "$2")" "$3" > "$T/reports/$1"
}

# 1. Nothing new: an OLD report only (before the watermark). Nothing is posted and the watermark does not move.
report 2026-09-01-old.md $((now - 5 * 86400)) 'The export button label overlaps the icon and is broken.'
echo "$((now - 3600))" > "$T/state/last-posted"
echo 200 > "$T/code"
out="$(run)" || fail "nothing-new run exited non-zero: $out"
printf '%s' "$out" | grep -q 'nothing posted' || fail "nothing-new did not say so: $out"
[ ! -f "$T/posted.json" ] || fail "a post was made with nothing new"
[ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the watermark moved with nothing posted"

# 2. A new report: posted, with the counts, the candidate, the link, and no mentions; the watermark moves.
report 2026-09-28-new.md $((now - 60)) 'The room scroll jumps to the top and is broken every time a message arrives.'
out="$(run)" || fail "posting run exited non-zero: $out"
[ -f "$T/posted.json" ] || fail "nothing was posted for a new report"
content="$(jq -r .content "$T/posted.json")"
printf '%s' "$content" | grep -q '^Daily reports: 1 new since the last digest' || fail "wrong count line: $content"
printf '%s' "$content" | grep -q 'room scroll jumps' || fail "the new report's candidate is missing: $content"
printf '%s' "$content" | grep -q 'export button' && fail "an OLD report reached the post: $content"
printf '%s' "$content" | grep -q 'Where they live: https://example.test/admin (Reports)' || fail "no inbox link: $content"
# #4415 wording: the default text reports status and asks Josh for nothing (he read the old line as a task for him).
printf '%s' "$content" | grep -q '^Daily reports: 1 new since the last digest. Not yet triaged into cards.$' || fail "the default text does not say they are untriaged: $content"
for bad in 'mark them triaged' 'No card was opened' 'Read them all'; do
  printf '%s' "$content" | grep -qi "$bad" && fail "the default text still says '$bad': $content"
done
[ "$(jq -c '.allowed_mentions.parse' "$T/posted.json")" = '[]' ] || fail "the post can mention people"
w=$(cat "$T/state/last-posted"); [ "$w" -ge "$((now - 1))" ] || fail "the watermark did not move after a 200 ($w < $now)"
# Review 3: the watermark is the run's START, not the time of the post: a report arriving while the run pulls or posts
# must not be older than the next watermark, or it is skipped for good.
[ "$w" -le "$(cat "$T/post-at")" ] || fail "the watermark was written after the post ($w), so a report arriving mid-run is skipped"

# A report for the NEXT run: after the last watermark, before that run starts (a stamp after its start is deferred).
before_next() { sleep 2; echo $(( $(date +%s) - 1 )); }

# 2b. A report that arrives DURING a post is in exactly the next digest, and in no later one.
touch "$T/arrive"
report 2026-09-29-trigger.md "$(before_next)" 'The model menu is broken and shows the wrong provider every time.'
run >/dev/null || fail "the trigger run failed"
[ -f "$T/reports/2026-09-29-during.md" ] || fail "the test did not plant the mid-post report"
jq -r .content "$T/posted.json" | grep -q 'settings page freezes' && fail "a report that arrived during the post was in that same post"
sleep 2; run >/dev/null || fail "the run after a mid-post arrival failed"
jq -r .content "$T/posted.json" | grep -q 'settings page freezes' || fail "a report that arrived during the post was skipped for good"
rm -f "$T/posted.json"; sleep 2; out="$(run)" || fail "the third run failed"
[ -f "$T/posted.json" ] && jq -r .content "$T/posted.json" | grep -q 'settings page freezes' && fail "a mid-post report was posted twice"

# 2c. A watermark that cannot be written is a failure, not a silent success.
report 2026-09-29-ro.md "$(before_next)" 'The export dialog is broken and never closes.'
# The script chmods its own state folder, so a read-only folder would be undone; a DIRECTORY where the temp file must
# go makes the write fail in a way it cannot fix.
mkdir "$T/state/last-posted.tmp"; before_w=$(cat "$T/state/last-posted")
if run >/dev/null 2>&1; then rmdir "$T/state/last-posted.tmp"; fail "an unwritable watermark exited zero after posting"; fi
# Review 3 (warning): in message-file mode Echo's text DID reach #admin, so the exit is 5 ("do NOT run it again"), never
# 2 (a refusal, nothing posted) or 4 (run it again): either would send Echo to post it twice.
printf 'Echo result for the unwritable-watermark arm.\n' > "$T/echo-ro.txt"; rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_WATERMARK=$((now - 600)) FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo-ro.txt" run 2>&1)"; rc=$?
[ "$rc" = 5 ] || { rmdir "$T/state/last-posted.tmp"; fail "a message-file post with an unwritable watermark exited $rc, not 5: $out"; }
printf '%s' "$out" | grep -q 'POSTED, but the watermark was not recorded.*do NOT run it again' || { rmdir "$T/state/last-posted.tmp"; fail "exit 5 did not say not to run it again: $out"; }
[ -f "$T/posted.json" ] || { rmdir "$T/state/last-posted.tmp"; fail "the exit-5 arm did not post"; }
rmdir "$T/state/last-posted.tmp"
[ "$(cat "$T/state/last-posted")" = "$before_w" ] || fail "a failed watermark write still changed the watermark"

# 2d. A second run while one holds the lock does nothing.
mkdir "$T/state/lock" && echo $$ > "$T/state/lock/pid"; rm -f "$T/posted.json"
out="$(run)" || fail "a locked-out run exited non-zero"
printf '%s' "$out" | grep -q 'another run' || fail "a second run did not step aside: $out"
[ ! -f "$T/posted.json" ] || fail "two runs both posted"
# A dead holder: the next run takes over AND posts, then releases the lock.
echo 999999 > "$T/state/lock/pid"
report 2026-09-29-dead.md "$(before_next)" 'The dead-holder check report is broken on purpose.'
rm -f "$T/posted.json"
out="$(run 2>&1)" || fail "a run after a dead holder failed: $out"
printf '%s' "$out" | grep -q 'took over a stale lock' || fail "a dead holder's lock was not taken over: $out"
jq -r .content "$T/posted.json" 2>/dev/null | grep -q 'dead-holder check' || fail "the run that took over did not post"
[ ! -d "$T/state/lock" ] || fail "the lock was not released after the run"

# Review 4: a lock with NO pid yet is a run starting, not a dead one: step aside while it is fresh.
mkdir "$T/state/lock"; rm -f "$T/posted.json"
out="$(run)" || fail "a run beside a starting one exited non-zero"
printf '%s' "$out" | grep -q 'another run (starting)' || fail "a starting run's lock was treated as dead: $out"
[ -d "$T/state/lock" ] || fail "a starting run's lock was removed by another run"
# ...but an empty lock a minute old is stale, and so is a LIVE pid on a lock an hour old (a reused pid).
touch -t "$(date -v-2M '+%Y%m%d%H%M.%S')" "$T/state/lock"
run >/dev/null 2>&1; [ ! -d "$T/state/lock" ] || fail "an empty lock two minutes old was never taken over"
mkdir "$T/state/lock"; echo $$ > "$T/state/lock/pid"; touch -t "$(date -v-2H '+%Y%m%d%H%M.%S')" "$T/state/lock"
out="$(run 2>&1)"; printf '%s' "$out" | grep -q 'took over a stale lock' || fail "a live but reused pid held the lock for good: $out"

# Review 4: a run never removes a lock that is not its own, even one taken over from it while it was posting.
mkdir "$T/state/lock"; echo $$ > "$T/state/lock/pid"
run >/dev/null 2>&1
[ "$(cat "$T/state/lock/pid" 2>/dev/null)" = "$$" ] || fail "a stepping-aside run removed another run's lock"
rm -rf "$T/state/lock"
echo $$ > "$T/steal"
report 2026-09-29-steal.md "$(before_next)" 'The lock-steal check report is broken on purpose.'
run >/dev/null 2>&1
[ ! -f "$T/steal" ] || fail "the test did not take the lock mid-post"
[ "$(cat "$T/state/lock/pid" 2>/dev/null)" = "$$" ] || fail "a finishing run removed the lock another run had taken over"
rm -rf "$T/state/lock"

# Review 4: a watermark in the future is not trusted (every window would be empty for good).
echo "$(( $(date +%s) + 86400 ))" > "$T/state/last-posted"
report 2026-09-29-future.md "$(before_next)" 'The future-watermark check report is broken on purpose.'
rm -f "$T/posted.json"; out="$(run 2>&1)" || fail "a run with a future watermark failed: $out"
printf '%s' "$out" | grep -q 'in the future' || fail "a future watermark was trusted: $out"
jq -r .content "$T/posted.json" 2>/dev/null | grep -q 'future-watermark check' || fail "a future watermark hid a new report"

# Review 2 (warning 1): a stored watermark past 63 bits used to reach `[ -gt ]`, which errors and reads as false, so it
# was kept and every window was empty for good. It is refused by shape and treated as a first run.
# The older reports are cleared first: the digest lists five candidates at most, and the last day holds more than that.
rm -f "$T/reports/"*.md; echo 99999999999999999999 > "$T/state/last-posted"
report 2026-09-29-huge.md "$(before_next)" 'The huge-watermark check report is broken on purpose.'
rm -f "$T/posted.json"; out="$(run 2>&1)" || fail "a run with a 20-digit stored watermark failed: $out"
printf '%s' "$out" | grep -q 'is not epoch seconds' || fail "a 20-digit stored watermark was trusted: $out"
jq -r .content "$T/posted.json" 2>/dev/null | grep -q 'huge-watermark check' || fail "a 20-digit stored watermark hid a new report"

# 3. A failed post: exits non-zero and the watermark stays, so the next run retries the same reports.
echo "$((now - 3600))" > "$T/state/last-posted"; rm -f "$T/posted.json"
echo 500 > "$T/code"
if run >/dev/null 2>&1; then fail "a 500 from Discord exited zero"; fi
[ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the watermark moved on a failed post"

# 4. A dry run prints the post and posts nothing.
rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_DRY_RUN=1 run)" || fail "dry run exited non-zero"
printf '%s' "$out" | grep -q 'DRY RUN, would post' || fail "dry run did not say so: $out"
[ ! -f "$T/posted.json" ] || fail "a dry run posted"

# 5. A card list that cannot be read stops the run before anything is posted.
if FEEDBACK_DIGEST_CARDS_CMD="false" run >/dev/null 2>&1; then fail "an unreadable card list exited zero"; fi
[ ! -f "$T/posted.json" ] || fail "posted without the card list"

# 6. A card list as long as its limit is a ceiling, not a total: refused before anything is posted.
rm -f "$T/posted.json"; echo 200 > "$T/code"
printf '#!/bin/bash\nfor i in $(seq 1 2000); do echo "#$i card $i"; done\n' > "$T/cards2000.sh"; chmod +x "$T/cards2000.sh"
if FEEDBACK_DIGEST_CARDS_CMD="$T/cards2000.sh" run >/dev/null 2>&1; then fail "a card list at its limit was trusted"; fi
[ ! -f "$T/posted.json" ] || fail "posted with a truncated card list"

# 7. #4415 wording: Echo's own result, FEEDBACK_DIGEST_MESSAGE_FILE, is posted VERBATIM instead of the automatic text.
# The card list is made unreadable on purpose: with a message file the run must not need it (nor the pull).
unset FEEDBACK_DIGEST_DRY_RUN
# Echo's pull started ten minutes ago (warning 1: the watermark in this mode is that moment, not the run start).
export FEEDBACK_DIGEST_WATERMARK=$((now - 600))
echo "$((now - 3600))" > "$T/state/last-posted"; rm -f "$T/posted.json"; echo 200 > "$T/code"
printf 'Reports read: 3 from 2 installs.\nCards filed: 1\n- #9001 Room scroll jumps to the top.\nHeld back: 1, `a` *quoted* <@123> line.\n@everyone @here see above.\n\n' > "$T/echo.txt"
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" FEEDBACK_DIGEST_CARDS_CMD=false run 2>&1)" || fail "a message-file run failed: $out"
jq -j .content "$T/posted.json" > "$T/posted.txt" || fail "no post for a message file"
cmp -s "$T/posted.txt" "$T/echo.txt" || fail "the message file was not posted verbatim: $(cat "$T/posted.txt")"
[ "$(jq -c '.allowed_mentions.parse' "$T/posted.json")" = '[]' ] || fail "a message-file post can mention people"
grep -q '@everyone' "$T/posted.txt" || fail "the @everyone line was not posted verbatim"   # ...and cannot ping:
[ "$(jq -c '.allowed_mentions' "$T/posted.json")" = '{"parse":[]}' ] || fail "a message-file post with @everyone can ping"
# Review 3 (nit): one second before Echo's pull start, as the automatic path saves its start minus one.
w=$(cat "$T/state/last-posted"); [ "$w" = "$((FEEDBACK_DIGEST_WATERMARK - 1))" ] || fail "the watermark after a message-file 200 is $w, not Echo's pull start minus one $((FEEDBACK_DIGEST_WATERMARK - 1))"
# Review 3 (nit): message-file mode logs no "using the last day" line (it has no window), even over a bad stored value.
echo 99999999999999999999 > "$T/state/last-posted"; rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)" || fail "a message-file run over a bad stored watermark failed: $out"
printf '%s' "$out" | grep -q 'using the last day' && fail "a message-file run logged the automatic window's first-run line: $out"
# Review 2 (warning 2): a watermark OLDER than last-posted never moves it backwards (the next automatic digest would
# re-post reports already triaged).
echo "$((now - 60))" > "$T/state/last-posted"; rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)" || fail "a message-file run with an older watermark failed: $out"
[ -f "$T/posted.json" ] || fail "a message-file run with an older watermark did not post"
w=$(cat "$T/state/last-posted"); [ "$w" = "$((now - 60))" ] || fail "W2: a message-file 200 moved the watermark backwards, from $((now - 60)) to $w"
# ...and on a failed post the watermark stays. Review 2 (warning 3): a failed post exits 4 (run it again), not 2 (a
# refusal), and does not claim a next run that message-file mode does not have.
echo "$((now - 3600))" > "$T/state/last-posted"; echo 500 > "$T/code"
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)"; rc=$?
[ "$rc" = 4 ] || fail "W3: a 500 with a message file exited $rc, not 4: $out"
printf '%s' "$out" | grep -q 'the digest was NOT posted; run it again' || fail "W3: a failed message-file post did not say to run it again: $out"
printf '%s' "$out" | grep -q 'will try again next run' && fail "W3: a failed message-file post promised a next run: $out"
[ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the watermark moved on a failed message-file post"
# The same for no bot token (the real post path, stopped before any network by an empty token file).
: > "$T/empty.env"
out="$(env -u FEEDBACK_DIGEST_POST_CMD FEEDBACK_DIGEST_BOT_ENV="$T/empty.env" FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" bash "$REPO/tools/feedback-digest-daily.sh" 2>&1)"; rc=$?
[ "$rc" = 4 ] || fail "W3: a message-file run with no bot token exited $rc, not 4: $out"
printf '%s' "$out" | grep -q 'no bot token.*the digest was NOT posted; run it again' || fail "W3: no bot token was not reported as unposted: $out"
[ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the watermark moved with no bot token"
# The automatic path keeps exit 2 for a failed post.
out="$(env -u FEEDBACK_DIGEST_POST_CMD FEEDBACK_DIGEST_BOT_ENV="$T/empty.env" bash "$REPO/tools/feedback-digest-daily.sh" 2>&1)"; rc=$?
[ "$rc" = 2 ] || fail "the automatic path with no bot token exited $rc, not 2: $out"
echo 200 > "$T/code"

# Review 2 (nit): a node that cannot run is named as such, not as an unreadable message file.
rm -f "$T/posted.json"
out="$(KOSMOS_NODE="$T/no-such-node" FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)"; rc=$?
# Review 3: a broken environment in message-file mode is exit 4 (run it again), not 2 (fix a file that is fine).
[ "$rc" = 4 ] || fail "a missing node in message-file mode exited $rc, not 4: $out"
printf '%s' "$out" | grep -q 'node runtime .* is missing or not executable' || fail "a missing node was not named: $out"
printf '%s' "$out" | grep -q 'could not read the message file' && fail "a missing node blamed the message file: $out"
[ ! -f "$T/posted.json" ] || fail "a run with a missing node posted"
out="$(KOSMOS_NODE="$T/no-such-node" run 2>&1)"; rc=$?
[ "$rc" = 2 ] || fail "a missing node on the automatic path exited $rc, not 2: $out"

# 8. The variable set with no usable file REFUSES: non-zero, a clear line, nothing posted, the watermark still.
: > "$T/empty.txt"; printf ' \n\t\n' > "$T/blank.txt"
for f in "$T/empty.txt" "$T/blank.txt" "$T/no-such-file.txt" ""; do
  rm -f "$T/posted.json"
  if out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$f" run 2>&1)"; then fail "a message file '$f' that cannot be posted exited zero: $out"; fi
  printf '%s' "$out" | grep -q 'REFUSED: FEEDBACK_DIGEST_MESSAGE_FILE is set' || fail "no clear refusal for '$f': $out"
  [ ! -f "$T/posted.json" ] || fail "a message file '$f' that cannot be posted fell back to a post"
  [ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the watermark moved on a refused run ('$f')"
done

# 8b. The watermark: required in message-file mode, a number, not in the future.
# Review 2 (warning 1): 20 digits (past 63 bits, where `[ -gt ]` errors and read as false), 0, and a leading zero.
for wm in UNSET "" "yesterday" "12x" "$(( $(date +%s) + 86400 ))" 99999999999999999999 0 0123456789; do
  rm -f "$T/posted.json"
  if [ "$wm" = UNSET ]; then out="$(env -u FEEDBACK_DIGEST_WATERMARK FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" bash "$REPO/tools/feedback-digest-daily.sh" 2>&1)"; rc=$?
  else out="$(FEEDBACK_DIGEST_WATERMARK="$wm" FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)"; rc=$?; fi
  [ "$rc" = 2 ] || fail "W1: a message file with watermark '$wm' exited $rc, not 2: $out"
  printf '%s' "$out" | grep -q 'REFUSED: .*FEEDBACK_DIGEST_WATERMARK' || fail "no clear refusal for watermark '$wm': $out"
  [ ! -f "$T/posted.json" ] || fail "a message file with watermark '$wm' posted"
  [ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the watermark moved on a refused run (watermark '$wm')"
done

# 8c. Warning 1: a report that arrived AFTER Echo's pull started but before this run is in the NEXT automatic window.
rm -f "$T/reports/"*.md 2>/dev/null; rm -f "$T/posted.json"
report 2026-09-30-mid-triage.md $((now - 300)) 'The provider sheet is broken and loses the key while Echo was triaging.'
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)" || fail "the message-file run before the window check failed: $out"
rm -f "$T/posted.json"; out="$(run 2>&1)" || fail "the automatic run after Echo's post failed: $out"
jq -r .content "$T/posted.json" 2>/dev/null | grep -q 'loses the key while Echo' || fail "a report that arrived while Echo triaged was skipped for good: $out"
# Review 3 (nit): FEEDBACK_DIGEST_WATERMARK is still exported here, with no message file: said, not silently dropped.
printf '%s' "$out" | grep -q 'a watermark was given but no message file; posting the automatic text' || fail "a watermark with no message file was dropped silently: $out"

# 8d. Warning 2: a held lock in message-file mode is a failure (Echo's text is NOT posted), never a quiet exit 0.
echo "$((now - 3600))" > "$T/state/last-posted"; mkdir "$T/state/lock" && echo $$ > "$T/state/lock/pid"; rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run 2>&1)"; rc=$?
[ "$rc" = 3 ] || fail "a message-file run beside a held lock exited $rc, not 3: $out"
printf '%s' "$out" | grep -q 'the digest was NOT posted' || fail "a locked-out message-file run did not say it was not posted: $out"
[ ! -f "$T/posted.json" ] || fail "a locked-out message-file run posted"
out="$(run 2>&1)"; rc=$?; [ "$rc" = 0 ] || fail "the automatic path beside a held lock changed its exit ($rc): $out"
[ ! -f "$T/posted.json" ] || fail "the automatic path beside a held lock posted"
[ "$(cat "$T/state/last-posted")" = "$((now - 3600))" ] || fail "the automatic path beside a held lock moved the watermark"
rm -rf "$T/state/lock"

# 9. A message longer than one Discord message is cut at a line break, and says so.
: > "$T/long.txt"; for i in $(seq 1 120); do printf 'Line %03d: a card that was filed today, one line each. \360\237\220\233\n' "$i" >> "$T/long.txt"; done
rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_MESSAGE_FILE="$T/long.txt" run 2>&1)" || fail "a long message file failed: $out"
printf '%s' "$out" | grep -q 'longer than one Discord message' || fail "a cut was not logged: $out"
c="$(jq -j .content "$T/posted.json")"
n=$(printf '%s' "$c" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.length))')
[ "$n" -le 2000 ] || fail "the cut message is $n characters, over Discord's 2000"
[ "$n" -ge 1800 ] || fail "the cut threw away far more than it needed ($n characters)"
printf '%s' "$c" | tail -1 | grep -qx '\[cut here to fit one Discord message\]' || fail "the cut does not say so: $(printf '%s' "$c" | tail -2)"
printf '%s\n' "$c" | sed '$d' | while IFS= read -r l; do grep -qxF "$l" "$T/long.txt" || { echo "PARTIAL: $l"; }; done | grep -q PARTIAL && fail "the cut split a line"

# 10. A dry run with a message file prints it and posts nothing.
rm -f "$T/posted.json"
out="$(FEEDBACK_DIGEST_DRY_RUN=1 FEEDBACK_DIGEST_MESSAGE_FILE="$T/echo.txt" run)" || fail "a message-file dry run failed"
printf '%s' "$out" | grep -q '#9001 Room scroll jumps' || fail "the dry run did not print the message file: $out"
[ ! -f "$T/posted.json" ] || fail "a message-file dry run posted"

echo "PASS: feedback-digest-daily (message file verbatim with @everyone unpinged, refusals, watermark required and used, lock refusal, watermark never backwards, failed post exits 4, missing node named and exits 4, posted-but-unrecorded exits 5, watermark is pull start minus one, stray watermark said, 20-digit/zero/leading-zero watermark refused, cut at a line break, message-file dry run, nothing new, posted, mid-post arrival once, unwritable watermark, lock races, future watermark, failed post, dry run, no cards, card list at its limit)"
