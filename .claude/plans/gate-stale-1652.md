# gate-stale-1652 - unblock the 0.6.21 cut: three browser checks stale, not the product

## Problem

The 0.6.21 cut ran and its browser gate (release.sh step 3b) redded (release.sh
exited 1; the trailing wrapper echo masked it as 0 - verified real exit by
content). Three checks failed twice each: `render-role-order`, `click-first-run`,
`regress-a-night`. Nothing deployed - the gate did its job, a half-cut avoided.

All three are STALE checks against a product that legitimately moved, the same
class as the 7-pane staleness gate-red-bisect fixed. Each is reconciled to the
specific merge that moved it, and each fix was PERTURBED to prove it still reds on
the defect it was written to catch (Splinter's rule: updating a check to pass must
not erase a real regression; after the edit, name the input that still makes it
red).

## The three, each reconciled + perturbed

### render-role-order (#1652)
- **Was:** asserts exactly 3 `input[name="rmode"]` radios, order
  `pick-pm > pick-list > rolepick > pick-own`.
- **Why stale:** #1652 (import an agent from a file) added a 4th rmode radio,
  `pick-import` (a .agent.md source for the same `own` role), last in DOM order.
- **Fix:** count `=== 4` (exact), order pins `... > pick-own > pick-import`. Tightened
  (import added to the pinned order), not loosened.
- **Still reds when:** a radio loses its `rmode` name (count != 4), or the order
  breaks. **Perturbed:** renamed the import radio's `name` -> count check red. ✅

### click-first-run (#1652)
- **Was:** line 303 asserts exactly 3 `#roles-list .pick2:visible`.
- **Why stale:** same #1652 4th `.pick2` (pick-import).
- **Fix:** `=== 4` (exact).
- **Still reds when:** the role list fails to load or is short (count != 4).
  **Perturbed:** `display:none` on pick-import -> count 3 -> red. ✅

### regress-a-night (#1841)
- **Was:** reads `#rst-small` and requires "Restarting ends anything it had in
  flight" - the restart-confirmation consequence.
- **Why stale:** #1841 (a8e69f8d, restart-card redesign) split the dialog copy:
  `#rst-small` is now the PER-AGENT line ("what is in flight"; for a never-reported
  agent, "We cannot tell what april is part way through..."), and the general
  consequence moved to a STATIC sibling `.rm-small` paragraph ("They come back with
  nothing in their memory, and anything they were part way through ends..."). The
  consequence is present, just no longer in `#rst-small`. render-detail-header-1841
  (the #1841 check) does not cover the dialog copy, so this is the pin.
- **Fix:** capture the ISOLATED consequence paragraph (`.rm-small:not(#rst-small)`)
  and require `part way through ends`. Reading the isolated element on purpose:
  matching the whole dialog would let the per-agent line's own "part way through"
  satisfy it even if the consequence paragraph were deleted (a false pass).
- **Still reds when:** the consequence paragraph is dropped or stops naming the
  consequence. **Perturbed:** reworded the static paragraph to drop "part way
  through ends" (per-agent line untouched) -> red. ✅ Proves the isolation works.

## Verification

Each check run individually against a booted board (plain first-run-complete for
role-order + regress, rich for click-first-run) via the pinned pw-runtime, green
after the fix and red under perturbation (above). Full browser gate re-run on the
branch to confirm no cascading reds beyond the three named (blast radius is a lower
bound). Then merged to main and 0.6.21 re-cut.

## Weakest premise

The gate's red set is a lower bound (a-blast-radius-measured-from-reds-is-a-lower-
bound): a check that SHOULD have redded on #1652/#1841 but passed for the wrong
reason would not be in the three. The full-gate re-run catches additional reds but
not a check that passes vacuously; those are out of scope for this cut-unblock and
belong to a separate audit.
