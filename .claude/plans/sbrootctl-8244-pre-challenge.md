---
pre_challenge: true
method: challenge-loop
branch: sbrootctl-8244
diff_hash: 2c706878ca1c8d785d1751e28a742e89cdb25cf0b61e4826b08e1c502593db28
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T15:54:27Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Update 2026-11-08 15:54Z: the unpin is backed out of this PR.** PR #8248's CI ran both Linux shards on
ubuntu-26.04: tools/test-install-sbroot-6275.sh PASSED there (the negative control caught the revert), but another test,
tools/test-light-side-4911.sh, failed on 26.04 only (#8250, PigeonPete). As the plan said, the PR was not widened: the
unpin commit is reverted, and the branch now carries step 2 alone. The sbroot test is byte-identical to the version
iteration 4 reviewed (c05d537deb); the workflow files equal origin/main's (pinned). Validation of this diff: full suite,
28102 tests, 0 failures (validation-log hash 2c706878ca1c); a first run had one contention red
(server.slowrequest-runner-8191, green alone 3/3). The unpin follows #8250 in its own PR.

**Iterations:** 4 (iterations 1-2 on step 2 alone; 3-4 on the whole branch after the rebase and the unpin)
**Converged:** Yes
**Total findings:** 17 (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 13 NITs)
**Fixed:** 1 BLOCKER, 2 WARNINGs, most NITs | **Deferred:** 1 WARNING | **Asked:** 0

Final validation: full suite (node), 28102 tests, 0 failures (validation-log hash 18d49ab2b517). Local validation does
not run test:shell, so the shell guards that scan test scripts were run by hand: test-mktemp-template-4298,
test-gnu-only-forms-6808, test-sleep-control-guard-6710, test-site-autodeploy-5589, test-touch-t-utc-7725 all pass;
tools/test-install-sbroot-6275.sh and tools/test-ci-runner-route-5488.sh pass. Under a PATH mktemp that squeezes '//',
origin/main's sbroot test fails exactly as CI did on 26.04 and this branch's passes. The real 26.04 run is this PR's
own CI, the gate for both Linux shell shards.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] tools/test-install-sbroot-6275.sh:107 — the stand-in's suffix read /dev/urandom unbounded and relied on SIGPIPE; it hung under a parent ignoring SIGPIPE (measured) --> FIXED (fixed 256-byte read; checked with SIGPIPE ignored, no tr left)
- [NIT] the negative control did not require the folder; a comment cited no measurement --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
**Self-generated:** 0
**Converged for step 2.** The header's arms list (a NIT) was folded into the unpin commit.

#### Iteration 3 (whole branch, after the rebase and the unpin)
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 2 NITs
**Self-generated:** 1 (the stand-in control line written in step 2)
- [BLOCKER] tools/test-install-sbroot-6275.sh:118 — tools/test-mktemp-template-4298.sh flagged the stand-in control line (the closing ')" on the same line read as a template not ending in X); this PR's CI would have gone red --> FIXED (closing on its own line; the 4298 guard reports 0 failures, c05d537deb)
- [WARNING] .github/workflows/test.yml — the unpin returns every Linux shell command to 26.04, not only this test --> FIXED (stated in the plan: this PR's CI is the gate for both shards; re-pin if anything else is red)
- [NIT] a comment stated the mktemp cause as observed --> FIXED (says what the log showed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] tools/test-install-sbroot-6275.sh:108 — 256 random bytes could in principle give under 10 alphanumerics --> DEFERRED: not a real risk (about 62 expected; under 10 has probability around 1e-20) and a short suffix fails loudly by its length check, never silently
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-install-sbroot-6275.sh | SELF | unbounded urandom read hangs without SIGPIPE | FIXED | 82a1b55e99 |
| 2 | 3 | BLOCKER | tools/test-install-sbroot-6275.sh | SELF | trips the mktemp-template guard | FIXED | c05d537deb |
| 3 | 3 | WARNING | .github/workflows/test.yml | BRANCH | unpin moves the whole shards to 26.04 | FIXED | c05d537deb (plan) |
| 4 | 4 | WARNING | tools/test-install-sbroot-6275.sh | SELF | random suffix could be short | DEFERRED | probability ~1e-20, fails loudly |

### Strengths
- The unpin is an exact restore: the four files equal their pre-pin text (c2690b1bf5)
- The stand-in is checked to keep '//', refuses any other call shape, and lives only inside the runs that ask for it
- Reproduced: a squeezing mktemp fails origin/main's control exactly as CI did; this branch passes and still catches the revert
