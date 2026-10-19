---
pre_challenge: true
method: challenge-loop
branch: notifcatalog-6487
diff_hash: 29d7dbec6343c8fad9e20273046c7ca21918b55d7937651590637b7e22807b9f
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T18:55:09Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14, alternating Opus (odd) and Sonnet (even)
**Converged:** Yes, at iteration 14 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs; 6 NITs)
**Total findings:** 2 BLOCKERs, 41 WARNINGs, 0 CONVENTIONs, many NITs
**Fixed:** every BLOCKER and WARNING | **Deferred:** NITs listed below | **Asked:** 0

Closing validation passed on head 433c0d074e (hash 29d7dbec6343). Docs only: docs/phone-notifications.md and the plan.

Every reviewer claim was read in the code before the doc changed from iteration 7 on. Iteration 7's BLOCKER was an
iteration-6 edit made from a reviewer's claim without reading ownbounds.tellBounds; that is the reason for the rule.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 7 WARNINGs
- [BLOCKER] the doc said tests already keep three wording copies equal; none exist and web/sw.js differs --> FIXED
- [WARNING] an "anything else" row that cannot reach a phone; the operator test notice missing --> FIXED
- [WARNING] "names the person" was really a reply to the person's post --> FIXED
- [WARNING] switch names did not match Settings --> FIXED (on-screen labels)
- [WARNING] four needs-you triggers merged and partly wrong --> FIXED (one row each)
- [WARNING] gating vague; the master switch's default not stated --> FIXED
- [WARNING] email timing and the #6488 interaction missing --> FIXED
- [WARNING] proposed wording not Josh's verbatim --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs: the shared needs-you window; room posts are not membership-checked; email timing and words;
the master switch by name --> all FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 5 WARNINGs: the phone must be approved by this computer; replied fires on any agent DM; posts need the
agent's token; the crash-loop key (later found unreachable, #6495); the email cutoff at restart --> all FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 5 WARNINGs: exact crash and stuck thresholds; outbox replies do not buzz; separate windows per kind;
what a tap opens --> all FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 4 WARNINGs: dropped, not delayed; nothing acknowledges a needs-you (the email hazard); the Settings
hint still live; the test notice and email wording outside the table --> all FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs: the crash tap; what a restart resets per row; stuck and helper scope; email
preconditions --> FIXED (one fix, the helper hold-back, was wrong; see iteration 7)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs
- [BLOCKER] a helper give-up during needs-you is cleared, not held (isMoot runs first) --> FIXED
- [WARNING] the email needs no phone; the test notice shares the wording code; crash/stuck/helper would be emailed
  with a sentence that does not fit them --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs: a quota give-up can arrive later; the room row overlapped the reply row; the #6488 risk
depends on Turn on; the acknowledgement claim's scope --> all FIXED

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 WARNING: the email risk contradicted the once-a-day limit --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 1 WARNING: "allowed" used for two different checks --> FIXED

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 WARNING (medium confidence): the crash title can show the session name --> FIXED (fallback stated)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, no factual errors: a permission prompt counts as needs-you; jargon --> FIXED (glossary)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 1 WARNING: the Android app's tap goes through the sign-in page --> FIXED

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Converged** -- no new actionable findings.

### Deferred NITs (iteration 14)
- the email limit is keyed by the agent's shown name (two agents with one name share it): true as written for normal use
- "helper" and "quota resume" stay as named, with the glossary and row text explaining them
- a helper's re-wait after a restart is its next failed tries, not a fixed time
- the Proposed section keeps "notification service extension" as the term Josh will meet elsewhere
- the "Not yet in force" paragraph stays one paragraph
- a tap with no usable address opens nothing (an edge case)

### Strengths
- Every shipped row was traced to its `phonenotify.happened` call site, and today's words to apns.rs and the
  coordinator's sw.js; later reviewers found no event missing.
- Shipped, to-ship, built-but-off and proposed are kept apart, and the privacy cost of message words is stated
  before the decision is asked for.
