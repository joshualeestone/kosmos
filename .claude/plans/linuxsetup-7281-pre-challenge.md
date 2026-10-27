---
pre_challenge: true
method: challenge-loop
branch: linuxsetup-7281
diff_hash: 3d5dbb4e8e56ea8e0d0fb7b2b299504ed28ebe1a1fee0e15addf7272ac31e84c
validation: focused-passed; every setup.sh-reading test file passed (64 files, 1476 tests: 1464 pass, 12 skipped, 0 fail); full suite via PR CI
subdir_audit: passed
timestamp: 2026-10-27T03:19:46Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: 0 BLOCKERs, 1 WARNING fixed by removing code, 2 NITs taken)
**Fixed:** every BLOCKER and WARNING of iterations 1-3 | **Deferred:** none in this slice; the ordering rule (no Linux pointer until slice D ships in a cut) is recorded on the card for slice C | **Asked:** 0

Validation, stated as it happened:
- install.linux-family-7281.test.js: 10 tests, 10 pass. They run setup.sh's own text under sh with a stand-in uname
  and getconf and a file:// release folder.
- Every test file that reads setup.sh (64 files, 1476 tests): 1464 pass, 12 skipped, 0 fail, exit 0.
- Mutants, each red then reverted with git checkout: the family off (round 1, 2 of them), the staging-suffix match
  reverted to an exact compare, and the glibc floor lowered to 2.28.
- Not measured here: install_kosmos's four gates run behaviourally (they are pinned by source regexes, each removal
  red); the manifest name and the verifier's acceptance of a Linux manifest are proved by slice E's end-to-end run on
  a stock ubuntu:24.04.

The per-round findings and decisions are in .claude/plans/linuxsetup-7281.md.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] a local copy (KOSMOS_SRC) took the network family; the Linux CI install would break on publish --> FIXED (KOSMOS_SRC and KOSMOS_BUNDLE_ARCH keep it off)
- [WARNING] a failed read of the Linux pointer downgraded an installed family copy --> FIXED (refuses instead; portable keeps the fallback)
- [WARNING] any "version" text turned the family on, and the pointer was fetched twice --> FIXED (a.b.c only, body reused)
- [NIT] a first install has no signed check --> DOCUMENTED (same as a Mac curl|sh); [NIT] KOSMOS_BUNDLE_ARCH --> FIXED; [NIT] install_kosmos pinned by regexes --> ACCEPTED (slice E)

#### Iteration 2
- [WARNING] a Linux staging install was stamped prod --> FIXED (suffix match, tested)
- [WARNING] a published pointer would move every glibc onto a 2.35 build --> FIXED (glibc 2.35 floor; older and musl keep the portable bundle)
- [WARNING] the update path offers the Mac version while setup.sh installs the Linux one --> DECIDED (ordering rule on the card; slice D)
- [NIT] the refusal sentence --> FIXED; [NIT] /usr/bin tool paths on Linux --> DOCUMENTED (merged-/usr; slice E); [NIT] behavioural install_kosmos test --> ACCEPTED (slice E)

#### Iteration 3
No blockers.
- [WARNING] the below-floor refusal disagreed with the unreadable-pointer arm --> FIXED (refusal removed: the portable bundle repairs a copy whose node cannot start)
- [NIT] suffixed getconf answers untested --> FIXED; [NIT] the info line was false without getconf --> FIXED

### Final ledger
Converged at iteration 3. Plan: .claude/plans/linuxsetup-7281.md.
