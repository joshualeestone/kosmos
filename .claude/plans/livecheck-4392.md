# livecheck-4392: a live check's agents do not trip every concurrent suite's #3011 leak guard

## Why
On 2026-09-28 my post-promote live checks (~/work/workers/barondraxum/postpromote/check_4039_3965.py, the #4039/#3965 checks) made real agents on the Agent1s board at 12:57, 12:58 and 13:02 CDT. Each left a real com.kosmos.agent.zz-test-*.plist in ~/Library/LaunchAgents while it ran. The #3011 guard (tools/lib/launchagent-leak-guard.sh) snapshots com.kosmos.agent.*.plist before and after every full suite, so every suite running then (Angel's, two of Kitty's) went red on a leak that was not theirs. Splinter asked for a namespace the guard does not match, so the checks still exercise the REAL board.

## Call
- The guard skips exactly one reserved prefix: `com.kosmos.agent.zz-livecheck-*.plist` (LAUNCHAGENT_LIVECHECK_PREFIX). Everything else still counts, including zz-test-* and a near-miss like zz-livecheckX.
- No tracked file other than the guard and its test may contain `zz-livecheck`, so no test can hide a leak behind the prefix. tools/test-launchagent-leak-guard-3011.sh counts it, with a positive control proving the search works and a refusal if git grep cannot run.
- The harness (outside this repo) names its agents zz-livecheck-* from now on.

## Rejected
- A product-side label prefix for check-owned agents: it touches create/remove/leftover for the same result.
- Skipping by WorkingDirectory: the live check's agents run from the real board, so their plists look exactly like a real agent's.

## Weakest premise
That nothing but a deliberate live check will ever name an agent zz-livecheck-*. A person could type that name; the guard would then miss a genuine leak of that one agent during a suite. Accepted: the name is deliberately unnatural, and the harness is its only user.

## Evidence
- tools/test-launchagent-leak-guard-3011.sh: all PASS, with four new legs (skip, near-miss control, search control, reserved-prefix count).
- Mutants: without the guard's skip, the skip leg fails; with a test file containing the prefix, the count leg fails. Found and fixed in flight: the first version of the count leg read an undefined $REPO, failed to search, and PASSED anyway; it now uses the test's own repo root, refuses a git grep error, and has a positive control.
