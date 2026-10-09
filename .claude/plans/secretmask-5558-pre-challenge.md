---
pre_challenge: true
method: challenge-loop
branch: secretmask-5558
diff_hash: adf2827127a7053e43694592f2fb5c77454e0062b0d8f624794d3e13eda0ad30
validation: passed (focused: secretmask 133/133, the 3 other files requiring secretmask, 8 file-scanning guards; the full suite runs in CI before merge)
subdir_audit: passed
timestamp: 2026-10-08T05:05:51Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating, each blind)
**Converged:** Yes (iteration 8: nothing above NIT)
**Total findings:** 1 BLOCKER, 13 WARNINGs, 2 CONVENTIONs, about 12 NITs
**Fixed:** all BLOCKERs and WARNINGs except one accepted as the named residual | **Asked (awaiting user):** 0

The change: engine/secretmask.js isPlainPath lets the long_token heuristic leave a relative path made only of plain pieces unmasked (#5558). The safety rule throughout: never leave unmasked a secret main masked.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] random lowercase+digit tokens behind a path prefix passed as plain (up to 7.5% fuzzed) --> FIXED: each piece judged whole; y not a vowel; no single-letter words. Seeded test.

#### Iteration 2 (sonnet)
- [NIT] a digit run with stray letters cut by slashes passed --> FIXED: mostly-digit rule narrowed to dates and x64/x86.

#### Iteration 3 (opus)
- [WARNING] number pieces had no length cap and a path needed no word --> FIXED: numbers capped, a word required.

#### Iteration 4 (sonnet)
- [WARNING] random letter pieces (goxswayqboz) passed as words --> FIXED: word-shaped (vowel ratio, no 4-consonant run, no q without u); reusing madeOfWords' wordLike measured and rejected (keeps 93 of 4,219 real paths plain against 3,097).

#### Iteration 5 (opus)
- [BLOCKER] an all-digit secret cut into short numbers with a word in front went unmasked where main masked it --> FIXED: whole-path digit budget, real dates only.
- [WARNING] review 3's test could not see its cap removed --> FIXED.
- [WARNING] the seeded generator cycled (precision past 2^53) --> FIXED with Math.imul.

#### Iteration 6 (sonnet)
- [WARNING] a date bought 10 extra digits --> FIXED: 8-digit budget outside one date (measured: 5 real paths lose, against 30 at 6).
- [WARNING] pronounceable random pieces --> ACCEPTED as the residual named in the code comment.
- [WARNING] seven rules survived mutation --> FIXED: one test case per rule, each red under its mutation.
- [CONVENTION] review history in the code comment --> FIXED.

#### Iteration 7 (opus)
- [WARNING] the case rule unpinned --> FIXED (test).
- [WARNING] date parts unpinned, and a date's time added 6 free digits --> FIXED: a real time required (0 real paths change); each part tested and red under mutation.
- [NIT] redundant vowels >= 1 --> FIXED. Residual comment made accurate.

#### Iteration 8 (sonnet)
- Nothing above NIT. 14 of 16 mutations red; the 2 survivors are equivalent mutants (per-piece caps covered by the whole-path budget).

### Residual (stated in the code)
A secret built from pronounceable syllable pieces, cut by slashes, with up to 8 digits besides one real date and time.

### Measurement
Repo sweep (kosmos tracked files, main's masker vs this): long_token 261 -> 202; every newly unmasked run read is a path.
- Rebased onto origin/main (17:37 CDT 2026-10-08): clean, no change to this branch's content; its last shell run failed only on two timing checks in tools/test-queued-heavy-4977.sh, which this branch does not touch. diff_hash recomputed.
