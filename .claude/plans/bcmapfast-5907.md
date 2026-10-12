# bcmapfast-5907: bc-surface-map.sh covering decides every check in one pass (#5907)

Card: joshualeestone/kosmos#5907. `tools/test-bc-surface-map.sh` took 89-128 s in the shell stage. Its query helper's
`covering` read every check's annotation and ran one grep per declared token (about 9-12 s a query), and the test runs
many queries. Stacked on `bcsgfast-5907`, whose `bc_surface_scan_checks` (in the shared lib) this reuses.

## The change
`_bcm_covering` reads `bc_surface_scan_checks`: a HIT check is covering, a MISS check is not, and a SLOW check (a
non-plain token first, or a key line the scan's C-locale match refuses) goes token by token as before
(`_bcm_covers`, the original loop moved into a function). If the scan cannot run, every check takes that original path.
Output is still `sort -u`, so order is unchanged.

## Proof
- Old (origin/main) against new, frozen copies of both, 74 queries (diffs and plain id lists for 35 real sampled tokens,
  five tokens at once, a non-plain `data-pmark="xai"` line, an unmapped id, an empty input): stdout, stderr and exit
  code identical in all 74 (72 had covering checks).
- One query: 9 s before, 1 s after. `tools/test-bc-surface-map.sh`: 0 failed, 7 s.

## Weakest premises
- The same C-locale caveat as the gate: on invalid UTF-8 the scan can find a match the ambient-locale grep misses
  (covering then lists one more check, never one fewer).
- The scan path and the fallback are each covered by the map test's own arms only as far as they exercise covering; the
  fallback path is the original code.
