---
pre_challenge: true
method: challenge-loop
branch: restart-surface-4006
diff_hash: c0c679cbeaf8b6b6bbdb4d2e009e2f588b5db58a566ba17903a7a6f0565cedb3
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T19:49:49Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 raised one WARNING, examined and rejected with the reason written at the code; no other finding)
**Fixed:** see per-iteration | **Deferred:** 2 | **Asked (awaiting user):** 0
**Validation:** full validation passed on 5571edaa (validation-log hash c0c679cbeaf8).
**Note:** rounds 3, 4 and 6 ran in an earlier session that restarted on a full context window; their reviewer models and exact counts were not recorded, and are marked so rather than guessed. What each round changed is in the plan and the commit bodies.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] web/index.html stateReason - the engine's failed-restart sentence never reached the page --> FIXED (fbe2fb21)
- [WARNING] engine/remove.js - removal, creation and delete-leftover left a failed record behind --> FIXED (fbe2fb21)
- [WARNING] engine/status.js - a failed record did not clear on an UNKNOWN reading of a live agent --> FIXED (fbe2fb21)
- [NIT] engine/disruption.js - fail() did not validate its time --> FIXED (fbe2fb21)
- [WARNING] working animation could paint over a failed card --> DEFERRED: probed on both card shapes, cannot fire; no guard added

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/remove.js - the second-try wait blocks the board on a burst of failures --> FIXED (ac7dabd0), burst test perturbed red

#### Iteration 3
**Reviewer model:** not recorded (earlier session)
- [WARNING] server.js - agent and project thread routes claimed a question behind a failed restart --> FIXED (d963529f), perturbed red
- [WARNING] engine/remove.js - launchctl print stdout (job env) kept in diagnostics --> FIXED (d963529f)
- [NIT] plan claimed a notification --> FIXED (d963529f)

#### Iteration 4
**Reviewer model:** not recorded (earlier session)
- [WARNING] web/index.html - a second copy of the sentence on the page --> FIXED (24765474)
- [WARNING] remove/create/delete-leftover clears untested --> FIXED (24765474), each perturbed red

#### Iteration 5
**Reviewer model:** opus
- [WARNING] web/index.html answerBtn - an Answer button on a failed-restart card --> FIXED (b61cabc6)
- [WARNING] engine/status.js - the "launch file gone" reading was unreachable --> FIXED (b61cabc6), removed
- [WARNING] engine/status.js - one bad read (UNKNOWN) erased the failure --> FIXED (b61cabc6), isAgentSession guard

#### Iteration 6
**Reviewer model:** not recorded (earlier session)
- [WARNING] engine/disruption.js fail() branches untested --> FIXED (9f2df930)
- [NIT] a test message read the wrong way round --> FIXED (9f2df930)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] engine/remove.js - the person's own Restart of a no-pane agent wiped the failure when it failed again --> FIXED (5635ef4d), perturbed red
- [WARNING] engine/status.js - the isAgentSession guard had no negative test --> FIXED (5635ef4d), perturbed red
- [CONVENTION] plan numbers and a superseded bullet --> FIXED (5635ef4d)
- [NIT] engine/remove.js reuse cannotRestart --> FIXED (5635ef4d)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] engine/create.js - the record is cleared before later gates that can refuse --> DEFERRED (rejected): every earlier gate already refuses a name with a launch file, folder, loaded job or session, so the record belongs to no card; clearing later would let a PARTIAL create inherit the old failure. Reason written at the clear (5571edaa).

### Deferred
- The send route's asking gates do not exclude a failed restart: harmless, a stopped pane has no menu (chat.viewport/deliver refuse).
- The working-animation guard: probed, cannot fire.
