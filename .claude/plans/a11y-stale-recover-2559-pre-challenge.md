---
pre_challenge: true
method: challenge-loop
branch: a11y-stale-recover-2559
diff_hash: 0566d22589193ae25a101304079ac700b6c0b783180126629b873e76613fdbdc
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T12:33:53Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 0 blocking (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs) + 2 NITs
**Fixed:** 1 NIT (post-review polish, comment + diagnostic string only) | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty — the branch commit under review is not a loop fix)
**Converged** — no blocking findings.

The blind reviewer verified by content, not just reading:
- Traced the CONSUMING gate logic (`FR_GATES['tmux-a11y']` / `frReadGate` in web/index.html): `granted`/`blocked` both require `checkable === true`, so the new `checkable:false` branch can never gate Next — the #2912 non-blocking invariant is preserved; `actionable:true` only changes which affordance an uncheckable row paints.
- Proved the CONTROL test is real: mutated the route's `nativePresent` condition to unconditional-true, reran the suite, saw the browser control FAIL (actionable leaking to the no-native case), then reverted and confirmed 6/6 pass + clean tree.
- Confirmed the new branch is mutually exclusive with the #3113 `present:false` branch (they differ on `checkable`), and the corrected #3113 comment is accurate post-change.

**NITs (2):**
1. The new branch fires for `checkable:false` regardless of cause, so it also catches the path-key-mismatch sub-case (db readable, some tmux granted but not the bundled binary), where the original `because` ("we cannot read the grant") was technically inaccurate. **Addressed (post-review polish, no logic change):** reworded the comment to name BOTH checkable:false sub-cases (no-FDA unreadable + path-key mismatch) and note Turn On is the right action for both, and changed the `because` to "tmux is not confirmed granted for this install; turn it on to grant tmux" (accurate for both). The branch already keys on `nativePresent + checkable:false`, not on the sub-case, so no logic changed; 6/6 route tests still pass, and the tests assert `checkable`/`actionable`, not the `because` string.
2. The plan's weakest-premise note is honest about being unverified on a real fresh Mac (appropriate; the fresh-Mac verify is explicitly out of scope). No action.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | server.js:8552 | BRANCH | `because` inaccurate for the path-key-mismatch checkable:false sub-case | FIXED | comment + string reworded, no logic change |
| 2 | 1 | NIT | plan:21 | BRANCH | weakest-premise honest about fresh-Mac | DEFERRED | no action needed |

### Validation
- `node --test server.tmux-a11y-status-2911.test.js` -> 6 pass, 0 fail (4 original #2911 route cases + my 2 new #2559 cases: unreadable+native-present -> actionable, and the browser CONTROL -> NOT actionable).
- `node --test engine/a11ystatus.test.js server.a11y-status-regate-2559.test.js` -> 40 pass, 0 fail (no sibling regression).
- Repo has no repo-level validation helper hit for this JS change; the node --test suites above are the substantive validation. Subdir-CLAUDE.md audit: clean.

### Strengths (from the review)
- Consuming-gate logic traced to confirm #2912 non-blocking invariant preserved (iteration 1).
- Control test proven real by mutation-then-revert (iteration 1).
- Discriminator (`nativePresent`) fails safe on any error, in both `promptrequest.nativePresent()`'s own try/catch and the route's outer try/catch (iteration 1).
