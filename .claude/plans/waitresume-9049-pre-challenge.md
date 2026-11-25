---
pre_challenge: true
method: challenge-loop
branch: waitresume-9049
diff_hash: 95f2ab8573d018c29635928d8c3801eb0b6cf3111d8e08c4aa0abe574bd52f36
validation: passed
subdir_audit: passed
timestamp: 2026-11-25T13:41:52Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind rounds; round 8 was the whole-branch read with no plan file and nothing marked settled.
**Converged:** No. Stopped under the standing usage rule (past 8 rounds with no BLOCKER open, WARNINGs go to a
follow-up card). No BLOCKER was open after round 8. Its warnings are kosmos#9058, and round 6's Windows gap is
kosmos#9057. Ice Cream Kitty has built and reviewed both, on top of this branch.
**Validation:** full suite on 6c3bf4d251 (rebased on origin/main 06:52): 31,222 tests, 30,638 passed, 0 failed,
584 skipped, validation_rc=0, audit_rc=0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (+1 reasoned), 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [WARNING] install/kosmos-report-hook.sh - on the Mac a /clear can beat its own background `stopped` --> FIXED (ask once more)
- [WARNING] engine/awaydigest.js - "when the session ended" not exact --> FIXED (cause-neutral wording)
- [CONVENTION] install/kosmos - usage missed --wait-only --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 2 NITs
**Self-generated:** 2
- [WARNING] engine/awaydigest.js - repeat reminders after a startup that reminded --> FIXED (later reworked)
- [WARNING] tools/windows/kosmos-cli.js - no --wait-only parity --> FIXED
- [WARNING] retry budget, test sleeps, gating difference --> FIXED or DEFERRED with reasons in the plan

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 5 WARNINGs, 5 NITs
**Self-generated:** 3
- [WARNING] install/kosmos-report-hook.sh - retry on every empty answer --> FIXED (retry only on `pending`)
- [WARNING] in-session /resume races too; Windows premise unmeasured --> FIXED (both hooks retry on pending)
- [WARNING] server.js - an older board would answer with the digest --> FIXED (as=waithook)
- [WARNING] engine/awaydigest.js - the `started` rule could lose a reminder --> FIXED (newest-session-event rule)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs, 1 CONVENTION
**Self-generated:** 2
- [WARNING] a /clear after a startup could lose its reminder in the race --> FIXED (src=clear)
- [WARNING] the reminder nags with no way to stop it --> FIXED (wording says how)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs
**Self-generated:** 1
- [WARNING] retry budget, repeat reminders, gating --> DEFERRED with reasons in the plan
- [NIT] src parsed twice; --after-clear undocumented --> FIXED

#### Iteration 6
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 7 NITs
**Self-generated:** 1
- [WARNING] Windows resume after a quit older than 3 min --> FILED kosmos#9057
- [WARNING] server.away-9049.test.js - no stopped-before-the-wait case --> FIXED
- [WARNING] in-session /resume after a startup --> DEFERRED (recorded gap)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] engine/kosmos-report-hook.js - second ask without re-proving the listener --> FIXED, with a test
- [WARNING] repeat reminders across quit and resume; the in-session /resume race --> DEFERRED (plan)

#### Iteration 8 (final whole-branch read, no plan file)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] repeat reminders and "has not said otherwise" wording --> FILED kosmos#9058
- [WARNING] stale Mac budget comment; a stopped later than the retry --> FILED kosmos#9058

### Measured (not reasoned)
- Focused set 106/106 at round 7, and tools/test-report-hook-source.sh has 0 failures.
- Each of these mutants fails tests:
  - the old any-later-stopped rule;
  - no pending answer;
  - either hook without its retry;
  - a /clear's newest started not counted as pending;
  - the hooks not sending src=clear;
  - no re-proof before the second ask;
  - the board ignoring the session-event check.

### Final Ledger (summary)
BLOCKERs: none found. WARNINGs: fixed per round above; deferred ones are in .claude/plans/waitresume-9049.md;
filed ones are kosmos#9057 and kosmos#9058.

### NITs (non-blocking)
- [NIT] usage lines and comments, fixed across rounds 3 to 7.

### Strengths (across iterations)
- The reminder is never false. It is given only when the newest session event after the wait is a `stopped`;
  otherwise the answer is `pending` or nothing.
- as=waithook fails closed on older boards.
- No new identity surface.
