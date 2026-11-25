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
- Evidence: main's passing UI run took 44.5 min (45628706874); PR #9067's three runs were cancelled at 50 with
  nothing failed (45641426065, 45652050285, 45657098186).
