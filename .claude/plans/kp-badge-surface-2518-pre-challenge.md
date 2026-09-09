---
method: challenge-loop
branch: kp-badge-surface-2518
timestamp: 2026-09-09T09:00:53Z
diff_hash: 41d13de33905e5586987e66d4a898beca827fc6ea01a55417c63524e03fa2e80
---

# Challenge-loop proof: kp-badge-surface-2518

A #2518 surface-map map-growth batch (data-only annotations), same shape as the
converged connect+trust (#2544), create (#2547), and OpenAI (#2549) batches. Adds a
`// Browser-check-surface:` annotation to two report-interface-lane checks so a
web/index.html change to those surfaces re-runs the check instead of staling it.

## Change under review
- docs/browser-checks/render-account-badge-1921.js -> `acct-connected acct-none acct-unknown`
- docs/browser-checks/render-reauth-reach-1918.js -> `d-reauth`
- .claude/plans/kp-badge-surface-2518.md (plan)

Diff shape: 43 insertions, 0 deletions, 3 files. No logic or render change.

## Pre-build verification (fail-closed upfront, the load-bearing lesson from #2547/#2549)
Each token was read at its assertion site before annotating:
- The three badge classes are selected per row by `querySelector('.acct-connected,
  .acct-none, .acct-unknown')`; a renamed class yields a null badge, `!got.cls` trips
  `problems.push`, the check FAILS. No ternary/optional-chain defaults to pass. FAIL-CLOSED.
- `d-reauth` is `getElementById('d-reauth')` then `.hidden=false`/`.click()`; a rename
  nulls the lookup and the next statement throws inside page.evaluate, uncaught, non-zero
  exit. FAIL-CLOSED (by crash, not a graceful message; it reds, it does not pass).

## Validation (all green, run from the worktree)
- valid JS (node -c) both files.
- #2529 dead-annotation meta-guard (test-browser-check-surface-map.sh): all arms pass;
  all 4 tokens present in origin/main web/index.html (acct-connected 12, acct-none 6,
  acct-unknown 6, d-reauth 3).
- tools/bc-surface-map.sh map: emits both new annotations.
- gate suite (test-browser-check-surface-gate.sh): 0 FAILED.
- helper suite (test-bc-surface-map.sh): 0 FAILED.
- covering query: a web change touching acct-connected + d-reauth names both checks.
- em-dash scan (python, byte-safe): 0.

#### Iteration 1 (Sonnet, blind)
Reviewed the full diff and both check files. Confirmed data-only (43 ins / 0 del), 0
em/en dashes (all five spellings scanned). Verified each token ASSERTED + FAIL-CLOSED +
DISTINCTIVE by reading the assertion lines and confirming presence + uniqueness in
origin/main web/index.html:
- [NIT] the three badge classes appear in several cosmetic CSS rules as well as the
  render call, so a color-only CSS edit would re-run the check (extra churn, not a false
  negative). Accepted: same by-design token-granularity friction documented in the #2518
  gate header and carried across #2544/#2547/#2549; the tokens are not generic enough to
  fire constantly (contrast the deferred #pj-list case). `d-reauth` has 3 occurrences,
  all load-bearing, negligible over-fire.
- No [BLOCKER], no [WARNING]. Verdict: NO NEW FINDINGS - converged.

### Final Ledger
- Iteration 1 (Sonnet): converged, 0 BLOCKER / 0 WARNING / 1 NIT (accepted by-design).
Converged in one pass; fail-closed was verified upfront so the review found nothing to fix.
A data-only, pre-verified annotation change validated against a single blind pass, matching
the #2549 (OpenAI) batch which also converged in one Sonnet pass.
