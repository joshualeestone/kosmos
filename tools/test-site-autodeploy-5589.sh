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
export KOSMOS_AUTODEPLOY_DEPLOY='git -C "$KOSMOS_SITE" rev-parse HEAD >> '"$DEPLOYS"'; exit "${DEPLOY_RC:-0}"'
export KOSMOS_AUTODEPLOY_PS="printf %s\\n idle"
tick() { bash "$AD"; RC=$?; }
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
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 3 ]; } && pass "the same failed sha is not retried" || bad "retried a failed sha (deploys=$(ndeploys))"
H4=$(advance four)
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 4 ] && [ "$(cat "$T/state/last-deployed")" = "$H4" ] && [ ! -e "$T/state/last-failure" ]; } \
  && pass "a new merge after a failure deploys and clears the failure" || bad "no retry after main moved (deploys=$(ndeploys))"

# 5) another tick holding the lock: this one does nothing. A lock whose holder is gone is taken over.
H5=$(advance five)
mkdir "$T/state/lock"; sleep 300 & live=$!; echo "$live" > "$T/state/lock/pid"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 4 ]; } && pass "a live lock holder: no deploy" || bad "deployed under a live lock"
kill "$live" 2>/dev/null; wait "$live" 2>/dev/null
tick
{ [ "$(ndeploys)" = 5 ] && [ "$(cat "$T/state/last-deployed")" = "$H5" ] && [ ! -e "$T/state/lock" ]; } \
  && pass "a dead holder's lock is taken over, and the tick removes its own lock" || bad "stale lock (deploys=$(ndeploys))"

# 6) the job's checkout is dirty: no deploy, the failure is recorded.
H6=$(advance six)
echo local-edit >> "$T/site/index.html"
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 5 ] && grep -q "^$H6 rc=checkout " "$T/state/last-failure"; } \
  && pass "a dirty checkout is refused before any deploy and recorded" || bad "dirty checkout (rc=$RC, deploys=$(ndeploys))"
git -C "$T/site" checkout -q -- index.html

# 7) the job's checkout is off main: refused before any deploy (deploy-site.sh would refuse anyway).
H7=$(advance seven)
git -C "$T/site" checkout -q -b feature
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 5 ] && grep -q "is on 'feature', not main" "$T/state/log"; } \
  && pass "a checkout off main is refused before any deploy" || bad "off-main checkout (rc=$RC)"

# 8) no site configured: a usage error, never a deploy.
KOSMOS_AUTODEPLOY_SITE="" bash "$AD" 2>/dev/null; RC=$?
{ [ "$RC" = 2 ] && [ "$(ndeploys)" = 5 ]; } && pass "no KOSMOS_AUTODEPLOY_SITE: exit 2, nothing deployed" || bad "unset site (rc=$RC)"

echo ""
if [ "$fail" = 0 ]; then echo "test-site-autodeploy-5589: ALL PASS"; else echo "test-site-autodeploy-5589: FAILURES above"; exit 1; fi
