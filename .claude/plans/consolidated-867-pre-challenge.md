---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: consolidated-867
diff_hash: fcb87863b32185df77a74711617b2d3854315538a8d2e3330157e40595f4b6ff
timestamp: 2026-08-25T21:05:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: consolidated-867

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead. The
largest single item this session -- six distinct fixes to one view --
so this got the most verification rigor of anything shipped tonight.

## Iteration 1 (single pass, self)

[STRENGTH] **Measured every claim rather than trusting the CSS to do
what it looked like it should.** Two of the six items (rail-me sticky,
title flush) were confirmed with real `getBoundingClientRect()`
readings against a live server before being called done, not just
visual inspection of a screenshot -- the earlier lesson this session
about screenshot timing not being ground truth applied directly here.

[STRENGTH] **Item 6 (dialog height) went through two wrong attempts,
and both are kept as comments rather than silently replaced.** The
first (stretch the column to its grid row) and second (viewport-based
max-height alone) both measured as exact no-ops -- confirmed by
re-running the same measurement script after each attempt, not assumed
from reading the CSS. Recording why they failed is worth more to a
future reader than a clean diff that hides two real dead ends.

[BLOCKER] (found and fixed before this proof) **My own default-open
change broke an existing, unrelated test's premise.**
`render-consolidated-layouts.js` seeded a project specifically to test
the "nothing is open" sentence, and #867's own auto-open now claims
that seeded project on load -- caught by actually running the full
suite, not assumed safe because my own new test file passed. Fixed by
making the check reach that state deliberately (the same technique the
check's own later section already used for a different scenario)
rather than loosening or deleting the assertions.

[STRENGTH] **Did not build the "same scrollbar effect" for
projects/members/files/tasks that Josh explicitly said he was
guessing about.** Checked each one for an actual independent scroll
region first; none has one yet, so there is no scrollbar there to
hide. Said so plainly rather than adding an inert rule to look
thorough.

## Verification

- `node --test` / `npm test` (full suite): 0 failures, exit 0. New file
  `web.consolidated-867.test.js` pins all six changes.
- `bash tools/browser-checks.sh` (full suite): run twice. First run
  caught the render-consolidated-layouts interaction above; fixed,
  re-ran, "all page checks passed".
- Real live-server Playwright verification of every item, including
  the two dialog-height dead ends, each measured freshly rather than
  assumed from the prior measurement.

### Final Ledger

1 BLOCKER found and fixed before this proof (an existing check's
premise broken by the new default-open behavior). 0 findings remain
open.
