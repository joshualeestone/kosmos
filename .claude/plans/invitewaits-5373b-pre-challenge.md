---
pre_challenge: true
method: challenge-loop
branch: invitewaits-5373b
diff_hash: 50099ed5ecf8ed7580c60ef962e6a6fed66e7e387462fa784eb37f954e840384
validation: passed (Mortals, hash 50099ed5ecf8, 14:59 CDT 2026-10-06)
subdir_audit: passed
timestamp: 2026-10-06T21:31:13Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, reviewers alternating Sonnet (1, 3, 5, 7) and Opus (2, 4, 6, 8).
**Converged:** Yes. Iteration 8 raised one WARNING that duplicates iteration 4's (run the check at the final head,
deferred to the step after the loop) and NITs that duplicate deferred entries.
**After convergence:** main merged (53a3c4fec, then 3cb0d8dfe; main touched neither the check file nor the invite
functions in web/index.html); the check run twice at 53a3c4fec, 167/167 both, no wait timed out (0 NOTE lines);
static browser-check guards 99/99 on the merged tree.

### Per-Iteration Breakdown (fixes from the commit messages)

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] B7b's wait could be satisfied by a late gate ask --> FIXED (__inviteAnsweredAt), 749c33a9d
- [NIT] long comments --> FIXED; [NIT] findSoon stale screen --> DEFERRED

#### Iteration 2
**Reviewer model:** opus
- [WARNING] B7b returned before the row painted --> FIXED; [WARNING] B7b's comment false (SELF) --> FIXED (deleted), 0719cafa8
- [NIT] A10 comment reworded; B2/B4 comments; B18f/g sent controls --> FIXED; timeout-arg form --> DEFERRED

#### Iteration 3
**Reviewer model:** sonnet
- [WARNING] "finishes synchronously" too broad (SELF) --> FIXED (claim deleted; plan states what is synchronous), 2d5dc7847
- [NIT] __inviteAnsweredAt comment (SELF) --> FIXED

#### Iteration 4
**Reviewer model:** opus
- [WARNING] B18c's ask count could not fail --> FIXED, abe2d252a
- [WARNING] no browser run since 3330f0275 --> DEFERRED to after convergence (done: 167/167 x2 at 53a3c4fec)

#### Iteration 5
**Reviewer model:** sonnet
- [WARNING] C3's comment overstated (wait for the label to leave tried and dropped) --> FIXED, a2e1f811b

#### Iteration 6
**Reviewer model:** opus
- [WARNING] timed-out waits were silent --> FIXED (waitNote), c8db9d7f3
- [NIT] B15h sent control --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
- [WARNING] C3 lost its settle (stale node click) --> FIXED (settle kept), 0ab305191
- [NIT] helper timeouts reported; waitNote inline note --> FIXED

#### Iteration 8
**Reviewer model:** opus
**New findings:** none after deduplication. **Converged.**

### Final Ledger
- WARNINGs fixed 11, deferred 1 (the final-head run, since done). Deferred NITs: pre-existing waitForFunction(fn,
  {timeout}) calls outside the diff; B4's synchronous-only coverage note; B18e (not a click).
