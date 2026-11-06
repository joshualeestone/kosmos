---
pre_challenge: true
method: challenge-loop
branch: alwaysallow2-8121
diff_hash: a79c9540a113ac79f4f68bdf912ee129ce36cab6c806d987108ba35c9cf53ad0
validation: local (mode selftest 312/312, download selftest 70/70, 49 node files reading main.swift or the bundle script: 588 tests, 0 fail); the full suite runs in PR CI
subdir_audit: passed
timestamp: 2026-11-06T23:59:49Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (one blind general-purpose reviewer at a time)
**Converged:** Yes. Round 6 raised no BLOCKER and no WARNING. Round 3's one BLOCKER is fixed and re-measured.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] Forget during an account check was overridden by a late onAccount --> FIXED (stillKept re-checked; row + mutant)
- [WARNING] one onAccount made the name trusted for the run --> FIXED (keptConfirmedAt, one hour; row + mutant)
- [WARNING] Always Allow offered where it cannot hold (signed out, no board) --> FIXED (offered only when the list confirms; row + mutant)
- [WARNING] stand-in answered synchronously, so async paths could not fail --> FIXED (held answers; joined-check and page-change rows)
- [NIT] page change mid-check was silent --> FIXED (tellDownloadFailed once)
- [NIT] Reload did not clear the unconfirmed set --> FIXED

#### Iteration 2
- [WARNING] Always Allow pressed this run lasted the run --> FIXED (confirmed for the hour instead; row + mutant)
- [WARNING] Don't Allow on a kept computer did not forget it, so Reload saved silently --> FIXED (row + mutant)
- [WARNING] the question waited on two list reads (up to 30 s) --> FIXED (verdict reused, bounded offer read)
- [NIT] any ok list without the host forgets the name --> KEPT (fails safe: the person is asked)

#### Iteration 3
- [BLOCKER] the hour used systemUptime, which stops while the Mac sleeps --> FIXED (wall clock keptClock, a future reading expired; row + mutant)
- [WARNING] an Allow voided by a page change forgot a kept computer --> FIXED (personSaid flag; node pin + mutant)
- [WARNING] the 3 s offer read could not fit the board's 4 s probe --> FIXED in round 3 (8 s), revisited in round 5
- [NIT] stale checkedVerdict --> FIXED (cleared on Reload, Forget, any answer); [NIT] stamped at press --> FIXED (stamped at the reading)

#### Iteration 4
- [WARNING] a leftover reading could offer Always Allow hours later --> FIXED (reused only under 5 s)
- [WARNING] the alert did not say Don't Allow forgets a kept computer --> FIXED (one sentence when kept)
- [NIT] the question was not counted in alertsOnScreen --> FIXED; [NIT] Forget row proved no single read --> FIXED; wording "or choose Forget" --> FIXED
- Rebased onto main (kosmos#8120 added willAsk; carried through the check). Selftest count 49 on main + 19 = 68.

#### Iteration 5
- Verified: #8120's page states on every check path (confirmed no asking, unconfirmed asking once each, page changed failed).
- [WARNING] a second download from the new page was voided by the first's page change --> FIXED (per-download commit count; row + mutant)
- [WARNING] no row counted willAsk on the check path --> FIXED (0 / 2 / 0 row; mutant calling it early fails 1/3/1)
- [WARNING] "asking" sent seconds before the question --> FIXED (offer read 2 s; a slow list only drops the button, decided in the plan)
- [NIT] a commit during the offer read voids that question's Allow --> KEPT (the question's existing void rule)

#### Iteration 6
- No BLOCKER, no WARNING. Built; mode 312, download 70. Reviewer mutant (keptUnconfirmed insert removed) crashes the selftest loudly.
- [NIT] a check's void failure alert can open over another computer's question (Return lands on OK, then Don't Allow: the safe side) --> KEPT, same shape as #7952's existing alert

### Mutants run by the author (each fails its own row)
stand-in ignored (3 rows), ok check dropped, stillKept dropped, page guard dropped, hour ignored, offer always on,
Always Allow as a run allow, Don't Allow not forgetting, future reading not expired, per-download commits collapsed,
willAsk before the check, void path as the person's answer (node pin).
