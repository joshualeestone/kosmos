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

6. A side turn is CAPPED, not renewed: its claim lapses after QUEUED_HEAVY_SIDE_MIN (default 15, at most 18) minutes,
   inside the 20-minute bound of the page layer, install harness and cut that wait for it (review 1, Sonnet).
7. A side turn's command must run its tests directly (node --test, node docs/browser-checks/x.js). Through
   run-tests.sh it would queue behind the heavy holder's machine claim while holding the side claim.

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
(rounds below)
