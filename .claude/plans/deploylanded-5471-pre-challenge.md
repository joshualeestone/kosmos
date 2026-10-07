---
pre_challenge: true
method: challenge-loop
branch: deploylanded-5471
diff_hash: 11a8bfee9010d7cbe22a41b39168b7adb30529716f412bc23a2591257c754bb6
validation: passed (FULL LOCAL SUITE on Agent1s, 12:54-13:23 CDT 10-07, at 1a3894b49 (this branch rebased onto main; diff hash unchanged): node 16481 tests, 16257 pass, 0 fail, 0 cancelled, 224 skipped; test:shell ran to the end with tools/test-deploy-landed-5471.sh 0 failures; run-tests rc 0. Run locally because GitHub's hosted macOS runners stalled from 11:07; this PR's ubuntu and windows checks are green. An earlier local run at 7419ce3fd stopped on cli.sandbox-4636:162, the known red that #5474 fixed on main, and so never reached test:shell; it is not counted)
subdir_audit: passed
timestamp: 2026-10-07T18:46:00Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20, reviewer models alternated (opus, sonnet)
**Converged:** Yes (iteration 20: no BLOCKER, WARNING or CONVENTION)
**Fixed:** every actionable finding, one commit per iteration ("address challenge-loop iteration N findings")
**Deferred:** see below | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] landed was a pointer check an earlier attempt at $V could pass -> served .sha256 must equal this cut's; message hedged --> FIXED (commit "address challenge-loop iteration 1 findings")

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] one HOST for both checks; curl stub asserts its URL --> FIXED (commit "address challenge-loop iteration 2 findings")

#### Iteration 3
**Reviewer model:** opus
- [WARNING] full verifier inside the landed check could call a landed deploy "not served" -> landed on the own-build .sha256 alone, then DEPLOYED=1 and step 9 verifies; overrides validated numerically and before deploying --> FIXED (commit "address challenge-loop iteration 3 findings")

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] cache-busting query; 4-digit cap; test asserts -f / -m 30 --> FIXED (commit "address challenge-loop iteration 4 findings")

#### Iteration 5
**Reviewer model:** opus
- [WARNING] stale test header and plan prose (SELF); failing vercel first on PATH; worst-case timing --> FIXED (commit "address challenge-loop iteration 5 findings")

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] why the one HOST is right on a staging cut --> FIXED (commit "address challenge-loop iteration 6 findings")

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the not-seen message records this cut's sha and the URL to compare --> FIXED (commit "address challenge-loop iteration 7 findings")

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] releasing.md failed-cut section; signals 130/137/143 fail fast; reused-tarball premise --> FIXED (commit "address challenge-loop iteration 8 findings")

#### Iteration 9
**Reviewer model:** opus
- [WARNING] sha printed before the poll (Ctrl-C); refusal text asserted --> FIXED (commit "address challenge-loop iteration 9 findings")

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] record printed on every non-zero exit; unreadable own .sha256 fails fast (and a set -e bug its new test found) --> FIXED (commit "address challenge-loop iteration 10 findings")

#### Iteration 11
**Reviewer model:** opus
- [WARNING] sha printed before vercel deploy runs (Ctrl-C raced the record); late-landing recovery steps --> FIXED (commit "address challenge-loop iteration 11 findings")

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] recovery names every step that did not run; the log is the only record --> FIXED (commit "address challenge-loop iteration 12 findings")

#### Iteration 13
**Reviewer model:** opus
- [WARNING] overrides checked at step 1; 137 polled; prod-cut recipe; test anchors on step 8's own check --> FIXED (commit "address challenge-loop iteration 13 findings")

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] tools/release.sh step 1 sources site-deploy.sh before its checks --> DEFERRED (see below)

#### Iteration 15
**Reviewer model:** opus
- [WARNING] put the served tarball pair back before any promote --> FIXED (commit "address challenge-loop iteration 15 findings")

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] the unversioned pair: nothing on a staging cut, fetch it on a prod cut --> FIXED (commit "address challenge-loop iteration 16 findings")

#### Iteration 17
**Reviewer model:** opus
- [WARNING] the wait message says how long and that Ctrl-C is safe; test block under set -euo pipefail --> FIXED (commit "address challenge-loop iteration 17 findings")

#### Iteration 18
**Reviewer model:** sonnet
- [WARNING] wait stated in seconds; the one-deploy-goes-live-whole premise --> FIXED (commit "address challenge-loop iteration 18 findings")

#### Iteration 19
**Reviewer model:** opus
- [WARNING] fast-forward the site checkout to origin before fetching the pair (its local pointer is stale) --> FIXED (commit "address challenge-loop iteration 19 findings")

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** NITs only. **Converged.**

### Deferred, with reasons
- Step 1 sources site-deploy.sh before its main/clean checks (14): release.sh and the library come from the same $REPO tree, so the new lines and the function always arrive together.
- The trap's "never served" lines print after the not-seen message (16): the message says how to read them; moving them means changing the shared trap for one case.

### Weakest premises (in the plan)
- A build landing after the last check (~6 min) fails as before, after printing this cut's sha and the URL to compare.
- No two builds share bytes; a reused tarball, or a manual deploy-site.sh run between steps 4 and 8, would make "landed" true of the bytes but not of this cut's deploy (step 9 still verifies).

### Strengths
- [STRENGTH] Landed is decided by content (this cut's own served .sha256), not by a pointer an earlier attempt could satisfy.
- The test runs release.sh's real step-8 block (anchor control), with vercel and curl stubbed and a failing vercel on PATH; it covers landed, earlier attempt, never served, exit codes 7/130/137/143, unreadable sha, bad override (vercel never called) and CLI success.
- Measured red: the landed check disabled gives 4 failures; the own-build check accepting any served .sha256 gives 3.
