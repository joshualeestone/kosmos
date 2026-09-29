#!/bin/bash
# feedback-digest-daily.sh -- kosmos#4415 slice 2: once a day, the new daily reports, triaged, posted to #admin.
#
#   bash tools/feedback-digest-daily.sh            (FEEDBACK_DIGEST_DRY_RUN=1 prints instead of posting)
#
# WHAT: pulls the reports from the private store (engine/feedbackpull.js; its token comes from the secrets map,
# target vercel-blob-feedback), keeps the ones that ARRIVED since the last successful post
# (feedback-triage.freshSince), and posts a SHORT summary to #admin with a link to /admin's Reports inbox
# (feedback-triage.adminSummary). It opens no card and changes no report (#2246: a person decides).
#
# WHY ONLY SINCE THE LAST POST: over all time the store held 39 reports and about 105 candidates (measured
# 2026-09-28); a digest of all of them every day would be the same wall each morning. A day's worth is a handful.
#
# 🛑 NOT INSTALLED AS A JOB UNTIL THE TRIAGE FIX IS RELEASED. The default ENGINE is the installed app's, and an
# engine without the #4415 negation fix posts about 158 "candidates" topped by "Nothing appears broken". Once a
# release carries it, a launchd job runs this daily.
#
# The bot token never reaches argv: curl reads the Authorization header from a mode-600 temp file (the #1655
# pattern). Any failure is logged and exits non-zero; nothing half-posts, and last-posted moves only on a 200.
#
# SEAMS (tools/test-feedback-digest-daily.sh drives every arm with no network and no token):
#   FEEDBACK_DIGEST_PULL_DIR  read reports from this folder instead of pulling from the store
#   FEEDBACK_DIGEST_CARDS_CMD prints the open card titles, one per line (default: gh issue list)
#   FEEDBACK_DIGEST_POST_CMD  called with <payload.json>; prints the HTTP status (default: curl to Discord)
set -u
ENGINE="${KOSMOS_ENGINE:-$HOME/.local/share/kosmos/app/engine}"
NODE="${KOSMOS_NODE:-$HOME/.local/share/kosmos/runtime/bin/node}"
STATE="${FEEDBACK_DIGEST_STATE:-$HOME/.cache/kosmos-feedback-digest}"
CHANNEL="${FEEDBACK_DIGEST_CHANNEL:-1480685699673100289}"   # #admin
BOT_ENV="${FEEDBACK_DIGEST_BOT_ENV:-$HOME/.claude/channels/discord/.env}"
ADMIN_URL="${FEEDBACK_DIGEST_ADMIN_URL:-https://installkosmos.com/admin}"
DRY="${FEEDBACK_DIGEST_DRY_RUN:-}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') feedback-digest: $*"; }
mkdir -p "$STATE" && chmod 700 "$STATE" || { log "FAILED: no state folder $STATE"; exit 2; }
WORK="$(mktemp -d)" || { log "FAILED: no temp folder"; exit 2; }
trap 'rm -rf "$WORK"' EXIT

# The watermark this run writes on success: its START, before the pull, so a report that arrives while the run is
# pulling and posting is not older than the next watermark and skipped for good.
RUN_START=$(date +%s)
since=0
[ -f "$STATE/last-posted" ] && read -r since < "$STATE/last-posted"
case "$since" in ''|*[!0-9]*) since=0 ;; esac
# First run: the last day only, not the whole history.
[ "$since" -eq 0 ] && since=$(( $(date +%s) - 86400 ))

if [ -n "${FEEDBACK_DIGEST_CARDS_CMD:-}" ]; then
  $FEEDBACK_DIGEST_CARDS_CMD > "$WORK/cards" || { log "FAILED: could not read the open cards"; exit 2; }
else
  gh issue list --repo joshualeestone/kosmos --state open --limit 2000 --json number,title \
    -q '.[]|"#\(.number) \(.title)"' > "$WORK/cards" 2>/dev/null || { log "FAILED: could not read the open cards"; exit 2; }
fi

# A list as long as gh's limit is a ceiling, not a total: cards past it would not match, and reports about them would
# be posted as new. Refuse rather than post a digest that under-matches. (Checked on either source of the list.)
[ "$(wc -l < "$WORK/cards" | tr -d ' ')" -ge 2000 ] && { log "FAILED: the open card list hit its 2000 limit; raise it"; exit 2; }

cat > "$WORK/digest.js" <<'JS'
const [engine, pullDir, dir, since, adminUrl, cardsFile, runStart] = process.argv.slice(2);
const fs = require('fs'), path = require('path');
(async () => {
  let from = pullDir;
  if (!from) {
    const r = await require(path.join(engine, 'feedbackpull')).pull(dir);
    if (!r || r.ok !== true) { console.error('pull failed: ' + (r && r.because)); process.exit(3); }
    from = dir;
  }
  const t = require(path.join(engine, 'feedback-triage'));
  const files = fs.readdirSync(from).filter((f) => f.endsWith('.md'))
    .map((name) => ({ name, body: fs.readFileSync(path.join(from, name), 'utf8') }));
  process.stdout.write(t.adminSummary(t.freshSince(files, since, runStart), fs.readFileSync(cardsFile, 'utf8'), adminUrl));
})().catch((e) => { console.error(String(e && e.message)); process.exit(3); });
JS
mkdir -p "$WORK/pulled"
summary="$("$NODE" "$WORK/digest.js" "$ENGINE" "${FEEDBACK_DIGEST_PULL_DIR:-}" "$WORK/pulled" "$since" "$ADMIN_URL" "$WORK/cards" "$RUN_START")" \
  || { log "FAILED: pull or triage (see above)"; exit 2; }

# date -r <epoch> is macOS (BSD) date; this job runs on the fleet's Macs.
if [ -z "$summary" ]; then log "no new reports since $(date -r "$since" '+%Y-%m-%d %H:%M'); nothing posted"; exit 0; fi
if [ -n "$DRY" ]; then log "DRY RUN, would post:"; printf '%s\n' "$summary"; exit 0; fi

printf '%s' "$summary" | jq -Rs '{content: ., allowed_mentions: {parse: []}}' > "$WORK/payload" \
  || { log "FAILED: could not build the message"; exit 2; }
if [ -n "${FEEDBACK_DIGEST_POST_CMD:-}" ]; then
  code=$($FEEDBACK_DIGEST_POST_CMD "$WORK/payload")
else
  # ⚠️ The bot token is read from the Discord plugin's own .env (the main bot's), not through secrets-map.sh: it is that
  # plugin's file and there is no mapped target for it. A second reader of it, stated here so it is not a surprise.
  tok=$(sed -n 's/^DISCORD_BOT_TOKEN=//p' "$BOT_ENV" 2>/dev/null | head -1 | tr -d '"'"'"'\r')
  [ -n "$tok" ] || { log "FAILED: no bot token at $BOT_ENV"; exit 2; }
  hdr="$WORK/hdr"; ( umask 077; printf 'Authorization: Bot %s\n' "$tok" > "$hdr" ); tok=""
  code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST -H @"$hdr" -H 'Content-Type: application/json' \
    --data-binary @"$WORK/payload" "https://discord.com/api/v10/channels/$CHANNEL/messages")
fi
if [ "$code" = 200 ]; then echo "$RUN_START" > "$STATE/last-posted"; log "posted to #admin"; exit 0; fi
log "FAILED: Discord answered '$code'; will try again next run"; exit 2
