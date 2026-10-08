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
# that skipped beside a cut. A failing tick exits 1 (red); a failure that REPEATS is red once per sha and
# cause per day and then reported green (red_once), because GitHub emails every failed scheduled run.
#
# 🔑 Why its own checkout. A release cut populates the site checkout's gitignored dist/ and leaves
# versions.html dirty behind it. A checkout nobody else uses is never the one a cut is writing, and
# it can sit on main, which deploy-site.sh requires for a publish (#3073). Make it once with
#   git clone <site remote> <this checkout>      (a plain, self-contained clone: ~40 s, 2.8 GB)
# then copy .vercel/ into it. NOT --reference: a borrowing clone can depend on objects the cut's checkout
# holds only through a feature branch, which git's own gc --auto there may prune (found in review; the
# Mortals clone was first made with --reference and remade plainly on 2026-10-08).
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
#   last-failure   "<sha> rc=<n> <time>" of the last failed attempt (its rc names the cause in the parked line)
#   failures       "<sha> <n>" consecutive failed attempts for that sha
#   parked         the sha not retried until main moves (red once, then reported; see red_once)
#   paused         made by a PERSON to stop the job (e.g. while a deliberate site rollback is live,
#                  which the job would otherwise undo by redeploying main); remove it to resume
#   retries        "<sha> <n>" consecutive retried ticks for that sha, whatever the cause (exit 75, a
#                  checksum mismatch, an unreadable live pointer): one count, one alarm, because each
#                  means the same thing to the person reading the run, the site is not settling
#   deploy.out     the last deploy's output (printed and logged when it ends, or when the tick is killed)
#   reported.d/    one file per "<sha>-<cause>" already reported red, holding the time (see red_once);
#                  removing a file makes that state red again on its next tick
#   mirror-count   how many versioned tarballs the last successful deploy mirrored (the floor the
#                  next mirror is held to; see MIRROR_DROP_MAX). A real prune of more than
#                  MIRROR_DROP_MAX versions between two website deploys trips it ON PURPOSE: the tick
#                  parks red and its FAIL line says how to accept the new count. That is the price of
#                  never mirroring an emptied or rebuilt cut box over the site's older downloads.
#   log            one line per tick that did something, plus each deploy's output (trimmed to its
#                  last 5000 lines once it passes 5 MB)
#
# Env: KOSMOS_AUTODEPLOY_SITE (the job's own site checkout, required), KOSMOS_AUTODEPLOY_STATE,
# KOSMOS_AUTODEPLOY_DIST_FROM (default ~/work/chaoskosmos-site/dist), KOSMOS_AUTODEPLOY_DEPLOY_MAX_S (the
# deploy's wall-clock limit in seconds: default 900, at most 1200; empty, non-numeric, 0 or a leading 0
# means 900), KOSMOS_AUTODEPLOY_FETCH_MAX_S (the fetch's limit: default 120, at most 600, same fallbacks),
# KOSMOS_SITE_URL (default
# https://installkosmos.com, the same variable deploy-site.sh reads).
# Test seams, TEST ONLY (each is run with sh -c, so never set them in the job's environment):
# KOSMOS_AUTODEPLOY_DEPLOY (the deploy command, default this repo's deploy-site.sh --publish),
# KOSMOS_AUTODEPLOY_PS (the process list command, default `ps -axo command=`).
# macOS only (stat -f), like the box it runs on.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${KOSMOS_AUTODEPLOY_SITE:-}"
TARGET=""   # set from origin/main below; empty until then (red_once keys on it), never inherited
STATE="${KOSMOS_AUTODEPLOY_STATE:-$HOME/.kosmos-site-autodeploy}"
DIST_FROM="${KOSMOS_AUTODEPLOY_DIST_FROM:-$HOME/work/chaoskosmos-site/dist}"
HOST="${KOSMOS_SITE_URL:-https://installkosmos.com}"
LOG="$STATE/log"
now() { date '+%Y-%m-%d %H:%M:%S %Z'; }
# Everything a tick says goes to the log AND to stdout, so a run in GitHub Actions shows why it did what it did.
say() { printf '%s %s\n' "$(now)" "$*" | tee -a "$LOG"; }
park() { echo "$TARGET" > "$STATE/parked"; mark_reported parked; }
# A state that would be red on every tick (a parked sha, a retry alarm, a wedged lock, an unreachable
# origin) goes red ONCE per sha and cause per day (a rolling 24 hours from the report, not a calendar
# day), then each further tick prints "STILL FAILING (reported)" and stays green. GitHub emails the
# account that last edited the workflow's cron on EVERY failed scheduled run, so red-every-tick on a
# 15-minute schedule would mean up to 96 emails a day to Josh's account. Each sha and cause has its OWN
# record (reported.d/<sha>-<cause>, holding the time), so two causes taking turns never re-arm each
# other. The records for the states with a clean "it is over" moment (wedged lock, fetch, origin/main)
# are removed the moment that is seen, so a new incident after it is red at once. The retry-type causes
# (pointer, unread, mirror, checksum, moving) are removed only when a deploy succeeds or main is found
# already live: until then the sha has not shipped, so a second incident of the same cause on it within
# the day is the SAME problem still open, and is reported green ("STILL FAILING") rather than emailed
# again. Clearing those on any passing check would let two causes taking turns re-arm each other every
# tick. (Records for a sha that main has since moved past linger until the next successful deploy
# empties the folder; they are tiny and harmless.) A state CHANGE (a first failure, the failure that
# parks, a checkout fault, an emptied dist) is always red; park() records itself, so its next tick is
# not a second email.
REPORTED="$STATE/reported.d"
mark_reported() { mkdir -p "$REPORTED" && date +%s > "$REPORTED/${TARGET:-none}-$1"; }
clear_reported() { rm -f "$REPORTED/${TARGET:-none}-$1"; }
red_once() {  # <cause> <message>
  local f="$REPORTED/${TARGET:-none}-$1" at
  at=$(cat "$f" 2>/dev/null || true)
  case "$at" in ''|*[!0-9]*) at=0 ;; esac
  local now; now=$(date +%s)
  if [ "$at" != 0 ] && [ "$at" -le "$now" ] && [ $(( now - at )) -lt 86400 ]; then   # a future time counts as never
    _msg="${2#FAIL: }"; _msg="${_msg/#FAIL (parked)/parked}"
    # An annotation on the green run (GitHub Actions). Workflow-command text is escaped (% CR LF), so no
    # message can break the annotation or start a second command.
    _ann=$(printf '%s' "$_msg" | sed -e 's/%/%25/g' | tr '\r\n' '  ')
    echo "::warning::still failing, reported red earlier today: $_ann"
    # date -r <epoch> is BSD/macOS date (GNU reads -r as a file); this script runs on macOS only.
    say "STILL FAILING (reported): $_msg (red already reported at $(date -r "$at" '+%Y-%m-%d %H:%M'); green until it recovers, changes, or a day passes; remove $f to make it red again now)"
    exit 0
  fi
  mark_reported "$1"
  say "$2"
  exit 1
}
# Read "<sha> <n>" from a count file; a damaged or foreign line counts from zero, never evaluates its text.
count_for() {
  local f="$1" csha="" cn=""
  read -r csha cn 2>/dev/null < "$f" || true
  case "$cn" in ''|*[!0-9]*) cn=0 ;; esac
  if [ "$csha" = "$TARGET" ]; then echo "$cn"; else echo 0; fi
}
RETRY_ALARM=4   # consecutive retried ticks for one sha at which the state is reported red (red_once)

[ -n "$SITE" ] || { echo "site-autodeploy: set KOSMOS_AUTODEPLOY_SITE to this job's own site checkout" >&2; exit 2; }
mkdir -p "$STATE" || { echo "site-autodeploy: cannot make $STATE" >&2; exit 2; }

# One tick at a time. The workflow's concurrency group is what serialises ticks in practice; this lock
# is the backstop for a tick run by hand beside it. A lock left by a tick that died is taken over once
# its pid is gone. Two ticks racing to take over the same dead lock is possible and NOT harmless (both
# would mirror into the same dist/); what prevents it in practice is the workflow's concurrency group,
# and a second tick would usually see the first's deploy-site.sh in its second publisher check.
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  holder=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    # A tick takes minutes. A lock held past an hour of heartbeat silence is wedged (a reused pid,
    # say): go red so somebody looks, rather than skip green forever.
    beat=$(stat -f %m "$STATE/heartbeat" 2>/dev/null || date +%s)
    if [ $(( $(date +%s) - beat )) -gt 3600 ]; then red_once wedged "FAIL: the lock (pid $holder) has been held with no heartbeat for over an hour; remove $LOCK if no tick is running"; fi
    say "skip: another tick (pid $holder) holds the lock"; exit 0
  fi
  # No pid yet: a tick that has just made the lock and not written its pid. Held, unless that was
  # long enough ago that its tick must have died first. A stat that fails reads as just made (held).
  if [ -z "$holder" ] && [ $(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) )) -lt 60 ]; then say "skip: a lock with no pid yet (another tick starting)"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
fi
echo $$ > "$LOCK/pid"
clear_reported wedged   # the lock is ours: a wedged-lock report no longer describes anything (TARGET is still empty here)
trap '[ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"' EXIT   # only a lock this tick holds
trap 'exit 143' TERM INT HUP   # a cancel (TERM/INT/HUP) exits through the EXIT trap, so the lock is always freed
# The heartbeat is written only by a tick that holds the lock, so a wedged lock shows as a stale one.
now > "$STATE/heartbeat"
# A deploy left by a tick that died WITHOUT its EXIT trap (a SIGKILL, a runner's tree kill after bash
# was gone). The deploy runs in its own process group, so it outlives such a kill. deploy.pid holds
# "<pgid> <sha> <leader start time>", written at launch and removed when a tick accounts for the deploy,
# so a file still here means nobody did. The start time is the identity check: a reused pid has another.
if read -r opg osha ostart 2>/dev/null < "$STATE/deploy.pid" && [ -n "$opg" ]; then
  if [ -n "$ostart" ] && [ "$(ps -o lstart= -p "$opg" 2>/dev/null | tr -s ' ' _)" = "$ostart" ]; then
    if [ $(( $(date +%s) - $(stat -f %m "$STATE/deploy.pid") )) -lt 1200 ]; then
      say "skip: the deploy of ${osha:0:9} from an earlier tick (process group $opg) is still running; this tick waits"
      exit 0
    fi
    kill -TERM -- "-$opg" 2>/dev/null; sleep 2; kill -KILL -- "-$opg" 2>/dev/null
    say "stopped the deploy of ${osha:0:9} from an earlier tick (process group $opg), still running past 1200 s"
  fi
  # Unaccounted for: it may have published, so it is a failure (the same reason a killed tick is one).
  printf '%s rc=%s %s\n' "$osha" 137 "$(now)" > "$STATE/last-failure"
  echo "$osha $(( $(TARGET="$osha" count_for "$STATE/failures") + 1 ))" > "$STATE/failures"
  rm -f "$STATE/deploy.pid"
  say "an earlier tick's deploy of ${osha:0:9} ended unaccounted for (its tick was killed outright); recorded as a failure"
fi
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then tail -n 5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

# Bounded: no prompt, and a 120 s wall clock (KOSMOS_AUTODEPLOY_FETCH_MAX_S) (perl's alarm; macOS has no timeout(1)), so a stalled
# transfer or a keychain helper that never answers is a failed fetch, not a tick hung until the runner's
# job timeout (which would be red every tick, past red_once).
# The git runs in its own process group and the whole group is stopped at the limit, so its helpers
# (git-remote-https, a credential helper waiting on the keychain) cannot outlive it.
grouped_timeout() {  # <seconds> <cmd...>: run cmd in its own process group; on expiry TERM then KILL the group, exit 142
  perl -e 'my $t = shift; my $p = fork; defined $p or exit 126; if (!$p) { setpgrp(0, 0); exec @ARGV or exit 127 }
    $SIG{ALRM} = sub { kill "TERM", -$p; sleep 2; kill "KILL", -$p; waitpid($p, 0); exit 142 };
    $SIG{$_} = sub { kill "TERM", -$p; exit 143 } for qw(TERM INT HUP);   # a killed tick takes the git group too
    alarm $t; waitpid($p, 0); my $s = $?; exit(($s & 127) ? 128 + ($s & 127) : $s >> 8)' "$@"
}
FETCH_MAX_S="${KOSMOS_AUTODEPLOY_FETCH_MAX_S:-120}"
case "$FETCH_MAX_S" in ''|*[!0-9]*|0*) FETCH_MAX_S=120 ;; esac
[ "$FETCH_MAX_S" -le 600 ] || FETCH_MAX_S=600
GIT_TERMINAL_PROMPT=0 grouped_timeout "$FETCH_MAX_S" git -C "$SITE" fetch -q origin main 2>>"$LOG" \
  || red_once fetch "FAIL: could not fetch site origin/main in $SITE (failed or timed out)"
clear_reported fetch   # (TARGET is still empty here: the "none" records)
TARGET=$(git -C "$SITE" rev-parse --verify -q origin/main) || { TARGET=""; red_once noref "FAIL: no origin/main in $SITE"; }
_t="$TARGET"; TARGET=""; clear_reported noref; TARGET="$_t"   # recovered: the "none" record goes
LAST=$(cat "$STATE/last-deployed" 2>/dev/null || true)
# Paused by a person (a deliberate site rollback, say): nothing is deployed until the file is removed.
[ -e "$STATE/paused" ] && { say "paused: $STATE/paused exists; nothing is deployed until it is removed"; exit 0; }
# Parked: not deployed again; reported red once (red_once), then each tick says so, until main moves
# or someone removes the file.
[ "$(cat "$STATE/parked" 2>/dev/null || true)" = "$TARGET" ] && red_once parked "FAIL (parked): site main ${TARGET:0:9} ($(cut -d' ' -f2 "$STATE/last-failure" 2>/dev/null | sed 's/^rc=//')); waiting for the next merge (or remove $STATE/parked)"

# What the live site serves: the export marker deploy-site.sh and release.sh ship names the site commit
# it was built from. Empty when it cannot be read, which proves nothing either way.
served=$(curl -fsS --max-time 20 -H 'Cache-Control: no-cache' "$HOST/.kosmos-release-export" 2>/dev/null | sed -n 's/^commit=//p')
if [ "$TARGET" = "$LAST" ]; then
  # Done, unless live has since gone BACK to an older commit of main (a hand deploy from a checkout
  # behind main, say). Only a readable marker naming a strict ancestor of main counts, so an
  # unreadable or unrelated marker never makes a tick redeploy over and over.
  if [ -n "$served" ] && [ "$served" != "$TARGET" ] && git -C "$SITE" merge-base --is-ancestor "$served" "$TARGET" 2>/dev/null; then
    say "live serves ${served:0:9}, behind site main ${TARGET:0:9} which this job deployed; deploying it again"
  else
    exit 0
  fi
fi

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
publisher_running() {
  local procs
  procs=$(sh -c "$PS_CMD" 2>/dev/null) || procs=""
  grep -Eq '^([^ ]*/)?(ba|z)?sh( -[^ ]+)* [^ ]*tools/(release|deploy-site|promote-channel)\.sh( |$)' <<<"$procs"
}
if publisher_running; then
  say "skip: a release cut, deploy or promote is running; main ${TARGET:0:9} waits for the next tick"
  exit 0
fi

# Already live: a cut's step 8 (or a hand-run deploy) published this exact commit. Not when this job's
# own last attempt at it failed: deploy-site.sh can fail AFTER vercel deploy (its served checks), and
# that deploy's marker names the commit too, so "served" would wrongly clear the failure.
if [ "$served" = "$TARGET" ] && [ "$(count_for "$STATE/failures")" = 0 ]; then
  echo "$TARGET" > "$STATE/last-deployed"; rm -f "$STATE/failures" "$STATE/retries" "$STATE/parked"; rm -rf "$REPORTED"
  say "already live: $HOST serves site main ${TARGET:0:9}; nothing to deploy"
  exit 0
fi

# Bring the job's checkout to main. It is nobody else's, so anything that stops a fast-forward
# (a dirty file, a local commit) is a fault to report, not work to save.
br=$(git -C "$SITE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
[ "$br" = main ] || { say "FAIL: $SITE is on '${br:-a detached HEAD}', not main; deploy-site.sh would refuse (parked)"; printf '%s rc=%s %s\n' "$TARGET" checkout "$(now)" > "$STATE/last-failure"; park; exit 1; }
git -C "$SITE" merge -q --ff-only origin/main 2>>"$LOG" || { say "FAIL: could not fast-forward $SITE to ${TARGET:0:9}, dirty or diverged (parked)"; printf '%s rc=%s %s\n' "$TARGET" checkout "$(now)" > "$STATE/last-failure"; park; exit 1; }

# The source must look like a real cut checkout's dist/ before it is mirrored with --delete: none at
# all (a fresh clone, a cleaned or rebuilt cut box), or far fewer than the last good mirror held, would
# delete them here and the deploy would take them off the site. tools/dist-retention.sh prunes a few
# at a time, so MIRROR_DROP_MAX allows that and refuses a collapse.
MIRROR_DROP_MAX=5
# Only versions a release pointer on main has reached are mirrored: the cut box's dist/ can also hold a
# build a cut made and never released (it stopped before 7b), and shipping that at its versioned URL
# would publish an unchecked build. The ceiling is the newer of the versions main's latest.json and
# latest-staging.json name (no pointers at all, as in a bare test tree: no ceiling).
ptr_version() { git -C "$SITE" show "$TARGET:dist/$1" 2>/dev/null | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p'; }
CEIL=$( { ptr_version latest.json; ptr_version latest-staging.json; } | grep . | sort -V | tail -1)
TOO_NEW=()
src_n=0
for _f in "$DIST_FROM"/kosmos-*-arm64.tar.gz; do
  [ -e "$_f" ] || continue
  _v=${_f##*/kosmos-}; _v=${_v%-arm64.tar.gz}
  if [ -n "$CEIL" ] && ! printf '%s\n%s\n' "$_v" "$CEIL" | sort -V -C; then TOO_NEW+=("--exclude=${_f##*/}" "--exclude=${_f##*/}.sha256"); continue; fi
  src_n=$((src_n + 1))
done
prev_n=$(cat "$STATE/mirror-count" 2>/dev/null || true); case "$prev_n" in ''|*[!0-9]*) prev_n=0 ;; esac
if [ -d "$DIST_FROM" ] && { [ "$src_n" = 0 ] || [ "$src_n" -lt $((prev_n - MIRROR_DROP_MAX)) ]; }; then
  say "FAIL: $DIST_FROM holds $src_n versioned tarballs (the last good mirror held $prev_n); mirroring it would take the older downloads off the site (parked). If that drop is a real prune, set $STATE/mirror-count to $src_n and remove $STATE/parked"
  printf '%s rc=%s %s\n' "$TARGET" dist "$(now)" > "$STATE/last-failure"; park; exit 1
fi
# A website deploy never moves a Mac release pointer: that is a cut's step 8 or a promote, which run
# their own checks first. If main's latest.json or latest-staging.json differs from what is live, a
# cut pushed its release commit and did not publish it (aborted between 7b and 8), or a promote was
# committed and not deployed; publishing it here would ship a build nobody checked, because the
# mirror below can supply its tarball. Park and say so. (The Windows pointers are not compared: live
# serves them from R2 through a redirect, never from this tree.)
for _p in latest.json latest-staging.json; do
  _has=1; git -C "$SITE" cat-file -e "$TARGET:dist/$_p" 2>/dev/null || _has=0
  _c=$(git -C "$SITE" show "$TARGET:dist/$_p" 2>/dev/null | shasum -a 256 | cut -c1-64)
  rm -f "$STATE/ptr.tmp"
  case "$HOST" in
    file://*) if [ -f "${HOST#file://}/dist/$_p" ]; then cp "${HOST#file://}/dist/$_p" "$STATE/ptr.tmp"; _lc=200; else _lc=404; fi ;;   # tests
    *) _lc=$(curl -sSL --connect-timeout 10 --max-time 20 -H 'Cache-Control: no-cache' -o "$STATE/ptr.tmp" -w '%{http_code}' "$HOST/dist/$_p" 2>/dev/null) || _lc=000 ;;   # -L, as deploy-site.sh reads them
  esac
  _l=""; [ -f "$STATE/ptr.tmp" ] && _l=$(shasum -a 256 < "$STATE/ptr.tmp" | cut -c1-64); rm -f "$STATE/ptr.tmp"
  if [ "$_lc" = 404 ]; then
    [ "$_has" = 0 ] && continue   # absent on main and live alike
    _lc=200; _l=absent            # on main, not live: a move like any other
  fi
  case "$_lc" in
    200) [ "$_c" = "$_l" ] && continue
         # Retried, not parked: a promote pushes its pointer commit and THEN deploys it, so a tick in
         # between sees exactly this, and the next tick after the deploy finds the commit already live.
         # An aborted cut never catches up: reported red at the RETRY_ALARM-th tick (red_once), then said each tick.
         n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
         printf '%s rc=%s %s\n' "$TARGET" pointer "$(now)" > "$STATE/last-failure"
         _m="site main's dist/$_p is not what live serves, a release pointer move a cut or promote has not published (a website deploy never publishes one); $n in a row"
         [ "$n" -ge "$RETRY_ALARM" ] && red_once pointer "FAIL: $_m"; say "skip: $_m"; exit 0 ;;
    *) n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
       [ "$n" -ge "$RETRY_ALARM" ] && red_once unread "FAIL: could not read the live $_p (HTTP $_lc), $n ticks in a row"
       say "retry: could not read the live $_p (HTTP $_lc); the next tick tries again ($n in a row)"; exit 0 ;;
  esac
done

# Mirror the older versioned Mac downloads (see the header). --delete with these filters removes only
# versioned tarballs and sidecars the source no longer has; every other file in dist/ is left alone.
[ -d "$DIST_FROM" ] || { say "FAIL: no $DIST_FROM to take the older versioned downloads from; deploying without them would take them off the site (parked)"; printf '%s rc=%s %s\n' "$TARGET" dist "$(now)" > "$STATE/last-failure"; park; exit 1; }
# ${arr[@]+...}: bash 3.2 (macOS /bin/bash) calls an empty array unbound under set -u.
[ "${#TOO_NEW[@]}" = 0 ] || say "not mirrored, newer than any release pointer on main ($CEIL): ${TOO_NEW[*]}"
rsync -a --delete ${TOO_NEW[@]+"${TOO_NEW[@]}"} --include='kosmos-*-arm64.tar.gz' --include='kosmos-*-arm64.tar.gz.sha256' --exclude='*' "$DIST_FROM/" "$SITE/dist/" 2>&1 | tee -a "$LOG"
if [ "${PIPESTATUS[0]}" != 0 ]; then
  # Counted with the other retries (not parked: a copy failing says nothing about this sha).
  n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
  [ "$n" -ge "$RETRY_ALARM" ] && red_once mirror "FAIL: could not mirror the versioned downloads from $DIST_FROM, $n ticks in a row"
  say "retry: could not mirror the versioned downloads from $DIST_FROM ($n in a row)"; exit 0
fi
# Every mirrored tarball must match its own .sha256, or it is not deployed. deploy-site.sh checks only
# the current build, and a cut that started after the check above could be writing one right now. A
# mismatch is not a finding about this sha, so it is retried on the next tick, never parked.
MISMATCH=""
for _t in "$SITE"/dist/kosmos-*-arm64.tar.gz; do
  [ -e "$_t" ] || continue
  _want=$(cut -c1-64 "$_t.sha256" 2>/dev/null || true); _have=$(shasum -a 256 "$_t" | cut -c1-64)
  [ -n "$_want" ] && [ "$_want" = "$_have" ] || { MISMATCH="${_t##*/}"; break; }
done
if [ -n "${MISMATCH:-}" ]; then
  # Counted with the exit-75 retries: a cut writing it clears within a tick or two; one that never
  # matches (no sidecar, a corrupt copy at the source) goes red on the 4th tick instead of green forever.
  n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
  [ "$n" -ge "$RETRY_ALARM" ] && red_once checksum "FAIL: the mirrored $MISMATCH has not matched its .sha256 for $n ticks; fix it at $DIST_FROM"
  say "skip: the mirrored $MISMATCH does not match its .sha256 (a cut writing it?); the next tick tries again ($n in a row)"
  exit 0
fi

# Asked again now that the mirror is done: a cut that started while it ran may have been mid-write or
# mid-prune in the source, so the mirror may not be the set to ship. Next tick, then.
if publisher_running; then
  say "skip: a release cut, deploy or promote started during the mirror; main ${TARGET:0:9} waits for the next tick"
  exit 0
fi
now > "$STATE/heartbeat"   # fresh before the long part, so a slow deploy never reads as a wedged lock
say "deploying site main ${TARGET:0:9} (last deployed ${LAST:0:9}); its output is printed when it ends, and kept in $STATE/deploy.out"
# The deploy's output goes to this run's output and the log once it ends; rc is the deploy's own.
# KOSMOS_REPO pins deploy-site.sh's libraries to THIS checkout; without it they load from
# ~/work/agent-workforce, which on Mortals is the cut's checkout, at whatever sha a cut left it.
export KOSMOS_REPO="$REPO"
# The deploy has its own wall-clock limit, well inside the workflow's 30-minute job timeout, so a hung
# deploy is THIS script's to account for (a failure: retried once, then parked) instead of the runner killing
# the job with nothing recorded and the next tick hanging the same way. Measured 2026-10-08: the 0.7.28
# prod promote's deploy-site.sh --promote took 2 min 18 s on Mortals; 15 minutes is about 6 times that.
# The deploy runs in its own process group (set -m), so the limit stops vercel and every other child too,
# not just the subshell.
DEPLOY_MAX_S="${KOSMOS_AUTODEPLOY_DEPLOY_MAX_S:-900}"
case "$DEPLOY_MAX_S" in ''|*[!0-9]*|0*) DEPLOY_MAX_S=900 ;; esac   # 0 kills every deploy at once; a leading 0 reads as octal
[ "$DEPLOY_MAX_S" -le 1200 ] || DEPLOY_MAX_S=1200   # bounds the DEPLOY phase only; 20 min leaves room in the 30-minute job for the fetch, mirror and checks
if [ -n "${KOSMOS_AUTODEPLOY_DEPLOY:-}" ]; then DCMD=(sh -c "$KOSMOS_AUTODEPLOY_DEPLOY"); else DCMD=(bash "$REPO/tools/deploy-site.sh" --publish); fi
DOUT="$STATE/deploy.out"; : > "$DOUT"
dpid=""   # set the moment the deploy starts; the traps below are in place BEFORE it starts

# If this tick is killed (the runner cancels the job, or its timeout), take the deploy group with it,
# so no orphaned deploy keeps publishing beside the next tick.
stop_deploy() {   # TERM the deploy group, give it up to 5 s, then KILL whatever is left (a child that ignores TERM)
  [ -n "$dpid" ] || return 0
  kill -TERM -- "-$dpid" 2>/dev/null
  for _i in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$dpid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$dpid" 2>/dev/null
}
# On the way out of a killed tick: stop the deploy, keep its output (run + log), and RECORD A FAILURE
# (rc 143): the deploy may have published before the kill, so the next tick's "already live" shortcut
# must not bless the sha (the same reason a timeout is a failure). Then free the lock.
# Further signals are ignored first (a runner's cancel sends INT, then TERM seconds later), and the
# failure is recorded BEFORE the slow stop, so a second signal cannot cut the record out.
# The check is on the whole group (kill -0 -pgid): a child still running after its leader exited counts.
# Unlike the deploy-failure path below, a killed tick never parks: the next tick retries, and parks on
# its own failure (the count then reads 2 or more).
killed_tick() {
  trap '' TERM INT HUP
  if [ -n "$dpid" ] && kill -0 -- "-$dpid" 2>/dev/null; then
    printf '%s rc=%s %s\n' "$TARGET" 143 "$(now)" > "$STATE/last-failure"
    echo "$TARGET $(( $(count_for "$STATE/failures") + 1 ))" > "$STATE/failures"
    stop_deploy
  fi
  rm -f "$STATE/deploy.pid"   # accounted for (above, or it had already ended)
  tee -a "$LOG" 2>/dev/null < "$DOUT"
  [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"
}
trap killed_tick EXIT
trap 'exit 143' TERM INT HUP   # (stays for the rest of the tick: exit runs whichever EXIT trap is current)
# </dev/null: under set -m a background job keeps the terminal as stdin, and a read would stop it (SIGTTIN).
set -m; KOSMOS_SITE="$SITE" "${DCMD[@]}" < /dev/null > "$DOUT" 2>&1 & dpid=$!; set +m
# Recorded so a tick killed outright (no EXIT trap) leaves the next tick a way to find this deploy:
# being its own process group, it is out of reach of a kill aimed at this tick's group.
printf '%s %s %s\n' "$dpid" "$TARGET" "$(ps -o lstart= -p "$dpid" 2>/dev/null | tr -s ' ' _)" > "$STATE/deploy.pid"
dstart=$SECONDS   # the clock, not a count of loop turns (turns stretch under load)
while kill -0 "$dpid" 2>/dev/null && [ $((SECONDS - dstart)) -lt "$DEPLOY_MAX_S" ]; do sleep 0.2; done
if kill -0 "$dpid" 2>/dev/null; then
  stop_deploy
  # NOT 75: a deploy can be stopped AFTER vercel deploy has published (its served checks were running), so
  # this is a failure like any other (retried once, then parked), and the "already live" shortcut will not
  # bless the sha while the failure count stands.
  wait "$dpid" 2>/dev/null; rc=124
  timedout=1
else
  wait "$dpid"; rc=$?; timedout=""
  # The leader is done; a child it left running in the group (a backgrounded helper) is not let outlive it.
  if kill -0 -- "-$dpid" 2>/dev/null; then say "the deploy left processes running in its group; stopping them"; stop_deploy; fi
fi
rm -f "$STATE/deploy.pid"
trap '[ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"' EXIT   # the deploy is over: back to the plain trap
# Printed whole once it has ended (not streamed: a live tail could be orphaned by a killed tick, and
# could cut off the last lines). The run and the log get the same complete output.
tee -a "$LOG" < "$DOUT"
[ -n "$timedout" ] && say "the deploy ran past its ${DEPLOY_MAX_S}s limit and was stopped (exit 124, a failure)"
if [ "$rc" = 0 ]; then
  echo "$TARGET" > "$STATE/last-deployed"; rm -f "$STATE/failures" "$STATE/retries" "$STATE/parked"; rm -rf "$REPORTED"
  echo "$src_n" > "$STATE/mirror-count"
  say "deployed site main ${TARGET:0:9}"
  exit 0
fi
# 75: deploy-site.sh found the live site moving (a cut or a staging publish landed mid-run) or could
# not read it. Not a finding about this sha, so it is NOT parked: the next tick tries again.
# From the RETRY_ALARM-th in a row for the same sha the state is reported red once (red_once), so a
# host that stays unreachable never reads green with no report; it keeps retrying.
if [ "$rc" = 75 ]; then
  n=$(( $(count_for "$STATE/retries") + 1 )); echo "$TARGET $n" > "$STATE/retries"
  [ "$n" -ge "$RETRY_ALARM" ] && red_once moving "FAIL: ${TARGET:0:9} has hit a moving or unreadable live site $n ticks in a row; still retrying"
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
