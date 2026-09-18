# adopt-dashboard-pointer-3237 -- point `kosmos adopt` at the dashboard Import flow (#3237)

## Problem
`kosmos adopt` (the CLI) only inspects LIVE tmux sessions (via `status.paneRoster()`) and mints a
credential for a process running right now. It has no awareness of on-disk `~/.claude/agents/*.md`
persona files, so a user importing an existing fleet through the CLI gets a silent near-zero result
with NO pointer to the flow that works. (Sheila's fresh install: adopt found only the running
orchestrator and reported zero for the 14 not-yet-running personas; the dashboard "Import an agent
you already have" -> Load folder imported all 14 from disk without issue.) Not #3188, not data loss:
nothing was missing, it is a discovery-UX gap in the adopt CLI.

## Fix -- (b) the floor
Add an `importHint()` helper in `cmd_adopt`'s node block that prints a short pointer: adopt only
adopts agents running right now; for agents created but not yet running, open Kosmos and use "Import
an agent you already have" to load them from disk. Called on BOTH non-confirm REVIEW paths:
- the `!p.eligible.length` path (nothing eligible), AND
- the review-before-`--confirm` path (some eligible, but the user may have more on disk).
NOT on the `--confirm` success path (they have already adopted). Calling it on both matters because
the reported scenario had `orchestrator` running (so `eligible.length >= 1`), which a floor placed
only on the empty-eligible branch would miss.

## Rejected -- (a) make adopt disk-scan itself
The dashboard Import flow ALREADY disk-scans (via engine/discover) and works; adding a second
disk-scan-and-adopt path in the CLI duplicates a proven mechanism and risks divergence (the exact
second-implementation issue the #3188 challenge-loop just flagged). For a LOW-pri UX gap, pointing to
the working flow is proportionate. What would change my mind: if product wants the CLI to be a
first-class import path independent of the dashboard, (a) is worth the duplication -- a follow-up.

## Scope
- `install/kosmos` only (the CLI's `cmd_adopt` node block). No engine/JS-module change, no web/ change.
- Informational output only: the adoption behavior (plan/apply) is unchanged; the hint is a footer on
  the review paths. No em dashes.

## Test plan
- `bash -n install/kosmos` clean (shell syntax).
- `node --check` on the extracted `cmd_adopt` node block = OK (the importHint helper + both calls).
- No test asserts the adopt CLI output (grep: none), so the added footer breaks nothing.
- Full node suite green (merge-as-green, Kosmos, no reviewer).

Addresses #3237
