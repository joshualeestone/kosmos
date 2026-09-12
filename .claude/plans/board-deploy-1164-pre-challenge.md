---
pre_challenge: true
method: challenge-loop
branch: board-deploy-1164
diff_hash: 2d91a7905ebb
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T02:01:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

Eight fresh blind reviews challenged the release wiring, deployment shape detection, destructive boundaries, and regression assertions. The final scoped review produced no new in-scope finding after deduplication. It repeated three findings already dispositioned to follow-ups: double restart and broader installer path hardening are tracked in #2870, while duplicated shape derivation is tracked in #2860.

## Fixed in this branch

- The original three-shape assertion was expanded to cover all four reporting outcomes.
- The release ordering assertion now anchors the real served check, frozen-tree deploy call, and restart call.
- The release uses the frozen cut tree as its deploy source and deploys only on a positive libexec working-directory match.
- An exact existing Git-worktree destination is refused before the installer can replace it. This narrow guard is blocking for automatic wiring because an override matching the checkout could otherwise replace tracked work.

## Deliberate scope cut

The loop temporarily explored broader `install-board.sh` hardening. Liu Kang ruled that work belongs to the existing #1647 deployment-tool lane, not the #1164 wiring lane. Those changes were removed from this diff and recorded in #2870. The raw exact-working-directory limitation remains disclosed in the committed plan. Shape-derivation consolidation remains #2860.

## Validation

Canonical TypeScript validation passed at diff hash `2d91a7905ebb`, including the release, restart, deployment manifest, shell syntax, and local-board integration tests. The subdirectory instruction audit passed. `git diff --check` is clean.

## Final ledger

- Iteration 1: fixed a vacuous ordering anchor and the blocking existing-repository destination risk.
- Iterations 2 through 7: identified broader deployment-tool safety and maintenance concerns. These were explored, then removed under the explicit scope ruling and transferred to #2870.
- Iteration 8: no new in-scope wiring finding. Repeated concerns deduplicated to #2870; strengths confirmed frozen-tree sourcing, positive shape gating, bundle fail-safe behavior, and deployed-version verification.
- Asked findings: zero.
- Deferred without a tracking card: zero.
