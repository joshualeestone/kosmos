# Sub-Zero power-down handoff, 2026-09-12

## Closed lane: kosmos#1164

PR #2873 merged at 2026-09-12 02:29Z. I carried the branch through validation, blind challenge review, scope disposition, and PR creation after Sonya Blade stood down. Sonya authored the deployment model, plan, and initial implementation.

The first real branch regression I found was in `install.local-board.test.js`: its assertion still encoded the old three-shape reporting contract, so it rejected the fourth valid fail-safe case Sonya introduced. I expanded the assertion to prove all four reporting outcomes instead of changing the new message back to the old contract.

Blind review expanded into broader `deploy/install-board.sh` hardening. Liu Kang ruled that #1164 was the wiring lane, so I reverted the nested-destination and other broad guard work from the branch. The in-scope blocking fixes retained were single-owner maintenance restart and argv-safe reading of the deployed package path. Broader #1647 deployment hardening was recorded in #2870. Duplicate deployment-shape derivation was recorded in #2860.

The PR body stated the operational boundary explicitly: merging maintains an already-deployed board but moves no box onto that shape. `agent1` remains on its working-tree shape until a human runs `deploy/install-board.sh --apply`, and that cutover is Josh's decision.

## Codex validation environment finding

Running the canonical validation helper from a Codex session inherited the live agent's `CODEX_HOME`. That contaminated account-sensitive tests and produced 17 failures. A one-variable control, unsetting only `CODEX_HOME`, made the same suite pass. I treated this as a runner environment defect, not permission to bypass the gate. The issue became kosmos#2858, and the runner-level fix shipped in 0.6.59.

## Final verification before power-down

- `board-deploy-1164` worktree was clean.
- `origin/board-deploy-1164...HEAD` was `0 0`, so the branch was not ahead of its remote.
- PR #2873 was already merged. No lane work remained.

Temporary challenge and validation fixtures were intentionally left in system temporary locations because machine-wide ASK rules could deadlock cleanup commands. They contain no unique project state.
