---
pre_challenge: true
method: challenge-loop
branch: reopenchat-8055
diff_hash: b42b6594f60fbd96bb1ffc46a45554c7159f076a50dec5e2b433ff5ee102a974
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T01:26:31Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap). Round 8 found no blocker; its three warnings are design decisions now stated in the plan
(the first look used up when no computer is known, a notification's board-page launch leaving the kept chat, the 12
hours counted from first open), deferred as decisions, not defects. Remaining items are NITs, listed below.
**Converged:** Yes, on round 8, by those deferrals.
**Total findings:** 0 BLOCKERs, 25 WARNINGs, 1 CONVENTION, many NITs
**Fixed:** 22 WARNINGs | **Deferred:** 3 WARNINGs (round 8, design decisions) | **Asked:** 0

Validation: full validation_log_run_or_skip PASSED on the rebased head (hash b42b6594f60f). Every round: all 13
ios/LogicTests suites (main suite 2126/2126 at the end) and an xcodebuild of the app for the simulator. The simulator
cannot exercise the reopen (the sample board has no computer); the card is not done until a real iPhone shows one.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] two comments still described the relaunch line --> FIXED (6cb2260942)
- [WARNING] kept record had no age limit and no agent-gone check --> FIXED: 12 hours, quiet close on the first list read

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 3
- [WARNING] reopen not limited to a launch --> FIXED: first look under a client
- [WARNING] quiet close missed an already-read and an empty list --> FIXED: decided on client.fresh
- [WARNING] each relaunch restarted the 12 hours --> FIXED: first-opened time kept
- [WARNING] no account check on the record --> FIXED: owner key
- [WARNING] a notification launch left the record to pop later --> FIXED: dropped when a notification's chat is on its way

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 4
- [WARNING] kept time depended on handler order; per-process flag vs per-scene client; refusals unlogged; another
  computer's list --> FIXED: time from the record, flag on the client, a log line per refusal, host checked on close

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 4
- [WARNING] same-turn quiet close left the record; launch logic untested in the view; 30 s window lost the reopen behind
  Face ID; unlogged relaunch --> FIXED: Board.launchChat and Board.reopenedChatStays as tested pure functions, no time
  window (starts on Agents instead), record removed in the close itself
- [WARNING] placeholder agent when the computer never answers --> DEFERRED in plan, same as a notification's chat

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 3
- [WARNING] room and board-page launches let a later Agents visit reopen --> FIXED (ContentView marks the launch)
- [WARNING] log line misnamed the cause --> FIXED
- [WARNING] session fingerprint in plain storage --> FIXED: keptChatOwner hashes it with the host

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3
- [WARNING] openAgentChat's board route marked the launch late --> FIXED (marked first)
- [WARNING] relaunch device-log line lost --> FIXED
- [WARNING] chat closed while away keeps its record --> DEFERRED: deliberate, stated in the plan
- [WARNING] first look used up with no computer --> DEFERRED: plan's weakest premise, real-iPhone check

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2
- [WARNING] computer host in plain storage --> FIXED: Board.keptHostKey
- [WARNING] openChatKey comment stale --> FIXED
- [WARNING] plan overclaimed "cannot" for a late notification tap --> FIXED: named as a known gap

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] first look used up with no computer --> DEFERRED (plan; the card stays open until a real iPhone shows a reopen)
- [WARNING] board-page notification launch leaves the record --> DEFERRED (plan: reopening what the person last had open is the aim)
- [WARNING] 12 hours from first open --> DEFERRED (plan: by design, revisit on a real phone)
**Converged** on the cap round.

### NITs left at the cap
- host hash is unsalted (plan now says it hides from a glance, not a guess)
- "review N" breadcrumbs in comments
- keptChatOwner has no pure test
- client.chatOpen survives a quiet close if chatClosedAway was true (keys removed anyway)
- two device-log lines when a kept chat is not reopened

### Strengths
- The launch decision and the quiet close are pure, tested functions with controls, boundaries and malformed records
- Another account's or computer's chat cannot reopen: hashed owner and host keys, cleared on any account change
- Existing chat-closed lines (popped, popped away, lost with the tab) unchanged
