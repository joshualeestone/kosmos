---
pre_challenge: true
method: challenge-loop
branch: retention-1605
diff_hash: 462740abdac4a9a4bd3da9c1cdcc5862c1e912aada01a9e34d4c69eadfc2c877
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T16:17:24Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iterations 4 and 6 raised no BLOCKER or WARNING; 5 was a CI-driven reopen)
**Total findings:** 26 (2 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs, 16 NITs across rounds; counted from the reviewers' reports)
**Fixed:** 2 BLOCKERs, 8 WARNINGs, 9 NITs | **Deferred:** 7 NITs (reasons in the plan and below) | **Asked (awaiting user):** 0

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

#### Iteration 5 (reopened by CI)
**Reviewer model:** opus
PR #4360's macOS runner failed Gate 10: "the local https server did not start", 5s after launch. The same arm passes locally with both Homebrew and system openssl/python, so the cause is not reproduced here. The wait became about 30s, ending early if the server dies, and a failure now names the server's stderr.
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the failure message could not tell a signal kill from a slow start (reproduced). Fixed: it now reports "still running" or "exited rc=N".
- [NIT] openssl's stderr was discarded: fixed, kept and shown. [NIT] the comment overstated the bound: fixed. [NIT] `cut -c` counts bytes on macOS: kept, cosmetic.
**Self-generated:** 1 (the diagnostics were this loop's own iteration-5 change)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (a double `wait` on one pid, harmless; bash's own "Killed: 9" job line alongside the FAIL line). No issues found at BLOCKER or WARNING; both failure modes reproduced as reported correctly, with no hang or leak.
**Self-generated:** 0

### Final validation (6j)
Full validation helper on HEAD dc397dd06: PASSED, hash 462740abdac4, exit 0; tools/test-dist-retention.sh 146 passed, 0 failed inside it. (An earlier pass on 950ecd4ba, hash bf61ab4d4bb8, preceded the CI reopen.) CI on dc397dd06 then ran Gate 10 green on the macOS runner (both redirect arms PASS, test-dist-retention 146/146, job 109012212603). Every fix was also mutation-checked (14 mutants; the one standalone survivor, the file_id shape check, is killed in combination with the pre-fix ordering).
