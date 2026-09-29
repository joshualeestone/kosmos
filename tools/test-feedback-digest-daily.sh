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
cat > "$T/post.sh" <<EOF
#!/bin/bash
cp "\$1" "$T/posted.json"; cat "$T/code"
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
w=$(cat "$T/state/last-posted"); [ "$w" -ge "$now" ] || fail "the watermark did not move after a 200 ($w < $now)"

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

echo "PASS: feedback-digest-daily (nothing new, posted, failed post, dry run, no cards, card list at its limit)"
