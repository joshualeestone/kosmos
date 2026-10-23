---
pre_challenge: true
method: challenge-loop
branch: s7dc1-6590
diff_hash: 00f4f1a52327436d70d61fd094bf35a1cf1b2c21201f8cbac6080209078423e5
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T15:26:22Z
iterations: 3
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (c1a review 1, c1b review 1, a delta review of both fixes), plus a design review of the page.
**Converged:** No, only because the delta round's NITs (no BLOCKER, no WARNING) were fixed and not re-reviewed; the two
it did not take are decided in s7dc1-6590.md.
**Validation:** the Mortals full suite on head c049f741bb (rebased onto main after #6986's REMOTE_NOT_ALLOWED entries
met these; a union): **23538 tests, 0 failed** (hash 00f4f1a52327, the diff this proof hashes). Before the rebase,
6a2ab4aa65 passed 23537/0. An earlier run at 06ee38b5a3 failed only two source-pattern tests in web.allow-card.test.js, fixed in
6a2ab4aa65.
**Inert:** nothing here changes behaviour until the board-v2 marker exists (a later part writes it); every engine call
and route pins its no-marker path.

### Per-iteration breakdown (details in s7dc1-6590.md)
#### Iteration 1: 0 BLOCKER, 2 WARNING (c1a, engine and routes)
- [WARNING] a waiting-list read started before an Allow was served after it --> FIXED (generation check, race test)
- [WARNING] the board-session and screen gates could not fail in tests --> FIXED (board auth on; agent-token cases)
#### Iteration 2: 1 BLOCKER, 5 WARNING (c1b, the page)
- [BLOCKER] any error answer showed the section without the marker (an older board's 404) --> FIXED (v2 true only)
- [WARNING] a dropped row lost its sentence; T1 could not fail on the v2 gate; the class read as fact and no address;
  a screen reader never heard the answer; a new waiting browser was never scrolled into view --> all FIXED
#### Iteration 3: 0 BLOCKER, 0 WARNING (delta)
- [NIT] seven NITs; five FIXED, two DECIDED (see the plan)

### Weakest premise
That every new path is behind the marker; the tests pin each no-marker path, and the design review copy changes land in
a later part (s7dc4-6590), before anything is visible.
