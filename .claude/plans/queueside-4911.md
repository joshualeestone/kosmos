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
- A side light that runs `node docs/browser-checks/x.js` beside a heavy holder that LATER starts Playwright directly
  (not via browser-checks.sh) is not stopped; only the start is gated.
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
- ROLLOUT, in this order: merge; update the queue lib checkout (kosmos-bc-main-4610) to origin/main; mv the new
  queued-heavy.sh in. Side turns stay off by themselves until every waiter of the old script has gone.
- Dry runs of queued-heavy.sh.4911-new (private marker dir, probe seams): side turn; heavy main refused beside a
  live side turn; main renewer stops (no claim after release); the cap stops a 1-minute run and its child.
