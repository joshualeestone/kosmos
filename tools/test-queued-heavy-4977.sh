#!/bin/bash
# #4977: tools/queued-heavy.sh, the queue wrapper every heavy one-off on a fleet Mac runs through, pinned by a test that
# CI runs (it used to live only in ~/.cache, covered by a dry harness run by hand). Seeded from PigeonPete's #4911 dry
# harness (74 arms). Every run of the wrapper goes through a shim that REFUSES unless KOSMOS_RUN_MARKER_DIR is inside
# this test's own temp dir: a reviewer's sandbox once lost that variable and three copies waited in the real queue.
# (The six #5446 arms run a copy in a throwaway git repo or outside any repo instead, with the same two protections set
# by hand, an in-test KOSMOS_RUN_MARKER_DIR and the perl deadline, plus the probe stubs and fake PATH exported above.)
# Processes this test starts are stopped by exact match on a sleep length unique to this run (never a broad pattern).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
U=$((1000000 + $$ * 10))   # sleep lengths U+1..U+9 belong to this run alone: live pids are unique, so two copies differ by >= 10
REAL_QH="$HERE/queued-heavy.sh"
S=$(mktemp -d); mkdir -p $S/m $S/tmp
export TMPDIR=$S/tmp   # review 2: the wrapper's own mktemp files stay inside this test's dir
BG=""   # every background wrapper this test starts, stopped by pid on exit
# Review 2: a pid in BG is stopped only while it still runs this test's shim or wrapper (a pid reused by another agent's
# process since is left alone), and the sleeps by KILL (two arms make them ignore TERM).
# Review 3: by PARENTAGE (a reused pid cannot be this shell's child unless this shell made it) and by THIS tree's path.
ours() { [ "$(ps -o ppid= -p "$1" 2>/dev/null | tr -d ' ')" = "$$" ] || return 1
  case "$(ps -o command= -p "$1" 2>/dev/null)" in *"$S/qh"*|*"$REAL_QH"*) return 0;; *) return 1;; esac; }
trap 'w=""; for p in $BG; do ours $p && kill $p 2>/dev/null && w="$w $p"; done; for p in $w; do reap $p 40; done; kill ${H:-} 2>/dev/null; wait ${H:-} 2>/dev/null; for n in 1 2 3 4 5 6 7 8 9; do for p in $(pgrep -f "^sleep $((U+n))$"); do kill -KILL $p 2>/dev/null; done; done; rm -rf "${S:?}"; [ -n "${WD:-}" ] && { pkill -KILL -P $WD 2>/dev/null; kill -KILL $WD 2>/dev/null; }' EXIT   # #5331: every wait in this trap is bounded, and the watchdog goes last
# #5331: a whole-file deadline that outlives anything this file runs: past it the file stops itself and FAILS, so a hang
# in here can never hold the canary, a full validation or CI that runs it (one held Agent1s 1 h 43 min on 10-05).
QH_FILE_DEADLINE="${QH_FILE_DEADLINE:-900}"
trap 'exit 124' TERM
# It checks every 5 s that this file is still running (its pid, its own command line) and ends with it, so it never
# signals a pid reused after the file was killed from outside. A TERM reaches the file only between foreground commands;
# when one is hung, the KILL 15 s later stops the file's children, this run's sleeps and then the file (its EXIT trap does
# not run then, so $S can be left behind: the limit).
( trap - EXIT TERM; me=$$; t0=$(date +%s)
  alive() { case "$(ps -o command= -p "$me" 2>/dev/null)" in *test-queued-heavy-4977*) return 0;; *) return 1;; esac; }
  while [ $(( $(date +%s) - t0 )) -lt "$QH_FILE_DEADLINE" ]; do sleep 5 </dev/null >/dev/null 2>&1; alive || exit 0; done
  echo "FAIL  tools/test-queued-heavy-4977.sh: still running after ${QH_FILE_DEADLINE}s (#5331), stopped"
  kill -TERM "$me" 2>/dev/null; sleep 15; alive || exit 0
  pkill -KILL -P "$me" 2>/dev/null; for n in 1 2 3 4 5 6 7 8 9; do for p in $(pgrep -f "^sleep $((U+n))$"); do kill -KILL $p 2>/dev/null; done; done
  kill -KILL "$me" 2>/dev/null ) & WD=$!
# Review 1: the queue's own settings from the shell that runs this must not change the outcome (as test-light-side-4911).
KOSMOS_WAIT_CONTROL_VARS="$(bash -c '. "$1" && printf %s "${KOSMOS_WAIT_CONTROL_VARS:-}"' _ "$HERE/lib/cut-guard.sh")"
unset $KOSMOS_WAIT_CONTROL_VARS KOSMOS_SIDE_LANE KOSMOS_SIDE_MAX_LOAD KOSMOS_SIDE_MIN_HOLD_S KOSMOS_LIGHT_SIDE_COOKIE \
  KOSMOS_MACHINE_CLAIM_COOKIE KOSMOS_QUEUE_CLASS KOSMOS_QUEUE_STARVE_S KOSMOS_NO_WAIT KOSMOS_WAIT_MAX_S KOSMOS_SIDE_AWARE \
  QUEUED_HEAVY_SIDE_MIN QUEUED_HEAVY_SIDE_POLL_S QUEUED_HEAVY_RENEW_SEC QUEUED_HEAVY_MAX_RENEWALS QUEUED_HEAVY_CLAIM_MIN \
  KOSMOS_CLAIM_KEEP_LABEL 2>/dev/null
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
# The cases also spell real scripts by relative path (`bash tools/test-install.sh`): run from an empty dir, where no such
# path exists, so a refusal that ever lapsed could not start the real install harness.
mkdir -p $S/cwd && cd $S/cwd || { echo "FAIL  tools/test-queued-heavy-4977.sh: cannot enter $S/cwd"; exit 1; }
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
# #5331: wait for a wrapper this file stopped, but never without a bound: 0 when it exited within $2 quarter-seconds,
# 1 (and KILLed, so nothing is left holding a claim) when it did not.
reap() { local p=$1 i=0; while [ "$i" -lt "${2:-40}" ]; do [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" = "$$" ] || return 0; case "$(ps -o stat= -p "$p" 2>/dev/null)" in ''|Z*) wait "$p" 2>/dev/null; return 0;; esac; sleep 0.25; i=$((i+1)); done; ours "$p" && kill -KILL "$p" 2>/dev/null; wait "$p" 2>/dev/null; return 1; }
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
/bin/bash $QH --light "b-side" sleep $((U+8)) > $S/b.log 2>&1 & B=$!; BG="$BG $B"
# Review 3: the side turn is running only once it holds its claim AND has left the queue (its marker gone): between the
# two, a heavy run reads it as a waiter ahead, not as a side turn.
until_true 30 '[ -e $S/m/light-side-claim ] && [ ! -e $S/m/suitewait.$B ] && grep -q "SIDE TURN: running" $S/b.log'; b_started=$?; rm -f $S/m/machine-claim
o=$(KOSMOS_NO_WAIT=1 /bin/bash $QH "b-heavy" true 2>&1)
ok "heavy main turn refused beside a live side turn" '[ "$b_started" = 0 ] && [[ "$o" == *"side turn beside the heavy one"* && "$o" == *REFUSED* ]]'
for p in $(pgrep -f "^sleep $((U+8))$"); do kill -KILL $p; done; kill $B 2>/dev/null; reap $B 80; b_reaped=$?   # review 4: no 6-second race; review 5: fail fast; #5331: bounded
ok "#5331: a stopped side turn's wrapper exits within 20 s (its teardown never blocks)" '[ "$b_reaped" = 0 ]'
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
kill $F 2>/dev/null; wait $F 2>/dev/null   # review 6: no job notice in the output
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
# Review 2: the reader goes only once the side turn runs (head -2 left at the first two queue lines, so the wrapper
# died of SIGPIPE before the command ever started and the arm passed on a sleep that never existed).
KOSMOS_RUN_MARKER_DIR=$S/m4 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/pwflip-4 QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "z" sleep $((U+4)) 2>&1 | sed '/SIDE TURN: running/q' >/dev/null
until_true 30 'gone $((U+4))'
ok "a yield still stops the command when the output reader has gone (SIGPIPE)" '[ -e $S/pw-on-4 ] && gone $((U+4))'   # pw-on-4: the command did run
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
for p in $(pgrep -f "^sleep $((U+5))$"); do kill -KILL $p; done   # a survivor (the failing case) is not left running
o=$(/bin/bash $QH --light "ctl" sh -c 'node --test engine/x.test.js' 2>&1)
ok "CONTROL: a direct node --test still gets its side turn" '[[ "$o" == *"SIDE TURN"* ]]'
# Round 18 (Opus): a command that traps TERM and exits 0 after a yield is a stop (75), not a pass.
mkdir -p $S/m6; NOW=$(date +%s); printf "%s-%s-1 %s %s host queued run (not a cut): fake heavy\n" $H $((NOW-300)) $H $((NOW+1800)) > $S/m6/machine-claim
o=$( ( until_true 60 '! gone $((U+6))' && touch $S/pw-on-6 ) & KOSMOS_RUN_MARKER_DIR=$S/m6 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/pwflip-6 QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "trap0" bash -c "trap 'echo CLEANED; exit 0' TERM; sleep $((U+6)) & wait \$!; echo FINISHED-ALL" 2>&1)
ok "round 18: a command that exits 0 on the yield's TERM reads 75, not a pass" '[[ "$o" == *"SIDE TURN YIELDED"* && "$o" == *"END rc=75"* && "$o" != *FINISHED-ALL* ]]'
for p in $(pgrep -f "^sleep $((U+6))$"); do kill -KILL $p; done
# Round 18 (Opus): a wrapper killed with SIGKILL (no EXIT trap) does not leave its side command running unclaimed.
mkdir -p $S/m7; NOW=$(date +%s); printf "%s-%s-1 %s %s host queued run (not a cut): fake heavy\n" $H $((NOW-300)) $H $((NOW+1800)) > $S/m7/machine-claim
KOSMOS_RUN_MARKER_DIR=$S/m7 KOSMOS_WAIT_MAX_S=120 KOSMOS_PW_PROBE=$S/quiet QUEUED_HEAVY_SIDE_POLL_S=1 /bin/bash $QH --light "k9" sleep $((U+7)) > $S/k9.out 2>&1 &
K=$!; BG="$BG $K"
until_true 60 'grep -q "SIDE TURN: running" $S/k9.out 2>/dev/null && ! gone $((U+7))'
ok "round 18 (fixture): the wrapper took its side turn, its temp files in this test's TMPDIR" 'grep -q "SIDE TURN: running" $S/k9.out && pgrep -f "^sleep $((U+7))$" >/dev/null && ls $S/tmp/qh-stopped.* $S/tmp/qh-desc.* >/dev/null 2>&1'
kill -9 $K; wait $K 2>/dev/null; until_true 30 'gone $((U+7))'
ok "round 18: a SIGKILLed wrapper's side command is stopped by its capper, not left to the cap" 'gone $((U+7))'
# #4977 review 3: and its capper removes the wrapper's temp files (in this test's TMPDIR) once it has stopped it.
until_true 30 '[ -z "$(ls -A $S/tmp 2>/dev/null)" ]'
ok "#4977: a SIGKILLed wrapper's temp files are removed by its capper" '[ -z "$(ls -A $S/tmp 2>/dev/null)" ]'
for p in $(pgrep -f "^sleep $((U+7))$"); do kill -KILL $p; done


# The default lib checkout is a path nothing in the repo creates: a checkout without cut-guard.sh stops the wrapper with
# exit 3 and the variable to set, before anything runs.
o=$(QUEUED_HEAVY_LIB=$S/cwd /bin/bash $QH "nolib" touch $S/nolib-ran 2>&1); rc=$?
ok "#4977: a lib checkout without cut-guard.sh exits 3, names QUEUED_HEAVY_LIB, runs nothing" '[ "$rc" = 3 ] && [[ "$o" == *"could not load cut-guard.sh"*QUEUED_HEAVY_LIB* ]] && [ ! -e $S/nolib-ran ]'
# And a checkout whose cut-guard.sh lacks a function the wrapper calls (an old lib) stops the same way, not by waiting.
mkdir -p $S/oldlib/tools/lib && { cat $ROOT/tools/lib/cut-guard.sh; echo 'unset -f kosmos_release_machine'; } > $S/oldlib/tools/lib/cut-guard.sh
o=$(QUEUED_HEAVY_LIB=$S/oldlib /bin/bash $QH "oldlib" touch $S/oldlib-ran 2>&1); rc=$?
ok "#4977: a lib missing kosmos_release_machine exits 3 and names it, runs nothing" '[ "$rc" = 3 ] && [[ "$o" == *"has no kosmos_release_machine"* ]] && [ ! -e $S/oldlib-ran ]'
# A lib with the side lane's gate (kosmos_light_side_clear) but not its release stops too, rather than failing in the trap.
mkdir -p $S/halflib/tools/lib && { cat $ROOT/tools/lib/cut-guard.sh; echo 'unset -f kosmos_release_light_side'; } > $S/halflib/tools/lib/cut-guard.sh
o=$(QUEUED_HEAVY_LIB=$S/halflib /bin/bash $QH --light "halflib" touch $S/halflib-ran 2>&1); rc=$?
ok "#4977: a lib with the side gate but no kosmos_release_light_side exits 3 and names it, runs nothing" '[ "$rc" = 3 ] && [[ "$o" == *"has no kosmos_release_light_side"* ]] && [ ! -e $S/halflib-ran ]'
# #5446: with QUEUED_HEAVY_LIB unset and the default folder missing (HOME points where none exists), the wrapper uses the
# main checkout of the repo it sits in, says so, and runs. A throwaway repo stands in for that checkout; the run keeps
# the shim's two protections (a marker dir inside this test, a deadline). Control: the same repo without cut-guard.sh
# still exits 3 and runs nothing.
qh_repo() {   # qh_repo <dir> <with lib: 1|0>
  mkdir -p "$1/tools/lib" "$1/h" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR git -C "$1" init -q && cp "$REAL_QH" "$1/tools/queued-heavy.sh"
  [ "$2" = 1 ] && cp "$ROOT"/tools/lib/*.sh "$1/tools/lib/"
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR git -C "$1" add -A && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR git -C "$1" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm fixture   # a commit, so the line can name it
  return 0
}
qh_repo $S/fbrepo 1; qh_repo $S/fbnolib 0
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/fbrepo/h KOSMOS_RUN_MARKER_DIR=$S/mfb perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/fbrepo/tools/queued-heavy.sh "fallback" touch $S/fb-ran 2>&1); rc=$?
ok "#5446: no QUEUED_HEAVY_LIB and no default folder: the repo's main checkout supplies the guards, it says so, and runs" '[ "$rc" = 0 ] && [ -e $S/fb-ran ] && [[ "$o" =~ main\ checkout\ [^\ ]*/fbrepo\ at\ [0-9a-f]{7,}\ on\ [^\ ]+\ for\ the\ queue ]] && [[ "$o" != *"No such file"* ]]'
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/fbnolib/h KOSMOS_RUN_MARKER_DIR=$S/mfbn perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/fbnolib/tools/queued-heavy.sh "fallback-nolib" touch $S/fbn-ran 2>&1); rc=$?
ok "#5446 CONTROL: the same with no cut-guard.sh in that checkout still exits 3 and runs nothing" '[ "$rc" = 3 ] && [ ! -e $S/fbn-ran ] && [[ "$o" == *"could not load cut-guard.sh"* ]]'
ok "#5923: a run that cannot load the lib (exit 3) still releases the lib lock" '[ -d $S/mfbn ] && [ ! -e $S/mfbn/queued-heavy-lib.lock ]'
qh_repo $S/fbold 1; echo 'unset -f kosmos_release_machine' >> $S/fbold/tools/lib/cut-guard.sh
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/fbold/h KOSMOS_RUN_MARKER_DIR=$S/mfbo perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/fbold/tools/queued-heavy.sh "fallback-old" touch $S/fbo-ran 2>&1); rc=$?
ok "#5446: a fallen-back main checkout with an old lib exits 3, names the missing function and the pull that fixes it" '[ "$rc" = 3 ] && [ ! -e $S/fbo-ran ] && [[ "$o" == *"has no kosmos_release_machine"* ]] && [[ "$o" == *"pull --ff-only"* ]]'
mkdir -p $S/fbout && cp "$REAL_QH" $S/fbout/queued-heavy.sh   # a copy outside any repo, as the installed one is
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/fbout KOSMOS_RUN_MARKER_DIR=$S/mfbx perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/fbout/queued-heavy.sh "outside" touch $S/fbx-ran 2>&1); rc=$?
ok "#5446: a copy outside any git repo (the installed one) has no fallback and still exits 3" '[ "$rc" = 3 ] && [ ! -e $S/fbx-ran ] && [[ "$o" == *"could not load cut-guard.sh"* ]] && [[ "$o" != *"main checkout"* ]]'
GE="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR"
$GE git -C $S/fbrepo worktree add -q $S/fbwt 2>/dev/null
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/fbrepo/h KOSMOS_RUN_MARKER_DIR=$S/mfbw perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/fbwt/tools/queued-heavy.sh "fallback-wt" touch $S/fbw-ran 2>&1); rc=$?
ok "#5446: a worktree's copy falls back to its MAIN checkout, not its own tree" '[ "$rc" = 0 ] && [ -e $S/fbw-ran ] && [[ "$o" =~ main\ checkout\ [^\ ]*/fbrepo\ at ]] && [[ "$o" != *"/fbwt at"* ]]'
qh_repo $S/fbnone 0; mkdir -p $S/fbnone/x && cp "$REAL_QH" $S/fbnone/x/queued-heavy.sh
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/fbnone/h KOSMOS_RUN_MARKER_DIR=$S/mfbz perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/fbnone/x/queued-heavy.sh "fallback-none" touch $S/fbz-ran 2>&1); rc=$?
ok "#5446: a main checkout with no lib at all: exits 3, names that checkout and the pull" '[ "$rc" = 3 ] && [ ! -e $S/fbz-ran ] && [[ "$o" == *"/fbnone has none either"* ]] && [[ "$o" == *"pull --ff-only"* ]]'
# #5923: the DEFAULT shared lib checkout ($HOME/work/kosmos-bc-main-4610) is compared with origin/main by the blobs of
# the two files the queue loads, and moved there only when no queue run could hold the old lib. Fixture: a repo whose
# origin/main changed cut-guard.sh, checked out detached one commit behind. QH_TEST_PS stands in for ps, so a real
# waiter on this box cannot sway an arm. Each arm: its own HOME, marker dir and deadline.
qh_lib5923() {   # qh_lib5923 <home>: the fixture checkout under <home>/work/kosmos-bc-main-4610, one commit behind origin/main
  local d="$1/work/kosmos-bc-main-4610" c="-c user.name=t -c user.email=t@t -c commit.gpgsign=false"
  mkdir -p "$d/tools/lib" && $GE git -C "$d" init -q && cp "$ROOT"/tools/lib/*.sh "$d/tools/lib/"
  $GE git -C "$d" add -A && $GE git -C "$d" $c commit -qm old
  echo '# a later main' >> "$d/tools/lib/cut-guard.sh"; $GE git -C "$d" $c commit -qam new
  $GE git -C "$d" update-ref refs/remotes/origin/main HEAD && $GE git -C "$d" checkout -q --detach HEAD~1
}
run5923() {   # run5923 <name> [env assignments...]: runs the real wrapper with QUEUED_HEAVY_LIB unset and HOME=$S/l5923-<name>
  local n="$1"; shift; mkdir -p $S/ml5923-$n
  o=$(env -u QUEUED_HEAVY_LIB HOME=$S/l5923-$n KOSMOS_RUN_MARKER_DIR=$S/ml5923-$n QH_TEST_PS="cat $S/ps5923-$n" QH_TEST_CWD="cat $S/cwd5923" "$@" perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash "$REAL_QH" "lib-$n" touch $S/l5923-$n-ran 2>&1); rc=$?
}
lh5923() { $GE git -C $S/l5923-$1/work/kosmos-bc-main-4610 rev-parse HEAD; }
lm5923() { $GE git -C $S/l5923-$1/work/kosmos-bc-main-4610 rev-parse origin/main; }
printf 'p1\nn/\n' > $S/cwd5923
for n in mv mk ps sh set dirty nops cwd nocwd reuse dead ahead same branch claim need psx nopid live mvfail mvkeep mvmix noorig unw sideneed; do qh_lib5923 $S/l5923-$n; printf '1 0 /sbin/launchd\n' > $S/ps5923-$n; done
run5923 mv
ok "#5923: the default lib checkout behind origin/main, nothing live: moved to origin/main, said so, run runs, lock gone" '[ "$rc" = 0 ] && [ -e $S/l5923-mv-ran ] && [ "$(lh5923 mv)" = "$(lm5923 mv)" ] && [[ "$o" == *"moved"*"-> origin/main"*"cut-guard.sh differed"* ]] && [ ! -e $S/ml5923-mv/queued-heavy-lib.lock ]'
run5923 mv
ok "#5923: once at origin/main the next join says the queue files match and moves nothing" '[ "$rc" = 0 ] && [[ "$o" == *"files match origin/main"* ]] && [[ "$o" != *moved* ]]'
mkdir -p $S/ml5923-mk && : > $S/ml5923-mk/suitewait.999999
run5923 mk
ok "#5923: a queue marker present: NOT moved, says which, joins on the old lib and runs" '[ "$rc" = 0 ] && [ -e $S/l5923-mk-ran ] && [ "$(lh5923 mk)" != "$(lm5923 mk)" ] && [[ "$o" == *"DIFFERS"*"not moved (a queue marker is present (suitewait.999999))"* ]]'
printf '4242 1 /bin/bash /x/queued-heavy.sh --queued-args /tmp/queued-heavy-args.x\n' > $S/ps5923-ps
run5923 ps
ok "#5923: another queued-heavy.sh live (a waiter after its re-exec): NOT moved, names its pid" '[ "$rc" = 0 ] && [ "$(lh5923 ps)" != "$(lm5923 ps)" ] && [[ "$o" == *"another queued-heavy.sh is live (pid 4242)"* ]]'
printf '4243 1 zsh -c bash /x/queued-heavy.sh "x" true\n4244 1 grep queued-heavy.sh\n4245 1 /bin/bash /x/not-queued-heavy.sh\n' > $S/ps5923-sh
run5923 sh
ok "#5923 CONTROL: a shell of the CALLER or a grep naming queued-heavy.sh is not a waiter, so the move happens" '[ "$rc" = 0 ] && [ "$(lh5923 sh)" = "$(lm5923 sh)" ] && [[ "$o" == *moved* ]]'
mkdir -p $S/ml5923-set; o=$(HOME=$S/nowhere KOSMOS_RUN_MARKER_DIR=$S/ml5923-set QH_TEST_PS="cat $S/ps5923-set" QUEUED_HEAVY_LIB=$S/l5923-set/work/kosmos-bc-main-4610 perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash "$REAL_QH" "lib-set" true 2>&1); rc=$?
ok "#5923: a checkout named by QUEUED_HEAVY_LIB is reported, never moved" '[ "$rc" = 0 ] && [ "$(lh5923 set)" != "$(lm5923 set)" ] && [[ "$o" == *"not moved (it is not the default shared checkout)"* ]]'
echo '# local' >> $S/l5923-dirty/work/kosmos-bc-main-4610/tools/lib/process-fixture.sh
run5923 dirty
ok "#5923: a checkout with local changes is not moved and keeps them" '[ "$rc" = 0 ] && [ "$(lh5923 dirty)" != "$(lm5923 dirty)" ] && [[ "$o" == *"not moved (it has local changes)"* ]] && tail -1 $S/l5923-dirty/work/kosmos-bc-main-4610/tools/lib/process-fixture.sh | grep -q local'
run5923 nops QH_TEST_PS=false
ok "#5923: a process list that fails is not read as nothing live: NOT moved, says so" '[ "$rc" = 0 ] && [ "$(lh5923 nops)" != "$(lm5923 nops)" ] && [[ "$o" == *"not moved (could not list processes)"* ]]'
printf 'p1\nn/\np4246\nn%s/tools\n' "$(cd $S/l5923-cwd/work/kosmos-bc-main-4610 && pwd -P)" > $S/cwd5923-in   # lsof prints the resolved path
run5923 cwd QH_TEST_CWD="cat $S/cwd5923-in"
ok "#5923: a process working inside the checkout blocks the move (a move replaces the whole tree)" '[ "$rc" = 0 ] && [ "$(lh5923 cwd)" != "$(lm5923 cwd)" ] && [[ "$o" == *"not moved (a process is working inside it (pid 4246))"* ]]'
run5923 nocwd QH_TEST_CWD=false
ok "#5923: a working-directory probe that fails blocks the move and says so" '[ "$rc" = 0 ] && [ "$(lh5923 nocwd)" != "$(lm5923 nocwd)" ] && [[ "$o" == *"not moved (could not list working directories)"* ]]'
# A lib lock left by a holder whose pid now runs another command (here the test's own live holder H) is taken over at once.
mkdir -p $S/ml5923-reuse/queued-heavy-lib.lock && echo $H > $S/ml5923-reuse/queued-heavy-lib.lock/pid && echo "a holder long gone" > $S/ml5923-reuse/queued-heavy-lib.lock/cmd
run5923 reuse
ok "#5923: a lib lock whose pid was reused by another command is taken over, and the run moves the lib" '[ "$rc" = 0 ] && [ "$(lh5923 reuse)" = "$(lm5923 reuse)" ] && [[ "$o" == *moved* ]] && [[ "$o" != *"stayed taken"* ]] && kill -0 $H'
# A lib lock whose holder has died is taken over at once.
sh -c 'exit 0' & DEAD5923=$!; wait $DEAD5923
mkdir -p $S/ml5923-dead/queued-heavy-lib.lock && echo $DEAD5923 > $S/ml5923-dead/queued-heavy-lib.lock/pid
run5923 dead
ok "#5923: a lib lock whose holder has died is taken over, and the run moves the lib" '[ "$rc" = 0 ] && [ "$(lh5923 dead)" = "$(lm5923 dead)" ] && [[ "$o" != *"stayed taken"* ]] && ! kill -0 $DEAD5923 2>/dev/null'
# A checkout AHEAD of origin/main (a lib fix not merged yet) differs too, and is never moved back.
d5923=$S/l5923-ahead/work/kosmos-bc-main-4610; $GE git -C $d5923 checkout -q --detach origin/main && echo '# ahead' >> $d5923/tools/lib/cut-guard.sh && $GE git -C $d5923 -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qam ahead
run5923 ahead
ok "#5923: a checkout ahead of origin/main is not moved back, and the line says so" '[ "$rc" = 0 ] && [ "$(lh5923 ahead)" != "$(lm5923 ahead)" ] && [[ "$o" == *"not moved (its commit is not behind origin/main (ahead or diverged))"* ]]'
GC5923="-c user.name=t -c user.email=t@t -c commit.gpgsign=false"
# Behind origin/main by a commit that leaves both queue files alone: the files match, so nothing moves (the measure is
# the files, not commit distance).
d5923=$S/l5923-same/work/kosmos-bc-main-4610; $GE git -C $d5923 checkout -q --detach origin/main && echo x > $d5923/README && $GE git -C $d5923 add README && $GE git -C $d5923 $GC5923 commit -qm readme && $GE git -C $d5923 update-ref refs/remotes/origin/main HEAD && $GE git -C $d5923 checkout -q --detach HEAD~1
run5923 same
ok "#5923: behind origin/main but with both queue files identical: says they match, moves nothing" '[ "$rc" = 0 ] && [ "$(lh5923 same)" != "$(lm5923 same)" ] && [[ "$o" == *"files match origin/main"* ]] && [[ "$o" != *moved* ]]'
$GE git -C $S/l5923-branch/work/kosmos-bc-main-4610 checkout -q -b side5923
run5923 branch
ok "#5923: a checkout on a branch is not moved" '[ "$rc" = 0 ] && [ "$(lh5923 branch)" != "$(lm5923 branch)" ] && [[ "$o" == *"not moved (it is on a branch, not detached)"* ]]'
mkdir -p $S/ml5923-claim && : > $S/ml5923-claim/machine-claim
run5923 claim KOSMOS_IGNORE_MACHINE_CLAIM=1
ok "#5923: a machine claim blocks the move like a waiter marker" '[ "$(lh5923 claim)" != "$(lm5923 claim)" ] && [[ "$o" == *"not moved (a queue marker is present (machine-claim))"* ]]'
# The INSTALLED copy (in this HOME's .cache) names a function origin/main's lib lacks: no move, and the line names it.
for n in inst instold; do qh_lib5923 $S/l5923-$n; printf '1 0 /sbin/launchd\n' > $S/ps5923-$n; mkdir -p $S/l5923-$n/.cache/claude-handoffs; done
printf '#!/bin/bash\nQH_NEED_BASE="kosmos_wait_until_clear kosmos_gone_fn5923"\n' > $S/l5923-inst/.cache/claude-handoffs/queued-heavy.sh
run5923 inst
ok "#5923: the installed copy needs a function origin/main's lib lacks: not moved, names it, the run runs" '[ "$rc" = 0 ] && [ -e $S/l5923-inst-ran ] && [ "$(lh5923 inst)" != "$(lm5923 inst)" ] && [[ "$o" == *"has no kosmos_gone_fn5923, which the installed copy"* ]]'
# An installed copy older than this check (no QH_NEED_BASE line): its needs are unknown, so no move.
printf '#!/bin/bash\necho old\n' > $S/l5923-instold/.cache/claude-handoffs/queued-heavy.sh
run5923 instold
ok "#5923: an installed copy that predates the check blocks the move until it is reinstalled" '[ "$rc" = 0 ] && [ "$(lh5923 instold)" != "$(lm5923 instold)" ] && [[ "$o" == *"predates this check"* ]]'
# origin/main's lib dropped a function this copy calls: moving would make every later join exit 3, so it does not move.
d5923=$S/l5923-need/work/kosmos-bc-main-4610; $GE git -C $d5923 checkout -q --detach origin/main && sed -i.bak 's/^kosmos_release_machine()/kosmos_release_machine_gone()/' $d5923/tools/lib/cut-guard.sh && rm -f $d5923/tools/lib/cut-guard.sh.bak && $GE git -C $d5923 $GC5923 commit -qam drop && $GE git -C $d5923 update-ref refs/remotes/origin/main HEAD && $GE git -C $d5923 checkout -q --detach HEAD~2
run5923 need
ok "#5923: origin/main's lib lacks a function this copy calls: not moved, names it, and the run still runs" '[ "$rc" = 0 ] && [ -e $S/l5923-need-ran ] && [ "$(lh5923 need)" != "$(lm5923 need)" ] && [[ "$o" == *"has no kosmos_release_machine, which this copy calls"* ]]'
printf '1 0 /sbin/launchd\n4247 1 /x/queued-heavy.sh --queued-args /tmp/queued-heavy-args.y\n' > $S/ps5923-psx
run5923 psx
ok "#5923: a waiter run directly as its own command (argv[0] is the script) also blocks the move" '[ "$(lh5923 psx)" != "$(lm5923 psx)" ] && [[ "$o" == *"another queued-heavy.sh is live (pid 4247)"* ]]'
# A lock with no pid file at all (a holder killed between its mkdir and its pid write) is taken over after 20 reads.
mkdir -p $S/ml5923-nopid/queued-heavy-lib.lock
run5923 nopid
ok "#5923: a lib lock with no pid is taken over after its consecutive empty reads, and the run moves the lib" '[ "$rc" = 0 ] && [ "$(lh5923 nopid)" = "$(lm5923 nopid)" ] && [[ "$o" != *"stayed taken"* ]]'
# A lock held by a LIVE holder (this test's H, its command recorded) is respected: the run waits, moves nothing while
# it is held, and goes on once it is released. The arm that proves the takeovers above are not unconditional.
mkdir -p $S/ml5923-live/queued-heavy-lib.lock && ps -ww -o command= -p $H > $S/ml5923-live/queued-heavy-lib.lock/cmd && echo $H > $S/ml5923-live/queued-heavy-lib.lock/pid
( run5923 live; printf '%s\n' "$o" > $S/live5923.out; echo "$rc" > $S/live5923.rc ) &
LIVE5923=$!
# Wait until the wrapper itself is running (re-exec'd, so past perl and its start-up), then give it time to reach the lock.
until_true 30 'pgrep -f "^/bin/bash $REAL_QH --queued-args" >/dev/null'
# Then until it is IN the lock loop: its first sleep (0.5 s between lock reads) is the only one before the lib loads.
wp5923="$(pgrep -f "^/bin/bash $REAL_QH --queued-args" | head -1)"
until_true 30 '[ -n "$wp5923" ] && pgrep -P "$wp5923" -x sleep >/dev/null'
live_held5923="$(lh5923 live)"; live_waiting5923=0; kill -0 $LIVE5923 2>/dev/null && live_waiting5923=1   # still waiting, not finished
rm -rf $S/ml5923-live/queued-heavy-lib.lock
wait $LIVE5923
ok "#5923: a lib lock held by a live holder is respected (nothing moves while held), and the run moves once it is released" '[ "$live_waiting5923" = 1 ] && [ "$live_held5923" != "$(lm5923 live)" ] && [ "$(cat $S/live5923.rc)" = 0 ] && [ "$(lh5923 live)" = "$(lm5923 live)" ] && grep -q moved $S/live5923.out'
# A default folder that is a git checkout but has no cut-guard.sh does not fall back to the repo's main checkout (a
# move there recreates the file, and a run reading in that instant must not load another lib): it exits 3 at the load.
mkdir -p $S/l5923-nolib/h/work/kosmos-bc-main-4610 && $GE git -C $S/l5923-nolib/h/work/kosmos-bc-main-4610 init -q
qh_repo $S/l5923-nolib/repo 1
o=$(env -u QUEUED_HEAVY_LIB HOME=$S/l5923-nolib/h KOSMOS_RUN_MARKER_DIR=$S/ml5923-nolib perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/l5923-nolib/repo/tools/queued-heavy.sh "lib-nolib" touch $S/l5923-nolib-ran 2>&1); rc=$?
ok "#5923: a default folder that is a git checkout without cut-guard.sh exits 3 and does not fall back to the repo's main checkout" '[ "$rc" = 3 ] && [ ! -e $S/l5923-nolib-ran ] && [[ "$o" == *"could not load cut-guard.sh"* ]] && [[ "$o" != *"main checkout"* ]] && [[ "$o" == *"is a git checkout, so the fallback"*"is off for it (#5923)"* ]]'
# A checkout stopped part way (seam: one file changed, rc 1) is put back at the old commit by force, and the line says so.
run5923 mvfail QH_TEST_MOVE_FAIL=1
ok "#5923: a move stopped part way is put back at the old commit, clean, and the line says so" '[ "$rc" = 0 ] && [ "$(lh5923 mvfail)" != "$(lm5923 mvfail)" ] && [ -z "$($GE git -C $S/l5923-mvfail/work/kosmos-bc-main-4610 status --porcelain --untracked-files=no)" ] && [[ "$o" == *"git checkout failed (rc 1) and the checkout was put back at"* ]]'
# A checkout that failed before changing anything, and whose checkout back failed too, is NOT reported as mixed.
run5923 mvkeep QH_TEST_MOVE_FAIL=nochange QH_TEST_RESTORE_FAIL=1
ok "#5923: a failed move that changed nothing, with the checkout back failing too, says unchanged, not MIXED" '[ "$rc" = 0 ] && [ -e $S/l5923-mvkeep-ran ] && [ "$(lh5923 mvkeep)" != "$(lm5923 mvkeep)" ] && [[ "$o" == *"(rc 128) and left the checkout unchanged at"* ]] && [[ "$o" != *MIXED* ]]'
# Its control: a move stopped part way whose checkout back fails is reported MIXED, with the repair command.
run5923 mvmix QH_TEST_MOVE_FAIL=1 QH_TEST_RESTORE_FAIL=1
ok "#5923 CONTROL: a move stopped part way that cannot be put back says FAILED PART WAY, MIXED, and the repair" '[ "$rc" = 0 ] && [[ "$o" == *"FAILED PART WAY (rc 1)"*"may be MIXED; repair with: git -C"*"checkout -f --detach"* ]]'
# No origin/main to compare with: says so, moves nothing, and the run runs.
$GE git -C $S/l5923-noorig/work/kosmos-bc-main-4610 update-ref -d refs/remotes/origin/main
run5923 noorig
ok "#5923: a checkout with no origin/main says so, is not moved, and the run runs" '[ "$rc" = 0 ] && [ -e $S/l5923-noorig-ran ] && [[ "$o" == *"has no origin/main to compare with (#5923)"* ]] && [[ "$o" != *moved* ]]'
# An unwritable marker dir: no lock can be taken there, so the check is skipped, the line says so, and nothing moves.
mkdir -p $S/ml5923-unw && chmod 555 $S/ml5923-unw
run5923 unw
chmod 755 $S/ml5923-unw
ok "#5923: an unwritable marker dir skips the check, says the lib is loaded unchecked, and moves nothing" '[ "$(lh5923 unw)" != "$(lm5923 unw)" ] && [[ "$o" == *"is not writable, so the lib is loaded unchecked (#5923)"* ]]'
# Origin/main's lib offers side turns (kosmos_light_side_clear) but lacks a side-lane function this copy then calls.
d5923=$S/l5923-sideneed/work/kosmos-bc-main-4610; $GE git -C $d5923 checkout -q --detach origin/main && sed -i.bak 's/^kosmos_release_light_side()/kosmos_release_light_side_gone()/' $d5923/tools/lib/cut-guard.sh && rm -f $d5923/tools/lib/cut-guard.sh.bak && $GE git -C $d5923 $GC5923 commit -qam drop && $GE git -C $d5923 update-ref refs/remotes/origin/main HEAD && $GE git -C $d5923 checkout -q --detach HEAD~2
run5923 sideneed
ok "#5923: origin/main's lib offers side turns but lacks a side-lane function: not moved, names it, the run runs" '[ "$rc" = 0 ] && [ -e $S/l5923-sideneed-ran ] && [ "$(lh5923 sideneed)" != "$(lm5923 sideneed)" ] && [[ "$o" == *"has no kosmos_release_light_side, which this copy calls"* ]]'
# The REAL ps (no QH_TEST_PS): the run's own pipeline subshell keeps this script's argv and must not read as a waiter.
# QH_TEST_PS_NAME gives the script a name no real waiter on this box carries. Control: a live process of that name blocks.
for n in rp rpc; do qh_lib5923 $S/l5923-$n; mkdir -p $S/ml5923-$n $S/rp5923-$n; cp "$REAL_QH" $S/rp5923-$n/qh5923self-$U.sh; done
o=$(env -u QUEUED_HEAVY_LIB -u QH_TEST_PS HOME=$S/l5923-rp KOSMOS_RUN_MARKER_DIR=$S/ml5923-rp QH_TEST_PS_NAME=qh5923self-$U.sh perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/rp5923-rp/qh5923self-$U.sh "lib-rp" true 2>&1); rc=$?
ok "#5923: with the real ps, the run does not count itself or its own subshell, so the move happens" '[ "$rc" = 0 ] && [ "$(lh5923 rp)" = "$(lm5923 rp)" ] && [[ "$o" == *moved* ]]'
mkdir -p $S/rp5923-other && printf '#!/bin/bash\nfor i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60; do sleep 1; done\n' > $S/rp5923-other/qh5923self-$U.sh   # ends by itself within a minute
/bin/bash $S/rp5923-other/qh5923self-$U.sh </dev/null >/dev/null 2>&1 & RP5923=$!
until_true 5 '[[ "$(ps -ww -o command= -p $RP5923)" == *qh5923self-$U.sh* ]]'
o=$(env -u QUEUED_HEAVY_LIB -u QH_TEST_PS HOME=$S/l5923-rpc KOSMOS_RUN_MARKER_DIR=$S/ml5923-rpc QH_TEST_PS_NAME=qh5923self-$U.sh perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash $S/rp5923-rpc/qh5923self-$U.sh "lib-rpc" true 2>&1); rc=$?
kill $RP5923 2>/dev/null   # stops the loop; the one-second sleep it is in then ends on its own
ok "#5923 CONTROL: with the real ps, another live process of that name blocks the move and is named" '[ "$rc" = 0 ] && [ "$(lh5923 rpc)" != "$(lm5923 rpc)" ] && [[ "$o" == *"another queued-heavy.sh is live (pid $RP5923)"* ]]'
# The shim itself can fail: a run with the marker dir outside this test's dir is refused before the wrapper starts.
o=$(KOSMOS_RUN_MARKER_DIR=/tmp/not-this-test /bin/bash $QH "escape" true 2>&1); rc=$?
ok "CONTROL: the shim refuses a marker dir outside this test" '[ "$rc" = 99 ] && [[ "$o" == *TEST-REFUSED* ]]'
# #5064: a MAIN-lane waiter that loses its take keeps its place. A joins first and is made to lose its first take
# (QH_TEST_LOSE_TAKES=1); B joins after it; the box then clears. A must run first. Each scenario has its own marker dir
# under this test's dir, held by the test's fake holder H until it is released.
run5064() {   # run5064 <wrapper> <marker dir>: prints the order the two commands ran in, then A's log
  local q="$1" m="$2"; mkdir -p "$m"; : > "$m.order"
  printf '%s-%s-1 %s %s host queued run (not a cut): fake heavy\n' $H $((NOW-300)) $H $((NOW+1800)) > "$m/machine-claim"
  # #5332: A pauses 5 s after its lost take (QH_TEST_LOST_PAUSE_S), so B's 1 s polls are sure to land while A holds
  # only the place it kept. Without the pause the CONTROL (old code, no kept place) was itself a race and could end
  # "A B" (Angel, 10-05 13:39 and 21:19).
  ( cd /tmp && KOSMOS_RUN_MARKER_DIR="$m" QH_TEST_LOSE_TAKES=1 QH_TEST_LOST_PAUSE_S=5 perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash "$q" "A-5064" sh -c "echo A >> $m.order; ls $m | grep -c '^suitewait\.[0-9]*\$' > $m.amarks; sleep 2" > "$m.a" 2>&1 ) & local pa=$!
  until_true 20 "[ -n \"\$(ls $m 2>/dev/null | grep '^suitewait\.[0-9]*$')\" ]" || echo "RUN5064-TIMEOUT: A never queued" >> "$m.order"; sleep 1
  ( cd /tmp && KOSMOS_RUN_MARKER_DIR="$m" perl -e 'alarm(shift); exec @ARGV or die' "$QH_DEADLINE" /bin/bash "$q" "B-5064" sh -c "echo B >> $m.order" > "$m.b" 2>&1 ) & local pb=$!
  # Release the box only once BOTH waiters are queued (review 1: a fixed sleep let a slow B miss its place on a loaded
  # Mac, turning the CONTROL red for the wrong reason).
  # A timeout is written into the order, so the ORDER= arms go red rather than pass on a run that never raced (review 2).
  until_true 20 "[ \$(ls $m 2>/dev/null | grep -c '^suitewait\.[0-9]*$') -ge 2 ]" || echo "RUN5064-TIMEOUT: both waiters never queued" >> "$m.order"; rm -f "$m/machine-claim"
  wait $pa $pb
  printf 'ORDER=%s\n' "$(tr '\n' ' ' < "$m.order")"; cat "$m.a"
}
o=$(run5064 "$REAL_QH" $S/m5064)
ok "#5064: the lost take was really lost (the test seam fired), so the order below means something" '[[ "$o" == *"did not get the turn"* ]]'
ok "#5064: a main-lane waiter that lost its take kept its place and ran before the later joiner" '[[ "$o" == *"ORDER=A B "*  && "$o" != *"re-marked its place"* ]]'
# #5332: a won take gives the place up. While A's command runs only B is queued, so one waiting marker, not two (A's
# own left behind would read as a waiter ahead of everyone who joins after).
ok "#5332: once A's take is won its own queue marker is gone while its command runs (B's alone is left)" '[ "$(cat $S/m5064.amarks 2>/dev/null)" = 1 ]'
# The same scenario on a copy of the wrapper with NEITHER way of keeping the place: no re-mark (#5064) and no kept
# marker through the take (#5332). The later joiner goes first, so the arm above can fail. Since #5332 either one alone
# keeps A's place, so removing only one would leave the order right and prove nothing.
sed -e '/kosmos_mark_suite_waiting "\$QH_JOINED"/d' -e '/export KOSMOS_WAIT_KEEP_MARK=1/d' "$REAL_QH" > $S/qh-no5064.sh
o=$(run5064 $S/qh-no5064.sh $S/m5064n)
ok "#5064 CONTROL: without the re-mark and the kept marker the later joiner runs first (the arm above is not vacuous)" '[[ "$o" == *"ORDER=B A "* ]] && ! grep -q "kosmos_mark_suite_waiting \"\$QH_JOINED\"" $S/qh-no5064.sh && ! grep -q "export KOSMOS_WAIT_KEEP_MARK=1" $S/qh-no5064.sh'
# #5332: the kept marker ALONE keeps the place: the re-mark removed, the order still holds.
sed '/kosmos_mark_suite_waiting "\$QH_JOINED"/d' "$REAL_QH" > $S/qh-keeponly.sh
o=$(run5064 $S/qh-keeponly.sh $S/m5064k)
ok "#5332: with the re-mark removed, the kept marker alone keeps A ahead of the later joiner" '[[ "$o" == *"ORDER=A B "* ]] && grep -q "export KOSMOS_WAIT_KEEP_MARK=1" $S/qh-keeponly.sh && ! grep -q "kosmos_mark_suite_waiting \"\$QH_JOINED\"" $S/qh-keeponly.sh'
# #5331: the teardown never blocks on its capper, even one that is not a group leader AND is stopped (the shape of the
# canary hang: the group kill missed it and an unbounded wait held the claim). Both copies drop the capper's own `set -m`
# so it is not a group leader; the control also keeps the old teardown (group kill, then wait), which hangs.
sed 's/^  set -m$/  :/' "$REAL_QH" > $S/qh-nojc5331.sh
sed -e 's/^  set -m$/  :/' -e 's/^  _qh_stop_capper$/  if [ -n "$CAPPER" ]; then kill -KILL -- "-$CAPPER" 2>\/dev\/null; wait "$CAPPER" 2>\/dev\/null; fi/' "$REAL_QH" > $S/qh-old5331.sh
# The capper is the wrapper's only child with a `sleep 7` of its own (QUEUED_HEAVY_SIDE_POLL_S=7 below): the short-lived
# $(...) subshells the wrapper forks carry the same command line, so a match on that alone could stop the wrong one.
capper_of() { local c k; for c in $(pgrep -P "$1"); do for k in $(pgrep -P "$c"); do [ "$(ps -o command= -p "$k" 2>/dev/null)" = "sleep 7" ] && { echo "$c"; return 0; }; done; done; return 1; }
side5331() {   # $1 the copy, $2 its marker dir, $3 the reap bound in 0.25 s polls: writes 0 (reaped in time), 1 (hung, KILLed)
  # or 2 (never started) to $2.r, and the teardown's seconds to $2.t
  local q="$1" m="$2" w cap r t0
  mkdir -p "$m"; printf '%s-%s-1 %s %s host queued run (not a cut): fake heavy\n' $H $((NOW-300)) $H $((NOW+1800)) > "$m/machine-claim"
  ( cd /tmp && KOSMOS_RUN_MARKER_DIR="$m" QUEUED_HEAVY_SIDE_POLL_S=7 exec /bin/bash "$q" --light "c5331" sleep $((U+3)) ) > "$m.log" 2>&1 & w=$!; BG="$BG $w"
  # kosmos#5839: the capper is taken from the SAME look that found it. A second capper_of could land between its
  # `sleep 7`s (its poll body runs ps and pgrep), come back empty, stop nothing, and let the old teardown release: the
  # control's two CI reds on 2026-10-11 (got 0, by the code: review 1 of #5839). An empty pid, or a stop that did not
  # take, is a run that never raced: 2, which is tried again below.
  until_true 40 "grep -q 'SIDE TURN: running' '$m.log' && cap=\$(capper_of $w)" || { kill -KILL $w 2>/dev/null; echo 2 > "$m.r"; return; }
  [ -n "$cap" ] || { kill -KILL $w 2>/dev/null; echo 2 > "$m.r"; return; }
  kill -STOP "$cap" 2>/dev/null
  case "$(ps -o stat= -p "$cap" 2>/dev/null)" in T*) ;; *) kill -CONT "$cap" 2>/dev/null; kill -KILL $w 2>/dev/null; echo 2 > "$m.r"; return ;; esac
  for p in $(pgrep -f "^sleep $((U+3))$"); do kill -KILL $p; done
  kill $w 2>/dev/null; t0=$(date +%s); reap $w "$3"; r=$?; echo $(( $(date +%s) - t0 )) > "$m.t"
  # The control's capper is left stopped: KILLed here, only while it is still the copy's subshell (a pid can be reused).
  case "$(ps -o command= -p "$cap" 2>/dev/null)" in *qh-*5331.sh*) kill -KILL "$cap" 2>/dev/null;; esac
  echo $r > "$m.r"
}
# kosmos#6048: the copy under test gets B5331 polls (30 s). A healthy teardown takes about 1 s. When the KILL misses,
# _qh_stop_capper waits out its 10 s loop (longer if this test's TERM lands mid-teardown), then says "did not stop" and
# releases; with 15 s the arm could be cut off before that line, so a red did not say which. With 30 s a missed KILL
# is caught by "did not stop", not by the clock, and a slow release shows its time. The control keeps 15 s: its old
# teardown waits for ever, so a longer bound would only make every run slower.
B5331=120
side5331 $S/qh-nojc5331.sh $S/m5331 $B5331; side5331 $S/qh-old5331.sh $S/m5331c 60
r5331="$(cat $S/m5331.r)"; c5331="$(cat $S/m5331c.r)"
# kosmos#5839: a 2 is a run that never reached its side turn (a busy runner past the 40 s setup), not a teardown that
# released: one more try before judging, for either copy. A 0 or 1 is judged as it came.
if [ "$r5331" = 2 ]; then rm -rf $S/m5331 $S/m5331.log; side5331 $S/qh-nojc5331.sh $S/m5331 $B5331; r5331="$(cat $S/m5331.r)"; fi
if [ "$c5331" = 2 ]; then rm -rf $S/m5331c $S/m5331c.log; side5331 $S/qh-old5331.sh $S/m5331c 60; c5331="$(cat $S/m5331c.r)"; fi
o="$(tail -6 $S/m5331.log 2>/dev/null)"; t5331="$(cat $S/m5331.t 2>/dev/null)"
ok "#5331: a capper that is not a group leader and is stopped is KILLed by pid, so the teardown releases at once (got $r5331: 0 reaped, 1 hung, 2 never started; $(case "$r5331" in (1) echo "not done after";; (2) echo "no teardown, bound";; (*) echo "teardown";; esac) ${t5331:-?} s of $((B5331 / 4)))" '[ "$r5331" = 0 ] && [ ! -e $S/m5331/light-side-claim ] && grep -q "claim released" $S/m5331.log && ! grep -q "did not stop" $S/m5331.log'
# kosmos#5839: the value and the control's own log are printed on a BAD, so a red says which shape it was.
o="$(tail -6 $S/m5331c.log 2>/dev/null)"
ok "#5331 CONTROL: with the old teardown the same capper holds it (the arm above is not vacuous) (got $c5331: 0 reaped, 1 hung, 2 never started)" '[ "$c5331" = 1 ] && grep -q "SIDE TURN: running" $S/m5331c.log'
o=""   # kosmos#5839 review 1: a later arm's BAD must not print this control's log
# #5467: a WAITING run must not carry its wrapped command in its own command line (a `pgrep -f browser-checks.sh` in a
# release read a waiter as a running check and waited on it while the waiter waited on the release, 0.7.27). The real
# run, once its turn comes, IS matched. The control runs a copy without the re-exec: there the waiter is matched, so the
# first arm can fail. The pattern names this test's own fake script, so nothing outside this run can match it.
mkdir -p $S/fakebc/tools; printf '#!/bin/bash\nsleep %s\n' $((U+8)) > $S/fakebc/tools/browser-checks.sh; chmod +x $S/fakebc/tools/browser-checks.sh
sed '/^# #5467: while it waits/,/^fi$/d' "$REAL_QH" > $S/qh-no5467.sh
hide5467() {   # $1 the wrapper (or a copy), $2 its marker dir: writes "<waiter matched> <run matched> <args file named>" to $2.r
  local q="$1" m="$2" w wm=n rm=n fm=n
  mkdir -p "$m"; printf '%s-%s-1 %s %s host queued run (not a cut): fake heavy\n' $H $((NOW-300)) $H $((NOW+1800)) > "$m/machine-claim"
  ( cd /tmp && KOSMOS_RUN_MARKER_DIR="$m" exec /bin/bash "$q" "w5467" /bin/bash $S/fakebc/tools/browser-checks.sh ) > "$m.log" 2>&1 & w=$!; BG="$BG $w"
  until_true 30 "[ -e '$m/suitewait.$w' ]" || { kill $w 2>/dev/null; reap $w 40; echo "x x" > "$m.r"; return; }
  pgrep -f "$S/fakebc/tools/browser-checks.sh" >/dev/null && wm=y
  case "$(ps -ww -o command= -p $w 2>/dev/null)" in *"--queued-args $TMPDIR/queued-heavy-args."*) fm=y;; esac   # the file was here (presence control)
  rm -f "$m/machine-claim"
  until_true 30 '! gone $((U+8))' && pgrep -f "$S/fakebc/tools/browser-checks.sh" >/dev/null && rm=y
  for p in $(pgrep -f "^sleep $((U+8))$"); do kill -KILL $p; done; reap $w 60
  echo "$wm $rm $fm" > "$m.r"
}
hide5467 "$REAL_QH" $S/m5467; hide5467 $S/qh-no5467.sh $S/m5467c
r5467="$(cat $S/m5467.r)"; c5467="$(cat $S/m5467c.r)"
ok "#5467: a waiting run's command line does not carry its command, and the real run's does" '[ "${r5467% *}" = "n y" ]'
ok "#5467 CONTROL: without the re-exec the waiter IS matched (the arm above is not vacuous)" '[ "${c5467% *}" = "y y" ] && ! grep -q "queued-args" $S/qh-no5467.sh'
# Review 1: the file is gone once read, and it WAS in this test's TMPDIR (the waiter named it), so "gone" is not "never here".
ok "#5467: the arguments file was written in TMPDIR and is gone once read" '[ "${r5467##* }" = y ] && [ -z "$(ls "$TMPDIR" | grep queued-heavy-args)" ]'
# Review 1: a stale TMPDIR (removed since) falls back to /tmp instead of stopping the run before it waits.
mkdir -p $S/mstale5467; o=$(cd /tmp && KOSMOS_RUN_MARKER_DIR=$S/mstale5467 TMPDIR=$S/gone-tmpdir /bin/bash $QH "stale-tmpdir" true 2>&1)   # its own marker dir: the fake holder above holds $S/m
ok "#5467: a stale TMPDIR falls back to /tmp and the run still takes its turn" '[[ "$o" == *"TURN: running stale-tmpdir"* && "$o" == *"END rc=0"* ]]'
o=$(KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash "$REAL_QH" --queued-args "$TMPDIR/queued-heavy-args.x/../escape" 2>&1); r=$?
ok "#5467: --queued-args refuses a path that continues past its own file name" '[ "$r" = 2 ] && [[ "$o" == *"is internal"* ]]'
# Review 3: these refusal arms run the wrapper itself, so each has its own unheld marker dir and a 20 s alarm: a
# regression that accepted the file would run (or wait) and read BAD, never hang the file.
mkdir -p $S/mref5467
# Review 2: and a file that is not there, and one outside TMPDIR and /tmp (each refused before anything runs).
o=$(KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash "$REAL_QH" --queued-args "$TMPDIR/queued-heavy-args.missing" 2>&1); r=$?
ok "#5467: --queued-args refuses a file that is not there" '[ "$r" = 2 ] && [[ "$o" == *"missing or not ours"* ]]'
printf 'x\0true\0' > $S/queued-heavy-args.outside
o=$(KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash "$REAL_QH" --queued-args "$S/queued-heavy-args.outside" 2>&1); r=$?
ok "#5467: --queued-args refuses a file outside TMPDIR and /tmp" '[ "$r" = 2 ] && [[ "$o" == *"is internal"* ]] && [ -e $S/queued-heavy-args.outside ]'
# Review 4: a symlink named like its own file is refused (it could point at any file of ours), the target kept.
ln -s $S/queued-heavy-args.outside "$TMPDIR/queued-heavy-args.link"
o=$(KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash "$REAL_QH" --queued-args "$TMPDIR/queued-heavy-args.link" 2>&1); r=$?
ok "#5467: --queued-args refuses a symlink, and the file it points at is left alone" '[ "$r" = 2 ] && [[ "$o" == *"missing or not ours"* ]] && [ -e $S/queued-heavy-args.outside ]'
rm -f "$TMPDIR/queued-heavy-args.link"
# Review 7: nothing after the file name on the command line, and a script fed on stdin (no file to restart from).
printf 'x\0true\0' > "$TMPDIR/queued-heavy-args.extra"
o=$(KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash "$REAL_QH" --queued-args "$TMPDIR/queued-heavy-args.extra" more 2>&1); r=$?
ok "#5467: --queued-args refuses anything after the file name" '[ "$r" = 2 ] && [[ "$o" == *"is internal"* ]] && [ -e "$TMPDIR/queued-heavy-args.extra" ]'
rm -f "$TMPDIR/queued-heavy-args.extra"
mkdir -p $S/tmpstdin; o=$(TMPDIR=$S/tmpstdin KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash -s "x" true < "$REAL_QH" 2>&1); r=$?
ok "#5467: a script fed on stdin refuses (exit 3) and leaves no arguments file" '[ "$r" = 3 ] && [[ "$o" == *"run it as a file"* ]] && [ -z "$(ls $S/tmpstdin)" ]'
# Review 6: the round trip itself, pinned: awkward arguments, stdin and the exit code reach the command unchanged.
printf '#!/bin/bash\nfor a in "$@"; do printf "[%%s]" "$a"; done; echo; read -r line; echo "IN=$line"; exit 7\n' > $S/show5467; chmod +x $S/show5467
mkdir -p $S/mrt5467; o=$(printf 'from-stdin\n' | (cd /tmp && KOSMOS_RUN_MARKER_DIR=$S/mrt5467 /bin/bash $QH "rt" $S/show5467 "a b" "" $'x\ny' -n '*' 2>&1)); r=$?
ok "#5467: arguments (a space, an empty one, a newline, -n, *), stdin and the exit code survive the re-exec" '[[ "$o" == *"[a b][][x"$'"'"'\n'"'"'"y][-n][*]"* && "$o" == *"IN=from-stdin"* && "$o" == *"END rc=7"* ]]'
# Review 5: a failed re-exec says so, exits 3 and leaves no arguments file (bash clears the EXIT trap while it tries).
sed 's|  exec /bin/bash "${BASH_SOURCE\[0\]}" --queued-args "$_qh_af"|  exec /nonexistent/bash "${BASH_SOURCE[0]}" --queued-args "$_qh_af"|' "$REAL_QH" > $S/qh-noexec.sh
mkdir -p $S/tmpx; o=$(TMPDIR=$S/tmpx KOSMOS_RUN_MARKER_DIR=$S/mref5467 perl -e "alarm(20); exec @ARGV" /bin/bash $S/qh-noexec.sh "noexec" true 2>&1); r=$?
ok "#5467: a failed re-exec exits 3, says so, and leaves no arguments file" '[ "$r" = 3 ] && [[ "$o" == *"could not restart itself"* ]] && [ -z "$(ls $S/tmpx)" ] && grep -q /nonexistent/bash $S/qh-noexec.sh'

EXPECTED=137   # 74 arms seeded from #4911's dry harness, the shim control, the killed wrapper's temp files, three lib arms, six #5446 lib-fallback arms, three #5064 arms, three #5331 arms, two #5332 arms, twelve #5467 arms, thirty-two #5923 lib-drift arms
echo "queued-heavy-4977: $oks OK, $bads BAD (expected $EXPECTED OK)"
[ "$bads" = 0 ] && [ "$oks" = "$EXPECTED" ] || { echo "FAIL  tools/test-queued-heavy-4977.sh"; exit 1; }
echo "PASS  tools/test-queued-heavy-4977.sh"
