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
# ECHO'S RESULT (#4415 wording): the agent that triages the reports (Echo) runs this once a day AFTER triaging them and
# filing or commenting on cards, with FEEDBACK_DIGEST_MESSAGE_FILE naming a file that holds its own result. Then THAT
# text is posted, verbatim, instead of the automatic summary (cut at a line break to fit one Discord message, and it
# says so when cut). The pull, the card list and the triage are skipped (Echo already did that work); the lock, the
# watermark (moves on a 200 only, to FEEDBACK_DIGEST_WATERMARK, the epoch Echo STARTED its pull, which this mode
# requires), at-least-once delivery, the token handling and the dry run are the same.
# The variable set to an empty value, a missing or unreadable file, or an empty one REFUSES (exit 2): falling back to
# the automatic text would tell #admin nothing was triaged on a day it was. A held lock in this mode exits 3 (not
# posted), since the run that holds it will not post Echo's text, and a failed post (Discord's error, no bot token, or
# a broken environment: no state or temp folder, no lock, node or jq failing, named in the log line) exits 4. Both
# mean: run it again. The watermark never moves backwards in this mode.
# Exit codes in this mode (Echo is its only caller):
#   0  posted, or this pull's result was ALREADY posted (FEEDBACK_DIGEST_WATERMARK equals the last one posted, kept in
#      $STATE/last-message-wm: a rerun of the same pull posts nothing)
#   2  a refusal, nothing posted: fix the file or the watermark
#   3  the lock is held by a run for ANOTHER pull (or the automatic path): not posted, run it again
#   4  not posted (Discord's error, no bot token, a broken environment): run it again
#   5  posted, but the watermark was not recorded: do NOT run it again (it would post twice)
#   6  the lock is held by a run posting THIS SAME pull (its $LOCK/wm equals ours): the other run's exit code decides; do
#      NOT start another
#   7  the post MAY have gone out, check #admin before running again: Discord did not answer (curl printed 000 or
#      nothing), or a previous run of this same pull died while posting (it left a stale lock carrying our WM)
#   any other code (for example 128+n when the run was killed by a signal): it may have died mid-post, check #admin first
#
# WHY ONLY SINCE THE LAST POST: over all time the store held 39 reports and about 105 candidates (measured
# 2026-09-28); a digest of all of them every day would be the same wall each morning. A day's worth is a handful.
#
# 🛑 NOT INSTALLED AS A JOB UNTIL THE TRIAGE FIX IS RELEASED. The default ENGINE is the installed app's, and an
# engine without the #4415 negation fix posts about 158 "candidates" topped by "Nothing appears broken". Once a
# release carries it, a launchd job runs this daily.
#
# The bot token never reaches argv: curl reads the Authorization header from a mode-600 temp file (the #1655
# pattern). Any failure is logged and exits non-zero, and last-posted moves only on a 200. Delivery on the automatic
# path is AT LEAST ONCE: if Discord takes the post but its answer is lost (a timeout), the watermark stays and the
# same digest can be posted again next run. That is the chosen side: a repeat is noticed, a lost digest is not. In
# message-file mode a timeout is its own exit (7) rather than "run it again", because a person can look at #admin.
#
# SEAMS (tools/test-feedback-digest-daily.sh drives every arm with no network and no token):
#   FEEDBACK_DIGEST_PULL_DIR  read reports from this folder instead of pulling from the store
#   FEEDBACK_DIGEST_CARDS_CMD prints the open card titles, one per line (default: gh issue list)
#   FEEDBACK_DIGEST_POST_CMD  called with <payload.json>; prints the HTTP status (default: curl to Discord)
# INPUT (not a seam): FEEDBACK_DIGEST_MESSAGE_FILE, Echo's result, above.
set -u
ENGINE="${KOSMOS_ENGINE:-$HOME/.local/share/kosmos/app/engine}"
NODE="${KOSMOS_NODE:-$HOME/.local/share/kosmos/runtime/bin/node}"
STATE="${FEEDBACK_DIGEST_STATE:-$HOME/.cache/kosmos-feedback-digest}"
CHANNEL="${FEEDBACK_DIGEST_CHANNEL:-1480685699673100289}"   # #admin
BOT_ENV="${FEEDBACK_DIGEST_BOT_ENV:-$HOME/.claude/channels/discord/.env}"
ADMIN_URL="${FEEDBACK_DIGEST_ADMIN_URL:-https://installkosmos.com/admin}"
DRY="${FEEDBACK_DIGEST_DRY_RUN:-}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') feedback-digest: $*"; }
# Review 2 (warning 1): a watermark is checked as TEXT before any numeric compare. `[ -gt ]` on a number past 63 bits
# errors and reads as false, so 99999999999999999999 passed the future check and was written, silencing the automatic
# digest for good; 0 passed too. An epoch in seconds is 9 or 10 digits with no leading zero (1973 to 2286). The
# pattern is UNQUOTED on purpose: quoted, its brackets would be literal and nothing would match.
epoch_shaped() {
  case "$1" in [1-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]|[1-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) return 0 ;; esac
  return 1
}
# ${VAR+x}: SET, even to empty, counts. An empty value is a wiring mistake, and it refuses like a missing file.
MSG_FILE=""
if [ -n "${FEEDBACK_DIGEST_MESSAGE_FILE+x}" ]; then
  MSG_FILE="$FEEDBACK_DIGEST_MESSAGE_FILE"
  if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ] || [ ! -r "$MSG_FILE" ] || ! grep -q '[^[:space:]]' "$MSG_FILE" 2>/dev/null; then
    log "REFUSED: FEEDBACK_DIGEST_MESSAGE_FILE is set but '${MSG_FILE}' is missing, unreadable or empty; nothing posted, the watermark stays"
    exit 2
  fi
  # Review (warning 1): the watermark in this mode is the moment ECHO STARTED ITS PULL, not this run's start. A report
  # that arrived while Echo was triaging is in neither Echo's pull nor, with the run start as watermark, tomorrow's
  # window. Required, a whole number of seconds, and not in the future.
  # Review 2 (warning 1): its shape is checked (epoch_shaped) before the future check compares it as a number.
  WM="${FEEDBACK_DIGEST_WATERMARK:-}"
  if ! epoch_shaped "$WM"; then
    log "REFUSED: a message file needs FEEDBACK_DIGEST_WATERMARK=<epoch seconds when the pull started, 9 or 10 digits>, got '${WM}'; nothing posted, the watermark stays"
    exit 2
  fi
  if [ "$WM" -gt "$(date +%s)" ]; then
    log "REFUSED: FEEDBACK_DIGEST_WATERMARK $WM is in the future; nothing posted, the watermark stays"; exit 2
  fi
elif [ -n "${FEEDBACK_DIGEST_WATERMARK+x}" ]; then
  # Review 3 (nit): a watermark only means something with Echo's text; say so rather than drop it silently.
  log "a watermark was given but no message file; posting the automatic text"
fi
# Review 2 (warning 3): a failed POST is not a refusal. In message-file mode there is no next run to retry it, so it exits
# 4 and says to run it again (exit 2 is a refusal: fix the file or the watermark; 3 is a held lock). The automatic path
# keeps its exit 2 and its words: tomorrow's run does retry the same reports.
# Review 3: a broken ENVIRONMENT (no state or temp folder, no node, node or jq failing) goes through here too, so in
# message-file mode it is exit 4 with the cause in the log line, never exit 2, which would send Echo to fix a file that is
# fine. Defined here, once MSG_FILE is known, so the earliest of those failures can use it.
post_failed() {   # <what failed> <the automatic path's tail>
  if [ -n "$MSG_FILE" ]; then log "FAILED: $1; the digest was NOT posted; run it again"; exit 4; fi
  log "FAILED: $1$2"; exit 2
}
# Review (warning 2): a run that steps aside for another one leaves Echo's message UNPOSTED, so in message-file mode it
# is a failure (exit 3), not a quiet success. The automatic path keeps exit 0: the other run posts the same summary.
# Review 4 (W1): a holder in message-file mode records its pull's WM in $LOCK/wm. If it is OUR pull, the holder is
# posting this same text, so running again would post it twice: exit 6, not 3.
step_aside() {
  log "$1; this one does nothing"
  rm -rf "$WORK"
  if [ -n "$MSG_FILE" ]; then
    if [ "$(cat "$LOCK/wm" 2>/dev/null)" = "$WM" ]; then
      log "another run is posting this same result; the other run's exit code decides; do NOT start another"; exit 6
    fi
    log "FAILED: the digest was NOT posted (another run holds the lock); run it again"; exit 3
  fi
  exit 0
}
mkdir -p "$STATE" && chmod 700 "$STATE" || post_failed "no state folder $STATE" ""
WORK="$(mktemp -d)" || post_failed "no temp folder" ""
# Review 5 (nit i): every exit from here on removes $WORK, including a post_failed before the full trap below.
trap 'rm -rf "$WORK"' EXIT
# One run at a time (review 3: a launchd run and a manual one both posted). The lock holds its owner's pid.
# Review 4, the races: a lock with no pid yet is a run STARTING, not a dead one (unless it is a minute old); a live
# pid counts for an hour only (a real run takes about a minute, and a pid can be reused); a stale lock is taken over
# by RENAMING it away, which only one run can win; and a run removes the lock only if it is still its own.
LOCK="$STATE/lock"
# Review 4 (W1): the wm is written BEFORE the pid, so a lock that shows a pid already shows its pull.
# Review 5 (W2): a lock this run made but could not fill (the wm or pid write failed) is removed, and the run fails
# (exit 4 in message-file mode): left behind, it would read as a run "starting" with our wm, and we would step aside
# from our own half-made lock (exit 6, "do NOT start another") with nothing posted.
take_lock() {
  mkdir "$LOCK" 2>/dev/null || return 1
  { [ -z "$MSG_FILE" ] || echo "$WM" > "$LOCK/wm"; } && echo $$ > "$LOCK/pid" && return 0
  rm -rf "$LOCK"
  post_failed "could not write the lock in $STATE" ""
}
got_lock=""
take_lock && got_lock=1
# Review 4 (nit a): a failed mkdir with no lock there is not a held lock. Try once more (its holder may have just let
# go); still no lock directory means mkdir itself failed, which is a broken environment, never "another run".
if [ -z "$got_lock" ] && [ ! -d "$LOCK" ]; then
  take_lock && got_lock=1
  [ -n "$got_lock" ] || [ -d "$LOCK" ] || post_failed "could not create the lock in $STATE" ""
fi
if [ -z "$got_lock" ]; then
  holder=$(cat "$LOCK/pid" 2>/dev/null)
  age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) ))
  if { [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null && [ "$age" -lt 3600 ]; } || { [ -z "$holder" ] && [ "$age" -lt 60 ]; }; then
    step_aside "another run (${holder:-starting}) is posting"
  fi
  if mv "$LOCK" "$STATE/lock.stale.$$" 2>/dev/null; then
    # If what we moved is not the stale lock we judged (another run took over in between), put it back.
    if [ "$(cat "$STATE/lock.stale.$$/pid" 2>/dev/null)" != "$holder" ] && [ ! -e "$LOCK" ]; then mv "$STATE/lock.stale.$$" "$LOCK" 2>/dev/null; fi
    # Review 5 (W1): a stale lock carrying OUR wm is a run of this same pull that died while posting, and its post may
    # have gone out. Unless this pull's key says it was recorded as posted, stop and say to check #admin (exit 7). The
    # stale lock is removed first, so a deliberate rerun after checking goes through.
    stale_wm=$(cat "$STATE/lock.stale.$$/wm" 2>/dev/null)
    rm -rf "$STATE/lock.stale.$$"
    if [ -n "$MSG_FILE" ] && [ -n "$stale_wm" ] && [ "$stale_wm" = "$WM" ] && [ "$(cat "$STATE/last-message-wm" 2>/dev/null)" != "$WM" ]; then
      log "a previous run of this same pull died while posting; it MAY have been posted: check #admin before running again"
      exit 7
    fi
  fi
  take_lock || step_aside "another run took the lock"
  log "took over a stale lock (${holder:-no pid}, ${age}s old)"
fi
trap 'rm -rf "$WORK"; [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"' EXIT
# Review 4 (W1): the idempotency key. A rerun of a pull already posted (Echo retrying after a held lock, or by mistake)
# posts nothing: the text is in #admin, so it is success. Read under the lock, so two runs of one pull cannot both pass
# it. A dry run posts nothing anyway and still prints the text.
if [ -n "$MSG_FILE" ] && [ -z "$DRY" ] && [ -f "$STATE/last-message-wm" ]; then
  last_mwm=""; read -r last_mwm < "$STATE/last-message-wm"
  if [ "$last_mwm" = "$WM" ]; then log "this pull's result was already posted; nothing to do"; exit 0; fi
fi

# The watermark this run writes on success: its START, before the pull, so a report that arrives while the run is
# pulling and posting is not older than the next watermark and skipped for good.
# One second back: stamps are whole seconds, and a report stamped in the very second the run starts but uploaded after
# the pull would otherwise sit exactly on the watermark, outside both windows.
RUN_START=$(( $(date +%s) - 1 ))
since=0
# Review 3 (nit): message-file mode has no window (Echo pulled), so the stored watermark is not read here and its "using
# the last day" lines, which would be false in this mode, are not logged. It is read raw, under the lock, at the write.
if [ -z "$MSG_FILE" ]; then
  if [ -f "$STATE/last-posted" ]; then
    since=""; read -r since < "$STATE/last-posted"
    # Review 2 (warning 1): the stored value gets the same shape check, so a huge number never reaches a numeric compare
    # below. A bad one (a hand edit, an old run's write) is treated as a first run, and said.
    if ! epoch_shaped "$since"; then
      log "the stored watermark '$since' in $STATE/last-posted is not epoch seconds; using the last day, as on a first run"
      since=0
    fi
  fi
  # Review 4: a watermark in the FUTURE (a clock stepped back, a hand edit) would make every window empty and say "no new
  # reports" for good. It is treated as unreadable: the last day, as on a first run.
  [ "$since" -gt "$RUN_START" ] && { log "the watermark $since is in the future; using the last day"; since=0; }
  # First run: the last day only, not the whole history.
  [ "$since" -eq 0 ] && since=$(( $(date +%s) - 86400 ))
fi

if [ -n "$MSG_FILE" ]; then
  : # Echo's result: no card list, pull or triage needed (below).
elif [ -n "${FEEDBACK_DIGEST_CARDS_CMD:-}" ]; then
  $FEEDBACK_DIGEST_CARDS_CMD > "$WORK/cards" || { log "FAILED: could not read the open cards"; exit 2; }
else
  # Review 4: bounded (no `timeout` on macOS; perl's alarm), so a hung gh cannot hold the lock for good.
  perl -e 'alarm 120; exec @ARGV' gh issue list --repo joshualeestone/kosmos --state open --limit 2000 --json number,title \
    -q '.[]|"#\(.number) \(.title)"' > "$WORK/cards" 2>/dev/null || { log "FAILED: could not read the open cards"; exit 2; }
fi

# A list as long as gh's limit is a ceiling, not a total: cards past it would not match, and reports about them would
# be posted as new. Refuse rather than post a digest that under-matches. (Checked on either source of the list.)
[ -z "$MSG_FILE" ] && [ "$(wc -l < "$WORK/cards" | tr -d ' ')" -ge 2000 ] && { log "FAILED: the open card list hit its 2000 limit; raise it"; exit 2; }

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
# Echo's result, bounded to one Discord message (2000 characters; counted in UTF-16 units, which is never fewer than
# Discord's count). Cut at the last line break that fits, with a line saying so; a single line longer than the limit is
# cut mid-line. Written to a file and handed to jq as-is, so the post is the file's text byte for byte when it fits.
cat > "$WORK/bound.js" <<'JS'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const MAX = 2000, NOTE = '\n[cut here to fit one Discord message]';
const text = fs.readFileSync(src, 'utf8');
if (text.length <= MAX) { fs.writeFileSync(dst, text); process.exit(0); }
let head = text.slice(0, MAX - NOTE.length);
const nl = head.lastIndexOf('\n');
if (nl > 0) head = head.slice(0, nl);
else if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1);   // a mid-line cut never halves an emoji
fs.writeFileSync(dst, head + NOTE);
process.stderr.write('cut from ' + text.length + ' to ' + (head.length + NOTE.length) + ' characters\n');
JS
mkdir -p "$WORK/pulled"
# Review 2 (nit): a node that cannot run is said as such, not as "could not read the message file" (which sends the
# reader to a file that is fine).
[ -x "$NODE" ] || post_failed "the node runtime $NODE is missing or not executable" "; nothing posted, the watermark stays"
if [ -n "$MSG_FILE" ]; then
  # The file was checked readable and non-blank above, so a failure here is node's or the temp folder's (review 3).
  "$NODE" "$WORK/bound.js" "$MSG_FILE" "$WORK/message" 2> "$WORK/bound.err" \
    || post_failed "node could not prepare the message from $MSG_FILE: $(cat "$WORK/bound.err" 2>/dev/null)" ""
  [ -s "$WORK/bound.err" ] && log "the message file was longer than one Discord message: $(cat "$WORK/bound.err")"
  summary="(Echo's result, $MSG_FILE)"
else
  summary="$("$NODE" "$WORK/digest.js" "$ENGINE" "${FEEDBACK_DIGEST_PULL_DIR:-}" "$WORK/pulled" "$since" "$ADMIN_URL" "$WORK/cards" "$RUN_START")" \
    || { log "FAILED: pull or triage (see above)"; exit 2; }
  printf '%s' "$summary" > "$WORK/message"
fi

# date -r <epoch> is macOS (BSD) date; this job runs on the fleet's Macs.
if [ -z "$summary" ]; then log "no new reports since $(date -r "$since" '+%Y-%m-%d %H:%M'); nothing posted"; exit 0; fi
if [ -n "$DRY" ]; then log "DRY RUN, would post:"; cat "$WORK/message"; echo; exit 0; fi

# post_failed is defined near the top (review 3), so the environment failures above use it too.
jq -Rs '{content: ., allowed_mentions: {parse: []}}' < "$WORK/message" > "$WORK/payload" \
  || post_failed "could not build the message (jq failed)" ""
if [ -n "${FEEDBACK_DIGEST_POST_CMD:-}" ]; then
  code=$($FEEDBACK_DIGEST_POST_CMD "$WORK/payload")
else
  # ⚠️ The bot token is read from the Discord plugin's own .env (the main bot's), not through secrets-map.sh: it is that
  # plugin's file and there is no mapped target for it. A second reader of it, stated here so it is not a surprise.
  tok=$(sed -n 's/^DISCORD_BOT_TOKEN=//p' "$BOT_ENV" 2>/dev/null | head -1 | tr -d '"'"'"'\r')
  [ -n "$tok" ] || post_failed "no bot token at $BOT_ENV" ""
  hdr="$WORK/hdr"; ( umask 077; printf 'Authorization: Bot %s\n' "$tok" > "$hdr" ); tok=""
  code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST -H @"$hdr" -H 'Content-Type: application/json' \
    --data-binary @"$WORK/payload" "https://discord.com/api/v10/channels/$CHANNEL/messages")
fi
if [ "$code" = 200 ]; then
  # Review 4 (W1): the key first, written beside and renamed like last-posted, so a rerun of this pull posts nothing
  # even when last-posted cannot be written below.
  if [ -n "$MSG_FILE" ] && ! { printf '%s\n' "$WM" > "$STATE/last-message-wm.tmp" && mv -f "$STATE/last-message-wm.tmp" "$STATE/last-message-wm"; }; then
    log "POSTED, but this pull's key was not recorded in $STATE/last-message-wm; do NOT run it again (it would post twice)"
    exit 5
  fi
  # Review 3: written beside and renamed into place, and checked. An unwritable state file used to log "posted" and
  # exit 0 while every later run re-posted everything since the stale watermark.
  NEW_WM="$RUN_START"
  if [ -n "$MSG_FILE" ]; then
    # message-file mode: one second before Echo's pull started, as the automatic path saves its start minus one; the
    # window is (since, now], so a report stamped in the very second the pull began is not left on the line.
    NEW_WM=$(( WM - 1 ))
    # Review 2 (warning 2): never BACKWARDS. A WM older than the current last-posted would make the next automatic digest
    # re-post reports already triaged. The raw file is read here, under the lock ($since was rewritten above for a
    # first run or a future value). A stored value that is malformed or in the future is not kept: the automatic path
    # distrusts it too, and WM replaces it.
    cur=""; [ -f "$STATE/last-posted" ] && read -r cur < "$STATE/last-posted"
    if epoch_shaped "$cur" && [ "$cur" -gt "$NEW_WM" ] && [ "$cur" -le "$(date +%s)" ]; then
      log "the watermark $NEW_WM is older than the last post's $cur; keeping $cur"
      NEW_WM="$cur"
    fi
  fi
  if printf '%s\n' "$NEW_WM" > "$STATE/last-posted.tmp" && mv -f "$STATE/last-posted.tmp" "$STATE/last-posted"; then
    log "posted to #admin"; exit 0
  fi
  # Review 3 (warning): in message-file mode Echo's text IS in #admin, so this is neither a refusal (2) nor "run it
  # again" (4): a rerun would post it twice. Its own exit, 5.
  if [ -n "$MSG_FILE" ]; then
    log "POSTED, but the watermark was not recorded in $STATE/last-posted; do NOT run it again (it would post twice). Write $NEW_WM there once the folder is writable"
    exit 5
  fi
  log "FAILED: posted, but could not record it in $STATE/last-posted; the next run will post these again"; exit 2
fi
# Review 4 (W2): curl -m prints 000 (or nothing) when Discord did not answer in time, and Discord may have taken the
# post before that. In message-file mode "run it again" could post twice, so it is its own exit, 7: look at #admin
# first. The automatic path keeps at-least-once (the header): its next run retries.
if [ -n "$MSG_FILE" ] && { [ -z "$code" ] || [ "$code" = 000 ]; }; then
  log "Discord did not answer; the digest MAY have been posted: check #admin before running again"; exit 7
fi
post_failed "Discord answered '$code'" "; will try again next run"
