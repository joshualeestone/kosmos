---
pre_challenge: true
method: challenge-loop
branch: askfocus-3978
diff_hash: cd955b9d4c0cd748af9026e464ea39a698e04d9bc43ca4ad848a4bc067b01b93
subdir_audit: passed
timestamp: 2026-09-26T22:02:44Z
converged: true
---

## Challenge loop: #3978 device-ask rows keep keyboard focus

#### Iteration 1 (blind, opus)
- [HIGH] web.allow-card.test.js pinned `askAgo(d.first_seen)`; the card now calls askAgoSpan --> FIXED (pin moved).
- [MEDIUM] aria-relevant on a descendant span is not read, and a textContent swap is an addition --> FIXED: aria-live="off" on the span; the comment says it is not measured with a screen reader.
- [LOW] a retry failing with the same words was an identical write, silently skipped --> FIXED: askAct forgets the last write.
- [LOW] "2 minutes ago" assertion could read 3 on a slow machine --> FIXED (any minutes).

#### Iteration 2 (blind, sonnet)
- [MEDIUM] a request crossing the hour fades, rewriting the rows and dropping focus once --> FIXED: askWrite returns focus to the same button (data-ask + data-id) after any real rewrite; new browser arm ages the request past the hour.

#### Iteration 3 (blind, opus)
No issues found. NO NEW FINDINGS.

## Evidence
- render-plus-panel-3829.js: all PASS, including the four #3978 arms (Allow same node and focused after two real polls; time filled; focus returns after the hour fade; Review keeps focus).
- Controls: pre-fix page, all three original arms FAIL; refocus removed, only the hour-fade arm FAILS.
- web.allow-card.test.js 9/9, web.plus-stale.test.js pass.
- Full suite (tools/run-tests.sh) at 8c1868749: exit 0, 10121 pass, 0 fail; the #1720 and #2518 gates ran inside it and passed.
