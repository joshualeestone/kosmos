---
pre_challenge: true
method: challenge-loop
branch: linuxpromote-7281
diff_hash: 9a7b19b1e79dc6cef6c14fa2d60b654cff2d71f862014ca2aacab5171c729125
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T11:09:52Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the standing review-loop cap (at most 8 rounds unless a BLOCKER is open; the operator's
standing rule for this agent). No round found a BLOCKER. Round 8's one WARNING is fixed and validated; its NITs are
recorded. A natural convergence would need a further round with no new finding, which the cap does not allow.
**Total findings:** 0 BLOCKERs, 17 WARNINGs, 2 CONVENTIONs, many NITs
**Fixed:** 15 WARNINGs | **Deferred:** 1 WARNING (duplicate of a fixed one), 1 CONVENTION | **Asked:** 0

Rounds 1 to 3 ran 2026-10-26 23:1x to 23:4x on the branch stacked on C1; rounds 4 to 8 ran 2026-10-27 04:2x to 05:2x on
the rebase onto main after C1 (#7301) merged. Every round's detail is in .claude/plans/linuxpromote-7281.md.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] promote-channel.sh - a Linux write failure after latest.json exited before /setup and the alias --> FIXED (stage before, one rename after, refuse at the end)
- [WARNING] promote-linux.sh - the Linux manifest lacked the Mac's verify-under and key-list checks --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1
- [WARNING] test-promote-linux-7281.sh - the key-list test passed with the check deleted --> FIXED (real bare origin; mutant red)
- [WARNING] promote-linux.sh - an early exit after a failed rename did not say the Linux remedy --> FIXED (EXIT trap)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1
- [WARNING] test-promote-linux-7281.sh - the key-list stub never opened the list --> FIXED (stub needs the committed signature; mutants red)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0
- [WARNING] promote-linux.sh:36 - named promote refused with no rollback path --> FIXED (message; superseded by iteration 5's named support)
- [WARNING] promote-linux.sh:79 - a prod pointer with no manifest skipped verify-under --> FIXED (refuses)
- [WARNING] promote-linux.sh:92 - artifacts verified only before the gates --> FIXED (re-checked before the writes)
- [WARNING] promote-channel.sh:745 - the two renames are not atomic --> FIXED (documented in the header with the remedy)
- [CONVENTION] C3 must merge with or before C2 --> already met (C3 merged e40f95e4d)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] promote-linux.sh:41 - named promotes (#7005) gone once staging carries Linux --> FIXED (reads the pointer committed with the named build)
- [WARNING] promote-channel.sh:848 - nothing downstream refuses a split pair --> FIXED (deploy_linux_carry lockstep refusal)
- [WARNING] test-promote-linux-7281.sh - no driven whole promote --> FIXED (e2e: go, skew, owed; mutant 5 red)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2
- [WARNING] test-promote-linux-7281.sh - no driven named promote --> FIXED (e2e named; mutant 4 red)
- [WARNING] promote-channel.sh:758 - renames not atomic --> DEFERRED (duplicate of iteration 4's, documented and now backstopped by the deploy refusal)
- [WARNING] promote-linux.sh:46 - comment claimed the named files are never replaced --> FIXED (now states the sha check it relies on)
- [WARNING] deploy-linux.sh:66 - greedy sed for the Mac version --> FIXED (JSON read)
- [CONVENTION] review-round labels in comments --> DEFERRED (the repo's code carries them throughout)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1
- [WARNING] promote-linux.sh - named-promote remedies said to copy the moved-on staging file --> FIXED (PROMOTE_LINUX_RESTORE names the commit; mutant 2 red)
- [WARNING] promote-channel.sh - a rollback deploy needs KOSMOS_LINUX_ROLLBACK, unsaid --> FIXED (printed)
- [WARNING] promote-linux.sh:44 - pre-Linux named rollback gives no way forward --> FIXED (message) + recorded as a known limit

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] promote-linux.sh:100 - mktemp -d with no TMPDIR template --> FIXED (test-mktemp-template-4298: 0 failures)
- NITs fixed: stale test header, quoted paths in the named remedy, "no version" in the deploy refusal

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | promote-channel.sh | BRANCH | Linux failure exits before /setup | FIXED | round 1 |
| 2 | 1 | WARNING | promote-linux.sh | BRANCH | missing verify-under / key list | FIXED | round 1 |
| 3 | 2 | WARNING | test-promote-linux-7281.sh | SELF | key-list test vacuous | FIXED | round 2 |
| 4 | 2 | WARNING | promote-linux.sh | BRANCH | remedy unsaid on early exit | FIXED | round 2 |
| 5 | 3 | WARNING | test-promote-linux-7281.sh | SELF | stub never opened the list | FIXED | round 3 |
| 6 | 4 | WARNING | promote-linux.sh:36 | BRANCH | named refusal, no rollback path | FIXED | ff4862fe75 |
| 7 | 4 | WARNING | promote-linux.sh:79 | BRANCH | malformed prod pointer skipped | FIXED | ff4862fe75 |
| 8 | 4 | WARNING | promote-linux.sh:92 | BRANCH | artifacts not re-checked | FIXED | ff4862fe75 |
| 9 | 4 | WARNING | promote-channel.sh:745 | BRANCH | non-atomic renames | FIXED | ff4862fe75 |
| 10 | 5 | WARNING | promote-linux.sh:41 | BRANCH | named promotes lost | FIXED | 017639a8fa |
| 11 | 5 | WARNING | promote-channel.sh:848 | BRANCH | split pair deployable | FIXED | 017639a8fa |
| 12 | 5 | WARNING | test-promote-linux-7281.sh | BRANCH | no driven promote | FIXED | 017639a8fa |
| 13 | 6 | WARNING | test-promote-linux-7281.sh | SELF | no driven named promote | FIXED | 5de93a2c92 |
| 14 | 6 | WARNING | promote-linux.sh:46 | SELF | comment overclaimed | FIXED | 5de93a2c92 |
| 15 | 6 | WARNING | deploy-linux.sh:66 | BRANCH | greedy sed | FIXED | 5de93a2c92 |
| 16 | 7 | WARNING | promote-linux.sh | SELF | named remedy names the wrong file | FIXED | 4f42df3270 |
| 17 | 7 | WARNING | promote-channel.sh | BRANCH | rollback deploy variable unsaid | FIXED | 4f42df3270 |
| 18 | 7 | WARNING | promote-linux.sh:44 | BRANCH | pre-Linux rollback dead end | FIXED | 4f42df3270 |
| 19 | 8 | WARNING | promote-linux.sh:100 | BRANCH | mktemp without template | FIXED | 1d78283f49 |

Test counts on the final head: test-promote-linux-7281 73/0, test-deploy-linux-7281 47/0, test-release-linux-7281 67/0;
full suite green (validation hash 9a7b19b1e79d).

### Known limits (recorded, not fixed)
- A named rollback to a build cut before the first Linux build is refused (no Linux pointer to pair with).
- The two pointer renames are not atomic; a kill between them is caught by the deploy's lockstep refusal.
- The promote-channel.sh wiring is also covered by greps and line order, alongside the driven e2e.

### NITs (non-blocking, across all iterations)
- field() is a global function name; no bash -n of the lib in test:shell; the marker line could carry an SC2034
  disable; the named path's verify-under reads prod's Linux pointer from the working tree; shasum -c checks the file
  the sidecar names (then the sha is compared to the pointer's).

### Strengths (across all iterations)
- Every Linux check runs before any write and again right before the writes; a late Linux failure still lets /setup
  and the alias finish and refuses at the end.
- The key-list arm is tested against a real origin and a second clone, so only a fetch of the committed list passes.
- Named promotes read the Linux pointer from the same commit as the Mac one, checked byte for byte in a driven test.
