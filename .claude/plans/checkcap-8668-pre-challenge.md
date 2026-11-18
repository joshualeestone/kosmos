---
pre_challenge: true
method: challenge-loop
branch: checkcap-8668
diff_hash: 0edcb26658381a5edd6a07c9e9a5c63d014d0f93bffcbcbd9eb6f3ae441bb668
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T01:45:44Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (two loops: rounds 1-8 on the card, rounds 9-13 on a feedback fix Splinter added mid-run)
**Converged:** Yes (round 8 for the first loop; round 13 for the second, NITs only)
**Total findings:** 17 actionable (0 BLOCKERs, 16 WARNINGs, 1 CONVENTION-class), plus NITs
**Fixed:** 14 | **Deferred:** 3 (one concern raised three times) | **Asked (awaiting user):** 0

Initial validation (6.0) was not run before iteration 1: on this fleet a full validation is a heavy queued turn,
and the standing rule is to converge review first, then queue once. The full validation runs at 6j on the final head.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] install/kosmos, tools/windows/kosmos-cli.js: unmet-only check ran before met|unmet, so a bad verdict was refused with the wrong reason --> FIXED (04d2fb8ee3)
- [NIT] success line echoed the raw --moved-to (012) --> FIXED; [NIT] page join had no separator --> FIXED; [NIT] task show omitted the moved check's sentence --> FIXED; [NIT] doc comment missed the 409 --> FIXED; [NIT] CLI accepted --moved-to 0 --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] web/index.html: a task with no checks of its own showed "Done when" over an empty list --> FIXED (d1d052dec6)
- [WARNING] engine/tasks.js: dead link if the target task is deleted --> DEFERRED: no code path removes a task from a project (grep of engine/tasks.js and server.js, with a control that matched 53 lines); removing the project removes both ends
- [NIT] two-step shell case hard to read --> FIXED (comment); [NIT] && chain under set -e --> FIXED (if)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] engine/taskactphrase.test.js: no parity fixture for the moved-to activity row --> FIXED (2149eb191c), perturbation of the page copy turns it red
- [NIT] invisible test characters --> FIXED (escapes); [NIT] stale HTML comment --> FIXED; [NIT] closed target --> recorded as allowed in the plan; [NIT] page wording "reported" --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] engine/tasklist.js: another task's words printed without q() --> FIXED (cb892d2b34), perturbed red

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs (converged; NITs fixed, one more round run because the fixes changed code)
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [NIT] browser-check header wording, schema comment, tasklist read rule, conditional test assertion --> FIXED (4752ebf8b3; that commit did not parse, fixed in 89606a18c3 four minutes later)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] tools/windows/kosmos-cli.js: 309+ digit --moved-to became Infinity, sent as null --> FIXED (cee41d3378): both CLIs cap at 15 digits, perturbed red

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] docs/browser-checks/render-checkresults-8464.js: "not cut by the box" assertion could never fail --> FIXED (982c1fbde0): reads computed styles; a max-height plus overflow hidden perturbation turns it red

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs (1 duplicate of iteration 2's deferral), 0 CONVENTIONs, 2 NITs
**Converged** (first loop).

#### Iteration 9 (second loop: Splinter's feedback, a refused check must be named)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] both CLIs: "any other check you reported stands" was false for a whole-task refusal --> FIXED (81ae5a5d9a)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] both CLIs: "moved to task N" claimed from the input, not the board's answer --> FIXED (389d0b1022), older-board arm perturbed red
- [WARNING] plan did not name the version skew --> FIXED (plan)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] both CLIs: the unchanged answer skipped the link check --> FIXED (a78a864959)
- [WARNING] the Mac CLI matched movedTo anywhere in the answer --> FIXED (a78a864959): reads the reported check's own result; both perturbed red

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] refusal ended "Fix this one and run it again", wrong for a closed task --> FIXED (cba2fb6b7e)
- [WARNING] a re-report without --moved-to removes the link silently; dead link on a deleted target --> DEFERRED: deliberate (how a link is taken back; the CLI cannot know a prior link without a second read), recorded in the plan; deleted target as iteration 2

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
**Converged.**

### NITs left open (non-blocking)
- install/kosmos: the --moved-to readback does not check $NODE first; a missing runtime would say "did not record" rather than "could not confirm" (iteration 13)
- engine/tasklist.js: the moved-here read repeats checkResultsOf's rule by hand (iterations 9, 13)
- server.js: guideMasked can lengthen evidence past the cap before the count (pre-existing; iterations 7, 11)
- The figure 1000 is typed into both usage lines and the doctrine (iteration 9)

### Strengths (across all iterations)
- Character counting (Array.from) with an emoji boundary test; shared NOT_ONE_LINE_RE
- The link stored once and derived on the target, as replaced-by is
- No agent words reach innerHTML; task show quotes another task's words with q()
- One shared argument and refusal table runs both CLIs

### Final validation (6j)
Full suite on b79b1e92ec (detached-validate, this Mac): 29,083 node tests passed, 0 failed; all 4 shell shards green; validation-log PASSED hash=0edcb2665838. The first full run on cba2fb6b7e failed one test (the browser-check surface gate, via tools.shell-shard-4317); fixed with per-check trailers after running all five flagged checks headless (all pass).
