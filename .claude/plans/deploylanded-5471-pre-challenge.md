---
pre_challenge: true
method: challenge-loop
branch: deploylanded-5471
diff_hash: 11a8bfee9010d7cbe22a41b39168b7adb30529716f412bc23a2591257c754bb6
validation: pending (the Mortals full suite at 23a545e90 gave up in its queue after ~3.6 h at 09:16, not a test result; the PR's GitHub CI, which runs the full node and shell suites, is the validation, and this line is updated when it reports. Run by hand on this head: tools/test-deploy-landed-5471.sh 0 failures; test-deploy-site-exit0-2791, test-served-verify, test-site-deploy-export, test-cut-step-record, test-site-restore-1548 pass)
subdir_audit: passed
timestamp: 2026-10-07T14:17:00Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20, reviewer models alternated (opus, sonnet)
**Converged:** Yes (iteration 20: no BLOCKER, WARNING or CONVENTION)
**Fixed:** every actionable finding, one commit per iteration ("address challenge-loop iteration N findings")
**Deferred:** see below | **Asked:** 0

### Per-iteration (each fix is the commit named "deploylanded-5471 -- address challenge-loop iteration N findings")
1. landed was a pointer check an earlier attempt at $V could pass -> served .sha256 must equal this cut's; message hedged
2. one HOST for both checks; curl stub asserts its URL
3. full verifier inside the landed check could call a landed deploy "not served" -> landed on the own-build .sha256 alone, then DEPLOYED=1 and step 9 verifies; overrides validated numerically and before deploying
4. cache-busting query; 4-digit cap; test asserts -f / -m 30
5. stale test header and plan prose (SELF); failing vercel first on PATH; worst-case timing
6. why the one HOST is right on a staging cut
7. the not-seen message records this cut's sha and the URL to compare
8. releasing.md failed-cut section; signals 130/137/143 fail fast; reused-tarball premise
9. sha printed before the poll (Ctrl-C); refusal text asserted
10. record printed on every non-zero exit; unreadable own .sha256 fails fast (and a set -e bug its new test found)
11. sha printed before vercel deploy runs (Ctrl-C raced the record); late-landing recovery steps
12. recovery names every step that did not run; the log is the only record
13. overrides checked at step 1; 137 polled; prod-cut recipe; test anchors on step 8's own check
14. (no fix: one WARNING deferred, see below)
15. put the served tarball pair back before any promote
16. the unversioned pair: nothing on a staging cut, fetch it on a prod cut
17. the wait message says how long and that Ctrl-C is safe; test block under set -euo pipefail
18. wait stated in seconds; the one-deploy-goes-live-whole premise
19. fast-forward the site checkout to origin before fetching the pair (its local pointer is stale)
20. converged: NITs only

### Deferred, with reasons
- Step 1 sources site-deploy.sh before its main/clean checks (14): release.sh and the library come from the same $REPO tree, so the new lines and the function always arrive together.
- The trap's "never served" lines print after the not-seen message (16): the message says how to read them; moving them means changing the shared trap for one case.

### Weakest premises (in the plan)
- A build landing after the last check (~6 min) fails as before, after printing this cut's sha and the URL to compare.
- No two builds share bytes; a reused tarball, or a manual deploy-site.sh run between steps 4 and 8, would make "landed" true of the bytes but not of this cut's deploy (step 9 still verifies).

### Strengths
- Landed is decided by content (this cut's own served .sha256), not by a pointer an earlier attempt could satisfy.
- The test runs release.sh's real step-8 block (anchor control), with vercel and curl stubbed and a failing vercel on PATH; it covers landed, earlier attempt, never served, exit codes 7/130/137/143, unreadable sha, bad override (vercel never called) and CLI success.
- Measured red: the landed check disabled gives 4 failures; the own-build check accepting any served .sha256 gives 3.
