# onone-guard-9213: the last -O logic suite, and a guard so new ones follow

Card: kosmos#9213 (follow-up to PR #9214, merged 52e75cf75f). Finished means: no logic-test compile under ios/LogicTests or ios/tools uses -O, and CI fails if one appears.

## Finding
After #9214 merged, a content check on main found ios/LogicTests/run-updates.sh still compiling with `swiftc -O`. It came from #8959 D1c1 (a3bfb25913), written 11-25 and merged after #9214 branched, so #9214's sweep could not see it, and run.sh's comment ("every run*.sh in this folder compiles the same way") was untrue on main the moment both landed.

## Change
1. ios/LogicTests/run-updates.sh: -O to -Onone.
2. ios/tools/check-logic-onone.sh: reads every *.sh under ios/LogicTests and ios/tools, drops comment lines (never continued, as in bash), joins backslash-continued lines, drops trailing comments, and requires each swiftc command (by name or path) to carry a literal -Onone and no other -O flag, bare or quoted. Exit 1 names each failing command; exit 2 when it checked nothing (a folder missing, no *.sh, no swiftc command), never a pass.
3. .github/workflows/ios.yml: the build job ends with a step that runs it. Last, so a stray flag never hides the suites and builds above.
4. tools/test-ios-logic-onone-9213.sh (in test:shell): runs the real script on a copy of the two folders: the control, -O, -Osize, -Ounchecked, a tab, a late flag, a trailing flag, a flag alone on a continuation line, no flag, a quoted "-O" in place of and beside -Onone, a flag in a variable, swiftc by path, -Xfrontend=-O beside -Onone, a comment ending in a backslash, two comment cases, both exit-2 cases and the reported count; and pins the step as the build job's last.

## Verified
- The new test: all arms pass; each mutation arm first checks its edit changed the file. Its YAML arm caught a real defect while this branch was being edited (an edit had left ios.yml unparseable), so it can fail.
- tools/test-ci-ios-route-8993.sh still passes on the edited ios.yml.
- run-updates.sh passes at -Onone (121/121).
- The continuation-line arm separates old from new: the previous line-at-a-time check passed a file with `-O` alone on a continuation line (rc 0); this one fails it (rc 1).
- So does the backslash-comment arm: the previous version passed an -O compile hidden behind a comment ending in a backslash (rc 0); this one fails it (rc 1).

## Weakest premise
It reads the scripts as text. swiftc reached through a function or another script, a flag in a variable placed beside a literal -Onone, or anything after a " #" inside a quoted string (taken for a comment), is not seen; no script does either today, each spells xcrun swiftc on the line. The step runs last in the build job, so it reports only after the build and not at all when an earlier step is already red: chosen so a stray flag never hides the suites themselves.
