---
pre_challenge: true
method: challenge-loop
branch: wxlink-9268
diff_hash: de59256bf79203ed9821fef12b4ef6ef0a68b5f5f4012f7625d4cbdcd0d2b565
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T08:04:02Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's review usage rule (Splinter, 2026-10-22, restated 2026-10-26 m510): a
review loop stops at 8 rounds unless a BLOCKER is still open, and past 8 the WARNINGs go to a follow-up card. No
BLOCKER was raised in any round. Round 8's two WARNINGs and three NITs are card #9285, claimed by the same author.
**Total findings:** 33 (0 BLOCKERs, 17 WARNINGs, 0 CONVENTIONs, 16 NITs)
**Fixed:** 13 WARNINGs and 9 NITs | **Deferred:** 2 WARNINGs, 4 NITs | **To #9285:** 2 WARNINGs, 3 NITs | **Asked:** 0

Validation: the full suite through the normal queue, PASSED attempt 1, validation_rc=0 audit_rc=0 at head 7520586526
(main merged in; node 32018 tests, 0 fail; every shell shard; build). Static guards (4051 pass) and the browser-check
surface gate (rc 0) ran first. Measured on other platforms from the never-merged branch wincl3-8378-never-merge:
GitHub's Windows runner (runs 46118787881, 46119679376, 46119979883, 46121258434: every #9268 arm passes, trust.test.js
green) and a Linux container on overlay (run 46121258434: 91 pass, 0 fail).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/securewrite.js — the check asked "is the name a link now"; a name swapped after the open defeats it (measured with a probe) --> FIXED (same-file check, swap arm)
- [WARNING] engine/securewrite.js — the comment above the open still stated the POSIX premise as universal --> FIXED
- [WARNING] engine/securewrite.js — the helper sat between TEMP_RE and its comment --> FIXED
- [NIT] EEXIST reused for our own refusal --> FIXED (own code); [NIT] possible double close --> FIXED; [NIT] plan overclaim --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the double close, and the swap arm's assertion, both written in iteration 1's fix)
- [WARNING] failing closed on unreadable stat answers would refuse every save on such a mount --> FIXED (positive evidence only)
- [WARNING] a hard link to the made file passed the check --> FIXED (link-count rule, hard-link arm)
- [WARNING] the swap arm's assertion could not fail; leftover undocumented --> FIXED (asserts the residue, documented)
- [WARNING] ERR_KOSMOS_SYMLINK given a second meaning --> FIXED (ERR_KOSMOS_TEMP_SWAPPED)
- [NIT] double close; created-flag comment; transient-stat litter; lstat-unlink gap --> FIXED (3), DEFERRED (1, guarded by the same-file check)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the cleanup guard had no arm (mutant survived) --> FIXED (re-pointed-link arm)
- [WARNING] the "gone" and "not a regular file" rules had no arm --> FIXED (removed and folder arms; the not-a-file rule is unreachable where identities read, measured on the Mac and Windows, stated in the code)
- [WARNING] comments read as if the check-to-rename window were closed --> FIXED (stated as accepted residue)
- [NIT] compare before close; header list; cleanup in one arm --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the cleanup comment written in iteration 3)
- [WARNING] the cleanup checked an inode but unlinked a path after the close --> FIXED (re-check before unlink)
- [NIT] folder-arm comment overclaimed; long header line; junction note --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the Windows rename-back race (the made file moved back to the temp name before the check) --> DEFERRED: stated as accepted residue in the code and plan; closing it needs the access list set or checked at the open
- [WARNING] no arm pinned the error code or the atomicOnly exhaustion path (mutant survived) --> FIXED (all-refused arm, also pins one close per refused fd)
- [NIT] fd close untested --> FIXED (same arm); header wording --> FIXED; isSymbolicLink redundant in the rule --> DEFERRED (it decides the cleanup)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] an unexpected throw from the check would leak the fd --> FIXED
- [WARNING] atomicOnly callers see a new throw source --> DEFERRED: none branches on it, and it reports the safe failure (config untouched)
- [NIT] nlink as a second premise --> FIXED (plan); swap residue; folder arm a control --> DEFERRED (both already stated)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the double-close path written in iteration 6)
- [WARNING] about 70 atomicOnly callers would fail outright if the check misfired; no Linux run --> FIXED (plan corrected; measured in a Linux container on overlay, 91 pass)
- [NIT] the pre-unlink re-check had no arm --> FIXED (renamed-onto arm); one close site --> FIXED (the check only decides); lstat non-ENOENT note --> FIXED

#### Iteration 8 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] three forced refusals reach the in-place fallback (not a regression), undocumented --> card #9285
- [WARNING] unmeasured share and FUSE mounts for the same-file rules --> card #9285
- [NIT] a long doc sentence; litter after a refusal; planted name untouched asserted in one arm only --> card #9285
**Stopped** at the 8-round rule with no BLOCKER open.

### Final Ledger (WARNINGs)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/securewrite.js | BRANCH | link-now check defeated by a swap | FIXED | eb0bd0c605 |
| 2 | 1 | WARNING | engine/securewrite.js | BRANCH | stale POSIX-only comment | FIXED | eb0bd0c605 |
| 3 | 1 | WARNING | engine/securewrite.js | SELF | helper between TEMP_RE and its comment | FIXED | eb0bd0c605 |
| 4 | 2 | WARNING | engine/securewrite.js | SELF | failed closed on unreadable stats | FIXED | round 2 commit |
| 5 | 2 | WARNING | engine/securewrite.js | SELF | hard link passed | FIXED | round 2 commit |
| 6 | 2 | WARNING | engine/securewrite.test.js | SELF | swap assertion could not fail | FIXED | round 2 commit |
| 7 | 2 | WARNING | engine/securewrite.js | SELF | shared error code | FIXED | round 2 commit |
| 8 | 3 | WARNING | engine/securewrite.js | SELF | cleanup guard untested | FIXED | round 3 commit |
| 9 | 3 | WARNING | engine/securewrite.js | SELF | gone and not-a-file untested | FIXED | round 3 commit |
| 10 | 3 | WARNING | engine/securewrite.js | SELF | window read as closed | FIXED | round 3 commit |
| 11 | 4 | WARNING | engine/securewrite.js | SELF | unlink by path after close | FIXED | 4f74176faf |
| 12 | 5 | WARNING | engine/securewrite.js | BRANCH | Windows rename-back race | DEFERRED | stated residue |
| 13 | 5 | WARNING | engine/securewrite.test.js | SELF | code and exhaustion untested | FIXED | 81f2625bc8 |
| 14 | 6 | WARNING | engine/securewrite.js | SELF | fd leak on a throw | FIXED | c2853b5fa5 |
| 15 | 6 | WARNING | engine/securewrite.js | SELF | new throw source for atomicOnly | DEFERRED | safe failure, no branch |
| 16 | 7 | WARNING | .claude/plans/wxlink-9268.md | SELF | atomicOnly outright failure, no Linux run | FIXED | 93e61a5deb |
| 17 | 8 | WARNING | engine/securewrite.js | SELF | forced fallback, unmeasured mounts | CARD | #9285 |

### Strengths (across all iterations)
- Refuses only on positive evidence; unreadable stat answers never refuse an ordinary save (measured on Mac, Windows, Linux overlay)
- `created` stays false on a refusal, so the planted name is never unlinked; one close per path
- Every arm that pins a rule fails when that rule is removed (mutants run in rounds 3, 5 and 7)
- No em dashes in any added line (measured every round)
