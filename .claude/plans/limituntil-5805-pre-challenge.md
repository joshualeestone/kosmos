---
pre_challenge: true
method: challenge-loop
branch: limituntil-5805
diff_hash: d37742ad985504c24fa4a4c76b4e6c44070e1da9ee43f62e9e288fb03ac2cae6
validation: passed (Mortals full suite at a334d56eb, 18811 tests, 18568 pass, 0 fail, 0 cancelled, 2026-10-11 00:53 CDT; local helper skipped on that clean entry, hash d37742ad9855)
subdir_audit: passed
timestamp: 2026-10-11T05:53:39Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found no new issues)
**Reviewer models:** alternating opus (odd) and sonnet (even).

Note: after convergence, two repo guards that run only in the full suite caught gaps, both fixed before the passing
Mortals run: a test-only export (engine.reachable, #265) and the new browser check's SITE_COUNTS line. The run at
fecce9bf7 that found them failed on exactly those; the fixed head passed. Each review's findings and dispositions are
in .claude/plans/limituntil-5805.md, copied here.

Note on 6.0: no local full suite (the shared Agent1s queue); the full suite ran on Mortals.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- FIXED (WARNING): the ten-minute expiry (added before review) restarted a first-seen time on any gap in reads, so a
  weekly last-day line on a Mac that slept through its reset would name tomorrow's time. Entries end on a real
  absence (the card read not capped, or capped on another line); tested across a sleep and across a day with an idle
  read between.
- FIXED (WARNING): "Out of usage until" dropped the #215 hedge for a screen reading. A scraped card says "Looks like a
  usage limit until <time>."; a reported one says "Out of usage until <time>." (tested; browser check updated).
- FIXED (NIT): the hour the fall-back repeats now reads as the later instant, as limitResetAt does (tested).

#### Iteration 2
**Reviewer model:** sonnet
- FIXED (WARNING): one reading that is not capped (an unknown read, a moment in another state) ended the limit and
  restarted the clock. A limit ends after two minutes of readings that are not capped; one such reading between
  capped ones keeps the first-seen time (tested through the real card builder).
- FIXED (WARNING): a dated line did not end a dateless entry, so the same dateless words after a dated limit kept a
  stale time. A dated line ends the agent's other entries (tested).
- FIXED (NIT): the key control now shows the key is the agent (a weekly line first seen by two agents at different
  times reads two different days).
- NIT not taken: "Out of usage until" for a reported card next to "Usage limit reached" elsewhere. The card asks for
  "out of usage until <time>" in those words; the screen-read form keeps the existing "Looks like a usage limit".
- Stated (residual 1, unchanged): a weekly line first seen after a restart, past its printed time, reads as tomorrow's.

#### Iteration 3
**Reviewer model:** opus
- FIXED (WARNING): nothing tested that a capped reading clears an earlier stray one, so deleting that line passed;
  a capped agent with two failed reads hours apart would have lost its first-seen time. A new test reads only through
  the real card builder at set clocks (capped, stray, capped, stray, capped keeps the limit; two strays three minutes
  apart end it).
- FIXED (NIT): both maps are pruned on every card read (a gone agent's entries last two days at most).

#### Iteration 4
**Reviewer model:** sonnet
- FIXED (WARNING): a capped line with no reset this reads (a relative "resets in 4m") did not end an earlier dateless
  limit, as the comments promised; any other line now does (tested). The comment naming which function forgets what
  is corrected.
- FIXED (NIT): no array built per not-capped card to ask whether an agent has entries (hasLimitLines), and
  forgetLimitLines takes no "null" sentinel line.
- STATED (test limit): the two tests that base times on the real clock can fail in the one hour a year before the
  Chicago fall-back repeat (a target in the repeated hour reads as its later instance, by design). The fixed-clock
  tests cover that hour.
- NIT not taken: "until 1:00 AM" with no "tomorrow" for a reset past midnight; it is within five hours and matches the
  existing quota wording (quotaResetWords names the day past 20 hours).

#### Iteration 5
**Reviewer model:** opus
- FIXED (NIT): three comments still promised "Out of usage until"; every Claude card is a screen reading today, so
  they now name "Looks like a usage limit until" and say the plain form is for a reported reading.

#### Iteration 6
**Reviewer model:** sonnet
- NO NEW ISSUES. CONVERGED at iteration 6.

**Found after iteration 6 (not by a reviewer):**
- FIXED: resetLimitFirstSeenForTests is a test seam engine.reachable (#265) would refuse; excused by file in SEAMS_5548.
- FIXED: render-limit-until-5805.js needed its SITE_COUNTS line in browser-checks-reason-grep.test.js (found by the same Mortals run).
