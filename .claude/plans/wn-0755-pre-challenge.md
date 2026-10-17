---
pre_challenge: true
method: challenge-loop
branch: wn-0755
diff_hash: 79a48e37bc2463b4f8e7e85729a6d1373f96b184b1117a03b58b249cbbbd66f5
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T04:57:02Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 18 (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 13 NITs)
**Fixed:** 3 | **Deferred:** 1 (a duplicate scope finding) | **Asked (awaiting user):** 0

Validation: full suite on Mortals at 917d1795c, 21408 tests, 0 failed, 0 cancelled, entry status clean; the #1720
browser-check gate passed on the trailer carried from the first commit; 6j local call skipped on that clean entry;
subdir audit rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json:6 - "a stuck pair can finish once both update" is false for a Mac paired with a Windows computer, whose connector ships in its own build --> FIXED (71017942b, "once both Macs update"; versions entry too)
- [NIT] the join notice dismissal is per browser and hands off to a connected-here line
- [NIT] "20 answers a day" names no subject
- [NIT] Windows shows 4 because the Mac-only item takes a shared slot (by design, tools/whats-new-pool.js)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json:19 - the team map is only in the tab layout's Members card; the consolidated layout hides it until #6324 --> FIXED (910643227)
- [NIT] the plan did not name the fifth, older highlight --> FIXED (910643227, one line in the plan)
- [NIT] "both Macs" may read unclear for a Mac-Windows pair; [NIT] "answers" is jargon

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json:5 - the first clause stated the new limits for every pairing; both sides must run a post-#422 connector --> FIXED (917d1795c, "With both Macs on this version, ..."; versions entry too)
- [NIT] the UI calls the layout "Separate tabs" --> FIXED (917d1795c, the line says "In the Separate tabs view")
- [NIT] the join notice is per browser; [NIT] "one stuck" had no subject (gone with the rewrite)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 after deduplication (1 WARNING matched ledger entries 1 and 3; 3 NITs)
**Self-generated:** 0
- [WARNING] "With both Macs on this version": a Mac-Windows pair is told nothing --> DEFERRED as a duplicate of 1 and 3: the line now states the condition it holds under, so a Mac-Windows pair is outside the claim rather than contradicted by it. "The computers on this version" would promise a Windows pair something the Windows build cannot be vouched for here; the same rule flipping between the two wordings is the sign to stop rewording it.
- [NIT] the title is a mild overreach (20 a day is a cap); [NIT] "a stuck pair can finish" is reasoned, not yet measured (the plan's weakest premise); [NIT] the quiet-projects line leaves out idle projects
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:6 | BRANCH | stuck pair, Mac-Windows | FIXED | 71017942b |
| 2 | 2 | WARNING | web/whats-new.json:19 | BRANCH | team map only in tab layout | FIXED | 910643227 |
| 3 | 3 | WARNING | web/whats-new.json:5 | BRANCH | limits need both sides new | FIXED | 917d1795c |
| 4 | 4 | WARNING | web/whats-new.json:6 | BRANCH | both Macs scope | DEFERRED | duplicate of 1 and 3; the line states its condition |

### NITs (non-blocking, across all iterations)
- The join notice dismissal is kept per browser (iterations 1, 3)
- "20 answers a day" has no named subject (iteration 1)
- The quiet-projects line omits idle projects (iteration 4)
- The pairing title calls a 20-a-day cap "several computers" (iteration 4)

### Strengths (across all iterations)
- The pool records prod 0.7.54 (lastProd, five titles marked shown) exactly as 0.7.54 served them
- Every claim was checked against main and relay main: MAX_ATTEMPTS 10, ANSWERS_PER_DAY 20, the epoch-file reset, the Dismiss notice button, the Team map button, the needs-you Dismiss
- The Browser-check trailer is on the first commit; no em dashes in any spelling
