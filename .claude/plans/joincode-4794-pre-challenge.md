---
pre_challenge: true
method: challenge-loop
branch: joincode-4794
diff_hash: e2005120688458e52ffe15ab8ed18377d9c330af6a39ac8574dee77ce38f92cd
validation: passed (Mortals, mortals-validate at 3789fda373, hash e20051206884, ENTRY status clean, EXIT=0 19:21 CDT; the proof commits after it are excluded from the hash). OWED before merge: the FULL browser-checks run (web/ change) and a clean merge onto current main
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T22:14:12Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviewers alternating Opus and Sonnet (rounds 5 and 7 Opus, 6 and 8 Sonnet), each checking fixtures against the tunnel source (kosmos-relay d1216d79, pairing.rs).
**Converged:** Yes, round 8: 0 BLOCKER, 0 WARNING.

### Per-Iteration Breakdown (from .claude/plans/joincode-4794.md, where each round is recorded in full)
#### Iterations 1-4: findings addressed in f3455ef77, ab29230b7, 8125f0ff8, 03b62472c (round 4: the pairing code is "ddd ddd", not six digits)
#### Iteration 5 (Opus): 3 WARNING, 1 NIT fixed (email-code fixtures reverted; a page loaded after the Allow reads the pairing once; the real ran-out state)
#### Iteration 6 (Sonnet): 0 BLOCKER, 5 WARNING fixed (one root cause: after-Allow endings were forced through the poll gate; live vs endings split)
#### Iteration 7 (Opus): 1 BLOCKER, 1 WARNING, 3 NIT fixed (the past-10-minutes arm, Forget/Off reset the pairing, fixtures in the tunnel's shape)
#### Iteration 8 (Sonnet): 0 BLOCKER, 0 WARNING --> CONVERGED (NITs left, listed in the plan)

### Disclosed
- One commit came AFTER round 8: 7410363ea ("the plus-join shot fakes the devices answer too"), a fixture change in docs/browser-checks/mobile-shots.js only. No reviewer saw it; mobile-shots passed at this exact head (above).
- The branch was 229 commits behind main; merged (48a823a65), not rebased. The merge was clean and the validation above is of the merged head.

### Weakest premise
That the code the page shows on the allowing computer is the code the tunnel will accept at Allow (the tunnel recomputes at Allow and refuses a mismatch; the page words that refusal).

### Iteration 9 (after PR review, 2026-10-04T22:14:12Z)
**Trigger:** Ice Cream Kitty's PR review: WARNING, join/confirm and devices/allow were not screen-only, so a local caller with the board token (an agent included) could read the code from GET /api/remote/join and finish the pairing with nobody comparing.
- FIXED c117dcf86c: both routes 403 a caller isViaScreen reads as a process, as federation invite/verify do; deny/remove stay open (they only take access away). Only the board page calls these routes (web/, browser checks stub them, no CLI caller). New test; fails on the unguarded server (rc 1).
**Reviewer model:** sonnet (blind). **New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT.
- [WARNING] server.js:9060 the GET still exposes the code; say the guard is advisory --> FIXED 3789fda373 (comment)
- [WARNING] server.test.js the body-token path is untested --> FIXED 3789fda373 (third shape; a guard ignoring the body fails it, rc 1)
- [NIT] the control's 400 reads like success --> FIXED 3789fda373 (comment)
Not converged by a further clean round: the two warnings were comment and test-coverage only, with no code-path change after the reviewed guard. Disclosed rather than claimed.
