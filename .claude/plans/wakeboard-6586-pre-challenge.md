---
pre_challenge: true
method: challenge-loop
branch: wakeboard-6586
diff_hash: 086e77568528156123c989bc11f391a4ac7ab5e73903d5cfab67d2d9eb7ffcb4
validation: passed (Mortals)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-20T06:06:30Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9, fresh blind reviewers alternating opus and sonnet. **Converged:** yes. Iteration 8 reported NO NEW FINDINGS on 563f6d6f. Iteration 9 reviewed the one test-only commit made after that, and also reported NO NEW FINDINGS. **Fixed:** every finding of iterations 1 to 7, one fix commit per iteration. **Asked:** 0.

Decisions and the accepted items are in .claude/plans/wakeboard-6586.md. That file includes the worst-case start time under reclaim and why the wait is not cut short there.

**Validation, measured:**
- Mortals full suite at 29607efab: 22342 node tests, 22025 passed, 0 failed, 317 skipped; every shell test passed; recorded clean (hash 086e7756).
- The run before it, at 563f6d6f, had one red: this card's own silent-board look count read empty. It was not reproduced, either alone on Mortals (28 runs, 8 of them in parallel) or at home with the runner's environment. The count now uses a file, and that is what passed here (33 looks). The plan records it.
- tools/test-start-waits-for-starting-board-6586.sh: 25 PASS, 30 of 30 repeated runs green.
- Neighbours green: test-kosmos-addr-reclaim-3079 20/20, test-board-foreground-2956, test-stopmark-6651, cli.startedby-5450 9/9.
- Every fix was checked by a mutant that turned a test red, then restored.

### Per-Iteration Breakdown

The reviewers' own reports, copied from this session's Claude Code transcript (2026-10-19 and 2026-10-20). Local paths are replaced and em dashes removed (house style). Nothing else is edited.

#### Iteration 1
**Reviewer model:** opus

I found no blockers. There are 3 findings: one warning and two nits.

**What I checked**
- `tools/test-start-waits-for-starting-board-6586.sh`: 5/5 PASS. It is wired into `test:shell` in `package.json`, and the bounded-wait assertion exercises the real loop (30 looks).
- **Callers:**
  - **Watchdog** (`bin/board-watchdog.sh:391-393`): ignores the exit code (`|| true`).
  - **Native app** (`native-app/main.swift:803`, its #965 watchdog at `:2680`): allows 300 s before it terminates a hung start.
  - **Installer** (`install/setup.sh:3893` put-back, `:5289` final start): has no timeout of its own.
  - **Restart** (`install/kosmos:4481`): `cmd_stop` dies if the process survives `kill -9`, so restart never reaches the new branch with a lingering board.

  A 15 to 75 s wait harms none of these.
- **Sandbox:** this branch cannot be reached from a sandboxed shell, because `running_pid` uses `ps`, which seatbelt denies.
- **What returning 0 skips:**
  - `_mark_board_started`: correct to skip, nothing was launched, and the agent claim file still guards the cooldown.
  - The pidfile: the old pidfile is kept, which is correct.
  - The #5450 person mark: written above the branch, so nothing is lost.
  - The stop marker: the die path already did not restore it before this branch.

**Findings**

1. [CHALLENGE] WARNING, `install/kosmos:1866-1870` with `_await_board_up` (`:1625-1640`). Under `KOSMOS_RECLAIM_BUSY=1`, the wait counts a busy board as a success. That covers the watchdog's busy-past-grace start and the app's wake reclaim (#4342).
   - **Scenario:** lsof cannot see the listener, so `port_has_listener` is false and the #3079 reclaim block is skipped. The recorded wedged board is alive, and `running_pid` passes.
   - **Before:** the start died.
   - **Now:** the first `healthy --once` returns busy, and the start returns 0 with "Kosmos is running (busy right now...)". So the watchdog's or the app's reclaim request ends as a silent success on the exact board the caller had already judged stale.
   - **Narrow window:** it needs lsof to be blind. This is reasoned from source, not measured.
   - **Fix:** in `_await_recorded_board`, when `KOSMOS_RECLAIM_BUSY=1`, treat busy as not a success and keep waiting for `up`, or return 1. Alternatively, record in the plan that the reclaim intent is dropped on this path.

2. [CHALLENGE] NIT, `install/kosmos:1618-1624` (new comment and `say`) and `_await_board_up`'s unpidded branches (`:1647-1657`). Several messages and comments assert things the code does not know.
   - `_await_recorded_board` always prints "is already starting", including for a hand-started board that is wedged. After the wait, that board gets "already running ... but is not answering", which contradicts it.
   - The comment says "This board is launchd's, as an unpidded wait assumes". That is false for a nohup board (an unsupervised install, or Linux without systemd).
   - The unpidded branches can then print false words, in a non-sandbox shell with a local network fault where the board begins listening during the wait:
     - With `RECLAIM_BUSY`, the start dies with "launchd was asked to start Kosmos". This path asked launchd nothing.
     - Without it, the start returns 0 with "It was started under launchd".
   - That die also skips `restore_stop_marker`. The top-of-`cmd_start` unreachable refusal (`:1764`) does restore it, even though "nothing was started" holds just as much here.
   - The sandbox justification in the comment ("in a sandbox it would stop it again") describes a case this branch cannot reach, as noted above.
   - **Fix:** word the say as "already running (process N) but not answering yet; waiting for it". Drop "is launchd's" from the comment, and state that the no-pid choice is about never signalling a board this shell did not launch.

3. [CHALLENGE] NIT, `install/kosmos:1869-1870`. If the recorded process exits during the wait, nothing notices. The unpidded wait never checks the pid, so it runs all 30 looks. `cmd_start` then dies with "already running (process $_oldpid)" about a dead pid, and starts nothing, even though the port is now free.
   - **Example:** a board launched by another concurrent `kosmos start` via nohup crashes while booting.
   - **Before:** the start died at once with the same message, so this is not a regression. But the new wait makes it a 15 s lead-in to a false statement.
   - **Fix:** after `_await_recorded_board` returns 1, re-run `running_pid`. If it no longer succeeds, clear the stale pidfile and fall through to the normal launch instead of dying.

I made no edits, commits or posts.

#### Iteration 2
**Reviewer model:** sonnet

1. [CHALLENGE] NIT, install/kosmos:1613-1637. The new function was inserted between `_await_board_up`'s header comment and `_await_board_up` itself. The header begins "After a start: wait for the board to come up (30 tries...). [pid]: the process just launched...". It now sits directly above the #6586 comment and `_await_recorded_board`, so it reads as the doc for the wrong function. `_await_board_up` is left with no comment, and `_await_recorded_board` appears to have two. This is a false comment. Fix: move the new block (comment and function) above the "After a start:" comment, or move the "After a start" comment down to just above `_await_board_up()`.

2. [CHALLENGE] NIT, install/kosmos:1634 and the 1884-1886 branch. If the board starts listening during the wait but this shell cannot connect to it (HEALTH_STATE `unreachable`), the wait returns 1. `cmd_start` then dies with "already running ... but is not answering on port ... $(_stop_advice)", which is stop-and-restart advice.
   - Top of `cmd_start` (about line 1771) treats the same reading as an unreachable board. If it is a plain start and `_unreachable_is_ours`, it says "Kosmos is already running, but this shell cannot use it. Nothing was started." and returns 0. A reclaim start dies with `_unreachable_lead` and `_unreachable_why`.
   - So a sandboxed shell that races a launchd put-back gets a different, misleading verdict depending on timing. The comment at 1623 says "this shell cannot reach it: stuck", which is true of the code but not of the user-facing outcome.
   - I read this from the code and did not run it.
   - Fix: in the die branch, when `HEALTH_STATE` is `unreachable`, reuse the top-of-function wording: for a plain start, say `_unreachable_why` and return 0 when `_unreachable_is_ours`; otherwise die with `_unreachable_why`. A smaller fix is to add `_unreachable_why` to the die text.

3. [CHALLENGE] NIT, install/kosmos:1887-1890. The rc 2 fall-through re-uses guard results from before a wait of up to about 15 s, or up to 75 s with 2 s probes.
   - The earlier checks are the port listener, `port_taken_by_stranger`, the busy and unreachable verdicts, and `_had_stop_marker`.
   - After the wait nothing re-checks them. If the exited board's port was taken in the meantime, the nohup path starts a board that dies on the taken port, and `_await_board_up` reports "did not come up". That ends the start safely but with imprecise words.
   - In the supervised path, `kickstart -k` covers launchd's relaunch.
   - I traced the pidfile handling and found it correct: it is removed only if it still names `$_oldpid`, so a relaunched board's pidfile is not clobbered.
   - I would not block on this; a one-line comment recording the stale-guard assumption would do.

4. [CHALLENGE] NIT, install/kosmos:1634-1635 and the die. The last look happens, then `sleep 0.5`, then the loop ends and `cmd_start` dies. A board that begins answering in that window, or in the time before the die, is reported stuck. Fix (optional): `healthy --once` once more after the loop, or sleep only when more looks remain.

5. [CHALLENGE] NIT, tools/test-start-waits-for-starting-board-6586.sh, the last two assertions. They are awk text matches on source order, not behaviour.
   - Deleting `[ "$_arb" -eq 0 ] && return 0`, or inverting the rc 2 test, would still pass them.
   - Replacing the `rm -f "$PIDFILE"` guard with an unconditional `rm -f` would also pass.
   - Nothing proves that a `cmd_start` fall-through actually reaches the start code.
   - Fix: source the CLI, stub `_await_recorded_board` to return 0/1/2, and stub the start tail. For example, make the supervised check true and `LAUNCHCTL` a recorder, then assert that rc 0 returns, rc 1 dies and rc 2 reaches the `kickstart`.

6. [CHALLENGE] NIT, install/kosmos:1873-1893. Under `KOSMOS_RECLAIM_BUSY=1`, an `up` answer from the recorded board is returned as success.
   - The reclaim callers (setup.sh after it stops the old board, and the watchdog) mean "no old board should be serving".
   - The old code died here, so any serving board was a hard failure.
   - Now a board that answers during the wait counts as the start succeeding. That is only right if a board that is alive, recorded and not listening at the top of the function must be a fresh launchd put-back running current code.
   - I could not rule out an old-build board that was slow to bind. Iteration 1 recorded the reclaim handling, but only for "busy". The plan's weakest premise names only launchd's put-back.
   - I would record this explicitly. A cheap guard is to compare the board's build or start time against the install.

I measured these things and found no defect:
- **set -e behaviour:** `_await_recorded_board ... || _arb=$?` is safe. Errexit is suppressed inside the left side of `||`, so nothing in the function can abort early. `[ "$_arb" -eq 0 ] && return 0` is not the last command, so a false result is not fatal. `_arb` is initialised to 0.
- **`healthy --once`:** it returns 0 only for `up`. Otherwise `HEALTH_STATE` is one of down, stranger, busy or unreachable. Stranger and down just keep the loop going.
- **Dead-pid case:** a pid that is already dead and not unreachable gives rc 2 on the first look.
- **Test run:** the test script runs 10/10 PASS here.

No BLOCKERs and no WARNINGs.

#### Iteration 3
**Reviewer model:** opus

I found two new issues and both are real. I measured each one by sourcing the real `install/kosmos` with stubs, running the same scenario twice: once where the board turns unreachable during the new wait, and once (the control) where it is already unreachable at `cmd_start`'s first look. The branch test still passes 10/10.

1. [CHALLENGE] WARNING, install/kosmos:1891 (the new `if [ "$HEALTH_STATE" = unreachable ]; then die ...` in cmd_start's recorded-board branch)
   **What happens:** a plain `kosmos start` fails if the recorded board turns unreachable during the wait. The setup is a shell that cannot connect to its own computer (a sandbox, a network rule, or the TIME_WAIT fault). At cmd_start's first look the board has not opened its port yet, so it reads as down. During the wait it starts listening, `_health_refused` returns unreachable, `_await_recorded_board` returns 1, and cmd_start exits 1 with "Kosmos is running at ..., but this shell cannot connect to it".
   **The control:** the same board, already listening at the first look, takes the existing #4636 path at 1776-1783. That path says "Kosmos is already running ... Nothing was started." and exits 0.
   **Measured:** wait arm rc=1, control rc=0, same board, same shell. The only difference is timing. For an installer or app run from an agent's sandboxed pane, this is the card's "Something went wrong" result again, just on a narrower path.
   **Fix:** make this branch match lines 1776-1783. Under `KOSMOS_RECLAIM_BUSY=1`, or when `! _unreachable_is_ours`, put the marker back and die (see item 2). Otherwise say the existing "already running ..., but ... Nothing was started." line and `return 0`.

2. [CHALLENGE] WARNING, install/kosmos:1891 (same line)
   **What happens:** the new die on unreachable does not put back the stop marker or the #6651 update-pause names that cmd_start removed at 1772. The #4636 rule (comment at 1754-1756, and the code at 1779) is that a start from a shell that cannot connect, which then refuses, started nothing, so it restores the marker. This die does not.
   **Measured with `KOSMOS_RECLAIM_BUSY=1`** (the setup.sh or watchdog start) and the marker present beforehand:
   - wait arm: rc=1, marker afterwards no
   - control: rc=1, marker afterwards yes

   So a refused start silently cancels a person's deliberate stop, or turns an update's pause into nothing.
   **Fix:** `if [ -n "$_had_stop_marker" ]; then restore_stop_marker; fi` before this die.
   - **Related NIT:** the message also lacks the control's closing ". Nothing was started or stopped; run this from a shell that can reach it.", so it ends without a full stop and without the advice. Reuse that exact sentence.
   - **Not this change:** the older stuck-board die at 1892 also has no restore. That is how it was before this branch, so I am not counting it here.

3. [CHALLENGE] NIT, install/kosmos:1625 (the busy return in `_await_recorded_board`)
   **What happens:** the plain-start busy success in the wait does not call `_busy_person_hint`. The top-level busy path (1792-1793) and the "did not answer this command" path (1800-1801) both call it, so a person whose board is busy after the wait does not get the same hint.
   **Fix:** call `_busy_person_hint` before that `return 0`.

The scenario scripts are <local path> (plain start) and <local path> (the `KOSMOS_RECLAIM_BUSY=1` version).

#### Iteration 4
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, install/kosmos:1880-1903 (the `_await_recorded_board` fall-through in `cmd_start`). A board that turns busy during the wait, under `KOSMOS_RECLAIM_BUSY=1`, gets a different outcome from one that was busy at the first look.
   - The caller is the watchdog or setup.sh. The recorded pid is alive but not yet bound at the first look, then binds and answers slowly during the wait.
   - `_await_recorded_board` correctly refuses to count busy as up under reclaim, so it runs the full 30 looks and returns 1.
   - `cmd_start` then dies with "...already running (process N) but is not answering...".
   - Busy at the first look takes the #3079 reclaim block and replaces the stale board ("Reclaiming it"). The guards before the wait are skipped on the fall-through, so the reclaim never runs.
   - Measured with `<local path>` (kill, lsof and health stubbed). Wait arm: waiting line, then die. Control arm (busy at the first look): "Reclaiming it."
   - The effect is that the watchdog or an update leaves a stale, busy board unreclaimed. Before this change it died too, but the first-look-equals-wait-reached-state property the branch claims does not hold here.
   - Fix: after the wait ends with a non-unreachable, non-down state, re-run the pre-wait guards instead of dying. For example, re-enter `cmd_start` once with an env guard (`_KOSMOS_REWAITED=1`) that skips the wait, so busy, stranger and bound-silent all get their first-look verdicts. Alternatively, record the accepted gap in the plan.

2. [CHALLENGE] NIT, install/kosmos:1900-1902. The same fall-through gives a wrong verdict for a stranger or a bound-silent board during the wait.
   - If the port starts answering with a non-Kosmos page, the person gets "A Kosmos board ... already running ... Tell the person who runs this computer" instead of "Another app ... is already using port".
   - If the board binds and stays silent (state `down` with our listener), the first look returns 0 ("running ... did not answer this command"), but the wait arm dies.
   - Probe, plain stranger case: waiting line, then "...not answering on port...". Control: "Kosmos is already running ... but it did not answer this command."
   - Both are covered by the fix in item 1.

Everything else checked is consistent with the first-look verdicts. That covers unreachable (plain and reclaim, restore of the stop marker), busy under a plain start, up, and exit (rc 2 leads to a normal start with the pidfile cleared).

I did not run the repo's test script, and I did not edit, commit or post anything.

#### Iteration 5
**Reviewer model:** opus

1. [CHALLENGE] WARNING, install/kosmos:1888-1900. **The wait is skipped when the board that exited is replaced by a new one.** The wait is keyed on a yes/no flag (`_waited`), not on which process it waited for. So when a board exits during the wait (rc 2) and a replacement is already recorded by the second pass, that new board is judged stuck after zero looks.

   **Scenario:**
   - The put-back board launchd brought back crashes while starting. It has been up for more than launchd's 10 s ThrottleInterval, so launchd relaunches it at once.
   - board-run writes its own pid to the pidfile, then execs node.
   - Our `kill -0` notices the old pid is gone, and the next cmd_start step correctly keeps the pidfile, because it no longer names the old pid.
   - The second pass then finds `running_pid` live with a different pid. `_waited` is already 1, so it dies at once with "already running (process NEW) but is not answering". That is the card's own symptom, and the installer reports "Something went wrong".
   - The person sees two lines that contradict each other: "That board (process OLD) exited while starting; starting Kosmos." and then "already running (process NEW) but is not answering".

   **Measured** with <local path>
   - Control (the same new board recorded at the first look): it gets the wait and answers, rc=0.
   - Race arm (old board exits at look 2, new pid recorded): rc=1 with the stuck message and no look at the new board.

   This contradicts the plan's iteration 4 claim that every state gets exactly the first look's verdict. It is not a regression against origin/main, which died in both arms.

   **Fix:** let the wait run once per recorded pid, not once per start. For example, store the waited pid in `_waited`, test `[ "$_waited" != "$_oldpid" ]`, and keep a cap of two waits so the loop stays bounded. Add the race arm to the test as a pair against its first-look control.

2. [CHALLENGE] NIT, install/kosmos:1896 and tools/test-start-waits-for-starting-board-6586.sh:80-81. **Two weaker points in the message and the test.**
   - The rc 2 line promises "starting Kosmos" before the second pass has run its guards. In finding 1, and in any case where a stranger takes the port after the exit, the next line is a refusal. Fix: say only "That board (process P) exited while starting." and let the normal start say "Bringing the board up."
   - The `stranger` and `down` pairs only assert that the two arms are equal. They do not check what the verdict is. A change that broke the first-look verdict the same way in both arms (for example, both falling to the stuck die) would still pass. Fix: also match the expected text in each pair, as lines 87-89 already do for unreachable and busy.

The new test passed 20/0, test-kosmos-addr-reclaim-3079 passed 20/0, and test-stopmark-6651 passed 77/0. I ran test-board-foreground-2956 as well; its result is not recorded above.

These parts of the loop hold up:
- The person-start mark, the stop-marker clear and the pause-name capture all sit outside the loop, so they run once.
- `restore_stop_marker` only runs right before a die.
- Running the #3079 reclaim on the second pass is the first-look verdict iteration 4 intended.
- Declaring `local` again is harmless in bash 3.2 and 5.
- set -e is off inside `_await_recorded_board` because it is called with `||`. That only makes the function more permissive.
- Every exit from the loop is a return, a die (which exits), a continue, or the single break.
- None of the callers depend on the old die-at-once timing. bin/board-watchdog.sh discards the exit code (`|| true`). setup.sh's put-back has no timeout. cmd_restart has cleared the pidfile before it calls start.

#### Iteration 6
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, tools/test-start-waits-for-starting-board-6586.sh:95 and :112. The relaunch-race assertion is flaky.
   - The stubbed `healthy()` kills `$OLD` with `command kill`, then `wait "$OLD"`. `$OLD` is a child of the top-level test shell, but the kill runs inside `$( ( cmd_start ) )`. There `wait` returns 127 and reaps nothing.
   - The killed `sleep` stays a zombie until the parent shell's SIGCHLD handling reaps it. The `sleep` stub is a no-op, so `_await_recorded_board` runs `kill -0 "$1"` microseconds later.
   - A zombie still answers `kill -0`, so the exit goes unseen. The wait then never returns 2, and `exited while starting.` is missing from the output.
   - Measured: 25 consecutive runs of the whole test gave one FAIL, "relaunch race: control ... " at the line-101 assertion. A loaded CI runner will flake more often.
   - A standalone repro showed `kill -0` succeeding on the zombie right after `kill` in a subshell, and then the parent seeing it gone.
   - Fix: in both stubs, after `command kill "$cur"`, poll until `command kill -0 "$cur"` fails, with a bounded loop of a few hundred ms of real `command sleep 0.05`. Alternatively start the victims orphaned, e.g. `$( ( command sleep 60 >/dev/null 2>&1 & echo $! ) )`, and still poll for death.

2. [CHALLENGE] NIT, tools/test-start-waits-for-starting-board-6586.sh:111-120. The cap test does not exercise the arm it names.
   - By reasoning from source, not measured: with the same zombie window, a replaced pid is not seen as dead. The wait then runs its full 30 looks, and the stub keeps replacing the pidfile on later looks.
   - The result is still "2 waits, then die", so the assertion passes whether or not the exit path (rc 2) is taken. It would pass if rc 2 never fired.
   - Fix: the same death-poll as finding 1 makes each replacement a real rc 2. Also assert that `exited while starting.` appears 3 times (once per replacement that was seen). That ties the pass to the mechanism.

3. [CHALLENGE] NIT, tools/test-start-waits-for-starting-board-6586.sh:109, 99.
   - The test starts `sleep 60` processes and only kills them on the straight-line path. The EXIT trap removes only the sandbox.
   - A SIGINT or an `exit` from an assertion between spawn and kill leaves up to four 60-second processes behind.
   - Fix: add `kill $SLEEPERS $OLD` to the trap, guarded with `2>/dev/null`.

I found nothing wrong in the loop, the pid key, or the wording.
- **Loop:** the `continue` and `break` placement is right. The guards contain no stray `break` or `continue`, so none are captured by the new `while :`.
- **Re-declared locals:** each is reassigned before use, so nothing stale carries into the second pass.
- **Bound:** `_waits` caps the waits at two. A silent board takes 1 + 31 + 1 looks, which matches the test's 33.
- **Wording:** the new lines are consistent with the neighbouring messages.

The branch's other tests pass. Everything else in the test file is green apart from finding 1's flake, and none of its stubs differ between arms beyond the variable under test.

#### Iteration 7
**Reviewer model:** opus

I found one WARNING and one NIT.

1. [CHALLENGE] WARNING, install/kosmos:1893-1899 (the `_arb -eq 2` branch, then `continue`). **A `kosmos stop` during the wait does not stop the start.**
   - **Scenario:** `kosmos start` finds a recorded board that is alive but silent, and starts the wait. During those 15 to 30 s, the person runs `kosmos stop`, or setup.sh pauses the board for an update. The stop writes `board.stopped` and kills the board. The wait sees `kill -0` fail and returns 2. cmd_start deletes the pidfile, says "That board (process N) exited while starting.", runs the guards again (none of them looks at the stop marker), breaks out of the loop and goes on to launch.
   - **On the nohup path** (no supervisor job loaded) it launches node directly, so the deliberate stop is undone. In the update case, a board comes up in the middle of the update.
   - **Under launchd,** `kickstart -k` runs board-run. board-run sees the marker and declines to start, so the start dies with "did not come up". That is a false failure for the app or the person.
   - **The message is also wrong:** the board was stopped, it did not exit on its own.
   - **Before this branch,** the start died at its first look, so this window did not exist. A normal fresh start's `_await_board_up` also never launches again after its board dies.
   - **Measured** with a probe (<local path>). It sources the real CLI, and its stubbed health check writes the marker and kills the stand-in board at look 3. The run printed "exited while starting." and then "Kosmos looks incomplete: the runtime is missing". That line comes after the loop, so the start got past every guard while `board.stopped` was present (rc=1 marker=present).
   - **Fix:** in the rc 2 branch, before `continue`, check `[ -e "$STOP_MARKER" ]`. If the marker is there, say the board was stopped while this start waited for it, so nothing was started, and return without launching. Pick the return code to match the stop's intent: 0 for a person's stop, and probably non-zero under KOSMOS_RECLAIM_BUSY. Do not restore any marker, because the stop's own marker is already there. Add a test case: the marker written plus the board ended during the wait must not reach the launch path. The "runtime is missing" line is enough to detect that.

2. [CHALLENGE] NIT, install/kosmos:1619-1632 together with cmd_start's loop. **The worst-case time for one start is longer than the plan says.** The plan only says "30 looks"; in seconds it is much more.
   - Under KOSMOS_RECLAIM_BUSY=1 (the watchdog, setup.sh, and per the plan the app's reclaim), a board that becomes bound and busy during the wait does not end it. Each look can cost a 2 s probe plus 0.5 s, so about 77 s per wait.
   - The second pass's full `healthy` then retries a busy board for up to 20 s (`BUSY_WAIT_DEFAULT_S`). The capped second wait (when the pid changed) adds the same again. Then the reclaim and `_await_board_up` add up to about 75 s.
   - That comes to roughly 250 to 270 s, which is close to the desktop app's 300 s limit. At the first look, the same busy state reclaims at once. This only happens in a narrow case, and the wait does give a booting board a chance to answer.
   - **Fix:** either write this worst case into the plan's Decisions (with the app's 300 s limit next to it), or end the wait under reclaim after a few busy readings in a row, so the guards run again and reach the #3079 reclaim.

Nothing else new.
- **Tests:** test-start-waits-for-starting-board-6586.sh passed 8 times out of 8 here.
- **Linux:** the orphaned stand-in boards depend on PID 1 reaping them. A container whose PID 1 does not reap would make the race cases flaky. test:shell runs only on macOS runners in test.yml today, so this is not a current problem.
- **Callers:** bin/board-watchdog.sh, setup.sh's put-back (its output goes to /dev/null) and the final install start all accept the longer start time.

#### Iteration 8
**Reviewer model:** sonnet

NO NEW FINDINGS.

I read the whole diff against `origin/main`, with the surrounding `install/kosmos`, `install/setup.sh` and `bin/board-watchdog.sh`. I ran `tools/test-start-waits-for-starting-board-6586.sh` and it passed fully, including the two new stop-during-wait cases. I did not run the neighbouring tests, and I never started, stopped or restarted a live board.

How the stop-marker check holds up against each interaction you named:

- **`cmd_restart`:** restart's stop writes the marker, and `cmd_start` removes it again at the top. Any marker present at rc 2 was therefore written during the wait, so it is a real stop. `_KOSMOS_RESTART_HAD_MARKER` only matters on the refusal paths, and the stop-wins path leaves the marker standing.
- **#3079 reclaim:** its write-and-clear of the marker sits before the recorded-pid check, and its fall-through clears `PIDFILE`. So a pass that reclaims never reaches the wait. A reclaim marker can't be seen at the rc-2 check unless a second, concurrent start is mid-reclaim, and in that case stop-wins is the safe answer.
- **setup.sh and watchdog:** both start with `KOSMOS_RECLAIM_BUSY=1`, so stop-wins is a `die` for them. The caller gets a failure rather than a silent success, as intended. Their pause and put-back run before and after `cmd_start`, not inside it.
- **Watchdog timing:** the watchdog waits at most about 30 s more per tick, against a 45 s grace and 180 s throttle. A board that stays silent gets rc 1 and the same refusal as before.
- **#6651 names:** the names removed at the top are only put back by the refusal paths. A marker that appears during the wait comes from a stop that writes its own names, either a person's stop or an update pause, so nothing is lost.
- **rc 1 `continue`:** the guards run once more, then `_waited` equals the pid and the original stuck `die` fires. This matches your stated design, and `set -e` does not trip on `[ "$_arb" -eq 0 ] && return 0`.

#### Iteration 9
**Reviewer model:** opus

NO NEW FINDINGS

The file-count change in `tools/test-start-waits-for-starting-board-6586.sh:111-118` is sound. I did not edit, commit or push anything, and I ran nothing against a real board.

**Can the new assertion pass for the wrong reason?** No.
- It passes only when three things hold at once: the count is exactly `33`, the output contains `is not answering on port`, and it ends with `rc=1`.
- Only the stuck refusal prints that phrase; the waiting line says "not answering yet", so it cannot match.
- Nothing else in the run calls `healthy()`, so the count is exactly 1 first look + 30 in the wait + 1 last look + 1 on the second pass. A second wait would give 65, and the 29-look mutant goes red.
- A subshell that was killed, or a `LOOKS` file that vanished, gives a different rc or a short or empty count. Both fail loudly and print what the start said.

**Does it leak state into later cases?** No.
- The `healthy()` it defines is replaced at line 123 before anything calls it again.
- The pidfile is overwritten at line 127, and the `LOOKS` file is never read again and is cleaned up with the sandbox.
- `N` in the parent stays 0 and `AT` is 1000, so `bound()` stays false for this case, which is what it needs.
- Dropping `ANS=1000` is safe because the new stub does not use it.

**Mechanism for the empty count (not reproduced, ruled down):**
- An `exit` inside the redirected `cmd_start` still runs the EXIT trap on its stdout. Measured with `/bin/bash`, which is 3.2.57 on this Mac.
- The old case's stub could not race: `OLD` was empty and `sleep` is stubbed.
- `cmd_start` sets no EXIT trap of its own and does not `exec` on the path this case takes.
- bash 3.2 also runs the EXIT trap on SIGTERM (measured: `[T] rc=143`).
- So the likely way to get empty output is an outside SIGKILL of that subshell, or its stdout going missing. One example: a leftover kill from an earlier test hitting a reused pid. That is a guess, not a measurement.

**Could the same thing hide a failure elsewhere in the file?** I don't see how. Every other `( cmd_start )` assertion needs its expected words to be present, and the only assertions that pass on something being absent look at a static file. A killed or silent subshell reads as FAIL there, never as a false PASS.

**Rest of the diff:** nothing new beyond what the plan already records.

**Runs:** 5 of 5 green here, 25 PASS each, and the silent-board case reported "33 looks".

