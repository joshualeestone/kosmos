---
pre_challenge: true
method: challenge-loop
branch: doctrine-gemini-4406
diff_hash: 5ba4276147fd7c44c3919e505252584204bbb94f66e1c16719b080cc8af0a0bd
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T22:24:11Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes
**Total findings:** 45 (2 BLOCKERs, 17 WARNINGs, 3 CONVENTIONs, 23 NITs)
**Fixed:** 2 BLOCKERs, 16 WARNINGs, 3 CONVENTIONs, 15 NITs | **Deferred:** 1 WARNING | **Asked (awaiting user):** 0

Validation record, stated plainly: the 6.0 run and the 6g run after iteration 4 were each stopped before they
finished because that iteration's findings needed code changes (so each would have validated a superseded tree);
the run after iteration 6 was stopped because I edited the tree during it (my slip). Runs after iterations 1, 3
and the final run passed; the runs after iterations 2 and 5 were red only on engine/musefront.test.js "a long
turn keeps saying working" and engine/updating-988.test.js #3626 (not in this diff; both pass alone), and after
5 also on server.test "the detail panel withdraws the writes", which pinned the old rule and was updated. The
final validation ran on this head; its hash is this proof's diff_hash.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 7 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] focus stranded on the page after Try again --> FIXED (to the status line; later the box)
- [WARNING] loading line and Try again survived onto another agent's card --> FIXED (openDetail and untied resets; catch checks the card)
- [WARNING] a late restore answer could land in a newer load or disabled box --> FIXED (load token + INSTR_READY)
- [WARNING] restore replaced unsaved typing --> FIXED (INSTR_LOADED_TEXT guard)
- [WARNING] loading state not announced --> FIXED (role=status aria-live)
- [WARNING] check did not prove what Save sends after a restore --> FIXED (arm: restored text + loaded version)
- [WARNING] two loaders during Update --> FIXED
- [CONVENTION] check comment named a missing test file --> FIXED; [CONVENTION] README row --> FIXED
- [NIT] dead input dispatch, silent button when not editable, CSS rule placement, ellipsis --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
**Self-generated:** 2 of the above (iteration 1's own lines)
- [WARNING] unsaved-typing guard only before the fetch --> FIXED (asked again after the wait; arm)
- [CONVENTION] CSS move stranded the #3731 comment --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the check's own staging)
- [BLOCKER] the browser check was flaky: the page's 5 s poll withdrew the stand-in card mid-arm --> FIXED (the check keeps the card present and tied in /api/status)
- [WARNING] a missing file hid the restore --> FIXED (hasPrevious on the missing branch; engine test)
- [WARNING] untied arm did not reach the race it was credited with --> FIXED (drives the real race and Try again's refusal)
- [WARNING] focus after Try again on an emptied line --> FIXED (to the box when editable)
- [NIT] restore into a disabled box, .previous error wording --> FIXED; second press and tabIndex --> left

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] a refused-but-present file does not offer the restore --> DEFERRED: that branch answers editable:false, so Save is refused and a restore could never be kept
- [NIT] route try/catch like its sibling --> FIXED; [NIT] UTF-8 check written twice --> left

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (the blocker was setWritesOffered, pre-existing)
- [BLOCKER] the 5 s poll turned the box and Save on mid-load (an empty editable box whose typing the load replaced) --> FIXED (setWritesOffered waits for INSTR_READY; arms wait past a real tick)
- [WARNING] the loading and failed arms read before any tick --> FIXED
- [WARNING] "Loading" placeholder left on an untied card --> FIXED
- [WARNING] an empty kept file offered, and the message claimed too much --> FIXED
- [NIT] focus after a not-editable retry, write counting, listener removal, first-run flake --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] the poll's editable===false branch left the restore link up --> FIXED
- [NIT] second press refused; catch passes err.message --> left

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] the offer (hasPrevious) and the restore (readPrevious) could disagree on an empty or unreadable kept file --> FIXED (the instructions GET confirms it with readPrevious; server test with a control)
- [NIT] no-previous control, poll-not-editable arm, unused binding, nothing-kept route case --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] lstat check written twice in read(); readPrevious catch passes err.message; route try/catch unreachable

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html loadInstructions | BRANCH | focus stranded after Try again | FIXED | iteration 1 |
| 2 | 1 | WARNING | web/index.html openDetail/setWritesOffered | BRANCH | loading and retry leak to other cards | FIXED | iteration 1 |
| 3 | 1 | WARNING | web/index.html restore handler | BRANCH | late restore answer | FIXED | iteration 1 |
| 4 | 1 | WARNING | web/index.html restore handler | BRANCH | restore over unsaved typing | FIXED | iteration 1 |
| 5 | 1 | WARNING | web/index.html d-instr-loading | BRANCH | loading not announced | FIXED | iteration 1 |
| 6 | 1 | WARNING | render-detail-header-1841.js | BRANCH | Save after restore unproven | FIXED | iteration 1 |
| 7 | 1 | WARNING | web/index.html loadInstructions | BRANCH | two loaders during Update | FIXED | iteration 1 |
| 8 | 1 | CONVENTION | render-detail-header-1841.js | BRANCH | comment named a missing file | FIXED | iteration 1 |
| 9 | 1 | CONVENTION | docs/browser-checks/README.md | BRANCH | row not updated | FIXED | iteration 1 |
| 10 | 2 | WARNING | web/index.html restore handler | SELF | guard only before the fetch | FIXED | iteration 2 |
| 11 | 2 | CONVENTION | web/index.html CSS | SELF | stranded #3731 comment | FIXED | iteration 2 |
| 12 | 3 | BLOCKER | render-detail-header-1841.js | SELF | poll withdrew the stand-in mid-arm | FIXED | iteration 3 |
| 13 | 3 | WARNING | engine/instructions.js read | BRANCH | missing file hid the restore | FIXED | iteration 3 |
| 14 | 3 | WARNING | render-detail-header-1841.js | BRANCH | untied arm too weak | FIXED | iteration 3 |
| 15 | 3 | WARNING | web/index.html loadInstructions | BRANCH | focus on an emptied line | FIXED | iteration 3 |
| 16 | 4 | WARNING | engine/instructions.js read | BRANCH | refused-but-present file, no restore | DEFERRED | its Save is refused |
| 17 | 5 | BLOCKER | web/index.html setWritesOffered | BRANCH | poll turned box and Save on mid-load | FIXED | iteration 5 |
| 18 | 5 | WARNING | render-detail-header-1841.js | BRANCH | arms read before any tick | FIXED | iteration 5 |
| 19 | 5 | WARNING | web/index.html resets | BRANCH | placeholder left on untied card | FIXED | iteration 5 |
| 20 | 5 | WARNING | engine/instructions.js readPrevious | BRANCH | empty kept file offered | FIXED | iteration 5 |
| 21 | 6 | WARNING | web/index.html tick | BRANCH | restore link left when not editable | FIXED | iteration 6 |
| 22 | 7 | WARNING | server.js instructions GET | BRANCH | offer and restore disagree | FIXED | iteration 7 |

### NITs (non-blocking, across all iterations)
- Left: a second restore press is refused as unsaved (reopen drops it); status line keeps tabIndex -1; UTF-8 and lstat checks written twice; readPrevious catch passes err.message; route try/catch unreachable in practice.

### Strengths (across all iterations)
- The restore writes nothing; Save and its version check stay the only write path, proven both ways by the check (1, 3, 7, 8)
- readPrevious reads through the same hardened reader as the file itself (1, 3, 4, 8)
- Every arm was shown to fail with its fix removed; the poll-timing arms wait through a real tick (5, 6, 7)

The branch was rebased on origin/main after convergence (clean); the final validation (11297 pass, 0 fail) ran on the rebased head.
