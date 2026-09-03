---
pre_challenge: true
method: challenge-loop
branch: needsyou-unattributed-1898
diff_hash: 37a68ea021473aa0af1db91b6f67b13504bd7005e2d1e2abe8cb404836526e02
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T07:26:44Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 WARNING (FIXED) + 1 NIT (DEFERRED) + 8 STRENGTHs
**Fixed:** 1 | **Deferred:** 1 | **Asked:** 0

Baseline + final gate: `bash tools/run-tests.sh` (node 3980 + test:shell + #1720 browser-check gate,
which the `Browser-check:` override trailer satisfies) exit 0.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 0 NIT (+ 3 STRENGTHs)
- [WARNING] the Browser-check trailer / plan claimed "the Agents stats tiles are asserted by JS unit
  tests, not by any docs/browser-checks render script" -- imprecise: `render-not-running.js` DOES
  render this stats row (asserting the count tiles + a row-adds-up invariant), just not the alert
  tiles. The conclusion (no new render script required, styling reuse) is sound; only the categorical
  phrasing was wrong. --> FIXED (amend: corrected the trailer and the plan to say render-not-running.js
  renders the row but asserts the count tiles + the sum invariant, not the hidden-at-zero alert tiles,
  which the new tile stays out of).

#### Iteration 2 (converged)
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT (+ 5 STRENGTHs)
**Converged** -- no actionable findings.
- [NIT] web/index.html: the new tile has a `title` attribute the parent "Needs you" tile lacks. -->
  DEFERRED: the reviewer calls it "a minor, beneficial inconsistency (extra context for hover/AT), not
  a defect." Kept deliberately -- the terser "No project" slab benefits from the hover/AT clarification
  ("Agents that need you but named no project") more than the self-explanatory "Needs you" slab does.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | plan + commit trailer | imprecise "no render script covers this row" | FIXED | amend |
| 2 | 2 | NIT | web/index.html | new tile has a `title` the parent lacks | DEFERRED | beneficial AT hint, kept |

### Outstanding questions (ASKED)
None.

### Strengths (across all iterations)
- Fleet tally is correct and cannot go undefined: both card builders set `stateProject` as
  string-or-null, so `=== null` never silently misses; the counter is a strict subset of `needsYou`
  over the same population, so it never double-counts, never enters the row arithmetic, and can never
  show while its parent hides.
- All three UI write paths (tick-success, failed-poll) are symmetric with the parent tile; safe against
  an older server that omits the field (`String(undefined||0)`="0", `!undefined`=hidden); no third
  write path missed; no stale count.
- Tests carry a real control that returns the dangerous answer (an all-attributed board: needsYou
  nonzero, needsYouUnattributed zero) in both the engine and the server drive test; the drive slices
  terminate on the new tile's exact write so the extracted code genuinely runs; no vacuous assertion.
- Accessibility clean: the tile reuses shipped `.stat.alert`/`.haz`(aria-hidden)/`.slab` verbatim, no
  new contrast surface; the `/api/status` field rides through automatically (countAgents' return is
  spread into the response, no schema allowlist).
- The `Browser-check:` override reason is accurate after the fix: render-not-running.js asserts the
  count tiles + the row-adds-up invariant, never the alert tiles; the new tile is a hidden-at-zero
  subset outside that sum.
- A headless-Chrome screenshot of the rendered row confirms the "No project" tile is visually identical
  to "Needs you" (red alert + hazard glyph), placed right after it as a drill-down.
