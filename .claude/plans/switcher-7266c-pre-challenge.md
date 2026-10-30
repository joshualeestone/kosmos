---
pre_challenge: true
method: challenge-loop
branch: switcher-7266c
diff_hash: 9f27e1892b920ac0084c12db4b84b78d6f0bbda4415405ecf5345725f871c62e
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T05:07:13Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (a fresh blind reviewer each round; rounds 2 to 4 reviewed the whole #7266 stack with findings
attributed per slice, rounds 5 to 7 reviewed each new fix). **Converged:** Yes, at iteration 7 (no blocker; its one
warning is unchanged behaviour from before the fix and is a stated limit, below).

Slice C of #7266 (and the product half of #7264): the top left of Agents and Projects names the computer whose agents
and projects are shown and, with two or more, opens the account's computers (online or offline) to switch. Validation
on the head rebased onto main after slice A merged (29f7d40619): ios/LogicTests/run.sh PASS 1340/1340; the app's Swift
typechecks for the simulator (iOS 16 floor); server.ios-routes-6838, ios.board-parity-7084, ios.dmfailed-7136,
ios.store-shots-proxy-6262 and web.ios-settings-labels-7010 pass. No web/index.html change, so no browser check covers it.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] a later start restored another computer's kept session over the chosen one --> FIXED (tested).
- [WARNING] a late computer list after a sign-out was kept --> FIXED (dropped; tested). Client-level switcher tests added.

#### Iteration 2
- [BLOCKER] a launch from the kept session never read the computer list, so the switcher showed the name only --> FIXED
  (read in the background).

#### Iteration 3
- [BLOCKER] a + created on the shared page's computer, not the one the switcher shows --> FIXED (loads that board first).

#### Iteration 4
- [WARNING] the + used the admitted session's address, unset until the chosen computer lets the phone in (for good when
  it is offline) --> FIXED (the switcher's computer; control fails without it).

#### Iteration 5
- [WARNING] a create waiting for an offline computer's board could replay later on another computer --> FIXED (it
  replays only on its own host; control fails without it).

#### Iteration 6
- [WARNING] a failed load left that create waiting, holding the bar and opening much later --> FIXED (a failed load of
  its host ends it; control). [NIT] case-sensitive host match --> FIXED. [NIT] untested clear paths --> FIXED (tests).

#### Iteration 7
- No blocker. [WARNING] a redirect to another host before the failure leaves the create waiting --> STATED LIMIT
  (unchanged from before; it can still only open on the chosen computer). [NIT] the cancelled-load guard is tested only
  by where the call sits --> NO ACTION (the guard is the existing Shell.loadFailure filter).
