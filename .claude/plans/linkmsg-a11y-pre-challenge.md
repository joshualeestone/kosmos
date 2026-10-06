---
pre_challenge: true
method: challenge-loop
branch: linkmsg-a11y
diff_hash: 8b02264eee5edd41edc46a6e14b676b26baae0db52c865dce21813d0da3eaadf
validation: not run locally (suite queue). The page script parses; the browser check parses. The light-lane local run of render-dm-sideways-3969 and render-agent-pill-3958 gave up after the queue's 2700 s bound (9 runs ahead), so CI's browser-checks (selected by the new surface token) is the first run of the new assertion and the new count.
subdir_audit: not run (same queue)
timestamp: 2026-10-06T11:51:18Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: NO NEW ISSUES; it counted 83 chk() calls per engine by reading every loop)

#### Iteration 1 (sonnet)
- [HIGH] display:block at zero height is still a flex item of .dtext (gap 8px, 4px on a sideways DM), so the space #5387 recovered came back --> FIXED (visually hidden out of flow: position absolute, 1px, clip-path)
- [LOW] nothing asserted the empty line takes no space --> FIXED (render-dm-sideways-3969 asserts not display:none and position absolute on each sideways and wide run)
- Checked fine: #d-linklost-msg:empty out-specifies .fmsg; every writer uses textContent, so :empty matches only when truly empty.

#### Iteration 2 (opus)
- [BLOCKER] EXPECTED_PER_ENGINE stayed 73 while the new assertion added 10 chk() calls, so the check would fail every run --> FIXED (83, comment updated)
- [NIT] the assertion's label claimed "stays in the accessibility tree" but reads only the element's own display --> FIXED (label says what it reads)
- Process note: when this round started, my previous commit claimed the assertion but its edit had failed silently; the reviewer was told and reviewed the corrected head 22d037923.
- Checked fine: the 1px absolute box keeps its static position (no offsets), cannot cause sideways scroll; clip-path is supported unprefixed in the WebKit Kosmos uses; no other check asserts the old display:none.

#### Iteration 3 (sonnet)
- NO NEW ISSUES. 64 (8 sideways x 8) + 3 extras + 10 (2 wide x 5) + 4 portrait + 2 mouse = 83.
