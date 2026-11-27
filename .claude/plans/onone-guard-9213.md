# onone-guard-9213: the last -O logic suite, and a guard so new ones follow

Card: kosmos#9213 (follow-up to PR #9214, merged 52e75cf75f). Finished means: no logic-test compile under ios/LogicTests or ios/tools uses -O, and CI fails if one appears.

## Finding
After #9214 merged, a content check on main found ios/LogicTests/run-updates.sh still compiling with `swiftc -O`. It came from #8959 D1c1 (a3bfb25913), written 11-25 and merged after #9214 branched, so #9214's sweep could not see it, and run.sh's comment ("every run*.sh in this folder compiles the same way") was untrue on main the moment both landed.

## Change
1. ios/LogicTests/run-updates.sh: -O to -Onone.
2. .github/workflows/ios.yml: a step before the logic suites that fails on any `swiftc -O` under ios/LogicTests or ios/tools.

## Verified
- The guard step's own `run` text, extracted from the YAML and run from the worktree root: rc 0 on the fixed tree; with -O put back in run-updates.sh, rc 1 and it names the file and line.
- run-updates.sh passes at -Onone.

## Weakest premise
The pattern `swiftc +-O( |$)` covers how these scripts spell the flag today (`xcrun swiftc -O -o`). A flag placed later on the line (`swiftc -o out -O`) or split onto a continuation line would pass it. Every current script puts it first.
