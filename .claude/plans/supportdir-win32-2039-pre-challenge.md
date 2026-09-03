---
pre_challenge: true
method: challenge-loop
branch: supportdir-win32-2039
diff_hash: aeee55f452fa21c15eb0a8f9cff2342094e0980422681bf65a89e54586dad00f
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T17:24:43Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 found zero BLOCKER/WARNING/CONVENTION; one NIT, addressed)
**Total findings:** 1 NIT
**Fixed:** 1 NIT (plan wording) | **Deferred:** 0 | **Asked:** 0

kosmos#2039: `engine/create.js` `supportDir()` carried a SECOND copy of the
data-root path formula with no win32 branch (the first real Windows test built a
literal Mac path on NTFS). Collapsed it to `store.dataRootFor(process.platform,
homeDir(), process.env)` -- the one win32-aware formula store.js already has --
so there is no second copy to drift. Grepped for a third copy: none of the
data-root formula. Adjacent win32-less mac paths (LaunchAgents, /Applications,
.local/share) are different mechanisms, noted as separate Windows-port follow-ups.

### Per-Iteration Breakdown

#### Iteration 1 (blind agent) -- CONVERGED
**New findings:** 0 BLOCKER/WARNING/CONVENTION; 1 NIT.
- [NIT] the plan called the AGENT_WORKFORCE_DATA branch "byte-identical"; true for
  every valid (absolute) input, but a RELATIVE value (nothing sets one) used to
  resolve silently against cwd and now fails loud through store.dataRootFor's
  absolute-path guard (#1820) -- a strict improvement, an existing dataRootFor
  property, not a regression. --> ADDRESSED: plan clarified, commit 02174bb8.
- The reviewer confirmed equivalence by reading source (APP const, joinerFor ->
  path.posix off win32 == the ambient path the old code used, homeDir() match),
  mutation-confirmed the source-pin reds when supportDir is reverted to the copy
  (the behavioural test correctly can't see win32 from a Mac, which is why the
  source-pin exists), third-copy grep clean, and no circular require. 161/161.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | plan | "byte-identical" imprecise for a relative AGENT_WORKFORCE_DATA (now fails loud, a strict improvement) | FIXED | 02174bb8 |

### Verification
- engine/create.supportdir-win32-2039.test.js 2/2; with create.test.js + store.test.js + store.dataroot-570.test.js = 161/161 pass.
- Non-vacuous: reverting supportDir to the old copy passes the behavioural test on a Mac (cannot see win32) and REDS the source-pin -- exactly the class this guards; confirmed by the reviewer's mutation and restored clean.
- Third copy: none. store.js:95 is the one data-root source; create.js now only delegates. win32 correctness is store.dataRootFor's, proven in store.dataroot-570.test.js.
- Real-Windows verification of the resulting %APPDATA% path is for the Windows verification agent (cannot run Windows here); the derivation is store.dataRootFor's, already covered for win32.
