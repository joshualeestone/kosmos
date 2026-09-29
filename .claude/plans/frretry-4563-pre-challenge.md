---
pre_challenge: true
method: challenge-loop
branch: frretry-4563
diff_hash: f51c192e03063ef40d3e7d2ebf46e760820b6202dcbd0a7ea937377fbaeb34e8
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T16:52:27Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: nothing at BLOCKER, WARNING or CONVENTION)
**Total findings:** 14 (0 BLOCKER, 3 WARNING, 0 CONVENTION, 11 NITs)
**Fixed:** 7 (2 WARNINGs in code, 1 WARNING met by the final gate, 4 NITs) | **Deferred:** 0 | **Asked (awaiting user):** 0 | **Accepted as stated:** 7 NITs
(Counted from the plan's tags: (W) and (N) per iteration, iteration 4's three NITs from its prose line.)

**Final gate:** full validation PASSED on af2b4ab43 (the full tools/run-tests.sh validation, 11:00 to 11:52 CDT, VAL_RC=0 AUDIT_RC=0, validation-log hash f51c192e0306). Deviation, recorded in the plan: step 6.0's baseline was not
run before review 1 (the Mac's suite slot was held by other agents' runs for 40+ minutes); this final run on the hashed
head replaces it, as iteration 3's WARNING required.

**What the branch does:** click-first-run's fresh() cleared `<data>/you.json`, but since #1848 the board writes
`<data>/Kosmos/you.json`, beside the flag, so a run_one retry always opened About-you already answered and failed two
assertions on every branch (reproduced on origin/main 7584512d1: attempt 1 rc 0, attempt 2 rc 1, two runs on one board).
YOU now sits beside FLAG; section 1 asserts its walk wrote that path (old-path mutation reds attempt 1); and a bounded
waitOverlay() in fresh() and section 10 stops an instant read or an Escape racing a late overlay (a never-shown control
still reds section 1 with 4 FAILs).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] docs/browser-checks/click-first-run.js section 3 / section 10: Escape right after load races a late overlay the same way --> FIXED (waitOverlay helper in fresh() and section 10, cdd654d46)
- [NIT] plan: the never-shown-overlay premise was reasoned --> FIXED (measured: a done:true route reds section 1 with 4 FAILs)
- [NIT] tools/test-install.sh:143: seeds data/you.json at the pre-#1848 path --> ACCEPTED here, follow-up posted on #4563

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the WARNING, on iteration 1's own comment)
- [WARNING] docs/browser-checks/click-first-run.js: "so a drift reds instead of hiding" claimed more than the guard covers --> FIXED (sentence cut to what the assertion checks, 8c24193e2)
- [NIT] section 9 has no waitOverlay --> ACCEPTED (advanceToAnchor waits for a usable control first)
- [NIT] a never-shown overlay costs up to 10 s per fresh() --> ACCEPTED (failing runs only)
- [NIT] the test-install.sh follow-up must actually be filed --> FIXED (comment 5892666725 on #4563)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the 837 ms NIT, on iteration 1's own comment)
- [WARNING] plan: the skipped baseline must be made up by a full validation on the final head --> FIXED (the final gate above)
- [NIT] the 837 ms figure read as a CI measurement --> FIXED (comment says local, 8x throttle; 7168beff0)
- [NIT] section 9's missing waitOverlay read as an oversight --> FIXED (one-line comment; 7168beff0)
- [NIT] a shorter timeout would fail a never-shown overlay faster --> ACCEPTED (10 s kept for loaded runners)

#### Iteration 4 (converged)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] waitOverlay comment line lengths --> ACCEPTED
- [NIT] "every caller expects the overlay" is the only guard against a future no-overlay fresh() caller --> ACCEPTED (stated in the comment)
- [NIT] the plan's follow-up and honesty notes --> ACCEPTED (observation, nothing to change)
**Converged.**

### Deferred
None.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Weakest premise (from the plan)
The overlay wait's safety against a never-shown overlay was reasoned, then measured (the done:true control). What stays
REASONED: one section-12 throw (#fr-alt, seen once in 12 fix runs, 0 in 5 main runs) is attributed to advanceToAnchor
reading a transitional frame, not to this change.
