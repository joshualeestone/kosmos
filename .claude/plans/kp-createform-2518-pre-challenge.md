---
method: challenge-loop
branch: kp-createform-2518
timestamp: 2026-09-09T09:57:54Z
diff_hash: 8744fd4574847efecd7c3714c6ec4f040915b0d4e8fc122a98a77842cf578bf4
---

# Challenge-loop proof: kp-createform-2518

A #2518 surface-map map-growth batch (data-only annotation). Adds the create-account-row
token to render-create-form.js, completing the KP create-journey coverage that was dropped
from the create batch (#2547) until #2548 (PR #2554) made the assertion fail-closed.

## Change under review
- docs/browser-checks/render-create-form.js -> `create-account-row`
- .claude/plans/kp-createform-2518.md (plan)
Diff: 28 insertions, 0 deletions, 2 files. No logic/render change.

## Pre-build verification (fail-closed upfront)
create-account-row is asserted fail-closed via the #2548 precondition (which I authored):
`check('... the account row element renders', seen.acctRowHidden !== null, ...)` where
acctRowHidden is null exactly when #create-account-row is absent, so a rename reds the
check. Distinctive to the create form; present in origin/main web (6 occurrences).

## Validation (all green)
- valid JS (node -c).
- #2529 meta-guard: all arms pass; token present in web.
- bc-surface-map.sh map: emits the annotation.
- gate + helper suites: 0 FAILED.
- covering: a web change to create-account-row names render-create-form.js.
- em-dash scan of added lines (python): 0. (The file's pre-existing header prose dashes are
  unchanged and out of scope.)

#### Iteration 1 (Opus, blind)
Read the assertion directly: confirmed the #2548 precondition is present on this branch and
that a null lookup reds the check (no default-pass), that it protects the downstream
orphan-elbow ternary, that create-account-row is distinctive (vs the deferred
create-account 16x / create-provider 14x), present in web 6x, data-only, 0 added-line
dashes, and that over-fire is below the NIT threshold (all 6 occurrences reference the same
row).
- No [BLOCKER], no [WARNING], no [NIT]. Verdict: NO NEW FINDINGS - converged.

### Final Ledger
- Iteration 1 (Opus): converged, 0 BLOCKER / 0 WARNING / 0 NIT.
Converged in one pass; fail-closed rests on the #2548 precondition already proven and merged.
