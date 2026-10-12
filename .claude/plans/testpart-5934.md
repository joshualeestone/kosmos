# Plan: kosmos#5934, a cut refuses a leftover partial-suite export

## What
tools/release.sh step 1c, before the version bump, refuses a cut when KOSMOS_TEST_PART is set to anything but
`all` (empty included), or when KOSMOS_TEST_PART_LOCAL or KOSMOS_SHELL_SHARD is set at all.

## Why
Step 3 runs `( cd "$REPO" && yarn test )`, which inherits the starting shell (no env -i). A leftover
KOSMOS_TEST_PART with KOSMOS_TEST_PART_LOCAL=1 (or beside a leftover GITHUB_ACTIONS=true) narrows the gate to
half the suite and the cut can pass on it. A leftover KOSMOS_SHELL_SHARD makes run-tests.sh refuse at step 3,
after the bump is pushed. Same leftover-export class as #5137 and #5932.

## Decisions
- A separate `if` after #5932's, not the #5137 loop: that loop refuses any value, and KOSMOS_TEST_PART=all is
  the whole suite and must pass.
- Empty values are refused, as the sibling guards do, though run-tests.sh treats them as unset.
- KOSMOS_SHELL_SHARD added in review 2 (a blind reviewer's concern): loud rather than silent, but post-bump.
- tools.release-gate.test.js strips all three from both env builders, because CI exports them for its own part
  and that file spawns the real release.sh with process.env.

## Weakest premise
That nothing legitimate exports these into a cut. Searched: only run-tests.sh, the two CI workflows (which never
run release.sh) and tests read them.

## Reviews
1 (sonnet): BLOCKER, release-gate arms would stop at the guard under CI's env. MEASURED 5 red, fixed, 0 red.
2 (opus): CONCERN KOSMOS_SHELL_SHARD (taken), NIT set -euo pipefail on the extracted guard (taken).
3 (sonnet): no blocker, warning or concern; comment nit fixed.
