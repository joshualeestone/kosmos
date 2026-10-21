---
pre_challenge: true
method: challenge-loop
branch: nomacmeta-6678
diff_hash: a8565b10cdda00d665c93682bdf3d25df2bb5fcf398867554eaaf451373d88c0
validation: passed
subdir_audit: passed
timestamp: 2026-10-20T18:25:12Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 37 (0 BLOCKERs, 12 WARNINGs, 0 CONVENTIONs, 25 NITs)
**Fixed:** 10 WARNINGs + 15 NITs | **Deferred:** 2 WARNINGs as duplicates of stated decisions, 10 NITs | **Asked (awaiting user):** 0

Re-hashed 2026-10-20 18:16 CDT after REBASING onto origin/main a2e49f0538 (the repo merges by rebase, which refused the earlier merge commit). One conflict, package.json test:shell: resolved to main's line plus this branch's two entries (checked: every other key equals main's). The reviewed code is unchanged. The validation below ran at the pre-rebase hash 945f4245ef56; the PR CI validates the rebased tree before it merges.

Final validation: Mortals (mortals-validate), entry "status":"clean", hash 945f4245ef56 (equals this diff), 22524 tests,
22206 pass, 0 fail (2026-10-20 13:25 CDT). Each fix was shown red against the version before it (mutants and controls).
The real served 0.7.60 and 0.7.61 tarballs are refused by the gate, naming app/._Kosmos.app and com.apple.macl.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] tools/lib/tar-macmeta-gate.sh:16: python3 put a developer-tools dependency back into both builds --> FIXED (038b4c93: /usr/bin/perl reader)
- [WARNING] tools/build-kosmos-bundle.sh:1030: file flags (SCHILY.fflags) still passed and are restored on extract --> FIXED (038b4c93: --no-fflags plus a gate check)
- [NIT] python crash misdiagnosed (moot after the perl reader); [NIT] no success line (FIXED); [NIT] no ._ folder test (FIXED)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 4 (all in iteration 1's own reader code)
- [WARNING] tar-macmeta-gate.sh: close() after the end marker could SIGPIPE gzip on a big tarball --> FIXED (65a2b0d8: drain), red on the previous gate
- [WARNING] tar-macmeta-gate.sh: a GNU K entry consumed a pending long name --> FIXED (65a2b0d8), discriminating arm red on the previous gate
- [WARNING] tar-macmeta-gate.sh: the pax record loop stopped silently; a zero length looped forever --> FIXED (65a2b0d8), 3 malformed arms red (the hang caught by a process-group kill)
- [WARNING] test: the fixture used python3 --> FIXED (perl writer)
- [NIT] payload held in memory (FIXED); [NIT] ACL keys (FIXED); [NIT] success line order (FIXED); [NIT] base-256 sizes (DEFERRED: bundles far below 8 GiB; fails closed)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] test: an inherited COPYFILE_DISABLE turned two arms red --> FIXED (e4b543d2), shown red on the previous test
- [NIT] basename under an empty PATH (FIXED); chflags unguarded (FIXED); header overclaim (FIXED); base-256 comment (FIXED); ACL default comment (FIXED); old-GNU prefix (DEFERRED: bsdtar writes ustar/pax)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1
- [WARNING] tar-macmeta-gate.sh: a pax g header's path renamed the next entry --> FIXED (7dbe413a), red on the previous gate
- [WARNING] tar-macmeta-gate.sh: the pax size override and base-256 --> DEFERRED (duplicate of iteration 2's deferral; the plan states the limit, which fails closed)
- [NIT] unsigned checksum (noted); stderr merged (DEFERRED); bash -n entry (DEFERRED)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] test: the clean arm could pick up a provenance xattr on a tagging Mac --> FIXED (04897ecb: perl fixture)
- [WARNING] tar-macmeta-gate.sh: x-header path renaming untested --> FIXED (04897ecb: two arms; a first-character mutant fails)
- [NIT] /usr/bin/tar (FIXED); skip reason (FIXED); perl warnings in output (DEFERRED); GNU prefix (duplicate)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (a duplicate), 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] build-kosmos-bundle.sh: a future signed non-Mach-O would lose its xattr signature --> DEFERRED (duplicate of the plan's weakest premise, measured on the real 0.7.60 tarball)
**Converged**: no new actionable findings.

### Final Ledger
Full ledger: ~/.cache/claude-handoffs/baron-jobs/ledger-6678.md (fix commits 038b4c93, 65a2b0d8, e4b543d2, 7dbe413a, 04897ecb).

### NITs (non-blocking, across all iterations)
- [NIT] the test's pack helper uses PATH tar while the builds use /usr/bin/tar (iteration 6)
- [NIT] the success lines print after both gates (iteration 6)
- [NIT] link entries with a size field fail closed through the next checksum (iteration 6)
- [NIT] perl warnings could appear in a refusal's list (iteration 5)

### Strengths (across all iterations)
- The gate reads raw entries because bsdtar's own listing hides ._ entries (measured), and refuses everything it cannot read.
- A control first (the bundles' own packing passes), then each partial flag shown leaving its kind of metadata in.
- The weakest premise is measured against the real served tarballs, not reasoned.
