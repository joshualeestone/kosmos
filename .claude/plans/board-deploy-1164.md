# board-deploy-1164: maintain an explicitly deployed board

Card: #1164. Branch: `board-deploy-1164`. Date: 2026-09-11.

The detailed implementation and handoff record is in `PLAN-1164.md` at the
repository root. This branch implements Model B from that record.

## Intended result

When a release box already runs `com.kosmos.board` from the libexec deployment,
the release refreshes that deployment from the frozen, just-verified tree before
restarting it. A board running from the repository keeps the existing restart
path. A bundle board, an unknown working directory, or an absent working
directory is left untouched.

## Boundaries

This pipeline change does not move any box to libexec. In particular, agent1
remains on its current working-tree deployment until a human deliberately runs
`deploy/install-board.sh --apply` there. That cutover is Josh's decision, and a
merge of this branch does not mean the live hazard is closed.

Mortals runs the end-user bundle shape, so the real release and restart
interaction cannot be exercised here without repointing a live board. The
reviewable proof is the shape-gate test and the existing restart tests. Live
adoption remains a separate human action.

## Decision record

Chosen: release-wired maintenance after explicit adoption, because manual-only
maintenance would leave deployed boards frozen when an operator forgets to
reapply the deploy script.

Rejected: automatically repointing repository or bundle boards during a cut.
That would turn a maintenance pipeline into an unapproved live migration.

Weakest premise: launchd's reported working directory remains a sufficient and
stable discriminator for all three deployment shapes. A fourth legitimate
shape, or evidence that launchd reports an aliased path for libexec, would
require a stronger identity signal before this gate should act.
