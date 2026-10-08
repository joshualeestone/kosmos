#!/usr/bin/env bash
# site-autodeploy.sh -- publish installkosmos.com when chaoskosmos-site main moves (#5589).
#
# Josh, 2026-10-08 06:45 and 06:47: "We have got to get the Mac OS build separated from pushing a
# simple website change" and "push website stuff immediately and not bundled with a Mac release."
#
# One tick: if site origin/main has moved past the last sha this job deployed, and the live site is
# not already serving it, bring this job's OWN site checkout to it and run tools/deploy-site.sh
# --publish. deploy-site.sh does the real work and keeps every guard it has: it fetches the current
# live downloads and verifies them by sha, and it refuses when a live pointer moves mid-run (#5589).
# Who runs a tick: chaoskosmos-site's .github/workflows/site-deploy.yml, on the site repo's self-hosted
# runner on Mortals (the box with the working Vercel login, and the box cuts run on, so the cut check
# below sees them). It runs on every push to site main, and every 15 minutes as a backstop for a tick
# that skipped beside a cut. A tick that fails exits 1, so the run goes red in GitHub.
#
# 🔑 Why its own checkout. A release cut populates the site checkout's gitignored dist/ and leaves
# versions.html dirty behind it. A checkout nobody else uses is never the one a cut is writing, and
# it can sit on main, which deploy-site.sh requires for a publish (#3073). Make it once with
#   git clone --reference <the cut's site checkout> --dissociate <site remote> <this checkout>
# (borrows the objects for the clone and then copies them, so it downloads no history and does not
# depend on the other checkout afterwards), then copy .vercel/ into it.
#
# 🔑 The older versioned Mac downloads. A deploy ships every versioned kosmos-<v>-arm64.tar.gz (and
# .sha256) present in dist/, and those are gitignored, so a checkout of its own has none: deploying
# from it would take every older version's download off the site. So before each deploy the tick
# mirrors exactly that set from the cut's site checkout (KOSMOS_AUTODEPLOY_DIST_FROM), including
# removals, so a version tools/dist-retention.sh pruned there is not put back here. The current
# build, the alias, tmux and the pkg are fetched from live and checked by deploy-site.sh as before.
#
# Skips, retried on the next tick: a release, deploy-site.sh or promote-channel.sh running on this
# machine; another tick still running; exit 75 from deploy-site.sh (the live site moved or could not
# be read). A commit the live site already serves (its .kosmos-release-export names it, as right
# after a cut's own step 8) is recorded as deployed without deploying it again.
# A failed deploy is retried once on the next tick (one network blip should not park a website
# change), then PARKED: a second failure on the same sha is a finding, not a blip, and a tick
# re-running a refusing deploy every 15 minutes would bury it. The next merge, or deleting `parked`,
# tries again. A checkout fault (off main, dirty, diverged) or a missing source of the older
# downloads parks at once: retrying cannot fix either.
#
# State (KOSMOS_AUTODEPLOY_STATE, default ~/.kosmos-site-autodeploy):
#   heartbeat      the time of the last tick that held the lock (a stall shows as an old heartbeat)
#   last-deployed  the site sha this job last published (or found already live)
#   last-failure   "<sha> rc=<n> <time>" of the last failed attempt (a record, read by nothing)
#   failures       "<sha> <n>" consecutive failed attempts for that sha
#   parked         the sha not retried until main moves
#   retries        "<sha> <n>" consecutive exit-75 ticks for that sha
#   log            one line per tick that did something, plus each deploy's output (trimmed to its
#                  last 5000 lines once it passes 5 MB)
#
# Env: KOSMOS_AUTODEPLOY_SITE (the job's own site checkout, required), KOSMOS_AUTODEPLOY_STATE,
# KOSMOS_AUTODEPLOY_DIST_FROM (default ~/work/chaoskosmos-site/dist), KOSMOS_SITE_URL (default
# https://installkosmos.com, the same variable deploy-site.sh reads).
# Test seams: KOSMOS_AUTODEPLOY_DEPLOY (the deploy command, default this repo's deploy-site.sh
# --publish), KOSMOS_AUTODEPLOY_PS (the process list command, default `ps -axo command=`).
# macOS only (stat -f), like the box it runs on.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${KOSMOS_AUTODEPLOY_SITE:-}"
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
DIST_FROM="${KOSMOS_AUTODEPLOY_DIST_FROM:-$HOME/work/chaoskosmos-site/dist}"
HOST="${KOSMOS_SITE_URL:-https://installkosmos.com}"
LOG="$STATE/log"
now() { date '+%Y-%m-%d %H:%M:%S %Z'; }
# Everything a tick says goes to the log AND to stdout, so a run in GitHub Actions shows why it did what it did.
say() { printf '%s %s\n' "$(now)" "$*" | tee -a "$LOG"; }
park() { echo "$TARGET" > "$STATE/parked"; }
# Read "<sha> <n>" from a count file; a damaged or foreign line counts from zero, never evaluates its text.
count_for() {
  local f="$1" csha="" cn=""
  read -r csha cn < "$f" 2>/dev/null || true
  case "$cn" in ''|*[!0-9]*) cn=0 ;; esac
  if [ "$csha" = "$TARGET" ]; then echo "$cn"; else echo 0; fi
}
RETRY_ALARM=4   # consecutive retried ticks for one sha before a run goes red once

[ -n "$SITE" ] || { echo "site-autodeploy: set KOSMOS_AUTODEPLOY_SITE to this job's own site checkout" >&2; exit 2; }
mkdir -p "$STATE" || { echo "site-autodeploy: cannot make $STATE" >&2; exit 2; }

# One tick at a time. The workflow's concurrency group is what serialises ticks in practice; this lock
# is the backstop for a tick run by hand beside it. A lock left by a tick that died is taken over once
# its pid is gone (two ticks racing to take over the same dead lock is possible and harmless: each then
# runs deploy-site.sh, whose own pointer checks refuse the second if the first moved anything).
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  holder=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    # A tick takes minutes. A lock held past an hour of heartbeat silence is wedged (a reused pid,
    # say): go red so somebody looks, rather than skip green forever.
    beat=$(stat -f %m "$STATE/heartbeat" 2>/dev/null || date +%s)
    if [ $(( $(date +%s) - beat )) -gt 3600 ]; then say "FAIL: the lock (pid $holder) has been held with no heartbeat for over an hour; remove $LOCK if no tick is running"; exit 1; fi
    say "skip: another tick (pid $holder) holds the lock"; exit 0
  fi
  # No pid yet: a tick that has just made the lock and not written its pid. Held, unless that was
  # long enough ago that its tick must have died first. A stat that fails reads as just made (held).
  if [ -z "$holder" ] && [ $(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) )) -lt 60 ]; then say "skip: a lock with no pid yet (another tick starting)"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
# The heartbeat is written only by a tick that holds the lock, so a wedged lock shows as a stale one.
now > "$STATE/heartbeat"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then tail -n 5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

git -C "$SITE" fetch -q origin main 2>>"$LOG" || { say "FAIL: could not fetch site origin/main in $SITE"; exit 1; }
TARGET=$(git -C "$SITE" rev-parse --verify -q origin/main) || { say "FAIL: no origin/main in $SITE"; exit 1; }
LAST=$(cat "$STATE/last-deployed" 2>/dev/null || true)
[ "$TARGET" = "$LAST" ] && exit 0
[ "$(cat "$STATE/parked" 2>/dev/null || true)" = "$TARGET" ] && exit 0

# A release cut publishes the site itself (its step 8) from its own checkout, and a hand-run
# deploy-site.sh or promote-channel.sh is about to publish too. Do not deploy beside any of them: wait
# for it to finish, then publish whatever main holds. This sees only processes on THIS machine, which
# is where cuts run; a cut on another box is caught, if at all, by deploy-site.sh's pointer re-read
# (#5589) and its committed-vs-live guards. The match is anchored on the command column (an
# interpreter, flag-style options, then a path ending in tools/<name>.sh), so a grep or an editor
# naming the file does not read as one. A wrapper (caffeinate, nohup, env, bash -c, queued-heavy.sh)
# does not hide a cut: release.sh still runs as its own `bash .../tools/release.sh` process, and that
# line is what matches. Not matched: an option that takes a separate argument (bash -o pipefail ...)
# or a path with a space in it; cuts are launched as `bash tools/release.sh <version>`.
# The list is captured first and matched without a pipeline: under pipefail, `ps | grep -q` reports
# the SIGPIPE ps gets when grep stops at the first match (rc 141) on any list over a pipe buffer, so a
# busy machine would read as "nothing running" exactly when a cut is. This also matches the shell
# suite's own runs of tools/deploy-site.sh on this machine, which only delays a deploy a tick.
PS_CMD="${KOSMOS_AUTODEPLOY_PS:-ps -axo command=}"
procs=$(sh -c "$PS_CMD" 2>/dev/null) || procs=""
if grep -Eq '^([^ ]*/)?(ba|z)?sh( -[^ ]+)* [^ ]*tools/(release|deploy-site|promote-channel)\.sh( |$)' <<<"$procs"; then
  say "skip: a release cut, deploy or promote is running; main ${TARGET:0:9} waits for the next tick"
  exit 0
fi

# Already live: a cut's step 8 (or a hand-run deploy) published this exact commit. The export marker
# deploy-site.sh and release.sh ship names the site commit it was built from. An unreadable marker
# proves nothing either way, so the tick deploys.
served=$(curl -fsS --max-time 20 -H 'Cache-Control: no-cache' "$HOST/.kosmos-release-export" 2>/dev/null | sed -n 's/^commit=//p')
if [ "$served" = "$TARGET" ]; then
  echo "$TARGET" > "$STATE/last-deployed"; rm -f "$STATE/failures" "$STATE/retries" "$STATE/parked"
  say "already live: $HOST serves site main ${TARGET:0:9}; nothing to deploy"
  exit 0
fi

# Bring the job's checkout to main. It is nobody else's, so anything that stops a fast-forward
# (a dirty file, a local commit) is a fault to report, not work to save.
br=$(git -C "$SITE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
[ "$br" = main ] || { say "FAIL: $SITE is on '${br:-a detached HEAD}', not main; deploy-site.sh would refuse (parked)"; printf '%s rc=%s %s\n' "$TARGET" checkout "$(now)" > "$STATE/last-failure"; park; exit 1; }
git -C "$SITE" merge -q --ff-only origin/main 2>>"$LOG" || { say "FAIL: could not fast-forward $SITE to ${TARGET:0:9}, dirty or diverged (parked)"; printf '%s rc=%s %s\n' "$TARGET" checkout "$(now)" > "$STATE/last-failure"; park; exit 1; }

# Mirror the older versioned Mac downloads (see the header). --delete with these filters removes only
# versioned tarballs and sidecars the source no longer has; every other file in dist/ is left alone.
[ -d "$DIST_FROM" ] || { say "FAIL: no $DIST_FROM to take the older versioned downloads from; deploying without them would take them off the site (parked)"; printf '%s rc=%s %s\n' "$TARGET" dist "$(now)" > "$STATE/last-failure"; park; exit 1; }
rsync -a --delete --include='kosmos-*-arm64.tar.gz' --include='kosmos-*-arm64.tar.gz.sha256' --exclude='*' "$DIST_FROM/" "$SITE/dist/" 2>&1 | tee -a "$LOG"
[ "${PIPESTATUS[0]}" = 0 ] || { say "FAIL: could not mirror the versioned downloads from $DIST_FROM"; printf '%s rc=%s %s\n' "$TARGET" dist "$(now)" > "$STATE/last-failure"; exit 1; }
# Every mirrored tarball must match its own .sha256, or it is not deployed. deploy-site.sh checks only
# the current build, and a cut that started after the check above could be writing one right now. A
# mismatch is not a finding about this sha, so it is retried on the next tick, never parked.
for _t in "$SITE"/dist/kosmos-*-arm64.tar.gz; do
  [ -e "$_t" ] || continue
  _want=$(cut -c1-64 "$_t.sha256" 2>/dev/null || true); _have=$(shasum -a 256 "$_t" | cut -c1-64)
  [ -n "$_want" ] && [ "$_want" = "$_have" ] || { MISMATCH="${_t##*/}"; break; }
done
if [ -n "${MISMATCH:-}" ]; then
  # Counted with the exit-75 retries: a cut writing it clears within a tick or two; one that never
  # matches (no sidecar, a corrupt copy at the source) goes red on the 4th tick instead of green forever.
  n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
  if [ "$n" = "$RETRY_ALARM" ]; then say "FAIL: the mirrored $MISMATCH has not matched its .sha256 for $n ticks; fix it at $DIST_FROM"; exit 1; fi
  say "skip: the mirrored $MISMATCH does not match its .sha256 (a cut writing it?); the next tick tries again ($n in a row)"
  exit 0
fi

say "deploying site main ${TARGET:0:9} (last deployed ${LAST:0:9})"
# The deploy's output goes to the log and to stdout (PIPESTATUS keeps the deploy's own exit status).
# KOSMOS_REPO pins deploy-site.sh's libraries to THIS checkout; without it they load from
# ~/work/agent-workforce, which on Mortals is the cut's checkout, at whatever sha a cut left it.
export KOSMOS_REPO="$REPO"
if [ -n "${KOSMOS_AUTODEPLOY_DEPLOY:-}" ]; then
  KOSMOS_SITE="$SITE" sh -c "$KOSMOS_AUTODEPLOY_DEPLOY" 2>&1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}
else
  KOSMOS_SITE="$SITE" bash "$REPO/tools/deploy-site.sh" --publish 2>&1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}
fi
if [ "$rc" = 0 ]; then
  echo "$TARGET" > "$STATE/last-deployed"; rm -f "$STATE/failures" "$STATE/retries" "$STATE/parked"
  say "deployed site main ${TARGET:0:9}"
  exit 0
fi
# 75: deploy-site.sh found the live site moving (a cut or a staging publish landed mid-run) or could
# not read it. Not a finding about this sha, so it is NOT parked: the next tick tries again.
# After RETRY_ALARM of them in a row for the same sha the tick exits 1 once, so the run goes red
# (a host that stays unreachable would otherwise read green forever); it keeps retrying after that.
if [ "$rc" = 75 ]; then
  n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
  if [ "$n" = "$RETRY_ALARM" ]; then
    say "FAIL: ${TARGET:0:9} has hit a moving or unreadable live site $n ticks in a row; still retrying"
    exit 1
  fi
  say "retry: the live site moved or could not be read during the deploy of ${TARGET:0:9} ($n in a row); the next tick tries again"
  exit 0
fi
printf '%s rc=%s %s\n' "$TARGET" "$rc" "$(now)" > "$STATE/last-failure"
n=$(( $(count_for "$STATE/failures") + 1 )); echo "$TARGET $n" > "$STATE/failures"
if [ "$n" -ge 2 ]; then
  park
  say "FAIL: deploy of site main ${TARGET:0:9} exited $rc, the second time in a row (parked until main moves; output above)"
else
  say "FAIL: deploy of site main ${TARGET:0:9} exited $rc (retried once on the next tick; output above)"
fi
exit 1
