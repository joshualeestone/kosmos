---
pre_challenge: true
method: challenge-loop
branch: retention-1605
diff_hash: bf61ab4d4bb855e25485a77fb40144dc08b670ae3f20127320d5a576ae888cf3
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T15:19:07Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 raised no BLOCKER or WARNING)
**Total findings:** 20 (2 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 11 NITs across rounds; counted from the reviewers' reports)
**Fixed:** 2 BLOCKERs, 7 WARNINGs, 7 NITs | **Deferred:** 4 NITs (reasons in the plan) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
- [BLOCKER] shallow clone read as "no prior served versions" and pruned them (reproduced). Fixed: fail closed on a shallow repo.
- [BLOCKER] file:// base with %XX decoded by curl to the dist itself; every file matched its own hash (reproduced). Fixed: refuse % and @; per-file device:inode refusal.
- [WARNING] site host blacklist bypassable (userinfo, trailing dot, encoding). Fixed; redirects no longer followed.
- [WARNING] prior served protected by version string only. Fixed: old pointers' artifact names protected.
- [WARNING] history read from a stale HEAD. Fixed: fail closed when behind upstream.
- [NIT] x5: empty --referenced-by, "pruned" JSON, stale message, message-less refusal asserts, Gate 5 spellings. All fixed.
**Self-generated:** 0

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] no-redirect change untested (reproduced). Fixed: Gate 10, a real local https 302.
- [WARNING] vercel.app alias of the site not refused. Fixed.
- [NIT] win-x64 gate refusal untested: fixed (Gate 11). [NIT] conditional JSON keys: deferred.
**Self-generated:** 1 (the redirect change was round 1's own fix)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] a promote during the gate got its served version deleted (reproduced). Fixed: pointer fingerprint re-checked before deletion (Gate 12).
- [WARNING] file_id failed open under GNU stat. Fixed: GNU first plus a digits:digits shape check (Gate 13).
- [NIT] Gate 10 server leak on interrupt: fixed. [NIT] x3 deferred: unfetched upstream, same-disk file:// base, sidecar-only references.
**Self-generated:** 1 (file_id was round 1's own fix)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs. No issues found at BLOCKER or WARNING; reviewer mutated both round-3 guards and each test failed.
**Self-generated:** 0

### Final validation (6j)
Full validation helper on HEAD 950ecd4ba: PASSED, hash bf61ab4d4bb8, exit 0; tools/test-dist-retention.sh 146 passed, 0 failed inside it. Every fix was also mutation-checked (14 mutants; the one standalone survivor, the file_id shape check, is killed in combination with the pre-fix ordering).
