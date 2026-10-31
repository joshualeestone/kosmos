---
pre_challenge: true
method: challenge-loop
branch: wnpromote-7349
diff_hash: 9781ea121ef7bd341accfbf44de14f88490085128f715c854abe9c71010af90d
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T17:29:13Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Rounds 5 and 6 raised only NITs (no BLOCKER, no WARNING), so the loop stopped.
**Fixed:** every BLOCKER and WARNING of rounds 1 to 4, and the NITs taken in rounds 1 to 6 (below) | **Asked:** 0

Validation: `validation_log_run_or_skip` on this exact diff (hash 9781ea121ef7), as a queued-heavy turn on Agent1s,
2026-10-27 11:42 to 12:08 CDT, after a rebase onto origin/main: the full tools/run-tests.sh, node 24,747 tests,
24,365 pass, 0 fail (the rest skipped by their own conditions), the shell shards and the browser-check gates;
"validation PASSED for stack=typescript". Not yet run on Linux CI: tools/test-whats-new-early-7349.sh is new there.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] tools.cut-home-2724.test.js runs a copied release.sh with no What's New tools: 8 of 11 red --> FIXED (it sets KOSMOS_CUT_NO_WHATS_NEW=1; mutation-proven)
- [WARNING] a direct prod cut moves prod and never named the pool build --> FIXED (its final prod block names it; pinned)
- [NIT] the early run printed prod-check's reason for a 4 --> FIXED (kept to itself; a 3's reason still shows; both mutation-proven)
- [NIT] the refusal did not say to fast-forward when the build is merged --> FIXED
- [NIT] docs said "at its very start" and named one exit --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the release-gate "stops at 1b-ii" arms now stop early, so 1b-ii's own refusal had no test --> FIXED (retitled; a new arm moves prod on between reads with a stand-in curl and stops AT 1b-ii; mutation-proven)
- [WARNING] the pool-build advice was given for every refusal --> FIXED (said for a stale pool; otherwise fix what it names)
- [NIT] a passing check's stderr note printed twice --> FIXED (behind _whats_new_check; the #3955 pins follow)

#### Iteration 3
**Reviewer model:** opus
- [BLOCKER] a hotfix cut exports KOSMOS_CUT_NO_WHATS_NEW=1 and its step 3 runs the new shell test: 4 arms red --> FIXED (run() drops every KOSMOS_* first; mutation-proven)
- [WARNING] a test-install.sh another agent runs would refuse the copy --> FIXED (the harness, side and pre-push bypasses, as release-gate does; not mutation-proven, which would need a stand-in harness on the shared Mac)
- [NIT] x4 --> FIXED (opt-out prod cut names `shown --promoted --none`; "the next cut"; docs name both checks; t.after cleanup)
- [NIT] Linux unmeasured --> watch the first CI run

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] macOS bash 3.2 under set -u: an empty drop array aborted the test --> FIXED (seeded; ALL PASS scrubbed, normal and with the opt-out)
- [NIT] a docs wrap --> FIXED; two NITs answered in the plan

#### Iteration 5
**Reviewer model:** opus
- [NIT] no promote hint on a rollback --> FIXED (pinned; mutation-proven)
- [NIT] the refusal now precedes step 1's on-main check --> FIXED (it says to check the checkout)
- [NIT] pins matched a commented-out call --> FIXED (mutation-proven)
- [NIT] the promote hint had only a text pin --> answered (round 6 added a run)

#### Iteration 6
**Reviewer model:** sonnet
- [NIT] the promote hint ran nowhere --> FIXED (test-promote-named-7005.sh: forward prints it, rollback does not; mutation-proven)
- [NIT] x3 --> answered in the plan (guard on any --allow-older, a second cut's pointer read, the control's step-1 stop)
