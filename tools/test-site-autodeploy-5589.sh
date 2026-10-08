#!/usr/bin/env bash
# #5589: tools/site-autodeploy.sh publishes the site when its main moves, and only then.
# A real git origin and clone in a temp dir; the deploy, the process list, the served marker (a
# file:// URL) and the cut checkout's dist/ are all local, so nothing here reaches Vercel or the
# network or reads this machine's processes.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AD="$REPO/tools/site-autodeploy.sh"
T=$(mktemp -d "${TMPDIR:-/tmp}/site-autodeploy-test.XXXXXX"); live=""; trap '[ -n "$live" ] && kill "$live" 2>/dev/null; rm -rf "$T"' EXIT
fail=0
pass() { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fail=1; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q --bare --initial-branch=main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
echo one > "$T/work/index.html"; git -C "$T/work" add index.html; git -C "$T/work" commit -q -m one; git -C "$T/work" push -q origin main
git clone -q "$T/origin.git" "$T/site"
mkdir -p "$T/site/dist"
advance() { echo "$1" > "$T/work/index.html"; git -C "$T/work" commit -q -am "$1"; git -C "$T/work" push -q origin main; git -C "$T/work" rev-parse HEAD; }

# The cut checkout's dist/: two older versioned downloads, plus a file the mirror must not touch.
CUTDIST="$T/cutdist"; mkdir -p "$CUTDIST"
for v in 0.7.20 0.7.21; do printf 'tar %s\n' "$v" > "$CUTDIST/kosmos-$v-arm64.tar.gz"; printf '%s  kosmos-%s-arm64.tar.gz\n' "$(shasum -a 256 "$CUTDIST/kosmos-$v-arm64.tar.gz" | cut -c1-64)" "$v" > "$CUTDIST/kosmos-$v-arm64.tar.gz.sha256"; done
printf 'pkg\n' > "$CUTDIST/Kosmos.pkg"
SERVED="$T/served"; mkdir -p "$SERVED"   # file:// stand-in for the live host; no marker yet

# The deploy seam records each call (the sha it saw checked out, and KOSMOS_REPO) and exits with $DEPLOY_RC.
DEPLOYS="$T/deploys"; : > "$DEPLOYS"; REPOENV="$T/repoenv"
export KOSMOS_AUTODEPLOY_SITE="$T/site" KOSMOS_AUTODEPLOY_STATE="$T/state" KOSMOS_AUTODEPLOY_DIST_FROM="$CUTDIST" KOSMOS_SITE_URL="file://$SERVED"
export KOSMOS_AUTODEPLOY_DEPLOY='git -C "$KOSMOS_SITE" rev-parse HEAD >> '"$DEPLOYS"'; printf %s "$KOSMOS_REPO" > '"$REPOENV"'; echo deploy-said-this; exit "${DEPLOY_RC:-0}"'
export KOSMOS_AUTODEPLOY_PS="printf %s\\n idle"
ST="$T/state"
tick() { OUT=$(bash "$AD" 2>&1); RC=$?; }
ndeploys() { wc -l < "$DEPLOYS" | tr -d ' '; }

# 1) first tick: nothing deployed yet, so main is deployed and recorded.
H1=$(git -C "$T/work" rev-parse HEAD)
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 1 ] && [ "$(cat "$ST/last-deployed")" = "$H1" ] && [ "$(tail -1 "$DEPLOYS")" = "$H1" ]; } \
  && pass "a sha not yet deployed is deployed from that sha and recorded" || bad "first deploy (rc=$RC, deploys=$(ndeploys))"
[ -s "$ST/heartbeat" ] && pass "a tick that holds the lock writes a heartbeat" || bad "no heartbeat"
[ "$(cat "$REPOENV")" = "$REPO" ] && pass "the deploy runs with KOSMOS_REPO set to this checkout" || bad "KOSMOS_REPO not this checkout ('$(cat "$REPOENV" 2>/dev/null)')"

# 2) the older versioned downloads are mirrored in before the deploy, and only those.
{ cmp -s "$CUTDIST/kosmos-0.7.20-arm64.tar.gz" "$T/site/dist/kosmos-0.7.20-arm64.tar.gz" && [ -f "$T/site/dist/kosmos-0.7.21-arm64.tar.gz.sha256" ] && [ ! -e "$T/site/dist/Kosmos.pkg" ]; } \
  && pass "older versioned tarballs and sidecars are mirrored from the cut checkout; nothing else is" || bad "mirror content: $(ls "$T/site/dist" | tr '\n' ' ')"

# 3) main unchanged: no deploy.
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 1 ]; } && pass "main unchanged: no deploy" || bad "redeployed an unchanged main (deploys=$(ndeploys))"

# 4) a version pruned in the cut checkout is pruned here too; a non-versioned file here is kept.
H2=$(advance two)
rm "$CUTDIST/kosmos-0.7.20-arm64.tar.gz" "$CUTDIST/kosmos-0.7.20-arm64.tar.gz.sha256"
printf 'alias\n' > "$T/site/dist/kosmos-arm64.tar.gz"
tick
{ [ "$(ndeploys)" = 2 ] && [ ! -e "$T/site/dist/kosmos-0.7.20-arm64.tar.gz" ] && [ -f "$T/site/dist/kosmos-0.7.21-arm64.tar.gz" ] && [ -f "$T/site/dist/kosmos-arm64.tar.gz" ]; } \
  && pass "a pruned version is removed here too, and the unversioned alias is left alone" || bad "mirror prune: $(ls "$T/site/dist" | tr '\n' ' ')"

# 4b) a mirrored tarball that does not match its own .sha256 (a cut part-way through writing it) is
#     not deployed and not parked; once it matches, the next tick deploys.
H2b=$(advance two-b)
cp "$CUTDIST/kosmos-0.7.21-arm64.tar.gz" "$T/good21"; printf 'half-writ' > "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 2 ] && [ ! -e "$ST/parked" ] && printf '%s' "$OUT" | grep -q "does not match its .sha256"; } \
  && pass "a mirrored tarball that fails its checksum holds the deploy, unparked" || bad "checksum mismatch (rc=$RC, deploys=$(ndeploys)) $OUT"
cp "$T/good21" "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"
tick
{ [ "$(ndeploys)" = 3 ] && [ "$(cat "$ST/last-deployed")" = "$H2b" ]; } && pass "once it matches, the next tick deploys (control)" || bad "no deploy after the checksum matched (deploys=$(ndeploys))"

# 4c) a mirrored tarball that NEVER matches its .sha256 goes red on the 4th tick, not green forever.
H2c=$(advance two-c)
printf 'stuck\n' > "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"
rcs=""; for i in 1 2 3 4 5; do tick; rcs="$rcs$RC"; done
{ [ "$rcs" = 00010 ] && [ ! -e "$ST/parked" ] && printf '%s' "$OUT" | grep -q "red already reported"; } && pass "a mirrored tarball that never matches goes red on the 4th tick, then says so green (no email storm), unparked" || bad "checksum alarm sequence '$rcs' (want 00010)"
cp "$T/good21" "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"; tick

# 5) no source for the older downloads: parked before any deploy (deploying would take them off the site).
H3=$(advance three)
KOSMOS_AUTODEPLOY_DIST_FROM="$T/nope" tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 4 ] && [ "$(cat "$ST/parked")" = "$H3" ]; } && pass "a missing source of the older downloads parks the sha with nothing deployed" || bad "missing dist source (rc=$RC, deploys=$(ndeploys))"
rm -f "$ST/parked"

# 5b) a source dist/ that exists but holds no versioned tarballs (a fresh or cleaned cut box), or far
#     fewer than the last good mirror, is refused and parked: mirroring it would take them off the site.
H3b=$(advance three-b)
EMPTYDIST="$T/emptydist"; mkdir -p "$EMPTYDIST"
KOSMOS_AUTODEPLOY_DIST_FROM="$EMPTYDIST" tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 4 ] && [ "$(cat "$ST/parked")" = "$H3b" ] && [ -f "$T/site/dist/kosmos-0.7.21-arm64.tar.gz" ]; } \
  && pass "an empty source dist/ is refused before the mirror deletes anything, and parked" || bad "empty source dist (rc=$RC, deploys=$(ndeploys))"
rm -f "$ST/parked"
echo 12 > "$ST/mirror-count"
H3c=$(advance three-c)
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 4 ] && [ "$(cat "$ST/parked")" = "$H3c" ]; } \
  && pass "a source with far fewer versions than the last good mirror (1 vs 12) is refused" || bad "collapsed source not refused (rc=$RC, deploys=$(ndeploys))"
rm -f "$ST/parked"; echo 1 > "$ST/mirror-count"

# 6) already live: the served export marker names main, so it is recorded with no deploy.
H4=$(advance four)
printf 'kosmos-release-export\ncommit=%s\nexported=x\n' "$H4" > "$SERVED/.kosmos-release-export"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 4 ] && [ "$(cat "$ST/last-deployed")" = "$H4" ]; } && pass "a commit the live site already serves is recorded without a second deploy" || bad "already-live (rc=$RC, deploys=$(ndeploys))"
H5=$(advance five)
tick
{ [ "$(ndeploys)" = 5 ] && [ "$(cat "$ST/last-deployed")" = "$H5" ]; } && pass "a marker naming an older commit does not stop the deploy (control)" || bad "stale marker held the deploy (deploys=$(ndeploys))"

# 7) a running release.sh, deploy-site.sh or promote-channel.sh holds the tick; a mention does not.
H6=$(advance six)
for p in '/bin/bash tools/release.sh 0.7.28' 'bash -x tools/release.sh 0.7.28' 'bash tools/deploy-site.sh --publish' '/bin/bash /Users/x/work/agent-workforce/tools/promote-channel.sh /site --force'; do
  KOSMOS_AUTODEPLOY_PS="printf %s\\n '$p'" tick
  { [ "$RC" = 0 ] && [ "$(ndeploys)" = 5 ]; } && pass "held by: $p" || bad "not held by: $p (deploys=$(ndeploys))"
done
# A busy machine: the cut is the FIRST line of a process list far over a pipe buffer (ps prints
# 130 KB+ on a working Mac). A grep that stops at the first match must not turn into "nothing running".
BIGPS="$T/bigps"; { echo '/bin/bash tools/release.sh 0.7.28'; for i in $(seq 1 3000); do echo "/usr/libexec/some-daemon --flag value-$i padding padding padding padding"; done; } > "$BIGPS"
KOSMOS_AUTODEPLOY_PS="cat $BIGPS" tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 5 ] && [ "$(wc -c < "$BIGPS")" -gt 131072 ]; } && pass "a cut first in a process list over a pipe buffer still holds the deploy" || bad "big process list missed the cut (deploys=$(ndeploys), size=$(wc -c < "$BIGPS"))"
# A cut that starts DURING the mirror: the first look sees nothing, the second (after the mirror) the cut.
PSN="$T/psn"; echo 0 > "$PSN"
cat > "$T/ps-second" <<PS
n=\$(cat "$PSN"); echo \$((n + 1)) > "$PSN"
if [ "\$n" -ge 1 ]; then echo '/bin/bash tools/release.sh 0.7.28'; else echo idle; fi
PS
KOSMOS_AUTODEPLOY_PS="sh $T/ps-second" tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 5 ] && [ "$(cat "$PSN")" = 2 ] && printf '%s' "$OUT" | grep -q "started during the mirror"; } \
  && pass "a cut that starts during the mirror holds the deploy (second look)" || bad "cut started mid-mirror not seen (deploys=$(ndeploys), looks=$(cat "$PSN"))"
KOSMOS_AUTODEPLOY_PS="printf %s\\n 'grep tools/release.sh' 'vim tools/release.sh'" tick
{ [ "$(ndeploys)" = 6 ] && [ "$(cat "$ST/last-deployed")" = "$H6" ]; } \
  && pass "a grep or an editor naming release.sh is not a cut (control: the deploy goes ahead)" || bad "a mention of release.sh held the deploy (deploys=$(ndeploys))"

# 8) a failed deploy is retried once, then parked; a new merge tries again and clears it.
H7=$(advance seven)
DEPLOY_RC=1 tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 7 ] && [ ! -e "$ST/parked" ] && grep -q "^$H7 rc=1 " "$ST/last-failure" \
  && printf '%s' "$OUT" | grep -q deploy-said-this && printf '%s' "$OUT" | grep -q "retried once"; } \
  && pass "a first failure is red, shows the deploy output, and is not parked" || bad "first failure (rc=$RC) $OUT"
DEPLOY_RC=1 tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 8 ] && [ "$(cat "$ST/parked")" = "$H7" ]; } && pass "a second failure on the same sha parks it" || bad "second failure (rc=$RC, deploys=$(ndeploys))"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 8 ] && printf '%s' "$OUT" | grep -q "FAIL (parked): site main" && printf '%s' "$OUT" | grep -q "red already reported"; } && pass "a parked sha is not retried; its ticks say why, green after the park's own red (no email storm)" || bad "parked tick (deploys=$(ndeploys)) $OUT"
H8=$(advance eight)
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 9 ] && [ "$(cat "$ST/last-deployed")" = "$H8" ] && [ ! -e "$ST/failures" ]; } \
  && pass "a new merge after a park deploys and clears the failure count" || bad "no retry after main moved (deploys=$(ndeploys))"

# 9) exit 75 (deploy-site.sh: the live site moved or could not be read) is retried, never parked;
#    the 4th in a row for one sha turns the run red once; a success clears the count.
H9=$(advance nine)
rcs=""; for i in 1 2 3 4 5; do DEPLOY_RC=75 tick; rcs="$rcs$RC"; done
{ [ "$rcs" = 00010 ] && [ ! -e "$ST/parked" ] && [ "$(ndeploys)" = 14 ] && printf '%s' "$OUT" | grep -q "STILL FAILING (reported)"; } && pass "75 is retried every tick; red on the 4th in a row, then green with a note" || bad "75 sequence '$rcs' (want 00010), deploys=$(ndeploys)"
tick
{ [ "$RC" = 0 ] && [ ! -e "$ST/retries" ] && [ "$(cat "$ST/last-deployed")" = "$H9" ]; } && pass "a success after 75s deploys and clears the count" || bad "after 75s (rc=$RC)"

# 10) a damaged count file is read as zero, never evaluated: its text cannot run.
H10=$(advance ten)
printf '%s %s\n' "$H10" '$(touch '"$T"'/pwned)x' > "$ST/retries"
DEPLOY_RC=75 tick
{ [ "$RC" = 0 ] && [ ! -e "$T/pwned" ] && [ "$(cat "$ST/retries")" = "$H10 1" ]; } \
  && pass "a damaged retry count restarts at 1 and its text never runs" || bad "damaged count (rc=$RC, file='$(cat "$ST/retries")')"
tick; n10=$(ndeploys)

# 11) the lock: a live holder means no deploy and no heartbeat; a fresh pid-less lock is held;
#     a dead holder's lock is taken over and the tick removes its own lock.
H11=$(advance eleven)
echo old > "$ST/heartbeat"
mkdir "$ST/lock"; sleep 300 & live=$!; echo "$live" > "$ST/lock/pid"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = "$n10" ] && [ "$(cat "$ST/heartbeat")" = old ]; } && pass "a live lock holder: no deploy, heartbeat untouched" || bad "deployed or beat under a live lock"
# ...and once the lock has been held with no heartbeat for over an hour, it goes red (a wedged lock).
touch -t "$(date -v-2H +%Y%m%d%H%M)" "$ST/heartbeat"
tick
{ [ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q "no heartbeat for over an hour"; } && pass "a lock held with no heartbeat for over an hour goes red" || bad "wedged lock stayed green (rc=$RC)"
tick
{ [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q "STILL FAILING (reported)"; } && pass "the wedged lock's next tick is reported, not red again" || bad "wedged repeat (rc=$RC) $OUT"
kill "$live" 2>/dev/null; wait "$live" 2>/dev/null
rm -f "$ST/lock/pid"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = "$n10" ] && [ -d "$ST/lock" ]; } && pass "a fresh lock with no pid yet is treated as held" || bad "fresh pid-less lock taken over"
echo 999999 > "$ST/lock/pid"
tick
{ [ "$(ndeploys)" = $((n10 + 1)) ] && [ "$(cat "$ST/last-deployed")" = "$H11" ] && [ ! -e "$ST/lock" ]; } \
  && pass "a dead holder's lock is taken over, and the tick removes its own lock" || bad "stale lock (deploys=$(ndeploys))"

# 12) the job's checkout dirty, or off main: parked before any deploy.
H12=$(advance twelve); n12=$(ndeploys)
echo local-edit >> "$T/site/index.html"
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = "$n12" ] && [ "$(cat "$ST/parked")" = "$H12" ]; } && pass "a dirty checkout is parked before any deploy" || bad "dirty checkout (rc=$RC)"
git -C "$T/site" checkout -q -- index.html
H13=$(advance thirteen)
git -C "$T/site" checkout -q -b feature
tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = "$n12" ] && grep -q "is on 'feature', not main" "$ST/log"; } && pass "a checkout off main is parked before any deploy" || bad "off-main checkout (rc=$RC)"

# --- fresh state and checkout for the round-11 checks ----------------------------------------------
git -C "$T/site" checkout -q main
export KOSMOS_AUTODEPLOY_STATE="$T/state3"; ST="$T/state3"
mkdir -p "$SERVED/dist"
tick   # baseline: deploy current main
nb=$(ndeploys)

# 14) a release pointer on main that live does not serve (a cut aborted after pushing it) is parked,
#     never published by a website deploy; with live serving the same bytes (control) it deploys.
mkdir -p "$T/work/dist"; printf '{"version":"0.7.99"}\n' > "$T/work/dist/latest-staging.json"
git -C "$T/work" add dist/latest-staging.json; git -C "$T/work" commit -q -m ptr; git -C "$T/work" push -q origin main
H14=$(git -C "$T/work" rev-parse HEAD)
rcs=""; for i in 1 2 3 4 5; do tick; rcs="$rcs$RC"; done
{ [ "$rcs" = 00010 ] && [ "$(ndeploys)" = "$nb" ] && [ ! -e "$ST/parked" ] && printf '%s' "$OUT" | grep -q "release pointer move"; } \
  && pass "a release pointer on main that live does not serve is never published; red on the 4th tick, not parked" || bad "pointer move (rcs=$rcs, deploys=$(ndeploys)) $OUT"
cp "$T/work/dist/latest-staging.json" "$SERVED/dist/latest-staging.json"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = $((nb + 1)) ]; } && pass "once live serves the same pointer bytes (a promote's deploy landed), it clears itself and deploys" || bad "equal pointer held the deploy (rc=$RC)"

# 15) a deploy that failed AFTER publishing (its served checks), whose marker now names main: the
#     "already live" shortcut does not clear it; it is retried.
H15=$(advance fifteen)
DEPLOY_RC=1 tick
printf 'kosmos-release-export\ncommit=%s\n' "$H15" > "$SERVED/.kosmos-release-export"
n15=$(ndeploys); tick
{ [ "$(ndeploys)" = $((n15 + 1)) ] && [ "$(cat "$ST/last-deployed")" = "$H15" ]; } \
  && pass "a failed attempt is retried even when the marker already names main" || bad "marker cleared a failed deploy (deploys=$(ndeploys))"

# 16) main already deployed by this job, but live has gone back to an older commit of main: redeploy.
#     A marker naming a commit that is not an ancestor of main does not cause a redeploy (control).
printf 'kosmos-release-export\ncommit=%s\n' "$H14" > "$SERVED/.kosmos-release-export"
n16=$(ndeploys); tick
{ [ "$(ndeploys)" = $((n16 + 1)) ] && printf '%s' "$OUT" | grep -q "behind site main"; } \
  && pass "live gone back to an older commit of main is redeployed" || bad "regressed live not healed (deploys=$(ndeploys)) $OUT"
printf 'kosmos-release-export\ncommit=%s\n' "0123456789abcdef0123456789abcdef01234567" > "$SERVED/.kosmos-release-export"
n16=$(ndeploys); tick; tick
[ "$(ndeploys)" = "$n16" ] && pass "an unrelated marker does not cause a redeploy (control)" || bad "unrelated marker redeployed (deploys=$(ndeploys))"

# 17) a person's pause file stops the job (green, says so); removing it resumes.
H17=$(advance seventeen); touch "$ST/paused"; n17=$(ndeploys); tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = "$n17" ] && printf '%s' "$OUT" | grep -q "paused:"; } && pass "a paused job deploys nothing and says so" || bad "pause ignored (deploys=$(ndeploys))"
rm -f "$ST/paused"; tick
[ "$(ndeploys)" = $((n17 + 1)) ] && pass "removing the pause file resumes (control)" || bad "no deploy after unpause"

# 18) a build newer than every release pointer on main (a cut that stopped before 7b) is not mirrored;
#     versions at or below the newest pointer are.
printf 'tar 0.7.100\n' > "$CUTDIST/kosmos-0.7.100-arm64.tar.gz"; printf '%s  x\n' "$(shasum -a 256 "$CUTDIST/kosmos-0.7.100-arm64.tar.gz" | cut -c1-64)" > "$CUTDIST/kosmos-0.7.100-arm64.tar.gz.sha256"
H18=$(advance eighteen); tick
{ [ ! -e "$T/site/dist/kosmos-0.7.100-arm64.tar.gz" ] && [ -f "$T/site/dist/kosmos-0.7.21-arm64.tar.gz" ] && printf '%s' "$OUT" | grep -q "newer than any release pointer"; } \
  && pass "a build newer than every release pointer on main (0.7.100 > 0.7.99) is not mirrored; 0.7.21 is" || bad "unreleased build mirrored: $(ls "$T/site/dist" | tr '\n' ' ')"

# 19) red once per sha and cause per DAY, one record per sha and cause (reported.d/<sha>-<cause>).
H19=$(advance nineteen)
mkdir -p "$ST/reported.d"
echo "$H19" > "$ST/parked"; printf '%s rc=1 x\n' "$H19" > "$ST/last-failure"
echo "$(( $(date +%s) - 90000 ))" > "$ST/reported.d/$H19-parked"
tick; r1=$RC; tick; r2=$RC
{ [ "$r1" = 1 ] && [ "$r2" = 0 ] && printf '%s' "$OUT" | grep -q "^.*STILL FAILING (reported)"; } \
  && pass "a red reported over a day ago is red again, then green with STILL FAILING" || bad "day-old report (r1=$r1 r2=$r2)"
echo garbage > "$ST/reported.d/$H19-parked"; tick
[ "$RC" = 1 ] && pass "a damaged report time is treated as never reported (red)" || bad "damaged report time (rc=$RC)"
rm -f "$ST/parked"; rm -rf "$ST/reported.d"

# 20) two causes taking turns on one sha (a checksum mismatch, then the live site moving, then again):
#     each is red once, after which neither re-arms the other (one record per cause, not one slot).
H20=$(advance twenty)
echo "$H20 9" > "$ST/retries"
seq20=""
printf 'bad\n' > "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"; tick; seq20="$seq20$RC"
cp "$T/good21" "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"; DEPLOY_RC=75 tick; seq20="$seq20$RC"
printf 'bad\n' > "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"; tick; seq20="$seq20$RC"
cp "$T/good21" "$CUTDIST/kosmos-0.7.21-arm64.tar.gz"; DEPLOY_RC=75 tick; seq20="$seq20$RC"
[ "$seq20" = 1100 ] && pass "alternating causes on one sha: each red once, then both quiet" || bad "alternating causes sequence '$seq20' (want 1100)"
tick; rm -f "$ST/retries"
[ ! -d "$ST/reported.d" ] && pass "a successful deploy clears every report" || bad "reports survived a deploy: $(ls "$ST/reported.d")"

# 21) the origin cannot be fetched: red, then green (reported); after it recovers, a NEW outage is red at once.
git -C "$T/site" remote set-url origin "$T/no-such-origin.git"
tick; f1=$RC; tick; f2=$RC
git -C "$T/site" remote set-url origin "$T/origin.git"; tick; f3=$RC
git -C "$T/site" remote set-url origin "$T/no-such-origin.git"; tick; f4=$RC
git -C "$T/site" remote set-url origin "$T/origin.git"
{ [ "$f1" = 1 ] && [ "$f2" = 0 ] && [ "$f3" = 0 ] && [ "$f4" = 1 ]; } \
  && pass "fetch outage: red, then reported; a new outage after recovery is red again" || bad "fetch sequence $f1$f2$f3$f4 (want 1001)"

# 22) a deploy that hangs is stopped at its limit, with its children, and counted as a retry (not a park).
H22=$(advance twentytwo); rm -f "$ST/retries"
HANGPID="$T/hang.pid"
KOSMOS_AUTODEPLOY_DEPLOY_MAX_S=2 KOSMOS_AUTODEPLOY_DEPLOY='sleep 300 & echo $! > '"$HANGPID"'; wait' tick
hp=$(cat "$HANGPID" 2>/dev/null); sleep 1
{ [ "$RC" = 0 ] && [ -n "$hp" ] && ! kill -0 "$hp" 2>/dev/null && grep -q "^$H22 1$" "$ST/retries" && [ ! -e "$ST/parked" ] && printf '%s' "$OUT" | grep -q "past its 2s limit"; } \
  && pass "a hung deploy is stopped at its limit with its child, counted as a retry, not parked" || { bad "hung deploy (rc=$RC, child $hp alive=$(kill -0 "$hp" 2>/dev/null && echo yes || echo no), retries=$(cat "$ST/retries" 2>/dev/null)) $OUT"; [ -n "$hp" ] && kill "$hp" 2>/dev/null; }
rm -f "$ST/retries"

# 23) the tick itself is killed mid-deploy (the runner cancels the job): its deploy group goes with it.
H23=$(advance twentythree); HANG2="$T/hang2.pid"
KOSMOS_AUTODEPLOY_DEPLOY='sleep 300 & echo $! > '"$HANG2"'; wait' bash "$AD" > "$T/tick23.out" 2>&1 & tick23=$!
for i in $(seq 1 50); do [ -s "$HANG2" ] && break; sleep 0.1; done
kill -TERM "$tick23"; wait "$tick23" 2>/dev/null; sleep 1
hp2=$(cat "$HANG2" 2>/dev/null)
{ [ -n "$hp2" ] && ! kill -0 "$hp2" 2>/dev/null && [ ! -e "$ST/lock" ]; } && pass "a tick killed mid-deploy takes its deploy's children with it and frees the lock" \
  || { bad "killed tick left its deploy (child $hp2 alive=$(kill -0 "$hp2" 2>/dev/null && echo yes || echo no), lock=$([ -e "$ST/lock" ] && echo held || echo free))"; [ -n "$hp2" ] && kill "$hp2" 2>/dev/null; }

# 24) a report time in the future (a clock step, a hand edit) counts as never reported: red.
H24=$(advance twentyfour); mkdir -p "$ST/reported.d"; echo "$H24" > "$ST/parked"; printf '%s rc=1 x\n' "$H24" > "$ST/last-failure"
echo "$(( $(date +%s) + 86400 ))" > "$ST/reported.d/$H24-parked"; tick
[ "$RC" = 1 ] && pass "a future report time counts as never reported (red)" || bad "future report time stayed green (rc=$RC)"
rm -f "$ST/parked"; rm -rf "$ST/reported.d"

# 25) each remaining cause reports under its own name at the alarm: red once, then reported green.
#     (noref is not reproduced: a fetch of main always restores origin/main in a real clone.)
H25=$(advance twentyfive)
# unread: the live pointers cannot be read at all (nothing listens on port 9).
echo "$H25 9" > "$ST/retries"
KOSMOS_SITE_URL=http://127.0.0.1:9 tick; u1=$RC; OUTU=$OUT; KOSMOS_SITE_URL=http://127.0.0.1:9 tick; u2=$RC
{ [ "$u1" = 1 ] && [ "$u2" = 0 ] && printf '%s' "$OUTU" | grep -q "could not read the live latest.json" && [ -e "$ST/reported.d/$H25-unread" ]; } \
  && pass "unread: red once at the alarm under its own cause, then reported" || bad "unread cause (u1=$u1 u2=$u2) $OUTU"
# mirror: the copy into the job's dist/ fails.
printf 'tar 0.7.22\n' > "$CUTDIST/kosmos-0.7.22-arm64.tar.gz"   # something new to copy (below the 0.7.99 ceiling)
printf '%s  x\n' "$(shasum -a 256 "$CUTDIST/kosmos-0.7.22-arm64.tar.gz" | cut -c1-64)" > "$CUTDIST/kosmos-0.7.22-arm64.tar.gz.sha256"
# (A read-only destination does not do it: rsync -a resets the folder's mode from the source first.)
chmod 000 "$CUTDIST/kosmos-0.7.22-arm64.tar.gz"   # unreadable at the source: the copy fails
echo "$H25 9" > "$ST/retries"
tick; c1=$RC; OUTC=$OUT; tick; c2=$RC; chmod 644 "$CUTDIST/kosmos-0.7.22-arm64.tar.gz"
rm -f "$CUTDIST/kosmos-0.7.22-arm64.tar.gz" "$CUTDIST/kosmos-0.7.22-arm64.tar.gz.sha256"
{ [ "$c1" = 1 ] && [ "$c2" = 0 ] && printf '%s' "$OUTC" | grep -q "could not mirror" && [ -e "$ST/reported.d/$H25-mirror" ]; } \
  && pass "mirror: red once at the alarm under its own cause, then reported" || bad "mirror cause (c1=$c1 c2=$c2) $OUTC"
# timeout: a deploy that hangs at the alarm reports as a timeout, not as a moving site.
H25b=$(advance twentyfive-b); echo "$H25b 3" > "$ST/retries"; HANG3="$T/hang3.pid"
KOSMOS_AUTODEPLOY_DEPLOY_MAX_S=1 KOSMOS_AUTODEPLOY_DEPLOY='sleep 300 & echo $! > '"$HANG3"'; wait' tick
{ [ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q "run past its 1s limit 4 ticks" && ! printf '%s' "$OUT" | grep -q "moving or unreadable" && [ -e "$ST/reported.d/$H25b-timeout" ]; } \
  && pass "timeout: at the alarm it is red as a timeout, not as a moving site" || bad "timeout cause (rc=$RC) $OUT"
hp3=$(cat "$HANG3" 2>/dev/null); [ -n "$hp3" ] && kill -0 "$hp3" 2>/dev/null && { bad "timeout left its child $hp3"; kill "$hp3"; }
rm -f "$ST/retries"; tick
# wedged re-arm: a wedge reported, the lock freed (a tick takes it), then a NEW wedge is red at once.
mkdir "$ST/lock"; sleep 300 & w1=$!; echo "$w1" > "$ST/lock/pid"; touch -t "$(date -v-2H +%Y%m%d%H%M)" "$ST/heartbeat"
tick; r1=$RC; kill "$w1" 2>/dev/null; wait "$w1" 2>/dev/null
echo 999999 > "$ST/lock/pid"; tick   # takes over the dead lock: the wedge record clears
mkdir "$ST/lock"; sleep 300 & w2=$!; echo "$w2" > "$ST/lock/pid"; touch -t "$(date -v-2H +%Y%m%d%H%M)" "$ST/heartbeat"
tick; r2=$RC; kill "$w2" 2>/dev/null; wait "$w2" 2>/dev/null; rm -rf "$ST/lock"
{ [ "$r1" = 1 ] && [ "$r2" = 1 ]; } && pass "wedged: after the lock is taken again, a new wedge is red at once" || bad "wedged re-arm (r1=$r1 r2=$r2)"

# 13) no site configured: a usage error, never a deploy.
nfinal=$(ndeploys); KOSMOS_AUTODEPLOY_SITE="" bash "$AD" 2>/dev/null; RC=$?
{ [ "$RC" = 2 ] && [ "$(ndeploys)" = "$nfinal" ]; } && pass "no KOSMOS_AUTODEPLOY_SITE: exit 2, nothing deployed" || bad "unset site (rc=$RC)"

echo ""
if [ "$fail" = 0 ]; then echo "test-site-autodeploy-5589: ALL PASS"; else echo "test-site-autodeploy-5589: FAILURES above"; exit 1; fi
