# heavy-gate-3805: one shared "safe to start a heavy run?" check

Addresses #3805 (claimed:sonyablade). Liu Kang's rule (m820, m828, 2026-09-25): start a heavy run
(a full suite, browser checks, a screenshot sheet) only when no release holds the machine and no
real release or browser-check run is going, twice, a minute apart. Seven agents hand-rolled it, and
it was corrected twice in one afternoon.

## Finished means
`bash tools/heavy-gate.sh [--except-cwd DIR] [--twice] [--quiet]` exits 0 only when both of these
hold: no reservation (who-has-the-box's answer), and no REAL `tools/release.sh` or
`tools/browser-checks.sh` running. It exits 1 when busy and 2 on a usage error, and it prints every
candidate with the reason it counts or does not. Each case on the card has a test with a control.

## What counts, and what does not
- **Counts:** a shell running the script (`bash|sh|zsh` as the command, the script path as its
  first argument), with a cwd outside the exclusions below.
- **Does not count:**
  - A shell that only mentions the name: a watcher loop, `bash -c echo ...`, grep. This was m828's
    correction to pgrep -f.
  - A process with a `node --test` ancestor: the release-tooling unit tests start `release.sh` in
    temp fixtures. Observed live on Mortals, 15:22 to 15:24, from two agents' suites.
  - A process whose cwd or script path sits under `$TMPDIR/kt<digits>/`. That is run-tests.sh's
    sandbox, and its re-exec tests detach from node --test, so ancestry alone misses them (observed).
  - A process that has already exited (a short fixture can exit between the listing and the check).
  - With `--except-cwd DIR`, a run in DIR or below it (your own). The match is exact-or-below, so
    `kosmos` does not exclude `kosmos-bar`, and an empty or missing DIR is exit 2 (m837: an empty
    prefix would match every cwd and read clear).

## Decisions
- **A separate tool, not a `--heavy` mode on who-has-the-box.sh.** who-has-the-box answers one
  question in one line and the release tooling calls it; the process scan is a different, slower
  question. The tool reads the reservation through who-has-the-box, so the two cannot disagree.
- **Test seams, not spawned processes.** Every test process runs under `node --test`, so a real
  spawned fixture is excluded by design and could not test "counts". The snapshot seam feeds
  synthetic process lines, and one smoke test runs against the live Mac.
- **Snapshot fields are separated by \x1f, not tab.** `read` collapses repeated tabs, which shifted
  the fields after an empty cwd. That was found by mutation testing: removing the exited filter
  broke no test until the separator changed.

## Check
`tools.heavy-gate-3805.test.js`: 11 tests, each case with its control. Mutation-tested: 10
mutations of the tool (drop each exclusion, a bare-prefix own-match, no argument validation,
ignore the claim, count mentions, count any process, skip `--twice`, a tab separator), and every
one turns at least one test red.

## Weakest part
The fixture exclusions are heuristics shaped by what was observed today: a `node --test` ancestor,
and the `kt<digits>` sandbox path. A future fixture that detaches AND lives outside the kt sandbox
would count as a real run. That errs toward busy, the safe direction, and the tool prints the pid
and cwd, so it is visible, but it would block runs until the tool learns the new shape.
