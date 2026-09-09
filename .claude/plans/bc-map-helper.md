# Plan: bc-map-helper -- a reusable surface-map query helper for #2518 (Baron's CI-integration seam)

## Why

#2518 (merged, PR #2525) added the surface->check gate: each `docs/browser-checks/*.js` declares
`// Browser-check-surface: <tokens>`. Baron owns the CI-integration half and asked for a stable
INTERFACE to consume -- "given the changed web ids, print the covering cut-checks" -- so he can wire
a NON-BLOCKING advisory CI step on top without re-parsing my annotations. Splinter confirmed the seam:
I own the helper (extract from the gate, no drift); Baron owns the CI-integration.

## The build (no-browser)

1. The helper's annotation parse + whole-token match are COPIED byte-for-byte from the gate
   `tools/lib/browser-check-surface-gate.sh` (same sed, same escape + boundary grep, same
   case-insensitive key). 🛑 DECISION (revised from the original "extract into one shared function"):
   at high context I did NOT refactor the merged, working gate to consume a shared function -- that
   would risk leaving the gate half-refactored. Instead the copies are DRIFT-GUARDED by a behavioural
   test (a diff on check A's token -> helper covering names A AND the gate refuses A; a second check;
   a substring non-match), so an unmirrored edit to one regex REDS the suite. Extracting one shared
   `kosmos_bc_surface_map`/`token_hits` function used by BOTH is a clean, lower-risk follow-up for a
   fresh session; the drift-test makes the copies safe until then.

2. New `tools/bc-surface-map.sh` (the CLI Baron invokes). It does NOT source the gate lib -- it carries
   its own `_bcm_map`/`_bcm_token_hits`, byte-copied from the gate (see Step 1's revised decision), so the
   helper stands alone. Subcommands:
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
- `covering`: `<check-basename>` per line, one per COVERING check, sorted-unique. Empty = nothing covered.
  🛑 COVERAGE, not a staleness verdict: covering is a SUPERSET of what the gate flags stale -- it names
  every check that EXERCISES a changed surface, by token presence only; the gate additionally skips a
  check that was updated on the branch or per-check-overridden. A consumer must not read covering as
  "these WILL red at the cut"; read it as "these cover what you changed, ensure each is updated/overridden."
- Both read `docs/browser-checks/*.js` `// Browser-check-surface:` annotations as the source of truth,
  with the SAME whole-token boundary match, so covering never disagrees with the gate about WHICH checks
  cover a surface (only about the gate's extra updated/override filtering).
- SOURCE-SCOPE parity (a diff input): the gate diffs ONLY web/index.html. When `covering` is fed a
  `diff --git` diff it WEB-SCOPES internally -- keeps only the web/index.html file section's changed body
  lines -- so a full-repo `git diff | covering` agrees with the gate rather than over-reporting a mapped
  token that changed in a NON-web file. (An id-list input is caller-asserted changed web tokens; a
  headerless hunk cannot be file-scoped and is taken as the web diff.)

## Acceptance

`bc-surface-map.sh covering` answers the changed-web -> covering-checks query for Baron's CI step. No
shared function is extracted (Step 1): the helper's parse/match are byte-copied from the gate and kept
honest by the drift-detector arms in `tools/test-bc-surface-map.sh`, which assert the helper and the gate
agree BEHAVIOURALLY on the seeded checks (so an unmirrored regex edit reds). Acceptance = that suite green
(`bash tools/test-bc-surface-map.sh`, wired into test:shell) + repo validation green. (The sibling gate's
own suite `tools/test-browser-check-surface-gate.sh` is unrelated to this branch, which touches neither the
gate lib nor its test; do not gate this PR on it.)
