---
pre_challenge: true
method: challenge-loop
branch: repeatui-4787
diff_hash: b9e4dcb83c15bdee9da0cc6e35ea8cef1f3bc6c7218f030d8ab62ab60e19ea77
validation: focused, not the full local suite (light-lane queue). After every round: engine/taskrepeat, server.task-repeat-4787 (its new projects-list test proven to fail without the engine line), web.task-repeat-4787, web.task-page: 38/38; at round 1 also the 226 tests that read project task lists and every web.task* file (160/160); the page script parses; node --check on both browser-check files. Shots: mobile-shots exit 0, 8 shots, 0 errors, 0 overflow, looked at (a first set showed the dropdowns broken; fixed with the Tasks view's .tsk-sel). render-onhold-4771's new arms are first run by CI's browser-checks on the PR.
subdir_audit: not run (same queue)
timestamp: 2026-10-06T13:57:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: NO NEW ISSUES)

#### Iteration 1 (opus): 9 findings
- [MEDIUM] an empty time was saved as 9am --> FIXED (no choice; "Choose a time"; Save off)
- [MEDIUM] Save dropped keyboard focus and said nothing on success --> FIXED ("Saved.", focus back to the choice)
- [MEDIUM] no test of the poll guard --> FIXED (browser arms, with a control)
- [LOW] an agent's rule change wiped an unsaved choice --> FIXED (see round 2)
- [LOW] the last task's day and time carried to the next --> FIXED (Monday 9am)
- [LOW] fieldsOf missed a task closed by its parts --> FIXED
- [LOW] 32px dropdowns on a phone --> FIXED (44px)
- [LOW] a failed Save's answer could land on another task --> FIXED
- [LOW] a person's Save clears a built mark --> DECIDED: slice 1 engine behaviour, noted on the card
- nits: labels say When; require hoisted out of the per-task map --> FIXED

#### Iteration 2 (sonnet): 5 findings
- [HIGH] the arm filled a hidden time field (timeout) --> FIXED
- [MEDIUM] the focus-based guard could leave controls stale or wipe a choice --> FIXED (judged by the choice; a Save records what is stored)
- [MEDIUM] the guard's test could not fail --> FIXED (the stored rule changes under the choice)
- [LOW] Choose a time could stick on a finished task --> FIXED
- [LOW] Saved. outlived a change elsewhere --> FIXED

#### Iteration 3 (opus): 1 finding
- [LOW-MEDIUM] choosing the rule stored now still counted as unsaved --> FIXED; the arm tests exactly that

#### Iteration 4 (sonnet): NO NEW ISSUES
