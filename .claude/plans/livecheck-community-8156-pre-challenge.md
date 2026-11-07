---
pre_challenge: true
method: challenge-loop
branch: livecheck-community-8156
diff_hash: 972b8c9c18c75ca9d23d52d9dde2371a28bd73a8b676a8ad877bf13f9eca70d7
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T20:13:47Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 raised one WARNING, the fail-closed stall when the seat check cannot load, already stated in the plan since iteration 6; nothing new after deduplication; no ASKED findings). Iteration 4 had converged earlier; the fixture-discipline fix after it reopened the loop at 5.
**Total findings, raw (before deduplication):** 0 BLOCKERs, 22 WARNINGs, 11 CONVENTIONs (3 of them notes that the plan exists and matches), 28 NITs; duplicates are named per iteration below
**Fixed:** 23 (one more moot) | **Deferred:** 2 WARNINGs (iteration 4's future space path, iteration 5's old owner link, written in Not done), 1 checked and not an issue (iteration 4's sweep noise), and the NITs listed | **Asked (awaiting user):** 0
**Validation:** full suite (tools/run-tests.sh via the validation helper) green on HEAD bf91efb2bd, base 7e1a11d802, 13:46 to 14:13 CST 11-07: node 27507 passed, 0 failed, 0 cancelled; test:shell 4 shards all green. The helper logged hash 972b8c9c18c7, the same as this proof's diff_hash. Earlier runs on this branch: one red on fixture-discipline (a real defect in the new test, fixed in 5659be2f21); several stopped part way because a review fix changed the diff; one red with 8 timeouts under other agents' load (all 279 tests in those files green alone).

**Self-generated (Origin) field:** not computed. The 6c-bis blame lookup was not run during this loop, so the Origin column is not recorded.

**Reviewer models:** opus on odd iterations, sonnet on even, checked against the session's Agent calls. All reviewed by reading only (suites were running).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] engine/communitysend.js asAgent: a status-0 answer for a seat read as an outage to the profile passes (one old seat would stall every agent after it) --> FIXED (b274220d55): asAgent is not gated
- [WARNING] same: the gate also blocked a seat's deletes and owner unlink --> FIXED (b274220d55), same change
- [WARNING] engine/communitysend.js refreshSelf: a request as an old seat's account --> FIXED (b274220d55): refused for a seat
- [WARNING] engine/communityblock.js refreshEveryone: a seat kept an old section through board starts, and agentInCommunity still counted it --> FIXED (b274220d55): the refresh takes it out; agentInCommunity says no
- [WARNING] the old-key test did not reach asAgent --> moot (gate removed); the test now pins the profile passes
- [CONVENTION] plan claims ("removing any one gate turns a test red", asAgent harmless) --> FIXED (b274220d55)
- [NIT] "again.." in the CLI sentence --> applied; [NIT] the create test's control in another test --> applied; [NIT] the restart label --> applied

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs (1 a note), 2 NITs
- [WARNING] isTestSeat assumes the stored name; a differently normalised caller fails open --> FIXED (d56d1d5745): the name contract is written beside the constant and in the plan (every caller passes the session name)
- [WARNING] the profile-pass skips untested --> FIXED (d56d1d5745): the industry skip tested, mutation checked
- [CONVENTION] a future comment spelling the prefix reds the guard --> FIXED (d56d1d5745): a note beside the constant
- [NIT] the policy case in refreshEveryone --> applied (plan); [NIT] export on its own line --> applied

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] sweepInstallGroup: the seat skip also skipped the clear, so an old seat stayed grouped --> FIXED (9e9c7bd3e4): a seat counts as removed
- [WARNING] sweepAvatars: the same for a picture --> FIXED (9e9c7bd3e4): a seat wants no picture, so one sent is taken down
- [WARNING] agentCallSteps refused take-backs (unfollow, unendorse, vote clear) --> FIXED (9e9c7bd3e4): let through for a seat holding a key
- [WARNING] refreshEveryone's seat branch skipped the no-file and connected-agent checks --> FIXED (9e9c7bd3e4)
- [CONVENTION] plan wording (install group "measured", birth under a policy) --> FIXED (9e9c7bd3e4)
- [NIT] seat post words for a case that cannot occur --> deferred (a backstop); [NIT] repeated trailing comment --> applied

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs (1 a note), 1 NIT
- [WARNING] a future space call that bypassed both gates --> DEFERRED: no such path today; every space call goes through agentCallSteps or ensureRegistered
- [WARNING] a stored seat post might log on every sweep --> checked, not an issue: sendPost returns silently on no key
- [CONVENTION] the prefix comment is brittle --> duplicate of iteration 2 (the note is there)
- [NIT] one helper for the three route refusals --> deferred
(Converged here. The suite then caught fixture-discipline on hand-built roster rows in the new test, fixed in 5659be2f21 with the fleet's real cards, which reopened the loop.)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 4 NITs
- [WARNING] sweepOwnerLink: an owner link an old seat has stays --> DEFERRED: written in Not done (only "Forget Kosmos+" unlinks; an unlink path for seats is left out on purpose; no such seat is known)
- [WARNING] the avatar and grouped install-group take-downs untested --> FIXED (84720aeb8e): tested, mutation checked (the avatar test gives the seat a real picture, so only the seat check stops an upload)
- [CONVENTION] "no request as its account" overstated --> FIXED (84720aeb8e): reworded
- [CONVENTION] a test makes a real agent with the prefix --> FIXED (84720aeb8e): the reason (sandbox, launch guard) is beside it
- [NIT] birth key (`wantedKey || name`) --> deferred, written in the plan; [NIT] a refused seat's log line; [NIT] continue placement; [NIT] route helper (duplicate)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] a check that cannot load stalls every agent silently --> FIXED (4114f6c4c4): logged once
- [WARNING] the take-back allowed a DELETE on any path --> FIXED (4114f6c4c4): only the follow and endorsement paths, tested
- [NIT] rulesChanged set by hand; [NIT] trim/lowercase; [NIT] birth key (duplicate)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
- [WARNING] a check that cannot load read every real agent as a seat in the take-down passes and the instructions writer (their groups, pictures and sections would come down) --> FIXED (879232277f): surelyTestSeat there and "not a seat" catches in communityblock; sends still fail closed
- [CONVENTION] the plan said it was stacked on item 1, which had merged --> FIXED (879232277f)
- [NIT] "reads" wider than the code --> applied; [NIT] an old stored comment's log line --> applied (Not done); [NIT] continue placement; [NIT] the restart label untested

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION (a note), 2 NITs
- [WARNING] a real agent would be told it is a test seat when the check cannot load --> FIXED (ad9dfb0c8e): the switch-unreadable words
- [WARNING] a seat's old stored items read as pending --> FIXED (ad9dfb0c8e): written in Not done (inert, not queued)
- [NIT] the opposite catches in create.js and tellAgent --> applied (a cross-reference comment); [NIT] take-back test coverage (it exists)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (duplicate), 4 NITs
- [WARNING] engine/replynudge.js: the reply nudge still reached a seat with tracked comments --> FIXED (bf91efb2bd): seats taken out of its roster (only when one is present, so the roster object is kept otherwise, which an existing #4951 test pins); tested, mutation checked
- [CONVENTION] the three repeated route refusals --> duplicate of the deferred NIT
- [NIT] take-back into a company space --> applied (bf91efb2bd: `!space`); [NIT] module state for the broken flag; [NIT] continue placement; [NIT] four branches untested (the catch arms are near unreachable: server.js loads communityswitch at start)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (1 raised, a duplicate), 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings:** 1 (the fail-closed stall when the check cannot load: logged and stated in the plan since iteration 6)
- [NIT] "unreadable" wording when the check is broken; [NIT] the opposite catches (commented); [NIT] a future display-name caller

### Deferred, with reasons
- A future space call that bypasses both gates (iteration 4): no such path today.
- An old seat's owner link (iteration 5): written in Not done; no such seat is known.
- NITs: one helper for the three route refusals; the "Kept on this board" words (a backstop); the birth gate's key (slugFor makes it equal); a refused seat's log line; continue placement; the near-unreachable catch arms untested.

### Plan note
The plan's ledger section was written at iteration 5; iterations 6 to 10 are recorded here, so that the plan (part of the reviewed diff) did not need another suite run.
