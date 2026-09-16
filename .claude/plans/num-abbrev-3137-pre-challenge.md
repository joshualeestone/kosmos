---
pre_challenge: true
method: challenge-loop
branch: num-abbrev-3137
diff_hash: 2e87bd78b4ed6ca6123f550dff553d572abe2a0ee8e2d3fb9d6dc1088d9fa775
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T00:41:44Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, blind, both)
**Converged:** Yes (iteration 2's only new finding is a cosmetic, realistically-unreachable
discontinuity, accepted with documentation)
**Total findings:** 0 BLOCKER; iter-1 raised 3 WARNINGs (all fixed); iter-2 raised 1 cosmetic
WARNING (accepted)

### What the change is (card #3137, Josh 6.68)
The fixed-width Token Usage stat TILES clip a full thousands dollar figure ("$176,332" Approximate
Human Cost ran past the tile edge, overflow:hidden). Abbreviate the tile thousands band to $N.NK.
`usageUsdTileSub1M(n)`: below $1k -> exact (usageUsd); [1e3, ~$999.95k) -> $N.NK (one decimal,
trailing .0 stripped); a value that would round to $1000K rolls to $1.0M. Applied to the two hero
tiles (Approximate Human Cost + Equivalent Token API Cost). `usageUsd` / `usageRowValue` (the
per-row table Value COLUMN, #2840 ruled exact, and it has room) are DELIBERATELY untouched.

#### Iteration 1 (opus, blind)
**New findings:** 0 BLOCKER, 3 WARNING.
- [WARNING] usageUsdTileSub1M returned "$1000K" for [999500,1e6) (rounds to 1000) -- the widest,
  wrong-magnitude string. --> FIXED: rolls to $1.0M at k>=999.95.
- [WARNING] the browser-check fit assertion was near-vacuous (fixture values already short, would
  pass on origin/main). --> FIXED: added a CONTROL that mutates the real cost tile and proves the
  full "$176,332" OVERFLOWS the box while "$176.3K" FITS (measured {fullOverflows:true,abbrFits:true}).
- [WARNING] "$1,152 -> $1K" is ~13% lossy and the API-cost tile has no exact fallback. --> FIXED:
  one decimal (Josh floated "176.4k"), trailing .0 dropped -> $1.2K; $45,000 still $45K.

#### Iteration 2 (opus, blind) -- CONVERGED
**New findings:** 0 BLOCKER. All 3 iter-1 fixes VERIFIED REAL (rollover exact at 999.95, fit
control genuine geometry with correct restore, one-decimal correct); usageUsd/usageRowValue/usageNum
confirmed byte-for-byte unchanged; isolation lift complete; 22/22 node tests pass and assert the
boundary set directly.
- [WARNING, ACCEPTED cosmetic] API-cost tile shows "$1.0M" (one decimal, via the helper rollover)
  at [999950,1e6) but "$1M" (whole, via usageUsd) at >=1e6 -- a one-decimal flip across the
  boundary. Magnitude correct both sides. ACCEPTED, not fixed, because: (a) the band is
  realistically unreachable (~$1M token-API cost); (b) it is INHERENT to the design where the hero
  and API tiles intentionally use different M formats (already documented in the code) plus one
  shared sub-$1M helper -- any "fix" just moves the identical flip to the other tile; (c) the
  reviewer explicitly offered accepting it under the existing "approved mock intentionally differs"
  note. This is the convergence stopping point: no actionable finding remains.

### Verification
- Node test web.token-usage-2617.test.js: 22/22. Tile assertions ($45K, $1.2K) + a boundary test
  (1152->$1.2K, 45000->$45K, 176332->$176.3K, 999999->$1.0M, 999000->$999K, 500->$500, 0->$0.00).
  Non-vacuous: fails on origin/main's $45,000/$1,152.
- Browser-check render-token-usage-2617 (headless, pinned Playwright): API tile $1.2K; every hero
  .tv-fig fits; CONTROL proves the full $176,332 overflows the real tile while $176.3K fits (the
  card's "browser-verify the fit at the real width").
- Table Value column (#2840 exact) confirmed unchanged (usageUsd/usageRowValue byte-identical).

### Browser-check (#1720 / #2518)
web/index.html change is rendered-tile content; render-token-usage-2617.js (the token-usage
browser-check) was updated with executable, non-vacuous assertions incl. the overflow/fit control.
No new surface class/id (tiles use existing .tv-fig/.tv-fbox), so no surface-line change needed.
