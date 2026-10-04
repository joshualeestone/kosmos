---
pre_challenge: true
method: challenge-loop
branch: leftoverkeys-4994
diff_hash: 8412e79131f8b42fe6cfe6f99e5abc5fe34fc278dd84653e8029acedb53cae22
validation: passed (focused, after the final rebase: 1069 community, store, delete, create, server-route and guard tests; 2302 page tests; browser-check gates #1720 and #2518 green; render-community-held-4525.js queued on the machine queue, not yet run)
subdir_audit: passed (no subdir CLAUDE.md changed)
timestamp: 2026-10-02T11:40:29Z
iterations: 38
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 38
**Converged:** Yes (iteration 38: every finding was a duplicate of a recorded decision or deferral)
**Total findings:** about 120 (8 BLOCKERs, about 75 WARNINGs, 5 CONVENTIONs, the rest NITs)
**Fixed:** most; **Deferred:** listed in the plan's Deferred section with reasons | **Asked (awaiting user):** 0

Reviewer models alternated opus (odd iterations) and sonnet (even iterations) throughout. The branch was squashed and
rebased onto main after iteration 28 (it met #4922's install-group code there) and rebased again before this proof.
Self-generated findings were frequent: many later findings were in the previous round's own fix (see kosmos#120).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] retireIn repointed never-sent records, so a pending post went out as the new account under the old one's record --> FIXED (withheld, later not_sent)
- [WARNING] pending comments the same way; stale folder blocks the name; retire on a refused delete --> FIXED
#### Iteration 2 (sonnet)
- [WARNING] new agent's post during the lock wait withheld --> FIXED (receivedAt <= at bound); three deferrals recorded
#### Iteration 3 (opus)
- [BLOCKER] an unanswered send moved to the retired key, settled pending, then sent as the new agent --> FIXED (send-time guard)
- [WARNING] withheld wording claimed an owner delete; owner list showed the new agent's name --> FIXED (not_sent, "(deleted agent)")
#### Iteration 4 (sonnet)
- [WARNING] held items of the deleted agent sent once released; wrong ON period across folders --> FIXED
#### Iteration 5 (opus)
- [BLOCKER] the send-time guard marked a maybe-public post not_sent --> FIXED (attempted left to settleUnconfirmed)
- [WARNING] blank owner rows; register waits not cleared; moderation trust carry-over --> FIXED / filed #5000
#### Iteration 6 (sonnet)
- [WARNING] willSend not retire-aware; record bound only for published items --> FIXED
#### Iteration 7 (opus)
- [WARNING] unreadable state.json, later services and held items left gaps --> FIXED (never-send mark moved into the store); confirmation now says the account does not come back
#### Iteration 8 (sonnet)
- [WARNING] mark before request write; pending read on every call --> FIXED (request first, re-mark on apply, cache)
#### Iteration 9 (opus)
- [BLOCKER] a request could finish with the mark missing --> FIXED (current folder not done until marked); vacuous owner-list test removed
#### Iteration 10 (sonnet)
- [WARNING] sendComment guard did not match its comment; chmod tests under root --> FIXED
#### Iteration 11 (opus)
- [WARNING] names freed by hand still inherited the account --> FIXED (create requests it); failed folders kept in the request
#### Iteration 12 (sonnet)
- [WARNING] an unreadable retire folder freed every name --> FIXED (holds every name)
#### Iteration 13 (opus)
- [WARNING] create's account check missed three cases --> FIXED (create always requests); mark not re-read once landed
#### Iteration 14 (sonnet)
- [WARNING] confirmation missed other-service and unreadable keys --> FIXED; review-number comments removed
#### Iteration 15 (opus)
- [WARNING] a failure sentence contradicted the create change; unremovable finished request held the name; no-account unsent posts not named --> FIXED
#### Iteration 16 (sonnet)
- [WARNING] race during registration; willSend "no" is permanent --> FIXED (re-check after await; "later")
#### Iteration 17 (opus)
- [WARNING] willSend read the deleted agent's refused key and skipped the ON-period record --> FIXED
#### Iteration 18 (sonnet)
- [WARNING] a stale request re-applied after restart could retire the new agent's account --> FIXED (time bound on keys and records)
#### Iteration 19 (opus)
- [WARNING] an account registered while a delete landed was never retired --> FIXED (triedAt); agentCall re-check
#### Iteration 20 (sonnet)
- [WARNING] "has not gone out" counted sent posts --> FIXED
#### Iteration 21 (opus)
- [WARNING] one failed folder read held every name until restart; held-list sentence false for a deleted agent's comment --> FIXED (page line + browser check row)
#### Iteration 22 (sonnet)
- documentation-level warnings --> FIXED (comments, plan)
#### Iteration 23 (opus)
- [BLOCKER] the browser check's order list was not updated for the new row --> FIXED; settle skips a held name
#### Iteration 24 (sonnet)
- [BLOCKER] a second hard-coded row list in the check --> FIXED; in-flight send follows the old account
#### Iteration 25 (opus)
- [WARNING] refused/withheld/deleted items counted as waiting --> FIXED; per-request try
#### Iteration 26 (sonnet)
- [WARNING] "retired" logged on every create --> FIXED
#### Iteration 27 (opus)
- [WARNING] remote-token route reused names --> FIXED, then reverted in 28 (cannot tell rotation from a new agent; recorded as deferral)
#### Iteration 28 (sonnet)
- [WARNING] token-route rotation retires its own account --> FIXED (reverted); no count while off
#### Iteration 29 (opus, after rebase onto #4922)
- [WARNING] install group sent to a deleted key while stuck; retired copy lost state --> FIXED
#### Iteration 30 (sonnet)
- [WARNING] posts told "goes now" while held --> FIXED (postWaits)
#### Iteration 31 (opus)
- [WARNING] unreadable list cleared every grouped agent; stuck requests accumulate --> FIXED (hold; 15-minute backoff)
#### Iteration 32 (sonnet)
- [WARNING] for-good confirmation lacked the account sentence --> FIXED
#### Iteration 33 (opus)
- [WARNING] a service switch could finish a request unmarked --> FIXED (no folder done before the mark)
#### Iteration 34 (sonnet)
- [WARNING] rows with no time skipped by the mark --> FIXED
#### Iteration 35 (opus)
- [WARNING] save-on-change, live wins, listed-only key skip, no cache when unreadable --> FIXED
#### Iteration 36 (sonnet)
- [WARNING] retry after a name clash could register again --> FIXED
#### Iteration 37 (opus)
- [CONVENTION] "written ONLY by the sweep" comments false --> FIXED; trust path noted on #5000
#### Iteration 38 (sonnet)
**New findings:** 0 BLOCKERs, 0 new WARNINGs (3 duplicates of recorded decisions: name spelling checked in 10/22/27; unreadable request holds every name, deferred in 12; create comment already accurate), 3 NITs
**Converged** - no new actionable findings.

### Outstanding questions
None.

### NITs (non-blocking)
- stat of the retire folder per call (cheap); retiredName relies on NAME_RE; the stale-folder accumulation has no regression test (iteration 38)

### Strengths (across iterations)
- Retire-not-drop keeps the owner's later deletes of old public posts working, proven against a fake service that only lets a post's own agent delete it
- Applied only inside the keys.json lock; every step repeatable; time bounds protect the new agent
- Failure modes hold the name rather than free it; willSend answers "later", never the permanent "no"
- Chmod-based tests sandbox-checked, restored in finally, skipped as root
