---
pre_challenge: true
method: challenge-loop
branch: usage-stats-853
diff_hash: 83f808ded34f8c6490d515a0e57daeb734b366875cec6d4e5099ff7bd8b8a932
subdir_audit: passed
timestamp: 2026-08-25T15:31:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs, 1 additional NIT)
**Fixed:** 4 | **Deferred:** 1 (documented as an explicit, out-of-scope follow-up, not a silent drop)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/usage.js:79-96 — `walkJsonlRecursive` had no name/shape check and would walk ANY directory found under a project directory, not just `<sessionId>/subagents/` trees. Confirmed real sibling directories (`memory/`, `memory.pre-merge-...`) exist on this machine that currently carry no `.jsonl` but are not scoped out by construction --> FIXED (commit 9783603): `walkTranscriptsUnder` now only recurses into a subdirectory literally named `subagents` via a new `walkSubagentsTree` helper; regression test added (`a .jsonl in a sibling directory that is NOT named subagents/ is not walked`).
- [WARNING] engine/usage.js:194,209-224 — The disk-freeze cache's own doc comment overclaimed what it saves: `sinceDay` was always `wanted[0]` (the full requested window's earliest day), not the missing days' own span, so the accumulation/freeze work was not actually scoped to what was new --> FIXED (commit 9783603): scan range narrowed to `[min(missing), max(missing)]`; doc comment corrected to be honest that the freeze avoids re-summing, not re-reading (transcripts are not date-partitioned).
- [NIT] engine/usage.js:151-156,219-221 — Frozen per-day files under `ROOT/usage/` have no retention cap --> DEFERRED: low priority per the reviewer's own classification, no caller today exercises a wide `days` window that would accumulate meaningfully many files; noted for whoever eventually does.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/usage.js (whole read path) — All transcript reads used `fs.*Sync`, so `/api/usage` (and `scanUsage` generally) blocked Node's single event loop for the full scan duration -- every other route on this server, including agent status polling, would stall while a stats page's request was in flight --> FIXED (commit 73a86b3): the entire read path (`walkTranscriptsUnder`, `walkSubagentsTree`, `walkJsonlRecursive`, `scanUsage`, `dailyUsageByModel`, `ensureUsageDir`) converted to `fs.promises`; the server route uses `.then()/.catch()` instead of a blocking call. Verified with a real discriminating test, not an assertion on source text: a fixture large enough to take measurable time, a `setInterval(…, 1)` armed before the scan, ticks counted during it. Confirmed by deliberately reverting the code to `fs.*Sync` (twice, refining the fixture both times) and observing the test correctly go from passing to failing (0 ticks vs dozens) -- and separately confirmed an EARLIER version of this same test, routed through a real HTTP fetch(), could NOT discriminate the two cases at all (the socket round-trip alone gave the timer enough opportunities regardless of the handler's own blocking), so that version was removed rather than kept as a check that could not fail.
- [NIT] .claude/plans/usage-stats-853.md:29 — The plan's stated case-count and final full-suite tally had drifted from the actual committed test file and a real full-suite run --> FIXED: plan file updated to match the actual final state (below).
- [NIT] engine/usage.js:95 (now renumbered) — `SYNTHETIC_ROW`'s raw-line regex is inherited verbatim from `readContext`'s existing exclusion in status.js and shares its known fragility (matches anywhere on the line, not scoped to `message.model` specifically) --> DEFERRED: not a new risk introduced by this change, and fixing inherited behavior in already-shipped production code is out of scope for this card.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Converged** — no new actionable findings. Five strengths noted (root-discovery reuse, the four-bucket-never-blended discipline, the real event-loop-yield regression test and its own documented history of a version that could not fail, the `MAX_DAYS` clamp with a dedicated test, and the route's exact-match pathname with no path-traversal surface on `frozenDayPath`).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/usage.js:79-96 | Recursive walk not scoped to subagents/ trees | FIXED | 9783603 |
| 2 | 1 | WARNING | engine/usage.js:194,209-224 | Freeze-cache scan range not narrowed to missing days | FIXED | 9783603 |
| 3 | 1 | NIT | engine/usage.js:151-156,219-221 | No retention cap on frozen per-day files | DEFERRED | Low priority, no caller exercises it today |
| 4 | 2 | WARNING | engine/usage.js (read path) | Synchronous fs calls block the event loop for the whole scan | FIXED | 73a86b3 |
| 5 | 2 | NIT | .claude/plans/usage-stats-853.md:29 | Plan's case-count/tally had drifted from reality | FIXED | 73a86b3 |
| 6 | 2 | NIT | engine/usage.js:95 | SYNTHETIC_ROW regex fragility inherited from status.js | DEFERRED | Not a new risk; pre-existing production behavior |

### NITs (non-blocking, across all iterations)
- [NIT] engine/usage.js:151-156,219-221 — No retention cap on frozen per-day files (iteration 1)
- [NIT] .claude/plans/usage-stats-853.md:29 — Stale case-count/tally in plan prose (iteration 2, fixed)
- [NIT] engine/usage.js:95 — Inherited synthetic-row regex fragility (iteration 2)

### Strengths (across all iterations)
- Root discovery reuses `status.configRoots()` verbatim rather than re-deriving it, avoiding the codebase's own named worst-shipped-defect class (iteration 3, confirmed against source).
- The four token buckets are never summed anywhere in the diff, end to end, with a dedicated test sized to make an accidental blend obviously wrong (iterations 2 and 3).
- The event-loop-yield regression test is a real, discriminating measurement (timer ticks during a direct function call), not an assertion on source text -- and its own comment documents an earlier, non-discriminating HTTP-round-trip version that was found and removed rather than kept (iteration 3).
- The `MAX_DAYS` clamp was a real bug (`RangeError` from `Date` overflow) found while writing tests, not inferred from review, and is enforced inside the function itself rather than left to callers (iterations 1-3).
- `frozenDayPath`'s day value is always internally derived, never caller-supplied, so no path-traversal guard is needed the way `safeKey()` guards an untrusted agent name elsewhere in this codebase (iteration 3).

## Verification (post-loop)

- `node --test engine/usage.test.js server.usage.test.js` — 14/14 pass.
- `node --test engine/*.test.js *.test.js` (full suite) — 2091/2091 pass, 0 failures.
- `validation_log_run_or_skip` (canonical helper) — PASSED (hash 83f808ded34f8c6490d515a0e57daeb734b366875cec6d4e5099ff7bd8b8a932, matching the diff hash below).
- `audit_subdir_claudemd_changed_paths` — PASSED.
- Cross-checked against Splinter's own independent manual sweep of the real, live transcripts: `claude-opus-4-8` matched his reported output-token total exactly (1,057,095); the other three models were plausibly higher (more real work in the intervening hours); `rootsRead` named all three real config directories unprompted.
