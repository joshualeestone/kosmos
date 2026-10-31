---
pre_challenge: true
method: challenge-loop
branch: linuxbundle-7281
diff_hash: 2fc3c045a9f6d68a5e92f94e940236de0ea60dae773d3bb9dc630a9544222eb3
validation: focused-passed; the test file also passed on the Linux CI lane (GNU tar); full suite via PR CI
subdir_audit: passed
timestamp: 2026-10-27T02:46:09Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: 0 BLOCKERs, 0 WARNINGs, 4 NITs, all taken)
**Fixed:** every BLOCKER and WARNING of iterations 1-2 | **Deferred:** to slices C/D, named in the plan (a release refuses an unchecked node or a connector above the floor; Mac verify refuses platform != darwin) | **Asked:** 0

Validation (6j), stated as it happened:
- tools.build-linux-7281.test.js: 9 tests, 9 pass on this Mac (runs the builder end to end offline with crafted ELF
  and Mach-O headers). The same file passed 7/7 (its round-1 shape) on the repo's Linux CI lane (run 40435904817),
  which ran the builder with GNU tar. tools/test-tar-owner-gate-6562.sh: all pass (the shared gate changed).
- A real build on this Mac with nodejs.org's linux-x64 node: 389 files, the manifest listing exactly the tarball.
- Mutants: a dropped staged file (the lockstep test names it) and a removed ELF check (the Mach-O test reds); the
  round-2 and round-3 checks are covered by refusal tests, not each mutated.
- Full local suite: not run (this Mac's queue is deep tonight); PR CI carries it. Not recorded as a local pass.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] GNU tar's --owner=kosmos needs that user on the build host --> FIXED (kosmos:0)
- [BLOCKER] the connector's provenance was not checked --> FIXED (shared connector-provenance.sh)
- [WARNING] an unchecked node could ship unmarked --> FIXED (test-only, recorded as unchecked:)
- [WARNING] the Mac's platform-neutral release gates were missing --> FIXED (home-path, odd names, owner, metadata, smoke test)
- [WARNING] no glibc floor --> FIXED (2.35, recorded)
- [NIT] any ELF counted --> FIXED (executables only); [NIT] Mac verify ignores platform --> DEFERRED to slice D; [NIT] verify-manifest fields --> FIXED; [NIT] the before-download claim untested --> FIXED

#### Iteration 2
- [WARNING] a FreeBSD or musl connector passed --> FIXED (Linux OS byte, glibc's loader only)
- [WARNING] a missing strings tool read as static --> FIXED (grep -a)
- [WARNING] the home-path gate skipped an ELF connector --> FIXED (a Linux-builder check for cargo homes)
- [WARNING] tar_owner_gate was blind to GNU tar's listing --> FIXED (shared gate reads owner/group; a test on this host's tar)
- [WARNING] a raised glibc floor left no trace --> FIXED (test-only, floor recorded)
- [NIT] the smoke pid was killed again at exit --> FIXED

#### Iteration 3
No blockers, no warnings.
- [NIT] a file(1) label for another system --> FIXED; [NIT] two cargo-home prefixes --> FIXED; [NIT] the floor test could reach the network --> FIXED; [NIT] whole-file glibc read vs the relay's objdump -T --> DOCUMENTED

### Final ledger
Converged at iteration 3. Plan: .claude/plans/linuxbundle-7281.md.
