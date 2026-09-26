---
pre_challenge: true
method: challenge-loop
branch: grok-sub-3391
diff_hash: ceb84e09c8c0458cfbb2e0ac92f6e0282ba076bd2cb9d78b472c75f5457bb00b
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T23:17:41Z
iterations: 21
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 21 (iteration 1 is the 6.0 baseline validation; blind reviewers from iteration 2, alternating opus and sonnet)
**Converged:** Yes (iteration 21: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs; 6j skipped on the validated hash ceb84e09c8c0)
**Total findings (tallied from the run ledger):** 2 BLOCKERs, 46 WARNINGs, 9 CONVENTIONs, about 23 NITs
**Fixed:** all BLOCKERs and CONVENTIONs; WARNINGs fixed, measured, or superseded by the round-14 decision, except 2 deferred with evidence (below) | **Asked:** 0

**Self-generated:** attributed from the ledger (which earlier loop fix wrote the cited line), not from `git blame`, because two rebases rewrote every sha. Treat as an estimate.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** none (6.0 baseline validation)
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] initial-validation: engine.reachable flagged setGrokTimers as unreachable --> FIXED (excused as a test seam)

#### Iteration 2
**Reviewer model:** opus
**Self-generated:** 0
- [BLOCKER] engine/grokaccounts.js - an API-key add could land on a pending sign-in's slot and be deleted by its cleanup --> FIXED (isSignInPending + claimHeld, engine/accountclaim.js shared with server.js)
- [WARNING] x5: default account listed as a subscription but ran the door key; lapsed create copy blamed a key; empty key file + auth.json disagreed between modules; socket path length; plan overclaimed tests --> FIXED
- [NIT] x4: name inheritance, delete copy, /usr/bin/env, wrap --> FIXED

#### Iteration 3
**Reviewer model:** sonnet
**Self-generated:** 1 (the reused-slot anti-litter came from iteration 2's fix)
- [WARNING] unreadable key file described as a subscription --> FIXED (identityOf null)
- [WARNING] reused-slot anti-litter left docs/ and logs/ --> FIXED
- [NIT] x2 --> FIXED

#### Iteration 4
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] x4: supervisor and engine classified differently; default dir tiers; the behaviour change must be named in the PR text; whitespace-only key --> FIXED
- [CONVENTION] socket comment --> FIXED

#### Iteration 5
**Reviewer model:** sonnet
**Self-generated:** 0
- [WARNING] missing-runner sentence duplicated --> FIXED (MISSING_RUNNER_SENTENCE)
- [WARNING] isRunnable guard missing on the sign-in start --> FIXED

#### Iteration 6
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] subscription row rendered GREEN on a file alone --> FIXED (signed_in_unverified overlay)
- [WARNING] a named sign-in could delete an undescribable auth.json --> FIXED (refuse on files)
- [WARNING] money: which key bills a subscription agent --> MEASURED (no door key on this box) and recorded in the plan
- [WARNING] per-account leader socket --> FIXED, later REMOVED in iteration 14
- [CONVENTION] x2 stale comments --> FIXED
- (6j-style) a leader-socket test measured the fixture HOME --> FIXED, later removed with the feature

#### Iteration 7
**Reviewer model:** sonnet
**Self-generated:** 1
- [CONVENTION] raw 'none' string --> FIXED (STATE.NONE)
- [WARNING] swallowed catches --> FIXED (failOpenK)
- [WARNING] bash and JSON parse divergence --> FIXED (plutil)

#### Iteration 8
**Reviewer model:** opus
**Self-generated:** 1 (the Disconnect copy predates the loop; the leader questions came from iteration 6)
- [WARNING] x2: --leader-socket accepted by grok? leftover leader after login? --> MEASURED (accepted; none left)
- [WARNING] "Use Check now" tooltip on keyed rows --> FIXED
- [WARNING] Disconnect/Delete said "key" for a sign-in --> FIXED (web + render-account-badge-1921 row); web.badge-observed-1921 pin updated

#### Iteration 9
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] silent keep with no plutil --> FIXED (log line; superseded in iteration 10)
- [NIT] duplicate expired sentence --> FIXED

#### Iteration 10
**Reviewer model:** opus
**Self-generated:** 2
- [WARNING] x2: bash re-derived the engine's rule --> FIXED (the supervisor asks identityOf through node: one copy); default GROK_HOME exported
- [WARNING] leader keyed on identity --> FIXED (later removed)
- [WARNING] holdsCredentials --> FIXED
- [CONVENTION] x2 --> FIXED

#### Iteration 11
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] plan said key accounts keep the default leader --> FIXED

#### Iteration 12
**Reviewer model:** opus
**Self-generated:** 2
- [WARNING] leader flag on older grok; lapsed strips a working key --> FIXED, then SUPERSEDED by iteration 14
- [WARNING] symlinked slot blocks an unnamed sign-in --> FIXED
- node -e top-level return was a SyntaxError (caught by the suite) --> FIXED (IIFE)

#### Iteration 13
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] UNKNOWN stripped the key --> FIXED, then SUPERSEDED by iteration 14
- [WARNING] an ambient GROK_HOME could reach a default agent --> DEFERRED: the plist env is explicit (measured) and nothing in Kosmos sets a global one; recorded in the supervisor comment

#### Iteration 14
**Reviewer model:** opus
**Self-generated:** 3
- [WARNING] x4: a named account inherited the door key; create and supervisor disagreed; leader lifecycle; --help per launch --> DECIDED: ONE RULE (a subscription agent runs on its own sign-in whatever its state) and the leader socket REMOVED; both recorded in the plan
- [CONVENTION] x3 --> FIXED

#### Iteration 15
**Reviewer model:** sonnet
**Self-generated:** 2
- [WARNING] x2 comment-level (switchKeyedSay "never a sign-in"; defaultDir vs supervisor contract) --> FIXED

#### Iteration 16
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] refusal said "Sign in again in Settings", which Kosmos cannot do --> FIXED (names the API-key path)
- [WARNING] plan claimed observed covers a dead refresh token --> FIXED (corrected, FOLLOW-UPS)
- [NIT] launchctl setenv overclaim --> FIXED; 4 NITs DEFERRED (below)

#### Iteration 17
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] the node probe swallowed errors silently --> FIXED (logs to stderr; RED-proven with a throwing engine)
- [NIT] unset _GROK_PREFIX --> DEFERRED

#### Iteration 18
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] the visible legacy pill showed a long sentence promising "sign in again" --> FIXED (short texts; lapsed and unknown Grok rows in render-account-badge-1921)
- [NIT] x3 taken: stale key-only comments, 400 on a non-string label, anti-litter keeps what predates the sign-in --> FIXED (925073fc, mutation-proven)

#### Iteration 19
**Reviewer model:** sonnet
**Self-generated:** 1 (the delete copy came from iteration 8)
- [WARNING] server.js handleApikeyAccountDelete would say "key" for a sign-in identityOf cannot describe --> DEFERRED: unreachable, forget and remove refuse such a dir before the sentence is built; the refusal is PINNED through the real DELETE route, both arms, RED with the guard removed (cef2338e)
- [NIT] PANE_ENV strip loop could be a named helper --> DEFERRED (one caller)

#### Iteration 20
**Reviewer model:** opus
**Self-generated:** 1 (the probe came from iteration 10)
- [WARNING] an auth.json that is not one readable sign-in keeps the door key SILENTLY --> FIXED (the probe logs it); keeping the key was decided in earlier rounds and kept: the realistic trigger is grok's own mid-refresh write, and failing closed would break a working launch
- [NIT] authUrl https-only and taken only once whitespace follows --> FIXED; expired advice says to choose the key account --> FIXED; session.buf unbounded --> DEFERRED (short-lived child) (c4ea8b5d)

#### Iteration 21
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger (condensed; per-iteration detail above)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine.reachable | BRANCH | setGrokTimers unreachable | FIXED | test seam |
| 2 | 2 | BLOCKER | engine/grokaccounts.js | BRANCH | key add on a pending sign-in slot | FIXED | accountclaim.js |
| 3 | 13 | WARNING | bin/agent-supervisor.sh | SELF | ambient GROK_HOME | DEFERRED | plist env explicit, measured |
| 4 | 14 | WARNING | several | SELF | named account inherited the door key | DECIDED | ONE RULE, leader removed |
| 5 | 19 | WARNING | server.js | SELF | "key" for an undescribable sign-in | DEFERRED | unreachable, refusal pinned |
| 6 | 20 | WARNING | bin/agent-supervisor.sh | SELF | silent keep on an undescribable auth.json | FIXED | logged |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] an empty-key dir is a dead end; account dir mode 0755; the stale-claim rule's two spellings (iteration 16) - DEFERRED, openai parity
- [NIT] _GROK_PREFIX unset after use (iteration 17) - DEFERRED, the launch line uses it
- [NIT] PANE_ENV strip helper (iteration 19) - DEFERRED, one caller
- [NIT] session.buf unbounded (iteration 20) - DEFERRED, short-lived child
- [NIT] engine/grokaccounts.js:303-306 checkLive reads auth.json twice on the empty-key path (iteration 21)
- [NIT] engine/grokaccounts.js:320-331 pill-sized verdicts drop the sibling "we" voice (iteration 21) - deliberate, 32-character pills

### Strengths (across all iterations)
- One shared claim module for both slot directions, tested through the real routes (iteration 21)
- The supervisor asks the engine's identityOf rather than re-deriving it, and every failure to classify keeps the key and logs why (iterations 20, 21)
- ONE RULE applied consistently to the board row, the create gate and the launcher, each pinned (iteration 21)
