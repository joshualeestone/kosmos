---
pre_challenge: true
method: challenge-loop
branch: msgref-4631
diff_hash: e68db6d4682f76cc1a6fdc6e4897b97ab5215da2dac1b949f5fa1144a6cbd036
validation: passed (full tools/run-tests.sh on Mortals at 346a0a704: 12141 tests, 0 failed; entry recorded locally by hand after the recipe-edit incident, hash checked equal)
subdir_audit: passed
timestamp: 2026-09-29T23:18:31Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 17 actionable (2 BLOCKERs, 12 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 16 | **Deferred:** 1 (accepted risk, recorded in the plan) | **Asked (awaiting user):** 0

Per-iteration validation was the focused suites and browser checks (the shared full-suite queue was deadlocked,
then congested); the one full validation ran at convergence (6j), on Mortals. Commit refs below are pre-rebase.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 11 NITs
**Self-generated:** 0 of the above
- [CONVENTION] .claude/plans/ — No plan file for the branch --> FIXED (ded6d33)
- [WARNING] web/index.html msgMenuRowFor — ctrl-click on a data-open-agent name opened the agent AND the menu --> FIXED (3158a4f)
- [WARNING] web/index.html contextmenu — an Android long-press would be taken by the menu --> FIXED (3158a4f)
- [WARNING] web/index.html msgMenuOpen/Close — focus not returned, Tab left it open, keyboard menu key opened at 0,0 --> FIXED (3158a4f)
- [NIT] toast first message not announced; menu row lost after a repaint; comment placement; DM comment split; react route read the raw id; trailing full stop refused; CI allowlist; R7 could not tell its arms apart --> all FIXED (3158a4f)
- [NIT] pinned bar uses Math.round(barLeft) — pre-existing, not changed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html repaintReactions — a DM row's number vanished after a reaction repaint --> FIXED (d075442)
- [WARNING] web/index.html msgRefText — a numbered DM row's reference named no place --> FIXED (d075442)
- [NIT] first toast flashed empty --> FIXED (d075442)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/messages.js messageIdOf — a stray number (a card number, a year) now names a real post --> '#' form removed (962a8c6); bare numbers DEFERRED as accepted risk: the card asks for "530", and every caller checks the room (plan: Accepted risk)
- [WARNING] engine/defaults.js — doctrine pointed at the wrong lookup and did not say to quote the phrase --> FIXED (962a8c6)
- [NIT] plan vs DM-number branch; toast race; locale in the time phrase; Escape propagation --> all FIXED (962a8c6)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/defaults.js — "the whole phrase if you put it in quotes" is fragile against positional CLI args --> FIXED by deleting the claim (5f9541f; SELF, prose, 6e rule)
- [NIT] desktop bar not clamped (own posts sit right; agent bars flip) — no change; react room check — verified present

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html msgMenuRowFor — in WebKit a right-click selects the word first, so the menu never opened on a Mac --> FIXED: selection read at the press (fe327fd)
- [BLOCKER] web/index.html msgMenuOpen — in WebKit a clicked item takes no focus, the focusout closed the menu, nothing copied --> FIXED (fe327fd)
- [WARNING] render-msgref-4631.js — the "Mac" arm was Chromium with a spoofed platform --> FIXED: real WebKit arm R12, red without each fix (fe327fd)
- [WARNING] web/index.html msgRefText — a room row with no number fell through to DM wording --> FIXED (fe327fd)
- [CONVENTION] plan listed "#530" as accepted --> FIXED (fe327fd)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (the bare-number risk, iteration 3, deferred with reasoning)
**Converged** — no new actionable findings.

### Outstanding questions (ASKED)
None.

### Strengths (across all iterations)
- One normaliser (messageIdOf) at every id input point; non-id input unchanged so each caller's refusal still names the problem (1, 2, 3, 5, 6)
- The doctrine test proves its scan can see an id before asserting the prose has none (1, 3, 4)
- The browser check runs Chromium as Windows and Mac plus real WebKit, with controls that can fail (5)
