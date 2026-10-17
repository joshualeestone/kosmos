---
pre_challenge: true
method: challenge-loop
branch: teammap-6103
diff_hash: 6b5d51f2220323376cdea5eb80c60fc20ef3837080d155050c26f767b796c8b8
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T01:16:26Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (iteration 1 is 6.0's fix-and-validate pass; iterations 2 to 5 are blind reviewer passes)
**Converged:** Yes
**Total findings:** 12 actionable (2 BLOCKERs, 9 WARNINGs, 0 CONVENTIONs, plus 1 deferred), 15 NITs
**Fixed:** 10 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** none (6.0 initial validation failed; synthetic findings from the helper)
**New findings:** 2 BLOCKERs
**Self-generated:** 0 (synthetic findings are BRANCH by instruction)
- [BLOCKER] initial-validation: no-name-refs-3071 failed - the unit test's fixture names matched a protected external name --> FIXED (d5848ba23d): non-real names (roo, pixel, quill)
- [BLOCKER] initial-validation: tools.browser-checks-wired failed - render-teammap-6103 was never run by the runner --> FIXED (d5848ba23d): added to gated.txt

#### Iteration 2
**Reviewer model:** opus (the session default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:62118 - the map's "!" ignored present members the needs-you block draws red without a needsYouHere --> FIXED (2fde462991): pjTeamMap takes pjRedHere, the same predicate as pjNeedsNotice; mutant red
- [WARNING] web.teammap-6103.test.js:84 - a closed task with open parts was never tested alone --> FIXED (2fde462991)
- [WARNING] web/index.html:67296 - a repaint of the open map dropped keyboard focus --> FIXED (2fde462991): focus restored by data-agent; browser arm with a forced new node; mutant red
- [NIT] web/index.html:62137 - movedBy is the mover's own report (no change)
- [NIT] web/index.html:6385 - the "!" could overlap a long name --> taken (padding)
- [NIT] web/index.html:6380 - no focus-visible ring --> taken
- [NIT] render-teammap-6103.js:51 - fixed server wait (accepted; matches siblings)
- [NIT] web.teammap-6103.test.js:144 - wiring pinned by source regex (accepted)

#### Iteration 3
**Reviewer model:** sonnet (a different model from iteration 2, per 6a)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 acted on as SELF
- [WARNING] web/index.html:62099 - nothing showed movedBy actually reaches the browser through the route --> FIXED (b6bbac4e81): a browser arm writes a moved part into the board's projects.json and reads "tmada handed tmben 1 open part" back through GET /api/projects and the page, after a screen-given CONTROL; partsOf without its movedBy carry (mutant) reds it
- [NIT] web/index.html:62126 - JSON key round-trip for hand-off pairs (accepted)
- [NIT] web/index.html:67303 - focus read order (no change; correct)
- [NIT] web/index.html:62112 - needs() evaluated several times per member (taken in iteration 4)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the vacuous assertions sat on lines written by 2fde462991)
- [WARNING] web.teammap-6103.test.js:109 - the "holds" assertions matched greedily across members and could not fail; the progress.closed skip had no guard --> FIXED (ddb7ccfee1): held() reads one member's button; the progress.closed arm asserts no hand-off; mutant now red
- [WARNING] docs/browser-checks/README.md:570 - the row and the check's header omitted the focus and route arms --> FIXED (ddb7ccfee1)
- [WARNING] docs/browser-checks/render-teammap-6103.js:166 - editing projects.json while the board runs could race --> DEFERRED: projects.readAll reads the file on every call and mutate keeps no cache; the edit and the reload are milliseconds apart; the arm's failure prints the disk reading after write and after the route, so a race names itself
- [NIT] web/index.html:62125 - needs() recomputed per node --> taken (needSet once per map)
- [NIT] web/index.html:67297 - button and map used different roster filters --> taken
- [NIT] web.teammap-6103.test.js - absent/restarting status words untested --> taken
- [NIT] web/index.html:62108 - linear cards.find per member (accepted at team sizes)
- [NIT] render-teammap-6103.js:47 - fixed server wait (accepted)

Validation after iteration 4 passed (21267 tests, 0 failed).

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] web/index.html:62137 - the typeof LAST guard only helps lifted tests (no change)
- [NIT] web.teammap-6103.test.js - wiring pinned by source regex (accepted; the browser check covers behaviour)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.teammap-6103.test.js | BRANCH | Protected external name in fixtures | FIXED | d5848ba23d |
| 2 | 1 | BLOCKER | docs/browser-checks/gated.txt | BRANCH | Browser check not wired | FIXED | d5848ba23d |
| 3 | 2 | WARNING | web/index.html:62118 | BRANCH | "!" disagreed with the needs-you block | FIXED | 2fde462991 |
| 4 | 2 | WARNING | web.teammap-6103.test.js:84 | BRANCH | Closed task with open parts untested | FIXED | 2fde462991 |
| 5 | 2 | WARNING | web/index.html:67296 | BRANCH | Focus lost on repaint | FIXED | 2fde462991 |
| 6 | 3 | WARNING | web/index.html:62099 | BRANCH | movedBy never shown to reach the browser | FIXED | b6bbac4e81 |
| 7 | 4 | WARNING | web.teammap-6103.test.js:109 | SELF | Vacuous "holds" assertions | FIXED | ddb7ccfee1 |
| 8 | 4 | WARNING | docs/browser-checks/README.md:570 | BRANCH | Stale row and header | FIXED | ddb7ccfee1 |
| 9 | 4 | WARNING | docs/browser-checks/render-teammap-6103.js:166 | BRANCH | Disk edit could race the board | DEFERRED | No cache measured; race self-identifies |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- 15 across iterations 2 to 5, listed per iteration above; 6 taken.

### Strengths (across all iterations)
- One source for each fact: orgTreeOf for the shape, WV_PROVIDER for families, stateCopyOf for status words, and pjNeedsNotice's own predicate for the "!".
- Hand-offs only from a recorded movedBy, proven end to end through the real route.
- Unit tests on the real projects and tasks engines; every fix carries a mutant that reds it.
