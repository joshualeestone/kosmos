# queueside-4911: a light side turn beside a heavy holder, and aging for light waiters

Card: joshualeestone/kosmos#4911. Measurement: card comment 5942145139 (~/.cache/claude-handoffs/pete-4911-measure.md):
every queued turn claims the whole box, median wait 75 min on 2026-10-01, box 76-85% idle under a held suite.

## The call
1. A light run (KOSMOS_QUEUE_CLASS=light) may take a SIDE turn beside a heavy holder, through its own claim file
   (light-side-claim), when ALL hold: no side turn live; the holder is a non-cut, non-[light] machine claim at least
   90 s old, or (no claim) a running suite; no cut, install harness, browser-checks.sh run or ms-playwright browser;
   1-min load < cores/2; no earlier LIGHT waiter. Code: kosmos_light_side_clear (tools/lib/cut-guard.sh).
2. kosmos_wait_until_clear --side <check>: a queued run returns with KOSMOS_WAIT_LANE=side when the check passes.
   The marker stays for the caller's take; a lost take resumes its old place (the wait adopts a live own marker).
3. Light waiters past the starve line rank 0 like heavy ones (queue time orders rank 0).
4. browser-checks.sh WAITS on a foreign side turn (instead of refusing, which would red the heavy holder's page
   layer); test-install.sh and release.sh wait for it too. run-tests.sh does not ask (suite + one light is the
   pairing this allows).
5. queued-heavy.sh (outside the repo, ~/.cache/claude-handoffs) gets a new version written beside it
   (queued-heavy.sh.4911-new): [light] label, --side for light runs, side claim/renew/release. It is inert with an
   older lib. KOSMOS_SIDE_LANE=0 turns it all off.

6. A side turn is CAPPED: queued-heavy STOPS its command (its own process group) after QUEUED_HEAVY_SIDE_MIN
   (default 10, at most 15) minutes; its claim lasts two minutes longer and is not renewed, so it never lapses under
   a live run. The cap sits inside the 20-minute bound of the page layer, install harness and cut that wait for it.
7. A side turn runs its tests directly. run-tests.sh refuses at once inside a side turn (kosmos_holds_light_side):
   queued, it would wait behind the holder's claim while holding the side claim.
8. No main turn of ANY class starts beside a live side turn (queued-heavy _qh_clear).
9. Only a CLAIMED heavy holder qualifies (a bare suite's age is unreadable). Only side-capable light waiters (marker
   line 6, KOSMOS_SIDE_CAPABLE=1) order the side lane.
10. The side take lives in the lib (kosmos_light_side_take), so it is under test; queued-heavy calls it under its lock.

## Rejected
- Raising the box to two heavy turns: a suite's timing arms are the reds the queue exists to prevent.
- Detecting the holder's class from its environment (ps -E): queued-heavy exports the class after exec, so ps
  cannot see it. Label instead.
- Making run-tests.sh honour a side claim: a side turn going through run-tests.sh is a full suite in disguise.

## Weakest premises
- "load < cores/2 at start" stands in for "the heavy run will not be slowed". A holder can ramp (a cargo build after
  a quiet phase). Mitigated by the 90 s hold and the 1-min average; not proven. The before/after control is
  #4189/#4656/#4678 beside a held suite.
- A holder that took its turn through an OLDER queued-heavy.sh has no class in its label and reads as heavy even if
  it is light. Bounded: those waiters drain within hours of the swap.
- A side light that runs `node docs/browser-checks/x.js` beside a heavy holder that LATER starts Playwright: since
  round 5 the side turn yields within one poll (5 s). For those seconds two Playwright runs share the box.
- test-install.sh and release.sh wiring is covered by review only (both need built bundles or a cut to run).

## Review ledger
- Round 1 (Sonnet, blind): no blocker. Fixed: side cap; sleep after a lost take; one-field marker pid; test kills only
  what it started; plan names the direct-test rule. Left: _kosmos_light_side_active's rm race (the machine claim's
  posture, comment-level); substring labels fail safe.
- Round 2 (Opus, blind): 1 blocker, 8 should-fix. Fixed: (1) heavy main turn beside a side turn; (2) two page layers
  waiting on each other's markers; (3) renewer pid from `[ ] || ( ) &`; (4) lapse under a live run, now a stop at
  the cap; (5) run-tests.sh inside a side turn; (6) bare suite of unknown age; (8) non-side-capable light waiters
  blocking the lane; (9) take moved into the lib and tested; nits 11, 12, 13, 15. NOT taken: (7) version skew (a
  holder on a pre-#4911 branch whose browser-checks.sh does not wait on a side turn, or a holder between Playwright
  launches): the side turn's start-time gate (no browser-checks.sh, no ms-playwright process, load < half) is the
  protection, and the before/after control measures whether it is enough; if it is not, KOSMOS_SIDE_LANE=0 is one
  export. (10) rm race: same posture as the machine claim. (14) a take that keeps losing resets the bound: the new
  sleep bounds the spin; a take loses only to another side turn, which ends in minutes.
- Round 3 (Sonnet + Opus, blind): no blocker. Fixed: the side take claims FIRST and then re-checks (a cut, harness or
  page layer marks itself before it looks, so one of the two always sees the other; Opus reproduced the old gap);
  rollout skew (a waiter of an older lib is ranked by the older rule on both sides, so the two never wait on each
  other; and no side turn while a pre-#4911 queued-heavy.sh waits, since it would not wait for one: marker line 6
  "aware"/"side"); the page-layer WAIT is now proven (the old arm could not fail under KOSMOS_NO_WAIT); a signalled
  side run stops its command group and capper before the release; the capper runs in its own process group (a kill
  between its fork and pid record orphaned a 600 s sleep: two found and killed); stdin from /dev/null for the side
  command; the pause after a lost take is side-lane only; signal traps side-lane only (a main turn's `kill` still
  works as before); inherited side variables are cleared; the CAPPED line warns that a stopped run may have left its
  worktree edited. Not taken: chained side turns starving a waiting page layer (a waiting page layer IS a live
  browser-checks.sh, which refuses every new side turn); a side run's own late browser-checks.sh refusing beside a
  waiting page layer (the light run takes the red, by design); a main-lane loser rejoining at the back (unchanged
  from before).
- Round 4 (Opus + Sonnet, blind; both reproduced the first): (1) three starving waiters of mixed libs formed a circle
  (per-pair rule switching is not transitive): now, while ANY older-lib marker is live, every comparison in the pass
  uses the older rule, one total order; test runs three live waiters each on its own lib and is red on round 3's lib.
  (2) two page layers waiting out one side turn could refuse each other when it ended: browser-checks.sh now refuses
  beside another browser run BEFORE the side wait too (as before #4911), and again after; test red without it.
  Script: signals ignored during cleanup (a second TERM abandoned it, leaving the command unclaimed); SIDE_MIN read
  as decimal (08/09); the queue's wait settings are not passed to the command; a queued-heavy.sh started inside a
  side turn refuses at once (it waited on its own parent until the cap). Dry harness: 12 checks, no orphans.
- Round 5 (Sonnet, blind): no blocker. Fixed: a side turn running browser-checks.sh made a heavy holder's later page
  layer refuse at once (round 4's pre-check): the side command's process group is now published beside the side
  claim (light-side-claim.pgid, cookie-checked) and the PRE-wait check excludes that group in both of the browser
  guard's arms (pgrep and run marker); the check after the wait excludes nothing. Tested through both arms, each
  red without its exclusion. The new script no longer passes KOSMOS_SIDE_CAPABLE / KOSMOS_SIDE_AWARE to its command.
  The three-waiter arm pins the older lib to #4911's base commit, so it stays armed after merge. Not taken: kill -9
  of a side queued-heavy.sh leaves its command running until its capper's cap with no claim (a hard kill has no
  handler; the main lane leaves a command running unclaimed the same way). release.sh exiting from the side wait
  releases its machine claim through its EXIT trap (checked, release.sh:172).
- Round 5 (Opus, blind): its (1) was the Sonnet item already fixed; its (2) already done (the pin). (3) RE-RAISED (7),
  version skew, and the stated reason was wrong: a heavy validation's page layer starts ~15 min into its suite, after
  a side turn may have started, and every branch cut before this merge runs a browser-checks.sh that does not wait
  for one, so the start gate cannot protect it. TAKEN: the side turn now YIELDS. Its capper polls every 5 s
  (kosmos_light_side_intruder) and stops the side command when a browser-checks.sh run, a marked browser run or a
  Playwright browser starts that is not the side command's own descendant (an unreadable probe counts as one). The
  heavy holder is protected whatever branch it runs; the light run takes the red. Tested (8 arms, 3 mutants) and dry
  run (a foreign Playwright appearing mid-turn stops it in 2 s and releases the claim). (5) the dry harness's
  machine-wide orphan check is gone (the capper's sleeps are now 5 s polls). Not taken: (4) a failed ps between the
  side wait and the take can cost a lost take its place (rare, and it rejoins rather than wedging).
- Round 6 (Opus, blind): no blocker. Fixed: (1) a side command that runs tools/browser-checks.sh reddened a heavy
  holder's page layer from an older branch (that one refuses on sight, before the yield): such a command now always
  takes an ordinary turn (dry run checked); (2) the side turn now also yields to a cut or install harness that
  starts mid-turn (tested, each red without it); (3) the intruder read grep's status for pgrep's; (4) it drops test
  fixtures as the start gate does, and the Playwright match is narrowed to browser executables under ms-playwright
  (_kosmos_playwright_browsers; controlled on the box: a real headless shell is seen by pid and gone after kill, a
  command that only mentions the path is not); (5) the three-waiter arm requires all three answers. Not taken: (6) a
  side command stopped on a tty read holds the side lane to its cap (bounded; stdin is /dev/null, so only a command
  that opens /dev/tty itself).
- Round 6 (Sonnet, blind): no blocker. Fixed in queued-heavy.sh.4911-new: a light command through run-tests.sh or
  `yarn test` now always takes an ordinary turn (run-tests.sh refuses inside a side turn, so the same one-file run
  passed or exited 2 by queue state alone); a yielded or capped side run exits 75 (EX_TEMPFAIL, try again later),
  not 143, so a caller can tell it from a red. Its (2) was the cut/harness yield landed the same round. Not taken:
  (4) an unrelated agent's Playwright browser makes a side run yield (the light run's bargain; exit 75 now says
  "requeue"); (5) the three-waiter arm skips in a clone without #4911's base commit (CI clones full history);
  (6) a wrapper script that calls browser-checks.sh or run-tests.sh indirectly is not caught by the argument match,
  so against a holder on a pre-#4911 branch it can still meet that holder's page layer at its start.
- Round 7 (Sonnet + Opus, blind): no blocker. Fixed: (1) WebKit's XPC helpers (launchd-parented, their own group)
  read as someone else's browser, so a side WebKit check yielded to itself on every poll: they are dropped from the
  Playwright match, and the REAL matcher is now tested (ad-hoc signed stand-ins at a browser path and an XPC path,
  each asserted alive first: an unsigned copy of /bin/sleep is killed at exec, which made the first draft's
  "left out" arm pass vacuously; red without the exclusion). (2) test commands as separate arguments (npm test,
  npm run test, yarn run test, yarn -s test, a path to yarn) and inside one argument (sh -c '... yarn test') take an
  ordinary turn, as do test-install.sh and release.sh (each marks a run its own side turn would yield to); dry run
  24/24 incl. a control that `node --test` still gets its side turn. Not taken: a red that exits in the
  microseconds between the capper's liveness check and its stop file is reported as 75; a Playwright browser runs in
  its own process group, so the cap's group kill reaches it only through Playwright's own handling (the yield and
  cap stop the node command; the browser exits with it). The dry harness now uses per-run sleep lengths (a
  reviewer's concurrent copy answered for mine once).
- Round 8 (Sonnet + Opus, blind): no blocker. Fixed: (1) the real-matcher "mention" arm could not fail (an exec'd
  stand-in drops the path from its command line; a restored loose match stayed green): the stand-in no longer execs,
  the arm asserts the path is on its command line, and the loose match now turns it red; (2) test:* package scripts,
  `npm t`, pnpm, and the release scripts (`yarn release` runs a cut) take an ordinary turn (dry run 31/31); (3) the
  Playwright list drops test fixtures as the browser-run list does, so this file's own stand-in, run inside a heavy
  holder's suite, cannot make a side turn yield. Opus (2) was a real, PRE-EXISTING gap, filed as kosmos#4929:
  run-tests.sh always runs the whole suite (its arguments only add node --test flags), so the only way to run one
  file, the light lane's way since #4609, is a bare node --test that skips run-tests.sh's dead-port install URLs,
  fake CLIs and guards. The side turn's refusal text no longer recommends that; it points at #4929. Not taken:
  a side-capable waiter started with stricter per-run settings (KOSMOS_SIDE_MAX_LOAD, KOSMOS_SIDE_MIN_HOLD_S) holds
  the side lane shut while it waits (those are test seams, not settings anyone queues with); a take that keeps
  losing restarts its wait's bound each time (it can only keep losing to a side claim it cannot write: a broken
  marker dir, which breaks the main lane too).
- Round 9 (Opus + Sonnet, blind): no blocker. Fixed: (1) the capper printed before it killed, so a reader that had gone
  (`| head`) killed it with SIGPIPE and the yield and the cap never stopped the command (reproduced): it now stops the
  command FIRST, ignores SIGPIPE, and writes WHY into the stop file, which the script reports after the command has
  gone (killing first had let the script stop the capper before its message; caught by the dry harness); cleanup
  ignores SIGPIPE and removes the stop file. (2) round 8's fixture drop never fired for the local suite (the stand-in's
  cwd was the repo): the stand-ins start in $TMPDIR (run-tests.sh's kt sandbox), and an arm drives the intruder with
  the REAL matcher narrowed to this file's stand-ins: a kt-cwd stand-in does not make it yield, the same one elsewhere
  does (red without the drop). (3) the argument match is one rule over every WORD of every argument (sh -c 'npm t',
  'yarn -s test', 'npm run-script test', double spaces, 'yarn run release'); dry run 38/38. (4) the "clear box is an
  ordinary turn" arm uses a side check that passes. Not taken: a side command that SPAWNS a release.sh-looking
  process yields to it (not in the argument match; it only costs the light run); KOSMOS_NO_WAIT=1 never gets a side
  turn (it refuses on the first pass, before the run holds a queue place; by design).
- ADDED SCOPE (Splinter 20:40, after Angel's #4921 report): (a) every queued turn was labelled "release (not a cut)
  queued one-off", which read as release reservations jumping the queue. The lib now takes KOSMOS_CLAIM_LABEL; the new
  queued-heavy.sh labels an ordinary turn "queued run (not a cut): <what>" (not exported to its command), and the
  refusal and status say "held by an ordinary queued turn"; a cut's claim still reads as a release (tested both ways;
  test-install-gate-control.sh's busy-box regex knows both new wordings; heavy-gate treats any non-free line as held).
  (b) MEASURED 20:40: #4921's waiter (queued 18:38) was FIFTH, behind four older waiters, the front one (17:36) behind
  #4909's control (queued 16:50, holding since 19:49). No jump: the still-waiting note printed only the FIRST refusing
  check, which while any run holds the box is always the claim, so position never showed. It now says "N queued ahead
  of this run" (tested). The real starvation on the board was a LIGHT waiter at 367 min, which this card's aging fixes.
- Round 10 (Opus + Sonnet, blind). Opus BLOCKER, fixed: tools.heavy-gate-3805.test.js reads the REAL box status and
  accepted only the two old wordings, so after rollout any suite that is itself a queued turn's holder would go red
  ("held by an ordinary queued turn"), as would a free line followed by a live side turn's line. Its regex now takes
  both (passes with a queued-run claim held in a private marker dir; the old regex FAILS on that same claim). Also
  fixed: (1) a side turn swallowed the command's stdin (`printf .. | queued-heavy.sh --light x sh` ran nothing and
  ended green): the command keeps this script's stdin unless it is a terminal; (2) kosmos_machine_claim_status (so
  who-has-the-box and heavy-gate) could not see a side turn: it adds a "light run has a side turn" line, so the
  answer is never the bare free line while one runs (tested both ways); (3) ; & | glued to a word (`yarn test; echo`,
  `cd /x&&yarn test`, `yarn release; true`) are split out before the scan; (4) the fixture-drop arm's stand-in is a
  plain sleep reported under a forged browser path, so no real side turn can see it (the round-9 control was a real
  browser-path process outside the sandbox); (5) Chrome's crash reporter (chrome_crashpad_handler, double-forked to
  pid 1) is dropped like WebKit's XPC helpers (real-matcher arm, red without it); (6) a cut through a queued turn
  keeps a release's label (no flip with the renewer); (7) the capper is stopped with KILL: TERM into its
  trap-reset subshell made bash 3.2 warn on 7 of 8 side turns, now 0 of 8; (8) labels shown whole. Dry run 45/45.
  Not taken: an lsof that hangs inside the intruder check would hold the cap off (the side claim then lapses under
  a live run); no hang has been seen, and a timeout wrapper on bash 3.2 is its own moving part.
- Round 11 (Sonnet + Opus, blind): no blocker. Fixed: (1) a <what> with a newline split a claim file (side and
  machine), so the run refused its own side claim and could not release it, holding the queue to expiry: labels are
  written on one line (tested; red without it); (2) the round-10 release-label exception was wrong both ways (it
  wrote the queue's own V label over a cut's, and fired on a mere mention of release.sh): removed; instead a RENEWAL
  (KOSMOS_CLAIM_KEEP_LABEL=1, the queued-heavy renewer) keeps the label the claim carries under this cookie, so a
  cut's "release <version>" survives the turn's renewals (lib test both ways; dry run with a 1 s renewer); (3) _qh_scan
  also maps ( ) { } < > quotes $ ` to spaces ((cd /x && yarn test), yarn "test", $(yarn test), yarn test>log);
  (4) the heavy-gate live test's new wordings are now MADE in a private marker dir and read through the real tool
  (red when the status sentence drifts), so a quiet box cannot hide drift; (5) the "one line" comments on
  who-has-the-box and the status say there is a second line for a side turn. Dry run 49/49 (fake yarn/npm/pnpm first
  on its PATH: at 21:04 an unquoted heredoc that built the harness ran a real `yarn test`, which joined the real
  queue as a waiter for 6 minutes before I found and stopped it; it never ran a test).
- Round 12 (Sonnet + Opus, blind). Sonnet: no blocker, no should-fix (4 nits, below). Opus: no blocker; two
  should-fix, both OLDER than this card and reproduced. Fixed: (1) a waiter from a lib before #4609 (4-line marker)
  orders strictly oldest-first, so the "older rule" fallback was a SECOND rule against it, and an older light waiter
  and a starving heavy one could each name the other: while any such marker is live every reader here now uses
  oldest-first (rank 0 for all), the one rule all three lib generations share. Two #4609 arms in test-cut-guard.sh
  wrote 4-line stand-ins while meaning "a #4609 heavy waiter"; they now write the class, and a new arm pins
  oldest-first against a 4-line one (red on round 11's lib). (2) a queued-heavy.sh nested inside a main turn took its
  "turn" at once (the claim read as its own) and RELEASED the parent's claim at its end, so the box read free under
  the parent's running command: such a run now executes its command directly under the parent's turn and claims and
  releases nothing (a stale inherited cookie takes an ordinary turn); dry-run checked both. Nits taken: npm's test
  aliases (tst, it, cit, install-test, install-ci-test); one shared LIVE_RESERVATION regex for both heavy-gate tests.
  Not taken: the wait-control unset also applies in the main lane (intended: the command waits on its own terms);
  a ps walk that loses an ancestor mid-poll can cause one spurious yield (the light run's cost, exit 75); `node --run
  test`, `bun test` and quote-concatenated spellings are not matched (run-tests.sh refuses inside a side turn, exit 2);
  Playwright with system Chrome or a custom browsers path is not seen (the "no Playwright browser" check is literal);
  a renewal overwrites a foreign live claim (older than this card; a cut overwriting a queued turn is that path).
  Dry run 55/55.
- Round 13 (Sonnet + Opus, blind; BOTH reproduced the same should-fix): round 12's oldest-first fallback was itself a
  second rule against a #4609 reader, so a pre-#4609, a #4609 and a current waiter could circle (A on B and C, B on
  C, C on B). With three generations live, NO single rule agrees with both older readers, so the claim "one total
  order" is withdrawn. Now: while a pre-#4609 waiter is live, another waiter is ahead of this one only when it is
  ahead by BOTH older rules (oldest-first and #4609's rank). A mutual wait needs each to name the other, and an older
  reader that names this one has, by its own rule, this one ahead, which "both" cannot contradict. The cost is the
  other direction (two waiters each reading themselves first), which the claim and the live-suite checks serialise.
  Opus's variant ("ahead = merely older" for a pre-#4609 waiter) has its own 3-cycle; it is mix 3. Tested with three
  LIVE waiters per mix, each on its own lib generation (pre-#4609 704ffeb4c, #4911's base, this branch): mixes 1-3
  move; mix 1 deadlocks on round 12's lib. test-cut-guard.sh pins both arms of the rule. Nits: npm `sit` and
  `clean-install-test`; a nested run's command gets the same clean environment as an ordinary turn's.
- Round 14 (Opus + Sonnet, blind): no blocker. Sonnet: no should-fix (it fuzzed 120 live trials across the three lib
  generations against a model; no cycle needed a waiter of this lib). Opus: (1) the "older" half of the both-rules test
  had no test (dropping it made a real 2-cycle and every arm stayed green): mix 4 added, red without it; (2) the tested
  property was too weak and the claim overclaimed: a pre-#4609 waiter and a #4609 waiter can circle EACH OTHER, on main
  today, and no rule here can break that. The arms now assert the property that holds: NO WAIT CYCLE PASSES THROUGH A
  WAITER OF THIS LIB, computed from the live wait-for graph. CORRECTION to rounds 12-13: "one total order" and "no circle
  across three generations" are withdrawn; the true statement is the one above. Nits: a marker gone between its read
  and its line count is skipped (it was read as pre-#4609 for that pass); yarnpkg; a lost side take clears its cookie.
- Round 15 (Sonnet, blind): nothing above a nit. CORRECTION again, to round 14's wording: "no cycle through this
  lib's waiter" holds only when no older pre-#4609/#4609 pair circles; a waiter of this lib can sit BEHIND such a pair
  (that pair is the cycle), bounded by the queue's wait bound like everyone behind it. The true statement: this lib
  never CREATES a cycle (every cycle needs that older pair). Nit taken: the marker's line count is read once.
  Round 15 (Opus, blind): no blocker; should-fix fixed: mix 2 named this lib's waiter X, and the cycle check looks only
  at N*, so that arm could never fail: renamed (red now, with mix 4, when the "older" half is dropped). Nits: the line
  count (above); a take that loses at the claim itself also clears its cookie.
- WEAKEST PREMISE, added round 11 (Opus): the aging is OFF while any waiter from a lib older than #4911 is live (every
  reader then uses the older rule, which is what prevents the three-waiter circle). A run-tests.sh from any branch not
  yet rebased past this merge writes such a marker, so the 367-minute light wait is fixed only as branches rebase
  (most within a day). The side turn is not affected by this; the aging is.
- KNOWN LIMIT, measured 19:35: an agent's long-lived Playwright browser (one had run 5 h 50 min) is a Playwright
  browser, so it holds side turns off while it runs. That is the safe direction; it means the side lane opens less
  often than the load figures alone suggest. The before/after measurement shows how much.
- ROLLOUT, in this order: merge; update the queue lib checkout (kosmos-bc-main-4610) to origin/main; mv the new
  queued-heavy.sh in. Side turns stay off by themselves until every waiter of the old script has gone.
- Dry runs of queued-heavy.sh.4911-new (private marker dir, probe seams): side turn; heavy main refused beside a
  live side turn; main renewer stops (no claim after release); the cap stops a 1-minute run and its child.

## Round 16 (Sonnet + Opus, blind): 0 blockers. Sonnet 2 warnings 4 nits; Opus 1 warning 3 nits.
- Sonnet WARNING FIXED: an older queued-heavy.sh that queues AFTER a side take (the take's check could not see it)
  could take a main turn beside the side turn. New _kosmos_old_qh_waiter_live; the take and the INTRUDER both ask it, so
  the side turn yields before such a waiter can take. Arm + control (aware waiter: stay) + mutant (red).
  Not done (rejected): yield on ANY new machine claim; a suite beside one side turn is the pairing this card exists for.
- Sonnet WARNING (kept, stated): aging off while a pre-#4911 waiter is live. Already the WEAKEST PREMISE; goes in the PR body.
- Opus WARNING FIXED (wrapper): a descendant that leaves the command's group (Playwright starts browsers detached)
  survived the yield and the release. The capper notes each descendant that leads its own group every poll; the stop
  and _qh_end KILL those groups (only while the pid still runs the noted command) before the release. Dry arm (setsid
  child) OK; control against the pre-round-16 wrapper running. Limit: one started and orphaned between two polls.
- NIT FIXED (both): a command that exits 0 in the instant the capper stops it keeps rc 0.
- NIT FIXED (Opus): _qh_scan now catches bun, deno, npm-run-all, run-s, run-p and `node --run` (9 dry forms + control).
- NIT FIXED (Sonnet): an expired side claim is removed only if the file still holds the line read.
- NIT (Opus) wording: the brief's "never beside a real suite" was MY wording and wrong; the design allows a suite beside
  one side turn; a side turn never runs beside a cut, an install harness, a browser run or an old-wrapper main turn.
- NIT (kept): kill -9 of queued-heavy.sh leaves the side command running (same posture as the machine claim).
- Round 16 CONTROL RESULT (pre-round-16 wrapper, same dry harness): the 9 new _qh_scan forms all BAD (the arms can fail).
  The detached-descendant arm did not print BAD: it HUNG, because the setsid'd sleep the old wrapper left alive held the
  harness's output pipe open (one stray lived 13+ min from the first control run, one from the rerun). I killed both strays
  by pid, after which the arm printed OK, so that printed line is NOT a control result. The evidence is the hang and the
  live strays under the old wrapper versus no stray and no hang under the new one (66/66 at 22:3x). Harness weakness noted:
  the arm should send the detached child's output away from the $( ) so a failure reads BAD instead of hanging.

## Round 17 (Opus, blind): 1 blocker, 3 nits. (Sonnet round 17 still running at this entry.)
- BLOCKER (reproduced, repro1.sh/repro1b.sh in the reviewer's folder) FIXED at 6f03ad2c3: an older queued-heavy.sh that
  arrives at an EMPTY queue passes its first check and writes no suitewait marker, so neither the take nor the
  intruder's marker check sees it; when the holder released, it claimed the box and ran a main turn beside the side
  turn to the end. Fix: the side take records the holder's machine-claim cookie (KOSMOS_SIDE_HOLDER_COOKIE, exported;
  the capper inherits it; the wrapper unsets an inherited one), and the intruder yields when a live claim with ANOTHER
  cookie holds the box. Renewals and a cut relabel keep the holder's cookie (the cut is caught by its own check). Test
  arms: the take records the holder (exit 5 if not); another claim -> yield; CONTROLS: the holder's own claim -> stay,
  and the same foreign claim with no recorded holder -> stay (so the yield is the cookie's). 87/87. Both mutants killed.
  Wrapper backup before this edit: queued-heavy.sh.4911-new.r17-backup.
- NIT (kept, goes in the rollout note): aging is off while any 5-line (#4609) marker is live, and at review time all 15
  live markers were 5-line (wrappers load the lib from kosmos-bc-main-4610). The starvation fix does nothing until that
  checkout is updated and those waiters drain; an early long light wait is not a regression.
- NIT (kept): the old-wrapper marker checks match `queued-heavy` by name; the new cookie check does not depend on the
  name, so it now carries that case.
- NIT (kept): a side claim's liveness is kill -0, so a reused pid holds it to expiry (at most ~17 min), as the machine claim.

## Round 17 (Sonnet, blind): 0 blockers, 3 warnings, 4 nits.
- WARNING (reproduced) FIXED: an older queued-heavy.sh labels EVERY turn "release (not a cut) queued one-off", light ones
  too, so its light turn read as a heavy holder and a new light run took a side turn beside it (two light runs).
  kosmos_light_side_clear now accepts only a holder labelled "queued run (not a cut)" (this generation, whose label says
  [light]); any other label is "class cannot be read", no side turn. Cost: none beside an older wrapper's turn during
  the rollout. Test arm + mutant killed; the test's claim helper and the dry harness now write this generation's label.
- WARNING (MINE, disclosed): at about 22:57 I edited queued-heavy.sh.4911-new IN PLACE (a python rewrite for the round-17
  unset), and the reviewer's run of it died with a syntax error at a shifted offset (bulletin
  editing-a-running-script-kills-it). No real queue run used that file (it is not the live wrapper). From then on every
  wrapper edit is a temp copy, bash -n, then mv (done that way for the _qh_scan nit below). The rollout swap was always mv.
  Also: my real dry-harness run at that time was contaminated by the same edits (and by the label change mid-run); I
  stopped it and reran on the final code.
- WARNING (kept, rollout note): aging is off while any 4/5-line marker is live (cycle safety), and side turns are held
  off while any old queued-heavy.sh waits. Say both in the PR body so nobody expects aging at once.
- NIT FIXED (wrapper, via mv): _qh_scan now also catches corepack's yarn@1/npm@/pnpm@, the .cmd shims, and yarn.js /
  yarn-*.cjs run by node. Four dry forms added. (run-tests.sh's own refusal already caught these visibly.)
- NIT (kept, pre-existing): the stale-claim rm in _kosmos_machine_claim_active is not compare-then-rm; the side claim's
  is, with a microsecond window. Not reproduced.
- NIT (kept): a side-capable waiter with a stricter KOSMOS_SIDE_MAX_LOAD / MIN_HOLD holds the side lane for newer ones.
- NIT (kept, stated before): SIGKILL of the wrapper leaves its capper; it stops the command at the cap.
- CONTROL RESULT (clean, 23:05, harness fixed to send the detached child's output away): against the pre-round-16 wrapper
  the 9 round-16 _qh_scan forms AND "a yield stops a detached descendant too" all print BAD. Proven both arms.

## Round 18 (Sonnet, blind): 0 blockers, 2 warnings, 4 nits. (Opus round 18 still running at this entry.)
- WARNING (reproduced) FIXED: the take read the holder's cookie a THIRD time, separately from what the re-check
  validated. An empty read (the claim gone at that instant) recorded no holder, which turns the intruder's cookie test
  off for the whole side turn; a replacement claim read there was recorded as the holder and never read as an intruder.
  Now kosmos_light_side_clear names the holder it validated (KOSMOS_SIDE_SEEN_HOLDER), the take records exactly that one,
  and refuses (releasing its side claim) if none was named or the box is no longer held by it. Arms: gone, replaced,
  unseen; 3 mutants killed (the unseen arm was added because the "empty" guard is otherwise unreachable).
- WARNING FIXED: _kosmos_light_side_active's compare-then-rm of a stale side claim could delete a fresh one a winner
  moved in between. Now it moves the stale file aside first, compares that, and puts it back (mv -n, never over a newer
  one) if it was not the stale line. Arm simulates the winner arriving at the move/remove; the old rm mutant fails it.
  Residual: while the moved-aside fresh claim is out, a reader sees no side claim for microseconds.
- NIT FIXED (wrapper, temp + mv): QUEUED_HEAVY_SIDE_POLL_S clamped to 60, so the first look comes before the side
  claim (SIDE_MIN + 2 min) lapses.
- NIT (kept): a command that traps TERM and exits 0 keeps rc 0 after a stop (the rc-0 rule from round 16).
- NIT (kept, stated): kill -9 of the wrapper leaves its command to the capper's cap, unclaimed.
- NIT (kept, stated): npx/bunx/make test and wrapper scripts are not read by _qh_scan; run-tests.sh refuses visibly.
- 92/92 in tools/test-light-side-4911.sh.

## Round 18 (Opus, blind): 0 blockers, 3 warnings, 3 nits. (It also independently found the two races Sonnet r18 found.)
- WARNING (reproduced) FIXED (wrapper, temp + mv): a side command that traps TERM and exits 0 after a yield or cap read
  as a pass (round 16's "keeps rc 0" rule). Now the capper records a stop only if it signalled a live group, and a
  recorded stop is 75 whatever the command exits with. Dry arm; BAD against the pre-fix wrapper, OK after.
- WARNING (reproduced) FIXED (wrapper): a SIGKILLed wrapper left its side command running, unclaimed, to the cap. The
  capper now watches the wrapper's pid and stops the command (and its detached descendants) when it is gone; _qh_end
  kills the capper LAST, after the group stop and _qh_kill_desc. Dry arm; BAD against the pre-fix wrapper, OK after.
- WARNING (kept, rollout note, same as r17): aging is off while any older-generation marker is live.
- NIT FIXED (wrapper): _qh_scan reads `node --run=x` and npm-cli.js / npx-cli.js / pnpm.cjs run by node.
- NIT FIXED (test): the intruder's exclusion of the side command's DESCENDANTS was never exercised (only the root). Two
  arms (a marked browser run and a Playwright browser, both by a child of the side command; CONTROLS against an
  unrelated root yield). Perturbed each of the two sites separately: both killed.
- NIT (kept, stated in r18 Sonnet entry): the moved-aside window in the stale-claim cleanup; the intruder heals it.
- Dry harness on the final wrapper: 73/73. Lib test: 96/96.
