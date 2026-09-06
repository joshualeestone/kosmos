---
pre_challenge: true
method: challenge-loop
branch: fix-2323-remove-revoke
diff_hash: f435697e86e2a02ddba3225edae81872e8e2d45f0995068f910170a5d3b4c726
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T07:52:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (fresh blind reviewer each round, model varied: Opus / Sonnet)
**Converged:** Yes (iteration 2 returned no BLOCKER/WARNING/CONVENTION that was not a reviewer-endorsed deliberate tradeoff)
**Total findings:** 0 BLOCKERs, 3 WARNINGs | **Fixed:** 2 | **Deferred:** 1 (reviewer-endorsed tradeoff)

Both reviewers independently verified the core security property: the revoke keys on
the agent's single machine name (mint and revoke both apply store.safeKey; a raw
display-name removal is refused at plan() before reaching revoke), recordRemoval is
the one removal-commit chokepoint (the "nothing changed" abort correctly does not
revoke), and deleting the token file makes both resolve and resolveName fail for the
removed agent, closing the finding. Iteration 2 confirmed the new tests are
non-vacuous by disabling the revoke and re-running (both failed as expected).

### Per-Iteration Breakdown

#### Iteration 1 (Opus)
**New findings:** 2 WARNINGs
- [WARNING] engine/remove.js -- a revoke failure was discarded two ways (catch{} +
  ignored ok:false); a silent failure leaves the token alive with removal reporting
  REMOVED --> FIXED (f3ccee6a): the removal still proceeds (blocking would strand a
  half-removed agent) but a revoke failure is now LOGGED distinctly (the #1916
  fail-open posture).
- [WARNING] plan overclaimed capital/space "divergence" coverage --> FIXED
  (f3ccee6a): softened to the real reason (single machine-name form; a display-name
  removal is refused at plan() upstream, so there is no divergent input to defend).

#### Iteration 2 (Sonnet)
**New findings:** 1 WARNING (deferred, reviewer-endorsed)
- [WARNING] engine/remove.js -- a revoke failure surfaces only via console.error
  (stderr), not in the OUTCOME.REMOVED response, so an operator relying on the
  API/board response sees a clean success even if the revoke did not happen -->
  DEFERRED. The reviewer framed it as "a deliberate, documented tradeoff (best-
  effort, matching the #1916 fail-open posture) rather than an oversight" and did
  not block. The stderr log already surfaces it (the board's log); threading the
  revoke status into the response would change recordRemoval's boolean return
  contract and both call sites, for a rare (concurrent-mint / fs EACCES/EIO) fault.
  Recorded as a worthwhile follow-up, not for this slice.

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | revoke failure silently discarded | FIXED | f3ccee6a (log it) |
| 2 | 1 | WARNING | plan overclaimed divergence coverage | FIXED | f3ccee6a (softened) |
| 3 | 2 | WARNING | revoke failure not in the response, only stderr | DEFERRED | reviewer-endorsed tradeoff; stderr surfaces it; follow-up |

### Strengths (verified against the actual code by both reviewers)
- The revoke keys on `clean`, the single machine-name form already proven correct
  for jobFor/sessionFor/exists in removeInner; correctness does not rely on
  safeKey/slugFor agreeing on a divergent input (that path is refused upstream).
- recordRemoval is the sole removal-commit chokepoint; the abort paths skip revoke.
- Revoke placed after the DRY_RUN guard (a pure dry-run never unlinks a real token)
  and before the UNREADABLE record-write check (a half-removed agent still loses its
  token).
- Deferring the resolveAgentSender paneless-arm removed-check is sound: deleting the
  token file makes resolve and resolveName both fail, and a remote agent cannot
  re-mint, so the revoke alone fully closes the finding.
- Tests are genuinely end-to-end (real mint -> real revoke via fs.unlinkSync) and
  non-vacuous (verified by disabling the fix); 61/61 remove.test.js pass; restore +
  fresh-mint still works.
