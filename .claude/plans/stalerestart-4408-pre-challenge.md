---
pre_challenge: true
method: challenge-loop
branch: stalerestart-4408
diff_hash: 73b7d0403984ba35d61301b80c877b363986de6a0d18c19b63f051f586e433ff
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T23:33:38Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 (blind reviews alternating opus and sonnet, starting with opus)
**Converged:** Yes (iteration 16: no BLOCKER, WARNING or CONVENTION; two NITs, both recorded residuals). Iteration 12 had converged; CI then failed on the new browser check, and the fix re-opened the loop for iterations 13 to 16
**Scope change during the loop:** after iteration 1 the root cause arrived from the tester's own agent (an agent's
byte-for-byte restore, not an update), so the installer change was dropped and the check made content-based.
**Validation failures fixed on the way:** #3071 (an external person's name in the tree), #4273 (the route test's
temp dirs), #1777 (a win32 host branch not listed in HOST_BRANCH_EXCLUDED).
**Deferred:** 3 (listed below). **Asked:** 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] install/setup.sh - `kosmos restart` can fail where `start` did not --> RESOLVED by dropping the installer change (not the cause)
- [WARNING] server.js - no in-flight latch --> FIXED
- [WARNING] server.js - a restart that never happens is invisible --> FIXED (logged after 90 s)
- [WARNING] web/index.html - Mac fallback promised "agents keep running" beside a reboot --> FIXED (later made remedy-free)
- [WARNING] test - touched a real source file's mtime, racing server.test.js --> FIXED (throwaway probe module)
- [WARNING] web/index.html - "already current" 409 told the person to reboot --> FIXED (reloads)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] server.js - lazily required modules baselined at discovery --> FIXED (5 s sweep on its own timer; residual in plan)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] server.js - canSelfRestart on every sweep (blocking schtasks on Windows) --> FIXED (asked once per stale transition)
- [WARNING] tests - probe files in engine/ read by parallel suites --> FIXED
- [CONVENTION] server.js - #338 header described the mtime rule --> FIXED
- [CONVENTION] literals --> FIXED (named constants)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] web/index.html - refusal copy had no Windows arm --> FIXED (later made remedy-free)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] web/index.html - button unstyled --> FIXED (.uacts / uprime, screenshot checked)
- [WARNING] web/index.html - outcomes hidden at narrow widths --> FIXED (written to the title)
- [WARNING] server.js - canRestart cached for the process --> FIXED (re-asked per stale transition; the route writes back)
- [WARNING] web/index.html - Windows remedy did not work --> FIXED (later made remedy-free)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] server.js - engine/boardrestart not in the startup snapshot --> FIXED (loaded before it)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] tests - a recursive walker reads engine/ --> FIXED (probes at the app root, gitignored)
- [WARNING] server.js - boot-time window before the snapshot --> DEFERRED: bounded to boot, named in the plan

#### Iteration 8
**Reviewer model:** sonnet
- no BLOCKER / WARNING / CONVENTION (NITs only). Final validation then failed on the #4273 leak guard --> FIXED (tmpscope)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] web/index.html - Windows and Mac fallbacks promised remedies false for boards that reach them --> FIXED (one remedy-free sentence)
- [CONVENTION] tests - comments said "under engine/" --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] web/index.html - failure text stuck until the next press --> FIXED (repaints after 15 s)
- [CONVENTION] no test for the did-not-answer stand-down --> FIXED (web.engine-restart-screen-4408.test.js, mutation red)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] web/index.html - a Kosmos+ remote view said "this computer" and offered the button --> FIXED
- [WARNING] test - restart arm would reach real schtasks on Windows --> FIXED (skipped on win32 with reason; HOST_BRANCH_EXCLUDED)
- [WARNING] browser check - refusal path untested --> FIXED (refusal arm, 13/13)
- [WARNING] server.js - changed files re-hashed every sweep --> FIXED
- [CONVENTION] plan and test comments out of date --> FIXED

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] server.js - canRestart not re-asked while continuously stale --> DEFERRED: the route re-checks at every press and a refusal writes back; re-asking each sweep would restore the blocking Windows calls iteration 3 removed; only the button's appearance can lag

#### Iteration 13
**Reviewer model:** opus (re-opened after CI: the browser check died on a status poll still in flight at teardown, all arms green; fixed first)
- [WARNING] server.js - the Restart button could race an in-app update's own restart --> FIXED (409 updating; the page waits; route test and browser check arms red with the guard removed)
- [WARNING] server.test.js - the #338 test comment still described the mtime rule --> FIXED
- [CONVENTION] plan filename had no date --> FIXED (stalerestart-4408-20260928.md)
- [CONVENTION] raw timing literals (15 s hold, 1 s poll, 500 ms flush) --> FIXED (named constants)
- Also from its NITs: latch checked before the blocking restart check; the title resets on press (found by the new browser arm)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] server.js - an asynchronous spawn failure surfaces only at the end of the 120 s wait --> DEFERRED: the world-switch path through engine/boardrestart behaves the same by design; canSelfRestart refuses a missing CLI; the outcome is right, only slow. Noted beside ENGINE_RESTART_WAIT_MS and in the plan
- NITs applied: plural copy for several files; the canRestart residual named in the plan

#### Iteration 15
**Reviewer model:** opus
- [WARNING] web/index.html - a phone viewing a board that CAN restart said it cannot --> FIXED (own sentence; test red with the fix removed)
- [WARNING] web/index.html - a status poll mid-POST could repaint an enabled button --> FIXED (ENGINE_RESTARTING set before the request, cleared on refusal)
- [WARNING] web/index.html - the "not answering, open Kosmos" note showed during a requested restart --> FIXED (stands down; "You are offline" still shows; test red with the fix removed)

#### Iteration 16
**Reviewer model:** sonnet
- no BLOCKER / WARNING / CONVENTION. Two NITs, both already recorded residuals (uncapped `changed`, no flag on the cannot-restart 409).
**Converged.**

### Deferred (for a reader who wants to overturn one)
- Boot-time window before the startup snapshot (iteration 7): bounded to boot.
- canRestart while continuously stale (iteration 12): visibility lag only, never a wrong action.
- An asynchronous spawn failure surfaces at the end of the 120 s wait (iteration 14): the world-switch path behaves the same; right outcome, only slow.

### NITs (non-blocking)
- typeof guards exist for lifted-function tests; the first changed file named is alphabetical; setInterval per start() call in tests; 500 ms flush literal; `label === 'gone'` alternative in the browser check.

### Strengths
- Touched-but-identical is proven not stale and a real edit proven stale and named, with the time-only rule as a red mutation.
- The route is gated, latched, fail-safe and reuses engine/boardrestart; the page names the file, has no Terminal wording, promises no false remedy, and the browser check covers button, refusal and restart.
