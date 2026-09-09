---
method: challenge-loop
branch: kp-plus-surface-2518
timestamp: 2026-09-09T09:06:34Z
diff_hash: 0bef5335510908f0de6cc8627431d681700f60231887d95c9778973bb85d0594
---

# Challenge-loop proof: kp-plus-surface-2518

A #2518 surface-map map-growth batch (data-only annotations), same shape as the converged
connect+trust (#2544), create (#2547), OpenAI (#2549), and account-badge
(kp-badge-surface-2518) batches. Adds a `// Browser-check-surface:` annotation to the two
#1615 Kosmos Plus checks so a web/index.html change to those surfaces re-runs the check
instead of staling it.

## Change under review
- docs/browser-checks/render-plus-gate-1615.js -> `plus-state1 plus-flow plus-switch`
- docs/browser-checks/render-plus-blue-1615.js -> `plus-active plus-stars plus-mark`
- .claude/plans/kp-plus-surface-2518.md (plan)

Diff shape: 37 insertions, 0 deletions, 3 files. No logic or render change.

## Pre-build verification (fail-closed upfront)
Read at each assertion site before annotating:
- plus-state1 / plus-flow: fail-closed two ways -- openPlus's waitForFunction returns
  false when the id is missing (times out, exit 2), and the h() height helper returns -1
  for a missing id so the `> 0` height assertions red.
- plus-switch: the enrolled arm asserts `switchVisible === true && switchText === 'Turn on'`;
  a null lookup makes switchVisible false -> FAIL. (The unenrolled arm expects no switch, so
  it passes on null by design; the enrolled arm is the fail-closed one.)
- plus-active: `if (!enterActive)` where enterActive = body.classList.contains('plus-active');
  a rename makes it false -> problem -> exit 1.
- plus-stars / plus-mark: `!hasStars`/`!hasMark` (from `!!getElementById`) plus the sized
  assertions; a rename nulls the lookup -> problem.
- plus-state2 was deliberately NOT annotated: it is read but never asserted, so claiming it
  would be a false ASSERTED token.

## Validation (all green, run from the worktree)
- valid JS (node -c) both files.
- #2529 meta-guard: all arms pass; all 6 tokens present in origin/main web (plus-state1 3,
  plus-flow 6, plus-switch 4, plus-active 8, plus-stars 5, plus-mark 4).
- bc-surface-map.sh map: emits both annotations.
- gate suite: 0 FAILED. helper suite: 0 FAILED.
- covering query: a web change touching plus-active + plus-switch names both checks.
- em-dash scan of added lines (python, byte-safe): 0. (render-plus-blue-1615's pre-existing
  header prose carries dashes on origin/main, unchanged and out of scope.)

#### Iteration 1 (Opus, blind)
Read both check files, the gate script, and origin/main web/index.html. Verified every
token ASSERTED + FAIL-CLOSED + DISTINCTIVE, naming the exact fail-closed line for each.
Confirmed data-only (only the two annotation lines added under docs/browser-checks), 0
added-line dashes, plus-state2 correctly omitted, whole-token gate match (plus-mark will
not collide with bare `mark`).
- [NIT] plus-active appears in several CSS cascade rules so a Plus-skin CSS edit re-runs the
  blue check; the reviewer judged this desirable coverage (the check asserts computed
  styles), not over-fire. Accepted.
- No [BLOCKER], no [WARNING]. Verdict: NO NEW FINDINGS - converged.

### Final Ledger
- Iteration 1 (Opus): converged, 0 BLOCKER / 0 WARNING / 1 NIT (accepted).
Converged in one pass; fail-closed verified upfront. Reviewer model diversified from the
badge batch (Sonnet) to Opus here. Same one-pass shape as the #2549 (OpenAI) batch.
