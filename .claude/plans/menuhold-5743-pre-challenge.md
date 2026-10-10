---
pre_challenge: true
method: challenge-loop
branch: menuhold-5743
diff_hash: 4ec6fa98f409e159dba8ac1a14fd2e22e6dc20e5aa26ada95dcd15f25b466065
validation: passed (rebased on origin/main f113ff142; focused, as this repo's practice, chosen by CONTENT: every test file that calls the delivery paths or the detectors (chose/asked, deliverAsync, deliverAutomatic, deliver(, sendPost, claudeQuestionMenu, claudePermission, menuHeld, safeguards, heldBy, wakeHeldLine; 69 files) run from the repo root, plus engine.reachable, fixture-discipline, the 4796 sandbox, brand, name and Windows guards: 2934 tests, 0 fail; each new guard red by mutation; the hazard measured live on Claude Code 2.1.296 through the 0.7.35 delivery code (card #5754 comments))
subdir_audit: passed
timestamp: 2026-10-10T06:10:39Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 blind reviewer passes (alternating sonnet and opus)
**Converged:** Yes (iteration 18: no new BLOCKER, WARNING or CONVENTION; NITs only)
**Total findings:** 1 BLOCKER-class gap (working cards unread, iteration 11) and about 40 WARNINGs and CONVENTIONs across the run, plus NITs
**Fixed:** most | **Deferred:** with reasons in the plan | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 5 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] hello's held sentence named the quota --> FIXED
- [WARNING] refusal pointed at the direct messages for forms they cannot answer --> FIXED
- [WARNING] failed read fails open --> DEFERRED: decided (would refuse ordinary replies on one bad capture); pinned by a test
- [WARNING] untested paths (DM close-then-deliver, failed read, runners, held room post) --> FIXED (tests); DM close path proven by server.question-menu-5406.test.js
- [WARNING] two captures per automatic send --> DEFERRED: the second is the deliberate last look before typing

#### Iteration 2
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 1 CONVENTION
**Self-generated:** 1
- [WARNING] blind spots of the needs_you gate (Submit row, review tab, tall menus) --> DEFERRED: recorded, filed #5749
- [WARNING] plan overstated a person's room post reason and the room brake --> FIXED (plan)
- [CONVENTION] comments named only the quota --> FIXED

#### Iterations 3 to 6
**Reviewer models:** sonnet, opus, sonnet, opus
- two-hour age-out, connlost-heal, assigner wording, menu-held log label --> recorded or FIXED
- recommender charged an attempt for a stuck agent on its menu --> FIXED (heldUntil asks chat.menuHeld)
- #5754 joined the branch: permission prompt detector, real 2.1.296 captures --> FIXED/ADDED

#### Iterations 7 to 10
**Reviewer models:** sonnet, opus, sonnet, opus
- wake/pickup page line said quota for a menu hold --> FIXED (tested)
- a "Do you want to" question menu read as a permission prompt --> FIXED (menu checked first)
- held wording true for both screens --> FIXED ("waits for an answer on its screen")
- safeguards model-switch menu typed into --> FIXED (refused and held, its own sentence)

#### Iteration 11
**Reviewer model:** sonnet
- [WARNING, the largest] a WORKING card reaching a permission prompt was never read --> FIXED (read working and needs_you; idle pays nothing)
- [WARNING] detection by wording only --> FIXED (shape fallback)

#### Iterations 12 to 17
**Reviewer models:** opus, sonnet, opus, sonnet, opus, sonnet
- working-card control; DM clause only where answerable; shape-only neutral sentence; never-throw wrappers; exact read order pinned; unused export removed; failed read refuses on a reported permission request; whole-line footer anchor; stale-report residual recorded --> FIXED or recorded

#### Iteration 18
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Converged** — no new actionable findings.

### NITs (non-blocking, iteration 18, not acted on)
- The permission footer does not match an uncaptured two-part "Enter to select · Esc to cancel" form (the question-menu footer does).
- tcHelloSend's comment explains a held stop by the quota reset; a menu hold clears when answered.
- chat.test.js comment mentions needs_you only; working cards are read too.
- The recommender's held log line says "a question" for a permission prompt.
- replynudge's menu-held branch has no test of its own (firstreply and agentnudge do).
- Two captures per automatic send (decided, recorded in the plan).

### Strengths
- One floor in deliverWithGap covers every sender; held verdicts reuse the #4588 shape, so every automatic caller keeps or retries without spending a try.
- Detectors anchored to the live bottom of the screen and tested against real captures, with controls that discriminate.
