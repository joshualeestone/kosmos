---
pre_challenge: true
method: challenge-loop
branch: claimstatus-8721
diff_hash: 7946ed7f054a6572e333332d764a579af50d8579ade55a982dcf2f92a3578226
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T14:44:08Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes: round 8 raised NITs only (5), all applied in cbd8a68069.
**Total findings:** 15 actionable (0 BLOCKERs, 10 WARNINGs, 5 CONVENTIONs), 31 NITs, counted from the eight reviewers' reports as tagged
**Fixed:** all actionable | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the full suite at cbd8a68069 passed on 2026-11-19 after the Mac restart (29849 JS tests, 0 failed, 582 skipped; all shell shards green), hash 7946ed7f054a. Two earlier full runs on 11-18 failed on load only (different tests each run, each failing file passing alone); a third and later runs could not start because the Mac was at its process cap. This run ran alone, with no overrides.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
- A status check that cannot reach the board said "may have happened" on the Mac; it now says it could not read the claim. "Nobody holds it" no longer promises a claim would take it; a refused check says Could not check; the person's branch cannot be reached by a status check --> FIXED (59bdf05045)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
- Status did not report a post that asks someone else first; it now says who and the minutes left, from the same helper the claim refuses with. Route comment names status; a non-member's refused check never names the holder --> FIXED (e997976712)

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
- Windows treated the status POST as a write, so a refused redirect said "check before doing it again"; it is now marked a read. Test header names --status --> FIXED (14fc02c9aa)

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- With the board not running, or an unreadable answer, status said a claim could not be kept or changed; it now says it could not tell who holds the post. Mac tests for curl 52 and 28 (exit 1, never may-have-happened); Windows tests for one minute, two names, an unreadable answer --> FIXED (325402e7cd)

#### Iteration 5
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- No test proved status writes nothing through the real /api/react route; added, unclaimed and held, with a claim as the control. Status agrees with a claim once an asked hold opens --> FIXED (b363dd768d)

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
- Not every failed status check used the same "could not tell who holds the post" line; now it does. One-line help names --status; a Windows refused-redirect test with a claim as control; plan notes an older board's answer --> FIXED (ffcbd29517)

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- The asked-hold line implied the hold always runs its full time; it now says "for up to N more minutes", true even when the asked member gives it back sooner --> FIXED (817b2fdb5e)

#### Iteration 8
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
- One wording for the asked names, Could not check for a board error, a test title and its asserts --> FIXED (cbd8a68069)
