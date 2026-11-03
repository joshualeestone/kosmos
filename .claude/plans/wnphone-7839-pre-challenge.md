---
pre_challenge: true
method: challenge-loop
branch: wnphone-7839
diff_hash: 120d17a165c8efc0a98d7cd22cc2e6f57d9c4650c1bad280447dd958339ca746
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T11:52:27Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4's two WARNINGs repeat round 3's, both deferred and recorded on the card)
**Total findings:** 1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, NITs
**Fixed:** 4 | **Deferred:** 2 (on the card) | **Asked (awaiting user):** 0

Validation: each round ran web.whatsnew-phone-7839 and web.whatsnew-3955, the new browser check in Chromium and WebKit,
the browser-check wiring tests and both gates from inside the worktree; the full suite at 6j passed (26692 tests,
0 failed, build passed).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html - the phone-width arm read html.kremote, which kplusBar adds long after whatsNewCheck runs at load, so the Android app and phone browsers still got the window and recorded it --> FIXED (775e633e20), keyed on the page's address (kplusRemote)
- [WARNING] web.whatsnew-phone-7839.test.js - the remote arm passed on a stubbed class the page does not have yet --> FIXED (775e633e20), built from the host
- [WARNING] render-whatsnew-phone-7839.js - judged on a second, hand-made call --> FIXED (775e633e20), the load's own call after 1.5 s; a Kosmos+-address arm added
- [WARNING] web/index.html, plan - comments claimed html.kremote covered Android --> FIXED (775e633e20)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] render-whatsnew-phone-7839.js - the none arms could pass because the load was held, not guarded --> FIXED (6d8dc6b940), asked again with the holds cleared; red under the guard-removed mutant (4 asserts)
- [WARNING] plan - other desktop-only overlays not examined --> DEFERRED: named in the plan and on the card (the first-run tour, rebootNoteCheck, damagedFilesCheck, restartLineCheck)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - Android covered by width only (a Custom Tab cannot mark the page) --> DEFERRED: on the card and in the plan; needs an Android launcher marker
- [WARNING] plan - the card's second ask partly open --> duplicate of iteration 2's deferral; said plainly in the PR
- [NIT] render-whatsnew-phone-7839.js - no control on the load's own call --> FIXED (30c80ebf9e)
- [NIT] web.whatsnew-phone-7839.test.js - kremote in the iPhone arm --> FIXED (30c80ebf9e)

#### Iteration 4
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 new WARNINGs (2 duplicates of iterations 2 and 3), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] no browser arm for marked + Kosmos+ address + desktop width; the iOS view's install of userScripts unpinned; the README row omits the remote arms
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html (wnOnPhone) | BRANCH | kremote not set at load | FIXED | 775e633e20 |
| 2 | 1 | WARNING | web.whatsnew-phone-7839.test.js | BRANCH | stubbed class | FIXED | 775e633e20 |
| 3 | 1 | WARNING | render-whatsnew-phone-7839.js | BRANCH | judged on a hand call | FIXED | 775e633e20 |
| 4 | 1 | WARNING | comments, plan | BRANCH | kremote claim | FIXED | 775e633e20 |
| 5 | 2 | WARNING | render-whatsnew-phone-7839.js | SELF | none arms could pass when held | FIXED | 6d8dc6b940 |
| 6 | 2 | WARNING | plan | BRANCH | overlays not examined | DEFERRED | card comment 6601171751 |
| 7 | 3 | WARNING | web/index.html | BRANCH | Android by width only | DEFERRED | card comment 6601268303 |

### NITs (non-blocking)
- typeof guard on wnOnPhone is for lifted tests (2); a narrow desktop window over Kosmos+ also skips it (2)
- liftConst for PNAV_PHONE_MQ (3); README row omits the remote arms; marked + desktop width browser arm; userScripts install unpinned (4)

### Strengths
- The guard returns before any read or record, so a phone never records the version and the Mac still shows it
- The browser check injects the iPhone app's own mark script at document start, in Chromium and WebKit, with controls on both the load's own call and a re-ask
- Every new assertion is red under a mutant (the guard removed; the old kremote arm restored)
