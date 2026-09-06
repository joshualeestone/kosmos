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
- New `briefPath(dir)` helper: `CLAUDE.md` if present, else `AGENTS.md`, else null.
  CLAUDE.md-first mirrors `engine/discover.js` `connect()` ("CLAUDE.md wins when both
  exist: a person who has both has a Claude agent that also carries codex notes") and
  `engine/create.js` `briefFilename(runner)`. A codex-only dir (no CLAUDE.md) resolves
  to AGENTS.md correctly.
- The helper drives all three CLAUDE.md-only sites: the agent filter, the population
  floor message, and the per-agent text read.

Rejected: unioning both files' text ("has it" if the marker is in EITHER). That
risks a false CLEAN - a stale marker in an old CLAUDE.md would mask a missing one in
the current AGENTS.md, the exact defect this tool exists to catch. Reading the one
brief the agent actually boots from is precise.

## Weakest premise

A managed runner change MOVES the brief (create.js:1204-1233), so in the normal case
exactly one file is present and precedence is moot. Only an ambiguous both-present
folder turns on order, and CLAUDE.md-first matches discover.js connect() exactly, so
the diagnostic reads the file that folder actually boots. Dev-only diagnostic, low
severity.

## Tests (tools/test-block-delivery.sh, wired via package.json test:shell)

- a codex agent (AGENTS.md, no CLAUDE.md) is SEEN, not omitted (fleet count 2).
- a block missing from a codex agent's AGENTS.md is caught (UNDELIVERED to 1) - the
  old CLAUDE.md-only code would have read "delivered to all entitled", a false clean.
- a block present in AGENTS.md reads as delivered (the file is actually read).
- all prior arms (delivered / undelivered / partial / nothing-to-deliver / entitlement
  / stale / population floor) still pass.
