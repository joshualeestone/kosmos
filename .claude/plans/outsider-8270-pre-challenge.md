---
pre_challenge: true
method: challenge-loop
branch: outsider-8270
diff_hash: 0ec69a7f26994768f18122a4ea31469be3fdbb39199dc7a8e9f5190bc6bc0e01
validation: passed
subdir_audit: passed
timestamp: 2026-11-09T00:34:59Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Round 6 (a whole-branch read) raised NITs only.
**Total findings:** 2 BLOCKERs, 12 WARNINGs, 0 CONVENTIONs open, NITs below
**Asked:** 0

Final validation on 81a36e4: 27717 node tests passed, 0 failed, plus the shell shards; subdir audit clean. Earlier runs were stopped by me each time the code changed; one earlier run failed on one-derivation.test.js (the our-agent check must go through projects.ourCard), fixed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 7 WARNINGs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/messages.js outsidersNote: a header naming the person read as "not on this project" --> FIXED (0bba541): only an identified agent is named
- [BLOCKER] the same for a member on another computer in a federated room --> FIXED (0bba541)
- [WARNING] stray terminal sessions offered to kosmos msg; capitalised non-names; arrow headers not tied to the poster; a name members share; the poster named; one word of a display name after @ --> FIXED (0bba541)
- [WARNING] no note on an unrecorded post or a folded retry --> DEFERRED: as ambiguousNote before this change; in the plan

#### Iteration 2 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 2 NITs
- [WARNING] one word of a display name in a header --> FIXED (e4ca5e7)
- [WARNING] a colleague on another computer is not named --> DEFERRED: decided, a false statement is worse; in the plan
- [WARNING] a crashed pane is still offered kosmos msg; "thanks @homer" gets the sentence --> DEFERRED: the refusal is honest; the sentence is true
- also fixed: validation red on one-derivation.test.js (e4ca5e7)

#### Iteration 3 (whole branch)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 5 NITs
- [WARNING] words after a name got past the shared-name guard --> FIXED (cfbb51e)
- [WARNING] guards with no test of their own --> FIXED (cfbb51e, fafdead)

#### Iteration 4 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] the @ scan lacked the all/everyone skip --> FIXED (4fbbb93)

#### Iteration 5 (whole branch)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
- [WARNING] a run of leading words made a phrase mean an agent --> FIXED (81a36e4): a header name counts only whole

#### Iteration 6 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
**Converged.**

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Strengths (across all iterations)
- Reuses the last-key note slot, so both CLIs and older ones print it with no client change.
- Every guard was perturbed and its test went red.
