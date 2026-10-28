---
pre_challenge: true
method: challenge-loop
branch: restartline-7411
diff_hash: f1d29131eb272a3142f1edc22bdc290eee5f045dd2a2767cd32714a38e52d892
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T17:56:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round cap after iteration 8; the fleet review-loop rule caps a loop at 8 rounds unless a BLOCKER is open, and none was)
**Total findings:** 37 (1 BLOCKER, 17 WARNINGs, 1 CONVENTION, 18 NITs)
**Fixed:** 27 | **Deferred:** 10 | **Asked (awaiting user):** 0

Final validation (6j): the full suite at bc7bff7c11, 25342 tests, 0 failed, subdir audit clean. Two earlier full runs
failed: the first on 5 checks this branch broke (install gate EXPECTED_ADDS, browser-check wiring, the empty-slot rule,
the forced theme, a route handler outside a try), all fixed; the second on the surface gate (trailers for the shared
slot rule) plus two timing tests that passed alone (two suites had overlapped on this Mac).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html rlineRestartOne -- restarts sent no wake hello --> FIXED (1311fb5bec)
- [WARNING] web/index.html rlineClick -- Show who repainted over a running Restart all --> FIXED (1311fb5bec)
- [NIT] server.js -- dead swarm condition --> FIXED (1311fb5bec)
- [NIT] server.js -- display name not cleaned as #7430 does --> FIXED (1311fb5bec)
- [NIT] server.js -- tmux read every minute with nothing marked --> FIXED (1311fb5bec)
- [NIT] web/index.html -- one reason shown for several refusals --> FIXED (1311fb5bec)
- [NIT] web/index.html -- "3 more" had no aria-expanded --> FIXED (1311fb5bec)
- [NIT] web/index.html -- Restart all blocks the board per agent --> recorded in the plan (known cost)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html -- a wake report repaint reset the running button's progress --> FIXED (431cedfdfb), SELF
- [WARNING] engine/restartline.js atStart -- a rollback counted as an update --> FIXED (431cedfdfb)
- [NIT] engine/restartline.js -- x.y.z only --> DEFERRED: the same rule releasenotes.js holds; recorded in the plan
- [NIT] server.js -- notes file read each poll --> DEFERRED: one small file
- [NIT] plan -- rollback not in weakest premise --> FIXED (431cedfdfb)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html rlineClick -- a refused agent that left the roster threw and left the line busy --> FIXED (baa86a7e8b)
- [WARNING] web/index.html -- one agent's progress words unchanged --> FIXED (baa86a7e8b)
- [WARNING] web/index.html -- live region inserted filled --> DEFERRED (later FIXED in iteration 7, 8acdf4c771)
- [WARNING] web/index.html -- held hello reason dropped --> FIXED (baa86a7e8b)
- [NIT] web/index.html -- focus on "3 more" jumped --> FIXED (baa86a7e8b)
- [NIT] server.js -- two version regexes --> FIXED in iteration 5 (da2531441e)
- [NIT] engine/restartline.js notNow -- success with no record --> FIXED in iteration 6 (9718a2b0b8)
- [NIT] engine/status.js -- sessionStartsAsync re-parses each line --> DEFERRED: cosmetic

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/restartline.js -- a second update forgot the first update's fix --> FIXED (87fcb7e04a): per-fix history
- [WARNING] server.js not-now -- CSRF --> DEFERRED: the board's crossSiteWrite guard refuses it (measured 403 without a JSON content type)
- [NIT] server.js -- HEAD runs the full read --> DEFERRED: harmless
- [NIT] engine/status.js -- cosmetic re-parse --> DEFERRED
- [NIT] engine/restartline.js -- an agent started between install and board start is named --> DEFERRED: the plan's weakest premise

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html -- a second press wiped the first press's results --> FIXED (da2531441e), SELF
- [WARNING] web/index.html restartLineCheck -- a reply from before Not now could undo it --> FIXED (da2531441e)
- [NIT] server.js -- version rule shared --> FIXED (da2531441e)
- [NIT] web.restartline-7411.test.js -- own esc --> FIXED (da2531441e)
- [NIT] web/index.html -- live region --> FIXED in iteration 7
- [NIT] web/index.html -- restartFailureLine steps --> DEFERRED: a different, longer shape than this compact line
- [NIT] web/index.html -- check while hidden --> FIXED (da2531441e)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js not-now -- answered hidden with no record --> FIXED (9718a2b0b8)
- [WARNING] engine/restartline.js -- a clock stepped back --> DEFERRED: fails quiet (no line), never names agents wrongly
- [NIT] engine/restartline.js -- startedAt flooring implicit --> DEFERRED: tmux reads whole seconds
- [NIT] web/index.html -- document-level click listener --> no change (correct as is)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [CONVENTION] server.js -- the name cleaner in four copies --> FIXED (8acdf4c771): oneLinePlain
- [WARNING] web/index.html -- live region inserted filled (third time raised) --> FIXED (8acdf4c771): persistent #rline-say
- [NIT] web/index.html -- results keyed by label --> FIXED (8acdf4c771)
- [NIT] web/index.html -- progress key 'all' --> FIXED (8acdf4c771)
- [NIT] docs/browser-checks/mobile-shots.js -- comment claimed an untested rule --> FIXED (8acdf4c771)
- [NIT] server.restartline-7411.test.js -- 400 and 500 arms untested --> FIXED (8acdf4c771)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/restartline.js atStart -- the first update with this feature was silent --> FIXED (5920f1b65c): seeded from seen-version.json
- [WARNING] engine/restartline.js -- history wrap at 50 --> DEFERRED: fails quiet; recorded in the plan
- [NIT] engine/restartline.js -- no lock between notNow and atStart --> DEFERRED: best effort
- [NIT] server.js -- notes read per poll --> DEFERRED
- [NIT] web/index.html -- progress announced each step --> DEFERRED: wanted
Stopped at the 8-round cap with no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html rlineRestartOne | BRANCH | no wake hello after restart | FIXED | 1311fb5bec |
| 2 | 1 | WARNING | web/index.html rlineClick | BRANCH | Show who repaint over busy | FIXED | 1311fb5bec |
| 3 | 2 | WARNING | web/index.html paintRestartLine | SELF | progress lost on repaint | FIXED | 431cedfdfb |
| 4 | 2 | WARNING | engine/restartline.js atStart | BRANCH | rollback counted as update | FIXED | 431cedfdfb |
| 5 | 3 | BLOCKER | web/index.html rlineClick | BRANCH | throw and stuck busy on vanished agent | FIXED | baa86a7e8b |
| 6 | 3 | WARNING | web/index.html | BRANCH | one agent's progress words | FIXED | baa86a7e8b |
| 7 | 3 | WARNING | web/index.html | BRANCH | held hello reason dropped | FIXED | baa86a7e8b |
| 8 | 4 | WARNING | engine/restartline.js | BRANCH | second update forgot first fix | FIXED | 87fcb7e04a |
| 9 | 4 | WARNING | server.js not-now | BRANCH | CSRF | DEFERRED | crossSiteWrite guard |
| 10 | 5 | WARNING | web/index.html rlineClick | SELF | second press wiped results | FIXED | da2531441e |
| 11 | 5 | WARNING | web/index.html restartLineCheck | BRANCH | stale reply undid Not now | FIXED | da2531441e |
| 12 | 6 | WARNING | server.js not-now | BRANCH | hidden with no record | FIXED | 9718a2b0b8 |
| 13 | 6 | WARNING | engine/restartline.js | BRANCH | clock step back | DEFERRED | fails quiet |
| 14 | 7 | CONVENTION | server.js | BRANCH | four copies of the cleaner | FIXED | 8acdf4c771 |
| 15 | 7 | WARNING | web/index.html | BRANCH | live region inserted filled | FIXED | 8acdf4c771 |
| 16 | 8 | WARNING | engine/restartline.js atStart | BRANCH | first update silent | FIXED | 5920f1b65c |
| 17 | 8 | WARNING | engine/restartline.js | BRANCH | history wrap at 50 | DEFERRED | fails quiet |

### NITs (non-blocking, across all iterations)
- Restart all blocks the board per agent (iteration 1): recorded in the plan as a known cost.
- sessionStartsAsync re-parses each line (iterations 3, 4): cosmetic.
- Notes file read each poll (iterations 2, 8): one small file.
- HEAD runs the full read (iteration 4); no lock between notNow and atStart (iteration 8); progress announced per step (iteration 8).

### Strengths (across all iterations)
- The rule is pure (lineFor, markedNotes, fixReachedAt) and tested on its hard edges: tmux whole seconds, unread starts, rollbacks, an earlier update's fix after a later update, first install, the 50-entry cap (iterations 1-8).
- The route fails closed (no line on unreadable roster, tmux or notes) and skips tmux when nothing is marked, each proved with a control that can fail (iterations 1, 4, 5, 7).
- Restarts go through the ordinary per-agent route and are judged by outcome (restartTook); Kosmos never restarts anyone itself (all iterations).
- Each browser-check arm added for a fix was shown red on the page before the fix (iterations 2, 3, 5).
