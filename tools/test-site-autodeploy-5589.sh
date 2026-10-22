#!/usr/bin/env bash
# #5589: tools/site-autodeploy.sh publishes the site when its main moves, and only then.
# A real git origin and clone in a temp dir; the deploy, the process list, the served marker (a
# file:// URL) and the cut checkout's dist/ are all local, so nothing here reaches Vercel or the
# network. Tests 26, 28 and 32 read this machine's real process table (a leftover fetch helper; deploy
# group identity via ps).
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
# kosmos#6771: every arm below runs with a token, as the job will once it is filed; the token arms at the end unset it.
export VERCEL_TOKEN=test-token-6771
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
printf '%s' "$OUT" | command grep -q "No such file" && bad "a quiet tick printed a missing-file error: $OUT" || pass "a quiet tick prints no error for the state files it has not made yet"

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

# 7b) kosmos#6907: a publisher a TEST started (the shell suite runs the real deploy-site.sh) does not hold the deploy;
# one with no test above it does, and the skip names it. Each arm has its own state and deploy log, so the counts
# the rest of this file reads are untouched.
arm6907() {  # <name> <ps lines...>: one tick on fresh state; leaves OUT, RC and N (deploys it made)
  local name="$1"; shift; local lines="$T/ps6907-$name"; printf '%s\n' "$@" > "$lines"
  KOSMOS_AUTODEPLOY_STATE="$T/state6907-$name" KOSMOS_AUTODEPLOY_PS="cat $lines" \
    KOSMOS_AUTODEPLOY_DEPLOY="echo x >> $T/deploys6907-$name" tick
  N=$(cat "$T/deploys6907-$name" 2>/dev/null | wc -l | tr -d ' ')
}
arm6907 test '  100     1 /bin/bash /Users/x/work/val-pauseall-6781/tools/test-deploy-site-promote.sh' \
  '  150   100 sh -c bash "$REPO/tools/deploy-site.sh" --promote' \
  '  200   150 bash /Users/x/work/val-pauseall-6781/tools/deploy-site.sh --promote'
{ [ "$RC" = 0 ] && [ "$N" = 1 ] && printf '%s' "$OUT" | grep -qF 'not held by pid 200: bash /Users/x/work/val-pauseall-6781/tools/deploy-site.sh --promote (under pid 100: /bin/bash /Users/x/work/val-pauseall-6781/tools/test-deploy-site-promote.sh) (a test started it)'; } \
  && pass "a deploy-site.sh a test-*.sh started (two levels up) does not hold the deploy, and the tick says which test" || bad "a test's deploy-site.sh held the deploy, or was passed over silently (rc=$RC, deploys=$N): $OUT"
arm6907 real '  100     1 -zsh' '  200   100 bash tools/deploy-site.sh --publish'
{ [ "$RC" = 0 ] && [ "$N" = 0 ] && printf '%s' "$OUT" | grep -qF '(pid 200: bash tools/deploy-site.sh --publish)'; } \
  && pass "control: a hand-run deploy-site.sh holds the deploy and the skip names its pid and command" || bad "a hand-run deploy-site.sh did not hold, or was not named (deploys=$N): $OUT"
arm6907 orphan '  200     1 bash /Users/x/work/val-pauseall-6781/tools/deploy-site.sh --promote'
{ [ "$RC" = 0 ] && [ "$N" = 0 ]; } && pass "a test subject whose harness died (ppid 1) still holds the deploy (fails closed)" || bad "an orphaned deploy-site.sh did not hold (deploys=$N)"
arm6907 cut '  100     1 /bin/bash tools/release.sh 0.7.64' '  200   100 bash tools/test-deploy-site-promote.sh' \
  '  300   200 bash /Users/x/work/kosmos/tools/deploy-site.sh --promote'
{ [ "$RC" = 0 ] && [ "$N" = 0 ] && printf '%s' "$OUT" | grep -qF '(pid 100: /bin/bash tools/release.sh 0.7.64)'; } \
  && pass "a cut whose own gate runs a test of deploy-site.sh still holds, named as the cut" || bad "a cut running its tests did not hold or was misnamed (deploys=$N): $OUT"
arm6907 node '  100     1 node --test --test-concurrency=4 tools.release-gate.test.js' \
  '  150   100 /usr/local/bin/node --test-reporter=tap /Users/x/work/k/tools.release-gate.test.js' \
  '  200   150 bash /var/folders/x/T/rg-1/tools/release.sh 0.7.99'
{ [ "$RC" = 0 ] && [ "$N" = 1 ] && printf '%s' "$OUT" | grep -qF 'not held by pid 200: bash /var/folders/x/T/rg-1/tools/release.sh 0.7.99 (under pid 150: '; } \
  && pass "a release.sh the node suite started does not hold the deploy, and the tick says which test" || bad "a node test's release.sh held the deploy, or was passed over silently (rc=$RC, deploys=$N): $OUT"
arm6907 mixed '  100     1 bash tools/test-deploy-site-promote.sh' '  200   100 bash x/tools/deploy-site.sh --promote' \
  '  300     1 -zsh' '  400   300 /bin/bash tools/promote-channel.sh /site --force'
{ [ "$RC" = 0 ] && [ "$N" = 0 ] && printf '%s' "$OUT" | grep -qF 'not held by pid 200:' && printf '%s' "$OUT" | grep -qF '(pid 400: /bin/bash tools/promote-channel.sh /site --force)'; } \
  && pass "a test's deploy-site.sh listed first does not hide a real promote: logged, then held by the promote" || bad "a real promote after a test's deploy-site.sh was missed or misnamed (deploys=$N): $OUT"
arm6907 nodetest '  100     1 node --test' '  200   100 bash /var/folders/x/T/rg-2/tools/release.sh 0.7.99'
{ [ "$RC" = 0 ] && [ "$N" = 1 ]; } && pass "a release.sh directly under a bare node --test does not hold the deploy" || bad "a release.sh under node --test held the deploy (rc=$RC, deploys=$N): $OUT"
arm6907 shellc "  100     1 bash -c tools/test-a.sh && bash tools/deploy-site.sh --publish" '  200   100 bash tools/deploy-site.sh --publish'
{ [ "$RC" = 0 ] && [ "$N" = 0 ] && printf '%s' "$OUT" | grep -qF '(pid 200: bash tools/deploy-site.sh --publish)'; } \
  && pass "a shell that runs a test and then a real publish is not a test: its publish holds" || bad "a real publish under a test-then-publish shell was passed over (deploys=$N): $OUT"
arm6907 nodeflagsfirst "  100     1 node server.js --test" '  200   100 bash tools/release.sh 0.7.99'
{ [ "$RC" = 0 ] && [ "$N" = 0 ]; } && pass "#6912: a release.sh under node server.js --test holds (an argument before --test is not a test runner)" || bad "#6912: node server.js --test exempted a release.sh (deploys=$N): $OUT"
# The runner's real child as measured on this Mac (node 26.8.1), with the two --require pairs tools/run-tests.sh passes, with
# NO matching parent in the list, so this arm proves the child line itself counts as a test.
arm6907 realchild '  150     1 /opt/homebrew/Cellar/node/26.8.1/bin/node --test-concurrency=0 --heap-prof-interval=524288 --stack-trace-limit=10 --report-signal=SIGUSR2 --max-http-header-size=16384 --watch-kill-signal=SIGTERM --heapsnapshot-near-heap-limit=0 --inspect-publish-uid=stderr,http --test-isolation=process --test-coverage-lines=0 --cpu-prof-interval=1000 --test-coverage-functions=0 --require=/x/k/req.js --test-timeout=600000 --inspect-port=127.0.0.1:9229 --test-coverage-branches=0 --use-largepages=off --experimental-addon-modules --network-family-autoselection-attempt-timeout=500 --secure-heap-min=2 --v8-pool-size=4 --secure-heap=0 --tls-cipher-list=TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA --node-snapshot --trace-event-file-pattern=node_trace.${rotation}.log --require /x/k/launch-guard.js --require /x/k/tool-guard.js --test-timeout=600000 /x/k/a.test.js' \
  '  200   150 bash /var/folders/x/T/rg-3/tools/release.sh 0.7.99'
{ [ "$RC" = 0 ] && [ "$N" = 1 ] && printf '%s' "$OUT" | grep -qF 'not held by pid 200: bash /var/folders/x/T/rg-3/tools/release.sh 0.7.99 (under pid 150: '; } \
  && pass "#6912: the node test runner's real child (options, two --require <file> pairs, then the test file) counts as a test on its own" || bad "#6912: the real node test child no longer exempts (deploys=$N): $OUT"
arm6907 titletest '  100     1 node --title=a.test.js server.js' '  200   100 bash tools/release.sh 0.7.99'
{ [ "$RC" = 0 ] && [ "$N" = 0 ]; } && pass "#6912: an option whose value ends .test.js is not a test file" || bad "#6912: node --title=a.test.js exempted a release.sh (deploys=$N)"
arm6907 nodeserver '  100     1 node server.js --port 16180' '  200   100 bash tools/release.sh 0.7.99'
{ [ "$RC" = 0 ] && [ "$N" = 0 ]; } && pass "control: a release.sh under a node process that is not a test still holds" || bad "a release.sh under a plain node process did not hold (deploys=$N)"
arm6907 cycle '  200   300 bash tools/deploy-site.sh --publish' '  300   200 /bin/zsh -l'
{ [ "$RC" = 0 ] && [ "$N" = 0 ] && printf '%s' "$OUT" | grep -qF '(pid 200:'; } && pass "a parent cycle with no test in it ends and holds the deploy" || bad "a parent cycle did not hold (rc=$RC, deploys=$N): $OUT"
realps=$(ps -axo pid=,ppid=,command=); first=${realps%%$'\n'*}
[[ "$first" =~ ^\ *[0-9]+\ +[0-9]+\ . ]] && pass "this machine's ps -axo pid=,ppid=,command= has the pid ppid command shape the matcher reads" || bad "real ps output is not 'pid ppid command': '$first'"
mkdir -p "$T/badawk"; printf '#!/bin/sh\nexit 2\n' > "$T/badawk/awk"; chmod +x "$T/badawk/awk"
PATH="$T/badawk:$PATH" arm6907 awkfail '  100     1 -zsh'
{ [ "$RC" = 0 ] && [ "$N" = 0 ] && printf '%s' "$OUT" | grep -q 'could not be matched'; } \
  && pass "a matcher that fails holds the deploy (fails closed) and says why" || bad "a failing matcher let the deploy through (deploys=$N): $OUT"

# 8) a failed deploy is retried once, then parked; a new merge tries again and clears it.
H7=$(advance seven)
DEPLOY_RC=1 tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 7 ] && [ ! -e "$ST/parked" ] && grep -q "^$H7 rc=1 " "$ST/last-failure" \
  && printf '%s' "$OUT" | grep -q deploy-said-this && printf '%s' "$OUT" | grep -q "retried once"; } \
  && pass "a first failure is red, shows the deploy output, and is not parked" || bad "first failure (rc=$RC) $OUT"
DEPLOY_RC=1 tick
{ [ "$RC" = 1 ] && [ "$(ndeploys)" = 8 ] && [ "$(cat "$ST/parked")" = "$H7" ]; } && pass "a second failure on the same sha parks it" || bad "second failure (rc=$RC, deploys=$(ndeploys))"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = 8 ] && printf '%s' "$OUT" | grep -q "STILL FAILING (reported): parked: site main" && printf '%s' "$OUT" | grep -q "red already reported"; } && pass "a parked sha is not retried; its ticks say why, green after the park's own red (no email storm)" || bad "parked tick (deploys=$(ndeploys)) $OUT"
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
mkdir "$ST/lock"; perl -e 'select(undef, undef, undef, 300)' & live=$!; echo "$live" > "$ST/lock/pid"
tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = "$n10" ] && [ "$(cat "$ST/heartbeat")" = old ]; } && pass "a live lock holder: no deploy, heartbeat untouched" || bad "deployed or beat under a live lock"
# ...and once the lock has been held with no heartbeat for over an hour, it goes red (a wedged lock).
touch -t "$(date -v-2H +%Y%m%d%H%M)" "$ST/heartbeat"
tick
{ [ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q "no heartbeat for over an hour"; } && pass "a lock held with no heartbeat for over an hour goes red" || bad "wedged lock stayed green (rc=$RC)"
tick
{ [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q "STILL FAILING (reported)"; } && pass "the wedged lock's next tick is reported, not red again" || bad "wedged repeat (rc=$RC) $OUT"
kill "$live" 2>/dev/null; wait "$live" 2>/dev/null; live=""   # never signal a recycled pid from the EXIT trap
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
{ [ "$r1" = 1 ] && [ "$r2" = 0 ] && printf '%s' "$OUT" | grep -q "STILL FAILING (reported)"; } \
  && pass "a red reported over a day ago is red again, then green with STILL FAILING" || bad "day-old report (r1=$r1 r2=$r2)"
echo garbage > "$ST/reported.d/$H19-parked"; tick
[ "$RC" = 1 ] && pass "a damaged report time is treated as never reported (red)" || bad "damaged report time (rc=$RC)"
# A leading zero with an 8 or 9 is not a number to bash (octal): it must count as never reported too,
# not abort the tick (which also exits 1, so the record being rewritten is what tells them apart).
echo 0899999999 > "$ST/reported.d/$H19-parked"; tick
rec=$(cat "$ST/reported.d/$H19-parked" 2>/dev/null)
{ [ "$RC" = 1 ] && [ "$rec" != 0899999999 ] && ! printf '%s' "$OUT" | grep -q "value too great"; } && pass "a report time with a leading zero counts as never reported, not an abort" || bad "leading-zero report time (rc=$RC rec=$rec) $OUT"
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

# 21) the origin cannot be fetched: red, then green (reported). A fetch that comes and goes does NOT
#     re-arm its red after each good tick (that would be an email per flap); the record lasts its day.
git -C "$T/site" remote set-url origin "$T/no-such-origin.git"
tick; f1=$RC; tick; f2=$RC
git -C "$T/site" remote set-url origin "$T/origin.git"; tick; f3=$RC
git -C "$T/site" remote set-url origin "$T/no-such-origin.git"; tick; f4=$RC
# ...and once its day is over, the next failure is red again.
echo "$(( $(date +%s) - 90000 ))" > "$ST/reported.d/none-fetch"; tick; f5=$RC
git -C "$T/site" remote set-url origin "$T/origin.git"
{ [ "$f1" = 1 ] && [ "$f2" = 0 ] && [ "$f3" = 0 ] && [ "$f4" = 0 ] && [ "$f5" = 1 ]; } \
  && pass "fetch outage: red, then reported; a flapping fetch stays reported; red again after a day" || bad "fetch sequence $f1$f2$f3$f4$f5 (want 10001)"

# 22) a deploy that hangs is stopped at its limit, with its children. It is a FAILURE (it may have
#     published before hanging), not a retry: red, retried once, then parked; never blessed as live.
H22=$(advance twentytwo); rm -f "$ST/retries" "$ST/failures"
HANGPID="$T/hang.pid"
KOSMOS_AUTODEPLOY_DEPLOY_MAX_S=2 KOSMOS_AUTODEPLOY_DEPLOY='perl -e "select(undef, undef, undef, 300)" & echo $! > '"$HANGPID"'; wait' tick
hp=$(cat "$HANGPID" 2>/dev/null); sleep 1
{ [ "$RC" = 1 ] && [ -n "$hp" ] && ! kill -0 "$hp" 2>/dev/null && grep -q "^$H22 rc=124 " "$ST/last-failure" && [ ! -e "$ST/parked" ] && printf '%s' "$OUT" | grep -q "past its 2s limit"; } \
  && pass "a hung deploy is stopped with its child and counted as a failure (rc 124), not parked yet" || { bad "hung deploy (rc=$RC, child $hp alive=$(kill -0 "$hp" 2>/dev/null && echo yes || echo no)) $OUT"; [ -n "$hp" ] && kill "$hp" 2>/dev/null; }
printf 'kosmos-release-export\ncommit=%s\n' "$H22" > "$SERVED/.kosmos-release-export"   # as if it published, then hung
KOSMOS_AUTODEPLOY_DEPLOY_MAX_S=2 KOSMOS_AUTODEPLOY_DEPLOY='perl -e "select(undef, undef, undef, 300)" & echo $! > '"$HANGPID"'; wait' tick
hp=$(cat "$HANGPID" 2>/dev/null); sleep 1; [ -n "$hp" ] && kill -0 "$hp" 2>/dev/null && kill "$hp"
{ [ "$RC" = 1 ] && [ "$(cat "$ST/parked" 2>/dev/null)" = "$H22" ] && [ "$(cat "$ST/last-deployed")" != "$H22" ]; } \
  && pass "a second hang parks the sha, and a marker naming it does not bless it as deployed" || bad "second hang (rc=$RC, parked=$(cat "$ST/parked" 2>/dev/null))"
rm -f "$ST/parked" "$ST/failures"; rm -rf "$ST/reported.d"

# 23) the tick itself is killed mid-deploy (the runner cancels the job): its deploy group goes with it.
H23=$(advance twentythree); HANG2="$T/hang2.pid"
KOSMOS_AUTODEPLOY_DEPLOY='echo started-23; perl -e "select(undef, undef, undef, 300)" & echo $! > '"$HANG2"'; wait' bash "$AD" > "$T/tick23.out" 2>&1 & tick23=$!
# Signal only once the tick has said it is deploying (its traps are set by then), not on the child alone.
for i in $(seq 1 100); do [ -s "$HANG2" ] && command grep -q "deploying site main" "$T/tick23.out" && break; sleep 0.1; done; sleep 0.3
kill -TERM "$tick23"; wait "$tick23" 2>/dev/null; sleep 1
hp2=$(cat "$HANG2" 2>/dev/null)
{ [ -n "$hp2" ] && ! kill -0 "$hp2" 2>/dev/null && [ ! -e "$ST/lock" ] && command grep -q "^started-23" "$ST/log"; } && pass "a tick killed mid-deploy takes its deploy's children with it, keeps its output in the log, and frees the lock" \
  || { bad "killed tick left its deploy (child $hp2 alive=$(kill -0 "$hp2" 2>/dev/null && echo yes || echo no), lock=$([ -e "$ST/lock" ] && echo held || echo free))"; [ -n "$hp2" ] && kill "$hp2" 2>/dev/null; }
# ...and it recorded a FAILURE (it may have published before the kill), so a marker naming the sha on
# the next tick does not get it recorded as deployed.
{ grep -q "^$H23 rc=143 " "$ST/last-failure" && grep -q "^$H23 1$" "$ST/failures"; } && pass "a killed tick records a failure (rc 143) for its sha" || bad "killed tick recorded no failure: $(cat "$ST/last-failure" "$ST/failures" 2>/dev/null)"
printf 'kosmos-release-export\ncommit=%s\n' "$H23" > "$SERVED/.kosmos-release-export"
KOSMOS_AUTODEPLOY_DEPLOY='exit 1' tick
[ "$(cat "$ST/last-deployed")" != "$H23" ] && pass "after a killed deploy, a marker naming the sha does not bless it" || bad "killed deploy's sha blessed as deployed"
rm -f "$ST/parked" "$ST/failures"; rm -rf "$ST/reported.d"

# 23b) records are per sha: a record for an OLD sha does not quiet the same cause on a new one.
#      The old record is written by the script itself (a real red on the old sha), so the key it uses is the
#      one under test.
H23a=$(advance twentythreea); echo "$H23a" > "$ST/parked"; printf '%s rc=1 x\n' "$H23a" > "$ST/last-failure"; tick; o23=$RC
H23b=$(advance twentythreeb); echo "$H23b" > "$ST/parked"; printf '%s rc=1 x\n' "$H23b" > "$ST/last-failure"; tick
[ "$o23" = 1 ] && [ "$RC" = 1 ] && pass "a record for an older sha does not quiet the same cause on a new sha" || bad "per-sha key (rc=$RC) $OUT"
rm -f "$ST/parked"; rm -rf "$ST/reported.d"

# 23c) a damaged deploy.pid (pgid 0: this tick's own group if signalled) is removed unread, never used.
printf '0 %s x\n' "$H23b" > "$ST/deploy.pid"; touch -t "$(date -v-30M +%Y%m%d%H%M)" "$ST/deploy.pid"
H23c=$(advance twentythreec); tick
{ [ "$RC" = 0 ] && [ ! -e "$ST/deploy.pid" ] && printf '%s' "$OUT" | grep -q "damaged .*deploy.pid" && [ "$(cat "$ST/last-deployed")" = "$H23c" ]; } \
  && pass "a damaged deploy.pid (pgid 0) is removed unread and the tick goes on" || bad "damaged deploy.pid (rc=$RC) $OUT"

# 24) a report time in the future (a clock step, a hand edit) counts as never reported: red.
H24=$(advance twentyfour); mkdir -p "$ST/reported.d"; echo "$H24" > "$ST/parked"; printf '%s rc=1 x\n' "$H24" > "$ST/last-failure"
echo "$(( $(date +%s) + 86400 ))" > "$ST/reported.d/$H24-parked"; tick
[ "$RC" = 1 ] && pass "a future report time counts as never reported (red)" || bad "future report time stayed green (rc=$RC)"
rm -f "$ST/parked"; rm -rf "$ST/reported.d"

# 25) each remaining cause reports under its own name at the alarm: red once, then reported green.
#     (A timeout is a failure, not a retry cause: test 22.)
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
rm -f "$ST/retries"; tick
# wedged re-arm: a wedge reported, the lock freed (a tick takes it), then a NEW wedge is red at once.
mkdir "$ST/lock"; perl -e 'select(undef, undef, undef, 300)' & w1=$!; echo "$w1" > "$ST/lock/pid"; touch -t "$(date -v-2H +%Y%m%d%H%M)" "$ST/heartbeat"
tick; r1=$RC; kill "$w1" 2>/dev/null; wait "$w1" 2>/dev/null
echo 999999 > "$ST/lock/pid"; tick   # takes over the dead lock: the wedge record clears
mkdir "$ST/lock"; perl -e 'select(undef, undef, undef, 300)' & w2=$!; echo "$w2" > "$ST/lock/pid"; touch -t "$(date -v-2H +%Y%m%d%H%M)" "$ST/heartbeat"
tick; r2=$RC; kill "$w2" 2>/dev/null; wait "$w2" 2>/dev/null; rm -rf "$ST/lock"
{ [ "$r1" = 1 ] && [ "$r2" = 1 ]; } && pass "wedged: after the lock is taken again, a new wedge is red at once" || bad "wedged re-arm (r1=$r1 r2=$r2)"

# 26) a fetch that hangs is stopped at its limit with its whole process group, and is red_once fetch.
#     (ext:: runs a command as the remote; the wait's length is unique to this run, so it can be looked
#     for afterwards without counting another run's. kosmos#6730: a perl bounded wait, not `sleep`, so a stray
#     `pkill -f sleep` cannot end the hang early and let this arm pass for the wrong reason. Its code has no
#     spaces, because ext:: splits its command on them.)
Z26="$(( 4000 + $$ % 900 )).$RANDOM$RANDOM"   # a fractional length: no two runs pick the same one
git -C "$T/site" config protocol.ext.allow always
HOLD26="select(undef,undef,undef,$Z26)"
# Anchored at the start of the line, so the grep below never counts its own command line (which holds this text).
# Any path before perl: git runs the remote by the full path it found on PATH (/usr/bin/perl here, a Homebrew or
# CI perl elsewhere), and the control below is started the same way, so it proves the form git produces.
HOLD26RE="^([^ ]*/)?perl -e select\\(undef,undef,undef,${Z26//./\\.}\\)\$"
git -C "$T/site" remote set-url origin "ext::perl -e $HOLD26"
t0=$SECONDS; KOSMOS_AUTODEPLOY_FETCH_MAX_S=2 tick; el=$((SECONDS - t0)); sleep 1
left=$(ps -axo command= | command grep -cE "$HOLD26RE")
git -C "$T/site" remote set-url origin "$T/origin.git"; git -C "$T/site" config --unset protocol.ext.allow
{ [ "$RC" = 1 ] && [ "$el" -lt 10 ] && [ "$left" = 0 ] && printf '%s' "$OUT" | grep -q "could not fetch"; } \
  && pass "a hanging fetch is stopped at its limit, its helpers with it, and reported red" || bad "hanging fetch (rc=$RC, ${el}s, $left left) $OUT"
# (No cleanup kill on a failure: this is a shared user, and a pattern kill reaches other people's
#  processes. A leftover wait ends by itself within 82 minutes.)
tick   # a good tick (the fetch record stays: see test 21)
# Control: the count above can see a leftover (a wait of the same length, started here, is counted).
"$(command -v perl)" -e "$HOLD26" & ctl26=$!; sleep 0.3; seen=$(ps -axo command= | command grep -cE "$HOLD26RE"); kill "$ctl26"; wait "$ctl26" 2>/dev/null
[ "$seen" -ge 1 ] && pass "the leftover count sees a wait of that length (control)" || bad "the leftover count cannot see a wait (it counted $seen)"

# 27) a SECOND signal while a killed tick is stopping a deploy that ignores TERM (a runner's cancel
#     escalates) does not cut the failure record out.
H27=$(advance twentyseven); HANG27="$T/hang27.pid"; rm -f "$ST/failures" "$ST/last-failure"
KOSMOS_AUTODEPLOY_DEPLOY='trap "" TERM; echo started-27; perl -e "select(undef, undef, undef, 300)" & echo $! > '"$HANG27"'; wait' bash "$AD" > "$T/tick27.out" 2>&1 & tick27=$!
for i in $(seq 1 100); do [ -s "$HANG27" ] && command grep -q "deploying site main" "$T/tick27.out" && break; sleep 0.1; done; sleep 0.3
kill -TERM "$tick27"; sleep 1; kill -TERM "$tick27" 2>/dev/null; wait "$tick27" 2>/dev/null; sleep 1
hp27=$(cat "$HANG27" 2>/dev/null)
{ grep -q "^$H27 rc=143 " "$ST/last-failure" 2>/dev/null && [ -n "$hp27" ] && ! kill -0 "$hp27" 2>/dev/null && [ ! -e "$ST/lock" ]; } \
  && pass "a second signal during the stop neither loses the failure record nor leaves the deploy running" \
  || { bad "second signal (last-failure: $(cat "$ST/last-failure" 2>/dev/null); child alive=$(kill -0 "$hp27" 2>/dev/null && echo yes || echo no))"; [ -n "$hp27" ] && kill -KILL "$hp27" 2>/dev/null; }
rm -f "$ST/failures" "$ST/parked"; rm -rf "$ST/reported.d" "$ST/lock"

# 28) a tick killed OUTRIGHT (SIGKILL: no EXIT trap) leaves its deploy running in its own group. The
#     next tick finds it from deploy.pid and waits; once it is past 1200 s it is stopped and counted
#     as a failure (it may have published).
H28=$(advance twentyeight); HANG28="$T/hang28.pid"
KOSMOS_AUTODEPLOY_DEPLOY='perl -e "select(undef, undef, undef, 300)" & echo $! > '"$HANG28"'; wait' bash "$AD" > "$T/tick28.out" 2>&1 & tick28=$!
for i in $(seq 1 100); do [ -s "$HANG28" ] && [ -s "$ST/deploy.pid" ] && break; sleep 0.1; done; sleep 0.3
kill -KILL "$tick28"; wait "$tick28" 2>/dev/null; hp28=$(cat "$HANG28" 2>/dev/null)
n28=$(ndeploys); tick
{ [ "$RC" = 0 ] && [ "$(ndeploys)" = "$n28" ] && kill -0 "$hp28" 2>/dev/null && printf '%s' "$OUT" | grep -q "is still running; this tick waits"; } \
  && pass "an orphaned deploy from a killed tick is found, and the next tick waits for it" || bad "orphan wait (rc=$RC) $OUT"
touch -t "$(date -v-30M +%Y%m%d%H%M)" "$ST/deploy.pid"
printf 'kosmos-release-export\ncommit=%s\n' "$H28" > "$SERVED/.kosmos-release-export"   # as if it published
KOSMOS_AUTODEPLOY_DEPLOY='exit 1' tick; sleep 1
{ ! kill -0 "$hp28" 2>/dev/null && [ ! -e "$ST/deploy.pid" ] && [ "$(cat "$ST/last-deployed")" != "$H28" ] && printf '%s' "$OUT" | grep -q "stopped the deploy of" && printf '%s' "$OUT" | grep -q "recorded as a failure"; } \
  && pass "past 1200 s the orphan is stopped and counted a failure; a marker naming its sha does not bless it" \
  || { bad "orphan stop (alive=$(kill -0 "$hp28" 2>/dev/null && echo yes || echo no)) $OUT"; [ -n "$hp28" ] && kill "$hp28" 2>/dev/null; }
# A pid in deploy.pid whose start time does not match (a reused pid) is not touched.
perl -e 'select(undef, undef, undef, 300)' & other=$!; printf '%s %s %s\n' "$other" "$H28" "Mon_Jan_1_00:00:00_2001" > "$ST/deploy.pid"; touch -t "$(date -v-30M +%Y%m%d%H%M)" "$ST/deploy.pid"
KOSMOS_AUTODEPLOY_DEPLOY='exit 1' tick
kill -0 "$other" 2>/dev/null && pass "a reused pid in deploy.pid (start time differs) is never signalled" || bad "signalled a process that was not the deploy"
kill "$other" 2>/dev/null; wait "$other" 2>/dev/null
rm -f "$ST/failures" "$ST/parked" "$ST/deploy.pid"; rm -rf "$ST/reported.d"

# 29) a deploy whose leader exits leaving a child running in its group: the child is stopped.
H29=$(advance twentynine); HANG29="$T/hang29.pid"
KOSMOS_AUTODEPLOY_DEPLOY='perl -e "select(undef, undef, undef, 300)" & echo $! > '"$HANG29"'; exit 0' tick; sleep 1; hp29=$(cat "$HANG29" 2>/dev/null)
{ [ "$RC" = 0 ] && [ -n "$hp29" ] && ! kill -0 "$hp29" 2>/dev/null && printf '%s' "$OUT" | grep -q "left processes running"; } \
  && pass "a child left running in the deploy's group after it exits is stopped" || { bad "lingering child (rc=$RC alive=$(kill -0 "$hp29" 2>/dev/null && echo yes || echo no)) $OUT"; [ -n "$hp29" ] && kill "$hp29" 2>/dev/null; }

# 30) the green run's ::warning:: annotation is escaped: a % in a path in the message is %25, so it can
#     never be read as a workflow-command escape. (A state folder with a % in its name.)
ST30="$T/st%41te"; mkdir -p "$ST30"; H30=$(git -C "$T/origin.git" rev-parse main)
echo "$H30" > "$ST30/parked"; printf '%s rc=1 x\n' "$H30" > "$ST30/last-failure"
KOSMOS_AUTODEPLOY_STATE="$ST30" tick; a1=$RC; KOSMOS_AUTODEPLOY_STATE="$ST30" tick
ann30=$(printf '%s\n' "$OUT" | command grep '^::warning::')
{ [ "$a1" = 1 ] && [ "$RC" = 0 ] && printf '%s' "$ann30" | command grep -q 'st%2541te' && ! printf '%s' "$ann30" | command grep -q 'st%41te'; } \
  && pass "the ::warning:: annotation escapes % in its message" || bad "annotation not escaped (a1=$a1 rc=$RC): $ann30"

# 31) a deploy limit with a leading zero (or 0) falls back to the default instead of being read as 3 s
#     (or as no time at all): a 4 s deploy under "03" and under "0" succeeds.
H31=$(advance thirtyone)
KOSMOS_AUTODEPLOY_DEPLOY_MAX_S=03 KOSMOS_AUTODEPLOY_DEPLOY='sleep 4; exit 0' tick; l1=$RC
H31b=$(advance thirtyoneb)
KOSMOS_AUTODEPLOY_DEPLOY_MAX_S=0 KOSMOS_AUTODEPLOY_DEPLOY='sleep 4; exit 0' tick; l2=$RC
{ [ "$l1" = 0 ] && [ "$l2" = 0 ] && [ "$(cat "$ST/last-deployed")" = "$H31b" ]; } \
  && pass "a deploy limit of 03 or 0 falls back to the default" || bad "deploy limit fallback (03 -> $l1, 0 -> $l2) $OUT"

# 32) deploy.pid identity. (a) the leader is alive but the file has NO start time: not ours, never
#     signalled. (b) the leader has exited but its group still has a member: ours, stopped and counted.
set -m; perl -e 'select(undef, undef, undef, 300)' & own32=$!; set +m
printf '%s %s \n' "$own32" "$H31b" > "$ST/deploy.pid"; touch -t "$(date -v-30M +%Y%m%d%H%M)" "$ST/deploy.pid"
tick
kill -0 "$own32" 2>/dev/null && pass "a deploy.pid with no start time never signals a live leader" || bad "signalled a leader it could not identify"
kill "$own32" 2>/dev/null; wait "$own32" 2>/dev/null
M32="$T/member32.pid"
set -m; sh -c 'perl -e "select(undef, undef, undef, 300)" & echo $! > '"$M32"'; exit 0' & lead32=$!; set +m; wait "$lead32" 2>/dev/null
for i in $(seq 1 50); do [ -s "$M32" ] && break; sleep 0.1; done; m32=$(cat "$M32")
printf '%s %s Mon_Jan_1_00:00:00_2001\n' "$lead32" "$H31b" > "$ST/deploy.pid"; touch -t "$(date -v-30M +%Y%m%d%H%M)" "$ST/deploy.pid"
tick; sleep 1
{ ! kill -0 "$m32" 2>/dev/null && printf '%s' "$OUT" | grep -q "stopped the deploy of"; } \
  && pass "a deploy group whose leader exited is still found by its members, stopped and counted" \
  || { bad "leaderless group (member alive=$(kill -0 "$m32" 2>/dev/null && echo yes || echo no)) $OUT"; kill "$m32" 2>/dev/null; }
rm -f "$ST/failures" "$ST/parked" "$ST/deploy.pid"; rm -rf "$ST/reported.d"

# 33) a build above the ceiling ALREADY in this dist/ AND still in the source (so the rsync exclude both skips it and protects it from --delete) is
#     removed before the deploy; one at the ceiling stays.
printf 'stale\n' > "$T/site/dist/kosmos-0.7.100-arm64.tar.gz"; printf 'x  y\n' > "$T/site/dist/kosmos-0.7.100-arm64.tar.gz.sha256"
H33=$(advance thirtythree); tick
{ [ "$RC" = 0 ] && [ ! -e "$T/site/dist/kosmos-0.7.100-arm64.tar.gz" ] && [ ! -e "$T/site/dist/kosmos-0.7.100-arm64.tar.gz.sha256" ] && [ -f "$T/site/dist/kosmos-0.7.21-arm64.tar.gz" ] && [ "$(cat "$ST/last-deployed")" = "$H33" ]; } \
  && pass "a too-new build already in this dist/ is removed before the deploy" || bad "too-new build left in dist (rc=$RC): $(ls "$T/site/dist" | tr '\n' ' ')"

# 34) a release pointer on main with no readable version (split across lines) parks instead of
#     mirroring with no ceiling.
cp "$T/work/dist/latest-staging.json" "$T/ptr34.keep"
printf '{\n  "version":\n    "0.7.99"\n}\n' > "$T/work/dist/latest-staging.json"; git -C "$T/work" commit -q -am ptr34; git -C "$T/work" push -q origin main
tick
{ [ "$RC" = 1 ] && [ -e "$ST/parked" ] && printf '%s' "$OUT" | grep -q 'has no "version"'; } && pass "a pointer with no readable version parks instead of mirroring unbounded" || bad "unreadable pointer version (rc=$RC) $OUT"
cp "$T/ptr34.keep" "$T/work/dist/latest-staging.json"; git -C "$T/work" commit -q -am ptr34-back; git -C "$T/work" push -q origin main
tick; rm -f "$ST/parked" "$ST/failures"; rm -rf "$ST/reported.d"

# 35) a process list that cannot be read fails CLOSED: nothing deploys, red once, then reported.
H35=$(advance thirtyfive); n35=$(ndeploys)
KOSMOS_AUTODEPLOY_PS="printf ''" tick; p1=$RC; OUTP=$OUT; KOSMOS_AUTODEPLOY_PS="false" tick; p2=$RC
{ [ "$p1" = 1 ] && [ "$p2" = 0 ] && [ "$(ndeploys)" = "$n35" ] && printf '%s' "$OUTP" | grep -q "could not read the process list"; } \
  && pass "an unreadable process list never deploys: red once, then reported" || bad "unreadable ps (p1=$p1 p2=$p2 deploys $n35 -> $(ndeploys)) $OUTP"
tick; [ "$(cat "$ST/last-deployed")" = "$H35" ] && pass "with the process list readable again, it deploys (control)" || bad "no deploy after ps recovered"

# 6771) the Vercel token. The deploy is not run without one, and the job reads it from the secrets map.
SEC="$T/secrets"; SECLOG="$T/secrets.log"; TOKSEEN="$T/tokseen"
cat > "$SEC" <<EOF
#!/bin/sh
echo "\$*" >> "$SECLOG"
[ -n "\${SEC_TOKEN:-}" ] || exit 1
printf '%s' "\$SEC_TOKEN"
EOF
chmod +x "$SEC"
H6771=$(advance six-seven-seven-one); n0=$(ndeploys)
( unset VERCEL_TOKEN; KOSMOS_AUTODEPLOY_SECRETS="$SEC" tick; echo "$RC" > "$T/rc1"; printf '%s' "$OUT" > "$T/out1"
  KOSMOS_AUTODEPLOY_SECRETS="$SEC" tick; echo "$RC" > "$T/rc2"; printf '%s' "$OUT" > "$T/out2" )
{ [ "$(cat "$T/rc1")" = 1 ] && grep -q "no Vercel token for the deploy (secrets target vercel-chaoskosmos-site" "$T/out1" && [ "$(ndeploys)" = "$n0" ]; } \
  && pass "6771: no token anywhere: red, names the secrets target, nothing deployed" || bad "6771 no token (rc=$(cat "$T/rc1")): $(cat "$T/out1")"
{ [ "$(cat "$T/rc2")" = 0 ] && grep -q "STILL FAILING (reported): no Vercel token" "$T/out2" && [ "$(ndeploys)" = "$n0" ] && [ ! -e "$ST/parked" ]; } \
  && pass "6771: the next tick without a token: green with STILL FAILING, still nothing deployed, never parked" || bad "6771 second tick (rc=$(cat "$T/rc2")): $(cat "$T/out2")"
# A new site merge while the token is still missing stays green the same day (the record is the machine's, not the sha's).
H6771n=$(advance six-seven-seven-one-new)
( unset VERCEL_TOKEN; KOSMOS_AUTODEPLOY_SECRETS="$SEC" tick; echo "$RC" > "$T/rcn"; printf '%s' "$OUT" > "$T/outn" )
{ [ "$(cat "$T/rcn")" = 0 ] && grep -q "STILL FAILING (reported): no Vercel token" "$T/outn"; } \
  && pass "6771: a new merge without the token: still green with STILL FAILING (red once a day, not once a sha)" || bad "6771 new sha re-red (rc=$(cat "$T/rcn")): $(cat "$T/outn")"
grep -qx "value vercel-chaoskosmos-site" "$SECLOG" && pass "6771: the token is asked for by its secrets target, with the value accessor" || bad "6771: secrets asked with: $(cat "$SECLOG" 2>/dev/null)"
( unset VERCEL_TOKEN; SEC_TOKEN=from-the-map KOSMOS_AUTODEPLOY_SECRETS="$SEC" KOSMOS_AUTODEPLOY_DEPLOY='printf %s "$VERCEL_TOKEN" > '"$TOKSEEN"'; git -C "$KOSMOS_SITE" rev-parse HEAD >> '"$DEPLOYS" tick; echo "$RC" > "$T/rc3" )
{ [ "$(cat "$T/rc3")" = 0 ] && [ "$(cat "$TOKSEEN" 2>/dev/null)" = from-the-map ] && [ "$(cat "$ST/last-deployed")" = "$H6771n" ]; } \
  && pass "6771: once the token is filed, the next tick deploys with it in VERCEL_TOKEN" || bad "6771 filed token (rc=$(cat "$T/rc3")): saw '$(cat "$TOKSEEN" 2>/dev/null)'"
H6771b=$(advance six-seven-seven-one-b); : > "$SECLOG"
KOSMOS_AUTODEPLOY_SECRETS="$SEC" KOSMOS_AUTODEPLOY_DEPLOY='printf %s "$VERCEL_TOKEN" > '"$TOKSEEN"'; git -C "$KOSMOS_SITE" rev-parse HEAD >> '"$DEPLOYS" tick
{ [ "$RC" = 0 ] && [ "$(cat "$TOKSEEN")" = test-token-6771 ] && [ ! -s "$SECLOG" ]; } \
  && pass "6771: a token already in the environment wins, and the secrets map is not read" || bad "6771 inherited token (rc=$RC): saw '$(cat "$TOKSEEN")', secrets log '$(cat "$SECLOG")'"

# A lookup that cannot run is said as that, not as a missing token; and the accessor's reason is kept.
H6771c=$(advance six-seven-seven-one-c)
( unset VERCEL_TOKEN; KOSMOS_AUTODEPLOY_SECRETS="$T/no-such-secrets-map" tick; echo "$RC" > "$T/rc4"; printf '%s' "$OUT" > "$T/out4" )
{ [ "$(cat "$T/rc4")" = 1 ] && grep -q "cannot read the Vercel token: $T/no-such-secrets-map is not there or not executable" "$T/out4" && ! grep -q "file a scoped token" "$T/out4"; } \
  && pass "6771: no secrets-map: its own red, not 'file a token'" || bad "6771 no accessor (rc=$(cat "$T/rc4")): $(cat "$T/out4")"
cat > "$T/secrets-why" <<'EOF'
#!/bin/sh
echo "secrets-map: no credential for target '$2' (the map lists none)" >&2; exit 1
EOF
chmod +x "$T/secrets-why"; rm -rf "$ST/reported.d"
( unset VERCEL_TOKEN; KOSMOS_AUTODEPLOY_SECRETS="$T/secrets-why" tick; printf '%s' "$OUT" > "$T/out5" )
grep -q "the accessor said: secrets-map: no credential for target 'vercel-chaoskosmos-site'" "$T/out5" && pass "6771: the accessor's own reason is in the red line" || bad "6771 accessor reason: $(cat "$T/out5")"
# In Actions the token is masked before anything else prints; outside Actions nothing prints it.
( unset VERCEL_TOKEN; GITHUB_ACTIONS=true SEC_TOKEN=mask-me KOSMOS_AUTODEPLOY_SECRETS="$SEC" tick; printf '%s' "$OUT" > "$T/out6" )
grep -qx '::add-mask::mask-me' "$T/out6" && pass "6771: in GitHub Actions the token is masked" || bad "6771 no mask in Actions: $(head -5 "$T/out6")"
H6771d=$(advance six-seven-seven-one-d)
( unset VERCEL_TOKEN GITHUB_ACTIONS; SEC_TOKEN=do-not-print KOSMOS_AUTODEPLOY_SECRETS="$SEC" tick; printf '%s' "$OUT" > "$T/out7" )
! grep -q 'do-not-print' "$T/out7" && [ "$(cat "$ST/last-deployed")" = "$H6771d" ] && pass "6771: outside Actions the token is never printed (and the tick did reach the deploy)" || bad "6771 token printed outside Actions"

# deploy-site.sh's exit 77 (Vercel refused the authorization) is red once, never counted, never parked, so a new token
# deploys on the next tick.
H6771e=$(advance six-seven-seven-one-e); rm -rf "$ST/reported.d"; rm -f "$ST/failures" "$ST/parked"
KOSMOS_AUTODEPLOY_DEPLOY='exit 77' tick; r77a=$RC; o77a=$OUT
KOSMOS_AUTODEPLOY_DEPLOY='exit 77' tick; r77b=$RC; o77b=$OUT
{ [ "$r77a" = 1 ] && printf '%s' "$o77a" | grep -q "Vercel refused this machine's authorization" && [ "$r77b" = 0 ] && printf '%s' "$o77b" | grep -q "STILL FAILING (reported): Vercel refused" && [ ! -e "$ST/parked" ] && [ ! -s "$ST/failures" ]; } \
  && pass "6771: exit 77 twice: red once, then STILL FAILING, no failure counted, not parked" || bad "6771 exit 77 (r=$r77a/$r77b, parked=$(cat "$ST/parked" 2>/dev/null), failures=$(cat "$ST/failures" 2>/dev/null)): $o77b"
tick
[ "$RC" = 0 ] && [ "$(cat "$ST/last-deployed")" = "$H6771e" ] && pass "6771: after the refusals, the next tick with a working deploy deploys (nothing parked it)" || bad "6771 after 77 (rc=$RC): $OUT"

# A token with more than one line is refused, never half-masked.
H6771f=$(advance six-seven-seven-one-f); rm -rf "$ST/reported.d"
( unset VERCEL_TOKEN; SEC_TOKEN="$(printf 'line1\nline2')" KOSMOS_AUTODEPLOY_SECRETS="$SEC" tick; echo "$RC" > "$T/rc8"; printf '%s' "$OUT" > "$T/out8" )
{ [ "$(cat "$T/rc8")" = 1 ] && grep -q "has more than one line" "$T/out8" && ! grep -q 'line2' "$T/out8"; } && pass "6771: a two-line token is refused and not printed" || bad "6771 two-line token (rc=$(cat "$T/rc8")): $(cat "$T/out8")"

# 13) no site configured: a usage error, never a deploy.
nfinal=$(ndeploys); KOSMOS_AUTODEPLOY_SITE="" bash "$AD" 2>/dev/null; RC=$?
{ [ "$RC" = 2 ] && [ "$(ndeploys)" = "$nfinal" ]; } && pass "no KOSMOS_AUTODEPLOY_SITE: exit 2, nothing deployed" || bad "unset site (rc=$RC)"

echo ""
if [ "$fail" = 0 ]; then echo "test-site-autodeploy-5589: ALL PASS"; else echo "test-site-autodeploy-5589: FAILURES above"; exit 1; fi
