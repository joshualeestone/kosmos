---
pre_challenge: true
method: challenge-loop
branch: membertold-8938
diff_hash: 48f8582e014a657a029da8e090e871e2c1becb9e68753a159f2deee2bca8dd39
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T17:43:08Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (blind reviewers, alternating opus and sonnet)
**Converged:** Yes. Round 8's two warnings were a duplicate of a round-6 deferral and a point the reviewer itself called "a note, not a defect"; the standing cap of 8 rounds (Splinter 2026-10-22) was also reached with no BLOCKER open.
**Total findings:** 33 (3 BLOCKERs, 22 WARNINGs, 3 CONVENTIONs, 5 actionable NITs folded in; other NITs listed below)
**Fixed:** 30 | **Deferred:** 3 | **Asked (awaiting user):** 0

Initial validation (6.0) was run once at convergence rather than per round, by the fleet's standing practice (one full suite at a time on this Mac); focused suites (up to 56 related test files, 1,336 tests) and the new browser check ran after every round. The first full run at convergence went red on two registrations this branch had missed (SITE_COUNTS for the new check; a stub in web.plus-stale); both fixed in 2bf3baa831, and the second full run passed (30,715 tests, 0 failures).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html acctPolicyApply: one Gemini row stands for two policy ids (google, antigravity) --> FIXED (5265f624b9: options no longer rewritten; a text line in the menu's own names)
- [WARNING] family sees "not allowed by your company" --> FIXED (5265f624b9: "Your family" wording; family arm in browser check)
- [WARNING] option marks race museAsk / Windows Qwen rewrites --> FIXED (5265f624b9: no option rewriting)
- [WARNING] DeepSeek/GLM/MiniMax ids not mapped --> FIXED (5265f624b9: server sends providerName names)
- [WARNING] selected disallowed provider cleared under a live flow --> FIXED (5265f624b9)
- [WARNING] what-the-company-sees shown under "asks it to report nothing" --> FIXED (5265f624b9: only while reporting)
- [WARNING] what-the-company-sees list incomplete vs build() --> FIXED (5265f624b9, then replaced in iteration 2)
- [NIT] server inForce() side effect --> FIXED (5265f624b9: current())

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 of the above (the hand-written report sentence from iteration 1; fixed by deleting it per 6e)
- [WARNING] report sentence overstates for narrower consent words --> FIXED (894351d017: show the company's accepted words instead)
- [WARNING] "chats never in it" vs flagged events --> FIXED (894351d017: sentence deleted)
- [WARNING] "Agents cannot use any other provider" too strong --> FIXED (894351d017: "for new agents")
- [WARNING] You menu line shown without Kosmos+ membership --> FIXED (894351d017)
- [CONVENTION] plan weakest premise incomplete --> FIXED (894351d017)
- [NIT] unknown ids said as "this provider"; "yet"; plusOrgIn comment --> FIXED (894351d017)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (stale comment)
- [BLOCKER] engine/orgenroll.js rememberConsent dropped never lines, so "Never sent" could never show; test planted the fixture --> FIXED (084fd769b4: kept; test through enroll, mutation control fails without it)
- [WARNING] backsUp words missing beside "Never sent" --> FIXED (084fd769b4)
- [WARNING] provider line not in aria-describedby --> FIXED (084fd769b4)
- [WARNING] workOrgPaint held a failed read a minute; join/leave lag --> FIXED (084fd769b4)
- [CONVENTION] comment still cited orgrollup build() --> FIXED (084fd769b4)
- [NIT] export placement --> FIXED (084fd769b4)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js list with an unnamed id said "allows only X" or "allows none" falsely --> FIXED (af5794a9d0: no list sent then)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] provider line stayed above the success view --> FIXED (cecf7d9ad2; web.connect-success-1656 asserts it)
- [WARNING] "on this computer" too broad (policy is per Kosmos) --> FIXED (cecf7d9ad2: "in this Kosmos")
- [CONVENTION] acctPolicyMark name/comments described the dropped design --> FIXED (cecf7d9ad2: renamed acctPolicyNote)
- [NIT] untested visit guard; engine test patched the hash; misleading test title --> FIXED (cecf7d9ad2)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] slow answer could show the line on the success view --> FIXED (0c1ff30d38, test with control)
- [WARNING] current() vs inForce() can disagree --> DEFERRED: inForce() keeps the last good policy until a newer one is applied (orgpolicy.js fails closed) and an ended enrollment clears both; they differ only while a newly served bundle waits for the next hourly refresh
- [WARNING] company's words shown in Kosmos's own voice --> FIXED (0c1ff30d38: "Your company's words for this computer."; lines are bounded by cleanList)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (workOrgFrom from iteration 3)
- [WARNING] provider line carried into Sign in again after close --> FIXED (a07d3c5347: cleared in closeAcctAdd; browser-check arm)
- [WARNING] stale workOrgPaint read could undo a fresh leave --> FIXED (a07d3c5347: generation count, test with control)
- [NIT] #5532 comment moved by the splice; acceptedNever note --> FIXED (a07d3c5347)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new after deduplication, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (current() vs inForce(), DEFERRED in iteration 6)
- [WARNING] acctPolicyNote does not check r.ok --> DEFERRED: a non-JSON body lands in the catch and the advisory line stays hidden, which the reviewer also called "a note, not a defect"
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html acctPolicyApply | BRANCH | Gemini row vs two policy ids | FIXED | 5265f624b9 |
| 2 | 1 | WARNING | web/index.html acctPolicyMark | BRANCH | family sees company wording | FIXED | 5265f624b9 |
| 3 | 1 | WARNING | web/index.html acctPolicyApply | BRANCH | races museAsk / Qwen rewrite | FIXED | 5265f624b9 |
| 4 | 1 | WARNING | web/index.html ACCT_POLICY_ID | BRANCH | compat vendor ids unmapped | FIXED | 5265f624b9 |
| 5 | 1 | WARNING | web/index.html acctPolicyApply | BRANCH | in-flight selection cleared | FIXED | 5265f624b9 |
| 6 | 1 | WARNING | web/index.html plusOrgSees | BRANCH | shown when no reports | FIXED | 5265f624b9 |
| 7 | 1 | WARNING | web/index.html PLUS_ORG_SEES | BRANCH | list incomplete | FIXED | 5265f624b9 |
| 8 | 2 | WARNING | web/index.html PLUS_ORG_SEES | SELF | overstates narrower words | FIXED | 894351d017 (deleted) |
| 9 | 2 | WARNING | web/index.html PLUS_ORG_SEES | SELF | chats line vs flagged events | FIXED | 894351d017 (deleted) |
| 10 | 2 | WARNING | web/index.html acctPolicyNoteText | BRANCH | "cannot use any other" too strong | FIXED | 894351d017 |
| 11 | 2 | WARNING | web/index.html workOrgShow | BRANCH | You menu line without membership | FIXED | 894351d017 |
| 12 | 2 | CONVENTION | .claude/plans/membertold-8938.md | BRANCH | weakest premise incomplete | FIXED | 894351d017 |
| 13 | 3 | BLOCKER | engine/orgenroll.js rememberConsent | BRANCH | never lines never stored | FIXED | 084fd769b4 |
| 14 | 3 | WARNING | web/index.html plusOrgSeesText | BRANCH | backsUp missing | FIXED | 084fd769b4 |
| 15 | 3 | WARNING | web/index.html acct-add-dialog | BRANCH | aria-describedby | FIXED | 084fd769b4 |
| 16 | 3 | WARNING | web/index.html workOrgPaint | BRANCH | failed read held a minute | FIXED | 084fd769b4 |
| 17 | 3 | CONVENTION | web/index.html plus-org-sees comment | SELF | stale build() claim | FIXED | 084fd769b4 |
| 18 | 4 | WARNING | server.js allowedProviderNames | BRANCH | unnamed id makes a false line | FIXED | af5794a9d0 |
| 19 | 5 | WARNING | web/index.html acctShowSuccess | BRANCH | line above success view | FIXED | cecf7d9ad2 |
| 20 | 5 | WARNING | web/index.html acctPolicyNoteText | BRANCH | "on this computer" too broad | FIXED | cecf7d9ad2 |
| 21 | 5 | CONVENTION | web/index.html acctPolicyMark | SELF | name/comment of dropped design | FIXED | cecf7d9ad2 |
| 22 | 6 | WARNING | web/index.html acctPolicyNote | BRANCH | late answer on success view | FIXED | 0c1ff30d38 |
| 23 | 6 | WARNING | server.js current() | BRANCH | current vs inForce | DEFERRED | fails-closed policy; differs only until hourly refresh |
| 24 | 6 | WARNING | web/index.html plusOrgSeesText | BRANCH | company claims in Kosmos's voice | FIXED | 0c1ff30d38 |
| 25 | 7 | WARNING | web/index.html closeAcctAdd | BRANCH | line carried into reauth | FIXED | a07d3c5347 |
| 26 | 7 | WARNING | web/index.html workOrgPaint | SELF | stale read undoes leave | FIXED | a07d3c5347 |
| 27 | 8 | WARNING | web/index.html acctPolicyNote | BRANCH | no r.ok check | DEFERRED | advisory line stays hidden on a bad body |
| 28 | 0 | BLOCKER | final-validation | BRANCH | SITE_COUNTS line and plus-stale stub missing | FIXED | 2bf3baa831 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] workOrgPaint and plusOrgMaybe keep separate once-a-minute caches (iterations 6, 8)
- [NIT] "Never sent" lines join with "; " here, ", " on the join screen (iteration 5)
- [NIT] WORK_ORG declared far below its callers; safe at load, measured by the browser check's no-page-errors arm (iteration 8)
- [NIT] "for new agents" could add "and provider switches" (iteration 7)

### Strengths (across all iterations)
- Both new /api/org fields sit after the isViaScreen gate; a test pins that an agent caller gets neither (every iteration)
- The Settings line is the company's own accepted words, the record the board reports by, so it is true by construction (iterations 3 to 8)
- The provider line never rewrites options, and withholds the list rather than say anything false (iterations 4 to 8)
- Tests lift the real page functions with controls that fail (mutation-checked on the policy rule, the family exclusion and rememberConsent) (iterations 1, 3, 5)
