# floorminos-5844: test-floor-gate-tree ignores the caller's KOSMOS_ALLOW_MINOS

Card: joshualeestone/kosmos#5844 (found by Sonya Blade). tools/test-floor-gate-tree.sh went red whenever the caller had
KOSMOS_ALLOW_MINOS exported: the floor gate's documented override for local test builds, which agents set on dev Macs.

## Finished looks like
- The check passes with the variable unset AND with KOSMOS_ALLOW_MINOS=1, and still refuses the above-floor probes.

## Decided
- `unset KOSMOS_ALLOW_MINOS` at the top: the override is the caller's, never this check's (as
  tools/test-coordinator-floor-5037.sh already does for its own override).
- No self-guard assertion on the unset (review NIT): a regression would come back as the same red, as before.
