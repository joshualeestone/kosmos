---
pre_challenge: true
method: challenge-loop
branch: listpatch-9094
diff_hash: 27bfaafa367d66a952b31aea52f12620c669d6aa79faef5a39c4d3829123149d
validation: passed (Mortals)
timestamp: 2026-11-26T09:09:24Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the round limit), opus and sonnet alternating, one blind reviewer at a time.
**Converged:** No. No BLOCKER in any round; what was left is recorded below.
**Validation:** full suite on Mortals at 2d789b099f, 03:08 CST 11-26: rc 0, entry status clean, remote hash equal to
the local diff hash above. Both browser-check gates pass on the branch (surface trailers for four checks, each run here).

The full per-round ledger is "## Review ledger" in .claude/plans/listpatch-9094.md; this is its summary.

#### Iteration 1 (opus)
- [WARNING] web/index.html patchBoardHtml - rows matched by position, so one insert rewrote every row after it --> FIXED: keyed by data-agent
- [WARNING] My Agents still rewrote its whole list --> FIXED: through the patcher
#### Iteration 2 (sonnet)
- [WARNING] a row moving down moved every row it passed --> FIXED: the longest in-order run stays, a detach counter and a move-down arm
#### Iteration 3 (opus)
- [WARNING] the reorder had no test on every validation --> FIXED: web.board-patch-9094.test.js runs the real function
#### Iteration 4 (sonnet)
- [WARNING] the count guard was dead code --> FIXED: recorded nodes replace it
#### Iterations 5 to 8
- [WARNING] unkeyed and text-node pieces uncovered --> FIXED (5, 7)
- [WARNING] the parts memos outlived their markup memos --> FIXED: cleared together (7)
- [NIT] in-place state on kept nodes --> DEFERRED: audited in reviews 4, 6 and 8, no writer found
- [NIT] a focus pin around every patchBoardHtml caller --> DEFERRED: callers unchanged
- [NIT] rank-matching cost for unkeyed pieces --> DEFERRED: #alist has no whitespace between rows

### Final Ledger
Fixed: every WARNING above. Deferred: three NITs, each with its reason in the plan. After review: the browser-checks
README row, the surface trailers, and the #9104 tmpscope line in the new test file (each measured, listed in the plan).
