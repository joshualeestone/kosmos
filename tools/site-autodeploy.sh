#!/usr/bin/env bash
# site-autodeploy.sh -- publish installkosmos.com when chaoskosmos-site main moves (#5589).
#
# Josh, 2026-10-08 06:45 and 06:47: "We have got to get the Mac OS build separated from pushing a
# simple website change" and "push website stuff immediately and not bundled with a Mac release."
#
# One tick: if site origin/main has moved past the last sha this job deployed, bring this job's OWN
# site checkout to it and run tools/deploy-site.sh --publish. deploy-site.sh does the real work and
# keeps every guard it has: it fetches the live downloads and verifies them by sha, so a site-only
# deploy cannot drop or change one, and it refuses when a live pointer moves mid-run (#5589).
# Who runs a tick: chaoskosmos-site's .github/workflows/site-deploy.yml, on the site repo's self-hosted
# runner on Mortals (the box with the working Vercel login, and the box cuts run on, so the cut check
# below sees them). It runs on every push to site main, and every 15 minutes as a backstop for a tick
# that skipped beside a cut. A tick that fails exits 1, so the run goes red in GitHub; later ticks for
# the same sha exit 0 (see "Does NOT retry" below), so one failure is reported once.
#
# 🔑 Why its own checkout. A release cut populates the site checkout's gitignored dist/ and leaves
# versions.html dirty behind it. A checkout nobody else uses is never the one a cut is writing, and
# it can sit on main, which deploy-site.sh requires for a publish (#3073). Make it once with
#   git clone --reference <the cut's site checkout> --dissociate <site remote> <this checkout>
# (borrows the objects for the clone and then copies them, so it downloads no history and does not
# depend on the other checkout afterwards), then copy .vercel/ into it.
#
# Skips, retried on the next tick: a release running on this machine, another tick still running.
# Does NOT retry a sha whose deploy failed (except exit 75, below: the live site was moving): a refusal is a finding, not a blip, and a tick that
# re-ran a refusing deploy every couple of minutes would hide it in noise. The failure is recorded
# (last-failure, and the log) and the next merge, or deleting last-failure, tries again.
#
# State (KOSMOS_AUTODEPLOY_STATE, default ~/.kosmos-site-autodeploy):
#   heartbeat      the time of the last tick (a silent stall shows as an old heartbeat)
#   last-deployed  the site sha this job last published
#   last-failure   "<sha> rc=<n> <time>" of a deploy that failed, until main moves past it
#   log            one line per tick that did something, plus each deploy's output (trimmed to its
#                  last 5000 lines once it passes 5 MB)
#
# Env: KOSMOS_AUTODEPLOY_SITE (the job's own site checkout, required), KOSMOS_AUTODEPLOY_STATE.
# Test seams: KOSMOS_AUTODEPLOY_DEPLOY (the deploy command, default this repo's deploy-site.sh
# --publish), KOSMOS_AUTODEPLOY_PS (the process list command, default `ps -axo command=`).
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${KOSMOS_AUTODEPLOY_SITE:-}"
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
LOG="$STATE/log"
now() { date '+%Y-%m-%d %H:%M:%S %Z'; }
# Everything a tick says goes to the log AND to stdout, so a run in GitHub Actions shows why it did what it did.
say() { printf '%s %s\n' "$(now)" "$*" | tee -a "$LOG"; }

[ -n "$SITE" ] || { echo "site-autodeploy: set KOSMOS_AUTODEPLOY_SITE to this job's own site checkout" >&2; exit 2; }
mkdir -p "$STATE" || { echo "site-autodeploy: cannot make $STATE" >&2; exit 2; }
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then tail -n 5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

# One tick at a time. The workflow's concurrency group is what serialises ticks in practice; this lock
# is the backstop for a tick run by hand beside it. A lock left by a tick that died is taken over once
# its pid is gone (two ticks racing to take over the same dead lock is possible and harmless: each then
# runs deploy-site.sh, whose own pointer checks refuse the second if the first moved anything).
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  holder=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then say "skip: another tick (pid $holder) holds the lock"; exit 0; fi
  # No pid yet: a tick that has just made the lock and not written its pid. Held, unless that was
  # long enough ago that its tick must have died first.
  if [ -z "$holder" ] && [ $(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) )) -lt 60 ]; then exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
# The heartbeat is written only by a tick that holds the lock, so a wedged lock shows as a stale one.
now > "$STATE/heartbeat"

git -C "$SITE" fetch -q origin main 2>>"$LOG" || { say "FAIL: could not fetch site origin/main in $SITE"; exit 1; }
TARGET=$(git -C "$SITE" rev-parse --verify -q origin/main) || { say "FAIL: no origin/main in $SITE"; exit 1; }
LAST=$(cat "$STATE/last-deployed" 2>/dev/null || true)
[ "$TARGET" = "$LAST" ] && exit 0
case "$(cat "$STATE/last-failure" 2>/dev/null || true)" in "$TARGET "*) exit 0 ;; esac

# A release cut publishes the site itself (its step 8) from its own checkout, and a hand-run deploy-site.sh
# or promote-channel.sh is about to publish too. Do not deploy beside any of them: wait for it to finish, then publish whatever main holds. This sees only cuts on THIS machine,
# which is where cuts run; a cut on another box is caught, if at all, by deploy-site.sh's pointer
# re-read (#5589) and its committed-vs-live guards. The match is anchored on the command
# column (an interpreter, any options, then a path ending in tools/release.sh), so a grep or an editor naming the
# file does not read as a cut.
PS_CMD="${KOSMOS_AUTODEPLOY_PS:-ps -axo command=}"
if sh -c "$PS_CMD" 2>/dev/null | grep -Eq '^([^ ]*/)?(ba|z)?sh( -[^ ]+)* [^ ]*tools/(release|deploy-site|promote-channel)\.sh( |$)'; then
  say "skip: a release cut, deploy or promote is running; main ${TARGET:0:9} waits for the next tick"
  exit 0
fi

# Bring the job's checkout to main. It is nobody else's, so anything that stops a fast-forward
# (a dirty file, a local commit) is a fault to report, not work to save.
br=$(git -C "$SITE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
[ "$br" = main ] || { say "FAIL: $SITE is on '${br:-a detached HEAD}', not main; deploy-site.sh would refuse"; printf '%s rc=%s %s\n' "$TARGET" checkout "$(now)" > "$STATE/last-failure"; exit 1; }
git -C "$SITE" merge -q --ff-only origin/main 2>>"$LOG" || { say "FAIL: could not fast-forward $SITE to ${TARGET:0:9} (dirty or diverged)"; printf '%s rc=%s %s\n' "$TARGET" checkout "$(now)" > "$STATE/last-failure"; exit 1; }

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
  echo "$TARGET" > "$STATE/last-deployed"; rm -f "$STATE/last-failure" "$STATE/retries"
  say "deployed site main ${TARGET:0:9}"
  exit 0
fi
# 75: deploy-site.sh found the live site moving (a cut or a staging publish landed mid-run) or could
# not read it. Not a finding about this sha, so it is NOT parked: the next tick tries again.
# After RETRY_ALARM of them in a row for the same sha the tick exits 1 once, so the run goes red
# (a host that stays unreachable would otherwise read green forever); it keeps retrying after that.
RETRY_ALARM=4
if [ "$rc" = 75 ]; then
  n=0; read -r rsha rn < "$STATE/retries" 2>/dev/null && [ "$rsha" = "$TARGET" ] && n=$rn
  n=$((n + 1)); echo "$TARGET $n" > "$STATE/retries"
  if [ "$n" = "$RETRY_ALARM" ]; then
    say "FAIL: ${TARGET:0:9} has hit a moving or unreadable live site $n ticks in a row; still retrying"
    exit 1
  fi
  say "retry: the live site moved or could not be read during the deploy of ${TARGET:0:9} ($n in a row); the next tick tries again"
  exit 0
fi
printf '%s rc=%s %s\n' "$TARGET" "$rc" "$(now)" > "$STATE/last-failure"
say "FAIL: deploy of site main ${TARGET:0:9} exited $rc (not retried until main moves; output above)"
exit 1
