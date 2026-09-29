---
pre_challenge: true
method: challenge-loop
branch: publiclink-4419
diff_hash: 57ef236bf0755c5de91110ff182434e79dd59d19232c8145f95dd8abb52bdac7
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T06:18:35Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (plus one early blind review of the first commit, fixed in bb08ea9)
**Converged:** Yes, iteration 8 (sonnet) returned 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Fixed:** every actionable finding in iterations 1 to 7 | **Deferred:** 3 actionable (reasons below) + 3 NITs | **Asked:** 0

Honesty note: the session's context was compacted mid-loop, so the exact severity grade of each
finding in iterations 1 to 4, 6 and 7 is not preserved. The findings below are reconstructed from
the fix commits' own bodies, which were written at the time; each was actionable (fixed or
deliberately deferred). Only iteration 5's BLOCKER grade is recorded. Reviewer models alternated
opus (odd) and sonnet (even), confirmed for iterations 7 (opus) and 8 (sonnet).

Test evidence at the final commit 0f37d544: server.webhooks-1307.test.js, web.webhooks-1307.test.js
and engine/remote.test.js run as WHOLE files, 161/161 pass; browser check render-webhooks-1307 passes
(tools/browser-checks.sh, HEADED=0); validation_log_run_or_skip passed on 092966f and on 0f37d544.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] server.js hookPublicLink: switched on but not running was told to turn Kosmos Plus on; not signed in had no reason of its own --> FIXED (d8782e8), tests cover all nine causes
- [WARNING] server.js older-connector reason promised an update nothing checks --> FIXED (d8782e8)
- [WARNING] docs/browser-checks/render-webhooks-1307.js did not cover #4419 --> FIXED (d8782e8), off and up states asserted at 390 wide
- [CONVENTION] server.js #1307 exemption comment and docblock placement stale --> FIXED (d8782e8)

#### Iteration 2
**Reviewer model:** sonnet
**Self-generated:** 1 (focus restore only knew the local link, which this branch introduced)
- [WARNING] web/index.html pjsHooksPaint: a repaint while the internet link had focus dropped focus to the page --> FIXED (a57729c), page test covers both fields

#### Iteration 3
**Reviewer model:** opus
- [WARNING] web/index.html settings hint "The link works for programs on this computer." contradicted the internet link --> FIXED (c81d1e0)
- [WARNING] Kosmos Plus off reason promised what an older connector cannot give --> FIXED (c81d1e0)
- [WARNING] server.js unreadable Kosmos Plus settings read as "switched off" --> FIXED (c81d1e0), test
- [WARNING] web/index.html copy failure did not name the internet link --> FIXED (c81d1e0)
- [CONVENTION] plan file counted the branch's commits --> FIXED (c81d1e0)

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] server.js the link's host only had to pass the host-name shape; a stale or damaged status file could send the secret to another host --> FIXED (cb0df22), host must equal remote.address(), test
- [WARNING] no test for admits_hooks while the tunnel is not up --> DEFERRED: only the 'up' return sets admitsHooks and every non-up state is refused before the field is read (tested)

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] server.webhooks-1307.test.js the #4419 test made a dozen webhooks on the shared project, pushing a later test past the 20 limit (file 38/39) --> FIXED (87830d4), own project, every make asserts 201, whole file 39/39
- [WARNING] reveal heading said "this link ... it" with two links --> FIXED (87830d4)
- [WARNING] browser check left the remote stub in place past the make --> FIXED (87830d4, 12c826c)

#### Iteration 6
**Reviewer model:** sonnet
- [CONVENTION] CLAUDE.md webhooks row still said local only --> FIXED (092966f)
- [WARNING] a valid host that is not the enrolled name read as "could not read" --> FIXED (092966f), own reason, test
- [CONVENTION] plan file name without a timestamp --> DEFERRED: this repo's plans are named by branch

#### Iteration 7
**Reviewer model:** opus
**Self-generated:** 2 (the "yet" and "turn it off and on" sentences were written by earlier fixes)
- [WARNING] server.js older-connector reason still said "yet" --> FIXED (0f37d54), guard now /update|yet|reconnect/i
- [WARNING] server.js name-mismatch reason told the person to turn Kosmos Plus off and on, unverified --> FIXED (0f37d54), sentence removed
- [WARNING] browser check awaited the click before the response promise, so a failed click leaves an unhandled rejection --> FIXED (0f37d54), Promise.all
- [WARNING] web/index.html Done button said "it" with two links --> FIXED (0f37d54)
- [WARNING] web.webhooks-1307.test.js no test for the copy-failure sentences --> FIXED (0f37d54), test with control
- [WARNING] server.js remote fields read in separate calls, not one snapshot --> DEFERRED: every mismatch between the reads fails toward no link; only the reason sentence could lag one state

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged**, no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 4 | BLOCKER | server.js | host not bound to enrolled name | FIXED | cb0df22 |
| 2 | 5 | BLOCKER | server.webhooks-1307.test.js | shared-project limit broke later test | FIXED | 87830d4 |
| 3 | 4 | WARNING | engine/remote.test.js | admits_hooks while not up | DEFERRED | unreachable, tested upstream |
| 4 | 6 | CONVENTION | .claude/plans | plan name without timestamp | DEFERRED | repo practice |
| 5 | 7 | WARNING | server.js | single snapshot of remote reads | DEFERRED | fails safe to no link |
| all others | 1-7 | WARNING/CONVENTION | see above | see per-iteration | FIXED | commits above |

### Outstanding questions
None.

### NITs (non-blocking)
- [NIT] server.js hookPublicLink two host checks overlap; messages correct today, maintenance trap (iteration 8)
- [NIT] server.webhooks-1307.test.js no case with remote.address() null and a valid status host (iteration 8)
- [NIT] server.js comment "must never send the secret to someone else's host" overstates: it guards a stale or damaged status file, not a rewritten state dir (iteration 8)

### Strengths
- The secret never appears in a reason; the URL is escaped and the host lowercased, shape-checked and bound to the enrolled name (iteration 8)
- Every reason is keyed to one cause and the tests forbid promises nothing checks (iterations 1, 7)

### Final validation (2026-09-29, after the account move)

validation_log_run_or_skip on 3d54c821 (hash 57ef236b): first run FAILED on one unrelated test,
engine/chat.dmnotice-4354.test.js "swarm.pauseOf" (its two timestamps read 1 ms apart; green 3 of 3
alone, not in this branch's diff). Second run PASSED: 11573 tests, 0 fail, 166 skipped (165 + one
concurrency test that skips itself as inconclusive under load), then the shell tests and build.
