# dupcss-1459-v2: remove the byte-identical duplicate rail rule so its guard can go red (#1459)

kosmos#1459 (Vivienne, 2026-08-28, found while proving the red arm on #1430). The rule

```
html[data-layout="consolidated"] body.consolidated #pj-list.asgrid { display: flex; flex-direction: column; }
```

exists twice, byte-identically, inside the SAME `@media (min-width: 960px)` block. Because both
copies are identical and same-specificity, the later copy wins and a regression in the earlier copy
hides behind it, so the behaviour guard in `web.consolidated-project-name-overflow.test.js` could
not go red on exactly the inversion it was written to catch.

## Why re-done rather than merging the stranded branch

A finished fix exists on `dupcss-1459` (fd92c4c, Mona Lisa 2026-08-28) but it was never PR'd or
merged, and it is ~10 days stale against a heavily-changed `web/index.html`. Its test edit predates
the current `DUP_RULE`/count form of the guard (the #1476 guard work landed after it). Re-doing on
current `origin/main` avoids a stale rebase on a large file and follows the guard as it exists today.
Mona's safety analysis is adopted and re-verified independently.

## The safety check (why removal does not change behaviour)

Both occurrences (now :3092 and :3213 on current main) carry the identical full selector and
declaration, and both sit inside the same `@media (min-width: 960px)` block opened at :2612 whose
first column-0 close is :3763 (no close+reopen between them, verified by scanning for a col-0 `}`).
Same block, same specificity, so the later copy governs and removing the earlier one cannot change
the effective value. This matches Mona's brace-depth verification.

## Change

- `web/index.html`: remove the EARLIER copy (:3092), keep the later governing copy. Behaviour
  unchanged (the winning copy is untouched).
- `web.consolidated-project-name-overflow.test.js`: follow the guard's own coupled instruction
  ("WHEN #1459 LANDS ... Change the 2 to a 1"). The count assertion now pins exactly 1 copy;
  rename `DUP_RULE` -> `RAIL_RULE` (there is no longer a duplicate) and rewrite the comment to the
  landed state (a 2 now means the defect was re-introduced, a 0 means the rule was deleted).

## Verification

- Count in `web/index.html` is now 1 (control `#pj-composerhint { display: none; }` is 1).
- The guard test passes, and separately the RED ARM is proven: breaking the single remaining rule's
  value now reds the `effective()` behaviour assertion (before, with two copies, breaking one stayed
  green). That red arm is the defect this card is about.
- Full web unit suite.

## Weakest premise / accepted residuals

- Removing the earlier vs later copy is behaviour-identical; I keep the later (governing, cascade-winning)
  copy to remove any doubt about which value is effective. If a future reader expects the rule in the
  list-head group (:3092) rather than near the rail block (:3213), that is cosmetic, not behavioural.
- An appended declaration to the single remaining copy still matches the count regex prefix (stays 1)
  and is invisible to the count guard; the `effective()` assertions are what catch a value change.
