---
branch: cons-rules-3186
method: challenge-loop
diff_hash: 626c54395367203d090d31ad444040a378b50a2e1a3c207b9546d324a81e3028
converged: true
iterations: 4
---

# Challenge-loop proof: cons-rules-3186 (#3186)

## Change under review
Remove the horizontal divider rule under the discussion header on the
CONSOLIDATED view: delete `border-bottom: 1px solid var(--k-rule)` from
`html[data-layout="consolidated"] body.consolidated .pjmidhead` (web/index.html).
Continues #2711 item 5, which already removed the same rule from the tab-view
header, so both headers are now rule-free. `web.layout-picker.test.js` flips the
assertion that pinned that border to assert it is GONE (a `doesNotMatch`, plus a
`match` that the rule block still exists). A `Browser-check:` commit trailer clears
the #1720 web-change gate (static CSS removal, guarded by the CSS-text unit test;
served-build visual verify routed to Josh's 6.72 review by Splinter).

## Files
- web/index.html (CSS removal + three comment blocks marked historical)
- web.layout-picker.test.js (assertion flipped to guard the removal)
- .claude/plans/cons-rules-3186.md (plan)

## Iteration ledger

### Iteration 2 (blind, sonnet)
- [WARNING] web/index.html ~4321-4338 — the `#520 piece nine` and
  `kosmos#1303 B` comments still described the removed border in present tense
  (repo's worst-defect class, Convention #5). FIXED: marked historical, kept the
  16px inset reasoning that still explains the margin/padding values (commit
  8cb5ae681).
- [STRENGTH] scope precise; `#rail-me` rejection sound; test guard real; trailer
  justified.

### Iteration 3 (blind, opus)
- [BLOCKER] web/index.html:4653 — a THIRD stale comment (tab-view #2711-item-5
  block) still said the consolidated header "keeps its own separator", false after
  this branch removes it. FIXED: rewrote to say both surfaces are now rule-free
  (commit 8db42f4b6).
- [WARNING] web/index.html:3338, :4108 — two other horizontal `--k-rule` borders
  on the consolidated view (top app-bar separator; Members/Files card divider).
  Neither is the "under the discussion header" rule. DECISION: left in place,
  enumerated in the plan + visual-verify steps for Josh's 6.72 review (each a
  one-line removal if he points at it). Not removed blind: the app-bar edge is
  chrome that bounds the top bar, and the card divider is deliberate structure.
- [STRENGTH] `#rail-me` display:none verified by source order; test guard reds on
  re-adding the border; inset math kept as historical.

### Iteration 4 (blind, sonnet) -- CONVERGED
- [NIT] first commit subject does not match the `#N: <message>` form. Deferred:
  the commit already landed, rewriting history is not required by convention, and
  the PR title (properly formed) governs the squash-merge.
- Zero NEW BLOCKER/WARNING/CONVENTION. Comment accuracy swept and fully verified
  (no fourth stale reference survives); test guard exercised with a negative
  control (re-injecting the border flips `doesNotMatch` to a match); the two
  deferred borders and the `#rail-me` rejection each re-checked against live CSS.

## Convergence
Iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION findings after dedup, no
unresolved ASKED findings. 6d CONVERGED. Final validation (6j) PASSED for
stack=typescript hash=626c54395367, bc-surface-map 0 FAILED, #1720 gate override
recorded via the Browser-check trailer.

## Weakest premise
"Horizontal rules" = the `.pjmidhead` border under the discussion header. Splinter
confirmed the CSS-border reading; the header rule is the unambiguous match. The two
other consolidated borders are named for Josh's visual pass rather than guessed at.
