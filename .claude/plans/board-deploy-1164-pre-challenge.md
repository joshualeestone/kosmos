---
pre_challenge: true
method: challenge-loop
branch: board-deploy-1164
diff_hash: e7c4733a4424
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T02:13:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

Eight fresh blind reviews challenged the release wiring, deployment shape detection, destructive boundaries, and regression assertions. The final scope disposition retained the two defects owned by the wiring: duplicate restart and unsafe JavaScript path interpolation. Broader installer path hardening is tracked in #2870, while duplicated shape derivation is tracked in #2860.

## Fixed in this branch

- The original three-shape assertion was expanded to cover all four reporting outcomes.
- The release ordering assertion now anchors the real served check, frozen-tree deploy call, and restart call.
- The release uses the frozen cut tree as its deploy source and deploys only on a positive libexec working-directory match.
- Maintenance refresh exits before plist mutation or launchd reload, leaving the release pipeline as the single restart owner.
- Deployed `package.json` is passed to Node through argv, so an apostrophe in the libexec path cannot break version verification.

## Deliberate scope cut

The loop temporarily explored broader `install-board.sh` destination hardening. Liu Kang ruled that work belongs to the existing #1647 deployment-tool lane, not the #1164 wiring lane. Those changes were removed from this diff and recorded as P1/destructive work in #2870. The raw exact-working-directory limitation remains disclosed in the committed plan. Shape-derivation consolidation remains #2860.

## Validation

Canonical TypeScript validation passed at diff hash `e7c4733a4424`, including the release, restart, deployment manifest, shell syntax, and local-board integration tests. The subdirectory instruction audit passed. `git diff --check` is clean.

## Final ledger

- Iteration 1: fixed a vacuous ordering anchor and identified the adjacent destructive installer risk.
- Iterations 2 through 7: identified broader deployment-tool safety and maintenance concerns. These were explored, then removed under the explicit scope ruling and transferred to #2870.
- Iteration 8 and final disposition: fixed the duplicate restart and apostrophe-path crash in scope. Installer destination hardening deduplicated to #2870; strengths confirmed frozen-tree sourcing, positive shape gating, bundle fail-safe behavior, and deployed-version verification.
- Asked findings: zero.
- Deferred without a tracking card: zero.
