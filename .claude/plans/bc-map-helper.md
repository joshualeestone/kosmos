# Plan: bc-map-helper -- a reusable surface-map query helper for #2518 (Baron's CI-integration seam)

## Why

#2518 (merged, PR #2525) added the surface->check gate: each `docs/browser-checks/*.js` declares
`// Browser-check-surface: <tokens>`. Baron owns the CI-integration half and asked for a stable
INTERFACE to consume -- "given the changed web ids, print the covering cut-checks" -- so he can wire
a NON-BLOCKING advisory CI step on top without re-parsing my annotations. Splinter confirmed the seam:
I own the helper (extract from the gate, no drift); Baron owns the CI-integration.

## The build (no-browser)

1. Extract the annotation parse into a SHARED, reusable function in the gate lib
   `tools/lib/browser-check-surface-gate.sh`:
   `kosmos_bc_surface_map [dir]` -> prints `<check-basename><TAB><space-separated tokens>` for every
   annotated check (default dir docs/browser-checks). This is the single source of the map.
   Refactor the gate's own loop to CONSUME `kosmos_bc_surface_map` (so the gate and the helper cannot
   drift -- one parser). The gate's per-check logic (updated? override? token-match?) is unchanged; its
   existing 12-arm test must still pass.

2. New `tools/bc-surface-map.sh` (the CLI Baron invokes), sourcing the lib:
   - `map`      -> the raw map (`<check><TAB><tokens>` lines).
   - `covering` -> reads a `web/index.html` unified diff OR a newline/space-separated changed-id list on
     stdin, and prints the covering cut-checks (one per line) whose tokens appear (whole-token boundary
     match, the same matching the gate uses) in the changed content. This is the "changed web ids ->
     covering checks" query. Exit 0 with output = covering checks; exit 0 empty = none covered.
   Fail-soft + zsh-safe (find/tr while-reads, no tied vars), matching the gate.

3. `tools/test-bc-surface-map.sh`: assert `map` emits the seeded checks' tokens; assert `covering` on a
   pj-parent diff prints render-subprojects-1994.js and on an unmapped token prints nothing; assert the
   boundary match (pj-parenthetical does not match); a zsh arm. Wired into test:shell. The existing
   `tools/test-browser-check-surface-gate.sh` must still pass after the gate refactor (no-drift proof).

## Output contract (frozen, for Baron)

- `map`: `<check-basename>\t<tokens>` per line. tokens space-separated.
- `covering`: `<check-basename>` per line, one per covering check, sorted-unique. Empty = nothing covered.
- Both read `docs/browser-checks/*.js` `// Browser-check-surface:` annotations as the source of truth.

## Acceptance

`bc-surface-map.sh covering` answers the changed-web -> covering-checks query for Baron's CI step; the
gate consumes the same `kosmos_bc_surface_map` (no drift, gate's 12 arms still green); validation green.
