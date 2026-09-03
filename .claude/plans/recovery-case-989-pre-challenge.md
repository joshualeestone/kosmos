---
pre_challenge: true
method: challenge-loop
branch: recovery-case-989
diff_hash: eaa265e43367122ceb848727db143230e28f60af9f326e1c32bf3749d48ecb27
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T12:00:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Re-run after a rebase.** This branch (PR #1875) was already challenge-looped and CI-green by its
author, then drifted behind main and went CONFLICTING. It was rebased onto current main; a
`module.exports` conflict in `engine/chat.js` was resolved by keeping both `storeText` (added on
main) and `resolveCard` (this PR). The rebase changed the diff hash, so the proof was regenerated
and the loop re-run blind against the rebased tree.

**Iterations:** 1
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (blind review of the rebased tree)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] engine/chat.js -- the refusal string "by exactly this name" reads slightly off now that the
  resolver tolerates case. --> DEFERRED: this is a pre-existing NIT the ORIGINAL author's challenge
  loop already saw and deferred; `engine/chat.test.js:181` pins the text, changing it is out of this
  PR's scope, and the string only fires when there is genuinely no case-fold match.
- [NIT] server.js:7965,7975 -- a DIFFERENT route (the project-agent message route) still bare-matches
  `sessionName === name`, so a mis-cased name is refused there while it now reaches the agent via the
  recovery route. --> DEFERRED: explicitly out of scope (not a #989 regression; the route refuses
  safely rather than mis-delivering). Filed as a follow-up card so the inconsistency is not lost.
**Converged** -- 0 new BLOCKER/WARNING/CONVENTION findings; 5 STRENGTHs confirmed the rebase resolved
correctly (both `storeText` and `resolveCard` present and exported exactly once, no undefined export,
no stale bare-match logic), `resolveCard` mirrors `claimantFor` (exact-then-case-fold, deliberate
STRIP difference documented at both sites), both send-path call sites (`addressable`, `viewport`)
route through `resolveCard`, null/missing handled, and the test returns the dangerous answer (a
mis-cased name is refused) if the fix is reverted.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | engine/chat.js:495 | refusal string wording post-fix | DEFERRED | pre-existing, test-pinned, out of scope |
| 2 | 1 | NIT | server.js:7965 | different project-route still bare-matches | DEFERRED | out of scope; filed as follow-up card |

### Strengths (iteration 1)
- Rebase resolved correctly: both `storeText` and `resolveCard` present exactly once and exported
  exactly once; no duplicated symbol, no export of an undefined name, no stale bare-match left.
- `resolveCard` mirrors `claimantFor` (exact-first-then-case-fold), agreeing on CASE and deliberately
  differing on STRIP (send case-folds, gate uses `store.safeKey`), preserving the security contract.
- Both send-path call sites fixed consistently; no bare `sessionName === key` remains in a chat.js
  send path.
- Correct null/missing handling; the exact-but-not-ours case is caught downstream by `addressable`'s
  `isNamedOurs` gate.
- High test quality: `chat.resolvecard-989.test.js` asserts the real defect with a strip-dimension
  control and null/absent/prefer-ours controls.

### Validation
- Affected-area tests green at the rebased HEAD: `node --test chat.resolvecard-989.test.js
  engine/chat.test.js` -> 120 tests / 120 pass / 0 fail. These cover the change's blast radius
  (`resolveCard`, `addressable`, `viewport`, and the #989 recovery path).
- The full local suite could not be run: `tools/run-tests.sh` correctly refused because the machine
  was reserved for a concurrent release cut (0.6.25) via the #1962 machine-claim guard, which must
  not be overridden while a release is live. The authoritative full-suite validation is therefore
  GitHub CI on the force-pushed branch (clean runners, unaffected by the local claim); this PR is
  merged only after CI is green.
- No `web/` change, so the #1720 browser-check gate is not triggered.
