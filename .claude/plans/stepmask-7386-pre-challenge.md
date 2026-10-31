---
pre_challenge: true
method: challenge-loop
branch: stepmask-7386
diff_hash: 9dd60d4c38a612ff442a98248f7cd2cdab6e3c0a4740097e9bafe8766701e25a
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T23:55:55Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (round 6: nothing above NIT; its NIT taken)
**Total findings:** 17 (6 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 6 BLOCKERs, 2 WARNINGs, 6 NITs | **Decided and documented:** 3 NITs | **Asked (awaiting user):** 0

One fresh blind reviewer per round, one at a time; rounds 4-6 measured against origin/main by differential fuzz (20,000 inputs, 0 differences) and a scan of every code point. Validation on HEAD: the new test file 16/16, deliverystreak.turn-7368 17/17, 43 related and repo-wide audit files 1928 pass, 0 fail. Each fix test fails on the version before it; round 6 killed six injected mutants.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] the character list (C1 and bidi only) missed invisible operators, variation selectors, tag characters and more; each let a key show --> FIXED (by category: Cc, Cf, Default_Ignorable) (073a40364c)
- [BLOCKER] the tool name skipped the fold; folding a C0 control first split a key --> FIXED (073a40364c)
- [WARNING] more entries in the shared mask cache --> FIXED (a shell step masks one value, as on main) (073a40364c)

#### Iteration 2
- [BLOCKER] the raw guard missed a password spaced with NBSP, U+3000 or U+2028 that the display folded (main masked it) --> FIXED (what is shown is what is checked) (5c3fac24a7)
- [BLOCKER] a raw cut before the fold let padding push half a key into the step --> FIXED (cut after the fold) (5c3fac24a7)
- [NIT] a stray probe file in the worktree --> FIXED (checked identical to main, removed)

#### Iteration 3
- [BLOCKER] a raw cap before the fold still let collapsed padding show the front of a key --> FIXED (the whole value folded, then cut) (c694d52d74)
- [WARNING] the removed copy joined lines of an ordinary hash list into a false key --> FIXED (line breaks kept as a space) (c694d52d74)
- [NIT] combining marks and the Braille blank split a key --> FIXED (c694d52d74)

#### Iteration 4
- [WARNING] cost on megabyte inputs: 5 MB of newlines 552 ms against main's 3.9 ms --> FIXED (one sticky-regex pass, stopping at the cut: 3.3 ms) (349ab8b557)
- [NIT] private-use characters split a key --> FIXED (Co) (349ab8b557)
- [NIT] the combining-mark control could not fail --> FIXED (real Mn and Devanagari controls) (349ab8b557)
- [NIT] a command of only zero-width characters now reads as a tool step --> DECIDED (harmless; nothing to show)

#### Iteration 5
- [BLOCKER] U+FEFF counted as whitespace, so a key split by it showed nearly whole --> FIXED (with the C0 controls) (89226f4d01)
- [NIT] a whitespace-only tool name now gives no step --> DECIDED (an improvement; main broke the one-line rule)
- [NIT] secretmask does not mask an AKIA key after an underscore --> DECIDED (secretmask's, main too: filed #7395)

#### Iteration 6
- Nothing above NIT.
- [NIT] U+2028 and U+2029 did not count as line breaks --> FIXED (7091b880d0)
