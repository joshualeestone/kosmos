---
pre_challenge: true
method: challenge-loop
branch: agent-start-3410
diff_hash: 59f05ae4a837bcbf64571f741004f2426dbad60ce08912677c4aaffd8503e275
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T22:38:07Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** Yes (iteration 9 returned zero new BLOCKER/WARNING/CONVENTION findings)
**Total actionable findings:** 15 (1 BLOCKER, 9 WARNINGs, 4 CONVENTIONs, 1 NIT-elevated) plus assorted NITs
**Fixed:** 13 | **Deferred (reasoned):** 2 (the open-time-receipt residual; the FOUND.NONE engine gap, which is Angel's #3418 co-shipping) | **Asked:** 0

Model rotation: opus / sonnet alternating (odd iters opus, even iters sonnet), so
convergence is witnessed by both models rather than one being out of ideas.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0 (nothing had committed before the first review)
- [WARNING] render-start-agent-3410.js — the #3418 honesty path (restarted-but-never-ready) was untested --> FIXED (added Part 4, asserts "has not come back", not "Started")
- [NIT] refused fixture used HTTP 200 not 400 --> FIXED
- [NIT] no null guard on the top-level addEventListener --> DEFERRED (matches the adjacent rst-go/detail-back convention; element is static)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] the supersede token was not re-checked after the hello POST --> FIXED
- [WARNING] onPanel did not guard the withdrawn banner --> FIXED (added !PANEL_WITHDRAWN)
- [NIT] "10/10" count wrong --> FIXED; [NIT] plan Test-plan omitted Part 4 --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [CONVENTION] restartFailureLine's restart-worded fallback doubled up in the START context --> FIXED (suppress the generic when no detail; added red-capable Part 3b)
- [NIT] success-path copy untested --> DEFERRED (near-verbatim reuse of tested #2686 code); later FIXED in iter 8
- [NIT] disabled button lingers after success --> raised again later; addressed iter 6

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (all pre-this-loop or genuine new concurrency gaps)
- [WARNING] reappear arm never re-enabled a button disabled by the withdrawn arm --> FIXED (refreshStartAffordance in the reappear arm)
- [WARNING] stale PANEL_WITHDRAWN after an agent switch --> FIXED (reset in openDetail)
- [WARNING] no epoch guard for close+reopen mid-wait --> FIXED (per-open START_EPOCH; red-capable Part 5)
- [CONVENTION] wake-hello logic duplicated autoHelloAfterRestart --> FIXED (factored sendWakeHello; render-autohello-2686 green)
- [NIT] partial-outcome wording --> FIXED (comment)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 2 (the WARNING was my iter-4 comment; the CONVENTION was a consequence of my iter-4 reappear re-enable)
- [WARNING] a comment (mine, iter 4) asserted poll behavior the code lacked --> FIXED (reworded; SELF prose corrected)
- [CONVENTION] reappear re-enable could open a double-restart window mid-wait --> FIXED (START_FLIGHT in-flight guard; red-capable Part 6)
- [NIT] timing-based epoch arm; [NIT] success-path untested --> DEFERRED (later fixed iter 8)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 NIT
**Self-generated:** 0
- [BLOCKER] restartInner REFUSES FOUND.NONE (no-session), which is the state a genuinely-offline agent (the primary target) is in, so /restart cannot start it today --> RESOLVED IN LANE: the button is the correct UI + honest (surfaces the refusal, never a false "Started"); the ENGINE capability is Angel's #3418 (relaunch-from-fully-dead / bootstrap the launchd job), co-shipping in 0.6.89. Documented in plan + code comments, coordinated with Angel (HEADS-UP asking her to confirm #3418 covers FOUND.NONE), recorded on card #3410, and now covered by a real-route test (Part 7). The engine change is out of my lane (must not touch restartInner). Weakest premise: #3418 covers FOUND.NONE and co-ships.
- [WARNING] browser-check mocked /restart, never exercised the real refusal --> FIXED (Part 7 real route + offline 'ghost' fixture)
- [WARNING] disabled button lingered after success --> FIXED (hide button on success; refreshStartAffordance manages hidden)
- [NIT] plan/comment overstated "starts a stopped agent" --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 1 (the duplicate plan bullet was my iter-6 edit)
- [WARNING] open-time-only re-derive leaves a stale receipt if an agent changes state while its panel stays open --> DEFERRED (reasoned): matches #d-reauth and every status receipt in the app; self-heals on reopen; never lies about the current action; per-tick re-derive would make this the sole special case and complicate the message lifecycle. Surfaced for Josh/Angel (the reviewer's own suggested disposition).
- [NIT] duplicate "Honest under #3418" plan bullet --> FIXED
- [NIT] CSS comment said "center" but uses align-items:stretch --> FIXED
- [NIT] sm.isConnected effectively always true --> DEFERRED (harmless defensive)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0
- [WARNING] the SUCCESS terminal state (readiness reached + hello placed + button hide) was untested (third flag) --> FIXED (Part 8, /api/status recovery-flip pattern; asserts the receipt + button hide)
- [NIT] README/runner comment undersold the coverage --> FIXED (enumerate all arms)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKER/WARNING/CONVENTION, 1 NIT
**Self-generated:** 0
- [NIT] the supersede-return path leaves the button disabled (self-heals on reopen) --> recorded, not fixed: the reviewer rates it effectively unreachable for a pres:'off' agent, it preserves message honesty, and it mirrors the already-deferred open-time-receipt residual. Fixing a one-liner in a near-impossible path would restart the whole review/validate cycle (the confirming-pass anti-pattern).
**Converged** — no new actionable findings; only STRENGTHs and one unreachable NIT.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | render-start-agent-3410.js | BRANCH | #3418-honesty path untested | FIXED |
| 2 | 2 | WARNING | web/index.html | BRANCH | token not re-checked after hello | FIXED |
| 3 | 2 | WARNING | web/index.html | BRANCH | onPanel missed PANEL_WITHDRAWN | FIXED |
| 4 | 3 | CONVENTION | web/index.html | BRANCH | restart-worded fallback double-up in START context | FIXED |
| 5 | 4 | WARNING | web/index.html | BRANCH | reappear arm never re-enabled the button | FIXED |
| 6 | 4 | WARNING | web/index.html | BRANCH | stale PANEL_WITHDRAWN after switch | FIXED |
| 7 | 4 | WARNING | web/index.html | BRANCH | no epoch guard for reopen mid-wait | FIXED |
| 8 | 4 | CONVENTION | web/index.html | BRANCH | wake-hello logic duplicated | FIXED |
| 9 | 5 | WARNING | web/index.html | SELF | comment asserted poll behavior code lacked | FIXED |
| 10 | 5 | CONVENTION | web/index.html | SELF | reappear re-enable double-restart window | FIXED |
| 11 | 6 | BLOCKER | engine/remove.js (seam) | BRANCH | /restart REFUSES FOUND.NONE (offline agent) | RESOLVED-IN-LANE + DEFERRED to Angel #3418 |
| 12 | 6 | WARNING | render-start-agent-3410.js | BRANCH | real /restart route never exercised | FIXED (Part 7) |
| 13 | 6 | WARNING | web/index.html | BRANCH | disabled button lingered after success | FIXED |
| 14 | 7 | WARNING | web/index.html | BRANCH | open-time-only re-derive stale-receipt residual | DEFERRED (reasoned, surfaced) |
| 15 | 8 | WARNING | render-start-agent-3410.js | BRANCH | success terminal state untested | FIXED (Part 8) |

### Deferred (with reasoning, for operator visibility)
- **#11 (BLOCKER, resolved in lane):** the button DELIVERS for genuinely-offline (FOUND.NONE) agents only once Angel's #3418 makes /restart bootstrap the launchd job. The UI is correct and honest today; the engine gap is Angel's card, co-shipping in 0.6.89. Coordinated (HEADS-UP) + recorded on card #3410. Josh/Angel: confirm #3418 covers FOUND.NONE.
- **#14 (WARNING, scope):** receipt lifecycle is open-time re-derive only, matching every status receipt in the app. A rare state-change-while-panel-open leaves a stale (once-true) receipt until reopen; never a false claim about the current action. Per-tick re-derive was judged not worth making this the sole special case. Surfaced for Josh/Angel.

### NITs (non-blocking)
- addEventListener null guard (matches app convention); sm.isConnected redundant-but-harmless; the supersede-return stuck-disabled button (iter 9, effectively unreachable, mirrors #14).

### Strengths (across iterations)
- Honest under the #3418 restart false-success: never claims "Started" without restartReadyWait confirming the live session; "said hello" only on delivery.state==='placed'.
- Layered concurrency guards, each with a distinct job (START_EPOCH, START_FLIGHT, RESTART_HELLO_SEQ, PANEL_WITHDRAWN), each exercised by a red-capable browser-check arm.
- sendWakeHello factor removes the two-copy wake-hello duplication (conv #5) without changing autoHelloAfterRestart's behavior.
- Real-route FOUND.NONE arm (Part 7) exercises the actual engine refusal, not just mocks, and is designed to go red when #3418 lands.
- Conventions clean: no em dashes (all five spellings), product voice preserved ("this computer"), theme-aware CSS (light + dark), full browser-check wiring.
