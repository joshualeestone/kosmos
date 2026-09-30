---
pre_challenge: true
method: challenge-loop
branch: pjbadge-4730
diff_hash: f4ade834fc743652e2c8581cc66ee016fce6169ad44ed57371769ac3610e1729
validation: passed (suite 12542 tests, 0 fail, on Mortals at 303440f09; the surface gate was red only for two missing trailers, green after 8d9d71185)
subdir_audit: passed
timestamp: 2026-09-30T17:20:40Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

Two cards share this branch, and each had its own loop: #4730 (Projects badges, 4 rounds) and #4736
(the Agents page's Working tile, 2 rounds). Both converged on a round with NITs only.

**How this proof was written, stated so it is not read as more than it is:** my session was restarted
at 12:03 after both loops converged. The round ledger below is reconstructed from the fix commits,
which each name their round and what they changed, and from the #4736 card comment (15:09Z). The
reviewer model for each round was not recorded in anything that survived the restart, so it reads
"not recorded". The findings and fixes are real and are in the commits cited.

**Iterations:** 6 (4 for #4730, 2 for #4736)
**Converged:** Yes, both
**Fixed:** every BLOCKER, WARNING and CONVENTION raised | **Deferred:** none recorded | **Asked:** none

### Validation

- **Full suite:** 12542 tests, 0 fail (222 skipped) on Mortals at **303440f09**, hash f4ade834 (the
  same hash as this proof: the commits after it are the plan file, already in 303440f09, and an
  empty trailer commit).
- **Surface gate:** that run's only red was the #2518 gate naming render-consolidated-projects-3052.js
  and render-phone-offline-718.js (surface token `pj-list`). Both ran green through the runner on
  303440f09 (with render-projects, render-project-rows, render-projects-badges-4730 and
  render-workchip-zero-2157: "all page checks passed"), and the control, render-projects-badges-4730
  on origin/main's page, failed (rc=1) as it must. Trailers added in the empty commit **8d9d71185**;
  the gate, re-run alone on it, exits 0 and prints both overrides.
- No second full run: nothing but a commit message changed after 303440f09 (Splinter 12:05 agreed).

### Per-Iteration Breakdown

#### #4730 round 1
**Reviewer model:** not recorded
**Self-generated:** not recorded
- [WARNING] server.test.js — pinned the old "Nothing running" / "Can't tell" labels --> FIXED (ba238462c)
- [WARNING] render-project-rows — its idle fixture no longer drew a pill for the layout reads --> FIXED (ba238462c)
- [WARNING] web/index.html — the stripe was about 1.01:1 on the light ground and close to the hover --> FIXED (ba238462c: a 3.5% ink wash, measured 1.02 to 1.25, hover still changes a shaded row)
- [WARNING] the check — did not prove the dark pass ran dark --> FIXED (ba238462c)
- [CONVENTION] a brittle source regex for the stripe; stale comments --> FIXED (ba238462c)

#### #4730 round 2
**Reviewer model:** not recorded
- [WARNING] the check did not parse color(srgb) and hid the raw colour --> FIXED (5d5fad0a1)
- [WARNING] the stripe direction per theme was not asserted --> FIXED (5d5fad0a1)
- [WARNING] a grid with a stale list class could paint stripes --> FIXED (5d5fad0a1)
- [CONVENTION] pill comments --> FIXED (5d5fad0a1)

#### #4730 round 3
**Reviewer model:** not recorded
- [WARNING] web/index.html — the blind-roster strip note was itself a new "we cannot see" line, list view only, against Josh's rule --> FIXED (fc5cb2e81, removed)
- [WARNING] the check's arms did not assert their preconditions (fold walk marked rows; no "we cannot see" text anywhere; hover compared with an unshaded row) --> FIXED (fc5cb2e81)

#### #4730 round 4
**Reviewer model:** not recorded
**New findings:** NITs only. **Converged.**
- [NIT] the reason-grep +1 note named the wrong emit site --> taken (a20889370, measured)
- [NIT] a blank line --> taken (a20889370)

#### #4736 round 1
**Reviewer model:** not recorded
- [WARNING] render-workchip-zero-2157 still expected a floored zero to show --> FIXED (6bc1789bb, as its README row says)
- [WARNING] the check's case-3 comment did not match its assertion; the unreadable-lines 0+ was untested --> FIXED (83db3ea64)

#### #4736 round 2
**Reviewer model:** not recorded
**New findings:** NITs only. **Converged** (card comment, 15:09Z).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 4730 r1 | WARNING | server.test.js | BRANCH | old labels pinned | FIXED | ba238462c |
| 2 | 4730 r1 | WARNING | docs/browser-checks/render-project-rows.js | BRANCH | idle fixture drew no pill | FIXED | ba238462c |
| 3 | 4730 r1 | WARNING | web/index.html | BRANCH | stripe invisible, near hover | FIXED | ba238462c |
| 4 | 4730 r1 | WARNING | render-projects-badges-4730.js | BRANCH | dark pass unproven | FIXED | ba238462c |
| 5 | 4730 r1 | CONVENTION | web.* | BRANCH | brittle stripe regex, stale comments | FIXED | ba238462c |
| 6 | 4730 r2 | WARNING | render-projects-badges-4730.js | SELF | color(srgb) unparsed | FIXED | 5d5fad0a1 |
| 7 | 4730 r2 | WARNING | render-projects-badges-4730.js | SELF | stripe direction unasserted | FIXED | 5d5fad0a1 |
| 8 | 4730 r2 | WARNING | web/index.html | SELF | stale list class paints stripes | FIXED | 5d5fad0a1 |
| 9 | 4730 r3 | WARNING | web/index.html | SELF | blind-roster note is a new "we cannot see" line | FIXED | fc5cb2e81 |
| 10 | 4730 r3 | WARNING | render-projects-badges-4730.js | SELF | arms assert no preconditions | FIXED | fc5cb2e81 |
| 11 | 4736 r1 | WARNING | render-workchip-zero-2157.js | BRANCH | floored zero expected visible | FIXED | 6bc1789bb |
| 12 | 4736 r1 | WARNING | render-workchip-zero-2157.js | SELF | case-3 comment vs assertion; 0+ untested | FIXED | 83db3ea64 |

Origin here is from the commit record (a finding in code a previous round's fix wrote is SELF), not
from a blame lookup at the time.

### Outstanding questions
None.

### NITs
- #4730 r4: reason-grep note, a blank line (taken).
- #4736 r2: NITs only (taken or left; not recorded).

### Strengths
- The rule is Josh's, verbatim, and the check has a control that fails on main's page.
- The list stripe is measured composited on the ground in both themes, not read from source.
