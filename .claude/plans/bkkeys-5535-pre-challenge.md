---
pre_challenge: true
method: challenge-loop
branch: bkkeys-5535
diff_hash: df051040f08d12553a0df91f23ddc71d3e6f333ef444043c576091bc5e8a12d5
validation: passed
subdir_audit: passed
timestamp: 2026-10-09T06:00:50Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes
**Total findings:** recorded per round in the commit messages below (each review round's fixes are one commit named
"(#5535 review N)"); round 12 found no BLOCKER and no CONVENTION, and its one WARNING is deferred with a reason.
**Fixed:** every BLOCKER and WARNING of rounds 1 to 11 | **Deferred:** see the plan's Deferred section, plus round 12's
WARNING | **Asked (awaiting user):** 0

Validation, stated exactly so it is not over-read: the Mortals full suite PASSED (entry status clean, rc 0, 00:59 CDT)
on ef79744fa, based on main 90c64b981, hash 3cf9d1d3a53a. The branch was then rebased onto main 6f5d0804c (141 commits
later) with no conflict. The rebased diff differs from the validated one only in blob ids and one hunk's line offset in
engine.reachable.test.js (measured by diffing the two branch diffs), so the change is byte-identical; the hash above is
the rebased one. On the rebased head, engine/backupkeys.test.js and engine.reachable.test.js: 26 pass, 0 fail. The PR's
own CI runs the full suites on current main.

Mutants (plan, Tests section): 15 red; info and the up-front length check retired as equivalent and deleted; len kept
on purpose as the one line stating the rule.

### Per-Iteration Breakdown

Reviewer models alternated opus (odd rounds) and sonnet (even rounds).

#### Iteration 1
**Reviewer model:** opus
- [WARNING] WRAP_LEN orphaned once the up-front length check went, so engine.reachable was red and an excuse mutant measured on it proved nothing --> FIXED (460e87d49, re-measured 9d940e9c8)
- [NIT] string ids documented --> FIXED (460e87d49)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] an unauthenticated naming-key wrap must not name new chunks --> FIXED (d888bffd7: unwrapNamingKey is restore only)
- [WARNING] contexts must read own fields only; numeric ids --> FIXED (d888bffd7)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a period can hold several naming keys; a manifest must say which --> FIXED (b9490b1b0: namingKeyId)
- [WARNING] context values read twice (a getter) --> FIXED (b9490b1b0); a known-answer wrap added

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] a forged naming key was refused only later, by chunk names --> FIXED (4640b97a6: expectedId required)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] expectedPk must come from an authenticated source; constant-time id compare --> FIXED (75ba0b8a0)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] both unwraps anchored to an authenticated source; a naming-key known-answer wrap --> FIXED (d7e2916e5, 1dd759f1b)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] plan paragraph contradicted the required id; a low-order recipient key leaked OpenSSL's sentence --> FIXED (f01d45ecf)
- [NIT] naming key random by design (not derived): the Mac never holds the member private key --> recorded (f01d45ecf, plan)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] X25519 clamping: the returned secret may differ in clamped bits --> FIXED (c39964374: contract on unwrapMemberKey); return-clamped DEFERRED (plan)
- [NIT] an expected key on WRAP --> DEFERRED (plan: generated moments before the wrap)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] my #5535 comment named a wrong HPKE info string --> FIXED (corrected on #5535 with the exact bytes and both known-answer wraps; 553730cb4)
- [WARNING] forged member-wrap control; policy-bundle obligation --> FIXED (553730cb4)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] the parameter name must say its source --> FIXED (c7dee317c: verifiedMemberPk); the magic is a routing hint

#### Iteration 11
**Reviewer model:** opus
- [WARNING] the swapped-magic test could pass on the magic alone --> FIXED (60ee6ba09: now fails only on the associated data)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
- [WARNING] the recipient's role (org, device, destination) is not in the associated data --> DEFERRED: HPKE binds the wrap to the recipient's public key (pkR), so a wrap opens only for the key it was made for, and restorerequest.js authorizes which destination a re-seal goes to. A role line would add no protection a key does not already give, and would change the pinned bytes the unwrap service matches.
**Converged** - no new actionable findings.

### Outstanding
- Ice Cream Kitty asked on #5535 (comments 6074080681 and 6074797135) to object before merge if the unwrap service reads the wrap bytes differently; the known-answer wraps pin them. No objection so far.

### Strengths (across all iterations)
- Every unwrap anchored to an authenticated value (the signed policy bundle's member key, the signed manifest's naming-key id)
- unwrap* never throw; wrap* throw only on caller mistakes
- Known-answer wraps for both kinds pin the bytes end to end
