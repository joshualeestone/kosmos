---
pre_challenge: true
method: challenge-loop
branch: guide-greeting-3947
diff_hash: 34ecdef88f112e11919528105eab17741b62db399d1679ed3b93db3e1331caa7
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T20:23:58Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 raised only NITs)
**Validation:** full validation passed on 8eb7b917 (validation-log hash 34ecdef88f11). Browser check render-assistant-bubble-3034: 104 passed.
**Note:** iterations 1 to 7 ran in earlier sessions; reviewer models and exact counts were not recorded there and are marked so. What each round changed is quoted from its commit.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** not recorded (earlier session)
- [WARNING] engine/roles.js - old paragraph not pinned to the literal text guides were born with --> FIXED (c150da08)
- [NIT] stale GUIDE_TAG claims; plan lacked the hosted relay copy --> FIXED (c150da08)

#### Iteration 2
**Reviewer model:** not recorded (earlier session)
- [WARNING] web/index.html - two quick idle closes counted as one (count updated after the save answered) --> FIXED (fbafa1ac), perturbed red

#### Iteration 3
**Reviewer model:** not recorded (earlier session)
- [WARNING] web/index.html - Keep it still counted; X on the offer counted; a slow earlier save could restore a reset count --> FIXED (0ea3709f), each perturbed red

#### Iteration 4
**Reviewer model:** not recorded (earlier session)
- [NIT] docs/browser-checks - the slow-save arm's delayed save could land in the next arm --> FIXED (0fa727c4)

#### Iteration 5
**Reviewer model:** not recorded (earlier session)
- [WARNING] web/index.html - parallel settings saves could leave the board out of step with the page --> FIXED (ad27ad04), ordered saves

#### Iteration 6
**Reviewer model:** not recorded (earlier session)
- [WARNING] web/index.html - one save that never answers held the Settings switch behind it --> FIXED (ef2064f1), timeout, perturbed red

#### Iteration 7
**Reviewer model:** not recorded (earlier session)
- [WARNING] web/index.html - the board-settings design still raced --> FIXED (4424b6be), count and Keep it moved to page storage; board setting back to two keys

#### Iteration 8
**Reviewer model:** opus
- [WARNING] docs/browser-checks/render-assistant-bubble-3034.js - the first Close for now's "nothing typed" condition untested --> FIXED (44a808cd), perturbed red
- [WARNING] same - the storage-refusing arm refused only writes --> FIXED (44a808cd), reads refuse too; Keep it while refusing added; perturbed red
- [WARNING] same - a failed Hide it save untested --> FIXED (44a808cd), perturbed red
- [NIT] web/index.html - a comment detached from its code --> FIXED (44a808cd)
- (Before iteration 8: the storage-refusing arm was proven to fail under its own name, e46fa3f2.)

#### Iteration 9
**Reviewer model:** sonnet
- [WARNING] web/index.html - the "first x asks once" comment above the wrong function --> FIXED (8eb7b917)
- [NIT] a dead fresh(0) reset in the check --> FIXED (8eb7b917)

#### Iteration 10
**Reviewer model:** opus
- [NIT] the composer is not asserted hidden while the offer is up --> DEFERRED: the page hides it (asbPaint); coverage only
- [NIT] the idle count survives turning the guide off and on in Settings --> DEFERRED: one close earlier than twice, reversible, one click
- [NIT] README B7c row and roles.test.js title slightly behind --> DEFERRED: wording only
