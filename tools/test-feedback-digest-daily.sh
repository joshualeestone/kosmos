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
printf '%s' "$content" | grep -q 'https://example.test/admin (Reports). No card was opened.' || fail "no inbox link: $content"
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
rmdir "$T/state/last-posted.tmp"
[ "$(cat "$T/state/last-posted")" = "$before_w" ] || fail "a failed watermark write still changed the watermark"

# 2d. A second run while one holds the lock does nothing.
mkdir "$T/state/lock" && echo $$ > "$T/state/lock/pid"; rm -f "$T/posted.json"
out="$(run)" || fail "a locked-out run exited non-zero"
printf '%s' "$out" | grep -q 'another run' || fail "a second run did not step aside: $out"
[ ! -f "$T/posted.json" ] || fail "two runs both posted"
echo 999999 > "$T/state/lock/pid"   # a dead holder: the next run takes over
run >/dev/null 2>&1; [ ! -d "$T/state/lock" ] || fail "a lock left by a dead run was not taken over and released"

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

echo "PASS: feedback-digest-daily (nothing new, posted, mid-post arrival once, unwritable watermark, lock, failed post, dry run, no cards, card list at its limit)"
