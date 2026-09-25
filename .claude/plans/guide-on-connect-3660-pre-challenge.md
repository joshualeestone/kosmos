---
pre_challenge: true
method: challenge-loop
branch: guide-on-connect-3660
diff_hash: 3e9e003b3060bb54f6adcfc6b9b36cd683621170311756149961fdefeb2838b6
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T02:16:44Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (iteration 1 is the 6.0 baseline validation; blind reviewers from iteration 2, alternating opus and sonnet)
**Converged:** Yes (iteration 9: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs; 6j skipped on the validated hash 3e9e003b3060)
**Total findings:** 2 BLOCKERs (both synthetic, from validation), 15 WARNINGs, 4 CONVENTIONs, 16 NITs
**Fixed:** 2 BLOCKERs, 14 WARNINGs, 4 CONVENTIONs, 12 NITs | **Deferred:** 1 WARNING, 4 NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** none (6.0 baseline validation)
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] initial-validation: engine.reachable flagged resetEnsureGuideForTests --> FIXED (commit 759865aa): excused as a test seam

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] engine/setup-assistant.js - the back-off never applied to a listed but dead sign-in (a live check every minute) --> FIXED (c9af6521)
- [WARNING] engine/setup-assistant.js - retries never ended --> FIXED (c9af6521): doubling back-off with a cap
- [WARNING] server.projects.test.js - test boards created an unasserted guide (MEASURED: 1 create) --> FIXED (c9af6521): off under dry run unless AGENT_WORKFORCE_SETUP_GUIDE=on (measured 0 after); new e2e test turns it on
- [WARNING] engine/setup-assistant.js - "Don't show this again" did not stop a later guide --> FIXED (c9af6521)
- [CONVENTION] engine/setup-assistant.js - headers still described create-at-first-run on Claude only --> FIXED (c9af6521)
- [NIT] sweep block split another sweep's comment; the bypassed Claude-only check needed a comment --> FIXED (c9af6521)
- (6g) [BLOCKER] final-validation-style: engine.reachable flagged firstConnectedModel, orphaned by the iteration-2 fix --> FIXED (fc614cf7)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 1 (the e2e test's cleanup came from iteration 2)
- [WARNING] engine/setup-assistant.js - a DEFAULT Gemini or Grok key is let through unchecked by create's gate --> FIXED (29298943): live-checked here
- [CONVENTION] isArmed and MODEL_PROVIDERS exported with no outside caller --> FIXED (29298943)
- [NIT] e2e sandbox leaked on a failed boot --> FIXED (29298943)
- [NIT] duplicated child-server helpers across test files --> DEFERRED: pre-existing duplication across several files

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 (all three in the back-off and create logic from iterations 2-3)
- [WARNING] a grown back-off delayed a newly connected model --> FIXED (c176dc1f): a changed listing skips the wait
- [WARNING] a create refused on the first model stranded a working second --> FIXED (c176dc1f): tries each in order
- [WARNING] a failed seeded-flag write could create a second guide --> FIXED (c176dc1f): in-process latch
- [NIT] a default Grok subscription checked twice (pinned); server comment overclaimed; JSDoc placement --> FIXED (c176dc1f)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
**Self-generated:** 1 (findModel was orphaned by iteration 4's rewrite)
- [WARNING] findModel had no production caller (a second derivation; engine.reachable passed only through comment mentions) --> FIXED (661aa62a): removed; tests on listedModels/usable
- [CONVENTION] engine/roles.js - the setup role's comment still said created at first-run --> FIXED (661aa62a)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2
- [WARNING] a fix in the same folder (new key, other sign-in) did not change the fingerprint --> FIXED (6f252517): WHO in the fingerprint, a change resets
- [WARNING] Giddy Up waited on the back-off --> FIXED (6f252517): never waits; cap lowered to an hour
- [NIT] name-taken paid live checks on every model; deps doc; comment wrap --> FIXED (6f252517)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2
- [WARNING] usable() swallowed a throwing gate as a refusal --> FIXED (bd97ab71): fails open and logs (#1916)
- [WARNING] a new key over a Claude API-key account is not visible to the fingerprint --> DEFERRED: Claude rows carry no key suffix, and exposing one for this is not worth it; documented, bounded by the one-hour cap
- [NIT] role copy "finish setting up" --> FIXED (bd97ab71)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3
- [WARNING] both names taken retried hourly forever --> FIXED (b6cef241): final for the process
- [WARNING] the one-hour cap was pinned only by the constant --> FIXED (b6cef241): pinned by behaviour
- [WARNING] the sweep path (a model connected after Giddy Up) had no test --> FIXED (b6cef241): e2e test through the real server
- [NIT] settings read before cheap checks, sweep never stopped; latch not reset in two finallys; stale day assertion --> FIXED (b6cef241)

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine.reachable | BRANCH | test seam unexcused | FIXED | 759865aa |
| 2 | 2 | WARNING | server.projects.test.js | BRANCH | test boards created a guide (measured) | FIXED | c9af6521 |
| 3 | 2 | BLOCKER | engine.reachable | SELF | firstConnectedModel orphaned | FIXED | fc614cf7 |
| 4 | 3 | WARNING | engine/setup-assistant.js | BRANCH | default Gemini/Grok key unchecked | FIXED | 29298943 |
| 5 | 4 | WARNING | engine/setup-assistant.js | SELF | back-off, refusal, flag-write gaps | FIXED | c176dc1f |
| 6 | 7 | WARNING | engine/setup-assistant.js | SELF | Claude API-key re-key invisible | DEFERRED | bounded by the hour cap |
| 7 | 8 | WARNING | server.js | BRANCH | sweep path untested | FIXED | b6cef241 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] shared child-server test helpers (iteration 3) - DEFERRED, pre-existing duplication
- [NIT] server.js:15088 one unneeded interval when already seeded at boot, self-clears on the next tick (iteration 9) - DEFERRED, harmless
- [NIT] plan filename has no timestamp suffix (iteration 9) - DEFERRED, matches about half of .claude/plans

### Strengths (across all iterations)
- Arming at Giddy Up keeps an unasked-for "Josh" off every existing board, pinned from the dangerous direction (iterations 8, 9)
- usable() targets exactly the gap in create's gate, no overlap and no gap (iteration 9)
- Concurrency and partial failure exercised with real concurrent calls and a real child server (iteration 9)
