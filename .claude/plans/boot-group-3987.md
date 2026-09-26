# boot-group-3987: the $B8 did-not-boot list, one name per line

Addresses #3987 (claimed:sonyablade). Queued by Liu Kang (m1092, 2026-09-26) after #3933 moved the
gated list to `docs/browser-checks/gated.txt`.

## Finished means
When the shared first-run board ($B8) does not boot, `tools/browser-checks.sh` reports every check
in that group as failed, reading the names from `docs/browser-checks/b8-board.txt` (one per line,
sorted), and a test fails if the file and the group's `run_one` calls ever disagree.

## What was measured before changing anything
The group runs 30 checks by `run_one`. The inline did-not-boot line named 24. Missing:
import-agent-flow, render-openai-key-callout-2164, render-push-718, render-pwa-installable-718,
render-restart-timedout-2019, render-update-win32-manual. So a failed boot already under-reported
by 6, the drift the card predicted, and it was live.

## Decisions
- **A file, as Liu Kang specified, not a wrapper.** Rejected: a `run_b8` wrapper that runs a check
  or records it as failed, which would write each name once and need no agreement test. It would
  rewrite 30 `run_one` lines that `tools.browser-checks-wired.test.js`,
  `browser-checks-selectors.test.js`, `browser-checks-reason-grep.test.js`,
  `tools/test-browser-checks-workflow.sh` and the CI allowlist all parse by the `run_one "name"`
  shape. The file touches one line of the runner.
- **The booted branch keeps its own `run_one` lines.** Their arguments differ (screenshot folders,
  env, the board pid), so a file cannot drive them. The names are therefore written twice, and the
  test is what keeps the two in step.
- **An empty or unreadable file still records a failure**, so a failed boot can never read as
  "nothing failed".

## Check
`tools.browser-checks-wired.test.js`, test `#3987`: the file's raw lines are bare names, sorted,
unique, each a real check, and exactly the set of `run_one` names in the booted branch; the
did-not-boot branch reads the file. Controls: a check added to the group only, a name only in the
file, a name dropped, the read removed, and an inline list restored each turn it red. Also run
against main's runner (the inline line): red, as expected.

## Weakest part
The test finds the group by its boot line (`if boot_board "$sb7" "$P8"; then`) and its branch by
the first column-0 `else`/`fi` after it. Renaming the sandbox or port variable makes the test say
the boot is gone (a loud failure, not a silent pass). A nested column-0 `else` inside the group
would split it early; none exists today and every line in the block is indented.
