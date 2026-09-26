# gated-list-3929: the gated browser-check list is one name per line (kosmos#3929)

## Problem
`tools/browser-checks.sh` ran its no-URL (hermetic) checks from ONE `for n in <173 names>; do`
line, about 4.4 KB. Every PR that adds a gated check edits that line, so any two such PRs
conflict. On 2026-09-26 alone that forced rebases on #3687, #3696, #3809, #3882 and the org-chart
branch (three times for the last).

## Call
- The names move to `docs/browser-checks/gated.txt`: one per line, byte-sorted, with a short
  `#` header. Blank lines and `#` lines are skipped.
- The runner reads the file into `GATED_CHECKS` first (so no check's `node` can consume the list
  from stdin mid-loop), refuses if it read none, then loops
  `for n in ${GATED_CHECKS[@]+"${GATED_CHECKS[@]}"}`. The body is unchanged: `run_one "$n" node ...`.
- The path is `"$REPO/docs/browser-checks/gated.txt"`, absolute, so a later `cd` cannot break it.
- The short list at line ~1191 (15 names, a different fixture) is left as it is: it is not the one
  that conflicts.

## Order
The loop now runs in SORTED order instead of the old hand order. These checks are hermetic by the
loop's own contract (each boots its own fixture or none), so order must not matter. That is also
the weakest premise: the last gate run before merge is the real proof.

## Guard (tools.browser-checks-wired.test.js)
- `invokedNames` learns the new position. The file's names count as invoked only when BOTH the read
  line and the `for n in ${GATED_CHECKS...}` loop with `run_one` in its body are present.
- New test #3929:
  - the file is sorted, unique and one bare name per line, and every name has its `.js`;
  - the runner invokes every name;
  - CONTROLS: a name added to the file is picked up; a name removed is dropped; and removing
    either the read or the loop makes the file's names stop counting.
- Red-checked: an unsorted file fails, and origin/main's one-line runner fails the controls.
- Measured: the extracted loop, with a stub run_one, runs 173 names.

## Review 1
- Verified by the reviewer: the name set is identical to origin/main (173, empty diff); the frozen
  cut tree includes gated.txt; nothing else parses the old line; and the workflow path filter
  covers the new file.
- WARNING fixed: the test trimmed lines, but the runner runs each line exactly as written, so a
  CRLF line, a trailing space or an indented comment passed the test and reached run_one as a
  nonexistent check. The test now checks RAW lines. Red-checked: each of the three fails it.
- WARNING assessed as NOT a hazard: "render-create-prefs-3081 plants an account in the shared home,
  so sorting changes who sees it". The check calls lib-sandbox-home's plantSubscribedClaude() at its
  line 23, which sets AGENT_WORKFORCE_HOME to its OWN fresh folder before line 38 writes
  .claude-fixture2 there. So nothing lands in the run's shared home, and the order does not change
  what other checks see. (The reviewer also found no assertion depending on it.) The first real
  gate run after merge stays the true proof of order-independence.
- NIT fixed: the "unwired" failure message names gated.txt as where to wire a hermetic check.
- NIT accepted: an empty gated.txt is refused at the loop, after earlier groups ran. It is loud,
  and the unit test catches an empty or short file first.
- Full yarn test: 9767 pass, 0 fail, plus test:shell.
