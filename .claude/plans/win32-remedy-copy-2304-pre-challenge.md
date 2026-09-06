---
pre_challenge: true
method: challenge-loop
branch: win32-remedy-copy-2304
diff_hash: eb2fecd6c52c6e6fa012a1da35df218f2f461db92d231d1eafedf3c40ee8d338
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T19:52:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 | **Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING and one deferred CONVENTION).
**Total findings:** 4 WARNING, 1 CONVENTION. **Fixed:** 3 | **Deferred:** 2 | **Asked:** 0.

kosmos#2304 defect-2: platform-gate the two FAILURE arms of `installedCheck` so a Windows user does not meet macOS copy once `platform.js` SUPPORTED includes win32. Three phrases gated on the injected `platform`/`isWin`: the missing-runner remedy's "Download for macOS", the unusable-path detail's "the parts of macOS", and "a backslash" in the forbidden-character list (a backslash is the win32 separator, `create.unusablePath` allows it there, #1889). darwin byte-identical, controls pin it. Full suite green (4932/4932).

### Per-Iteration Breakdown

#### 6.0 baseline
Machine suite 54/54 green with the gated copy; darwin byte-identical verified by reconstruction.

#### Iteration 1
**New:** 4 WARNING, 0 CONVENTION.
- [WARNING] the UNUSABLE-path remedy was left Kosmos-framed on win32 (the same dishonesty gated on the missing arm) --> FIXED: win32 unusable remedy is now runner-framed ("The part that runs agents is installed somewhere Kosmos cannot start it from"), since on win32 the unusable path is the runner's, not Kosmos's.
- [WARNING] the two darwin CONTROL tests pinned only a SUBSTRING while their names claimed "byte-unchanged" --> FIXED: both now assert the FULL remedy/detail strings via includes(), so any edit to the macOS wording reds.
- [WARNING] the win32 missing remedy restated the preamble and was not actionable --> FIXED (partial): tightened to lead with the action ("Install the part that runs agents, then open Kosmos again."); the missing download TARGET stays a documented TODO(#2304/#570) that Josh owns.
- [WARNING] the win32 char list omits `$`/backtick that create.unusablePath forbids --> DEFERRED: identical to the pre-existing darwin copy (which also names only quote/backslash/line-break); expanding it would force a darwin change that must stay byte-identical, and is out of this card's scope.

#### Iteration 2 -- CONVERGED
**New:** 0 BLOCKER, 0 WARNING. Confirmed darwin byte-identity, no macOS/backslash leak in either direction, and that the win32 tests genuinely discriminate (the positive win32 assertions cannot match the darwin strings). 1 CONVENTION:
- [CONVENTION] the new comments use ` -- ` ASCII double-hyphens --> DEFERRED: the reviewer confirmed ZERO em-dash characters (U+2014) introduced; ` -- ` is the established idiom throughout machine.js and the fleet's way of writing a dash without the glyph Josh strips. A single hyphen would read worse and diverge from the surrounding file (matching surrounding style is the standing guidance).

### Strengths
darwin output is byte-identical (reconstructed on both arms and pinned by full-string control tests that can return the dangerous answer); both win32 failure arms are runner-framed rather than Kosmos-reinstall-framed, which is the honest attribution on a platform where the runner is the required part; the win32 positive assertions (`A quote or a line break`, `the part of this computer that starts an agent`, `The part that runs agents is installed somewhere Kosmos cannot start it from`) each fail against the corresponding darwin string, so a copy regression in either direction reds.
