#!/bin/bash
# #4977: tools/queued-heavy.sh, the queue wrapper every heavy one-off on a fleet Mac runs through, pinned by a test that
# CI runs (it used to live only in ~/.cache, covered by a dry harness run by hand). Seeded from PigeonPete's #4911 dry
# harness (74 arms). Every run of the wrapper goes through a shim that REFUSES unless KOSMOS_RUN_MARKER_DIR is inside
# this test's own temp dir: a reviewer's sandbox once lost that variable and three copies waited in the real queue.
# Processes this test starts are stopped by exact match on a sleep length unique to this run (never a broad pattern).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
U=$((50000 + ($$ % 9000) * 10))   # sleep lengths U+1..U+9 belong to this run alone (copies differ in pid, so by >= 10)
REAL_QH="$HERE/queued-heavy.sh"
S=$(mktemp -d); mkdir -p $S/m
BG=""   # every background wrapper this test starts, stopped by pid on exit
trap 'for p in $BG ${H:-}; do kill $p 2>/dev/null; done; for n in 1 2 3 4 5 6 7 8 9; do for p in $(pgrep -f "^sleep $((U+n))$"); do kill $p 2>/dev/null; done; done; rm -rf "${S:?}"' EXIT
# Review 1: the queue's own settings from the shell that runs this must not change the outcome (as test-light-side-4911).
KOSMOS_WAIT_CONTROL_VARS="$(bash -c '. "$1" && printf %s "${KOSMOS_WAIT_CONTROL_VARS:-}"' _ "$HERE/lib/cut-guard.sh")"
unset $KOSMOS_WAIT_CONTROL_VARS KOSMOS_SIDE_LANE KOSMOS_SIDE_MAX_LOAD KOSMOS_SIDE_MIN_HOLD_S KOSMOS_LIGHT_SIDE_COOKIE \
  KOSMOS_MACHINE_CLAIM_COOKIE KOSMOS_QUEUE_CLASS KOSMOS_QUEUE_STARVE_S KOSMOS_NO_WAIT KOSMOS_WAIT_MAX_S KOSMOS_SIDE_AWARE \
  QUEUED_HEAVY_SIDE_MIN QUEUED_HEAVY_SIDE_POLL_S QUEUED_HEAVY_RENEW_SEC QUEUED_HEAVY_MAX_RENEWALS 2>/dev/null
QH_DEADLINE="${QH_DEADLINE:-240}"   # review 1: no wrapper run in this test outlives this; a hang reads BAD, never a stuck job
# The shim: the only way this test runs the wrapper.
cat > $S/qh <<SHIM
#!/bin/bash
case "\${KOSMOS_RUN_MARKER_DIR:-}" in
  "$S"/*) exec perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash "$REAL_QH" "\$@" ;;
  *) echo "TEST-REFUSED: KOSMOS_RUN_MARKER_DIR (\${KOSMOS_RUN_MARKER_DIR:-unset}) is not this test's private dir" >&2; exit 99 ;;
esac
SHIM
chmod +x $S/qh
QH=$S/qh
# Fake package managers first on PATH: the test cases spell real `yarn test` commands, and none may ever reach the
# real suite (a stray one joined the real queue once, from an unquoted heredoc that built the harness).
mkdir -p $S/bin; for t in yarn npm pnpm bun deno npm-run-all run-s run-p node npx; do printf '#!/bin/sh\necho "FAKE-%s $*"\n' "$t" > $S/bin/$t; chmod +x $S/bin/$t; done
export PATH="$S/bin:$PATH"
printf '#!/bin/sh\nexit 1\n' > $S/quiet; printf '#!/bin/sh\necho "2.0 10"\n' > $S/load; chmod +x $S/quiet $S/load
# The guards are this tree's own (tools/lib/cut-guard.sh beside this file), so the test pins the pair as committed.
export KOSMOS_RUN_MARKER_DIR=$S/m QUEUED_HEAVY_LIB=$ROOT KOSMOS_CUT_PROBE=$S/quiet KOSMOS_HARNESS_PROBE=$S/quiet \
  KOSMOS_BC_PROBE=$S/quiet KOSMOS_SUITE_PROBE=$S/quiet KOSMOS_PW_PROBE=$S/quiet KOSMOS_LOAD_PROBE=$S/load KOSMOS_WAIT_EVERY_S=1
oks=0; bads=0
sleep $((U+9)) & H=$!; NOW=$(date +%s)   # the fake heavy holder: lives as long as this test (review 1: was a 15-min fuse)
hold() { printf '%s-%s-1 %s %s host queued run (not a cut): fake heavy\n' $H $((NOW-300)) $H $((NOW+1800)) > $S/m/machine-claim; }
ok() { if eval "$2"; then echo "OK   $1"; oks=$((oks+1)); else echo "BAD  $1"; bads=$((bads+1)); printf '%s\n' "${o:-}" | tail -6 | sed 's/^/      | /'; fi; }
# until_true <seconds> <condition>: poll instead of a fixed sleep (review 1); returns 1 at the deadline.
until_true() { local end=$(( $(date +%s) + $1 )); while ! eval "$2"; do [ "$(date +%s)" -ge "$end" ] && return 1; sleep 0.3; done; return 0; }
gone() { ! pgrep -f "^sleep $1$" >/dev/null; }
hold
o=$(/bin/bash $QH --light "a" sh -c 'cut -d" " -f4- $KOSMOS_RUN_MARKER_DIR/light-side-claim' 2>&1)
o2=$(cd /tmp && QUEUED_HEAVY_LIB=$QUEUED_HEAVY_LIB KOSMOS_RUN_MARKER_DIR=$S/mlab /bin/bash $QH "lab" sh -c 'cat $KOSMOS_RUN_MARKER_DIR/machine-claim; echo "CL=${KOSMOS_CLAIM_LABEL:-unset}"' 2>&1)
o4=$(cd /tmp && KOSMOS_RUN_MARKER_DIR=$S/mrel QUEUED_HEAVY_RENEW_SEC=1 /bin/bash $QH "rel" bash -c '. "$1"; V=0.9.99 kosmos_claim_machine 30; sleep 3; cat $KOSMOS_RUN_MARKER_DIR/machine-claim' _ "$QUEUED_HEAVY_LIB/tools/lib/cut-guard.sh" 2>&1)
# Review 12: a queued-heavy run nested inside a main turn runs under it and leaves the outer claim in place.
o5=$(cd /tmp && KOSMOS_RUN_MARKER_DIR=$S/mnest /bin/bash $QH "outer" bash -c "/bin/bash $QH inner true; [ -e $S/mnest/machine-claim ] && echo OUTER-CLAIM-KEPT || echo OUTER-CLAIM-GONE" 2>&1)
ok "a nested run leaves the outer turn's claim in place" '[[ "$o5" == *"inside the turn that already holds the box"* && "$o5" == *OUTER-CLAIM-KEPT* ]]'
o6=$(cd /tmp && KOSMOS_RUN_MARKER_DIR=$S/mstale KOSMOS_MACHINE_CLAIM_COOKIE=stale-cookie /bin/bash $QH "stale" true 2>&1)
ok "an inherited cookie whose claim is gone takes an ordinary turn" '[[ "$o6" == *"TURN: running stale"* && "$o6" == *"END rc=0"* ]]'
ok "a cut that relabels its turn's claim keeps that label through the turn's renewals" '[[ "$o4" == *"release 0.9.99"* && "$o4" != *"queued run (not a cut): rel"* ]]'
ok "an ordinary turn's claim is labelled a queued run, not a release, and the command does not inherit the label" '[[ "$o2" == *"queued run (not a cut): lab"* && "$o2" != *"release (not a cut)"* && "$o2" == *"CL=unset"* ]]'
hold
o3=$(printf 'echo FROM-STDIN
' | /bin/bash $QH --light "stdin" sh 2>&1)
ok "a side turn keeps the command's stdin" '[[ "$o3" == *"SIDE TURN"* && "$o3" == *FROM-STDIN* ]]'
ok "no bash trap warnings on a side turn" '[[ "$o3" != *run_pending_traps* && "$o3" != *"resending 15"* ]]'
ok "side turn runs beside a heavy holder and releases" '[[ "$o" == *"SIDE TURN"* && "$o" == *"END rc=0"* && ! -e $S/m/light-side-claim ]]'
/bin/bash $QH --light "b-side" sleep 6 > $S/b.log 2>&1 & B=$!; BG="$BG $B"; until_true 30 '[ -e $S/m/light-side-claim ]'; rm -f $S/m/machine-claim
o=$(KOSMOS_NO_WAIT=1 /bin/bash $QH "b-heavy" true 2>&1)
ok "heavy main turn refused beside a live side turn" '[[ "$o" == *"side turn beside the heavy one"* && "$o" == *REFUSED* ]]'
wait $B
o=$(QUEUED_HEAVY_RENEW_SEC=1 /bin/bash $QH "d" sleep 3 2>&1); until_true 20 '[ ! -e $S/m/machine-claim ]'
ok "main turn: renewer stops, no claim after release" '[[ "$o" == *"claim released"* && ! -e $S/m/machine-claim ]]'
hold
/bin/bash $QH --light "e" sh -c "trap '' TERM; sleep $((U+1)) & wait" > $S/e.log 2>&1 & Q=$!; BG="$BG $Q"
until_true 60 'grep -q "SIDE TURN: running" $S/e.log && ! gone $((U+1))'; e_started=$?
kill -TERM $Q; until_true 40 'gone $((U+1)) && ! kill -0 $Q 2>/dev/null && [ ! -e $S/m/light-side-claim ]'
ok "TERM to a side run stops its group, its capper, and releases" '[ "$e_started" = 0 ] && gone $((U+1)) && ! kill -0 $Q 2>/dev/null && [ ! -e $S/m/light-side-claim ]'
# a new-script heavy waiter (aware) does not hold side turns off
/bin/bash $QH "f-heavy-wait" true > $S/f.log 2>&1 & F=$!; BG="$BG $F"; until_true 30 '[ -e $S/m/suitewait.$F ]'
o=$(/bin/bash $QH --light "f-light" true 2>&1)
ok "a waiting side-aware heavy run does not hold side turns off" '[[ "$o" == *"SIDE TURN"* ]]'
ok "the aware waiter marker says aware" 'grep -qx aware $S/m/suitewait.$F'
kill $F 2>/dev/null
# inherited cookie is not ours
o=$(KOSMOS_LIGHT_SIDE_COOKIE=inherited /bin/bash $QH --light "g" true 2>&1)
ok "an inherited side cookie is cleared" '[[ "$o" == *"SIDE TURN"* ]]'
# double TERM during cleanup: the command group must still be stopped and the claim released
/bin/bash $QH --light "h" sh -c "trap '' TERM; sleep $((U+2)) & wait" > $S/h.log 2>&1 & Q2=$!; BG="$BG $Q2"
until_true 60 'grep -q "SIDE TURN: running" $S/h.log && ! gone $((U+2))'; h_started=$?
kill -TERM $Q2; sleep 0.7; kill -TERM $Q2 2>/dev/null; until_true 40 'gone $((U+2)) && [ ! -e $S/m/light-side-claim ]'
ok "a second TERM during cleanup does not abandon it" '[ "$h_started" = 0 ] && gone $((U+2)) && [ ! -e $S/m/light-side-claim ]'
o=$(QUEUED_HEAVY_SIDE_MIN=08 /bin/bash $QH --light "i" true 2>&1)
ok "SIDE_MIN=08 is decimal" '[[ "$o" == *"past 8 min"* && "$o" == *"END rc=0"* ]]'
o=$(/bin/bash $QH --light "j-outer" /bin/bash $QH --light "j-inner" true 2>&1)
ok "a queued-heavy inside a side turn refuses at once" '[[ "$o" == *"started inside a light run"* ]]'
mkdir -p $S/m2; o=$(KOSMOS_RUN_MARKER_DIR=$S/m2 KOSMOS_NO_WAIT=1 /bin/bash $QH --light "k" sh -c 'echo "NW=${KOSMOS_NO_WAIT:-unset}"' 2>&1)
ok "the queue's wait settings do not reach the command" '[[ "$o" == *"NW=unset"* ]]'
# yield: a foreign Playwright browser appears mid side turn; the side command is stopped and its claim released
# Review 1 (round 2 of the fix): one browser flag and probe PER ARM. With one shared flag, an earlier arm's late
# watcher made the browser appear while the next arm was starting, and that arm then waited instead of yielding.
mkflip() { printf '#!/bin/sh\n[ -e "%s/pw-on-%s" ] && { echo "%s /x/ms-playwright/chrome"; exit 0; }\nexit 1\n' "$S" "$1" "$H" > "$S/pwflip-$1"; chmod +x "$S/pwflip-$1"; }
for n in 3 4 5 6; do mkflip $n; done
mkdir -p $S/m3; cp $S/m/machine-claim $S/m3/ 2>/dev/null || { NOW=$(date +%s); printf "%s-%s-1 %s %s host queued run (not a cut): fake heavy\n" $H $((NOW-300)) $H $((NOW+1800)) > $S/m3/machine-claim; }
# Review 1: the browser appears only once the side COMMAND runs (its unique sleep is up). A fixed 3 s raced the start gate,
# and so did "the side claim exists": the wrapper re-checks for browsers after taking the claim, and backs off.
o=$( ( until_true 60 '! gone $((U+3))' && touch $S/pw-on-3 ) & KOSMOS_RUN_MARKER_DIR=$S/m3 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/pwflip-3 QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "y" sleep $((U+3)) 2>&1)
ok "a side turn yields when a foreign browser starts, exit 75" '[[ "$o" == *"SIDE TURN YIELDED"* && "$o" == *"END rc=75"* ]] && gone $((U+3)) && [ ! -e $S/m3/light-side-claim ]'
# SIGPIPE: the output piped into a reader that has gone (head -2); the yield must still stop the command.
mkdir -p $S/m4; cp $S/m3/machine-claim $S/m4/ 2>/dev/null || cp $S/m/machine-claim $S/m4/
( until_true 60 '! gone $((U+4))' && touch $S/pw-on-4 ) &
KOSMOS_RUN_MARKER_DIR=$S/m4 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/pwflip-4 QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "z" sleep $((U+4)) 2>&1 | head -2 >/dev/null
until_true 30 'gone $((U+4))'
ok "a yield still stops the command when the output reader has gone (SIGPIPE)" 'gone $((U+4))'
hold
o=$(KOSMOS_NO_WAIT=1 /bin/bash $QH --light "bc" true tools/browser-checks.sh 2>&1)
ok "a light run of browser-checks.sh takes an ordinary turn, never a side turn" '[[ "$o" == *"takes an ordinary turn"* && "$o" != *"SIDE TURN"* && "$o" == *REFUSED* ]]'
o=$(KOSMOS_NO_WAIT=1 /bin/bash $QH --light "rt" yarn test engine/x.test.js 2>&1)
ok "a light yarn test takes an ordinary turn" '[[ "$o" == *"takes an ordinary turn"* && "$o" != *"SIDE TURN"* ]]'
for form in "sh -c 'cd /x && yarn test a.test.js'" "sh -c 'npm run test'" "sh -c 'yarn run test b'" "npm test a.test.js" "npm run test a" "yarn run test a" "yarn -s test a" "/usr/local/bin/yarn --silent test a" "bash tools/test-install.sh" "yarn test:install" "npm run test:install-gate" "npm t" "pnpm test x" "yarn release 0.9.99" "npm run release" "sh -c 'cd /x && npm t '" "sh -c 'npm t'" "sh -c 'yarn -s test a'" "sh -c 'npm run-script test'" "sh -c 'yarn  test'" "sh -c 'yarn run release 1.2.3'" "sh -c 'yarn test; echo done'" "sh -c 'yarn test&&echo ok'" "sh -c 'cd /x&&yarn test'" "sh -c 'yarn release; true'" "sh -c '(cd /x && yarn test)'" "sh -c 'yarn \"test\"'" "sh -c 'echo \$(yarn test)'" "sh -c 'yarn test>/dev/null'" "npm tst" "npm it" "npm cit" "npm install-test"; do
  o=$(eval "KOSMOS_NO_WAIT=1 /bin/bash $QH --light rt2 $form" 2>&1)
  ok "an ordinary turn for: $form" '[[ "$o" == *"takes an ordinary turn"* && "$o" != *"SIDE TURN"* ]]'
done
o=$(KOSMOS_NO_WAIT=1 /bin/bash $QH --light rt9 bash tools/test-install-gate-control.sh 2>&1)
ok "round 19: an install-harness control script takes an ordinary turn" '[[ "$o" == *"takes an ordinary turn"* && "$o" != *"SIDE TURN"* ]]'
for form in "node --run test" "/usr/local/bin/node --run test:install" "sh -c 'node --run test'" "bun run test" "bun test" "deno task test" "npx npm-run-all test" "run-s test" "run-p release" "corepack yarn@1 test" "node /x/yarn.js test" "node /x/.yarn/releases/yarn-3.cjs test" "yarn.cmd test"; do
  o=$(eval "KOSMOS_NO_WAIT=1 /bin/bash $QH --light rt3 $form" 2>&1)
  ok "round 16: an ordinary turn for: $form" '[[ "$o" == *"takes an ordinary turn"* && "$o" != *"SIDE TURN"* ]]'
done
o=$(/bin/bash $QH --light "ctl2" node tools/x.js test 2>&1)
ok "CONTROL: node <script> test (no --run) still gets its side turn" '[[ "$o" == *"SIDE TURN"* ]]'
# Round 16 (Opus): a descendant that left the command's group (setsid, as Playwright starts a browser) is stopped at a yield.
mkdir -p $S/m5; NOW=$(date +%s); printf "%s-%s-1 %s %s host queued run (not a cut): fake heavy\n" $H $((NOW-300)) $H $((NOW+1800)) > $S/m5/machine-claim
o=$( ( until_true 60 '! gone $((U+5))' && touch $S/pw-on-5 ) & KOSMOS_RUN_MARKER_DIR=$S/m5 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/pwflip-5 QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "det" perl -e 'use POSIX; if (fork() == 0) { POSIX::setsid(); open(STDOUT, ">/dev/null"); open(STDERR, ">/dev/null"); exec "sleep", $ARGV[0] } sleep 600' $((U+5)) 2>&1)
sleep 1
ok "round 16: a yield stops a detached descendant too" '[[ "$o" == *"SIDE TURN YIELDED"* ]] && gone $((U+5))'
for p in $(pgrep -f "^sleep $((U+5))$"); do kill $p; done   # a survivor (the failing case) is not left running
o=$(/bin/bash $QH --light "ctl" sh -c 'node --test engine/x.test.js' 2>&1)
ok "CONTROL: a direct node --test still gets its side turn" '[[ "$o" == *"SIDE TURN"* ]]'
# Round 18 (Opus): a command that traps TERM and exits 0 after a yield is a stop (75), not a pass.
mkdir -p $S/m6; NOW=$(date +%s); printf "%s-%s-1 %s %s host queued run (not a cut): fake heavy\n" $H $((NOW-300)) $H $((NOW+1800)) > $S/m6/machine-claim
o=$( ( until_true 60 '! gone $((U+6))' && touch $S/pw-on-6 ) & KOSMOS_RUN_MARKER_DIR=$S/m6 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/pwflip-6 QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "trap0" bash -c "trap 'echo CLEANED; exit 0' TERM; sleep $((U+6)) & wait \$!; echo FINISHED-ALL" 2>&1)
ok "round 18: a command that exits 0 on the yield's TERM reads 75, not a pass" '[[ "$o" == *"SIDE TURN YIELDED"* && "$o" == *"END rc=75"* && "$o" != *FINISHED-ALL* ]]'
for p in $(pgrep -f "^sleep $((U+6))$"); do kill $p; done
# Round 18 (Opus): a wrapper killed with SIGKILL (no EXIT trap) does not leave its side command running unclaimed.
mkdir -p $S/m7; NOW=$(date +%s); printf "%s-%s-1 %s %s host queued run (not a cut): fake heavy\n" $H $((NOW-300)) $H $((NOW+1800)) > $S/m7/machine-claim
KOSMOS_RUN_MARKER_DIR=$S/m7 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/quiet QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "k9" sleep $((U+7)) > $S/k9.out 2>&1 &
K=$!; BG="$BG $K"
for _ in $(seq 1 30); do grep -q "SIDE TURN: running" $S/k9.out 2>/dev/null && pgrep -f "^sleep $((U+7))$" >/dev/null && break; sleep 0.5; done
ok "round 18 (fixture): the wrapper took its side turn" 'grep -q "SIDE TURN: running" $S/k9.out && pgrep -f "^sleep $((U+7))$" >/dev/null'
kill -9 $K; until_true 30 'gone $((U+7))'
ok "round 18: a SIGKILLed wrapper's side command is stopped by its capper, not left to the cap" 'gone $((U+7))'
for p in $(pgrep -f "^sleep $((U+7))$"); do kill $p; done


# The shim itself can fail: a run with the marker dir outside this test's dir is refused before the wrapper starts.
o=$(KOSMOS_RUN_MARKER_DIR=/tmp/not-this-test /bin/bash $QH "escape" true 2>&1); rc=$?
ok "CONTROL: the shim refuses a marker dir outside this test" '[ "$rc" = 99 ] && [[ "$o" == *TEST-REFUSED* ]]'
EXPECTED=75   # 74 arms seeded from #4911's dry harness, plus the shim control
echo "queued-heavy-4977: $oks OK, $bads BAD (expected $EXPECTED OK)"
[ "$bads" = 0 ] && [ "$oks" = "$EXPECTED" ] || { echo "FAIL  tools/test-queued-heavy-4977.sh"; exit 1; }
echo "PASS  tools/test-queued-heavy-4977.sh"
