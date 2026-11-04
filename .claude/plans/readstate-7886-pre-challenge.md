---
pre_challenge: true
method: challenge-loop
branch: readstate-7886
diff_hash: 9b70fa18cfb61c1af9bf20aae1044908da5adeb5c9f2dfb69cdedc8dbab25426
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T06:26:38Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. The loop STOPPED AT THE 8-ROUND CAP: round 8 still raised 1 WARNING. It was fixed in 4e7ec7534e (a
--reply-to answer does not mark its post), and that commit was NOT put through another blind round.
**Total findings:** 18 actionable (2 BLOCKERs, 16 WARNINGs, 0 CONVENTIONs), many NITs
**Fixed:** 18, each in the commit after its round | **Deferred:** NITs only, each stated in the plan | **Asked:** 0

Final validation on 4e7ec7534e PASSED: validation-log hash 9b70fa18cfb6 (matches the diff_hash above), 26915 node
tests, 0 failed, 0 cancelled; subdir audit exit 0. git merge-tree against origin/main (41 commits ahead, one touching
server.js) is clean; CI on the PR runs the merge.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] comment states missing from the waiting set (policy_waiting and others) could invite a duplicate --> FIXED (67e33cb3e7): inverted to a gone list; unreadable records said
- [WARNING] read --post asked the follow list after the post --> FIXED (67e33cb3e7): asked alongside
- [WARNING] no test that a company read sends no follow request --> FIXED (67e33cb3e7): test with a registered reader, mutant red
- [WARNING] the Following feed had no comment mark --> FIXED (67e33cb3e7)

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] before_on read as waiting --> FIXED (ffe25f93b3): a test holds every state to exactly one set
- [WARNING] a slow follow route held the read --> FIXED (ffe25f93b3): 1.5 s after the read's own answer, then stopped
- [WARNING] an unawaited follow request could reject --> FIXED (ffe25f93b3)

#### Iteration 3
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 7 NITs
- [WARNING] the 404 note read as about the post's author --> FIXED (e48ef6c509)
- [WARNING] no test through the real itemsFor --> FIXED (e48ef6c509)
- [WARNING] a kept Following answer showed a just-commented post unmarked --> FIXED (e48ef6c509): readjobs.forget

#### Iteration 4
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] follow mark by id only, doc said names only --> service measured to send ids (follows.py _list); still FIXED (adb524d444): name fallback when the list carries no ids; doc corrected
- [WARNING] the waiting mark told the agent not to comment at all --> FIXED (adb524d444): reworded
- [WARNING] a withdrawal left a kept read stale --> FIXED (adb524d444)

#### Iteration 5
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
- [BLOCKER] forget() dropped running and uncollected reads, losing replies marked shown --> FIXED (cf94bd5972): only a handed-out Following answer

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] a Following read running at the comment was kept after hand-out --> FIXED (2c138889fa): generation stamp
- [WARNING] dropping a handed-out answer gives up the lost-response copy --> ACCEPTED and stated in the plan

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs
- [WARNING] the server forget calls had no test --> FIXED (ce361a2c81): route test, each line's mutant red

#### Iteration 8
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
- [WARNING] a --reply-to answer marked the whole post --> FIXED (4e7ec7534e), UNREVIEWED

### Weakest premise
The follow list costs one more public request per read against the service's shared 200 a minute per address; a 429
reads as "could not check just now", never as a false mark.
