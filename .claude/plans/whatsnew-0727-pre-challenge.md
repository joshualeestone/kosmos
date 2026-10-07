---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0727
diff_hash: d819b4b213e58e79d5ec52819fce771103d30947509b597931a09767f38343cc
validation: partial (data-only change to web/whats-new.json plus the plan. Run alone at 96645d882: tools/whats-new-check.js 0.7.27 passes (mac 5, windows 2); engine/whatsnew.test.js + tools.whats-new-check-3955.test.js + web.whatsnew-3955.test.js 35/35; the #1720 browser-check gate passes on the Browser-check trailer in the first commit and the #2518 surface gate passes. No full-suite run: Mortals is queued with three other branches, and the 03:00 cut's step 3 runs the full suite at the pin, which is this merge, as for 0.7.26)
subdir_audit: passed
timestamp: 2026-10-07T04:40:46Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (plus Mona Lisa's copy check on every line; she approved all five as shipped, including the edits below)
**Converged:** Yes
**Total findings:** 33 (2 BLOCKERs, 17 WARNINGs, 4 CONVENTIONs, 10+ NITs)
**Fixed:** 15 | **Deferred:** 8 | **Asked (awaiting user):** 0

The draft was reworked at 23:35 (a095c88d7) when Josh's #5407 and #5187 merged (Splinter 23:31): two lines in, two out. Iterations 8 to 13 review the reworked file, and the four iterations from 9 on checked each line on each platform it is shown on, which is where both BLOCKERs and the Mac-only tags came from.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs
**Self-generated:** 0
- [WARNING] top bar line said "board layouts", not a product name --> FIXED (378c912ff)
- [WARNING] Codex isolation reaches existing agents only at their next start --> FIXED (378c912ff)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] name the View control's options --> FIXED (18a757939)

#### Iteration 3
**Reviewer model:** opus (narrower prompt than the template, so not counted toward convergence)
**New findings:** 0

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] plan listed three lines and "if they land" --> FIXED (33362bc41)
- [CONVENTION] Browser-check trailer only on the first commit --> DEFERRED: the gate reads base..HEAD; run alone it passes

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] Codex line sold a trade-off as only a gain --> FIXED (c29ceeefe; Mona approved)
- [NIT] Pause button is on the project's page --> FIXED (c29ceeefe; Mona approved)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 0
- [WARNING] top bar line relevance --> DEFERRED (self-scoped, not taggable); later dropped for room at the rework
- [WARNING] model line omits OpenAI's per-account detail --> DEFERRED: summary line

#### Iteration 7
**Reviewer model:** opus
**New findings:** 3 NITs (converged on the pre-rework file)

#### Iteration 8 (reworked file: Refresh login and messages waiting in; folder move and top bar out)
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] login line said only "about to expire"; the notice also shows after expiry --> FIXED (e2897b731, Mona's body verbatim)
- [WARNING] title "before it runs out" narrower than the behaviour --> FIXED (e2897b731, "Refresh a login from its notice")
- [CONVENTION] proof file tied to the diff --> regenerated here; [CONVENTION] trailer --> as iteration 4

#### Iteration 9
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] waiting-messages line shows on Windows, where the count never appears (engine/status.js classify returns from the win32 arm before the Antigravity arm reads the queue) --> FIXED (c5b899ef3, tagged ["mac"])
- [WARNING] plan row never checked the platform --> FIXED (c5b899ef3)
- [CONVENTION] plan table had no blank line before it --> FIXED (c5b899ef3)
- [NIT] count can read 1 when the queue prompt shows but no Kosmos-delivered lines --> DEFERRED: right in the common case; Mona approved the wording

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 (both about this proof and plan prose, the loop's own output)
- [WARNING] the old proof's "windows 4" no longer matched --> FIXED (this regenerated proof)
- [WARNING] plan cited review numbers the proof did not use --> FIXED (34837324d, commits cited instead)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 4 NITs
**Self-generated:** 0
- [BLOCKER] Refresh login shows on Windows, but the expiry is read only from the macOS keychain (engine/loginexpiry.js runs `security`; engine/claudeloginlive.js validUntil is darwin-only), so Windows gets no notice and no marking --> FIXED (4002dab72, tagged ["mac"]; verified in origin/main before tagging)
- [WARNING] "marks each login" but only Claude subscription sign-ins are marked --> FIXED (4002dab72, "each Claude login")
- [WARNING] plan row named no platform --> FIXED (4002dab72)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] model line omits that an untouched menu now starts Claude on Sonnet 5 (PR #5433's weakest premise) --> DEFERRED: the switch now shows the model menu with Sonnet 5 preselected, so the person sees the default at the moment they switch; adding it would push "one restart" out of 140 characters. Recorded in the plan row.
- [CONVENTION] branch behind main by 14 commits --> no change: none touch web/whats-new.json; the merge is clean

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
**Converged** - no new actionable findings (NITs: the count fallback, the Sonnet 5 default, the repeated shield icon, reading code from origin/main).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json | BRANCH | "board layouts" | FIXED | 378c912ff |
| 2 | 1 | WARNING | web/whats-new.json | BRANCH | Codex from next start | FIXED | 378c912ff |
| 3 | 2 | WARNING | web/whats-new.json | BRANCH | View option names | FIXED | 18a757939 |
| 4 | 4 | WARNING | plan | BRANCH | plan out of date | FIXED | 33362bc41 |
| 5 | 4 | CONVENTION | commits | BRANCH | trailer on first commit only | DEFERRED | gate covers the range |
| 6 | 5 | WARNING | web/whats-new.json | BRANCH | Codex trade-off | FIXED | c29ceeefe |
| 7 | 6 | WARNING | web/whats-new.json | BRANCH | top bar relevance | DEFERRED | dropped at rework |
| 8 | 6 | WARNING | web/whats-new.json | BRANCH | OpenAI detail | DEFERRED | summary line |
| 9 | 8 | WARNING | web/whats-new.json | BRANCH | login: expired case | FIXED | e2897b731 |
| 10 | 8 | WARNING | web/whats-new.json | BRANCH | login title narrow | FIXED | e2897b731 |
| 11 | 9 | WARNING | web/whats-new.json | BRANCH | waiting count not on Windows | FIXED | c5b899ef3 |
| 12 | 9 | WARNING | plan | BRANCH | no platform check in row | FIXED | c5b899ef3 |
| 13 | 9 | CONVENTION | plan | BRANCH | table break | FIXED | c5b899ef3 |
| 14 | 10 | WARNING | proof | SELF | stale windows count | FIXED | this proof |
| 15 | 10 | WARNING | plan | SELF | review numbers | FIXED | 34837324d |
| 16 | 11 | BLOCKER | web/whats-new.json | BRANCH | Refresh login not on Windows | FIXED | 4002dab72 |
| 17 | 11 | WARNING | web/whats-new.json | BRANCH | only Claude logins marked | FIXED | 4002dab72 |
| 18 | 11 | WARNING | plan | BRANCH | login row platform | FIXED | 4002dab72 |
| 19 | 12 | WARNING | web/whats-new.json | BRANCH | Sonnet 5 default unstated | DEFERRED | shown preselected at the switch |

### NITs (non-blocking, across all iterations)
- Count fallback to 1 (9, 13); repeated shield icon (9, 11, 12, 13); "card" undefined for a new reader (12); Pause hidden on archived projects (7, 9); title of the waiting line broader than its line (11); tooltip-only View names (7)

### Strengths (across all iterations)
- Every line traced to merged code on origin/main, per platform: three of five are Mac only by their code, and each tag cites the arm that makes it so
- Each line names who it applies to: "each Claude login", "Claude or OpenAI", "a Gemini agent on a Google subscription", "From their next start"
- Checker, three test files (35/35), both browser-check gates; no em dash in any spelling; every line at most 136 characters
