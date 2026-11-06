---
pre_challenge: true
method: challenge-loop
branch: typedkeep-8092
diff_hash: d8968bd48e5c33875622af145a3f455271cf43438c0c0e2c12b2b3fea450a947
validation: clean on the final head (27520 tests, 0 fail, rc=0)
subdir_audit: not run (no CLAUDE.md under a changed path)
timestamp: 2026-11-06T10:09:06Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating). **Converged:** Yes: round 8, the final whole-branch read, found nothing to change (two NITs it judged not worth changing).

**What it is:** the follow-up carded on #8092 after its first PR. Use short names replaced names the person had typed as well as Kosmos's suggestions. Now a row is typed when the person's own input leaves a name that is not empty and not Kosmos's current suggestion (spaces aside; case counts); Use short names keeps it and says so; Another and Use short names make a row a suggestion again only when they change its name.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] an emptied box, or the suggestion typed back, counted as typed --> FIXED (typed = not empty and not the suggestion)
- [NIT] the all-none-free line changed wording; a control with vacuous parts --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] Another with no free name turned a typed name into a suggestion --> FIXED (only when the name changes)
- [NIT] coverage gaps --> covered in later rounds

#### Iteration 3
**Reviewer model:** opus
- [WARNING] HTML comment still said every open row is swapped --> FIXED
- [NIT] emptied-box test did not start typed; typed-back case untested; plan incomplete; case sensitivity unstated --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [NIT] "exactly" vs trimmed; the first plan not marked superseded --> FIXED
- [NIT] two spoken combinations untested --> covered in round 7

#### Iteration 5 (whole branch)
**Reviewer model:** opus
- [WARNING] plural and mixed lines untested --> FIXED (plural measured)
- [NIT] spaces and case untested; rows read by position; header; typed init --> FIXED

#### Iteration 6 (whole branch)
**Reviewer model:** sonnet
- [NIT] a comment misstated the state; the case check relied on the list's capitals --> FIXED

#### Iteration 7 (whole branch)
**Reviewer model:** opus
- [WARNING] the emptied-box check's proof sat in a wait that cannot fail; the none-free lines unmeasured --> FIXED (exact lines asserted; none-free reached by putting every short name on the board, both lines measured)
- [NIT] labels, a comment's place, a variable name, plan wording --> FIXED

#### Iteration 8 (final whole-branch read)
**Reviewer model:** sonnet
- No findings to change. Two NITs judged not worth changing (the plural arm checks one of the two kept rows by name, the count covers the other; the none-free arm sets the board's names after their read has long finished).
