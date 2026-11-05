---
pre_challenge: true
method: challenge-loop
branch: recoveries-5536
diff_hash: a1c28c2a7f7cca21dc3dece731a79cc039cd974b43a1105463e45d083f87917d
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T10:54:16Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the round cap after iteration 8, under Splinter's standing usage rule (10-22 and 10-26: "stop at 8 unless a BLOCKER is open"). No BLOCKER was open in any round.
**Total findings:** 19 WARNINGs and CONVENTIONs in the ledger below, plus NITs
**Fixed:** 15 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] engine/recoveries-5536.test.js - no test for another company's list being dropped, or for a review's Accept carrying it --> FIXED (5953b9ffa9, both red when their guards are removed)
- [WARNING] web/index.html - the heading said "opened" against the plan's own rule --> FIXED (5953b9ffa9)
- [WARNING] web/index.html - "Someone no longer in your company" claimed a fact the contract does not give --> FIXED (5953b9ffa9)
- [WARNING] engine/orgenroll.js - recoveriesMore ignored --> FIXED (5953b9ffa9)
- [NIT] family wording; the invisible character in a fixture --> FIXED (5953b9ffa9); future at --> FIXED in iteration 8

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the "older ones" line, written in 5953b9ffa9)
- [WARNING] web/index.html:20518 - the "older ones" line said "company" to a family --> FIXED (55dfaac6d6)
- [NIT] surrogate slice; future at; an all-malformed list --> comment added (55dfaac6d6)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the promise, written in 5953b9ffa9)
- [WARNING] web/index.html:56024 - "Your company's admins can see every one in its log" was a promise nothing here supports --> FIXED (02466863db, deleted)
- [NIT] markup comment, heading from the constant, a count of 0, two untested arms --> FIXED (02466863db)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:56023 - a family, which has no backup, could be told about its backup --> FIXED (d03fedffcd, red without the guard)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 of the above (the "reviewer" wording, 5953b9ffa9; the browser-check deferral in the plan, 8bc3de154f)
- [WARNING] web/index.html:56031 - the heading and "A reviewer" claimed a role the contract does not give --> FIXED (07c2b86144)
- [WARNING] plan - the browser check deferral's reason was false (a sibling check stubs /api/org today) --> FIXED (07c2b86144, render-recoveries-5536 written; its first run found a long name overflowing its line at 375 px, fixed)
- [WARNING] web.recoveries-5536.test.js:83 - /api/org covered only by a source regex --> FIXED (07c2b86144, server.recoveries-5536.test.js on a real board; red when the screen gate is removed)
- [CONVENTION] engine/orgenroll.js:419 - two copies of the name-strip regex --> FIXED (07c2b86144, shownName)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (the browser check's direct paint, 07c2b86144)
- [WARNING] web/index.html - is `who` on a key release the person given the key --> DEFERRED: yes, read in relay content.rs `release` (the audit actor is the reviewer the key is sealed to); the line now cites it (6ba8bbc2d5)
- [WARNING] render-recoveries-5536.js:62 - the check painted the block itself --> FIXED (6ba8bbc2d5, deleting the plusOrgPaint wiring reds 5 checks)
- [WARNING] stale heading and 30-day drop untested --> DEFERRED: covered by web.recoveries-5536.test.js
- [CONVENTION] plan wording --> no change needed (the reviewer's own conclusion)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the shared CSS rule, 07c2b86144)
- [WARNING] render-recoveries-5536.js:113 - the reviewers half of the shared wrap rule unmeasured --> FIXED (e4d000210d; red without the selector, 283 px in a 277 px line, so the reviewers list overflowed on main)
- [NIT] comment scope, markup comment, README count --> FIXED (e4d000210d)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/orgenroll.js - a far-future at would show "Invalid Date" --> FIXED (3d2245c1a8, more than a day ahead is refused; red without the cap)
- [WARNING] web/index.html - the heading against the files-opened lines --> DEFERRED: the wording is the plan's named weakest premise, for a designer
- [WARNING] engine/orgenroll.js:1191 - recoveriesMore with an all-malformed list --> FIXED (3d2245c1a8, comment)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/recoveries-5536.test.js | SELF | company and Accept arms untested | FIXED | 5953b9ffa9 |
| 2 | 1 | WARNING | web/index.html | SELF | heading said opened | FIXED | 5953b9ffa9 |
| 3 | 1 | WARNING | web/index.html | SELF | no-name text asserted a fact | FIXED | 5953b9ffa9 |
| 4 | 1 | WARNING | engine/orgenroll.js | SELF | recoveriesMore ignored | FIXED | 5953b9ffa9 |
| 5 | 2 | WARNING | web/index.html:20518 | SELF | "company" to a family | FIXED | 55dfaac6d6 |
| 6 | 3 | WARNING | web/index.html:56024 | SELF | unsupported promise about the admin log | FIXED | 02466863db |
| 7 | 4 | WARNING | web/index.html:56023 | SELF | a family told about its backup | FIXED | d03fedffcd |
| 8 | 5 | WARNING | web/index.html:56031 | SELF | a role claimed | FIXED | 07c2b86144 |
| 9 | 5 | WARNING | .claude/plans/recoveries-5536.md | SELF | false browser-check deferral | FIXED | 07c2b86144 |
| 10 | 5 | WARNING | web.recoveries-5536.test.js:83 | SELF | /api/org source-regex only | FIXED | 07c2b86144 |
| 11 | 5 | CONVENTION | engine/orgenroll.js:419 | SELF | duplicated strip regex | FIXED | 07c2b86144 |
| 12 | 6 | WARNING | web/index.html | SELF | who on a key release | DEFERRED | relay fact read and cited |
| 13 | 6 | WARNING | docs/browser-checks/render-recoveries-5536.js:62 | SELF | check painted the block itself | FIXED | 6ba8bbc2d5 |
| 14 | 6 | WARNING | web/index.html | SELF | stale heading and drop untested | DEFERRED | covered by the web test |
| 15 | 6 | CONVENTION | .claude/plans/recoveries-5536.md | SELF | plan wording | DEFERRED | no change needed |
| 16 | 7 | WARNING | docs/browser-checks/render-recoveries-5536.js:113 | SELF | reviewers half of the wrap rule unmeasured | FIXED | e4d000210d |
| 17 | 8 | WARNING | engine/orgenroll.js | SELF | far-future at | FIXED | 3d2245c1a8 |
| 18 | 8 | WARNING | web/index.html | SELF | heading against files-opened lines | DEFERRED | wording for a designer |
| 19 | 8 | WARNING | engine/orgenroll.js:1191 | SELF | recoveriesMore with no rows | FIXED | 3d2245c1a8 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, not acted on)
- a lone surrogate after the 64-character cut (iteration 2)
- dates without a year in the stale heading, as the reviewers heading (iterations 5, 7)
- the enroll timeout's status fallback does not read recoveries, as it does not read grants (iteration 7)
- the keep-on-absent blocks duplicate the grants blocks (iteration 8)
- no test of the world arm of the keep rule (iterations 5, 6)

### Strengths (across all iterations)
- The keep-on-absent rule mirrors reviewerGrants exactly and is tested both ways, with controls.
- Names are written as text in a bdi after one shared strip; the web test's element throws on innerHTML.
- /api/org sends recoveries to the screen only, joined here; a real board test covers an agent token, no company and another world.
- A real browser check (both engines, both themes, 11 per engine pinned) paints through the page's own paint and found a real overflow, already on main in the reviewers list.
- Mutations proven red, each restored: no company guard, no Accept carry, no 30-day filter, release said as opened, no family guard, no screen gate, no paint wiring, no reviewers selector, no future cap.
