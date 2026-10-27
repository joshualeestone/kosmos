---
pre_challenge: true
method: challenge-loop
branch: linuxrelease-7281
diff_hash: f54703ee7e5c3594a411ccab5694f2b9b603ab1734c02ea1d2c58646fa570a80
validation: focused-passed (tools/test-release-linux-7281.sh 67/67); every test that reads tools/release.sh (43 files) rc 0, plus the 12 tests of the other touched files; the rebase onto main changed none of those files; full suite via PR CI
subdir_audit: passed
timestamp: 2026-10-27T06:28:10Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: 0 BLOCKERs, 1 WARNING fixed, 3 NITs fixed or recorded)
**Fixed:** every WARNING of iterations 1-3 | **Deferred:** a later deploy refetching the live Linux pair, to slice C3 (deploy-site.sh); prod Linux cuts stay refused until slice C2's marker lands | **Asked:** 0

Validation, stated as it happened:
- tools/test-release-linux-7281.sh: 67 checks. The lib against a fake git site with an origin, a stub signer in a temp
  copy (no seam in shipped code), plus structural checks that release.sh wires every call and its refusal.
- Every test that reads tools/release.sh (43 files), run one by one with their own exit codes: all rc 0. The tests of
  the other touched files (publish-staging-pointer, release_site_restore, write-latest-pointer: 12 files): all rc 0.
- Mutants, each red then reverted from a commit: prod allowed, version unchecked, manifest immutability off, the Linux
  restore gated on the Mac record, the step 8 check removed, the post-commit cleanup removed, an env bypass of the
  prod guard, publish-staging-pointer's guard off (both arms), the export pointer tie off, the export JSON field
  wrong, the marker test back to a mention grep.
- Not run: tools/release.sh itself (it cuts a real release). The first real Linux cut is a staging cut with
  KOSMOS_CUT_LINUX=1 once kosmos-relay's tools/build-tunnel-release-linux.sh exists on relay main.

After PR CI (01:12): the node suite's tools.every-test-runs.test.js refused the new tools/test-release-linux-7281.sh
because test:shell did not name it; added (the guard and tools.shell-shard-4317 pass: 27/27).

After PR CI (01:26): the Linux shard ran the test with git's default branch master, so a clone of the test's bare
origin checked out nothing; the bare origins are now made with -b main (reproduced and fixed locally with
init.defaultBranch=master: 65/2 -> 67/0).

The per-round findings and decisions are in .claude/plans/linuxrelease-7281.md.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] after the site commit the Linux manifest, .sig and a first pointer stayed untracked, so the next pull refused --> FIXED
- [WARNING] nothing kept the Linux tarball in a deploy --> FIXED (step 8 refuses an export without a verifying pair); a later deploy's refetch DEFERRED to C3
- [WARNING] an aborted re-cut could delete a served Linux tarball (gated on the Mac record) --> FIXED (_linux_pair_had)
- [WARNING] a prod Linux cut before the promote moves the Linux pointer --> FIXED (refused until C2)
- [WARNING] the test could not see a broken release.sh --> FIXED (structural checks)
- [WARNING] the manifest's version was not held to V --> FIXED
- [NIT] manifest immutability --> FIXED; [NIT] stale-tunnel override covers Linux silently --> FIXED (said); [NIT] signer refusal without a control --> FIXED

#### Iteration 2
- [WARNING] the prod guard was an environment variable an operator could set --> FIXED (read from promote-channel.sh)
- [WARNING] publish-staging-pointer.sh moved the Mac staging pointer alone --> FIXED (refuses while a Linux staging pointer exists)
- [NIT] step 8 checked a self-consistent pair, not the committed pointer --> FIXED

#### Iteration 3
No blockers.
- [WARNING] any mention of latest-linux.json lifted the prod guard --> FIXED (exact marker line PROMOTE_MOVES_LINUX=1)
- [NIT] step 8 tested only as text --> FIXED (release_linux_export_ok, tested on behaviour); [NIT] publish-staging-pointer's origin/main arm untested --> FIXED
- [NIT] the guard reads the checkout, not the frozen tree --> RECORDED (behind refuses; ahead needs an unmerged C2)

### Final ledger
Converged at iteration 3. Plan: .claude/plans/linuxrelease-7281.md.

Rebase onto main e40f95e4d (after C3 #7307 merged), 2026-10-27 02:3x CDT: package.json test:shell conflict only, resolved by keeping main's test-deploy-linux-7281.sh and appending test-release-linux-7281.sh. No code change. Rerun: test-release-linux-7281 67/0, test-deploy-linux-7281 44/0, every-test-runs + all-node-tests-considered 6/6. diff_hash re-stamped.
