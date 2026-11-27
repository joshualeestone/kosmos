# onone-guard-9213: the last -O logic suite, and a guard so new ones follow

Card: kosmos#9213 (follow-up to PR #9214, merged 52e75cf75f). Finished means: no logic-test compile under ios/LogicTests or ios/tools uses -O, and CI fails if one appears.

## Finding
After #9214 merged, a content check on main found ios/LogicTests/run-updates.sh still compiling with `swiftc -O`. It came from #8959 D1c1 (a3bfb25913), written 11-25 and merged after #9214 branched, so #9214's sweep could not see it, and run.sh's comment ("every run*.sh in this folder compiles the same way") was untrue on main the moment both landed.

## Change
1. ios/LogicTests/run-updates.sh: -O to -Onone.
2. ios/tools/check-logic-onone.sh: exit 1 on any swiftc line under ios/LogicTests or ios/tools (*.sh, comments skipped) that turns an optimizer on: -O, -Osize, -Ounchecked, after any whitespace, anywhere on the line. Exit 2 when it checked nothing (a folder missing, grep failed, no swiftc line at all), never a pass.
3. .github/workflows/ios.yml: the build job ends with a step that runs it. Last, so a stray flag never hides the suites and builds above.
4. tools/test-ios-logic-onone-9213.sh (in test:shell): runs the real script on a copy of the two folders, once per spelling above plus the control, the comment case, both exit-2 cases and the reported count; and pins the step as the build job's last.

## Verified
- The new test: all arms pass; each mutation arm first checks its edit changed the file. Its YAML arm caught a real defect while this branch was being edited (an edit had left ios.yml unparseable), so it can fail.
- tools/test-ci-ios-route-8993.sh still passes on the edited ios.yml.
- run-updates.sh passes at -Onone (121/121).

## Weakest premise
The check reads one line at a time. A flag on a continuation line by itself (`  -O \`, after a `swiftc ... \` line) is not on a swiftc line, so it passes. No script puts a flag there today.
