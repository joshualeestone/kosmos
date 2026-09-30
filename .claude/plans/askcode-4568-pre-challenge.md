---
pre_challenge: true
method: challenge-loop
branch: askcode-4568
diff_hash: 52c9357c09726237491c71f97bd54ce73334ffb79c39416bb3526428b102cb7b
validation: partial (gated browser runs of the spill control and the 16-shot sweep, plus 98 focused unit tests; the full suite is left to CI)
subdir_audit: passed
timestamp: 2026-09-29T20:03:26Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 7 actionable (0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs), 17 NITs
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

**What changed before the loop.** #4568 was filed (by me) as a product bug. Before building, the real device code's shape was read in kosmos-relay (`match_code`: always `XX-XX`), which showed the spill came from mobile-shots' stub (`482 913`, a sign-in code's shape). A first cut that resized long code groups in web/index.html was reverted before any commit reached review; the loop reviewed the tool-only change.

**Validation, stated exactly.**
- Gated box turn at dce6b6283 (Liu Kang's "Johnny go", heavy-gate `--twice --quiet-box` CLEAR), 2026-09-29:
  - 18:10:03Z, `MSHOTS_COVER_CONTROL=spill --screens allow-card --sizes se --themes light --engines chromium`: exit 2, "the code does not fit its card: 1 of 7 code boxes leave the card, the farthest by 24px".
  - 18:10:09 to 18:10:51Z, the 16-shot allow-card sweep with `K7-3M`: 16/16 ok, 0 errors, 0 overflow, exit 0. All 16 viewed (the card region, on one contact sheet): the code sits inside its card at every size, both engines, light and dark.
- An earlier turn at 7e28ccb87 (17:40Z) gave the same red and a clean 16/16; the fit check was reworked after it, hence the second run.
- REBASE, disclosed: dce6b6283 was stacked on #4561's branch. After #4561 merged, this branch was rebased onto origin/main (clean) as a89e32e83. Across the rebase, mobile-shots.js gained only main's two agent-page screens (#4550), browser-checks.sh only a #4525 board, and none of web/index.html's changes touch `.askreq`, `.askcode`, `.devcode`, `paintAsk` or `#cmnotice`. The browser runs were not repeated on the rebased head.
- Focused unit tests on the rebased head: 98/98 (tools.mobile-shots-desktop, tools.mobile-shots-leak-718, render-talk-goldencard-2519, browser-checks-reason-grep, browser-checks-pr-select-4119, browser-checks-selectors, tools.browser-checks-wired).
- The full kosmos suite was not run locally (the box is turn by turn); CI runs it on the PR.
- This account has no pre-challenge-gate hook linked; this proof is written from the loop's ledger by hand.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] docs/browser-checks/README.md: "Two gate arms" with three listed --> FIXED (850cfbb36)
- [WARNING] tools/browser-checks.sh: arm header and echo lines called the fit check a "cover" check --> FIXED (850cfbb36): neutral "control" lines; the main arm's comment names the fit check
- [NIT] fit check vs hit-test picked different buttons, no null guard (fixed); only the first card measured (fixed: every laid-out card); "the last by" was really the farthest, and right side only (fixed); spill at desktop cannot go red (noted in a comment, later a refusal)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] the fit check read geometry once, with no settle --> FIXED (0186fa046): polled up to 3 s
- [WARNING] the desktop note was an unmeasured claim --> FIXED (0186fa046, then bc3e568ae): reduced to the one measured figure
- [NIT] "every phone size" unverified (fixed: says where it was measured); README "cover checks" (fixed); padding box vs container (kept, reviewer agreed); relay-only guarantee (kept, plan says so)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [NIT] a wrong width figure in a comment (fixed by deleting it, f3ed753d4); label prefix note (fixed); ragged comment (fixed); code-less card refusal note (fixed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] the plan's "about 17%" and the comment's 24px disagreed --> FIXED (bc3e568ae): only the measured 24px is kept
- [NIT] promax/android reasoning (resolved by removing the reasoned note); left-side overflow untested (kept); plan's weakest part (kept)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] `spill` at the desktop size only arms nothing and passes --> FIXED (d472801f6): refused, with a test
- [NIT] the poll comment's reason (fixed); plan's finished line vs measured (fixed: Measured section); the 24px is one measurement (kept, labelled)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (plus 1 duplicate: the re-run on the final head, resolved by the 18:10Z turn)
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.
- [NIT] plan quoted the old message wording (fixed); match_code's last substantive change is 08-24, not 08-29 (fixed); the shape is guaranteed by the relay only (fixed: plan says so)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/README.md | BRANCH | "Two" arms, three listed | FIXED | 850cfbb36 |
| 2 | 1 | WARNING | tools/browser-checks.sh | BRANCH | fit check labelled as a cover check | FIXED | 850cfbb36 |
| 3 | 2 | WARNING | docs/browser-checks/mobile-shots.js | SELF | single read, no settle | FIXED | 0186fa046 |
| 4 | 2 | WARNING | tools/browser-checks.sh | SELF | unmeasured desktop claim | FIXED | 0186fa046, bc3e568ae |
| 5 | 4 | WARNING | docs/browser-checks/mobile-shots.js | SELF | reasoned vs measured figure | FIXED | bc3e568ae |
| 6 | 5 | WARNING | docs/browser-checks/mobile-shots.js | BRANCH | spill at desktop arms nothing | FIXED | d472801f6 |
| 7 | 6 | WARNING | (duplicate) | BRANCH | re-run owed on the final head | DEFERRED | resolved by the 18:10Z turn |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Listed per iteration above with their outcome.

### Strengths (across all iterations)
- The card was re-diagnosed from the relay's source before building; the product change was reverted and the reason recorded
- The fit check has its own red control in the gate (exit 2 plus its exact message), refused when it would arm nothing (no allow-card screen, no phone size)
- The check measures the card's content box on both sides, polls, covers every laid-out card, and fails loudly on a missing card or code
