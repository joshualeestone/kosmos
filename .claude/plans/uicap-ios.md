# uicap-ios: the iOS UI tests job's limit 50 -> 75 minutes (kosmos#9075, Splinter and Angel 11:51)

Finished means: on main, the "ui tests (sample board)" job in .github/workflows/ios.yml may run 75 minutes, so a run
that passes in about 45 to 50 minutes on a slow hosted runner is no longer cancelled with nothing failed.

## Built
One line (and a comment) in .github/workflows/ios.yml. The same line is already on submit-base-7352 (Angel, d699f13b45)
for the #7352 fallback. Splitting the job is the real fix, after the submission.

## Checked
- The 4 root tests that read ios.yml pass (35); tools/test-ci-ios-route-8993.sh passes.
- The UIKit halves of the same suite already have 75 minutes (the uikit jobs), so this matches them.
- ios/tools/ui-sample.sh has no overall timer of its own; its per-test allowance (UIKit only) is unchanged.
- Evidence: main's passing UI run took 44.5 min (45628706874); PR #9067's run 45657098186 was cancelled at the limit
  (about 51 min) with nothing failed. CORRECTED in review: its other two runs (45641426065, 45652050285) were NOT the
  limit; they were cancelled within 5 minutes when my own fresh pushes superseded them (PR concurrency).

## Review round 1 (sonnet, blind): nothing above NIT in the change
- WARNING taken: the evidence line above overclaimed (three runs at the limit); corrected to one.
- Checked: right job (ui; uibuild 30, uikit 75, build 40, route 5 unchanged), YAML parses, no workflow-level or step
  timeout and no timer in ui-sample.sh, no test pins the value (35 pass), the route test passes.
