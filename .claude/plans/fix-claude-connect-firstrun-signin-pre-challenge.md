---
pre_challenge: true
method: challenge-loop
branch: fix-claude-connect-firstrun-signin
diff_hash: e2a9ab6e93f05b870c584d70a7f625519a7818b907d04d8f4f9e46f74318f24d
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T17:23:37Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (blind, model-alternated per kosmos#2032)
**Converged:** Yes -- iteration 12 (sonnet) returned zero actionable findings; iteration 13 (opus) confirmed clean, so the final code is witnessed clean by both models in the rotation.
**Total findings across the loop:** 4 BLOCKER, 5 WARNING, several CONVENTION/NIT (doc/comment accuracy), plus recorded STRENGTHs each pass.
**Fixed:** all actionable | **Deferred:** 2 (with reasons, below) | **Asked (awaiting user):** 0

This is a prod auth-flow change to `engine/connect.js` (the Claude sign-in driver). The loop was run in full because a heavily-commented driver invites stale-comment and gate-consistency defects; that judgement paid off -- real logic defects surfaced as late as iteration 11.

### Per-Iteration Breakdown

Iterations 1-6 ran before a context compaction; their reviewer models were not recorded at the time, so they are marked `unknown` honestly rather than reconstructed. Iterations 7-13 (this session) recorded their model on each spawn.

#### Iteration 1
**Reviewer model:** unknown (pre-compaction; not recorded)
**New findings:** 0 BLOCKER, 0 WARNING, 3 CONVENTION (comment accuracy), 0 NIT
**Self-generated:** 0 (first reviewer pass, no loop fixes yet)
- [CONVENTION] connect.js completion-gate comments -- three comments still said "non-reauth unchanged" after the needsLogin change --> FIXED (51984b89)

#### Iteration 2
**Reviewer model:** unknown (pre-compaction)
**New findings:** 0 BLOCKER, 0 WARNING, CONVENTION/doc --> FIXED
**Self-generated:** partial (comments introduced by iter1's own fix)
- [CONVENTION] fresh-machine comment gave the wrong reason; last `!owner.reauth` gate (post-install) not yet aligned to needsLogin; plan em dashes; an un-awaited #1922 finishConnected --> FIXED (6f2bae99)

#### Iteration 3
**Reviewer model:** unknown (pre-compaction)
**New findings:** 0 BLOCKER, 0 WARNING, CONVENTION + 1 NIT
**Self-generated:** partial
- [CONVENTION] plan Fix section drifted (said Option A, code is Option B); brittle test line-ref; checklist boxes --> FIXED (6a871efd)
- [NIT] engine-level fresh-machine control --> DEFERRED: the invariant is covered by the server-level #2645 CONTROL (documented-deliberate).

#### Iteration 4
**Reviewer model:** unknown (pre-compaction)
**New findings:** 1 real edge fix + 1 WARNING
**Self-generated:** partial
- [BLOCKER-class edge] present-but-dead + NO-binary corner: the post-install `!haveBinary` gate did not set `owner.needsLogin` on a CONNECTED-file+live-NONE verdict --> FIXED (368694f9). Also trimmed the #1922 Keychain comment; dropped the vestigial `owner.reauth` from the flow literal.
- [WARNING] real-world efficacy unverified in tests --> DEFERRED: inherently a real-machine property; Splinter's mortals deploy-watch (keychain mdat update + connect.json phase->connected) is the empirical proof.

#### Iteration 5
**Reviewer model:** unknown (pre-compaction)
**New findings:** 0 actionable (doc/comment accuracy only) --> FIXED (b6d883bc)
**Self-generated:** partial (prose from prior fixes)

#### Iteration 6
**Reviewer model:** unknown (pre-compaction)
**New findings:** 0 actionable (doc/comment accuracy only) --> FIXED (30ce79a6)
**Self-generated:** partial

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER
**Self-generated:** 0
- [BLOCKER] connect.js #1922 capture-fail gate finished on `checkLive` CONNECTED with no login-done guard -- a reauth of a STILL-LIVE credential whose pane dies before the new login completes would finish off the OLD credential (false success, #1937 class) --> FIXED (5afecbfa: gate is `(!owner.needsLogin || owner.sawLoginDone || owner.deadCredential)`; the reviewer's simpler `(!needsLogin || sawLoginDone)` was REJECTED because it breaks #1922's present-but-dead primary case) + regression test (a38969e5, reauth-on-live capture-fail -> STUCK). Perturb-verified.

#### Iteration 8
**Reviewer model:** sonnet (model varied from iter7 opus -- caught what opus missed)
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 0
- [BLOCKER] runFlow post-install re-check set `owner.needsLogin=true` but not `owner.deadCredential`, so a no-binary-at-start machine with a stranded dead credential false-STICKs a landed login --> FIXED (ddf0cff1: set both flags).
- [WARNING] start()'s deadCredential detection is gated `!reauth`, so a reauth of a dead credential never set deadCredential and false-STICKs -- the reauth-completes-but-not-seen symptom Josh hit --> FIXED (ddf0cff1: focused reauth detection block). Two non-vacuous tests; perturb-verified.

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] the last uncovered reauth arm: reauth + NO binary at start + dead credential slips both start()'s reauth detection (gated haveBinary) and the finish-capable post-install block (gated !needsLogin) --> FIXED (c17cea29: a SET-ONLY post-install block `!haveBinary && owner.needsLogin`). New non-vacuous test (reauth+no-binary, driven through a fixture install); perturb-verified.

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 1 WARNING (comment accuracy -- no logic defect)
**Self-generated:** 1 (the comment was introduced by iter9's own fix)
- [WARNING] block-(c) comment claimed the arm is "necessarily a RE-AUTH"; a present-but-dead first-run with a binary present-but-broken (passes X_OK, fails --version) also reaches it. Code is correct (idempotent there); the comment would misdirect a future incident diagnosis --> FIXED (e1f64b5f: comment-only, names both arms). Did NOT add a test for the contrived idempotent path (nothing distinct to pin).

#### Iteration 11
**Reviewer model:** opus
**New findings:** 2 WARNING (one real logic false-success)
**Self-generated:** 0 (the repl gate is pre-existing; the branch newly routed first-run-dead through it)
- [WARNING/logic] the in-flow repl completion arm finished on `seen.kind === 'repl'` UNCONDITIONALLY off the FILE. For a needsLogin flow the file is stale-CONNECTED and `auth login` exits on success (pane closes -> the live-checked capture-fail rescue finishes it), so a repl in a needsLogin flow is auth-login failing back to a bare "Not logged in" REPL while the credential is still dead -- finishing off the stale file is a dead-credential FALSE SUCCESS --> FIXED (cf9a327f: gate the whole finish on `(!owner.needsLogin || owner.sawLoginDone)`; non-needsLogin repl finish unchanged). Negative test + non-vacuous positive control; perturb-verified.
- [WARNING] start() reauth comment overclaimed "every reauth path sets deadCredential" (a checkLive-UNKNOWN-at-start reauth stays conservative=false, correct behavior) --> FIXED (cf9a327f: comment softened).

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 0 NIT
**Self-generated:** 0
**Converged** -- zero actionable findings after dedup (one theoretical concern traced and correctly dropped as a non-defect); only STRENGTHs.

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION (2 explicitly non-actionable NITs)
**Self-generated:** 0
Cross-model convergence witness on the final code (the last real logic bug at iter11 was found by opus; iter12's clean pass was sonnet, so opus re-witnessed the post-fix code). Clean. No changes recommended.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1-6 | CONVENTION | connect.js/plan comments | mixed | completion-gate + fresh-machine comment accuracy, plan drift, em dashes | FIXED | 51984b89..30ce79a6 |
| 2 | 3 | NIT | server.connect.test.js | BRANCH | engine-level fresh-machine control | DEFERRED | covered by server-level #2645 CONTROL |
| 3 | 4 | BLOCKER | connect.js post-install (no-binary) | BRANCH | present-but-dead+no-binary did not set needsLogin | FIXED | 368694f9 |
| 4 | 4 | WARNING | (whole fix) | BRANCH | real-world efficacy unverified in tests | DEFERRED | real-machine property; Splinter deploy-watch is the proof |
| 5 | 7 | BLOCKER | connect.js #1922 gate | BRANCH | reauth-on-live capture-fail false success | FIXED | 5afecbfa + a38969e5 |
| 6 | 8 | BLOCKER | connect.js ~1967 | BRANCH | post-install set needsLogin not deadCredential | FIXED | ddf0cff1 |
| 7 | 8 | WARNING | connect.js reauth detection | BRANCH | reauth-on-dead never set deadCredential | FIXED | ddf0cff1 |
| 8 | 9 | WARNING | connect.js post-install | BRANCH | reauth+no-binary arm uncovered | FIXED | c17cea29 |
| 9 | 10 | WARNING | connect.js block-(c) comment | SELF | "necessarily a reauth" overclaim | FIXED | e1f64b5f |
| 10 | 11 | WARNING | connect.js repl finish (~2650) | BRANCH | repl finish unconditional -> dead-cred false success | FIXED | cf9a327f |
| 11 | 11 | WARNING | connect.js reauth comment | SELF | "every reauth path" overclaim | FIXED | cf9a327f |

### Outstanding questions (ASKED, still unresolved when the run ended)
None. No finding required a user/product decision.

### NITs (non-blocking, across all iterations)
- [NIT] iter13: connect.test.js needsLogin-repl test uses a fixed 600ms sleep + negative-only assertion -- sound because it first awaits the signin phase and the over-reach direction is covered by the positive control.
- [NIT] iter13: minor guard-style asymmetry between the two post-install blocks (one has an explicit post-await driver check, one relies on guarded consumers) -- both correct.

### Strengths (across all iterations)
- The `deadCredential` (dead->live proof) escape is included ONLY in the single live-checked capture-fail rescue and correctly EXCLUDED from every file-based finish -- so it can never enable a false success off a stale file.
- All completion gates require real login-success evidence for a needsLogin flow; reauth-on-live correctly goes STUCK on a capture-fail rather than finishing off the old live credential (deliberate, tested tradeoff -- recoverable over false success).
- `owner.reauth` fully removed from the flow literal and read nowhere; a single `owner.needsLogin` signal drives all five sites.
- Fresh-machine / OpenAI paths structurally unchanged (the whole apparatus is nested under `check() === CONNECTED`); pinned by a non-vacuous #2645 CONTROL asserting a fresh machine still launches a bare `claude`.
- Install-path tests drive a real fixture download+install and genuinely reach the post-install sites under test; every new test perturb-verified to fail without its fix.
