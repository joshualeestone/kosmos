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
