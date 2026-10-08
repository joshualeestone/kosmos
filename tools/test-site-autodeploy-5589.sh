#!/usr/bin/env bash
# #5589: tools/site-autodeploy.sh publishes the site when its main moves, and only then.
# A real git origin and clone in a temp dir; the deploy and the process list are seams, so nothing
# here reaches Vercel or reads this machine's processes.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AD="$REPO/tools/site-autodeploy.sh"
T=$(mktemp -d "${TMPDIR:-/tmp}/site-autodeploy-test.XXXXXX"); trap 'rm -rf "$T"' EXIT
fail=0
pass() { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fail=1; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q --bare --initial-branch=main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
echo one > "$T/work/index.html"; git -C "$T/work" add index.html; git -C "$T/work" commit -q -m one; git -C "$T/work" push -q origin main
git clone -q "$T/origin.git" "$T/site"
advance() { echo "$1" > "$T/work/index.html"; git -C "$T/work" commit -q -am "$1"; git -C "$T/work" push -q origin main; git -C "$T/work" rev-parse HEAD; }

# The deploy seam records each call (the sha it saw checked out) and exits with $DEPLOY_RC.
DEPLOYS="$T/deploys"; : > "$DEPLOYS"
export KOSMOS_AUTODEPLOY_SITE="$T/site" KOSMOS_AUTODEPLOY_STATE="$T/state"
export KOSMOS_AUTODEPLOY_DEPLOY='git -C "$KOSMOS_SITE" rev-parse HEAD >> '"$DEPLOYS"'; echo deploy-said-this; exit "${DEPLOY_RC:-0}"'
export KOSMOS_AUTODEPLOY_PS="printf %s\\n idle"
tick() { OUT=$(bash "$AD" 2>&1); RC=$?; }
ndeploys() { wc -l < "$DEPLOYS" | tr -d ' '; }

# 1) first tick: nothing deployed yet, so main is deployed and recorded.
H1=$(git -C "$T/work" rev-parse HEAD)
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 1 ] && [ "$(cat "$T/state/last-deployed")" = "$H1" ] && [ "$(tail -1 "$DEPLOYS")" = "$H1" ]; } \
  && pass "a sha not yet deployed is deployed from that sha and recorded" || bad "first deploy (rc=$RC, deploys=$(ndeploys))"
[ -s "$T/state/heartbeat" ] && pass "every tick writes a heartbeat" || bad "no heartbeat"

# 2) main unchanged: no deploy.
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 1 ]; } && pass "main unchanged: no deploy" || bad "redeployed an unchanged main (deploys=$(ndeploys))"

# 3) a release cut running: skipped, nothing recorded; then deployed once it is gone.
H2=$(advance two)
KOSMOS_AUTODEPLOY_PS="printf %s\\n '/bin/bash tools/release.sh 0.7.28'" tick
R1=$RC; N1=$(ndeploys)
KOSMOS_AUTODEPLOY_PS="printf %s\\n 'bash -x tools/release.sh 0.7.28'" tick
{ [ "$R1" = 0 ] && [ "$N1" = 1 ] && [ "$(ndeploys)" = 1 ]; } && pass "a release.sh started with shell options is still seen as a cut" || bad "bash -x release.sh not seen as a cut (deploys=$(ndeploys))"
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 1 ] && [ "$(cat "$T/state/last-deployed")" = "$H1" ]; } \
  && pass "a running release.sh holds the deploy" || bad "deployed beside a cut (deploys=$(ndeploys))"
KOSMOS_AUTODEPLOY_PS="printf %s\\n 'grep tools/release.sh' 'vim tools/release.sh'" tick
{ [ "$(ndeploys)" = 2 ] && [ "$(cat "$T/state/last-deployed")" = "$H2" ]; } \
  && pass "a grep or an editor naming release.sh is not a cut (control: the deploy goes ahead)" || bad "a mention of release.sh held the deploy (deploys=$(ndeploys))"

# 4) a failed deploy is recorded, not retried for the same sha, and retried when main moves.
H3=$(advance three)
DEPLOY_RC=1 tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 3 ] && grep -q "^$H3 rc=1 " "$T/state/last-failure" && [ "$(cat "$T/state/last-deployed")" = "$H2" ]; } \
  && pass "a failed deploy is recorded as a failure and not as deployed" || bad "failed deploy bookkeeping (rc=$RC)"
{ printf '%s' "$OUT" | grep -q "deploy-said-this" && printf '%s' "$OUT" | grep -q "FAIL: deploy of site main"; } \
  && pass "a failed tick prints the deploy's output and the reason on its own output (what a GitHub run shows)" || bad "failed tick output not shown: $OUT"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 3 ]; } && pass "the same failed sha is not retried" || bad "retried a failed sha (deploys=$(ndeploys))"
H4=$(advance four)
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 4 ] && [ "$(cat "$T/state/last-deployed")" = "$H4" ] && [ ! -e "$T/state/last-failure" ]; } \
  && pass "a new merge after a failure deploys and clears the failure" || bad "no retry after main moved (deploys=$(ndeploys))"

# 4b) exit 75 (deploy-site.sh: the live site moved or could not be read mid-run) is retried, not parked.
H4b=$(advance four-b)
DEPLOY_RC=75 tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 5 ] && [ ! -e "$T/state/last-failure" ] && [ "$(cat "$T/state/last-deployed")" = "$H4" ]; } \
  && pass "exit 75 (live site moved) is not recorded as a failure" || bad "exit 75 bookkeeping (rc=$RC, deploys=$(ndeploys))"
tick
{ [ "$(ndeploys)" = 6 ] && [ "$(cat "$T/state/last-deployed")" = "$H4b" ]; } \
  && pass "the next tick retries the same sha after a 75, and deploys it" || bad "75 not retried (deploys=$(ndeploys))"

# 5) another tick holding the lock: this one does nothing. A lock whose holder is gone is taken over.
H5=$(advance five)
mkdir "$T/state/lock"; sleep 300 & live=$!; echo "$live" > "$T/state/lock/pid"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 6 ]; } && pass "a live lock holder: no deploy" || bad "deployed under a live lock"
kill "$live" 2>/dev/null; wait "$live" 2>/dev/null
tick
{ [ "$(ndeploys)" = 7 ] && [ "$(cat "$T/state/last-deployed")" = "$H5" ] && [ ! -e "$T/state/lock" ]; } \
  && pass "a dead holder's lock is taken over, and the tick removes its own lock" || bad "stale lock (deploys=$(ndeploys))"

# 6) the job's checkout is dirty: no deploy, the failure is recorded.
H6=$(advance six)
echo local-edit >> "$T/site/index.html"
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 7 ] && grep -q "^$H6 rc=checkout " "$T/state/last-failure"; } \
  && pass "a dirty checkout is refused before any deploy and recorded" || bad "dirty checkout (rc=$RC, deploys=$(ndeploys))"
git -C "$T/site" checkout -q -- index.html

# 7) the job's checkout is off main: refused before any deploy (deploy-site.sh would refuse anyway).
H7=$(advance seven)
git -C "$T/site" checkout -q -b feature
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 7 ] && grep -q "is on 'feature', not main" "$T/state/log"; } \
  && pass "a checkout off main is refused before any deploy" || bad "off-main checkout (rc=$RC)"

# 8) no site configured: a usage error, never a deploy.
KOSMOS_AUTODEPLOY_SITE="" bash "$AD" 2>/dev/null; RC=$?
{ [ "$RC" = 2 ] && [ "$(ndeploys)" = 7 ]; } && pass "no KOSMOS_AUTODEPLOY_SITE: exit 2, nothing deployed" || bad "unset site (rc=$RC)"

# --- fresh state for the checks below ------------------------------------------------------------
git -C "$T/site" checkout -q main
export KOSMOS_AUTODEPLOY_STATE="$T/state2"; : > "$DEPLOYS"
REPOENV="$T/repoenv"
export KOSMOS_AUTODEPLOY_DEPLOY='git -C "$KOSMOS_SITE" rev-parse HEAD >> '"$DEPLOYS"'; printf %s "$KOSMOS_REPO" > '"$REPOENV"'; exit "${DEPLOY_RC:-0}"'

# 9) deploy-site.sh's libraries come from THIS checkout: KOSMOS_REPO is this repo, not ~/work/agent-workforce.
tick
{ [ "$RC" = 0 ] && [ "$(cat "$REPOENV")" = "$REPO" ]; } && pass "the deploy runs with KOSMOS_REPO set to this checkout" || bad "KOSMOS_REPO not this checkout ('$(cat "$REPOENV" 2>/dev/null)')"

# 10) a hand-run deploy-site.sh or promote-channel.sh holds the tick, like a cut.
advance ten >/dev/null
n0=$(ndeploys)
KOSMOS_AUTODEPLOY_PS="printf %s\\n 'bash tools/deploy-site.sh --publish'" tick; r1=$RC; n1=$(ndeploys)
KOSMOS_AUTODEPLOY_PS="printf %s\\n '/bin/bash /Users/x/work/agent-workforce/tools/promote-channel.sh /site --force'" tick
{ [ "$r1" = 0 ] && [ "$n1" = "$n0" ] && [ "$(ndeploys)" = "$n0" ]; } && pass "a running deploy-site.sh or promote-channel.sh holds the deploy" || bad "deployed beside a hand-run deploy (deploys=$(ndeploys), was $n0)"

# 11) a moving or unreadable live site (75) four ticks in a row turns the run red once, then keeps retrying.
rcs=""; for i in 1 2 3 4 5; do DEPLOY_RC=75 tick; rcs="$rcs$RC"; done
{ [ "$rcs" = 00010 ] && [ ! -e "$KOSMOS_AUTODEPLOY_STATE/last-failure" ]; } && pass "the 4th consecutive 75 for one sha exits 1 once; it is never parked" || bad "75 alarm sequence was '$rcs' (want 00010)"
tick
{ [ "$RC" = 0 ] && [ ! -e "$KOSMOS_AUTODEPLOY_STATE/retries" ]; } && pass "a success clears the retry count" || bad "retry count not cleared (rc=$RC)"

# 11b) a damaged count file is read as zero, never evaluated: its text cannot run.
advance eleven-b >/dev/null
H11b=$(git -C "$T/work" rev-parse HEAD)
printf '%s %s\n' "$H11b" '$(touch '"$T"'/pwned)x' > "$KOSMOS_AUTODEPLOY_STATE/retries"
DEPLOY_RC=75 tick
{ [ "$RC" = 0 ] && [ ! -e "$T/pwned" ] && [ "$(cat "$KOSMOS_AUTODEPLOY_STATE/retries")" = "$H11b 1" ]; } \
  && pass "a damaged retry count restarts at 1 and its text never runs" || bad "damaged count (rc=$RC, file='$(cat "$KOSMOS_AUTODEPLOY_STATE/retries")')"
tick

# 12) a tick that cannot take the lock writes no heartbeat, so a wedged lock shows as a stale heartbeat;
#     a lock with no pid yet (just made by another tick) is held, not taken over.
advance twelve >/dev/null
echo old > "$KOSMOS_AUTODEPLOY_STATE/heartbeat"
mkdir "$KOSMOS_AUTODEPLOY_STATE/lock"; sleep 300 & live2=$!; echo "$live2" > "$KOSMOS_AUTODEPLOY_STATE/lock/pid"
n0=$(ndeploys); tick
{ [ "$(cat "$KOSMOS_AUTODEPLOY_STATE/heartbeat")" = old ] && [ "$(ndeploys)" = "$n0" ]; } && pass "a tick that finds the lock held leaves the heartbeat alone" || bad "heartbeat refreshed under a held lock"
kill "$live2" 2>/dev/null; wait "$live2" 2>/dev/null
rm -f "$KOSMOS_AUTODEPLOY_STATE/lock/pid"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = "$n0" ] && [ -d "$KOSMOS_AUTODEPLOY_STATE/lock" ]; } && pass "a fresh lock with no pid yet is treated as held" || bad "fresh pid-less lock was taken over (deploys=$(ndeploys))"

echo ""
if [ "$fail" = 0 ]; then echo "test-site-autodeploy-5589: ALL PASS"; else echo "test-site-autodeploy-5589: FAILURES above"; exit 1; fi
