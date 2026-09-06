# blockdelivery-2259 - check-block-delivery.js runner-awareness (#2259)

## The gap

`tools/check-block-delivery.js` is a dev diagnostic that answers "which managed
instruction blocks actually REACHED the agents?" by reading the agents' brief files.
It filtered agents by `CLAUDE.md` presence and read only `CLAUDE.md`. After #2245, a
codex agent boots from `AGENTS.md` (not CLAUDE.md), so the diagnostic silently OMITTED
every codex agent - the exact population #2245 fixes - reporting a false clean, which is
the specific failure this tool's own header warns against.

## Fix

Resolve each agent's REAL brief per directory, rather than assuming CLAUDE.md:
- New `briefPath(dir)` helper: `AGENTS.md` if present, else `CLAUDE.md`, else null.
  This mirrors `engine/discover.js` (which prefers AGENTS.md to classify a codex
  folder) and `engine/create.js` `briefFilename(runner)`.
- The helper drives all three CLAUDE.md-only sites: the agent filter, the population
  floor message, and the per-agent text read.

Rejected: unioning both files' text ("has it" if the marker is in EITHER). That
risks a false CLEAN - a stale marker in an old CLAUDE.md would mask a missing one in
the current AGENTS.md, the exact defect this tool exists to catch. Reading the one
brief the agent actually boots from is precise.

## Weakest premise

The disk rule "AGENTS.md if present else CLAUDE.md" resolves a both-present migration
dir the same way discover.js does (AGENTS.md wins). If a codex->claude migration ever
left both, discover.js would also pick AGENTS.md, so the diagnostic stays consistent
with how the agent actually boots. Dev-only diagnostic, low severity.

## Tests (tools/test-block-delivery.sh, wired via package.json test:shell)

- a codex agent (AGENTS.md, no CLAUDE.md) is SEEN, not omitted (fleet count 2).
- a block missing from a codex agent's AGENTS.md is caught (UNDELIVERED to 1) - the
  old CLAUDE.md-only code would have read "delivered to all entitled", a false clean.
- a block present in AGENTS.md reads as delivered (the file is actually read).
- all prior arms (delivered / undelivered / partial / nothing-to-deliver / entitlement
  / stale / population floor) still pass.
