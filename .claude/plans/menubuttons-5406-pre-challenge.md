---
pre_challenge: true
method: challenge-loop
branch: menubuttons-5406
diff_hash: 4d04da161c9218505ecc498534a9df09ed9c2863a3c44b99885e5004b66e1819
validation: passed (rebased on origin/main 98a208bda; focused, as this repo's practice: web.dmchoices-5406 (12) and server.question-menu-5406 (17, the GET serving asked only for Claude's single-select menu, and every POST refusal path with nothing typed), engine/chat.question-menu-5406, the talk, DM, thread, composer and send web suites, the thread, question, answer and automatic-hello server suites, every browser-check wiring test (run from the repo root), and the fixture-discipline, 4796 sandbox, brand, name and Windows guards: 313 tests, 0 fail; each new guard red by mutation; the browser check render-dmchoices-5406 syntax-checked, its run queued on the shared machine)
subdir_audit: passed
timestamp: 2026-10-10T04:43:43Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (iteration 1 is the 6.0 validation pass; 12 blind reviewer passes)
**Converged:** Yes
**Total findings:** 33 actionable (1 BLOCKER, 27 WARNINGs, 5 CONVENTIONs) plus NITs
**Fixed:** 29 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 validation)
**Reviewer model:** none (validation helper and focused guards)
**New findings:** 1 BLOCKER, 1 CONVENTION
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] initial-validation: fixture-discipline failed (web.dmchoices-5406.test.js hand-built a card) --> FIXED (a45febd07, now from the fleet fixture)
- [CONVENTION] .claude/plans/ no plan file for the branch --> FIXED (plan written)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] web/index.html paintTalk: choices set before the staleness checks --> FIXED
- [WARNING] server.js: asked served unmasked in the setup guide's thread --> FIXED (null there; tested with a control)
- [WARNING] web/index.html dmChoicePress: a refusal left stale buttons up --> FIXED (repaints)
- [CONVENTION] web/index.html threadKey: a DM_CHOICES.sig term that changed nothing --> FIXED (removed, plan corrected)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] a mid-flight repaint re-enabled the buttons (double press) --> FIXED (in-flight state drawn disabled)
- [WARNING] a rewrite lost keyboard focus on a choice --> FIXED (focus put back by digit; browser-check arm)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] any 200 read as "Sent." (delivery.state ignored) --> FIXED
- [WARNING] an outcome note outlived its question --> FIXED
- [WARNING] focus lost on every press --> FIXED
- [WARNING] buttons for the folder-trust dialog --> DEFERRED: measured, the observed dialog yields no options; a server test pins that no buttons are drawn

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] an answered question re-offered its buttons --> FIXED (short lock)
- [WARNING] buttons for runners other than Claude --> FIXED (asked for Claude cards only; tested)
- [WARNING] a failed read left dead buttons --> DEFERRED: the failure branch rewrites the whole thread with its sentence, so the buttons go

#### Iteration 6
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 2
- [WARNING] a refusal's reason lost when the question changed --> FIXED (said on the conversation's line)
- [WARNING] a stale press typed as a prompt when no question is up --> FIXED (409; tested with a typed-digit control)
- [WARNING] focus moved into another agent's conversation --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1
- [WARNING] a press whose words failed their bounds skipped every check --> FIXED (askedGiven)
- [WARNING] the answered lock stuck on a repeated question --> FIXED (expires after the stale-poll window)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [BLOCKER] buttons drawn for Claude's permission prompts, where a press is pasted and Enter takes the highlighted option --> FIXED (asked only for status.claudeQuestionMenu; the server refuses any other screen; tested)
- [WARNING] a refusal stayed under the composer after a success --> FIXED
- [WARNING] plan silent on permission prompts --> FIXED

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 0
- [WARNING] a press for a non-Claude agent was not refused at the server --> FIXED (tested)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 5 NITs
**Self-generated:** 2
- [WARNING] a failed request or unreadable 200 read as "did not go" --> FIXED ("could not confirm")
- [WARNING] the answered lock dropped by another agent's paint --> FIXED (per agent)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 1
- [WARNING] an unconfirmed outcome re-offered the buttons at once --> FIXED (same short lock, no "Sent.")

#### Iteration 12
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] buttons where the composer is closed --> FIXED (presence rule)
- [WARNING] a press and a typed send could overlap --> FIXED (each waits for the other; tested)
- [WARNING] an automatic message could carry a question identity --> FIXED (refused as not plain text; tested)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after dedup, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] options numbered 10 or more get dead buttons --> DEFERRED: status.claudeQuestionMenu returns null above 9 entries and the GET serves asked only when it matches
**Converged** — no new actionable findings.

### Final Ledger (actionable)

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | BLOCKER | web.dmchoices-5406.test.js | BRANCH | hand-built card | FIXED |
| 2 | 1 | CONVENTION | .claude/plans | BRANCH | no plan file | FIXED |
| 3 | 8 | BLOCKER | server.js GET | BRANCH | permission-prompt buttons | FIXED |
| 4 | 4 | WARNING | server.js | BRANCH | trust dialog | DEFERRED (measured) |
| 5 | 5 | WARNING | web/index.html | BRANCH | failed read | DEFERRED (thread rewritten) |
| 6 | 13 | WARNING | web/index.html | BRANCH | 10+ options | DEFERRED (capped at 9) |
| ... | 2-12 | WARNING/CONVENTION | server.js, web/index.html, plan | BRANCH/SELF | as listed per iteration | FIXED |

### NITs (non-blocking, across all iterations)
- Several wording, comment and accessibility notes; the ones taken are in the commits (digit kept in the accessible name, null-body guard, DM_CHOICE_UNSURE rename, success announced in the persistent live region).

### Strengths (across all iterations)
- The server, not the page, supplies the question's identity, from the same function the POST checks against.
- Every path where a press could be pasted rather than sent as a key is refused at the server, each with a test asserting nothing typed.
