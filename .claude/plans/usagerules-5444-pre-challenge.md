---
pre_challenge: true
method: challenge-loop
branch: usagerules-5444
diff_hash: 7891f1a3edf6a9f4f5e26515185c0b26735db8b422008c107a68f2aa46861792
validation: passed
subdir_audit: passed
timestamp: 2026-10-07T12:35:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: no new actionable finding; its one WARNING deferred on measured evidence)
**Total findings:** 13 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 10 NITs)
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

Final validation (6j) on 58ee98312: the full suite, 16098 tests, 15874 pass, 0 fail, 0 cancelled (val_rc 0); subdir audit clean; both browser-check gates pass. An earlier attempt was stopped by me to re-queue it with KOSMOS_WAIT_MAX_S=43200 after three sibling runs gave up in the shared-box queue.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] docs/browser-checks/render-token-usage-2617.js:554 — the first-load arm reloaded with domcontentloaded while every sibling uses networkidle --> FIXED (5068da72f, then 58ee98312: networkidle cannot settle because the reloaded address reopens Token Usage and holds the read itself, so the arm waits for load plus the section being shown)
- [WARNING] docs/browser-checks/render-token-usage-2617.js:546,559 — a hidden section would also read "no box", so the no-box assertions could pass for the wrong reason --> FIXED (5068da72f: each reading also requires the section's heading to have client rects at that moment)
- [NIT] render-token-usage-2617.js:543 — the comment named the arms in the wrong order --> FIXED (5068da72f)
- [NIT] render-token-usage-2617.js:546 — histDrawn read twice, so the message could describe a different read --> FIXED (5068da72f)
- [NIT] render-token-usage-2617.js:564 — rows >= 1 is loose; the fixture gives exactly 3 --> FIXED (5068da72f)
- [NIT] web/index.html:3132 — the CSS comment omitted the no-usage state --> FIXED (5068da72f)
- [NIT] web/index.html:3133 — focus inside the box drops to body if a re-read fails and empties it (very unlikely)
- [NIT] — (strength notes only)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] render-token-usage-2617.js:~567 — the first-load arm might pass without the rule because a fresh page's history is empty anyway --> DEFERRED: measured otherwise. With the rule removed the arm read {"drawn":true,"heading":true,"rows":0} and went red (the empty box still has a border and margin, so it has client rects); the reviewer's own text concluded "this is a note and not a defect"
- [NIT] render-token-usage-2617.js:~560 — release2 not in a finally (context close cleans it)
- [NIT] render-token-usage-2617.js:~561 — the 3-row control depends on the fixture's shape (commented)
- [NIT] web/index.html:3132 — comment accuracy confirmed
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-token-usage-2617.js:554 | BRANCH | reload wait raced the page's boot | FIXED | 5068da72f, 58ee98312 |
| 2 | 1 | WARNING | render-token-usage-2617.js:546 | BRANCH | no-box could pass on a hidden section | FIXED | 5068da72f |
| 3 | 1 | NIT | render-token-usage-2617.js:543 | BRANCH | comment order | FIXED | 5068da72f |
| 4 | 1 | NIT | render-token-usage-2617.js:546 | BRANCH | double read | FIXED | 5068da72f |
| 5 | 1 | NIT | render-token-usage-2617.js:564 | BRANCH | loose row count | FIXED | 5068da72f |
| 6 | 1 | NIT | web/index.html:3132 | BRANCH | comment omitted no-usage | FIXED | 5068da72f |
| 7 | 2 | WARNING | render-token-usage-2617.js:567 | SELF | first-load arm could be vacuous | DEFERRED | measured red without the rule |

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:3133 — focus inside the box drops to body if a failed re-read empties it (iteration 1)
- [NIT] render-token-usage-2617.js:~560 — release2 not in a finally (iteration 2)
- [NIT] render-token-usage-2617.js:~561 — fixture-shaped row count (iteration 2)

### Strengths (across all iterations)
- One CSS rule on an invariant the painter already guarantees: '' for nothing to show, rows otherwise; a re-read keeps the old rows, so nothing flickers (iterations 1, 2)
- Hiding the empty region removes an empty tabindex=0 region from the tab order and the accessibility tree (iterations 1, 2)
- The held read is a promise, not a timer, so "while loading" is a real state; with the rule removed both new assertions go red and the control stays green (iterations 1, 2)
