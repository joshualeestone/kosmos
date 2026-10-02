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
- KNOWN LIMIT, measured 19:35: an agent's long-lived Playwright browser (one had run 5 h 50 min) is a Playwright
  browser, so it holds side turns off while it runs. That is the safe direction; it means the side lane opens less
  often than the load figures alone suggest. The before/after measurement shows how much.
- ROLLOUT, in this order: merge; update the queue lib checkout (kosmos-bc-main-4610) to origin/main; mv the new
  queued-heavy.sh in. Side turns stay off by themselves until every waiter of the old script has gone.
- Dry runs of queued-heavy.sh.4911-new (private marker dir, probe seams): side turn; heavy main refused beside a
  live side turn; main renewer stops (no claim after release); the cap stops a 1-minute run and its child.
