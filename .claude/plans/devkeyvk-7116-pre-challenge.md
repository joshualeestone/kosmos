---
pre_challenge: true
method: challenge-loop
branch: devkeyvk-7116
diff_hash: 64d7595d480235c69877a2b27c2ba2d648589122398c42b37afb1f81341b3474
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T18:39:58Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes: round 5 found no new defect; its one WARNING (a golden vector WITH entries) cannot be made yet and is
deferred with its reason on kosmos#7116.
**Validation:** full tools/run-tests.sh on Agent1s at 0776544578: 29,887 node tests, 0 failed; 4 shell shards status 0;
entry clean, hash 72a671968ee7. After it, one commit added only the plan file
(.claude/plans/devkeyvk-7116.md, required by the PR gate), which is why this diff_hash differs: no code changed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/devkeyhist-7116.test.js: nothing proved verify uses VERIFYING_KEY --> FIXED (9fac1c013f, trustAnchor + test) and later the golden vector (99aa6f6bfb)
- [WARNING] no rotation path stated --> FIXED (9fac1c013f, header)
- [WARNING] inherited NODE_TEST_CONTEXT --> FIXED (9fac1c013f, comment; the seam still needs code in-process)
- [NIT] stale "nothing calls verify" lines --> FIXED (9fac1c013f)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] "no production caller" claim rots --> FIXED (7c78fbbf0a, states how verify is reached)
- [NIT] control asserted only ok:false --> FIXED (7c78fbbf0a)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] an "Ed25519 point" check that can never fail on this node --> FIXED (3661c8436a, removed)
- [NIT] loose /signature|signed/ and a bare ok:false control --> FIXED (3661c8436a)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] engine.reachable.test.js called verify unwired --> FIXED (96a52f96be)
- [NIT] header described a fingerprint fallback the code does not have --> FIXED (96a52f96be)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] golden vector has no entries --> DEFERRED: entries come only from two-admin enrolment (#7116 step 1, not built) or the backfill (must not run until #8742); the Rust side reproduces the Mac's entry vectors
- [NIT] two test titles claimed more than they check --> FIXED (0776544578)

### Strengths
- A history escrowd really signed on the production box verifies under the shipped key with the test key cleared; a
  one-letter change and the fixture key both fail on the signature; a one-digit key change goes red.
- Outside a test process the test seam cannot count (a test deletes NODE_TEST_CONTEXT and pins trustAnchor).
- No production behaviour changes today: the only production restore passes member-proof and skips verify.

### Rebase onto main after #8751 and #8752 merged (2026-11-19 15:1x CST)
engine.reachable.test.js changed on both sides, so the branch was rebased (clean, 10 commits) rather than merged as
tested. Locally after the rebase: engine.reachable, devkeyhist-7116 and the three restore tests that read the history:
85 tests, 84 pass, 0 fail, 0 cancelled. The full suite then runs in CI on the rebased head before merge. diff_hash is
the rebased diff's; no line of this branch's own change differs.
