---
pre_challenge: true
method: challenge-loop
branch: accountpasskeys-8959
diff_hash: fa09c2cdd0fe2360e1e79cbd0e66f471b254ea10bf039c2f1a51fe655a82b38b
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T22:20:25Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the round-8 cap after iteration 8: Splinter's standing usage rule, 2026-10-22 and restated 2026-10-26, "past round 8 only an open BLOCKER continues"; no BLOCKER was open)
**Total findings:** 0 BLOCKERs; the WARNINGs and CONVENTIONs are listed per iteration below
**Asked (awaiting user):** 0

### Validation
- Each round ran ios/LogicTests/run-accountsecurity.sh (112 checks at the end, against kosmos-relay origin/main's page),
  run-accountsecond.sh (77) and run-account.sh (55), and swiftc -typecheck against the iOS SDK at the iOS 16 target.
  Mutants named per iteration below each failed their checks.
- AccountScreenUITests 3 of 3 in LIGHT and in DARK on the final head 7763fc3767 (14:52 CST, a throwaway iPhone 17e
  simulator on iOS 27.0, its turn taken through queued-heavy.sh). Dark shots read by eye.
- Full validation on 7763fc3767 (16:19 CST): node 30,358 passed, 0 failed; shell part 4 of 4 shards; subdir audit
  passed. validation_rc=0, first attempt. Only the plan file changed after it.
- Earlier UI runs: r1 and r2 failed on the TESTS (rows built lazily below the fold; iOS 27 popovers have no Cancel),
  fixed with reveal() and closeDialog(); r3 passed on an earlier head.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus

- [WARNING] a good read did not clear a failed read's note FIXED
- [WARNING] Remove and Not me acted on whatever sign-in was current FIXED (pinned to the sign-in that opened them)
- [WARNING] Not me's busy flag not per sign-in FIXED
- [WARNING] before iOS 17.4 an existing passkey could be replaced FIXED (Add not offered)
- [WARNING] the passkey host was not checked FIXED (the page's words) and a cancelled sheet spent a challenge FIXED (reused)
- [WARNING] UI checks after closing a dialog could not fail FIXED
- [NIT] new-places failure emptied the list FIXED; iOS 18 comment FIXED; others noted

#### Iteration 2
**Reviewer model:** sonnet

- [WARNING] a reused challenge lost its true age FIXED
- [WARNING] refusals that never used the challenge dropped it FIXED (held until finish)
- [NIT] sample Not me silent noted

#### Iteration 3
**Reviewer model:** opus

- [WARNING] the review account was told to sign in again FIXED (its own sentence kept)
- [WARNING] Apple's sheet could outlive the challenge FIXED (closes 15 s before)
- [WARNING] Remove did not mention the Passwords app FIXED
- [WARNING] the 17.4 check ran after begin FIXED (before begin too)
- [WARNING] the page-words check read a stale checkout FIXED (git show origin/main)
- [WARNING] footer and VoiceOver labels FIXED (dated labels, identifiers)

#### Iteration 4
**Reviewer model:** sonnet

- [WARNING] the challenge's age read back from state FIXED (carried)
- [WARNING] a step-up after the passkey was made gave no delete instruction FIXED
- [WARNING] UI test tapped an unbuilt row FIXED
- [WARNING] the iOS 18 error case at the iOS 16 target MEASURED compiles

#### Iteration 5
**Reviewer model:** opus

- [WARNING] B1b's renewal read as a sign-in change dropped an Add, a Not me sign-out or a read FIXED (renewal chain)
- [WARNING] one note shared by reads and actions FIXED (split)
- [WARNING] only the step-up refusal said to delete the made passkey FIXED (every refusal)
- [WARNING] Not me's 401 treated as signed out everywhere FIXED (says nobody was signed out)
- [WARNING] two-step setup could start mid-Add FIXED (disabled)

#### Iteration 6
**Reviewer model:** sonnet

- [WARNING] the renewal hop bound was off by one FIXED (AccountSecurity.follow, pure, tested; mutant caught)
- [WARNING] a renewal kept only in memory was not recorded FIXED

#### Iteration 7
**Reviewer model:** opus

- [WARNING] the 17.4 note sent people to the in-app page, which hides Add FIXED (Safari or a computer)
- [WARNING] the Passwords app exists only from iOS 18 FIXED (both places named; "if saved on this iPhone")
- [WARNING] Add read "Adding" during a Remove FIXED
- [WARNING] the page-words check could depend on a fleet Mac's clone FIXED (CI skips explicitly)
- [CONVENTION] leftover comments FIXED

#### Iteration 8
**Reviewer model:** sonnet

- [WARNING] the skip NOTE said "not found" FIXED
- [WARNING] an Add whose begin answered after leaving the screen opened Apple's sheet FIXED
- [NIT] end marks and wording FIXED

### Strengths (across all iterations)
- [STRENGTH] The CBOR walk that takes authData out of iOS's attestation object refuses anything it cannot read exactly.
- [STRENGTH] Every rule and sentence is in AccountSecurityLogic.swift, tested without a simulator.

### Outstanding questions
None. The decisions and the weakest premise are in .claude/plans/accountpasskeys-8959.md.
